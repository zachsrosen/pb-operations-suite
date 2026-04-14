import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getDealTimeline } from "@/lib/deal-timeline";

export const maxDuration = 15;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { dealId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const all = searchParams.get("all") === "true";
  const cursorTs = searchParams.get("cursorTs") ?? undefined;
  const cursorId = searchParams.get("cursorId") ?? undefined;

  // Validate cursor: both or neither
  if ((cursorTs && !cursorId) || (!cursorTs && cursorId)) {
    return NextResponse.json(
      { error: "cursorTs and cursorId must both be provided" },
      { status: 400 },
    );
  }

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, hubspotDealId: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const result = await getDealTimeline(deal.id, deal.hubspotDealId, {
    all,
    cursorTs,
    cursorId,
  });

  return NextResponse.json(result);
}
