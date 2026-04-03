import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isIdrAllowedRole,
  fetchInitialReviewDeals,
  snapshotDealProperties,
  computeReadinessBadge,
  buildOwnerMap,
} from "@/lib/idr-meeting";

/**
 * GET /api/idr-meeting/preview
 *
 * Returns live Initial Review deals from HubSpot shaped as preview items.
 * No session is created — this is a read-only preview for the landing state.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const deals = await fetchInitialReviewDeals();
  const ownerMap = await buildOwnerMap(deals);

  let sortOrder = 0;
  const items = deals.map((deal) => {
    const snapshot = snapshotDealProperties(deal.properties, ownerMap);
    const badge = computeReadinessBadge(snapshot.surveyCompleted, snapshot.plansetDate);

    return {
      id: `preview-${deal.dealId}`,
      sessionId: "",
      dealId: deal.dealId,
      type: "IDR" as const,
      ...snapshot,
      sortOrder: sortOrder++,
      snapshotUpdatedAt: new Date().toISOString(),
      difficulty: null,
      installerCount: null,
      installerDays: null,
      electricianCount: null,
      electricianDays: null,
      discoReco: null,
      interiorAccess: null,
      needsSurveyInfo: null,
      needsResurvey: null,
      salesChangeRequested: null,
      salesChangeNotes: null,
      opsChangeNotes: null,
      customerNotes: null,
      operationsNotes: null,
      designNotes: null,
      conclusion: null,
      escalationReason: null,
      hubspotSyncStatus: "DRAFT" as const,
      hubspotSyncedAt: null,
      addedBy: "preview",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      badge,
      isReturning: false,
    };
  });

  return NextResponse.json({ items });
}
