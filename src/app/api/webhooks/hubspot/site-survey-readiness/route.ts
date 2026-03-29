/**
 * HubSpot Deal Property Change Webhook — Site Survey Readiness
 *
 * POST /api/webhooks/hubspot/site-survey-readiness
 *
 * Triggered by HubSpot workflow when a deal's design_status changes.
 * Gates on SITE_SURVEY_READINESS_TARGET_STATUS (default: "Initial Review").
 * Scans the site survey Drive folder, categorizes files against the IDR
 * checklist, and emails the surveyor, design lead, and preconstruction lead.
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
import { runReadinessReport } from "@/lib/checks/site-survey-readiness";
import {
  buildReadinessEmailHtml,
  buildReadinessEmailText,
} from "@/lib/checks/site-survey-readiness-email";
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
  "project_type",
  "pb_location",
  "design_status",
  // Survey
  "site_survey_documents",
  "all_document_parent_folder_id",
  "site_survey_status",
  "is_site_survey_completed_",
  "site_surveyor",
  "site_survey_date",
  // Equipment (for PV detection)
  "module_brand",
  "module_count",
  "inverter_brand",
  "battery_brand",
  "battery_count",
  "calculated_system_size__kwdc_",
  // Recipients
  "hubspot_owner_id",
  "design",
  "rtb_lead",
];

// ---------------------------------------------------------------------------
// Status gate
// ---------------------------------------------------------------------------

function getTargetStatuses(): Set<string> | null {
  const raw = (process.env.SITE_SURVEY_READINESS_TARGET_STATUS ?? "").trim();
  if (!raw) return null;
  const statuses = new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  return statuses.size > 0 ? statuses : null;
}

// ---------------------------------------------------------------------------
// Resolve recipients (surveyor, design lead, preconstruction lead)
// ---------------------------------------------------------------------------

async function resolveRecipients(
  properties: Record<string, string | null>,
): Promise<{ emails: string[]; names: string[] }> {
  const { resolveHubSpotOwnerContact } = await import("@/lib/hubspot");
  const ownerIds = [
    properties.site_surveyor,
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

async function processSurveyReadiness(
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

  // 2. Run the readiness report (single Drive walk)
  const report = await runReadinessReport(dealId, properties);

  await touchReviewRun(reviewId);

  // 3. Build findings for the review lock (convert checklist to Finding format)
  const findings = report.checklist
    .filter((c) => c.status !== "pass" && c.status !== "na")
    .map((c) => ({
      check: `ss-${c.item.toLowerCase().replace(/\s+/g, "-")}`,
      severity: c.severity,
      message: `${c.item}: ${c.note}`,
    }));

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  // 4. Complete the review run
  const projectIdMatch = properties.dealname?.match(/PROJ-\d+/);
  const projectId = projectIdMatch?.[0] ?? null;

  await completeReviewRun(reviewId, {
    findings,
    errorCount,
    warningCount,
    passed: report.readyForIDR,
    durationMs: Date.now() - start,
    projectId,
  });

  // 5. Send email to surveyor, design lead, preconstruction lead
  const { emails, names } = await resolveRecipients(properties);

  if (emails.length > 0) {
    const subject = `${report.readyForIDR ? "✅" : "❌"} Site Survey Readiness — ${report.dealName}`;

    await sendEmailMessage({
      to: emails,
      subject,
      html: buildReadinessEmailHtml(report),
      text: buildReadinessEmailText(report),
      debugFallbackTitle: `Site Survey Readiness: ${report.dealName}`,
      debugFallbackBody: buildReadinessEmailText(report),
    });
  }

  // 6. Log activity
  await logActivity({
    type: "DESIGN_REVIEW_COMPLETED",
    description: `Site survey readiness ${report.readyForIDR ? "passed" : "failed"} for deal ${dealId} (${errorCount} errors, ${warningCount} warnings)`,
    userEmail: PIPELINE_ACTOR.email,
    userName: PIPELINE_ACTOR.name,
    entityType: "review",
    entityId: dealId,
    entityName: projectId ?? dealId,
    metadata: {
      event: "site_survey_readiness",
      dealId,
      eventId,
      skill: "site-survey-readiness",
      passed: report.readyForIDR,
      errorCount,
      warningCount,
      totalFiles: report.totalFiles,
      surveySystem: report.surveySystem,
      recipientCount: emails.length,
      recipients: names,
      durationMs: Date.now() - start,
    },
    requestPath: "/api/webhooks/hubspot/site-survey-readiness",
    requestMethod: "POST",
  });

  console.log(
    `[site-survey-readiness] Deal ${dealId}: ${report.readyForIDR ? "READY" : "NOT READY"} (${errorCount}E/${warningCount}W, ${report.totalFiles} files) in ${Date.now() - start}ms → ${emails.length} recipients`,
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
      console.warn(`[site-survey-readiness] Auth failed: ${validation.error} (no valid bearer token either)`);
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

    // TEMP DEBUG: Dump the raw payload structure so we can see what
    // HubSpot workflow "Send a webhook" actually sends.
    const payloadSample = rawBody.slice(0, 2000);
    const isArray = Array.isArray(parsed);
    const topKeys = !isArray && typeof parsed === "object" ? Object.keys(parsed) : [];

    // Return immediately with the payload dump — skip processing for now
    return NextResponse.json({
      status: "debug",
      isArray,
      topKeys,
      payloadSample,
    });

    if (Array.isArray(parsed)) {
      events = parsed;
    } else if (parsed && typeof parsed === "object") {
      // HubSpot workflow payloads may nest the deal ID inside properties
      const objectId =
        parsed.objectId ??
        parsed.hs_object_id ??
        parsed.dealId ??
        parsed.properties?.hs_object_id?.value ??
        parsed.properties?.hs_object_id ??
        parsed.vid;

      // Extract design_status from workflow payload (nested or flat)
      const designStatus =
        parsed.propertyValue ??
        parsed.properties?.design_status?.value ??
        parsed.properties?.design_status ??
        undefined;

      if (!objectId) {
        console.error(`[site-survey-readiness] Could not extract deal ID. Raw keys: ${JSON.stringify(Object.keys(parsed))}`);
        return NextResponse.json({ error: "Missing objectId or dealId" }, { status: 400 });
      }

      events = [{
        eventId: Date.now(),
        subscriptionType: "deal.propertyChange",
        propertyName: "design_status",
        propertyValue: designStatus,
        objectId: Number(objectId),
      }];
      console.log(`[site-survey-readiness] Normalized workflow payload: deal ${objectId}, design_status ${designStatus || "(trusting workflow)"}`);
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
    console.warn("[site-survey-readiness] SITE_SURVEY_READINESS_TARGET_STATUS not set — all design_status changes will trigger check");
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

    // Acquire lock
    let reviewId: string;
    try {
      reviewId = await acquireReviewLock(dealId, "site-survey-readiness", "webhook");
    } catch (err) {
      if (err instanceof DuplicateReviewError) {
        duplicates.push(dealId);
        continue;
      }
      throw err;
    }

    // Run in background
    waitUntil(
      processSurveyReadiness(reviewId, dealId, event.eventId).catch(async (err) => {
        console.error(`[site-survey-readiness] Error for deal ${dealId}:`, err);
        await failReviewRun(reviewId, err instanceof Error ? err.message : "unknown").catch(() => {});
      }),
    );

    triggered.push(dealId);
  }

  return NextResponse.json({ status: "ok", triggered, skipped, duplicates });
}
