import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/deal-sync/freshness
 *
 * Lightweight read of how fresh the Deal mirror is — the max lastSyncedAt across
 * active PROJECT deals (updated on every sync run, incl. unchanged deals). Feeds
 * the "deals synced N ago" badge on mirror-backed dashboards so staleness is
 * visible, not assumed. Reachable by every authenticated role (see roles.ts).
 */
export async function GET() {
  if (!prisma) {
    return NextResponse.json({ lastSyncedAt: null, ageMinutes: null, staleness: null });
  }

  const newest = await prisma.deal.findFirst({
    where: { pipeline: "PROJECT", stage: { not: "DELETED" } },
    orderBy: { lastSyncedAt: "desc" },
    select: { lastSyncedAt: true },
  });

  const last = newest?.lastSyncedAt ?? null;
  const ageMinutes = last
    ? Math.max(0, Math.floor((Date.now() - last.getTime()) / 60_000))
    : null;

  const staleness =
    ageMinutes == null
      ? "never"
      : ageMinutes < 1
        ? "just now"
        : ageMinutes < 60
          ? `${ageMinutes}m ago`
          : `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m ago`;

  return NextResponse.json({
    lastSyncedAt: last ? last.toISOString() : null,
    ageMinutes,
    staleness,
  });
}
