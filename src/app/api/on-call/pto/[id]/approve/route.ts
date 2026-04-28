import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canApproveOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma, logActivity } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { upsertAssignmentEvent } from "@/lib/on-call-google-calendar";

export const dynamic = "force-dynamic";

type Body = {
  reassignments: Array<{ date: string; replacementCrewMemberId: string }>;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canApproveOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json()) as Body;

  const pto = await prisma.onCallPtoRequest.findUnique({ where: { id } });
  if (!pto) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (pto.status !== "awaiting-admin") {
    return NextResponse.json({ error: "PTO not awaiting admin" }, { status: 409 });
  }
  if (!Array.isArray(body.reassignments)) {
    return NextResponse.json({ error: "reassignments array required" }, { status: 400 });
  }

  await prisma.$transaction([
    ...body.reassignments.map((r) =>
      prisma.onCallAssignment.update({
        where: { poolId_date: { poolId: pto.poolId, date: r.date } },
        data: {
          crewMemberId: r.replacementCrewMemberId,
          source: "pto-reassign",
          originalCrewMemberId: pto.crewMemberId,
          sourceRequestId: pto.id,
        },
      }),
    ),
    prisma.onCallPtoRequest.update({
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
    type: "ON_CALL_PTO_APPROVED",
    description: `Approved PTO ${pto.startDate} – ${pto.endDate}`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPtoRequest",
    entityId: id,
  });
  console.warn("[on-call] pto-approved notification stub", { ptoId: id });

  // Re-sync the reassigned dates to Google Calendar so each replacement
  // electrician gets the invite on their primary cal.
  try {
    const pool = await prisma.onCallPool.findUnique({ where: { id: pto.poolId } });
    if (pool) {
      const dates = body.reassignments.map((r) => r.date);
      const updated = await prisma.onCallAssignment.findMany({
        where: { poolId: pto.poolId, date: { in: dates } },
        include: { crewMember: { select: { name: true, email: true } } },
      });
      for (const a of updated) {
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
          { id: a.id, date: a.date, poolId: a.poolId, crewMember: a.crewMember },
        );
      }
    }
  } catch (err) {
    console.warn("[on-call/pto-approve] gcal sync failed", err);
  }

  return NextResponse.json({ ok: true });
}
