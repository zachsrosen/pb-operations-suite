/**
 * HubSpot Design-Complete Webhook
 *
 * POST /api/webhooks/hubspot/design-complete
 *
 * Triggered by a HubSpot workflow when a deal leaves "Design & Engineering".
 * Validates the HubSpot webhook signature, deduplicates against in-flight
 * pipeline runs, then runs the full BOM pipeline in the background via
 * waitUntil() (respond 200 immediately so HubSpot doesn't retry).
 *
 * Security: HubSpot signature validation inside the route handler (not middleware).
 * The exact path is in PUBLIC_API_ROUTES to skip session-based auth.
 *
 * Dedupe: A partial unique index on BomPipelineRun(dealId) WHERE status='RUNNING'
 * ensures at most one concurrent run per deal. Stale locks (>10 min) are
 * auto-recovered before inserting a new RUNNING row.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma, logActivity } from "@/lib/db";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { runDesignCompletePipeline } from "@/lib/bom-pipeline";
import { PIPELINE_ACTOR } from "@/lib/actor-context";

export const runtime = "nodejs";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Stale lock threshold: 10 minutes (pipeline maxDuration is 300s). */
const STALE_LOCK_THRESHOLD_MS = 10 * 60 * 1000;

/** Allowed target stage IDs (read at request time so env changes take effect). */
function getAllowedTargetStages(): string[] {
  return (process.env.DESIGN_COMPLETE_TARGET_STAGES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

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
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // ── 1. Feature flag ──
  if (process.env.DESIGN_COMPLETE_AUTO_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" }, { status: 200 });
  }

  // ── 2. Read raw body (needed for signature validation) ──
  const rawBody = await req.text();

  // ── 3. Validate HubSpot signature ──
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
    console.warn(`[design-complete] Signature validation failed: ${validation.error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 4. Parse payload ──
  let events: HubSpotWebhookEvent[];
  try {
    events = JSON.parse(rawBody) as HubSpotWebhookEvent[];
    if (!Array.isArray(events)) events = [events];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── 5. Process each event ──
  const triggered: string[] = [];

  for (const event of events) {
    // Guard: only deal property changes on dealstage
    if (event.subscriptionType !== "deal.propertyChange") continue;
    if (event.propertyName !== "dealstage") continue;

    // Guard: check target stage allowlist (if configured)
    const allowedStages = getAllowedTargetStages();
    if (allowedStages.length > 0) {
      if (!event.propertyValue || !allowedStages.includes(event.propertyValue)) continue;
    }

    const dealId = String(event.objectId);

    // ── 6. Dedupe: stale lock recovery + insert RUNNING row ──
    let runId: string;
    try {
      runId = await acquirePipelineLock(dealId);
    } catch (e) {
      if (e instanceof DuplicateRunError) {
        console.log(`[design-complete] Skipping duplicate run for deal ${dealId}`);
        triggered.push(`${dealId}:skipped`);
        continue;
      }
      throw e;
    }

    // ── 7. Log pipeline start (best-effort — must not block waitUntil) ──
    try {
      await logActivity({
        type: "BOM_PIPELINE_STARTED",
        description: `BOM pipeline triggered for deal ${dealId}`,
        userEmail: PIPELINE_ACTOR.email,
        userName: PIPELINE_ACTOR.name,
        entityType: "bom",
        entityId: dealId,
        entityName: "pipeline",
        metadata: {
          event: "bom_pipeline_started",
          dealId,
          eventId: event.eventId,
          trigger: "WEBHOOK_DESIGN_COMPLETE",
        },
        requestPath: "/api/webhooks/hubspot/design-complete",
        requestMethod: "POST",
      });
    } catch (logErr) {
      console.error(`[design-complete] Failed to log pipeline start for deal ${dealId}:`, logErr);
    }

    // ── 8. Run pipeline in background ──
    waitUntil(
      runDesignCompletePipeline(runId, dealId).catch((err) => {
        console.error(`[design-complete] Unhandled pipeline error for deal ${dealId}:`, err);
      }),
    );

    triggered.push(`${dealId}:started`);
  }

  return NextResponse.json({ status: "ok", triggered });
}

// ---------------------------------------------------------------------------
// Dedupe lock
// ---------------------------------------------------------------------------

class DuplicateRunError extends Error {
  constructor(dealId: string) {
    super(`Pipeline already running for deal ${dealId}`);
    this.name = "DuplicateRunError";
  }
}

/**
 * Acquire a pipeline lock for a deal.
 *
 * 1. Check for stale RUNNING rows (>10 min old) and flip them to FAILED.
 * 2. Insert a new RUNNING row — if the partial unique index rejects it,
 *    another run is genuinely in-flight → throw DuplicateRunError.
 *
 * Uses a transaction to make stale recovery + insert atomic.
 */
async function acquirePipelineLock(dealId: string): Promise<string> {
  if (!prisma) throw new Error("Database not configured");

  return prisma.$transaction(async (tx) => {
    // 1. Recover stale locks
    const staleThreshold = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS);
    await tx.bomPipelineRun.updateMany({
      where: {
        dealId,
        status: "RUNNING",
        createdAt: { lt: staleThreshold },
      },
      data: {
        status: "FAILED",
        errorMessage: "Timed out (stale lock recovery)",
      },
    });

    // 2. Insert new RUNNING row
    try {
      const run = await tx.bomPipelineRun.create({
        data: {
          dealId,
          dealName: "",
          trigger: "WEBHOOK_DESIGN_COMPLETE",
          status: "RUNNING",
        },
      });
      return run.id;
    } catch (e: unknown) {
      // Prisma unique constraint violation → P2002
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        throw new DuplicateRunError(dealId);
      }
      throw e;
    }
  });
}
