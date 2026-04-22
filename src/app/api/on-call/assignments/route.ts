import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { listAssignmentsInRange, getActiveMembersForRotation, listPools, getPool } from "@/lib/on-call-db";
import { generateAssignments, daysBetween } from "@/lib/on-call-rotation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;

  const url = new URL(req.url);
  const poolId = url.searchParams.get("poolId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
  }
  const span = daysBetween(from, to);
  if (span < 0 || span > 180) {
    return NextResponse.json({ error: "Range must be 0–180 days" }, { status: 400 });
  }

  const persisted = await listAssignmentsInRange(poolId, from, to);
  const persistedByKey = new Map(persisted.map((a) => [`${a.poolId}:${a.date}`, a]));

  // Pool list to fill gaps on the fly.
  const pools = poolId ? [await getPool(poolId)].filter(Boolean) as NonNullable<Awaited<ReturnType<typeof getPool>>>[] : await listPools();

  const filled: Array<{
    poolId: string;
    poolName: string;
    date: string;
    crewMemberId: string;
    crewMemberName: string;
    source: string;
    originalCrewMemberId: string | null;
    originalCrewMemberName: string | null;
    persisted: boolean;
  }> = [];

  for (const pool of pools) {
    // Fetch pool meta for name, members for on-the-fly generation.
    const poolName = pool.name;
    const members = await getActiveMembersForRotation(pool.id);

    // Clamp fromDate up to pool.startDate — no scheduling before the pool's
    // startDate, and skip this pool entirely if the whole requested window
    // is pre-startDate.
    const effectiveFrom = from >= pool.startDate ? from : pool.startDate;
    if (effectiveFrom > to) continue;

    let gen: { date: string; crewMemberId: string }[] = [];
    try {
      gen = generateAssignments({
        startDate: pool.startDate,
        fromDate: effectiveFrom,
        toDate: to,
        members,
        rotationUnit: (pool.rotationUnit as "daily" | "weekly") ?? "weekly",
      });
    } catch {
      gen = [];
    }

    for (const g of gen) {
      const key = `${pool.id}:${g.date}`;
      const p = persistedByKey.get(key);
      if (p) {
        filled.push({
          poolId: pool.id,
          poolName,
          date: p.date,
          crewMemberId: p.crewMemberId,
          crewMemberName: p.crewMember?.name ?? "",
          source: p.source,
          originalCrewMemberId: p.originalCrewMemberId,
          originalCrewMemberName: p.originalCrewMember?.name ?? null,
          persisted: true,
        });
      } else {
        // Need the name from generated crewMemberId — we don't have it yet.
        filled.push({
          poolId: pool.id,
          poolName,
          date: g.date,
          crewMemberId: g.crewMemberId,
          crewMemberName: "",
          source: "forecast",
          originalCrewMemberId: null,
          originalCrewMemberName: null,
          persisted: false,
        });
      }
    }
  }

  // Backfill forecast names by single batch lookup.
  const missingIds = Array.from(new Set(filled.filter((f) => !f.persisted).map((f) => f.crewMemberId)));
  if (missingIds.length > 0) {
    const { prisma } = await import("@/lib/db");
    const cms = await prisma.crewMember.findMany({ where: { id: { in: missingIds } } });
    const nameById = new Map(cms.map((c) => [c.id, c.name]));
    for (const f of filled) {
      if (!f.persisted) f.crewMemberName = nameById.get(f.crewMemberId) ?? "";
    }
  }

  return NextResponse.json({ assignments: filled });
}
