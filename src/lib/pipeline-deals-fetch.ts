/**
 * Server-only generic cross-pipeline deal fetch.
 *
 * Kept OUT of deals-pipeline.ts because that module is imported by
 * client-reachable code (e.g. src/app/page.tsx uses ACTIVE_STAGES); pulling
 * the @hubspot/api-client codegen (which references node:module) into that
 * graph breaks the Turbopack client build. This file is imported only by
 * server code (the bot's query_projects tool).
 */
import {
  PIPELINE_IDS,
  DEAL_PROPERTIES,
  getStageMaps,
  getActiveStages,
} from "@/lib/deals-pipeline";


// ---------------------------------------------------------------------------
// Generic cross-pipeline deal fetch (common fields only)
// ---------------------------------------------------------------------------

/** A deal from any pipeline, reduced to the fields shared across pipelines. */
export interface PipelineDeal {
  id: string;
  name: string;
  projectNumber: string;
  stage: string; // resolved display name
  amount: number;
  dealOwner: string; // resolved owner name
  pbLocation: string;
  closeDate: string | null; // YYYY-MM-DD
  url: string;
  pipeline: string; // pipeline key (sales|dnr|roofing|service|project)
}

function toYmd(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (s.includes("T")) return s.split("T")[0];
  if (/^\d{10,}$/.test(s)) {
    // epoch millis
    const iso = new Date(Number(s)).toISOString();
    return iso.split("T")[0];
  }
  return s.slice(0, 10);
}

/**
 * Fetch every deal in a non-project pipeline (sales/dnr/roofing/service),
 * reduced to the common fields, with stage IDs and owner IDs resolved to
 * names. `activeOnly` (default true) drops terminal stages. The Project
 * pipeline has its own richer fetch (fetchAllProjects) — use that instead.
 */
export async function fetchPipelineDeals(
  pipelineKey: string,
  opts?: { activeOnly?: boolean }
): Promise<PipelineDeal[]> {
  const pipelineId = PIPELINE_IDS[pipelineKey];
  if (!pipelineId) throw new Error(`Unknown pipeline "${pipelineKey}"`);

  const { searchWithRetry, batchReadDealsWithRetry, fetchAllOwnersMinimal } = await import("@/lib/hubspot");
  const { FilterOperatorEnum } = await import("@hubspot/api-client/lib/codegen/crm/deals");

  // Resolve stage map + active stages first, so an active-only fetch can filter
  // to active stages IN THE SEARCH — critical for the sales pipeline, which has
  // thousands of historical closed-lost deals that would otherwise blow the cap.
  const stageMap = (await getStageMaps())[pipelineKey] || {};
  const activeStageNames = new Set((await getActiveStages())[pipelineKey] || []);
  const activeStageIds = Object.entries(stageMap)
    .filter(([, name]) => activeStageNames.has(name))
    .map(([id]) => id);
  const activeOnly = opts?.activeOnly !== false;

  type EqFilter = { propertyName: string; operator: typeof FilterOperatorEnum.Eq; value: string };
  type InFilter = { propertyName: string; operator: typeof FilterOperatorEnum.In; values: string[] };
  const searchFilters: (EqFilter | InFilter)[] = [
    { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId },
  ];
  if (activeOnly && activeStageIds.length > 0) {
    searchFilters.push({ propertyName: "dealstage", operator: FilterOperatorEnum.In, values: activeStageIds });
  }

  // Phase 1: collect IDs (search with minimal props paginates reliably).
  const ids: string[] = [];
  let after: string | undefined;
  let truncated = false;
  for (let page = 0; page < 60; page++) {
    const req: {
      filterGroups: { filters: (EqFilter | InFilter)[] }[];
      properties: string[];
      limit: number;
      after?: string;
    } = {
      filterGroups: [{ filters: searchFilters }],
      properties: ["hs_object_id"],
      limit: 200,
    };
    if (after) req.after = after;
    const res = await searchWithRetry(req);
    for (const d of res.results) if (d.id) ids.push(d.id);
    after = res.paging?.next?.after;
    if (!after) break;
    if (page === 59) truncated = true;
  }
  if (truncated) console.warn(`[fetchPipelineDeals] ${pipelineKey}: hit 12k cap — result may be incomplete`);
  if (ids.length === 0) return [];

  // Phase 2: batch-read the common properties.
  const props = [...DEAL_PROPERTIES, "project_number"];
  const rows: { id?: string; properties?: Record<string, string | null> }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = await batchReadDealsWithRetry(ids.slice(i, i + 100), props);
    for (const r of batch.results ?? []) rows.push(r);
  }

  // Resolve owner IDs → names (stage map already resolved above).
  const owners = await fetchAllOwnersMinimal();
  const ownerName = new Map(
    owners.map((o) => [o.id, [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || o.id])
  );
  const portalId = (process.env.HUBSPOT_PORTAL_ID || "21710069").replace(/\D/g, "") || "21710069";

  let deals: PipelineDeal[] = rows.map((r) => {
    const p = r.properties ?? {};
    const stageId = p.dealstage ?? "";
    return {
      id: String(r.id ?? p.hs_object_id ?? ""),
      name: p.dealname ?? "",
      projectNumber: p.project_number ?? "",
      stage: stageMap[stageId] || stageId || "",
      amount: Number(p.amount) || 0,
      dealOwner: ownerName.get(p.hubspot_owner_id ?? "") || "",
      pbLocation: p.pb_location ?? "",
      closeDate: toYmd(p.closedate),
      url: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${r.id ?? p.hs_object_id}`,
      pipeline: pipelineKey,
    };
  });

  // Safety net: the search already scoped to active stages, but keep an
  // in-memory guard in case a deal's stage isn't in the (cached) active set.
  if (activeOnly && activeStageNames.size > 0) {
    deals = deals.filter((d) => activeStageNames.has(d.stage));
  }
  return deals;
}
