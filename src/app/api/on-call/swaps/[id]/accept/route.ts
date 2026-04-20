import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canApproveOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { resolveElectricianByEmail } from "@/lib/on-call-db";
import { prisma, logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

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

  const updated = await prisma.onCallSwapRequest.update({
    where: { id },
    data: { status: "awaiting-admin", counterpartyAcceptedAt: new Date() },
  });
  await logActivity({
    type: "ON_CALL_SWAP_ACCEPTED",
    description: `Counterparty accepted swap`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallSwapRequest",
    entityId: id,
  });
  return NextResponse.json({ swap: updated });
}
