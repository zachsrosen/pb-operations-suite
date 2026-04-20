import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma, logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canAdminOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const pool = await prisma.onCallPool.update({
    where: { id },
    data: { icalToken: randomBytes(24).toString("hex") },
  });
  await logActivity({
    type: "ON_CALL_ICAL_TOKEN_ROTATED",
    description: `Rotated iCal token for ${pool.name}`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPool",
    entityId: pool.id,
  });
  return NextResponse.json({ icalToken: pool.icalToken });
}
