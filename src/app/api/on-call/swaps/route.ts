import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma, logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const poolId = url.searchParams.get("poolId");
  const swaps = await prisma.onCallSwapRequest.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(poolId ? { poolId } : {}),
    },
    include: {
      requesterCrewMember: true,
      counterpartyCrewMember: true,
      pool: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ swaps });
}

type CreateBody = {
  poolId: string;
  requesterCrewMemberId: string;
  requesterDate: string;
  counterpartyCrewMemberId: string;
  counterpartyDate: string;
  reason?: string;
  asAdmin?: boolean;
};

export async function POST(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  const body = (await req.json()) as CreateBody;

  if (!body.poolId || !body.requesterCrewMemberId || !body.counterpartyCrewMemberId || !body.requesterDate || !body.counterpartyDate) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (body.asAdmin && !canAdminOnCall(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate that existing assignments match declared parties.
  const [rAssign, cAssign] = await Promise.all([
    prisma.onCallAssignment.findUnique({ where: { poolId_date: { poolId: body.poolId, date: body.requesterDate } } }),
    prisma.onCallAssignment.findUnique({ where: { poolId_date: { poolId: body.poolId, date: body.counterpartyDate } } }),
  ]);
  if (!rAssign || rAssign.crewMemberId !== body.requesterCrewMemberId) {
    return NextResponse.json({ error: "Requester is not on-call on requesterDate" }, { status: 400 });
  }
  if (!cAssign || cAssign.crewMemberId !== body.counterpartyCrewMemberId) {
    return NextResponse.json({ error: "Counterparty is not on-call on counterpartyDate" }, { status: 400 });
  }

  const status = body.asAdmin ? "awaiting-admin" : "awaiting-counterparty";
  const swap = await prisma.onCallSwapRequest.create({
    data: {
      poolId: body.poolId,
      requesterCrewMemberId: body.requesterCrewMemberId,
      requesterDate: body.requesterDate,
      counterpartyCrewMemberId: body.counterpartyCrewMemberId,
      counterpartyDate: body.counterpartyDate,
      reason: body.reason,
      status,
    },
  });
  await logActivity({
    type: "ON_CALL_SWAP_REQUESTED",
    description: `Swap proposed for ${body.requesterDate} ↔ ${body.counterpartyDate}`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallSwapRequest",
    entityId: swap.id,
  });
  return NextResponse.json({ swap });
}
