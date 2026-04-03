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

  // ── Consume queued items (escalations + design reviews) ──
  const queuedItems = await prisma.idrEscalationQueue.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });

  if (queuedItems.length > 0) {
    // Collect deal IDs that aren't already in the session
    const existingDealIds = new Set(items.map((i) => i.dealId));
    const newQueueItems = queuedItems.filter((e) => !existingDealIds.has(e.dealId));

    // Fetch HubSpot snapshots for queued deals not yet in session
    if (newQueueItems.length > 0) {
      try {
        const batchResponse = await hubspotClient.crm.deals.batchApi.read({
          inputs: newQueueItems.map((e) => ({ id: e.dealId })),
          properties: SNAPSHOT_PROPERTIES,
          propertiesWithHistory: [],
        });
        const dealMap = new Map(
          (batchResponse.results ?? []).map((d) => [d.id, d.properties]),
        );

        // Build owner map for queued deals
        const qDeals = [...dealMap.values()].map((p) => ({
          properties: p as Record<string, string | null>,
        }));
        const qOwnerMap = await buildOwnerMap(qDeals);

        for (const q of newQueueItems) {
          const props = dealMap.get(q.dealId);
          if (!props) continue;

          const snapshot = snapshotDealProperties(
            props as Record<string, string | null>,
            qOwnerMap,
          );

          // ESCALATION → type ESCALATION; DESIGN_REVIEW → type IDR (with prefilled notes)
          const isEscalation = q.queueType === "ESCALATION";

          const item = await prisma.idrMeetingItem.create({
            data: {
              sessionId: session.id,
              dealId: q.dealId,
              type: isEscalation ? "ESCALATION" : "IDR",
              sortOrder: sortOrder++,
              ...snapshot,
              escalationReason: isEscalation ? q.reason : null,
              // Carry prefilled notes from the queue
              difficulty: q.difficulty,
              installerCount: q.installerCount,
              installerDays: q.installerDays,
              electricianCount: q.electricianCount,
              electricianDays: q.electricianDays,
              discoReco: q.discoReco,
              interiorAccess: q.interiorAccess,
              customerNotes: q.customerNotes,
              operationsNotes: q.operationsNotes,
              designNotes: q.designNotes ?? (isEscalation ? null : q.reason),
              addedBy: q.requestedBy,
            },
          });

          const badge = computeReadinessBadge(snapshot.surveyCompleted, snapshot.plansetDate);
          items.push({ ...item, badge, isReturning: false });
        }
      } catch (err) {
        console.error("[idr-meeting] Failed to fetch queued deal snapshots:", err);
      }
    }

    // For deals already in session, merge prefilled data
    const existingQueueItems = queuedItems.filter((e) => existingDealIds.has(e.dealId));
    for (const q of existingQueueItems) {
      const existingItem = items.find((i) => i.dealId === q.dealId);
      if (existingItem) {
        const isEscalation = q.queueType === "ESCALATION";
        await prisma.idrMeetingItem.update({
          where: { id: existingItem.id },
          data: {
            // Only upgrade to ESCALATION if it's an escalation queue item
            ...(isEscalation ? { type: "ESCALATION", escalationReason: q.reason } : {}),
            // Merge prefilled notes (don't overwrite if already set)
            ...(q.difficulty != null ? { difficulty: q.difficulty } : {}),
            ...(q.customerNotes ? { customerNotes: q.customerNotes } : {}),
            ...(q.operationsNotes ? { operationsNotes: q.operationsNotes } : {}),
            ...(q.designNotes ? { designNotes: q.designNotes } : {}),
          },
        });
      }
    }

    // Mark all consumed
    await prisma.idrEscalationQueue.updateMany({
      where: { id: { in: queuedItems.map((e) => e.id) } },
      data: { status: "CONSUMED", consumedBySession: session.id },
    });
  }

  return NextResponse.json({ session, items }, { status: 201 });
}
