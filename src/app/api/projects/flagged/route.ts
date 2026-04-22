import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { fetchAllProjects, searchWithRetry } from "@/lib/hubspot";
import { dealToProject } from "@/lib/deal-reader";
import { getDealSyncSource, formatStaleness } from "@/lib/deal-sync";
import { prisma } from "@/lib/db";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

const PROJECT_PIPELINE_ID = "6900017";

/**
 * Returns every PROJECT-pipeline deal where `system_performance_review = true`,
 * across ALL stages — including PTO'd / closed deals that the generic
 * `/api/projects?context=executive` endpoint excludes via its active-only filter.
 *
 * Most production issues are discovered AFTER PTO (the system's been running
 * long enough to observe underperformance), so the Production Issues dashboard
 * must see inactive-stage deals or it reports an artificially low count.
 *
 * Result set is small (dozens at most). No pagination; 5-minute client cache
 * via React Query.
 *
 * ?debug=1 adds cross-check fields: total PROJECT deals mirrored, per-stage
 * distribution of flagged deals, and a live HubSpot count for mirror-vs-source
 * drift detection.
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);

  try {
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.API_SECRET_TOKEN;
    if (expectedToken && authHeader && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const debug = request.nextUrl.searchParams.get("debug") === "1";
    const syncSource = await getDealSyncSource("projects");

    // Local-DB path (deal-mirror). Fast — O(flagged) where flagged is ~dozens.
    if (syncSource === "local" || syncSource === "local-with-verify") {
      const deals = await prisma.deal.findMany({
        where: { pipeline: "PROJECT", systemPerformanceReview: "true" },
      });
      const projects = deals.map(dealToProject);

      const lastSyncLog = await prisma.dealSyncLog.findFirst({
        where: { source: { startsWith: "batch:PROJECT" }, status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const lastSyncedAt = lastSyncLog?.createdAt ?? new Date();

      const body: Record<string, unknown> = {
        projects,
        count: projects.length,
        lastUpdated: lastSyncedAt.toISOString(),
        sync: {
          source: syncSource,
          lastSyncedAt: lastSyncedAt.toISOString(),
          staleness: formatStaleness(lastSyncedAt),
        },
      };

      if (debug) {
        const totalProjectDeals = await prisma.deal.count({ where: { pipeline: "PROJECT" } });

        // Distribution of flagged deals by (current) stage string — answers
        // "are they clustered in a stage we'd expect to see, or missing?"
        const stageCounts: Record<string, number> = {};
        for (const p of projects) {
          stageCounts[p.stage] = (stageCounts[p.stage] ?? 0) + 1;
        }

        // Live cross-check against HubSpot: how many deals does HubSpot itself
        // report as flagged, right now? If this differs from local count,
        // the mirror is stale.
        let hubspotLiveCount: number | { error: string };
        try {
          const res = await searchWithRetry({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "pipeline",
                    operator: FilterOperatorEnum.Eq,
                    value: PROJECT_PIPELINE_ID,
                  },
                  {
                    propertyName: "system_performance_review",
                    operator: FilterOperatorEnum.Eq,
                    value: "true",
                  },
                ],
              },
            ],
            properties: ["hs_object_id"],
            limit: 1,
          });
          hubspotLiveCount = res.total ?? 0;
        } catch (err) {
          hubspotLiveCount = { error: err instanceof Error ? err.message : String(err) };
        }

        body.debug = {
          totalProjectDealsInMirror: totalProjectDeals,
          flaggedCountInMirror: projects.length,
          hubspotLiveFlaggedCount: hubspotLiveCount,
          stageDistribution: stageCounts,
          note: typeof hubspotLiveCount === "number" && hubspotLiveCount !== projects.length
            ? `MIRROR DRIFT: HubSpot reports ${hubspotLiveCount} flagged deals but local mirror has ${projects.length}. Wait for next deal-sync cron or trigger a full sync.`
            : "Mirror and HubSpot agree.",
        };
      }

      return NextResponse.json(body);
    }

    // HubSpot fallback: pull the full deal set (no active-only) and filter.
    if (!process.env.HUBSPOT_ACCESS_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "HUBSPOT_ACCESS_TOKEN not configured" },
        { status: 500 }
      );
    }

    const all = await fetchAllProjects({ activeOnly: false });
    const flagged = all.filter((p) => p.systemPerformanceReview === true);

    return NextResponse.json({
      projects: flagged,
      count: flagged.length,
      lastUpdated: new Date().toISOString(),
      sync: { source: syncSource, lastSyncedAt: new Date().toISOString(), staleness: "just now" },
    });
  } catch (error) {
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
