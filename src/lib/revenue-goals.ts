/**
 * Revenue Goals — Server-only module
 *
 * Queries HubSpot for deal data and assembles the RevenueGoalResponse.
 * Imports server-only dependencies (hubspot.ts).
 */

import { searchWithRetry } from "./hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  REVENUE_GROUPS,
  getClosedMonthCount,
  computeEffectiveTargets,
  computePaceStatus,
  aggregateRevenue,
  type DealLike,
  type RevenueGoalResponse,
  type RevenueGroupResult,
} from "./revenue-groups-config";

// Re-export for API route consumers
export { REVENUE_GROUPS, type RevenueGoalResponse };

// ---------------------------------------------------------------------------
// HubSpot deal properties needed for revenue recognition
// ---------------------------------------------------------------------------

export const REVENUE_DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "pipeline",
  "dealstage",
  "pb_location",
  "closedate",
  "construction_complete_date",
  "detach_completion_date",
  "reset_completion_date",
];

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

/**
 * Fetch all deals from revenue-relevant pipelines for a given calendar year.
 * Queries each pipeline separately to stay within HubSpot filter group limits.
 */
export async function fetchRevenueDeals(year: number): Promise<DealLike[]> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // Build per-pipeline filter groups scoped to recognition date fields.
  // Each unique (pipelineId, dateField) pair produces one OR filter group:
  //   pipeline = X AND dateField >= startDate AND dateField <= endDate
  // Gated strategies are skipped entirely (no real date field yet).
  // Deduplication prevents redundant filter groups (e.g. 4 solar groups
  // all using construction_complete_date on the project pipeline).
  const seen = new Set<string>();
  const filterGroups: { filters: { propertyName: string; operator: typeof FilterOperatorEnum.Eq; value: string }[] }[] = [];

  for (const group of Object.values(REVENUE_GROUPS)) {
    for (const rule of group.recognition) {
      if (rule.strategy === "gated") continue;

      const dateFields: string[] = [];
      if (rule.strategy === "split" && rule.splitFields) {
        for (const [field] of rule.splitFields) {
          dateFields.push(field);
        }
      } else if (rule.dateField) {
        dateFields.push(rule.dateField);
      }

      for (const dateField of dateFields) {
        const dedupeKey = `${rule.pipelineId}:${dateField}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        filterGroups.push({
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: rule.pipelineId },
            { propertyName: dateField, operator: FilterOperatorEnum.Gte, value: startDate },
            { propertyName: dateField, operator: FilterOperatorEnum.Lte, value: endDate },
          ],
        });
      }
    }
  }

  const allDeals: DealLike[] = [];
  const seenIds = new Set<string>();

  // Single paginated query with all deduplicated filter groups as OR clauses
  let after: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await searchWithRetry({
      filterGroups,
      properties: REVENUE_DEAL_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    });

    const results = response.results ?? [];
    for (const result of results) {
      const id = result.properties.hs_object_id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        allDeals.push(result.properties as unknown as DealLike);
      }
    }

    const nextAfter = response.paging?.next?.after;
    if (nextAfter && results.length > 0) {
      after = nextAfter;
    } else {
      hasMore = false;
    }
  }

  return allDeals;
}

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

/**
 * Build the full RevenueGoalResponse from fetched deals.
 *
 * @param year           - Calendar year
 * @param deals          - Raw deals from fetchRevenueDeals()
 * @param baseTargetsMap - Optional per-group override of monthly targets
 *                         (defaults to annualTarget / 12 spread evenly)
 * @param now            - Current timestamp (injectable for testing)
 */
export function buildRevenueGoalResponse(
  year: number,
  deals: DealLike[],
  baseTargetsMap?: Record<string, number[]>,
  now: Date = new Date()
): RevenueGoalResponse {
  const closedMonths = getClosedMonthCount(now);
  const aggregated = aggregateRevenue(deals, REVENUE_GROUPS, year);

  const currentMonth = now.getUTCMonth(); // 0-indexed
  const groups: RevenueGroupResult[] = [];

  let companyYtdActual = 0;
  let companyYtdExpected = 0;
  let companyAnnualTarget = 0;

  for (const [key, config] of Object.entries(REVENUE_GROUPS)) {
    const monthly = config.annualTarget / 12;
    const baseTargets =
      baseTargetsMap?.[key] ?? Array(12).fill(monthly);

    const actuals = aggregated[key]?.monthlyActuals ?? Array(12).fill(0);

    const effectiveTargets = computeEffectiveTargets(
      baseTargets,
      actuals,
      closedMonths
    );

    // Determine if this group has any gated recognition rules
    const discoveryGated = config.recognition.some(
      (r) => r.strategy === "gated"
    );

    // Build per-month results with hit/miss/closed/currentMonthOnTarget
    const months = baseTargets.map((base, i) => {
      const closed = i < closedMonths;
      const actual = actuals[i];
      const effectiveTarget = effectiveTargets[i];
      return {
        month: i + 1, // 1-indexed (Jan=1, Dec=12)
        actual,
        baseTarget: base,
        effectiveTarget,
        closed,
        hit: closed && actual >= effectiveTarget,
        missed: closed && actual < effectiveTarget,
        currentMonthOnTarget:
          i === currentMonth && !closed && actual >= effectiveTarget,
      };
    });

    // YTD actual = sum through current month (closed + partial current)
    const ytdMonths = closedMonths + 1; // include current (partial) month
    const ytdActual = actuals
      .slice(0, ytdMonths)
      .reduce((s, v) => s + v, 0);

    // Pace = straight-line based on closed months only (spec: closedMonths/12 * annual)
    const ytdPaceExpected = (closedMonths / 12) * config.annualTarget;

    const paceStatus = computePaceStatus(ytdActual, ytdPaceExpected);

    groups.push({
      groupKey: key,
      displayName: config.label,
      color: config.color,
      annualTarget: config.annualTarget,
      ytdActual,
      ytdPaceExpected,
      paceStatus,
      discoveryGated,
      months,
    });

    companyYtdActual += ytdActual;
    companyYtdExpected += ytdPaceExpected;
    companyAnnualTarget += config.annualTarget;
  }

  return {
    year,
    lastUpdated: now.toISOString(),
    groups,
    companyTotal: {
      annualTarget: companyAnnualTarget,
      ytdActual: companyYtdActual,
      ytdPaceExpected: companyYtdExpected,
      paceStatus: computePaceStatus(companyYtdActual, companyYtdExpected),
    },
  };
}
