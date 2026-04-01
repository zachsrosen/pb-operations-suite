// src/lib/daily-focus/queries.ts
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import type { QueryDef } from "./config";
import { EXCLUDED_STAGES, INCLUDED_PIPELINES } from "./config";

// ── Types ──────────────────────────────────────────────────────────────

export interface DealRow {
  dealId: string;
  dealname: string;
  dealstage: string;
  pipeline: string;
  statusValue: string;
  statusProperty: string;
  subsection: "ready" | "resubmit";
}

export interface SectionResult {
  key: string;
  label: string;
  headerColor: { bg: string; border: string; text: string };
  ready: DealRow[];
  resubmit: DealRow[];
  total: number;
  error?: string;
}

// ── Query execution ────────────────────────────────────────────────────

const QUERY_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "dealstage",
  "pipeline",
  "permitting_status",
  "interconnection_status",
  "pto_status",
  "design_status",
  "layout_status",
];

/**
 * The HubSpot SDK TypeScript types only declare `value: string` on Filter,
 * but the API (and the SDK at runtime) supports `values: string[]` for
 * IN / NOT_IN operators. We cast through Record<string, unknown> to match
 * the same pattern used in service/priority-queue.
 */
async function runQuery(
  def: QueryDef,
  ownerId: string,
  statuses: string[],
  subsectionLabel: "ready" | "resubmit"
): Promise<{ rows: DealRow[]; error?: string }> {
  if (statuses.length === 0) return { rows: [] };

  try {
    const rows: DealRow[] = [];
    let after: string | undefined;

    do {
      const filters: Record<string, unknown>[] = [];

      // Owner filter — skip for defs like PE M1/M2 that have no per-lead assignment
      if (!def.skipOwnerFilter) {
        filters.push({
          propertyName: def.roleProperty,
          operator: FilterOperatorEnum.Eq,
          value: ownerId,
        });
      }

      filters.push(
        {
          propertyName: def.statusProperty,
          operator: FilterOperatorEnum.In,
          values: statuses,
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
      );

      const response = await searchWithRetry({
        filterGroups: [{ filters }],
        properties: QUERY_PROPERTIES,
        limit: 200,
        ...(after ? { after } : {}),
      } as unknown as Parameters<typeof searchWithRetry>[0]);

      for (const deal of response.results ?? []) {
        rows.push({
          dealId: deal.properties.hs_object_id ?? deal.id,
          dealname: deal.properties.dealname ?? "",
          dealstage: deal.properties.dealstage ?? "",
          pipeline: deal.properties.pipeline ?? "",
          statusValue: deal.properties[def.statusProperty] ?? "",
          statusProperty: def.statusProperty,
          subsection: subsectionLabel,
        });
      }

      after = response.paging?.next?.after;
    } while (after);

    return { rows };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[daily-focus] Query failed: ${def.key} for owner ${ownerId}: ${msg}`
    );
    return { rows: [], error: msg };
  }
}

/**
 * Execute queries for a single QueryDef + lead.
 * Runs ready and resubmit searches SEQUENTIALLY to respect HubSpot rate limits.
 */
export async function querySection(
  def: QueryDef,
  ownerId: string
): Promise<SectionResult> {
  // Sequential — not Promise.all — to respect HubSpot rate limits
  const readyResult = await runQuery(def, ownerId, def.readyStatuses, "ready");
  const resubResult = await runQuery(
    def,
    ownerId,
    def.resubmitStatuses ?? [],
    "resubmit"
  );

  const error =
    readyResult.error || resubResult.error
      ? [readyResult.error, resubResult.error].filter(Boolean).join("; ")
      : undefined;

  return {
    key: def.key,
    label: def.label,
    headerColor: def.headerColor,
    ready: readyResult.rows,
    resubmit: resubResult.rows,
    total: readyResult.rows.length + resubResult.rows.length,
    error,
  };
}

/**
 * Execute all query definitions for a single lead.
 * For PI leads: skips defs whose roleProperty doesn't match the lead's roles.
 */
export async function queryAllSections(
  defs: QueryDef[],
  ownerId: string,
  leadRoles?: string[]
): Promise<SectionResult[]> {
  const results: SectionResult[] = [];

  for (const def of defs) {
    // Skip if lead doesn't have the required role
    if (leadRoles && !leadRoles.includes(def.roleProperty)) {
      continue;
    }
    // Skip if this def is restricted to specific owners and this lead isn't one of them
    if (def.onlyForOwnerIds && def.onlyForOwnerIds.length > 0 && !def.onlyForOwnerIds.includes(ownerId)) {
      continue;
    }
    results.push(await querySection(def, ownerId));
  }

  return results;
}
