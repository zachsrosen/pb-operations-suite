import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import {
  SubmitRequestSchema,
  runEstimator,
  loadUtilityById,
  loadKwhPerKwYear,
  loadPricePerWatt,
  loadAddOnPricing,
  loadFinancingDefaults,
  loadApplicableIncentives,
  FALLBACK_PANEL_WATTAGE,
  addressHash,
  ESTIMATOR_SOURCE_STANDARD,
  ESTIMATOR_SOURCE_MANUAL,
  RECAPTCHA_REJECT_THRESHOLD,
  RECAPTCHA_REVIEW_THRESHOLD,
  TOKEN_TTL_DAYS,
} from "@/lib/estimator";
import type { EstimatorInput, EstimatorResult, SubmitRequest } from "@/lib/estimator";
import { verifyRecaptcha } from "@/lib/estimator/recaptcha";
import { checkRateLimit, extractIp, hashIp, rateLimitKey } from "@/lib/estimator/rate-limit";
import { upsertEstimatorContact, createEstimatorDeal } from "@/lib/estimator/hubspot";

const SALES_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_SALES ?? "default";
const SALES_FIRST_STAGE_ID = process.env.HUBSPOT_PIPELINE_SALES_FIRST_STAGE ?? "appointmentscheduled";

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

export async function POST(request: Request) {
  const ipHash = hashIp(extractIp(request));
  const allowed = await checkRateLimit(rateLimitKey("submit", ipHash), 3, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SubmitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid submission", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const submission = parsed.data;

  // -- reCAPTCHA verify (optional — only requires failure when a token is supplied AND fails)
  let recaptchaScore: number | null = null;
  let flaggedForReview = false;
  if (submission.recaptchaToken) {
    const verdict = await verifyRecaptcha(submission.recaptchaToken, "estimator_submit");
    recaptchaScore = verdict.score;
    if (!verdict.success) {
      if (verdict.score !== null && verdict.score < RECAPTCHA_REJECT_THRESHOLD) {
        return NextResponse.json({ error: "Rejected: recaptcha score too low" }, { status: 403 });
      }
      // Non-score failure (missing token, config issue) → log and continue
      console.warn("[estimator] recaptcha non-score failure:", verdict.reason);
    } else if (verdict.score !== null && verdict.score < RECAPTCHA_REVIEW_THRESHOLD) {
      flaggedForReview = true;
    }
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  try {
    const response = await handleSubmission({
      submission,
      token,
      expiresAt,
      ipHash,
      recaptchaScore,
      flaggedForReview,
    });
    return response;
  } catch (err) {
    console.error("[estimator] submit failed unexpectedly", err);
    return NextResponse.json({ error: "Submission failed" }, { status: 500 });
  }
}

async function handleSubmission(ctx: {
  submission: SubmitRequest;
  token: string;
  expiresAt: Date;
  ipHash: string;
  recaptchaScore: number | null;
  flaggedForReview: boolean;
}): Promise<NextResponse> {
  const { submission, token, expiresAt, ipHash, recaptchaScore, flaggedForReview } = ctx;

  if (submission.kind === "quote") {
    return handleQuoteKind({ submission, token, expiresAt, ipHash, recaptchaScore, flaggedForReview });
  }
  if (submission.kind === "out_of_area") {
    return handleOutOfArea({ submission, token, expiresAt, ipHash, recaptchaScore, flaggedForReview });
  }
  return handleManualQuote({ submission, token, expiresAt, ipHash, recaptchaScore, flaggedForReview });
}

async function handleQuoteKind(ctx: {
  submission: Extract<SubmitRequest, { kind: "quote" }>;
  token: string;
  expiresAt: Date;
  ipHash: string;
  recaptchaScore: number | null;
  flaggedForReview: boolean;
}): Promise<NextResponse> {
  const { submission, token, expiresAt, ipHash, recaptchaScore, flaggedForReview } = ctx;
  const { quote, contact } = submission;
  const utility = loadUtilityById(quote.utilityId);
  if (!utility) return NextResponse.json({ error: "Unknown utility" }, { status: 400 });

  const panelWattage = await resolveDefaultPanelWattage();
  const engineInput: EstimatorInput = {
    quoteType: "new_install",
    address: quote.address,
    location: quote.location,
    utility: { id: utility.id, avgBlendedRateUsdPerKwh: utility.avgBlendedRateUsdPerKwh },
    usage: quote.usage,
    home: quote.home,
    considerations: quote.considerations,
    addOns: quote.addOns,
    panelWattage,
    pricePerWatt: loadPricePerWatt(quote.location),
    kWhPerKwYear: loadKwhPerKwYear(quote.address.state, quote.home.shade),
    incentives: loadApplicableIncentives({
      state: quote.address.state,
      zip: quote.address.zip,
      utilityId: utility.id,
    }),
    addOnPricing: loadAddOnPricing(),
    financing: loadFinancingDefaults(),
  };
  const result = runEstimator(engineInput);

  const normalizedHash = addressHash({
    street: quote.address.street,
    unit: quote.address.unit ?? null,
    city: quote.address.city,
    state: quote.address.state,
    zip: quote.address.zip,
  });

  // Idempotency: if a run already exists for (email, hash, today), return its token.
  const existing = await prisma.estimatorRun.findFirst({
    where: {
      email: contact.email.toLowerCase(),
      normalizedAddressHash: normalizedHash,
      createdAt: { gte: startOfDay() },
      outOfArea: false,
      manualQuoteRequest: false,
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return NextResponse.json({ token: existing.token, dedupedFromExisting: true });
  }

  // Step 4: persist local FIRST
  const run = await prisma.estimatorRun.create({
    data: {
      token,
      quoteType: "new_install",
      inputSnapshot: engineInput as unknown as Prisma.InputJsonValue,
      resultSnapshot: result as unknown as Prisma.InputJsonValue,
      contactSnapshot: contact as unknown as Prisma.InputJsonValue,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email.toLowerCase(),
      address: formatAddress(quote.address),
      normalizedAddressHash: normalizedHash,
      location: quote.location,
      expiresAt,
      ipHash,
      recaptchaScore,
      flaggedForReview,
    },
  });

  // Steps 5-6: HubSpot contact + deal (failures do not undo local persist)
  await syncToHubSpot({
    runId: run.id,
    contact,
    address: quote.address,
    result,
    source: ESTIMATOR_SOURCE_STANDARD,
    token,
    considerations: {
      planningEv: quote.considerations.planningEv,
      needsPanelUpgrade: quote.considerations.needsPanelUpgrade,
      mayNeedNewRoof: quote.considerations.mayNeedNewRoof,
    },
    addOns: quote.addOns,
  });

  // Step 7: email (fire-and-log; non-blocking)
  await sendResultEmail({ contact, token, result }).catch((err) => {
    console.warn("[estimator] results email failed (non-fatal)", err);
  });

  await logActivity("ESTIMATOR_SUBMISSION", { runId: run.id, outOfArea: false, manualQuoteRequest: false });

  return NextResponse.json({ token });
}

async function handleOutOfArea(ctx: {
  submission: Extract<SubmitRequest, { kind: "out_of_area" }>;
  token: string;
  expiresAt: Date;
  ipHash: string;
  recaptchaScore: number | null;
  flaggedForReview: boolean;
}): Promise<NextResponse> {
  const { submission, token, expiresAt, ipHash, recaptchaScore, flaggedForReview } = ctx;
  const { contact, zip } = submission;

  const run = await prisma.estimatorRun.create({
    data: {
      token,
      quoteType: "new_install",
      inputSnapshot: { zip } as unknown as Prisma.InputJsonValue,
      resultSnapshot: Prisma.JsonNull,
      contactSnapshot: contact as unknown as Prisma.InputJsonValue,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email.toLowerCase(),
      address: `zip: ${zip}`,
      expiresAt,
      ipHash,
      outOfArea: true,
      recaptchaScore,
      flaggedForReview,
    },
  });

  // Create a contact only (no deal) in HubSpot
  try {
    const { contactId } = await upsertEstimatorContact({
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      address: { street: "", city: "", state: "", zip },
      lifecyclestage: "marketingqualifiedlead",
      waitlistZip: zip,
    });
    await prisma.estimatorRun.update({ where: { id: run.id }, data: { hubspotContactId: contactId } });
  } catch (err) {
    console.warn("[estimator] out-of-area HubSpot contact create failed", err);
  }

  await sendWaitlistEmail(contact).catch((err) => {
    console.warn("[estimator] waitlist email failed (non-fatal)", err);
  });

  await logActivity("ESTIMATOR_OUT_OF_AREA", { runId: run.id, zip });

  return NextResponse.json({ token, outOfArea: true });
}

async function handleManualQuote(ctx: {
  submission: Extract<SubmitRequest, { kind: "manual_quote_request" }>;
  token: string;
  expiresAt: Date;
  ipHash: string;
  recaptchaScore: number | null;
  flaggedForReview: boolean;
}): Promise<NextResponse> {
  const { submission, token, expiresAt, ipHash, recaptchaScore, flaggedForReview } = ctx;
  const { contact, address, location, message } = submission;

  const normalizedHash = addressHash({
    street: address.street,
    unit: address.unit ?? null,
    city: address.city,
    state: address.state,
    zip: address.zip,
  });

  const run = await prisma.estimatorRun.create({
    data: {
      token,
      quoteType: "new_install",
      inputSnapshot: { address, location, message } as unknown as Prisma.InputJsonValue,
      resultSnapshot: Prisma.JsonNull,
      contactSnapshot: contact as unknown as Prisma.InputJsonValue,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email.toLowerCase(),
      address: formatAddress(address),
      normalizedAddressHash: normalizedHash,
      location,
      expiresAt,
      ipHash,
      manualQuoteRequest: true,
      recaptchaScore,
      flaggedForReview,
    },
  });

  await syncToHubSpot({
    runId: run.id,
    contact,
    address,
    result: undefined,
    source: ESTIMATOR_SOURCE_MANUAL,
    token,
    considerations: { planningEv: false, needsPanelUpgrade: false, mayNeedNewRoof: false },
    addOns: { evCharger: false, panelUpgrade: false },
  });

  await sendManualQuoteEmail(contact).catch((err) => {
    console.warn("[estimator] manual-quote email failed (non-fatal)", err);
  });

  await logActivity("ESTIMATOR_SUBMISSION", { runId: run.id, outOfArea: false, manualQuoteRequest: true });

  return NextResponse.json({ token, manualQuoteRequest: true });
}

// -- Helpers --

async function syncToHubSpot(input: {
  runId: string;
  contact: { firstName: string; lastName: string; email: string; phone?: string };
  address: EstimatorInput["address"];
  result: EstimatorResult | undefined;
  source: string;
  token: string;
  considerations: { planningEv: boolean; needsPanelUpgrade: boolean; mayNeedNewRoof: boolean };
  addOns: { evCharger: boolean; panelUpgrade: boolean };
}) {
  try {
    const { contactId } = await upsertEstimatorContact({
      email: input.contact.email,
      firstName: input.contact.firstName,
      lastName: input.contact.lastName,
      phone: input.contact.phone,
      address: input.address,
      lifecyclestage: "lead",
    });
    await prisma.estimatorRun.update({
      where: { id: input.runId },
      data: { hubspotContactId: contactId },
    });

    const dealName = `${input.contact.firstName} ${input.contact.lastName} — ${input.address.city}, ${input.address.state}`;
    const amount = input.result?.pricing.finalUsd ?? 0;
    const { dealId } = await createEstimatorDeal({
      contactId,
      dealName,
      pipelineId: SALES_PIPELINE_ID,
      stageId: SALES_FIRST_STAGE_ID,
      amount,
      source: input.source,
      resultsToken: input.token,
      result: input.result,
      considerations: input.considerations,
      addOns: input.addOns,
    });
    await prisma.estimatorRun.update({
      where: { id: input.runId },
      data: { hubspotDealId: dealId },
    });
  } catch (err) {
    console.warn("[estimator] HubSpot sync failed (reconcile cron will retry)", err);
  }
}

async function resolveDefaultPanelWattage(): Promise<number> {
  try {
    const found = await prisma.internalProduct.findFirst({
      where: { category: "MODULE", defaultForEstimator: true, isActive: true },
      include: { moduleSpec: true },
    });
    const watt = found?.moduleSpec?.wattage ?? found?.unitSpec;
    if (typeof watt === "number" && watt > 100 && watt < 1200) return watt;
  } catch (err) {
    console.warn("[estimator] default panel lookup failed", err);
  }
  return FALLBACK_PANEL_WATTAGE;
}

function formatAddress(a: EstimatorInput["address"]): string {
  return [a.street, a.unit, a.city, `${a.state} ${a.zip}`].filter(Boolean).join(", ");
}

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function logActivity(
  type: "ESTIMATOR_SUBMISSION" | "ESTIMATOR_OUT_OF_AREA",
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        type,
        description:
          type === "ESTIMATOR_SUBMISSION"
            ? "Estimator submission received"
            : "Estimator out-of-area submission received",
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.warn("[estimator] activity log failed (non-fatal)", err);
  }
}

// Email senders — real templates wired in Chunk 6; these are placeholders that log.
async function sendResultEmail(input: {
  contact: { firstName: string; email: string };
  token: string;
  result: EstimatorResult;
}): Promise<void> {
  console.info("[estimator] would send results email", { to: input.contact.email, token: input.token });
}

async function sendWaitlistEmail(contact: { firstName: string; email: string }): Promise<void> {
  console.info("[estimator] would send waitlist email", { to: contact.email });
}

async function sendManualQuoteEmail(contact: { firstName: string; email: string }): Promise<void> {
  console.info("[estimator] would send manual-quote email", { to: contact.email });
}
