/**
 * GET /api/cron/admin-workflow-cleanup
 *
 * Runs every 15 minutes. Finds AdminWorkflowRun rows that have been
 * RUNNING for more than 15 minutes and marks them FAILED with a clear
 * reason. Prevents the DB from accumulating orphaned runs when:
 *   - An Inngest function was unregistered when the event fired
 *   - The worker crashed mid-execution before the mark-succeeded step
 *   - Inngest had an outage and events were dropped
 *
 * Auth: CRON_SECRET bearer token (standard pattern).
 * Listed in PUBLIC_API_ROUTES + has its own in-route auth.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const STALE_THRESHOLD_MINUTES = 15;

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

  // Find stale runs
  const stale = await prisma.adminWorkflowRun.findMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: cutoff },
    },
    select: { id: true, workflowId: true, startedAt: true },
  });

  if (stale.length === 0) {
    return NextResponse.json({
      status: "ok",
      cleaned: 0,
      cutoff: cutoff.toISOString(),
    });
  }

  // Mark them all FAILED in one query
  const result = await prisma.adminWorkflowRun.updateMany({
    where: {
      id: { in: stale.map((r) => r.id) },
      status: "RUNNING", // double-check to avoid races
    },
    data: {
      status: "FAILED",
      errorMessage: `Auto-failed by cleanup cron: still RUNNING after ${STALE_THRESHOLD_MINUTES}m. Likely causes: Inngest function unregistered, worker crash, or Inngest outage.`,
      completedAt: new Date(),
    },
  });

  console.log(
    "[admin-workflow-cleanup] Marked %d stale run(s) as FAILED (cutoff: %s)",
    result.count,
    cutoff.toISOString(),
  );

  return NextResponse.json({
    status: "ok",
    cleaned: result.count,
    cutoff: cutoff.toISOString(),
    staleIds: stale.map((r) => r.id),
  });
}
