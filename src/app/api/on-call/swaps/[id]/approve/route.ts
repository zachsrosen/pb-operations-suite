import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canApproveOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma, logActivity } from "@/lib/db";
import { appCache } from "@/lib/cache";

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

  // Transactional two-row update on the unique composite key (poolId, date).
  await prisma.$transaction([
    prisma.onCallAssignment.update({
      where: { poolId_date: { poolId: swap.poolId, date: swap.requesterDate } },
      data: {
        crewMemberId: swap.counterpartyCrewMemberId,
        source: "swap",
        originalCrewMemberId: swap.requesterCrewMemberId,
        sourceRequestId: swap.id,
      },
    }),
    prisma.onCallAssignment.update({
      where: { poolId_date: { poolId: swap.poolId, date: swap.counterpartyDate } },
      data: {
        crewMemberId: swap.requesterCrewMemberId,
        source: "swap",
        originalCrewMemberId: swap.counterpartyCrewMemberId,
        sourceRequestId: swap.id,
      },
    }),
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
    description: `Approved swap (${swap.requesterDate} ↔ ${swap.counterpartyDate})`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallSwapRequest",
    entityId: id,
  });
  // Notification stub — real React Email template ships in V1.1.
  console.warn("[on-call] swap-approved notification stub", { swapId: id });

  return NextResponse.json({ ok: true });
}
