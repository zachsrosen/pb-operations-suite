/**
 * Revenue Goals — Server-only module
 *
 * Queries HubSpot for deal data and assembles the RevenueGoalResponse.
 * Imports server-only dependencies (hubspot.ts).
 */

import { searchWithRetry } from "./hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { zuper } from "./zuper";
import { getCompletedTimeFromHistory } from "./compliance-helpers";
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
  // HubSpot date property filters require millisecond timestamps
  const startDate = String(new Date(`${year}-01-01T00:00:00Z`).getTime());
  const endDate = String(new Date(`${year}-12-31T23:59:59Z`).getTime());

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
// Zuper-based revenue recognition
// ---------------------------------------------------------------------------

/**
 * Extract HubSpot deal ID from a Zuper job using multiple fallback methods.
 * Priority: external_id > job_tags > custom_fields
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractHubspotDealId(job: any): string | null {
  // 1. external_id.hubspot_deal
  const ext = job.external_id || {};
  if (ext.hubspot_deal) {
    const id = String(ext.hubspot_deal).trim();
    if (id) return id;
  }

  // 2. job_tags: match "hubspot-{dealId}" pattern
  if (Array.isArray(job.job_tags)) {
    for (const tag of job.job_tags) {
      const tagMatch = String(tag).match(/^hubspot-(\d+)$/i);
      if (tagMatch?.[1]) return tagMatch[1];
    }
  }

  // 3. custom_fields: find field named "hubspot_deal_id"
  const customFields = job.custom_fields;
  if (Array.isArray(customFields)) {
    const field = customFields.find((f: { label?: string; name?: string }) => {
      const label = String(f?.label || "").toLowerCase();
      const name = String(f?.name || "").toLowerCase();
      return label === "hubspot_deal_id" || name === "hubspot_deal_id"
        || label === "hubspot deal id" || name === "hubspot deal id";
    });
    if (field?.value) {
      const numericMatch = String(field.value).trim().match(/\b\d{6,}\b/);
      if (numericMatch) return numericMatch[0];
    }
  } else if (customFields && typeof customFields === "object") {
    const val = (customFields as Record<string, unknown>).hubspot_deal_id;
    if (val) {
      const numericMatch = String(val).trim().match(/\b\d{6,}\b/);
      if (numericMatch) return numericMatch[0];
    }
  }

  return null;
}

/**
 * Fetch completed Zuper jobs for the target year and resolve deal amounts.
 * Returns monthly actuals keyed by revenue group key.
 *
 * Deduplicates by deal ID — if a deal has both a SERVICE_VISIT and
 * SERVICE_REVISIT, only the earliest completion counts.
 */
export async function fetchZuperCompletedRevenue(
  year: number
): Promise<Record<string, number[]>> {
  const result: Record<string, number[]> = {};

  // Collect all zuper_completed rules across groups
  const zuperRules: {
    groupKey: string;
    pipelineId: string;
    categoryUids: string[];
  }[] = [];

  for (const [key, config] of Object.entries(REVENUE_GROUPS)) {
    result[key] = Array(12).fill(0);
    for (const rule of config.recognition) {
      if (rule.strategy === "zuper_completed" && rule.zuperCategoryUids?.length) {
        zuperRules.push({
          groupKey: key,
          pipelineId: rule.pipelineId,
          categoryUids: rule.zuperCategoryUids,
        });
      }
    }
  }

  if (zuperRules.length === 0) return result;

  // Fetch completed jobs for each category, collect (dealId, completionMonth) pairs
  // Deduplicate per deal — earliest completion wins
  const dealCompletions = new Map<string, { groupKey: string; month: number }>();

  for (const rule of zuperRules) {
    for (const categoryUid of rule.categoryUids) {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        // Widen search window by 3 months before the target year to catch
        // jobs scheduled late in the prior year but completed in the target year.
        // Completion date filtering happens below via getCompletedTimeFromHistory().
        const response = await zuper.searchJobs({
          category: categoryUid,
          from_date: `${year - 1}-10-01`,
          to_date: `${year}-12-31`,
          page,
          limit: 100,
        });

        if (response.type !== "success" || !response.data?.jobs?.length) {
          hasMore = false;
          break;
        }

        for (const job of response.data.jobs) {
          // Get completion date from status history
          const completedTime = getCompletedTimeFromHistory(job);
          if (!completedTime) continue;
          if (completedTime.getUTCFullYear() !== year) continue;

          const dealId = extractHubspotDealId(job);
          if (!dealId) continue;

          const month = completedTime.getUTCMonth(); // 0-indexed for array access

          // Deduplicate: only keep earliest completion per deal
          const existing = dealCompletions.get(dealId);
          if (!existing || month < existing.month) {
            dealCompletions.set(dealId, { groupKey: rule.groupKey, month });
          }
        }

        // Paginate
        if (response.data.jobs.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }
  }

  if (dealCompletions.size === 0) return result;

  // Batch-fetch deal properties from HubSpot (IN operator, 100 at a time)
  // Include pipeline + dealstage so we can enforce source filters and cancellation rules
  const dealIds = Array.from(dealCompletions.keys());
  const dealProps = new Map<string, { amount: number; pipeline: string; dealstage: string }>();

  for (let i = 0; i < dealIds.length; i += 100) {
    const batch = dealIds.slice(i, i + 100);
    const response = await searchWithRetry({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hs_object_id",
              operator: FilterOperatorEnum.In,
              values: batch,
            },
          ],
        },
      ],
      properties: ["hs_object_id", "amount", "pipeline", "dealstage"],
      limit: 100,
    });

    for (const deal of response.results ?? []) {
      const id = deal.properties.hs_object_id;
      const amount = parseFloat(deal.properties.amount || "0") || 0;
      if (id && amount > 0) {
        dealProps.set(id, {
          amount,
          pipeline: deal.properties.pipeline || "",
          dealstage: deal.properties.dealstage || "",
        });
      }
    }
  }

  // Assign revenue to monthly buckets, enforcing pipeline and cancellation filters
  for (const [dealId, { groupKey, month }] of dealCompletions) {
    const deal = dealProps.get(dealId);
    if (!deal || deal.amount <= 0) continue;

    const groupConfig = REVENUE_GROUPS[groupKey];
    if (!groupConfig) continue;

    // Verify deal's pipeline matches one of the group's configured pipelines
    const matchingRule = groupConfig.recognition.find(
      (r) => r.strategy === "zuper_completed" && r.pipelineId === deal.pipeline
    );
    if (!matchingRule) continue;

    // Verify deal isn't in a cancelled/excluded stage
    if (groupConfig.excludedStages.includes(deal.dealstage)) continue;

    if (result[groupKey]) {
      result[groupKey][month] += deal.amount;
    }
  }

  return result;
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
  now: Date = new Date(),
  zuperActuals?: Record<string, number[]>
): RevenueGoalResponse {
  const closedMonths = getClosedMonthCount(now);
  const aggregated = aggregateRevenue(deals, REVENUE_GROUPS, year);

  // Merge Zuper actuals into aggregated HubSpot actuals
  if (zuperActuals) {
    for (const [key, monthlyActuals] of Object.entries(zuperActuals)) {
      if (!aggregated[key]) {
        aggregated[key] = { monthlyActuals: [...monthlyActuals] };
      } else {
        for (let i = 0; i < 12; i++) {
          aggregated[key].monthlyActuals[i] += monthlyActuals[i];
        }
      }
    }
  }

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
