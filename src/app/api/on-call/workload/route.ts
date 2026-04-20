import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { getPool, getActiveMembersForRotation, listAssignmentsInRange } from "@/lib/on-call-db";
import { generateAssignments, computeWorkload } from "@/lib/on-call-rotation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;

  const url = new URL(req.url);
  const poolId = url.searchParams.get("poolId");
  const month = url.searchParams.get("month"); // YYYY-MM

  if (!poolId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "poolId and month=YYYY-MM required" }, { status: 400 });
  }

  const pool = await getPool(poolId);
  if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 });

  // Month bounds as YYYY-MM-DD in pool's tz (simple string math — last day of month).
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;

  // Merge persisted + generated (so forecast-month workload is visible before Publish).
  const persisted = await listAssignmentsInRange(poolId, from, to);
  const members = await getActiveMembersForRotation(poolId);
  let gen: { date: string; crewMemberId: string }[] = [];
  try {
    gen = generateAssignments({
      startDate: pool.startDate,
      fromDate: from,
      toDate: to,
      members,
    });
  } catch {
    gen = [];
  }

  const persistedByDate = new Map(persisted.map((p) => [p.date, p]));
  const merged: { date: string; crewMemberId: string }[] = gen.map((g) => {
    const p = persistedByDate.get(g.date);
    return p ? { date: p.date, crewMemberId: p.crewMemberId } : g;
  });

  const workload = computeWorkload({ month, assignments: merged });

  // Join with CrewMember names for display.
  const ids = Object.keys(workload);
  const cms = ids.length > 0
    ? await prisma.crewMember.findMany({ where: { id: { in: ids } } })
    : [];
  const nameById = new Map(cms.map((c) => [c.id, c.name]));
  const byMember = ids.map((id) => ({
    crewMemberId: id,
    crewMemberName: nameById.get(id) ?? "",
    ...workload[id],
  }));

  return NextResponse.json({
    poolId,
    month,
    byMember,
  });
}
