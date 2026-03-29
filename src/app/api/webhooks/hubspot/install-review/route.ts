/**
 * HubSpot Inspection Stage Webhook — Install Photo Review
 *
 * POST /api/webhooks/hubspot/install-review
 *
 * Triggered by HubSpot workflow when a deal enters the Inspection stage.
 * Compares install photos against the permitted planset using Claude vision,
 * then emails the Inspections Lead and Operations Lead with the results.
 *
 * Uses the review lock system for deduplication.
 * Responds 200 immediately with background processing via waitUntil().
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma, logActivity } from "@/lib/db";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { PIPELINE_ACTOR } from "@/lib/actor-context";
import {
  acquireReviewLock,
  completeReviewRun,
  failReviewRun,
  touchReviewRun,
  DuplicateReviewError,
} from "@/lib/review-lock";
import {
  buildInstallReviewEmailHtml,
  buildInstallReviewEmailText,
} from "@/lib/install-review-email";
import type { InstallReviewReport } from "@/lib/install-review-email";
import { sendEmailMessage } from "@/lib/email";

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
// Deal properties to fetch
// ---------------------------------------------------------------------------

const DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "pipeline",
  "pb_location",
  // Planset / photo folders
  "design_documents",
  "design_document_folder_id",
  "all_document_parent_folder_id",
  "installation_documents",
  "installation_document_id",
  "permit_documents",
  "permit_document_id",
  // Equipment context
  "system_size_kw",
  "module_type",
  "module_count",
  "inverter_type",
  "battery_type",
  "battery_count",
  "roof_type",
  // Recipients
  "inspections_lead",
  "operations_manager",
  "hubspot_owner_id",
];

// ---------------------------------------------------------------------------
// Status gate (optional — restrict to specific dealstages)
// ---------------------------------------------------------------------------

function getTargetStatuses(): Set<string> | null {
  const raw = (process.env.INSTALL_REVIEW_TARGET_STATUS ?? "").trim();
  if (!raw) return null;
  const statuses = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return statuses.size > 0 ? statuses : null;
}

// ---------------------------------------------------------------------------
// Resolve recipients (inspections lead + operations lead)
// ---------------------------------------------------------------------------

async function resolveRecipients(
  properties: Record<string, string | null>,
): Promise<{ emails: string[]; names: string[] }> {
  const { resolveHubSpotOwnerContact } = await import("@/lib/hubspot");
  const ownerIds = [
    properties.inspections_lead,
    properties.operations_manager,
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
// Background worker — runs the install photo review
// ---------------------------------------------------------------------------

async function processInstallReview(
  reviewId: string,
  dealId: string,
  eventId: number,
) {
  const start = Date.now();
  console.log(`[install-review-webhook] BG START: deal ${dealId}, review ${reviewId}`);

  // 1. Fetch deal properties
  const { hubspotClient } = await import("@/lib/hubspot");
  console.log(`[install-review-webhook] Fetching deal properties for ${dealId}...`);
  const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, DEAL_PROPERTIES);
  const properties = deal.properties;
  console.log(`[install-review-webhook] Got properties for deal ${dealId}: ${properties.dealname}`);

  await touchReviewRun(reviewId);

  // 2. Call the install-review API internally (reuse all the photo/planset/AI logic)
  // We call the existing endpoint via internal fetch to avoid duplicating ~400 lines
  // of complex photo sourcing + Claude vision logic.
  const baseUrl = process.env.NEXTAUTH_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || "http://localhost:3000";
  // Must use API_SECRET_TOKEN — middleware only recognizes that for machine-to-machine auth
  const apiSecret = process.env.API_SECRET_TOKEN;
  console.log(`[install-review-webhook] Calling ${baseUrl}/api/install-review for deal ${dealId} (auth: ${apiSecret ? "yes" : "NO TOKEN"})`);

  const reviewResponse = await fetch(`${baseUrl}/api/install-review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiSecret ? { Authorization: `Bearer ${apiSecret}` } : {}),
    },
    body: JSON.stringify({ dealId }),
  });

  await touchReviewRun(reviewId);

  const reviewResult = await reviewResponse.json();

  if (!reviewResponse.ok) {
    const errMsg = reviewResult.error || reviewResult.details || `HTTP ${reviewResponse.status}`;
    console.error(`[install-review-webhook] Review failed for deal ${dealId}: ${errMsg}`);

    // If no photos or no planset, complete with a warning instead of failing
    if (reviewResponse.status === 422) {
      await completeReviewRun(reviewId, {
        findings: [{
          check: "install-review-skipped",
          severity: "warning" as const,
          message: errMsg,
        }],
        errorCount: 0,
        warningCount: 1,
        passed: false,
        durationMs: Date.now() - start,
      });

      // Still email the team so they know it was attempted
      const { emails } = await resolveRecipients(properties);
      const dealName = properties.dealname ?? dealId;
      if (emails.length > 0) {
        await sendEmailMessage({
          to: emails,
          subject: `\u26A0\uFE0F Install Photo Review Skipped \u2014 ${dealName}`,
          html: `<p>Install photo review could not run for <strong>${dealName}</strong>: ${errMsg}</p><p>Please ensure install photos are uploaded to the deal's installation documents folder.</p>`,
          text: `Install photo review could not run for ${dealName}: ${errMsg}\n\nPlease ensure install photos are uploaded to the deal's installation documents folder.`,
          debugFallbackTitle: `Install Review Skipped: ${dealName}`,
          debugFallbackBody: errMsg,
        });
      }

      await logSkippedActivity(dealId, eventId, errMsg, properties.dealname, emails.length, start);
      return;
    }

    // Real error — mark as failed
    throw new Error(errMsg);
  }

  // 3. Build the report for email
  const dealName = properties.dealname ?? dealId;
  const report: InstallReviewReport = {
    dealId,
    dealName,
    findings: reviewResult.findings ?? [],
    overall_pass: reviewResult.overall_pass ?? true,
    summary: reviewResult.summary ?? "Review complete",
    photo_count: reviewResult.photo_count ?? 0,
    planset_filename: reviewResult.planset_filename ?? "unknown",
    duration_ms: reviewResult.duration_ms ?? Date.now() - start,
  };

  // 4. Complete the review run (the install-review endpoint already persisted
  //    its own review run, but we have a separate webhook review lock)
  const findings = report.findings.map((f) => ({
    check: `install-${f.category}`,
    severity: (f.status === "fail" ? "error" : f.status === "unable_to_verify" ? "warning" : "info") as "error" | "warning" | "info",
    message: `[${f.status.toUpperCase()}] ${f.category}: ${f.notes || f.observed}`,
  }));

  const errorCount = report.findings.filter((f) => f.status === "fail").length;
  const warningCount = report.findings.filter((f) => f.status === "unable_to_verify").length;
  const projectIdMatch = dealName.match(/PROJ-\d+/);
  const projectId = projectIdMatch?.[0] ?? null;

  await completeReviewRun(reviewId, {
    findings,
    errorCount,
    warningCount,
    passed: report.overall_pass,
    durationMs: Date.now() - start,
    projectId,
  });

  // 5. Send email to inspections lead + operations lead
  const { emails, names } = await resolveRecipients(properties);

  if (emails.length > 0) {
    const subject = `${report.overall_pass ? "\u2705" : "\u274C"} Install Photo Review \u2014 ${dealName}`;

    await sendEmailMessage({
      to: emails,
      subject,
      html: buildInstallReviewEmailHtml(report),
      text: buildInstallReviewEmailText(report),
      debugFallbackTitle: `Install Photo Review: ${dealName}`,
      debugFallbackBody: buildInstallReviewEmailText(report),
    });
  }

  // 6. Log activity
  await logActivity({
    type: "DESIGN_REVIEW_COMPLETED",
    description: `Install photo review ${report.overall_pass ? "passed" : "failed"} for deal ${dealId} (${errorCount} fails, ${warningCount} unverified)`,
    userEmail: PIPELINE_ACTOR.email,
    userName: PIPELINE_ACTOR.name,
    entityType: "review",
    entityId: dealId,
    entityName: projectId ?? dealId,
    metadata: {
      event: "install_review",
      dealId,
      eventId,
      skill: "install-review",
      trigger: "install-review-webhook",
      passed: report.overall_pass,
      errorCount,
      warningCount,
      photoCount: report.photo_count,
      plansetFilename: report.planset_filename,
      recipientCount: emails.length,
      recipients: names,
      durationMs: Date.now() - start,
    },
    requestPath: "/api/webhooks/hubspot/install-review",
    requestMethod: "POST",
  });

  console.log(
    `[install-review-webhook] Deal ${dealId}: ${report.overall_pass ? "PASS" : "FAIL"} (${errorCount} fail/${warningCount} unverified, ${report.photo_count} photos) in ${Date.now() - start}ms \u2192 ${emails.length} recipients`,
  );
}

// ---------------------------------------------------------------------------
// Helper: log skipped activity
// ---------------------------------------------------------------------------

async function logSkippedActivity(
  dealId: string,
  eventId: number,
  reason: string,
  dealName: string | null | undefined,
  recipientCount: number,
  start: number,
) {
  await logActivity({
    type: "DESIGN_REVIEW_COMPLETED",
    description: `Install photo review skipped for deal ${dealId}: ${reason}`,
    userEmail: PIPELINE_ACTOR.email,
    userName: PIPELINE_ACTOR.name,
    entityType: "review",
    entityId: dealId,
    entityName: dealName ?? dealId,
    metadata: {
      event: "install_review_skipped",
      dealId,
      eventId,
      skill: "install-review",
      trigger: "install-review-webhook",
      reason,
      recipientCount,
      durationMs: Date.now() - start,
    },
    requestPath: "/api/webhooks/hubspot/install-review",
    requestMethod: "POST",
  });
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
      console.warn(`[install-review-webhook] Auth failed: ${validation.error} (no valid bearer token either)`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // -- 3. Parse payload --
  // Supports two formats:
  //   a) App-scope: [{eventId, subscriptionType, propertyName, propertyValue, objectId}]
  //   b) Workflow: {objectId, properties:{dealstage:"..."}} or {dealId}
  let events: HubSpotWebhookEvent[];
  try {
    const parsed = JSON.parse(rawBody);

    if (Array.isArray(parsed)) {
      events = parsed;
    } else if (parsed && typeof parsed === "object") {
      const objectId =
        parsed.objectId ??
        parsed.hs_object_id ??
        parsed.dealId ??
        parsed.properties?.hs_object_id?.value ??
        parsed.properties?.hs_object_id ??
        parsed.vid;

      const dealstage =
        parsed.propertyValue ??
        parsed.properties?.dealstage?.value ??
        parsed.properties?.dealstage ??
        undefined;

      if (!objectId) {
        console.error(`[install-review-webhook] Could not extract deal ID. Raw keys: ${JSON.stringify(Object.keys(parsed))}`);
        return NextResponse.json({ error: "Missing objectId or dealId" }, { status: 400 });
      }

      events = [{
        eventId: Date.now(),
        subscriptionType: "deal.propertyChange",
        propertyName: "dealstage",
        propertyValue: dealstage,
        objectId: Number(objectId),
      }];
      console.log(`[install-review-webhook] Normalized workflow payload: deal ${objectId}, dealstage ${dealstage || "(trusting workflow)"}`);
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
    console.warn("[install-review-webhook] INSTALL_REVIEW_TARGET_STATUS not set \u2014 all events from the workflow will trigger the review");
  }

  for (const event of events) {
    // Accept both dealstage and deal.propertyChange subscription types
    if (event.subscriptionType !== "deal.propertyChange") continue;

    // Gate: only run when dealstage matches target (if configured).
    // If propertyValue is missing (workflow payloads), trust the workflow enrollment criteria.
    if (targetStatuses && event.propertyValue) {
      if (!targetStatuses.has(event.propertyValue.toLowerCase())) {
        skipped.push(String(event.objectId));
        continue;
      }
    }

    const dealId = String(event.objectId);

    // Acquire lock
    let reviewId: string;
    try {
      reviewId = await acquireReviewLock(dealId, "install-review-webhook", "webhook");
    } catch (err) {
      if (err instanceof DuplicateReviewError) {
        duplicates.push(dealId);
        continue;
      }
      throw err;
    }

    // Run in background
    console.log(`[install-review-webhook] Spawning waitUntil for deal ${dealId} (review ${reviewId})`);
    waitUntil(
      processInstallReview(reviewId, dealId, event.eventId).catch(async (err) => {
        console.error(`[install-review-webhook] BG ERROR for deal ${dealId}:`, err instanceof Error ? err.message : err);
        await failReviewRun(reviewId, err instanceof Error ? err.message : "unknown").catch(() => {});
      }),
    );

    triggered.push(dealId);
  }

  return NextResponse.json({ status: "ok", triggered, skipped, duplicates });
}
