// src/lib/goals-pipeline.ts

/**
 * Goals & Pipeline data fetcher.
 *
 * Orchestrates:
 *   1. Four HubSpot deal searches for monthly department revenue
 *   2. One HubSpot custom object search + association resolution for reviews
 *   3. One HubSpot Location custom object read for pipeline stage counts
 *   4. Prisma OfficeGoal lookup for targets
 *
 * All HubSpot calls run sequentially to respect rate limits.
 */

import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { prisma } from "@/lib/db";
import { LOCATION_OBJECT_TYPE } from "@/lib/hubspot-custom-objects";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  HUBSPOT_LOCATION_IDS,
  PIPELINE_STAGES,
  DEFAULT_TARGETS,
  type GoalsPipelineData,
  type GoalRow,
  type PipelineStageData,
  type PaceColor,
  type GoalMetric,
} from "@/lib/goals-pipeline-types";
import {
  fetchFiveStarReviewsForMonth,
  resolveReviewLocations,
} from "@/lib/hubspot-customer-reviews";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 2,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") ||
          error.message.includes("rate") ||
          error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt + 1) * 550 + Math.random() * 400;
        console.log(
          `[goals-pipeline] Rate limited (attempt ${attempt + 1}), retrying in ${Math.round(delay)}ms...`
        );
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Compute pacing color based on progress vs. month elapsed.
 *
 * paceRatio = progressPercent / elapsedPercent
 *   >= 1.0  → green  (on pace or ahead)
 *   >= 0.75 → yellow (slightly behind)
 *   < 0.75  → red    (significantly behind)
 */
function computePaceColor(
  current: number,
  target: number,
  dayOfMonth: number,
  daysInMonth: number
): PaceColor {
  if (target <= 0) return "green";
  const progressPercent = current / target;
  const elapsedPercent = dayOfMonth / daysInMonth;
  if (elapsedPercent <= 0) return "green";
  const paceRatio = progressPercent / elapsedPercent;
  if (paceRatio >= 1.0) return "green";
  if (paceRatio >= 0.75) return "yellow";
  return "red";
}

function buildGoalRow(
  current: number,
  target: number,
  dayOfMonth: number,
  daysInMonth: number
): GoalRow {
  const percent = target > 0 ? Math.min(Math.round((current / target) * 100), 999) : 0;
  return {
    current,
    target,
    percent,
    color: computePaceColor(current, target, dayOfMonth, daysInMonth),
  };
}

// ---------------------------------------------------------------------------
// Deal revenue queries
// ---------------------------------------------------------------------------

const PROJECT_PIPELINE_ID = "6900017";

/**
 * Search deals with a given date property in the current month for a location.
 * Returns the sum of `amount` and the count of matching deals.
 */
async function queryMonthlyDealRevenue(
  dateProperty: string,
  location: string,
  monthStart: Date,
  monthEnd: Date
): Promise<{ revenue: number; count: number }> {
  let totalRevenue = 0;
  let totalCount = 0;
  let after: string | undefined;

  do {
    const response = await withRetry(() =>
      hubspotClient.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "pipeline",
                operator: FilterOperatorEnum.Eq,
                value: PROJECT_PIPELINE_ID,
              },
              {
                propertyName: dateProperty,
                operator: FilterOperatorEnum.Gte,
                value: String(monthStart.getTime()),
              },
              {
                propertyName: dateProperty,
                operator: FilterOperatorEnum.Lt,
                value: String(monthEnd.getTime()),
              },
              {
                propertyName: "pb_location",
                operator: FilterOperatorEnum.Eq,
                value: location,
              },
            ],
          },
        ],
        properties: ["amount"],
        limit: 200,
        after: after ?? undefined,
        sorts: [],
      })
    );

    for (const deal of response.results) {
      const amount = parseFloat(deal.properties?.amount || "0");
      if (!isNaN(amount)) totalRevenue += amount;
      totalCount++;
    }

    after = response.paging?.next?.after;
  } while (after);

  return { revenue: totalRevenue, count: totalCount };
}

// ---------------------------------------------------------------------------
// Pipeline data from Location custom object
// ---------------------------------------------------------------------------

// LOCATION_OBJECT_TYPE imported from @/lib/hubspot-custom-objects

/** Properties to fetch from the Location custom object for pipeline bars */
const LOCATION_PIPELINE_PROPS = PIPELINE_STAGES.flatMap((s) => [s.countProp, s.currencyProp]);

async function fetchLocationPipelineData(
  locationId: string
): Promise<{ stages: PipelineStageData[]; activePipelineTotal: number }> {
  const response = await withRetry(() =>
    hubspotClient.crm.objects.basicApi.getById(
      LOCATION_OBJECT_TYPE,
      locationId,
      [...LOCATION_PIPELINE_PROPS]
    )
  );

  const props = response.properties as Record<string, string | null>;
  let activePipelineTotal = 0;

  const stages: PipelineStageData[] = PIPELINE_STAGES.map((def) => {
    const count = parseInt(props[def.countProp] || "0", 10) || 0;
    const currency = parseFloat(props[def.currencyProp] || "0") || 0;
    activePipelineTotal += currency;
    return { label: def.label, count, currency, color: def.color };
  });

  return { stages, activePipelineTotal };
}

// ---------------------------------------------------------------------------
// Main fetcher
// ---------------------------------------------------------------------------

export async function getGoalsPipelineData(
  location: string
): Promise<GoalsPipelineData> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(year, month, 0).getDate();

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  // ------ Goals: 4 deal revenue queries (sequential) ------

  const salesResult = await queryMonthlyDealRevenue(
    "closedate", location, monthStart, monthEnd
  );
  await sleep(120);

  const daResult = await queryMonthlyDealRevenue(
    "layout_approval_date", location, monthStart, monthEnd
  );
  await sleep(120);

  const ccResult = await queryMonthlyDealRevenue(
    "construction_complete_date", location, monthStart, monthEnd
  );
  await sleep(120);

  const inspectionResult = await queryMonthlyDealRevenue(
    "inspections_completion_date", location, monthStart, monthEnd
  );
  await sleep(120);

  // ------ Goals: 5-star reviews (cached globally to avoid duplicate fetches across locations) ------

  const reviewCacheKey = CACHE_KEYS.FIVE_STAR_REVIEWS(`${year}-${month}`);
  const { data: reviewLocationCounts } = await appCache.getOrFetch<Record<string, number>>(
    reviewCacheKey,
    async () => {
      const allReviews = await fetchFiveStarReviewsForMonth(month, year);
      const reviewLocations = await resolveReviewLocations(allReviews);

      // Count per location
      const counts: Record<string, number> = {};
      for (const loc of reviewLocations.values()) {
        counts[loc] = (counts[loc] || 0) + 1;
      }
      return counts;
    },
    false
  );

  const reviewCount = reviewLocationCounts[location] || 0;

  // ------ Goal targets from DB (falls back to defaults if DB unavailable) ------

  let targetMap = new Map<string, number>();
  if (prisma) {
    try {
      const goalRecords = await prisma.officeGoal.findMany({
        where: { location, month, year },
      });
      targetMap = new Map(goalRecords.map((g) => [g.metric, g.target]));
    } catch (err) {
      console.error("[goals-pipeline] Failed to fetch OfficeGoal records, using defaults:", err);
    }
  }

  const defaults = DEFAULT_TARGETS[location] ?? DEFAULT_TARGETS["Westminster"];

  function getTarget(metric: GoalMetric): number {
    return targetMap.get(metric) ?? defaults[metric];
  }

  // ------ Build goal rows ------

  const goals = {
    sales: buildGoalRow(salesResult.revenue, getTarget("sales_revenue"), dayOfMonth, daysInMonth),
    da: buildGoalRow(daResult.revenue, getTarget("da_revenue"), dayOfMonth, daysInMonth),
    cc: buildGoalRow(ccResult.revenue, getTarget("cc_revenue"), dayOfMonth, daysInMonth),
    inspections: buildGoalRow(inspectionResult.revenue, getTarget("inspection_revenue"), dayOfMonth, daysInMonth),
    reviews: buildGoalRow(reviewCount, getTarget("five_star_reviews"), dayOfMonth, daysInMonth),
  };

  // ------ Pipeline: Location custom object ------

  const locationId = HUBSPOT_LOCATION_IDS[location];
  let pipeline: GoalsPipelineData["pipeline"];

  if (locationId) {
    const pipelineData = await fetchLocationPipelineData(locationId);
    pipeline = {
      stages: pipelineData.stages,
      activePipelineTotal: pipelineData.activePipelineTotal,
      monthlySales: salesResult.revenue,
      monthlySalesCount: salesResult.count,
    };
  } else {
    // Fallback: empty pipeline if location not mapped
    pipeline = {
      stages: PIPELINE_STAGES.map((def) => ({
        label: def.label,
        count: 0,
        currency: 0,
        color: def.color,
      })),
      activePipelineTotal: 0,
      monthlySales: salesResult.revenue,
      monthlySalesCount: salesResult.count,
    };
  }

  return {
    location,
    month,
    year,
    daysInMonth,
    dayOfMonth,
    goals,
    pipeline,
    lastUpdated: new Date().toISOString(),
  };
}
