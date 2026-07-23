/**
 * Parameterized queue fetch for the design hub — one code path for both tabs,
 * driven by TAB_CONFIGS. Ported from lib/pi-hub/queue.ts.
 */

import { searchWithRetry } from "@/lib/hubspot";
import { fetchStatusEnteredAt } from "@/lib/status-entered";
import { getEnumLabelMap, labelFor } from "@/lib/hubspot-enum-labels";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { STALE_THRESHOLD_DAYS } from "@/lib/pi-statuses";
import { EXCLUDED_STAGES, INCLUDED_PIPELINES } from "@/lib/daily-focus/config";
import { buildOwnerMap } from "@/lib/idr-meeting";
import { buildStageDisplayMap } from "@/lib/daily-focus/format";
import { TAB_CONFIGS, groupForStatus, subGroupForStatus } from "./config";
import { resolveDesignLead } from "./leads";
import type { QueueItem, Tab } from "./types";

/**
 * Safety cap on queue pagination — 10 pages x 200 = 2000 deals, well above any
 * real design queue. Guards against an unbounded loop if HubSpot keeps
 * returning a cursor; a hit is logged rather than silently truncating.
 */
const MAX_QUEUE_PAGES = 10;

/** Returns every non-terminal deal for the tab, grouped and sub-grouped. */
export async function fetchQueue(tab: Tab): Promise<QueueItem[]> {
  const config = TAB_CONFIGS[tab];
  // Scope:
  //   • has the tab's status property at all (no status ⇒ not design work yet)
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

  const properties = [
    "dealname",
    "address_line_1",
    "city",
    "state",
    "pb_location",
    config.statusProperty,
    config.otherStatusProperty,
    "dealstage",
    "pipeline",
    "amount",
    "hubspot_owner_id",
    "project_manager",
    config.roleProperty,
    "calculated_system_size__kwdc_",
  ];

  // HubSpot search returns at most 200 results per page — page with the
  // `after` cursor rather than silently dropping the tail.
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
    // Never truncate silently — if this fires, raise MAX_QUEUE_PAGES.
    console.warn(
      `[design-hub] ${tab} queue hit the ${MAX_QUEUE_PAGES}-page cap (${searchResults.length} deals); results are truncated`,
    );
  }

  // Resolve owner-id / enum / dealstage-id properties to display names in
  // parallel. buildOwnerMap batches the owners API AND resolves the `design`
  // enum property's option labels, so this is ~1 extra call for the queue.
  const rawDeals = searchResults.map((d) => ({
    properties: (d.properties ?? {}) as Record<string, string | null>,
  }));
  // Real time-in-status comes from the status property's history — NOT
  // hs_lastmodifieddate, which a calc-property loop re-stamps daily (every row
  // would compute to 0 days). See lib/status-entered.ts.
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
      group: groupForStatus(config, status),
      subGroup: subGroupForStatus(config, status),
      daysInStatus,
      isStale: daysInStatus !== null && daysInStatus > STALE_THRESHOLD_DAYS,
      lead: resolveDesignLead(config, props, ownerMap),
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
