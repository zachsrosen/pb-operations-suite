import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canApproveOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { expandSwapDates, todayInTz } from "@/lib/on-call-swap";
import { prisma, logActivity } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { upsertAssignmentEvent } from "@/lib/on-call-google-calendar";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canApproveOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const swap = await prisma.onCallSwapRequest.findUnique({ where: { id } });
  if (!swap) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (swap.status !== "awaiting-admin") {
    return NextResponse.json({ error: "Swap is not awaiting admin approval" }, { status: 409 });
  }

  const pool = await prisma.onCallPool.findUnique({ where: { id: swap.poolId } });
  if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 });

  // A swap exchanges whole shift blocks, not just the stored dates: for
  // weekly pools the stored date stands for its full Mon-Sun week. Expand
  // each side to its block, then keep only rows the expected party still
  // holds (skips days already reassigned) and days from today forward
  // (never rewrite history on a mid-week approval).
  const today = todayInTz(pool.timezone);
  const requesterDates = expandSwapDates(pool.rotationUnit, swap.requesterDate).filter((d) => d >= today);
  const counterpartyDates = expandSwapDates(pool.rotationUnit, swap.counterpartyDate).filter((d) => d >= today);
  const rows = await prisma.onCallAssignment.findMany({
    where: { poolId: swap.poolId, date: { in: [...requesterDates, ...counterpartyDates] } },
  });
  const requesterRows = rows.filter(
    (r) => requesterDates.includes(r.date) && r.crewMemberId === swap.requesterCrewMemberId,
  );
  const counterpartyRows = rows.filter(
    (r) => counterpartyDates.includes(r.date) && r.crewMemberId === swap.counterpartyCrewMemberId,
  );
  if (requesterRows.length === 0 || counterpartyRows.length === 0) {
    return NextResponse.json(
      { error: "One of the shifts has changed since this swap was proposed — deny it and have them re-propose" },
      { status: 409 },
    );
  }

  await prisma.$transaction([
    ...requesterRows.map((r) =>
      prisma.onCallAssignment.update({
        where: { poolId_date: { poolId: swap.poolId, date: r.date } },
        data: {
          crewMemberId: swap.counterpartyCrewMemberId,
          source: "swap",
          originalCrewMemberId: swap.requesterCrewMemberId,
          sourceRequestId: swap.id,
        },
      }),
    ),
    ...counterpartyRows.map((r) =>
      prisma.onCallAssignment.update({
        where: { poolId_date: { poolId: swap.poolId, date: r.date } },
        data: {
          crewMemberId: swap.requesterCrewMemberId,
          source: "swap",
          originalCrewMemberId: swap.counterpartyCrewMemberId,
          sourceRequestId: swap.id,
        },
      }),
    ),
    prisma.onCallSwapRequest.update({
      where: { id },
      data: {
        status: "approved",
        reviewedByUserId: user?.id ?? null,
        reviewedAt: new Date(),
      },
    }),
  ]);

  appCache.invalidateByPrefix("on-call:tonight");
  await logActivity({
    type: "ON_CALL_SWAP_APPROVED",
    description: `Approved swap (${swap.requesterDate} ↔ ${swap.counterpartyDate}, ${requesterRows.length + counterpartyRows.length} days)`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallSwapRequest",
    entityId: id,
  });
  // Notification stub — real React Email template ships in V1.1.
  console.warn("[on-call] swap-approved notification stub", { swapId: id });

  // Re-sync every swapped assignment to Google Calendar so the new attendees
  // see the events on their primary cal and the old attendees stop seeing
  // them. Failures here are best-effort.
  try {
    const dates = [...requesterRows, ...counterpartyRows].map((r) => r.date);
    const updatedAssignments = await prisma.onCallAssignment.findMany({
      where: { poolId: swap.poolId, date: { in: dates } },
      include: { crewMember: { select: { name: true, email: true } } },
    });
    for (const a of updatedAssignments) {
      await upsertAssignmentEvent(
        {
          id: pool.id,
          name: pool.name,
          region: pool.region,
          timezone: pool.timezone,
          shiftStart: pool.shiftStart,
          shiftEnd: pool.shiftEnd,
          weekendShiftStart: pool.weekendShiftStart,
          weekendShiftEnd: pool.weekendShiftEnd,
          googleCalendarId: pool.googleCalendarId,
        },
        {
          id: a.id,
          date: a.date,
          poolId: a.poolId,
          crewMember: a.crewMember,
        },
      );
    }
  } catch (err) {
    console.warn("[on-call/swap-approve] gcal sync failed", err);
  }

  return NextResponse.json({ ok: true });
}
