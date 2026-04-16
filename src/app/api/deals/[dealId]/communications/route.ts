import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getDealEngagements } from "@/lib/hubspot-engagements";

export const maxDuration = 15;

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { dealId } = await params;
  const all = request.nextUrl.searchParams.get("all") === "true";

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { hubspotDealId: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  let engagements = await getDealEngagements(deal.hubspotDealId, all);

  // Communications = external contact channels (email/call/meeting). HubSpot
  // notes and tasks are operational records; they surface in the Activity tab.
  engagements = engagements.filter((e) => e.type !== "task" && e.type !== "note");

  // Apply 90-day window filter post-cache-retrieval
  if (!all) {
    const windowStart = Date.now() - NINETY_DAYS_MS;
    engagements = engagements.filter(
      (e) => new Date(e.timestamp).getTime() >= windowStart,
    );
  }

  return NextResponse.json({ engagements });
}
