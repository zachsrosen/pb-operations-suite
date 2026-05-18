/**
 * GET /api/pe-crossref/queue
 *
 * Cross-deal aggregation of action tasks for the batch dashboard.
 * Supports filters: status, severity, pCode (comma-separated values).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status") ?? "OPEN";
  const severity = sp.get("severity");
  const pCode = sp.get("pCode");

  const where: {
    status: string;
    severity?: { in: string[] };
    pCode?: { in: string[] };
  } = { status };
  if (severity) where.severity = { in: severity.split(",") };
  if (pCode) where.pCode = { in: pCode.split(",") };

  const tasks = await prisma.peActionTask.findMany({
    where,
    orderBy: [{ severity: "asc" }, { dealId: "asc" }, { createdAt: "asc" }],
    take: 500,
  });

  // Roll up counts for stat tiles
  const [openCritical, openMajor, openConditional, openMonitoring, resolvedThisWeek] = await Promise.all([
    prisma.peActionTask.count({ where: { status: "OPEN", severity: "critical" } }),
    prisma.peActionTask.count({ where: { status: "OPEN", severity: "major" } }),
    prisma.peActionTask.count({ where: { status: "OPEN", severity: "conditional" } }),
    prisma.peActionTask.count({ where: { status: "OPEN", severity: "monitoring" } }),
    prisma.peActionTask.count({
      where: {
        OR: [{ status: "RESOLVED_AUTO" }, { status: "RESOLVED_MANUAL" }],
        resolvedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const dealsAffected = new Set(tasks.map((t) => t.dealId)).size;

  return NextResponse.json({
    tasks,
    stats: {
      openCritical,
      openMajor,
      openConditional,
      openMonitoring,
      resolvedThisWeek,
      dealsAffected,
    },
  });
}
