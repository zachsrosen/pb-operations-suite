import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;

  const [items, notes] = await Promise.all([
    prisma.idrMeetingItem.findMany({
      where: { dealId },
      include: { session: { select: { date: true, status: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.idrMeetingNote.findMany({
      where: { dealId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({ items: items ?? [], notes: notes ?? [] });
}
