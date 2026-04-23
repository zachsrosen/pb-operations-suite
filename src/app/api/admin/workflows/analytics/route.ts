/**
 * GET /api/admin/workflows/analytics?days=7
 *
 * Aggregate stats across all admin workflows for the requested window.
 * Returns:
 *  - Overall totals (runs, success rate, avg + p50 + p95 duration)
 *  - Per-workflow breakdown (top 20 by volume)
 *  - Daily run counts (by status)
 *
 * ADMIN only.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx] ?? null;
}

export async function GET(request: NextRequest) {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user?.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const days = Math.max(1, Math.min(90, parseInt(new URL(request.url).searchParams.get("days") ?? "7", 10) || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const runs = await prisma.adminWorkflowRun.findMany({
    where: { startedAt: { gte: since } },
    select: {
      workflowId: true,
      status: true,
      durationMs: true,
      startedAt: true,
      workflow: { select: { name: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  // Totals
  const total = runs.length;
  const succeeded = runs.filter((r) => r.status === "SUCCEEDED").length;
  const failed = runs.filter((r) => r.status === "FAILED").length;
  const running = runs.filter((r) => r.status === "RUNNING").length;
  const successRate = total > 0 ? succeeded / total : 0;

  const durations = runs
    .map((r) => r.durationMs)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);
  const avg = durations.length > 0
    ? durations.reduce((s, d) => s + d, 0) / durations.length
    : null;
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);

  // Per-workflow breakdown
  const byWorkflow: Record<string, {
    workflowId: string;
    name: string;
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    avgDurationMs: number | null;
  }> = {};
  for (const run of runs) {
    const key = run.workflowId;
    if (!byWorkflow[key]) {
      byWorkflow[key] = {
        workflowId: run.workflowId,
        name: run.workflow.name,
        total: 0,
        succeeded: 0,
        failed: 0,
        running: 0,
        avgDurationMs: null,
      };
    }
    byWorkflow[key].total++;
    if (run.status === "SUCCEEDED") byWorkflow[key].succeeded++;
    if (run.status === "FAILED") byWorkflow[key].failed++;
    if (run.status === "RUNNING") byWorkflow[key].running++;
  }
  for (const wf of Object.values(byWorkflow)) {
    const wfDurations = runs
      .filter((r) => r.workflowId === wf.workflowId && r.durationMs != null)
      .map((r) => r.durationMs as number);
    wf.avgDurationMs = wfDurations.length > 0
      ? wfDurations.reduce((s, d) => s + d, 0) / wfDurations.length
      : null;
  }
  const topWorkflows = Object.values(byWorkflow)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  // Daily buckets
  const daily: Record<string, { day: string; succeeded: number; failed: number; running: number; total: number }> = {};
  for (const run of runs) {
    const day = run.startedAt.toISOString().slice(0, 10);
    if (!daily[day]) daily[day] = { day, succeeded: 0, failed: 0, running: 0, total: 0 };
    daily[day].total++;
    if (run.status === "SUCCEEDED") daily[day].succeeded++;
    if (run.status === "FAILED") daily[day].failed++;
    if (run.status === "RUNNING") daily[day].running++;
  }
  const dailySeries = Object.values(daily).sort((a, b) => a.day.localeCompare(b.day));

  return NextResponse.json({
    window: { days, since: since.toISOString() },
    totals: {
      total,
      succeeded,
      failed,
      running,
      successRate,
      avgDurationMs: avg,
      p50DurationMs: p50,
      p95DurationMs: p95,
    },
    topWorkflows,
    dailySeries,
  });
}
