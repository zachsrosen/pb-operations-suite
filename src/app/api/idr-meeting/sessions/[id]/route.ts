import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole, computeReadinessBadge, getReturningDealIds } from "@/lib/idr-meeting";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const session = await prisma.idrMeetingSession.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: { notes: { orderBy: { createdAt: "desc" } } },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const returningDealIds = await getReturningDealIds(session.date);
  const itemsWithBadges = session.items.map((item) => ({
    ...item,
    badge: computeReadinessBadge(item.surveyCompleted, item.plansetDate),
    isReturning: returningDealIds.has(item.dealId),
  }));

  return NextResponse.json({ ...session, items: itemsWithBadges });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  if (!["DRAFT", "ACTIVE", "COMPLETED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const session = await prisma.idrMeetingSession.update({
    where: { id },
    data: { status },
  });

  return NextResponse.json(session);
}
