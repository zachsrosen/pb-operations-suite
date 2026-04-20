import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma, logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const { id } = await params;
  const members = await prisma.onCallPoolMember.findMany({
    where: { poolId: id },
    orderBy: { orderIndex: "asc" },
    include: { crewMember: true },
  });
  return NextResponse.json({ members });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canAdminOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json()) as { crewMemberId: string };
  if (!body.crewMemberId) return NextResponse.json({ error: "crewMemberId required" }, { status: 400 });

  const existing = await prisma.onCallPoolMember.findMany({
    where: { poolId: id },
    orderBy: { orderIndex: "desc" },
    take: 1,
  });
  const nextIndex = existing.length > 0 ? existing[0].orderIndex + 1 : 0;

  const member = await prisma.onCallPoolMember.create({
    data: { poolId: id, crewMemberId: body.crewMemberId, orderIndex: nextIndex },
    include: { crewMember: true },
  });
  await logActivity({
    type: "ON_CALL_POOL_MEMBERS_CHANGED",
    description: `Added ${member.crewMember.name} to pool`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPool",
    entityId: id,
  });
  return NextResponse.json({ member });
}

type BulkBody = { members: Array<{ id: string; orderIndex: number; isActive: boolean }> };

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canAdminOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json()) as BulkBody;
  if (!Array.isArray(body.members)) {
    return NextResponse.json({ error: "members array required" }, { status: 400 });
  }

  await prisma.$transaction(
    body.members.map((m) =>
      prisma.onCallPoolMember.update({
        where: { id: m.id },
        data: { orderIndex: m.orderIndex, isActive: m.isActive },
      }),
    ),
  );
  await logActivity({
    type: "ON_CALL_POOL_MEMBERS_CHANGED",
    description: `Bulk-updated rotation order (${body.members.length} members)`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPool",
    entityId: id,
  });

  const members = await prisma.onCallPoolMember.findMany({
    where: { poolId: id },
    orderBy: { orderIndex: "asc" },
    include: { crewMember: true },
  });
  return NextResponse.json({ members });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canAdminOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id: poolId } = await params;
  const url = new URL(req.url);
  const memberId = url.searchParams.get("memberId");
  if (!memberId) return NextResponse.json({ error: "memberId query required" }, { status: 400 });

  await prisma.onCallPoolMember.delete({ where: { id: memberId } });
  await logActivity({
    type: "ON_CALL_POOL_MEMBERS_CHANGED",
    description: `Removed member from pool`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPool",
    entityId: poolId,
  });
  return NextResponse.json({ ok: true });
}
