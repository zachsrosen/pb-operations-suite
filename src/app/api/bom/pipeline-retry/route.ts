/**
 * BOM Pipeline Manual Retry
 *
 * POST /api/bom/pipeline-retry
 *   Re-triggers the BOM pipeline for a specific deal. Intended for retrying
 *   failed pipeline runs (e.g. transient Anthropic API outages).
 *
 * Body: { dealId: string }
 *
 * Auth: ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER roles only.
 *
 * Creates a new BomPipelineRun with trigger=MANUAL_RETRY and runs the
 * full pipeline in the background via waitUntil().
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requireApiAuth } from "@/lib/api-auth";
import { logActivity } from "@/lib/db";
import { runDesignCompletePipeline } from "@/lib/bom-pipeline";
import { acquirePipelineLock, DuplicateRunError } from "@/lib/bom-pipeline-lock";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
]);

export async function POST(req: NextRequest) {
  // ── Auth ──
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, name, role } = authResult;

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // ── Body ──
  let body: { dealId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dealId = body.dealId?.trim();
  if (!dealId) {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }

  // ── Acquire lock ──
  let runId: string;
  try {
    runId = await acquirePipelineLock(dealId, "MANUAL");
  } catch (e) {
    if (e instanceof DuplicateRunError) {
      return NextResponse.json(
        { error: "Pipeline already running for this deal" },
        { status: 409 },
      );
    }
    throw e;
  }

  // ── Log ──
  await logActivity({
    type: "BOM_PIPELINE_STARTED",
    description: `BOM pipeline manually retried for deal ${dealId} by ${email}`,
    userEmail: email,
    userName: name,
    entityType: "bom",
    entityId: dealId,
    entityName: "pipeline-retry",
    metadata: { event: "bom_pipeline_manual_retry", dealId, triggeredBy: email },
    requestPath: "/api/bom/pipeline-retry",
    requestMethod: "POST",
  }).catch((err) => {
    console.error("[pipeline-retry] Failed to log activity:", err);
  });

  // ── Run in background ──
  waitUntil(
    runDesignCompletePipeline(runId, dealId).catch((err) => {
      console.error(`[pipeline-retry] Unhandled pipeline error for deal ${dealId}:`, err);
    }),
  );

  return NextResponse.json({ status: "started", runId, dealId });
}
