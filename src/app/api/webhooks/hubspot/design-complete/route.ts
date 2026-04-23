/**
 * HubSpot Deal Property Change Webhook — BOM Pipeline Trigger
 *
 * POST /api/webhooks/hubspot/design-complete
 *
 * Triggered by HubSpot workflows on a deal property change. Supports two
 * property triggers, configured by env var:
 *
 *   - dealstage changes → mapped via PIPELINE_STAGE_CONFIG
 *       Format: "stageId1:design_complete,stageId2:ready_to_build"
 *       Used by the sales/project pipelines that have explicit
 *       "Design Complete" / "Ready to Build" stages.
 *
 *   - design_status changes → mapped via DESIGN_STATUS_CONFIG
 *       Format: "Complete:design_complete,Approved:design_complete"
 *       Used by the service pipeline (and any other) where the design
 *       lifecycle is tracked on the design_status custom property
 *       rather than via a dedicated stage.
 *
 * Validates the HubSpot webhook signature, deduplicates against in-flight
 * pipeline runs, then runs the full BOM pipeline in the background via
 * waitUntil() (respond 200 immediately so HubSpot doesn't retry).
 *
 * Security: HubSpot signature validation inside the route handler (not middleware).
 * The exact path is in PUBLIC_API_ROUTES to skip session-based auth.
 *
 * Dedupe: A partial unique index on BomPipelineRun(dealId) WHERE status='RUNNING'
 * ensures at most one concurrent run per deal. Stale locks (>10 min) are
 * auto-recovered via the shared acquirePipelineLock() in bom-pipeline-lock.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma, logActivity } from "@/lib/db";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { getDealProperties } from "@/lib/hubspot";
import { runDesignCompletePipeline } from "@/lib/bom-pipeline";
import { acquirePipelineLock, DuplicateRunError } from "@/lib/bom-pipeline-lock";
import { PIPELINE_ACTOR } from "@/lib/actor-context";
import {
  bomDesignCompleteRequested,
  inngest,
  isInngestBomEnabled,
} from "@/lib/inngest-client";
import type { BomPipelineTrigger } from "@/generated/prisma/enums";

export const runtime = "nodejs";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Valid trigger type labels → Prisma enum values. */
const VALID_TRIGGER_TYPES: Record<string, BomPipelineTrigger> = {
  design_complete: "WEBHOOK_DESIGN_COMPLETE",
  ready_to_build: "WEBHOOK_READY_TO_BUILD",
} as const;

/**
 * Parse PIPELINE_STAGE_CONFIG into a Map<stageId, BomPipelineTrigger>.
 *
 * Format: "stageId1:design_complete,stageId2:ready_to_build"
 *
 * Fallback (two levels):
 * 1. If PIPELINE_STAGE_CONFIG is unset/empty → use DESIGN_COMPLETE_TARGET_STAGES
 *    with all entries mapped to WEBHOOK_DESIGN_COMPLETE (backward compat).
 * 2. If PIPELINE_STAGE_CONFIG is set but ALL entries are malformed (parsed map
 *    is empty) → also fall back to DESIGN_COMPLETE_TARGET_STAGES with a
 *    high-signal warning.
 */
function getStageConfig(): Map<string, BomPipelineTrigger> {
  const rawConfig = (process.env.PIPELINE_STAGE_CONFIG ?? "").trim();

  if (rawConfig) {
    const map = new Map<string, BomPipelineTrigger>();
    const entries = rawConfig.split(",").map((s) => s.trim()).filter(Boolean);

    for (const entry of entries) {
      const parts = entry.split(":");
      if (parts.length !== 2) {
        console.warn(`[design-complete] Malformed PIPELINE_STAGE_CONFIG entry (skipping): "${entry}"`);
        continue;
      }
      const [stageId, typeLabel] = parts.map((p) => p.trim());
      const trigger = VALID_TRIGGER_TYPES[typeLabel];
      if (!trigger) {
        console.warn(`[design-complete] Unknown trigger type in PIPELINE_STAGE_CONFIG (skipping): "${typeLabel}" in entry "${entry}"`);
        continue;
      }
      map.set(stageId, trigger);
    }

    if (map.size > 0) {
      console.log(`[design-complete] Stage config resolved: ${[...map.entries()].map(([k, v]) => `${k}→${v}`).join(", ")}`);
      return map;
    }

    // All entries were malformed — fall through to legacy fallback with error
    console.error(`[design-complete] PIPELINE_STAGE_CONFIG is set but all entries are malformed — falling back to DESIGN_COMPLETE_TARGET_STAGES`);
  }

  // Legacy fallback: DESIGN_COMPLETE_TARGET_STAGES → all mapped to WEBHOOK_DESIGN_COMPLETE
  const legacyStages = (process.env.DESIGN_COMPLETE_TARGET_STAGES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (legacyStages.length > 0 && !rawConfig) {
    console.warn(`[design-complete] Using deprecated DESIGN_COMPLETE_TARGET_STAGES — migrate to PIPELINE_STAGE_CONFIG`);
  }

  const map = new Map<string, BomPipelineTrigger>();
  for (const stageId of legacyStages) {
    map.set(stageId, "WEBHOOK_DESIGN_COMPLETE");
  }
  return map;
}

/**
 * Parse DESIGN_STATUS_CONFIG into a Map<statusValue, BomPipelineTrigger>.
 *
 * Format: "Complete:design_complete,Approved:design_complete"
 * (case-insensitive on the status-value side; values are lowercased internally)
 *
 * Used to fire the BOM pipeline when a HubSpot workflow flips the
 * `design_status` property to one of these values — primarily for the service
 * pipeline, which doesn't have a dedicated "Design Complete" stage.
 *
 * Returns an empty map if the env var is unset/empty (the design_status
 * trigger is opt-in and silently disabled when not configured).
 */
function getDesignStatusConfig(): Map<string, BomPipelineTrigger> {
  const rawConfig = (process.env.DESIGN_STATUS_CONFIG ?? "").trim();
  const map = new Map<string, BomPipelineTrigger>();
  if (!rawConfig) return map;

  const entries = rawConfig.split(",").map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const parts = entry.split(":");
    if (parts.length !== 2) {
      console.warn(`[design-complete] Malformed DESIGN_STATUS_CONFIG entry (skipping): "${entry}"`);
      continue;
    }
    const [statusValue, typeLabel] = parts.map((p) => p.trim());
    const trigger = VALID_TRIGGER_TYPES[typeLabel];
    if (!trigger) {
      console.warn(`[design-complete] Unknown trigger type in DESIGN_STATUS_CONFIG (skipping): "${typeLabel}" in entry "${entry}"`);
      continue;
    }
    map.set(statusValue.toLowerCase(), trigger);
  }

  if (map.size > 0) {
    console.log(`[design-complete] Design status config resolved: ${[...map.entries()].map(([k, v]) => `${k}→${v}`).join(", ")}`);
  } else if (rawConfig) {
    console.error(`[design-complete] DESIGN_STATUS_CONFIG is set but all entries are malformed`);
  }
  return map;
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

  // ── 3. Authenticate: HubSpot v3 signature OR bearer token (for Workflows / Tray) ──
  const bearerToken = req.headers.get("authorization")?.replace("Bearer ", "");
  const pipelineSecret = process.env.PIPELINE_WEBHOOK_SECRET || process.env.API_SECRET_TOKEN;
  const isBearerAuth = bearerToken && pipelineSecret && bearerToken === pipelineSecret;

  if (!isBearerAuth) {
    // Fall back to HubSpot v3 HMAC signature validation
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
      console.warn(`[design-complete] Auth failed: ${validation.error} (no valid bearer token either)`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // ── 4. Parse payload ──
  // Supports two formats:
  //   a) App-scope: [{eventId, subscriptionType, propertyName, propertyValue, objectId}]
  //   b) Workflow/Tray: {objectId, propertyName, propertyValue} OR
  //      {objectId, properties:{dealstage|design_status:"..."}} OR
  //      {dealId, stage}
  let events: HubSpotWebhookEvent[];
  try {
    const parsed = JSON.parse(rawBody);

    if (Array.isArray(parsed)) {
      events = parsed;
    } else if (parsed && typeof parsed === "object") {
      const objectId = parsed.objectId ?? parsed.hs_object_id ?? parsed.dealId ?? parsed.vid;

      if (!objectId) {
        return NextResponse.json({ error: "Missing objectId or dealId" }, { status: 400 });
      }

      // Decide which property the workflow is asking about.
      // Honor an explicit propertyName first; otherwise infer from the
      // properties block (dealstage takes precedence for backward compat).
      let propertyName: string;
      let propertyValue: string | undefined;

      if (typeof parsed.propertyName === "string" && parsed.propertyName.length > 0) {
        propertyName = parsed.propertyName;
        propertyValue =
          parsed.propertyValue ??
          parsed.properties?.[propertyName] ??
          undefined;
      } else if (parsed.properties?.design_status !== undefined) {
        propertyName = "design_status";
        propertyValue = parsed.properties.design_status;
      } else {
        propertyName = "dealstage";
        propertyValue =
          parsed.propertyValue ??
          parsed.properties?.dealstage ??
          parsed.stage ??
          parsed.dealstage;
      }

      events = [{
        eventId: Date.now(),
        subscriptionType: "deal.propertyChange",
        propertyName,
        propertyValue: propertyValue || undefined,
        objectId: Number(objectId),
      }];
      console.log(`[design-complete] Normalized workflow payload: deal ${objectId}, ${propertyName}=${propertyValue || "(will fetch)"}`);
    } else {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── 5. Process each event ──
  const triggered: string[] = [];
  const stageConfig = getStageConfig();
  const designStatusConfig = getDesignStatusConfig();

  // Guard: if neither config has anything, skip all events (safe default)
  if (stageConfig.size === 0 && designStatusConfig.size === 0) {
    console.warn("[design-complete] No stage or design-status config found — skipping all events");
    return NextResponse.json({ status: "ok", triggered: [] });
  }

  for (const event of events) {
    // Guard: only deal property changes on a known property
    if (event.subscriptionType !== "deal.propertyChange") continue;
    // Narrow to a literal union so downstream string interpolation can't be
    // tainted with arbitrary user input from event.propertyName (CodeQL
    // js/tainted-format-string).
    let propName: "dealstage" | "design_status";
    if (event.propertyName === "design_status") {
      propName = "design_status";
    } else if (event.propertyName === "dealstage") {
      propName = "dealstage";
    } else {
      continue;
    }

    // Skip property changes for which we have no config
    if (propName === "dealstage" && stageConfig.size === 0) continue;
    if (propName === "design_status" && designStatusConfig.size === 0) continue;

    const dealId = String(event.objectId);
    const isStatusEvent = propName === "design_status";

    // ── 5a. Determine trigger from webhook's reported value ──
    // For workflow/Tray payloads without a value, fetch live from HubSpot.
    let webhookValue = event.propertyValue ?? "";

    if (!webhookValue) {
      try {
        const dealProps = await getDealProperties(dealId, [propName]);
        webhookValue = dealProps?.[propName] ?? "";
        if (webhookValue) {
          console.log(`[design-complete] Deal ${dealId}: no ${propName} in payload, fetched live value ${webhookValue}`);
        }
      } catch (err) {
        console.warn(`[design-complete] Deal ${dealId}: no ${propName} in payload and failed to fetch — skipping`, err);
        continue;
      }
    }

    // Look up trigger from the right config map (case-insensitive for design_status)
    const lookupKey = isStatusEvent ? webhookValue.toLowerCase() : webhookValue;
    const activeConfig = isStatusEvent ? designStatusConfig : stageConfig;

    if (!webhookValue || !activeConfig.has(lookupKey)) {
      if (webhookValue) {
        console.log(`[design-complete] Deal ${dealId} ${propName}=${webhookValue} not in config — skipping`);
      } else {
        console.warn(`[design-complete] Deal ${dealId} has no ${propName} — skipping`);
      }
      continue;
    }

    const trigger: BomPipelineTrigger = activeConfig.get(lookupKey)!;
    // Preserve the variable name webhookStage downstream — used in logs/metadata
    const webhookStage = webhookValue;

    // Log if live value differs (informational only)
    if (event.propertyValue) {
      try {
        const dealProps = await getDealProperties(dealId, [propName]);
        const actualValue = dealProps?.[propName] ?? null;
        if (actualValue && actualValue !== webhookValue) {
          console.log(`[design-complete] Deal ${dealId}: webhook ${propName}=${webhookValue} but live value is ${actualValue} (race expected, using webhook value)`);
        }
      } catch (err) {
        console.warn(`[design-complete] Could not fetch live ${propName} for deal ${dealId} — proceeding with webhook value`, err);
      }
    }

    // ── 5b. Skip if pipeline already succeeded/partial for this deal+trigger (prevent re-runs) ──
    const completedRun = await prisma.bomPipelineRun.findFirst({
      where: { dealId, trigger, status: { in: ["SUCCEEDED", "PARTIAL"] } },
      select: { id: true, status: true },
    });
    if (completedRun) {
      console.log(`[design-complete] Skipping deal ${dealId} — already has a ${completedRun.status} run for trigger ${trigger} (run ${completedRun.id})`);
      triggered.push(`${dealId}:already_completed`);
      continue;
    }

    // ── 6. Dedupe: stale lock recovery + insert RUNNING row ──
    let runId: string;
    try {
      runId = await acquirePipelineLock(dealId, trigger);
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
          trigger,
          webhookStage,
        },
        requestPath: "/api/webhooks/hubspot/design-complete",
        requestMethod: "POST",
      });
    } catch (logErr) {
      console.error(`[design-complete] Failed to log pipeline start for deal ${dealId}:`, logErr);
    }

    // ── 8. Run pipeline ──
    // When INNGEST_BOM_ENABLED=true, delegate to Inngest for concurrency
    // control, retries, and run visibility. Otherwise, fall back to the
    // original waitUntil() path.
    if (isInngestBomEnabled()) {
      try {
        await inngest.send(
          bomDesignCompleteRequested.create({ runId, dealId, trigger }),
        );
        triggered.push(`${dealId}:inngest`);
      } catch (err) {
        // Inngest send failed — fall back to in-process execution so we
        // never lose a pipeline run due to transport issues.
        console.error("[design-complete] inngest.send failed, falling back to waitUntil for deal", dealId, err);
        waitUntil(
          runDesignCompletePipeline(runId, dealId, trigger).catch((pipelineErr) => {
            console.error("[design-complete] Unhandled pipeline error for deal", dealId, pipelineErr);
          }),
        );
        triggered.push(`${dealId}:started_fallback`);
      }
    } else {
      waitUntil(
        runDesignCompletePipeline(runId, dealId, trigger).catch((err) => {
          console.error("[design-complete] Unhandled pipeline error for deal", dealId, err);
        }),
      );
      triggered.push(`${dealId}:started`);
    }
  }

  return NextResponse.json({ status: "ok", triggered });
}
