import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canApproveOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma, logActivity } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";

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

  appCache.invalidate(CACHE_KEYS.ON_CALL_TONIGHT);
  await logActivity({
    type: "ON_CALL_PTO_APPROVED",
    description: `Approved PTO ${pto.startDate} – ${pto.endDate}`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPtoRequest",
    entityId: id,
  });
  console.warn("[on-call] pto-approved notification stub", { ptoId: id });
  return NextResponse.json({ ok: true });
}
