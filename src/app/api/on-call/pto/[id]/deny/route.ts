import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canApproveOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma, logActivity } from "@/lib/db";
import { sendOnCallPtoNotification } from "@/lib/on-call-notifications";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canApproveOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { denialReason?: string };
  const pto = await prisma.onCallPtoRequest.update({
    where: { id },
    data: {
      status: "denied",
      denialReason: body.denialReason ?? null,
      reviewedByUserId: user?.id ?? null,
      reviewedAt: new Date(),
    },
  });
  await logActivity({
    type: "ON_CALL_PTO_DENIED",
    description: `Denied PTO`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPtoRequest",
    entityId: id,
  });
  try {
    await sendOnCallPtoNotification(id, "denied");
  } catch (err) {
    console.warn("[on-call] pto-denied notification failed", err);
  }
  return NextResponse.json({ pto });
}
