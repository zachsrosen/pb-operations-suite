import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

/**
 * Read-only proxy for IDR notes for a given deal. Used by the Shit Show meeting
 * hub so it doesn't need /api/idr-meeting in role allowlists.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const notes = await prisma.idrMeetingNote.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      content: true,
      author: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ notes });
}
