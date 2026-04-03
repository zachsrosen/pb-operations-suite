import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import {
  isIdrAllowedRole,
  fetchInitialReviewDeals,
  snapshotDealProperties,
  computeReadinessBadge,
  getReturningDealIds,
  buildOwnerMap,
  SNAPSHOT_PROPERTIES,
} from "@/lib/idr-meeting";
import { hubspotClient } from "@/lib/hubspot";

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

  // Fetch deals from HubSpot + resolve owner names
  const deals = await fetchInitialReviewDeals();
  const [returningDealIds, ownerMap] = await Promise.all([
    getReturningDealIds(session.date),
    buildOwnerMap(deals),
  ]);

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
      const snapshot = snapshotDealProperties(deal.properties, ownerMap);
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

  // ── Consume queued items (escalations + prep edits) ──
  const queuedItems = await prisma.idrEscalationQueue.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });

  if (queuedItems.length > 0) {
    const existingDealIds = new Set(items.map((i) => i.dealId));

    // Helper: pick non-null prep fields from a queue record
    const pickPrepFields = (q: typeof queuedItems[0]) => ({
      ...(q.difficulty != null ? { difficulty: q.difficulty } : {}),
      ...(q.installerCount != null ? { installerCount: q.installerCount } : {}),
      ...(q.installerDays != null ? { installerDays: q.installerDays } : {}),
      ...(q.electricianCount != null ? { electricianCount: q.electricianCount } : {}),
      ...(q.electricianDays != null ? { electricianDays: q.electricianDays } : {}),
      ...(q.discoReco != null ? { discoReco: q.discoReco } : {}),
      ...(q.interiorAccess != null ? { interiorAccess: q.interiorAccess } : {}),
      ...(q.needsSurveyInfo != null ? { needsSurveyInfo: q.needsSurveyInfo } : {}),
      ...(q.needsResurvey != null ? { needsResurvey: q.needsResurvey } : {}),
      ...(q.salesChangeRequested != null ? { salesChangeRequested: q.salesChangeRequested } : {}),
      ...(q.salesChangeNotes ? { salesChangeNotes: q.salesChangeNotes } : {}),
      ...(q.opsChangeNotes ? { opsChangeNotes: q.opsChangeNotes } : {}),
      ...(q.customerNotes ? { customerNotes: q.customerNotes } : {}),
      ...(q.operationsNotes ? { operationsNotes: q.operationsNotes } : {}),
      ...(q.designNotes ? { designNotes: q.designNotes } : {}),
      ...(q.conclusion ? { conclusion: q.conclusion } : {}),
    });

    // New escalation deals (not already in session) — fetch snapshots and create items
    const newEscalations = queuedItems.filter(
      (q) => q.queueType === "ESCALATION" && !existingDealIds.has(q.dealId),
    );

    if (newEscalations.length > 0) {
      try {
        const batchResponse = await hubspotClient.crm.deals.batchApi.read({
          inputs: newEscalations.map((e) => ({ id: e.dealId })),
          properties: SNAPSHOT_PROPERTIES,
          propertiesWithHistory: [],
        });
        const dealMap = new Map(
          (batchResponse.results ?? []).map((d) => [d.id, d.properties]),
        );

        const qDeals = [...dealMap.values()].map((p) => ({
          properties: p as Record<string, string | null>,
        }));
        const qOwnerMap = await buildOwnerMap(qDeals);

        for (const esc of newEscalations) {
          const props = dealMap.get(esc.dealId);
          if (!props) continue;

          const snapshot = snapshotDealProperties(
            props as Record<string, string | null>,
            qOwnerMap,
          );

          const item = await prisma.idrMeetingItem.create({
            data: {
              sessionId: session.id,
              dealId: esc.dealId,
              type: "ESCALATION",
              sortOrder: sortOrder++,
              ...snapshot,
              escalationReason: esc.reason,
              ...pickPrepFields(esc),
              addedBy: esc.requestedBy,
            },
          });

          const badge = computeReadinessBadge(snapshot.surveyCompleted, snapshot.plansetDate);
          items.push({ ...item, badge, isReturning: false });
        }
      } catch (err) {
        console.error("[idr-meeting] Failed to fetch escalation deal snapshots:", err);
      }
    }

    // For deals already in session — merge prep/escalation fields
    const existingQueueItems = queuedItems.filter((q) => existingDealIds.has(q.dealId));
    for (const q of existingQueueItems) {
      const existingItem = items.find((i) => i.dealId === q.dealId);
      if (!existingItem) continue;

      const isEscalation = q.queueType === "ESCALATION";
      await prisma.idrMeetingItem.update({
        where: { id: existingItem.id },
        data: {
          ...(isEscalation ? { type: "ESCALATION", escalationReason: q.reason } : {}),
          ...pickPrepFields(q),
        },
      });
    }

    // Mark all consumed
    await prisma.idrEscalationQueue.updateMany({
      where: { id: { in: queuedItems.map((q) => q.id) } },
      data: { status: "CONSUMED", consumedBySession: session.id },
    });
  }

  return NextResponse.json({ session, items }, { status: 201 });
}
