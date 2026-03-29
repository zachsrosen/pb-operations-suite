/**
 * HubSpot Deal Property Change Webhook — FDR (Final Design Review) Check
 *
 * POST /api/webhooks/hubspot/fdr-check
 *
 * Triggered by HubSpot workflow when a deal's design_status changes.
 * Gates on FDR_CHECK_TARGET_STATUS (default: "DA Approved").
 * Runs the existing design-review checks and emails the design lead
 * and preconstruction lead.
 *
 * Uses the review lock system for deduplication.
 * Responds 200 immediately with background processing via waitUntil().
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma, logActivity } from "@/lib/db";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { runChecks } from "@/lib/checks/runner";
import { PIPELINE_ACTOR } from "@/lib/actor-context";
import {
  acquireReviewLock,
  completeReviewRun,
  failReviewRun,
  touchReviewRun,
  DuplicateReviewError,
} from "@/lib/review-lock";
import {
  buildFdrEmailHtml,
  buildFdrEmailText,
} from "@/lib/checks/site-survey-readiness-email";
import { sendEmailMessage } from "@/lib/email";
// Side-effect import: registers design-review checks with the engine
import "@/lib/checks/design-review";

export const runtime = "nodejs";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// HubSpot webhook event shape
// ---------------------------------------------------------------------------

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionType: string;
  propertyName?: string;
  propertyValue?: string;
  objectId: number;
  changeSource?: string;
}

// ---------------------------------------------------------------------------
// Deal properties to fetch (same as design-review webhook)
// ---------------------------------------------------------------------------

const DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "pipeline",
  "amount",
  "pb_location",
  "design_status",
  "permitting_status",
  "site_survey_status",
  "install_date",
  "inspection_date",
  "pto_date",
  "hubspot_owner_id",
  "closedate",
  "design_documents",
  "design_document_folder_id",
  "all_document_parent_folder_id",
  "system_size_kw",
  "module_type",
  "module_count",
  "inverter_type",
  "battery_type",
  "battery_count",
  "roof_type",
  // Recipients
  "design",
  "rtb_lead",
];

// ---------------------------------------------------------------------------
// Status gate
// ---------------------------------------------------------------------------

function getTargetStatuses(): Set<string> | null {
  const raw = (process.env.FDR_CHECK_TARGET_STATUS ?? "").trim();
  if (!raw) return null;
  const statuses = new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  return statuses.size > 0 ? statuses : null;
}

// ---------------------------------------------------------------------------
// Resolve recipients (design lead + preconstruction lead)
// ---------------------------------------------------------------------------

async function resolveRecipients(
  properties: Record<string, string | null>,
): Promise<{ emails: string[]; names: string[] }> {
  const { resolveHubSpotOwnerContact } = await import("@/lib/hubspot");
  const ownerIds = [
    properties.design,
    properties.rtb_lead,
  ];

  const emails: string[] = [];
  const names: string[] = [];

  for (const ownerId of ownerIds) {
    if (!ownerId) continue;
    const contact = await resolveHubSpotOwnerContact(ownerId);
    if (contact?.email) {
      emails.push(contact.email);
      names.push(contact.name ?? contact.email);
    }
  }

  return { emails: [...new Set(emails)], names };
}

// ---------------------------------------------------------------------------
// Background worker
// ---------------------------------------------------------------------------

async function processFdrCheck(
  reviewId: string,
  dealId: string,
  eventId: number,
) {
  const start = Date.now();

  // 1. Fetch deal properties
  const { hubspotClient } = await import("@/lib/hubspot");
  const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, DEAL_PROPERTIES);
  const properties = deal.properties;

  await touchReviewRun(reviewId);

  // 2. Run design-review checks
  const result = await runChecks("design-review", { dealId, properties }, () => touchReviewRun(reviewId));

  // 3. Complete the review run
  const projectIdMatch = properties.dealname?.match(/PROJ-\d+/);
  const projectId = projectIdMatch?.[0] ?? null;

  await completeReviewRun(reviewId, {
    findings: result.findings,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    passed: result.passed,
    durationMs: Date.now() - start,
    projectId,
  });

  // 4. Send email to design lead + preconstruction lead
  const { emails, names } = await resolveRecipients(properties);
  const dealName = properties.dealname ?? dealId;

  if (emails.length > 0) {
    const subject = `${result.passed ? "✅" : "❌"} Final Design Review — ${dealName}`;

    await sendEmailMessage({
      to: emails,
      subject,
      html: buildFdrEmailHtml(dealId, dealName, result.passed, result.findings),
      text: buildFdrEmailText(dealName, result.passed, result.findings),
      debugFallbackTitle: `FDR Check: ${dealName}`,
      debugFallbackBody: buildFdrEmailText(dealName, result.passed, result.findings),
    });
  }

  // 5. Log activity
  await logActivity({
    type: "DESIGN_REVIEW_COMPLETED",
    description: `FDR check ${result.passed ? "passed" : "failed"} for deal ${dealId} (${result.errorCount} errors, ${result.warningCount} warnings)`,
    userEmail: PIPELINE_ACTOR.email,
    userName: PIPELINE_ACTOR.name,
    entityType: "review",
    entityId: dealId,
    entityName: projectId ?? dealId,
    metadata: {
      event: "fdr_check",
      dealId,
      eventId,
      skill: "design-review",
      trigger: "fdr-check",
      passed: result.passed,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      recipientCount: emails.length,
      recipients: names,
      durationMs: Date.now() - start,
    },
    requestPath: "/api/webhooks/hubspot/fdr-check",
    requestMethod: "POST",
  });

  console.log(
    `[fdr-check] Deal ${dealId}: ${result.passed ? "PASSED" : "FAILED"} (${result.errorCount}E/${result.warningCount}W) in ${Date.now() - start}ms → ${emails.length} recipients`,
  );
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // -- 1. Read raw body --
  const rawBody = await req.text();

  // -- 2. Authenticate: Bearer token OR HubSpot v3 signature --
  const bearerToken = req.headers.get("authorization")?.replace("Bearer ", "");
  const webhookSecret = process.env.PIPELINE_WEBHOOK_SECRET || process.env.API_SECRET_TOKEN;
  const isBearerAuth = bearerToken && webhookSecret && bearerToken === webhookSecret;

  if (!isBearerAuth) {
    const signature = req.headers.get("x-hubspot-signature-v3") ?? "";
    const timestamp = req.headers.get("x-hubspot-request-timestamp") ?? "";

    const validation = validateHubSpotWebhook({
      rawBody,
      signature,
      timestamp,
      requestUrl: req.url,
      method: "POST",
    });

    if (!validation.valid) {
      console.warn(`[fdr-check] Auth failed: ${validation.error} (no valid bearer token either)`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // -- 3. Parse payload --
  // Supports two formats:
  //   a) App-scope: [{eventId, subscriptionType, propertyName, propertyValue, objectId}]
  //   b) Workflow: {objectId, properties:{design_status:"..."}} or {dealId}
  let events: HubSpotWebhookEvent[];
  try {
    const parsed = JSON.parse(rawBody);

    if (Array.isArray(parsed)) {
      events = parsed;
    } else if (parsed && typeof parsed === "object") {
      const objectId = parsed.objectId ?? parsed.hs_object_id ?? parsed.dealId ?? parsed.vid;

      const designStatus =
        parsed.propertyValue ??
        parsed.properties?.design_status?.value ??
        parsed.properties?.design_status ??
        undefined;

      if (!objectId) {
        return NextResponse.json({ error: "Missing objectId or dealId" }, { status: 400 });
      }

      events = [{
        eventId: Date.now(),
        subscriptionType: "deal.propertyChange",
        propertyName: "design_status",
        propertyValue: designStatus,
        objectId: Number(objectId),
      }];
      console.log(`[fdr-check] Normalized workflow payload: deal ${objectId}, design_status ${designStatus || "(trusting workflow)"}`);
    } else {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // -- 4. Process each event --
  const targetStatuses = getTargetStatuses();
  const triggered: string[] = [];
  const skipped: string[] = [];
  const duplicates: string[] = [];

  if (!targetStatuses) {
    console.warn("[fdr-check] FDR_CHECK_TARGET_STATUS not set — all design_status changes will trigger check");
  }

  for (const event of events) {
    if (event.subscriptionType !== "deal.propertyChange") continue;
    if (event.propertyName !== "design_status") continue;

    // Gate: only run when design_status matches target.
    // If propertyValue is missing (workflow payloads), trust the workflow enrollment criteria.
    if (targetStatuses && event.propertyValue) {
      if (!targetStatuses.has(event.propertyValue.toLowerCase())) {
        skipped.push(String(event.objectId));
        continue;
      }
    }

    const dealId = String(event.objectId);

    // Acquire lock — use "fdr-check" as the skill name for the review lock
    // This is separate from "design-review" so both can run concurrently
    let reviewId: string;
    try {
      reviewId = await acquireReviewLock(dealId, "fdr-check", "webhook");
    } catch (err) {
      if (err instanceof DuplicateReviewError) {
        duplicates.push(dealId);
        continue;
      }
      throw err;
    }

    // Run in background
    waitUntil(
      processFdrCheck(reviewId, dealId, event.eventId).catch(async (err) => {
        console.error(`[fdr-check] Error for deal ${dealId}:`, err);
        await failReviewRun(reviewId, err instanceof Error ? err.message : "unknown").catch(() => {});
      }),
    );

    triggered.push(dealId);
  }

  return NextResponse.json({ status: "ok", triggered, skipped, duplicates });
}
