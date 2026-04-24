import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import {
  isIdrAllowedRole,
  computeReadinessBadge,
  getReturningDealIds,
  syncItemToHubSpot,
} from "@/lib/idr-meeting";

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

  // Look up cached Zuper site-survey job UIDs per deal so the UI can deep-link.
  const dealIds = session.items.map((i) => i.dealId);
  const surveyJobs = dealIds.length
    ? await prisma.zuperJobCache.findMany({
        where: {
          hubspotDealId: { in: dealIds },
          jobCategory: { in: ["Site Survey", "Pre-Sale Site Visit"] },
        },
        orderBy: { lastSyncedAt: "desc" },
        select: { hubspotDealId: true, jobUid: true, jobCategory: true },
      })
    : [];
  // Prefer real Site Survey over Pre-Sale Site Visit when both exist.
  const surveyJobByDeal = new Map<string, string>();
  for (const j of surveyJobs) {
    if (!j.hubspotDealId) continue;
    const existing = surveyJobByDeal.get(j.hubspotDealId);
    if (!existing || j.jobCategory === "Site Survey") {
      surveyJobByDeal.set(j.hubspotDealId, j.jobUid);
    }
  }

  const itemsWithBadges = session.items.map((item) => ({
    ...item,
    badge: computeReadinessBadge(item.surveyCompleted, item.plansetDate),
    isReturning: returningDealIds.has(item.dealId),
    surveyJobUid: surveyJobByDeal.get(item.dealId) ?? null,
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
  const { status, skipSync } = body;

  if (!["DRAFT", "ACTIVE", "COMPLETED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // Auto-sync all unsynced items when ending a meeting (unless skipSync is set)
  let syncResults: { synced: number; failed: number } | undefined;
  if (status === "COMPLETED" && !skipSync) {
    const unsyncedItems = await prisma.idrMeetingItem.findMany({
      where: { sessionId: id, hubspotSyncStatus: { not: "SYNCED" } },
      include: { session: { select: { date: true } } },
    });

    let synced = 0;
    let failed = 0;
    for (const item of unsyncedItems) {
      const result = await syncItemToHubSpot(item, item.session.date);
      if (result.ok) synced++;
      else failed++;
    }
    syncResults = { synced, failed };
  }

  const session = await prisma.idrMeetingSession.update({
    where: { id },
    data: { status },
  });

  // Broadcast status change (e.g. meeting ended) to all clients
  appCache.invalidate(`idr-meeting:session:${id}`);
  appCache.invalidate("idr-meeting:sessions");

  return NextResponse.json({ ...session, syncResults });
}
