import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { fetchAllProjects, searchWithRetry, Project } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { getDealSyncSource } from "@/lib/deal-sync";
import { dealToProject } from "@/lib/deal-reader";
import { prisma } from "@/lib/db";
import { computeOpsScorecard } from "@/lib/ops-scorecard";

export const dynamic = "force-dynamic";

const SCORECARD_TTL = 30 * 60 * 1000; // 30 minutes
const SCORECARD_STALE_TTL = 60 * 60 * 1000;

/**
 * GET /api/ops-scorecard
 *
 * Server-computed Operations Scorecard (see docs/superpowers/specs/
 * 2026-07-18-ops-scorecard-dashboard-design.md). All metric math lives in
 * src/lib/ops-scorecard.ts; this route only sources the full Project
 * population (ALL pipeline stages — completed and cancelled deals are
 * required for historical counts and cancellation cohorts) and caches the
 * result. Access is role-gated by middleware (ADMIN/OWNER wildcard,
 * OPERATIONS_MANAGER, PROJECT_MANAGER).
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

    const { data, cached, stale, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEYS.OPS_SCORECARD,
      async () => {
        const projects = await loadAllProjects();
        return computeOpsScorecard(projects);
      },
      forceRefresh,
      { ttl: SCORECARD_TTL, staleTtl: SCORECARD_STALE_TTL }
    );

    return NextResponse.json(
      { scorecard: data, cached, stale, lastUpdated },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error) {
    Sentry.captureException(error);
    console.error("[ops-scorecard] failed:", error);
    return NextResponse.json(
      { error: "Failed to compute ops scorecard" },
      { status: 500 }
    );
  }
}

/**
 * Full Project-pipeline population (no stage exclusions), honoring the
 * deal-mirror feature flag the same way /api/projects does.
 */
async function loadAllProjects(): Promise<Project[]> {
  const syncSource = await getDealSyncSource("projects");
  if (syncSource === "local" || syncSource === "local-with-verify") {
    const deals = await prisma.deal.findMany({ where: { pipeline: "PROJECT" } });
    const projects = deals.map(dealToProject);
    // The Deal mirror doesn't sync cancellation_date (deal-reader hardcodes
    // cancelledDate: null), but the same-yr cancellation cohorts need it.
    // Overlay it from one scoped HubSpot query covering only cancelled deals.
    const cancelledDates = await fetchCancelledDates();
    for (const p of projects) {
      const d = cancelledDates.get(String(p.id));
      if (d) p.cancelledDate = d;
    }
    return projects;
  }
  const { data } = await appCache.getOrFetch<Project[]>(
    CACHE_KEYS.PROJECTS_ALL,
    () => fetchAllProjects({ activeOnly: false })
  );
  return data || [];
}

const CANCELLED_STAGE_ID = "68229433";

/** dealId → cancellation_date (YYYY-MM-DD) for all cancelled Project-pipeline deals. */
async function fetchCancelledDates(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let after: string | undefined;
  do {
    const response = await searchWithRetry({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: "6900017" },
            { propertyName: "dealstage", operator: FilterOperatorEnum.Eq, value: CANCELLED_STAGE_ID },
          ],
        },
      ],
      properties: ["cancellation_date"],
      limit: 100,
      after,
    });
    for (const deal of response.results) {
      const d = deal.properties.cancellation_date;
      if (d) out.set(deal.id, d.slice(0, 10));
    }
    after = response.paging?.next?.after;
  } while (after);
  return out;
}
