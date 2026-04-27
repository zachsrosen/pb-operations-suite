import { NextResponse } from "next/server";
import { appCache } from "@/lib/cache";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { getActiveMembersForRotation, listPools } from "@/lib/on-call-db";
import { prisma } from "@/lib/db";
import { generateAssignments } from "@/lib/on-call-rotation";

export const dynamic = "force-dynamic";

// "Today" in an IANA timezone as YYYY-MM-DD.
function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

export async function GET() {
  const gate = assertOnCallEnabled();
  if (gate) return gate;

  const pools = await listPools();
  // Cache key includes each active pool's local "today" so the key naturally
  // rolls over at midnight in each pool's timezone — no stale-past-midnight bug.
  const activePools = pools.filter((p) => p.isActive);
  const cacheKey =
    "on-call:tonight:" +
    activePools
      .map((p) => `${p.id}@${todayInTz(p.timezone)}`)
      .sort()
      .join("|");
  const cached = appCache.get(cacheKey);
  if (cached.hit) return NextResponse.json(cached.data);
  const out: Array<{
    poolId: string;
    poolName: string;
    region: string;
    timezone: string;
    shiftStart: string;
    shiftEnd: string;
    weekendShiftStart: string;
    weekendShiftEnd: string;
    date: string;
    crewMember: { id: string; name: string; email: string | null } | null;
    source: string | null;
  }> = [];

  for (const pool of activePools) {
    const date = todayInTz(pool.timezone);
    // Pool's schedule starts on pool.startDate — show nothing before that.
    if (date < pool.startDate) {
      out.push({
        poolId: pool.id,
        poolName: pool.name,
        region: pool.region,
        timezone: pool.timezone,
        shiftStart: pool.shiftStart,
        shiftEnd: pool.shiftEnd,
        weekendShiftStart: pool.weekendShiftStart,
        weekendShiftEnd: pool.weekendShiftEnd,
        date,
        crewMember: null,
        source: "pre-start",
      });
      continue;
    }
    const existing = await prisma.onCallAssignment.findUnique({
      where: { poolId_date: { poolId: pool.id, date } },
      include: { crewMember: true },
    });

    let crewMember: { id: string; name: string; email: string | null } | null = null;
    let source: string | null = null;
    if (existing) {
      crewMember = {
        id: existing.crewMember.id,
        name: existing.crewMember.name,
        email: existing.crewMember.email,
      };
      source = existing.source;
    } else {
      // Fall back to on-the-fly generation from rotation order.
      const members = await getActiveMembersForRotation(pool.id);
      const activeCount = members.filter((m) => m.isActive).length;
      if (activeCount > 0) {
        try {
          const gen = generateAssignments({
            startDate: pool.startDate,
            fromDate: date,
            toDate: date,
            members,
            rotationUnit: (pool.rotationUnit as "daily" | "weekly") ?? "weekly",
          });
          if (gen.length > 0) {
            const cm = await prisma.crewMember.findUnique({
              where: { id: gen[0].crewMemberId },
            });
            if (cm) {
              crewMember = { id: cm.id, name: cm.name, email: cm.email };
              source = "generated";
            }
          }
        } catch {
          // No active members — leave null.
        }
      }
    }

    out.push({
      poolId: pool.id,
      poolName: pool.name,
      region: pool.region,
      timezone: pool.timezone,
      shiftStart: pool.shiftStart,
      shiftEnd: pool.shiftEnd,
      weekendShiftStart: pool.weekendShiftStart,
      weekendShiftEnd: pool.weekendShiftEnd,
      date,
      crewMember,
      source,
    });
  }

  const response = { pools: out, lastUpdated: new Date().toISOString() };
  appCache.set(cacheKey, response);
  return NextResponse.json(response);
}
