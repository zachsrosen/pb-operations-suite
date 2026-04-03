import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import {
  isIdrAllowedRole,
  fetchInitialReviewDeals,
  snapshotDealProperties,
  computeReadinessBadge,
  getReturningDealIds,
} from "@/lib/idr-meeting";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);
  const skip = parseInt(url.searchParams.get("skip") ?? "0");

  const [sessions, total] = await Promise.all([
    prisma.idrMeetingSession.findMany({
      orderBy: { date: "desc" },
      skip,
      take: limit,
      include: { _count: { select: { items: true } } },
    }),
    prisma.idrMeetingSession.count(),
  ]);

  return NextResponse.json({
    sessions,
    total,
    hasMore: skip + sessions.length < total,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Create session
  const session = await prisma.idrMeetingSession.create({
    data: {
      date: new Date(),
      status: "DRAFT",
      source: "app",
      createdBy: auth.email,
    },
  });

  // Fetch deals from HubSpot
  const deals = await fetchInitialReviewDeals();
  const returningDealIds = await getReturningDealIds(session.date);

  // Create items
  const items = [];
  const regionGroups = new Map<string, typeof deals>();
  for (const deal of deals) {
    const region = deal.properties.pb_location ?? "Unknown";
    if (!regionGroups.has(region)) regionGroups.set(region, []);
    regionGroups.get(region)!.push(deal);
  }

  let sortOrder = 0;
  for (const [, regionDeals] of [...regionGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const deal of regionDeals.sort((a, b) =>
      (a.properties.dealname ?? "").localeCompare(b.properties.dealname ?? ""),
    )) {
      const snapshot = snapshotDealProperties(deal.properties);
      const badge = computeReadinessBadge(snapshot.surveyCompleted, snapshot.plansetDate);
      const isReturning = returningDealIds.has(deal.dealId);

      const item = await prisma.idrMeetingItem.create({
        data: {
          sessionId: session.id,
          dealId: deal.dealId,
          type: "IDR",
          sortOrder: sortOrder++,
          ...snapshot,
          addedBy: "system",
        },
      });

      items.push({ ...item, badge, isReturning });
    }
  }

  return NextResponse.json({ session, items }, { status: 201 });
}
