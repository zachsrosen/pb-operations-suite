/**
 * GET /api/on-call/summary
 *
 * Aggregated on-call call-log stats for the Call Analytics dashboard.
 * Reads OnCallCallLog rows in the requested window and returns:
 *   - top-line totals (calls, resolved remotely, dispatched, escalated)
 *   - issue-type breakdown
 *   - per-electrician breakdown
 *   - recent calls list (drill-down)
 *
 * Query params:
 *   from   ISO date — defaults to 30 days ago
 *   to     ISO date — defaults to now
 *   poolId optional — filter to a single pool
 *
 * Visibility: same as the call analytics dashboard — ADMIN/OWNER/EXECUTIVE.
 * Behind the same AIRCALL_DASHBOARD_ENABLED feature flag (the data exists
 * regardless, but we want a single kill switch for the whole call dashboard).
 */

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-utils";
import { isFlagEnabled } from "../../aircall/_filter";

export const dynamic = "force-dynamic";

const MAX_RANGE_DAYS = 365;

interface Row {
  id: string;
  callReceivedAt: Date;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  issueType: string;
  issueTypeOther: string | null;
  safetyRisk: boolean;
  resolvedRemotely: boolean;
  dispatched: boolean;
  hoursWorked: { toNumber: () => number } | number | null;
  escalatedTo: string | null;
  reporterCrewMember: { id: string; name: string };
  pool: { id: string; name: string };
}

export async function GET(req: NextRequest) {
  if (!isFlagEnabled()) {
    return NextResponse.json({ error: "Call dashboard is disabled" }, { status: 404 });
  }
  try {
    await requireRole("ADMIN", "OWNER", "EXECUTIVE");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const fromStr = sp.get("from");
  const toStr = sp.get("to");
  const poolId = sp.get("poolId") ?? undefined;
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = fromStr ? new Date(fromStr) : defaultFrom;
  const to = toStr ? new Date(toStr) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid from/to" }, { status: 400 });
  }
  if (from >= to) return NextResponse.json({ error: "from must be before to" }, { status: 400 });
  if ((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24) > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `Range exceeds ${MAX_RANGE_DAYS} days` }, { status: 400 });
  }

  const logs = await prisma.onCallCallLog.findMany({
    where: {
      ...(poolId ? { poolId } : {}),
      callReceivedAt: { gte: from, lt: to },
    },
    include: {
      reporterCrewMember: { select: { id: true, name: true } },
      pool: { select: { id: true, name: true } },
    },
    orderBy: { callReceivedAt: "desc" },
  });

  const rows = logs as unknown as Row[];

  // Top-line totals
  const total = rows.length;
  const resolvedRemotely = rows.filter((r) => r.resolvedRemotely).length;
  const dispatched = rows.filter((r) => r.dispatched).length;
  const escalated = rows.filter((r) => r.escalatedTo && r.escalatedTo.trim().length > 0).length;
  const safetyRisks = rows.filter((r) => r.safetyRisk).length;
  const totalHoursWorked = rows.reduce((sum, r) => {
    const h = r.hoursWorked;
    if (h == null) return sum;
    const n = typeof h === "number" ? h : h.toNumber();
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  // Issue type breakdown
  const byIssueMap = new Map<string, number>();
  for (const r of rows) {
    const key = r.issueType === "other" && r.issueTypeOther ? `other: ${r.issueTypeOther}` : r.issueType;
    byIssueMap.set(key, (byIssueMap.get(key) ?? 0) + 1);
  }
  const byIssue = Array.from(byIssueMap.entries())
    .map(([issueType, count]) => ({ issueType, count }))
    .sort((a, b) => b.count - a.count);

  // Per-electrician breakdown
  const byElecMap = new Map<
    string,
    { id: string; name: string; total: number; resolvedRemotely: number; dispatched: number; hoursWorked: number; lastCall: Date }
  >();
  for (const r of rows) {
    const key = r.reporterCrewMember.id;
    const cur =
      byElecMap.get(key) ??
      ({
        id: key,
        name: r.reporterCrewMember.name,
        total: 0,
        resolvedRemotely: 0,
        dispatched: 0,
        hoursWorked: 0,
        lastCall: r.callReceivedAt,
      } satisfies ReturnType<typeof byElecMap.get>);
    cur.total += 1;
    if (r.resolvedRemotely) cur.resolvedRemotely += 1;
    if (r.dispatched) cur.dispatched += 1;
    const h = r.hoursWorked;
    if (h != null) {
      const n = typeof h === "number" ? h : h.toNumber();
      if (Number.isFinite(n)) cur.hoursWorked += n;
    }
    if (r.callReceivedAt > cur.lastCall) cur.lastCall = r.callReceivedAt;
    byElecMap.set(key, cur);
  }
  const byElectrician = Array.from(byElecMap.values())
    .map((v) => ({
      ...v,
      lastCall: v.lastCall.toISOString(),
      remoteResolutionRate: v.total > 0 ? v.resolvedRemotely / v.total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Recent calls (cap at 25 for drill-down section)
  const recent = rows.slice(0, 25).map((r) => ({
    id: r.id,
    callReceivedAt: r.callReceivedAt.toISOString(),
    customerName: r.customerName,
    customerAddress: r.customerAddress,
    issueType: r.issueType === "other" && r.issueTypeOther ? `other: ${r.issueTypeOther}` : r.issueType,
    safetyRisk: r.safetyRisk,
    resolvedRemotely: r.resolvedRemotely,
    dispatched: r.dispatched,
    escalatedTo: r.escalatedTo,
    electrician: r.reporterCrewMember.name,
    poolName: r.pool.name,
  }));

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      total,
      resolvedRemotely,
      dispatched,
      escalated,
      safetyRisks,
      totalHoursWorked: Math.round(totalHoursWorked * 100) / 100,
      remoteResolutionRate: total > 0 ? resolvedRemotely / total : 0,
      escalationRate: total > 0 ? escalated / total : 0,
    },
    byIssue,
    byElectrician,
    recent,
  });
}
