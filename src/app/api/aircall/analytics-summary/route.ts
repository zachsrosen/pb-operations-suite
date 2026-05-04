/**
 * GET /api/aircall/analytics-summary
 *
 * Returns the most recent imported per-user ring summary from
 * AircallAnalyticsSummary. Used by the dashboard's "Historical Snapshot"
 * section. Admin-only, behind the same feature flag as the rest.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-utils";
import { isFlagEnabled } from "../_filter";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isFlagEnabled()) {
    return NextResponse.json({ error: "Aircall dashboard is disabled" }, { status: 404 });
  }
  try {
    await requireRole("ADMIN", "OWNER", "EXECUTIVE");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Take the most recent import (latest periodEnd, then latest importedAt)
  const latest = await prisma.aircallAnalyticsSummary.findFirst({
    where: { provider: "aircall", source: "analytics_plus_csv" },
    orderBy: [{ periodEnd: "desc" }, { importedAt: "desc" }],
    select: { periodStart: true, periodEnd: true, importedAt: true, importedBy: true },
  });
  if (!latest) {
    return NextResponse.json({ snapshot: null });
  }

  const rows = await prisma.aircallAnalyticsSummary.findMany({
    where: {
      provider: "aircall",
      source: "analytics_plus_csv",
      periodStart: latest.periodStart,
      periodEnd: latest.periodEnd,
    },
    orderBy: { ringTotal: "desc" },
    select: {
      userAircallId: true,
      userName: true,
      ringTotal: true,
      ringPickedUp: true,
      ringNotPickedUp: true,
    },
  });

  return NextResponse.json({
    snapshot: {
      periodStart: latest.periodStart.toISOString(),
      periodEnd: latest.periodEnd.toISOString(),
      importedAt: latest.importedAt.toISOString(),
      importedBy: latest.importedBy,
      rows: rows.map((r) => ({
        ...r,
        answerRate: r.ringTotal > 0 ? r.ringPickedUp / r.ringTotal : 0,
      })),
    },
  });
}
