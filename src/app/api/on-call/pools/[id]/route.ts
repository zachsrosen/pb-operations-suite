import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { getPool } from "@/lib/on-call-db";
import { prisma, logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const { id } = await params;
  const pool = await getPool(id);
  if (!pool) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ pool });
}

type PatchBody = {
  region?: string;
  shiftStart?: string;
  shiftEnd?: string;
  timezone?: string;
  startDate?: string;
  horizonMonths?: number;
  isActive?: boolean;
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canAdminOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json()) as PatchBody;

  const pool = await prisma.onCallPool.update({
    where: { id },
    data: {
      region: body.region,
      shiftStart: body.shiftStart,
      shiftEnd: body.shiftEnd,
      timezone: body.timezone,
      startDate: body.startDate,
      horizonMonths: body.horizonMonths,
      isActive: body.isActive,
    },
  });
  await logActivity({
    type: "ON_CALL_POOL_UPDATED",
    description: `Updated on-call pool ${pool.name}`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPool",
    entityId: pool.id,
  });
  return NextResponse.json({ pool });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canAdminOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  await prisma.onCallPool.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
