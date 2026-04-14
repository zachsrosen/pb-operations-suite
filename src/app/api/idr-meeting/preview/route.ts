import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import {
  isIdrAllowedRole,
  fetchInitialReviewDeals,
  snapshotDealProperties,
  computeReadinessBadge,
  buildOwnerMap,
  SNAPSHOT_PROPERTIES,
} from "@/lib/idr-meeting";
import { hubspotClient } from "@/lib/hubspot";

/**
 * GET /api/idr-meeting/preview
 *
 * Returns live Initial Review deals from HubSpot + queued escalations,
 * with any saved prep data merged in. This is the landing/prep state.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch IDR deals + queued items in parallel
  const [deals, queuedItems] = await Promise.all([
    fetchInitialReviewDeals(),
    prisma.idrEscalationQueue.findMany({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const ownerMap = await buildOwnerMap(deals);

  // Separate escalation items (new deals) from prep records (field edits on existing deals)
  const escalations = queuedItems.filter((q) => q.queueType === "ESCALATION");
  const preps = queuedItems.filter((q) => q.queueType === "PREP");

  // Build prep lookup by dealId
  const prepByDeal = new Map(preps.map((p) => [p.dealId, p]));

  // Build IDR items from HubSpot deals
  const existingDealIds = new Set(deals.map((d) => d.dealId));
  let sortOrder = 0;

  const items = deals.map((deal) => {
    const snapshot = snapshotDealProperties(deal.properties, ownerMap);
    const badge = computeReadinessBadge(snapshot.surveyCompleted, snapshot.plansetDate);
    const prep = prepByDeal.get(deal.dealId);

    return {
      id: `preview-${deal.dealId}`,
      sessionId: "",
      dealId: deal.dealId,
      type: "IDR" as "IDR" | "ESCALATION",
      ...snapshot,
      sortOrder: sortOrder++,
      snapshotUpdatedAt: new Date().toISOString(),
      // Merge prep data if available, otherwise null
      difficulty: prep?.difficulty ?? null,
      installerCount: prep?.installerCount ?? null,
      installerDays: prep?.installerDays ?? null,
      electricianCount: prep?.electricianCount ?? null,
      electricianDays: prep?.electricianDays ?? null,
      discoReco: prep?.discoReco ?? null,
      interiorAccess: prep?.interiorAccess ?? null,
      needsSurveyInfo: prep?.needsSurveyInfo ?? null,
      needsResurvey: prep?.needsResurvey ?? null,
      salesChangeRequested: prep?.salesChangeRequested ?? null,
      salesChangeNotes: prep?.salesChangeNotes ?? null,
      opsChangeNotes: prep?.opsChangeNotes ?? null,
      customerNotes: prep?.customerNotes ?? null,
      operationsNotes: prep?.operationsNotes ?? null,
      designNotes: prep?.designNotes ?? null,
      conclusion: prep?.conclusion ?? null,
      escalationReason: null as string | null,
      tags: snapshot.tags,
      reviewed: false,
      shitShowFlagged: false,
      shitShowReason: null as string | null,
      hubspotSyncStatus: "DRAFT" as const,
      hubspotSyncedAt: null,
      addedBy: "preview",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      badge,
      isReturning: false,
    };
  });

  // Add escalation items (deals not already in the IDR list)
  const newEscalations = escalations.filter((e) => !existingDealIds.has(e.dealId));
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

      const escDeals = [...dealMap.values()].map((p) => ({
        properties: p as Record<string, string | null>,
      }));
      const escOwnerMap = await buildOwnerMap(escDeals);

      for (const esc of newEscalations) {
        const props = dealMap.get(esc.dealId);
        if (!props) continue;

        const snapshot = snapshotDealProperties(
          props as Record<string, string | null>,
          escOwnerMap,
        );
        const badge = computeReadinessBadge(snapshot.surveyCompleted, snapshot.plansetDate);

        items.push({
          id: `preview-${esc.dealId}`,
          sessionId: "",
          dealId: esc.dealId,
          type: "ESCALATION" as const,
          ...snapshot,
          sortOrder: sortOrder++,
          snapshotUpdatedAt: new Date().toISOString(),
          difficulty: esc.difficulty ?? null,
          installerCount: esc.installerCount ?? null,
          installerDays: esc.installerDays ?? null,
          electricianCount: esc.electricianCount ?? null,
          electricianDays: esc.electricianDays ?? null,
          discoReco: esc.discoReco ?? null,
          interiorAccess: esc.interiorAccess ?? null,
          needsSurveyInfo: esc.needsSurveyInfo ?? null,
          needsResurvey: esc.needsResurvey ?? null,
          salesChangeRequested: esc.salesChangeRequested ?? null,
          salesChangeNotes: esc.salesChangeNotes ?? null,
          opsChangeNotes: esc.opsChangeNotes ?? null,
          customerNotes: esc.customerNotes ?? null,
          operationsNotes: esc.operationsNotes ?? null,
          designNotes: esc.designNotes ?? null,
          conclusion: esc.conclusion ?? null,
          escalationReason: esc.reason,
          tags: snapshot.tags,
          reviewed: false,
          shitShowFlagged: false,
          shitShowReason: null as string | null,
          hubspotSyncStatus: "DRAFT" as const,
          hubspotSyncedAt: null,
          addedBy: esc.requestedBy,
          createdAt: esc.createdAt.toISOString(),
          updatedAt: esc.updatedAt.toISOString(),
          badge,
          isReturning: false,
        });
      }
    } catch (err) {
      console.error("[idr-meeting] Failed to fetch escalation deal snapshots for preview:", err);
    }
  }

  // Also handle escalation items for deals already in the list — upgrade to ESCALATION type
  const existingEscalations = escalations.filter((e) => existingDealIds.has(e.dealId));
  for (const esc of existingEscalations) {
    const existing = items.find((i) => i.dealId === esc.dealId);
    if (existing) {
      existing.type = "ESCALATION";
      existing.escalationReason = esc.reason;
    }
  }

  return NextResponse.json({ items });
}
