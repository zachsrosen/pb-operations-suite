import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/auth-utils";
import { getHourHeatmap, getKpis, getPerDay, getPerUser } from "@/lib/aircall-stats";
import { isFlagEnabled, parseFilter } from "../_filter";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isFlagEnabled()) {
    return NextResponse.json({ error: "Aircall dashboard is disabled" }, { status: 404 });
  }
  try {
    await requireRole("ADMIN", "OWNER", "EXECUTIVE");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = parseFilter(req);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const f = parsed.filter;

  const [kpis, perUser, perDay, hourHeatmap] = await Promise.all([
    getKpis(f),
    getPerUser(f),
    getPerDay(f),
    getHourHeatmap(f),
  ]);

  return NextResponse.json({ kpis, perUser, perDay, hourHeatmap });
}
