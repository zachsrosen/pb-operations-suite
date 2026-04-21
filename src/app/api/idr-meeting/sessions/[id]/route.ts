import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import {
  isIdrAllowedRole,
  computeReadinessBadge,
  getReturningDealIds,
  buildHubSpotPropertyUpdates,
  buildHubSpotNoteBody,
  pushDealProperties,
  createDealTimelineNote,
  serializeAdderSummary,
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
  const { status } = body;

  if (!["DRAFT", "ACTIVE", "COMPLETED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // Auto-sync all unsynced items when ending a meeting
  let syncResults: { synced: number; failed: number } | undefined;
  if (status === "COMPLETED") {
    const unsyncedItems = await prisma.idrMeetingItem.findMany({
      where: { sessionId: id, hubspotSyncStatus: { not: "SYNCED" } },
      include: { session: { select: { date: true } } },
    });

    let synced = 0;
    let failed = 0;

    for (const item of unsyncedItems) {
      try {
        // A) Push property updates
        const properties = buildHubSpotPropertyUpdates({
          difficulty: item.difficulty,
          installerCount: item.installerCount,
          installerDays: item.installerDays,
          electricianCount: item.electricianCount,
          electricianDays: item.electricianDays,
          discoReco: item.discoReco,
          interiorAccess: item.interiorAccess,
          operationsNotes: item.operationsNotes,
          needsSurveyInfo: item.needsSurveyInfo,
          needsResurvey: item.needsResurvey,
          salesChangeRequested: item.salesChangeRequested,
          salesChangeNotes: item.salesChangeNotes,
          opsChangeNotes: item.opsChangeNotes,
          adderSummary: serializeAdderSummary(item),
        });

        if (Object.keys(properties).length > 0) {
          await pushDealProperties(item.dealId, properties);
        }

        // B) Create timeline note
        const noteBody = buildHubSpotNoteBody(
          {
            difficulty: item.difficulty,
            installerCount: item.installerCount,
            installerDays: item.installerDays,
            electricianCount: item.electricianCount,
            electricianDays: item.electricianDays,
            discoReco: item.discoReco,
            interiorAccess: item.interiorAccess,
            customerNotes: item.customerNotes,
            operationsNotes: item.operationsNotes,
            designNotes: item.designNotes,
            conclusion: item.conclusion,
            salesChangeRequested: item.salesChangeRequested,
            salesChangeNotes: item.salesChangeNotes,
            needsSurveyInfo: item.needsSurveyInfo,
            opsChangeNotes: item.opsChangeNotes,
            needsResurvey: item.needsResurvey,
            adderSummary: serializeAdderSummary(item),
          },
          item.session.date.toISOString(),
        );

        await createDealTimelineNote(item.dealId, noteBody);

        // C) Mark synced
        await prisma.idrMeetingItem.update({
          where: { id: item.id },
          data: { hubspotSyncStatus: "SYNCED", hubspotSyncedAt: new Date() },
        });

        synced++;
      } catch (err) {
        console.error(`[idr-meeting] Auto-sync failed for item ${item.id} (deal ${item.dealId}):`, err);
        await prisma.idrMeetingItem.update({
          where: { id: item.id },
          data: { hubspotSyncStatus: "FAILED" },
        });
        failed++;
      }
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
