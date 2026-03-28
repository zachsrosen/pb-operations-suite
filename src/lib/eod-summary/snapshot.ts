// src/lib/eod-summary/snapshot.ts
//
// Snapshot save/load and diff logic for the EOD summary email.
// Broad HubSpot queries (no status-value filter) capture all monitored
// deals for each lead each day so the EOD diff can detect any change.

import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { prisma } from "@/lib/db";
import {
  SNAPSHOT_PROPERTIES,
  MONITORED_STATUS_FIELDS,
  FIELD_TO_HS_PROPERTY,
  PI_LEADS,
  DESIGN_LEADS,
  EXCLUDED_STAGES,
  INCLUDED_PIPELINES,
} from "./config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapshotDeal {
  dealId: string;
  dealName: string;
  pipeline: string;
  dealStage: string;
  pbLocation: string | null;
  designStatus: string | null;
  layoutStatus: string | null;
  permittingStatus: string | null;
  interconnectionStatus: string | null;
  ptoStatus: string | null;
}

export interface StatusChange {
  dealId: string;
  dealName: string;
  pipeline: string;
  dealStage: string;
  pbLocation: string | null;
  field: string;
  from: string | null;
  to: string | null;
}

export interface DiffResult {
  changes: StatusChange[];
  newDeals: SnapshotDeal[];
  resolvedDeals: SnapshotDeal[];
}

export interface DiffOptions {
  /** Owner IDs whose HubSpot query failed — deals owned only by these are skipped */
  failedOwnerIds?: Set<string>;
  /** dealId → Set of ownerIds that queried this deal (from evening broad query) */
  dealOwnerMap?: Map<string, Set<string>>;
}

export interface BroadQueryResult {
  /** Merged map of all deals returned by broad queries, keyed by dealId */
  deals: Map<string, SnapshotDeal>;
  /** dealId → roleProperty → ownerId (each row that matched the deal) */
  dealPropertyOwners: Map<string, Map<string, string>>;
  /** dealId → Set of all ownerIds that returned this deal */
  dealOwnerSets: Map<string, Set<string>>;
  /** Owner IDs whose HubSpot query threw an error */
  failedOwnerIds: Set<string>;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function getTodayDenver(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

// ── Pure diff function ────────────────────────────────────────────────────────

/**
 * Compare two deal maps (morning vs evening) and return a DiffResult.
 *
 * - Deals in evening but not morning → newDeals
 * - Deals in both maps with any MONITORED_STATUS_FIELDS difference → changes
 * - Deals in morning but not evening → resolvedDeals (unless an owner's query
 *   failed, which would make the absence a false positive)
 */
export function diffSnapshots(
  morning: Map<string, SnapshotDeal>,
  evening: Map<string, SnapshotDeal>,
  options: DiffOptions = {}
): DiffResult {
  const { failedOwnerIds = new Set<string>(), dealOwnerMap = new Map<string, Set<string>>() } =
    options;

  const changes: StatusChange[] = [];
  const newDeals: SnapshotDeal[] = [];
  const resolvedDeals: SnapshotDeal[] = [];

  // Iterate evening map
  for (const [dealId, eveningDeal] of evening) {
    const morningDeal = morning.get(dealId);
    if (!morningDeal) {
      newDeals.push(eveningDeal);
      continue;
    }

    // Compare all monitored fields
    for (const field of MONITORED_STATUS_FIELDS) {
      const from =
        (morningDeal as unknown as Record<string, string | null>)[field] ?? null;
      const to =
        (eveningDeal as unknown as Record<string, string | null>)[field] ?? null;
      if (from !== to) {
        changes.push({
          dealId,
          dealName: eveningDeal.dealName,
          pipeline: eveningDeal.pipeline,
          dealStage: eveningDeal.dealStage,
          pbLocation: eveningDeal.pbLocation,
          field,
          from,
          to,
        });
      }
    }
  }

  // Iterate morning map for resolved deals
  for (const [dealId, morningDeal] of morning) {
    if (evening.has(dealId)) continue;

    // False-positive guard: if ANY owner returned this deal AND that owner's
    // query failed, the absence might be a query error rather than a true resolve.
    const owners = dealOwnerMap.get(dealId);
    if (owners && owners.size > 0) {
      let anyFailed = false;
      for (const ownerId of owners) {
        if (failedOwnerIds.has(ownerId)) {
          anyFailed = true;
          break;
        }
      }
      if (anyFailed) continue;
    }

    resolvedDeals.push(morningDeal);
  }

  return { changes, newDeals, resolvedDeals };
}

// ── Broad HubSpot query ───────────────────────────────────────────────────────

/**
 * Query deals where roleProperty = ownerId, excluding terminal stages,
 * across all monitored pipelines. No status-value filter — captures all.
 */
async function queryBroadForLead(
  roleProperty: string,
  ownerId: string
): Promise<{ deals: Map<string, SnapshotDeal>; error?: string }> {
  const deals = new Map<string, SnapshotDeal>();

  try {
    let after: string | undefined;

    do {
      const response = await searchWithRetry({
        filterGroups: [
          {
            filters: [
              {
                propertyName: roleProperty,
                operator: FilterOperatorEnum.Eq,
                value: ownerId,
              },
              {
                propertyName: "dealstage",
                operator: FilterOperatorEnum.NotIn,
                values: EXCLUDED_STAGES,
              },
              {
                propertyName: "pipeline",
                operator: FilterOperatorEnum.In,
                values: INCLUDED_PIPELINES,
              },
            ],
          },
        ],
        properties: SNAPSHOT_PROPERTIES,
        limit: 200,
        ...(after ? { after } : {}),
      } as unknown as Parameters<typeof searchWithRetry>[0]);

      for (const deal of response.results ?? []) {
        const p = deal.properties;
        const dealId = p.hs_object_id ?? deal.id;
        deals.set(dealId, {
          dealId,
          dealName: p.dealname ?? "",
          pipeline: p.pipeline ?? "",
          dealStage: p.dealstage ?? "",
          pbLocation: p.pb_location ?? null,
          designStatus: p.design_status ?? null,
          layoutStatus: p.layout_status ?? null,
          permittingStatus: p.permitting_status ?? null,
          interconnectionStatus: p.interconnection_status ?? null,
          ptoStatus: p.pto_status ?? null,
        });
      }

      after = response.paging?.next?.after;
    } while (after);

    return { deals };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[eod-snapshot] Broad query failed: roleProperty=${roleProperty} ownerId=${ownerId}: ${msg}`
    );
    return { deals, error: msg };
  }
}

// ── Orchestrate all broad queries ─────────────────────────────────────────────

/**
 * Run broad queries for all PI leads (by each role they hold) and all design leads.
 * Results are merged into a single deal map.
 */
export async function queryAllBroad(): Promise<BroadQueryResult> {
  const deals = new Map<string, SnapshotDeal>();
  const dealPropertyOwners = new Map<string, Map<string, string>>();
  const dealOwnerSets = new Map<string, Set<string>>();
  const failedOwnerIds = new Set<string>();

  function mergeDeals(
    queryDeals: Map<string, SnapshotDeal>,
    roleProperty: string,
    ownerId: string
  ) {
    for (const [dealId, deal] of queryDeals) {
      // Merge deal into main map (last write wins for the deal data itself)
      deals.set(dealId, deal);

      // Track roleProperty → ownerId mapping
      if (!dealPropertyOwners.has(dealId)) {
        dealPropertyOwners.set(dealId, new Map());
      }
      dealPropertyOwners.get(dealId)!.set(roleProperty, ownerId);

      // Track owner set for false-positive detection
      if (!dealOwnerSets.has(dealId)) {
        dealOwnerSets.set(dealId, new Set());
      }
      dealOwnerSets.get(dealId)!.add(ownerId);
    }
  }

  // PI leads: run a query per role
  for (const lead of PI_LEADS) {
    for (const role of lead.roles) {
      const { deals: queryDeals, error } = await queryBroadForLead(
        role,
        lead.hubspotOwnerId
      );
      if (error) {
        failedOwnerIds.add(lead.hubspotOwnerId);
      }
      mergeDeals(queryDeals, role, lead.hubspotOwnerId);
    }
  }

  // Design leads: roleProperty is "design"
  for (const lead of DESIGN_LEADS) {
    const { deals: queryDeals, error } = await queryBroadForLead(
      "design",
      lead.hubspotOwnerId
    );
    if (error) {
      failedOwnerIds.add(lead.hubspotOwnerId);
    }
    mergeDeals(queryDeals, "design", lead.hubspotOwnerId);
  }

  return { deals, dealPropertyOwners, dealOwnerSets, failedOwnerIds };
}

// ── DB: save snapshot ─────────────────────────────────────────────────────────

/**
 * Upsert today's snapshot rows. One row per (snapshotDate, dealId, ownerId).
 * If a deal was returned by multiple owner queries, the last write wins for
 * the status fields (they should all be identical for the same deal).
 */
export async function saveSnapshot(broadResult: BroadQueryResult): Promise<void> {
  const todayStr = getTodayDenver();
  const snapshotDate = new Date(todayStr + "T00:00:00.000Z");

  const { deals, dealOwnerSets } = broadResult;

  for (const [dealId, deal] of deals) {
    const owners = dealOwnerSets.get(dealId) ?? new Set<string>();
    if (owners.size === 0) continue;

    for (const ownerId of owners) {
      await prisma.dealStatusSnapshot.upsert({
        where: {
          snapshotDate_dealId_ownerId: {
            snapshotDate,
            dealId,
            ownerId,
          },
        },
        update: {
          dealName: deal.dealName,
          pipeline: deal.pipeline,
          dealStage: deal.dealStage,
          pbLocation: deal.pbLocation,
          designStatus: deal.designStatus,
          layoutStatus: deal.layoutStatus,
          permittingStatus: deal.permittingStatus,
          interconnectionStatus: deal.interconnectionStatus,
          ptoStatus: deal.ptoStatus,
        },
        create: {
          snapshotDate,
          dealId,
          ownerId,
          dealName: deal.dealName,
          pipeline: deal.pipeline,
          dealStage: deal.dealStage,
          pbLocation: deal.pbLocation,
          designStatus: deal.designStatus,
          layoutStatus: deal.layoutStatus,
          permittingStatus: deal.permittingStatus,
          interconnectionStatus: deal.interconnectionStatus,
          ptoStatus: deal.ptoStatus,
        },
      });
    }
  }
}

// ── DB: load snapshot ─────────────────────────────────────────────────────────

/**
 * Load today's snapshot from DB.
 * Returns a deal map (latest state per dealId) and a dealOwnerMap.
 */
export async function loadSnapshot(): Promise<{
  deals: Map<string, SnapshotDeal>;
  dealOwnerMap: Map<string, Set<string>>;
}> {
  const todayStr = getTodayDenver();
  const snapshotDate = new Date(todayStr + "T00:00:00.000Z");

  const rows = await prisma.dealStatusSnapshot.findMany({
    where: { snapshotDate },
  });

  const deals = new Map<string, SnapshotDeal>();
  const dealOwnerMap = new Map<string, Set<string>>();

  for (const row of rows) {
    // Merge into deals map (idempotent — same deal fields regardless of owner row)
    if (!deals.has(row.dealId)) {
      deals.set(row.dealId, {
        dealId: row.dealId,
        dealName: row.dealName,
        pipeline: row.pipeline,
        dealStage: row.dealStage,
        pbLocation: row.pbLocation,
        designStatus: row.designStatus,
        layoutStatus: row.layoutStatus,
        permittingStatus: row.permittingStatus,
        interconnectionStatus: row.interconnectionStatus,
        ptoStatus: row.ptoStatus,
      });
    }

    // Build owner set
    if (!dealOwnerMap.has(row.dealId)) {
      dealOwnerMap.set(row.dealId, new Set());
    }
    dealOwnerMap.get(row.dealId)!.add(row.ownerId);
  }

  return { deals, dealOwnerMap };
}

// ── DB: cleanup old snapshots ─────────────────────────────────────────────────

/**
 * Delete snapshot rows older than retentionDays (default 30).
 */
export async function cleanupOldSnapshots(retentionDays = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  cutoff.setHours(0, 0, 0, 0);

  const result = await prisma.dealStatusSnapshot.deleteMany({
    where: {
      snapshotDate: { lt: cutoff },
    },
  });

  return result.count;
}

// Export FIELD_TO_HS_PROPERTY for callers that need property-name mapping
export { FIELD_TO_HS_PROPERTY };
