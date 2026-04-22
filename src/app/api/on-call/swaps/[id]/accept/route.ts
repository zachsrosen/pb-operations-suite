import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canApproveOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { resolveElectricianByEmail } from "@/lib/on-call-db";
import { prisma, logActivity } from "@/lib/db";
import { appCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * Counterparty-accept endpoint. With self-service swaps (April 2026), this
 * also auto-applies the swap to the underlying assignments — no admin step.
 * Admins can still deny via the old /deny route if they need to reverse.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const swap = await prisma.onCallSwapRequest.findUnique({ where: { id } });
  if (!swap) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (swap.status !== "awaiting-counterparty") {
    return NextResponse.json({ error: "Swap is not awaiting counterparty" }, { status: 409 });
  }

  // Caller must be the counterparty (via CrewMember email match) or an admin/approver.
  const isAdmin = canApproveOnCall(user);
  if (!isAdmin) {
    const callerCrew = user.email ? await resolveElectricianByEmail(user.email) : null;
    if (!callerCrew || callerCrew.id !== swap.counterpartyCrewMemberId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Self-service apply: swap assignments + mark approved in one tx.
  const now = new Date();
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
        counterpartyAcceptedAt: now,
        reviewedByUserId: user.id ?? null,
        reviewedAt: now,
      },
    }),
  ]);

  appCache.invalidateByPrefix("on-call:tonight");
  await logActivity({
    type: "ON_CALL_SWAP_ACCEPTED",
    description: `Self-service swap accepted and applied (${swap.requesterDate} ↔ ${swap.counterpartyDate})`,
    userId: user.id,
    userEmail: user.email,
    entityType: "OnCallSwapRequest",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}
