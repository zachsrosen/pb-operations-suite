/**
 * Admin endpoint: per-endpoint Zuper API call stats for today + the last
 * N days. Read by ops to verify our outbound Zuper traffic without
 * needing Zuper to email us a number.
 *
 * GET /api/admin/zuper-stats?days=7
 *
 * Counters are populated by recordZuperCall() inside ZuperClient.request
 * (src/lib/zuper.ts) and zuperFetch (src/lib/zuper-property-sync.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { readZuperCounters } from "@/lib/zuper-call-counter";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const daysParam = req.nextUrl.searchParams.get("days");
  const days = Math.max(0, Math.min(30, Number(daysParam) || 0));

  const data = await readZuperCounters(days);
  const totalAcrossDays = data.reduce((sum, d) => sum + d.total, 0);

  return NextResponse.json({
    daysIncluded: days + 1,
    totalAcrossDays,
    perDay: data,
  });
}
