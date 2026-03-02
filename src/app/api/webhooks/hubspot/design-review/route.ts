/**
 * HubSpot Deal Stage Change Webhook — Design Review Gate
 *
 * POST /api/webhooks/hubspot/design-review
 *
 * Triggered by HubSpot workflow when a deal enters a design-review gate stage.
 * Validates the HubSpot webhook signature, then runs all design-review checks
 * in the background via waitUntil() (respond 200 immediately so HubSpot
 * doesn't retry).
 *
 * Uses the review lock system (review-lock.ts) for deduplication.
 * Calls runChecks() directly — no HTTP self-call.
 *
 * Security: HubSpot signature validation inside the route handler (not
 * middleware). The exact path is in PUBLIC_API_ROUTES to skip session-based auth.
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
// Deal properties to fetch (same set as POST /api/reviews/run)
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
];

// ---------------------------------------------------------------------------
// Stage gate — only run on target stage(s)
// ---------------------------------------------------------------------------

/**
 * Parse DESIGN_REVIEW_TARGET_STAGES env var into a Set of stage IDs.
 * If unset or empty, returns null (all stages pass — for dev/testing).
 *
 * Format: comma-separated HubSpot stage IDs
 * Example: "qualifiedtobuy,presentationscheduled"
 */
function getTargetStages(): Set<string> | null {
  const raw = (process.env.DESIGN_REVIEW_TARGET_STAGES ?? "").trim();
  if (!raw) return null;
  const stages = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return stages.size > 0 ? stages : null;
}

// ---------------------------------------------------------------------------
// Background worker
// ---------------------------------------------------------------------------

async function processDesignReview(reviewId: string, dealId: string, eventId: number) {
  const start = Date.now();

  // 1. Fetch deal properties from HubSpot
  const { hubspotClient } = await import("@/lib/hubspot");
  const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, DEAL_PROPERTIES);
  const properties = deal.properties;

  await touchReviewRun(reviewId);

  // 2. Run checks directly (pure function, no HTTP hop)
  const result = await runChecks("design-review", { dealId, properties });

  // 3. Extract projectId from deal name
  const projectIdMatch = properties.dealname?.match(/PROJ-\d+/);
  const projectId = projectIdMatch?.[0] ?? null;

  // 4. Complete the review run
  await completeReviewRun(reviewId, {
    findings: result.findings,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    passed: result.passed,
    durationMs: Date.now() - start,
    projectId,
  });

  // 5. Log activity
  await logActivity({
    type: "DESIGN_REVIEW_COMPLETED",
    description: `Design review ${result.passed ? "passed" : "failed"} for deal ${dealId} (${result.errorCount} errors, ${result.warningCount} warnings)`,
    userEmail: PIPELINE_ACTOR.email,
    userName: PIPELINE_ACTOR.name,
    entityType: "review",
    entityId: dealId,
    entityName: projectId ?? dealId,
    metadata: {
      event: "design_review_completed",
      dealId,
      eventId,
      skill: "design-review",
      passed: result.passed,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      durationMs: Date.now() - start,
    },
    requestPath: "/api/webhooks/hubspot/design-review",
    requestMethod: "POST",
  });

  // TODO: Create HubSpot task if review failed
  // TODO: Send Gmail notification to design team

  console.log(
    `[design-review] Deal ${dealId}: ${result.passed ? "PASSED" : "FAILED"} (${result.errorCount}E/${result.warningCount}W) in ${Date.now() - start}ms`
  );
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // -- 1. Read raw body (needed for signature validation) --
  const rawBody = await req.text();

  // -- 2. Validate HubSpot signature --
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
    console.warn(`[design-review] Signature validation failed: ${validation.error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // -- 3. Parse payload --
  let events: HubSpotWebhookEvent[];
  try {
    events = JSON.parse(rawBody) as HubSpotWebhookEvent[];
    if (!Array.isArray(events)) events = [events];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // -- 4. Process each event --
  const targetStages = getTargetStages();
  const triggered: string[] = [];
  const skipped: string[] = [];
  const duplicates: string[] = [];

  if (!targetStages) {
    console.warn("[design-review] DESIGN_REVIEW_TARGET_STAGES not set — all dealstage changes will trigger review");
  }

  for (const event of events) {
    // Only handle deal property changes on dealstage
    if (event.subscriptionType !== "deal.propertyChange") continue;
    if (event.propertyName !== "dealstage") continue;

    // Gate: only run when deal enters a target stage
    if (targetStages && event.propertyValue && !targetStages.has(event.propertyValue)) {
      skipped.push(String(event.objectId));
      continue;
    }

    const dealId = String(event.objectId);

    // Acquire lock — skip duplicates gracefully
    let reviewId: string;
    try {
      reviewId = await acquireReviewLock(dealId, "design-review", "webhook");
    } catch (err) {
      if (err instanceof DuplicateReviewError) {
        duplicates.push(dealId);
        continue;
      }
      throw err;
    }

    // Run design review in background
    waitUntil(
      processDesignReview(reviewId, dealId, event.eventId).catch(async (err) => {
        console.error(
          `[design-review] Unhandled error for deal ${dealId}:`,
          err
        );
        await failReviewRun(reviewId, err instanceof Error ? err.message : "unknown").catch(() => {});
      })
    );

    triggered.push(dealId);
  }

  return NextResponse.json({ status: "ok", triggered, skipped, duplicates });
}
