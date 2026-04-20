import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canApproveOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma, logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canApproveOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { denialReason?: string };

  const swap = await prisma.onCallSwapRequest.update({
    where: { id },
    data: {
      status: "denied",
      denialReason: body.denialReason ?? null,
      reviewedByUserId: user?.id ?? null,
      reviewedAt: new Date(),
    },
  });
  await logActivity({
    type: "ON_CALL_SWAP_DENIED",
    description: `Denied swap`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallSwapRequest",
    entityId: id,
  });
  console.warn("[on-call] swap-denied notification stub", { swapId: id });
  return NextResponse.json({ swap });
}
