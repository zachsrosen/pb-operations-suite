import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";

export async function POST(
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
  const { content } = body;

  if (!content?.trim()) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }

  const item = await prisma.idrMeetingItem.findUnique({
    where: { id },
    select: { dealId: true },
  });

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const note = await prisma.idrMeetingNote.create({
    data: {
      itemId: id,
      dealId: item.dealId,
      content: content.trim(),
      author: auth.email,
    },
  });

  return NextResponse.json(note, { status: 201 });
}
