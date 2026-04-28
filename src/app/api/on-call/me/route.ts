import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { getCurrentUser } from "@/lib/auth-utils";
import { resolveElectricianByEmail } from "@/lib/on-call-db";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Today in an IANA timezone as YYYY-MM-DD.
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

  const user = await getCurrentUser();
  if (!user?.email) {
    return NextResponse.json({ crewMember: null, shifts: [], pendingSwaps: [] });
  }
  const crew = await resolveElectricianByEmail(user.email);
  if (!crew) {
    return NextResponse.json({ crewMember: null, shifts: [], pendingSwaps: [] });
  }

  const today = todayInTz("America/Denver"); // use a reasonable "today" for clamping

  // Upcoming shifts: this crew member's future persisted assignments.
  const shiftsRaw = await prisma.onCallAssignment.findMany({
    where: {
      crewMemberId: crew.id,
      date: { gte: today },
    },
    include: { pool: true },
    orderBy: { date: "asc" },
    take: 20,
  });

  // Group weekly-shift assignments into week blocks so UI shows "week of May 3" not 7 rows.
  type Shift = {
    poolId: string;
    poolName: string;
    startDate: string;
    endDate: string;
    shiftStart: string;
    shiftEnd: string;
    weekendShiftStart: string;
    weekendShiftEnd: string;
    timezone: string;
    rotationUnit: string;
  };
  const shifts: Shift[] = [];
  for (const a of shiftsRaw) {
    const last = shifts[shifts.length - 1];
    const isConsecutive =
      last &&
      last.poolId === a.poolId &&
      addDays(last.endDate, 1) === a.date;
    if (isConsecutive) {
      last.endDate = a.date;
    } else {
      shifts.push({
        poolId: a.poolId,
        poolName: a.pool.name,
        startDate: a.date,
        endDate: a.date,
        shiftStart: a.pool.shiftStart,
        shiftEnd: a.pool.shiftEnd,
        weekendShiftStart: a.pool.weekendShiftStart,
        weekendShiftEnd: a.pool.weekendShiftEnd,
        timezone: a.pool.timezone,
        rotationUnit: a.pool.rotationUnit,
      });
    }
  }

  // Pending swap requests where this crew is the counterparty and awaiting their response.
  const pendingSwaps = await prisma.onCallSwapRequest.findMany({
    where: {
      counterpartyCrewMemberId: crew.id,
      status: "awaiting-counterparty",
    },
    include: {
      requesterCrewMember: true,
      pool: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Swap requests this crew proposed that are still in flight (pending or approved).
  const myRequests = await prisma.onCallSwapRequest.findMany({
    where: {
      requesterCrewMemberId: crew.id,
      status: { in: ["awaiting-counterparty", "awaiting-admin"] },
    },
    include: {
      counterpartyCrewMember: true,
      pool: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Per-pool subscribe URLs for the iCal feed and the shared Google Calendar.
  // Electricians can subscribe in their own calendar app; the GCal copy is
  // also auto-invited per shift, so this is just for those who want the full
  // pool view (including everyone's shifts, not just their own).
  const pools = await prisma.onCallPool.findMany({
    where: { isActive: true },
    select: { id: true, name: true, icalToken: true, googleCalendarId: true },
    orderBy: { name: "asc" },
  });
  const subscribeUrls = pools.map((p) => ({
    poolId: p.id,
    poolName: p.name,
    icalUrl: p.icalToken ? `/api/on-call/calendar/${p.id}?token=${p.icalToken}` : null,
    googleCalendarId: p.googleCalendarId,
  }));

  return NextResponse.json({
    crewMember: { id: crew.id, name: crew.name, email: crew.email },
    shifts,
    pendingSwaps,
    myRequests,
    subscribeUrls,
  });
}

function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
