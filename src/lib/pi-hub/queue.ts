/**
 * Parameterized queue fetch for the unified P&I hub — one code path for
 * permit / ic / pto, driven by TEAM_CONFIGS. Ported from
 * lib/permit-hub.ts fetchPermitQueue / lib/ic-hub.ts fetchIcQueue.
 */

import { searchWithRetry } from "@/lib/hubspot";
import { fetchStatusEnteredAt } from "@/lib/status-entered";
import { getEnumLabelMap, labelFor } from "@/lib/hubspot-enum-labels";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { STALE_THRESHOLD_DAYS } from "@/lib/pi-statuses";
import {
  EXCLUDED_STAGES,
  INCLUDED_PIPELINES,
} from "@/lib/daily-focus/config";
import { buildOwnerMap } from "@/lib/idr-meeting";
import { buildStageDisplayMap } from "@/lib/daily-focus/format";
import { TEAM_CONFIGS, groupForQueueDeal } from "./config";
import { resolveLeadName } from "./leads";
import type { QueueItem, Team } from "./types";

/**
 * Safety cap on queue pagination — 10 pages x 200 = 2000 deals, far above the
 * largest real queue (IC ~160). Guards against an unbounded loop if HubSpot
 * keeps returning a cursor; a hit is logged rather than silently truncating.
 */
const MAX_QUEUE_PAGES = 10;

/**
 * Cap on the inspection-section fetch (permit: permit issued, no pto_status).
 * One 100-deal page covers today's backlog with headroom; a hit is logged so
 * the cap gets raised deliberately rather than truncating silently.
 */
const MAX_INSPECTION_DEALS = 100;

/** Returns every non-terminal deal for the team — grouped tabs plus "other". */
export async function fetchQueue(team: Team): Promise<QueueItem[]> {
  const config = TEAM_CONFIGS[team];
  // Scope:
  //   • has the team's status property at all (a deal with none isn't team work)
  //   • status NOT IN terminal
  //   • dealstage NOT IN cancelled/complete/on-hold terminal stages
  //   • pipeline IN Project / D&R / Service / Roofing
  // The `values` arrays are cast because the HubSpot SDK's Filter type only
  // declares `value: string`, but the API (and runtime SDK) accept `values`
  // for IN / NOT_IN — same pattern used in daily-focus/queries.ts.
  const filters: Record<string, unknown>[] = [
    {
      propertyName: "pipeline",
      operator: FilterOperatorEnum.In,
      values: INCLUDED_PIPELINES,
    },
    {
      propertyName: config.statusProperty,
      operator: FilterOperatorEnum.HasProperty,
    },
    {
      propertyName: config.statusProperty,
      operator: FilterOperatorEnum.NotIn,
      values: config.terminalStatuses,
    },
    {
      propertyName: "dealstage",
      operator: FilterOperatorEnum.NotIn,
      values: EXCLUDED_STAGES,
    },
  ];

  // Shared by the main fetch and the inspection-section fetch so the mapped
  // rows are shaped identically.
  const properties = [
    "dealname",
    "address_line_1",
    "city",
    "state",
    "pb_location",
    config.statusProperty,
    "dealstage",
    "pipeline",
    "hs_lastmodifieddate",
    "amount",
    "hubspot_owner_id",
    "project_manager",
    config.leadNameProperty,
    config.roleProperty,
    "calculated_system_size__kwdc_",
  ];

  // HubSpot search returns at most 200 results per page. The IC queue is
  // near the cap today, so page with the `after` cursor rather than
  // silently dropping the tail once a queue grows past 200.
  const searchResults: Array<{
    id: string;
    properties?: Record<string, string | null>;
  }> = [];
  let after: string | undefined;
  let pages = 0;
  do {
    const response = await searchWithRetry({
      filterGroups: [{ filters }],
      properties,
      limit: 200,
      sorts: ["hs_lastmodifieddate"],
      ...(after ? { after } : {}),
    } as unknown as Parameters<typeof searchWithRetry>[0]);

    searchResults.push(
      ...((response.results ?? []) as Array<{
        id: string;
        properties?: Record<string, string | null>;
      }>),
    );
    after = (response as { paging?: { next?: { after?: string } } }).paging?.next
      ?.after;
    pages += 1;
  } while (after && pages < MAX_QUEUE_PAGES);

  if (after) {
    // Never truncate silently — if this fires, raise MAX_QUEUE_PAGES or
    // tighten the status allowlist.
    console.warn(
      `[pi-hub] ${team} queue hit the ${MAX_QUEUE_PAGES}-page cap (${searchResults.length} deals); results are truncated`,
    );
  }

  // Inspection section (permit only today): deals whose permit is issued
  // (status "Complete" — TERMINAL, so the main query above excludes them) but
  // no pto_status exists yet, i.e. nobody downstream owns the deal. Surfaced
  // as real queue rows so inspection_passed approval signals land on a row
  // the team can open. Same filter shape as the approval-scan candidate
  // query (api/cron/approval-scan).
  if (config.inspection) {
    const inspectionResponse = await searchWithRetry({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "pipeline",
              operator: FilterOperatorEnum.In,
              values: INCLUDED_PIPELINES,
            },
            {
              propertyName: config.statusProperty,
              operator: FilterOperatorEnum.Eq,
              value: config.inspection.statusValue,
            },
            {
              // Empty-string enum values read as property-missing, so this
              // also excludes blank (not just absent) statuses.
              propertyName: config.inspection.nextStatusProperty,
              operator: FilterOperatorEnum.NotHasProperty,
            },
            {
              propertyName: "dealstage",
              operator: FilterOperatorEnum.NotIn,
              values: EXCLUDED_STAGES,
            },
          ],
        },
      ],
      // The next-status property rides along so groupForQueueDeal can apply
      // the same missing-pto guard the filter did (defense in depth).
      properties: [...properties, config.inspection.nextStatusProperty],
      limit: MAX_INSPECTION_DEALS,
      sorts: ["hs_lastmodifieddate"],
    } as unknown as Parameters<typeof searchWithRetry>[0]);

    const inspectionResults = (inspectionResponse.results ?? []) as Array<{
      id: string;
      properties?: Record<string, string | null>;
    }>;
    // The main query excludes terminal statuses, so overlap is impossible —
    // but guard anyway so a config change can't produce duplicate rows.
    const seen = new Set(searchResults.map((d) => d.id));
    searchResults.push(...inspectionResults.filter((d) => !seen.has(d.id)));
    if (
      (inspectionResponse as { paging?: { next?: { after?: string } } }).paging
        ?.next?.after
    ) {
      // Never truncate silently — if this fires, raise MAX_INSPECTION_DEALS.
      console.warn(
        `[pi-hub] ${team} inspection section hit the ${MAX_INSPECTION_DEALS}-deal cap; results are truncated`,
      );
    }
  }

  // Resolve owner-id + dealstage-id properties to display names in parallel.
  // buildOwnerMap batches the owners API so this is ~1 extra HubSpot call
  // for the whole queue. buildStageDisplayMap is cached via getStageMaps.
  const rawDeals = searchResults.map((d) => ({
    properties: (d.properties ?? {}) as Record<string, string | null>,
  }));
  // Real time-in-status comes from the status property's history — NOT
  // hs_lastmodifieddate, which a calc-property loop re-stamps daily (every row
  // computed to 0 days). See lib/status-entered.ts.
  const [ownerMap, stageMap, enteredAtByDeal, statusLabels] = await Promise.all([
    buildOwnerMap(rawDeals),
    buildStageDisplayMap(),
    fetchStatusEnteredAt(
      searchResults.map((d) => ({
        id: d.id,
        status: d.properties?.[config.statusProperty] ?? "",
      })),
      config.statusProperty,
    ),
    getEnumLabelMap(config.statusProperty),
  ]);

  const items: QueueItem[] = [];
  const now = Date.now();
  for (const deal of searchResults) {
    const props = (deal.properties ?? {}) as Record<string, string | null>;
    const status = props[config.statusProperty] ?? "";
    const enteredAt = enteredAtByDeal.get(deal.id);
    // null (not 0) when the entry time can't be resolved — the UI shows "—"
    // rather than implying the deal just changed status.
    const daysInStatus =
      enteredAt === undefined
        ? null
        : Math.floor((now - enteredAt) / (1000 * 60 * 60 * 24));

    const pmId = props.project_manager;
    const resolvedPm = pmId ? (ownerMap.get(pmId) ?? pmId) : null;

    items.push({
      dealId: deal.id,
      name: props.dealname ?? "Untitled",
      address: props.address_line_1 ?? null,
      pbLocation: props.pb_location ?? null,
      status,
      statusLabel: labelFor(statusLabels, status),
      dealStage: props.dealstage ? (stageMap[props.dealstage] ?? null) : null,
      // Inspection rows (permit-Complete, no pto_status) group "inspection";
      // everything else via the config status→group map. Safe on main-query
      // rows even though they don't carry pto_status: their status can never
      // equal the terminal inspection statusValue.
      group: groupForQueueDeal(config, props),
      daysInStatus,
      isStale: daysInStatus !== null && daysInStatus > STALE_THRESHOLD_DAYS,
      lead: resolveLeadName(config, props, ownerMap),
      leadOwnerId: props[config.roleProperty] ?? null,
      pm: resolvedPm,
      amount: props.amount ? Number(props.amount) : null,
    });
  }

  // Stalest first; deals with an unknown entry time sort last rather than
  // masquerading as brand new.
  items.sort((a, b) => {
    if (a.daysInStatus === null) return b.daysInStatus === null ? 0 : 1;
    if (b.daysInStatus === null) return -1;
    return b.daysInStatus - a.daysInStatus;
  });
  return items;
}
