import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canApproveOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Admin/executive view: all swap + PTO activity across every pool.
 * Returns pending items (awaiting counterparty, awaiting admin) plus recently
 * approved/denied/cancelled ones from the last 30 days.
 *
 * Gated at handler level to ADMIN / EXECUTIVE / OPERATIONS_MANAGER via
 * canApproveOnCall.
 */
export async function GET() {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canApproveOnCall(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [pendingSwaps, recentSwaps, pendingPto, recentPto] = await Promise.all([
    prisma.onCallSwapRequest.findMany({
      where: { status: { in: ["awaiting-counterparty", "awaiting-admin"] } },
      include: {
        requesterCrewMember: true,
        counterpartyCrewMember: true,
        pool: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.onCallSwapRequest.findMany({
      where: {
        status: { in: ["approved", "denied", "cancelled"] },
        updatedAt: { gte: thirtyDaysAgo },
      },
      include: {
        requesterCrewMember: true,
        counterpartyCrewMember: true,
        pool: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.onCallPtoRequest.findMany({
      where: { status: "awaiting-admin" },
      include: { crewMember: true, pool: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.onCallPtoRequest.findMany({
      where: {
        status: { in: ["approved", "denied", "cancelled"] },
        updatedAt: { gte: thirtyDaysAgo },
      },
      include: { crewMember: true, pool: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);

  return NextResponse.json({
    pendingSwaps,
    recentSwaps,
    pendingPto,
    recentPto,
  });
}
