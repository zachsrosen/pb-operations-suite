import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { PIPELINE_IDS, STAGE_MAPS, ACTIVE_STAGES, DEAL_PROPERTIES, getStageMaps, getActiveStages, getStageOrder } from "@/lib/deals-pipeline";
import { chunk } from "@/lib/utils";

/**
 * Streaming deals endpoint.
 *
 * On a warm cache  → sends a single "full" message instantly.
 * On a cold cache  → streams deals in NDJSON chunks as each HubSpot
 *                     batch arrives so the client can render progressively,
 *                     then writes to the shared cache so the next request is fast.
 *
 * Wire format (newline-delimited JSON):
 *   {"type":"batch","deals":[...], "loaded":30, "total":null}   // partial
 *   {"type":"done", "deals":[...], "total":250, "cached":false} // final
 *
 * "total" is null until the full pipeline is fetched (HubSpot doesn't
 * tell us the total across stage batches up-front).
 */

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type HubSpotSearchRequest = {
  filterGroups: { filters: { propertyName: string; operator: typeof FilterOperatorEnum.Eq; value: string }[] }[];
  properties: string[];
  limit: number;
  after?: string;
};

async function searchWithRetry(
  searchRequest: HubSpotSearchRequest,
  maxRetries = 3
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await hubspotClient.crm.deals.searchApi.doSearch(searchRequest);
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;
      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt + 1) * 500;
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}


interface Deal {
  id: number;
  name: string;
  amount: number;
  stage: string;
  stageId: string;
  pipeline: string;
  pbLocation: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  projectType: string;
  serviceType: string | null;
  closeDate: string | null;
  createDate: string | null;
  lastModified: string | null;
  url: string;
  isActive: boolean;
  daysSinceCreate: number;
  companyId: string | null;
  companyName: string | null;
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  const str = String(value);
  return str.includes("T") ? str.split("T")[0] : str;
}

function daysBetween(d1: Date, d2: Date): number {
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function transformDeal(
  deal: Record<string, unknown>,
  pipelineKey: string,
  portalId: string,
  stageMap?: Record<string, string>,
  activeStageList?: string[],
): Deal {
  const stageId = String(deal.dealstage || "");
  const stageName = stageMap?.[stageId] || STAGE_MAPS[pipelineKey]?.[stageId] || stageId;
  const activeStages = activeStageList || ACTIVE_STAGES[pipelineKey] || [];
  const now = new Date();
  const createDate = deal.createdate ? new Date(String(deal.createdate)) : null;
  return {
    id: Number(deal.hs_object_id),
    name: String(deal.dealname || "Unknown"),
    amount: Number(deal.amount) || 0,
    stage: stageName,
    stageId,
    pipeline: pipelineKey,
    pbLocation: String(deal.pb_location || "Unknown"),
    address: String(deal.address_line_1 || ""),
    city: String(deal.city || ""),
    state: String(deal.state || ""),
    postalCode: String(deal.postal_code || ""),
    projectType: String(deal.project_type || "Unknown"),
    serviceType: deal.service_type ? String(deal.service_type) : null,
    closeDate: parseDate(deal.closedate),
    createDate: parseDate(deal.createdate),
    lastModified: parseDate(deal.hs_lastmodifieddate),
    url: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${deal.hs_object_id}`,
    isActive: activeStages.includes(stageName),
    daysSinceCreate: createDate ? daysBetween(createDate, now) : 0,
    companyId: null,
    companyName: null,
  };
}

// Sort helper (matches /api/deals)
function sortDeals(deals: Deal[], sortBy: string, sortOrder: string): Deal[] {
  const sortKey = sortBy as keyof Deal;
  return [...deals].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    }
    const aStr = String(aVal ?? "");
    const bStr = String(bVal ?? "");
    return sortOrder === "desc" ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
  });
}

// Filter helper
function filterDeals(deals: Deal[], activeOnly: boolean, location: string | null, stage: string | null): Deal[] {
  let result = deals;
  if (activeOnly) result = result.filter((d) => d.isActive);
  if (location) result = result.filter((d) => d.pbLocation === location);
  if (stage) result = result.filter((d) => d.stage === stage);
  return result;
}

// Resolve company associations for service deals (needed for SO creation gating)
async function resolveCompanyData(deals: Deal[]): Promise<void> {
  if (deals.length === 0) return;
  const dealIds = deals.map(d => String(d.id));
  const companyMap = new Map<string, { companyId: string; companyName: string }>();

  try {
    for (const batch of chunk(dealIds, 100)) {
      const assocResp = await hubspotClient.crm.associations.batchApi.read(
        "deals", "companies",
        { inputs: batch.map(id => ({ id })) }
      );

      const companyIds = new Set<string>();
      const dealToCompany = new Map<string, string>();

      for (const result of assocResp.results || []) {
        const dealId = result._from?.id;
        const firstCompanyId = (result.to || [])[0]?.id;
        if (dealId && firstCompanyId) {
          dealToCompany.set(dealId, firstCompanyId);
          companyIds.add(firstCompanyId);
        }
      }

      if (companyIds.size > 0) {
        const companyResp = await hubspotClient.crm.companies.batchApi.read({
          inputs: Array.from(companyIds).map(id => ({ id })),
          properties: ["name"],
          propertiesWithHistory: [],
        });
        const nameMap = new Map<string, string>();
        for (const c of companyResp.results || []) {
          nameMap.set(c.id, c.properties?.name || "");
        }
        for (const [dealId, compId] of dealToCompany) {
          companyMap.set(dealId, {
            companyId: compId,
            companyName: nameMap.get(compId) || "",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[Deals/Stream] Company association lookup failed:", err);
  }

  for (const deal of deals) {
    const company = companyMap.get(String(deal.id));
    deal.companyId = company?.companyId || null;
    deal.companyName = company?.companyName || null;
  }
}

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const searchParams = request.nextUrl.searchParams;
  const pipeline = searchParams.get("pipeline");
  const activeOnly = searchParams.get("active") !== "false";
  const location = searchParams.get("location");
  const stage = searchParams.get("stage");
  const sortBy = searchParams.get("sort") || "amount";
  const sortOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

  if (!pipeline || !PIPELINE_IDS[pipeline]) {
    return new Response(
      JSON.stringify({ error: "Invalid or missing pipeline parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Fast path: serve from cache instantly ---
  const cached = appCache.get<Deal[]>(CACHE_KEYS.DEALS(pipeline));
  if (cached.hit) {
    const deals = sortDeals(filterDeals(cached.data!, activeOnly, location, stage), sortBy, sortOrder);
    // If stale, kick off background refresh (fire-and-forget via the normal endpoint)
    if (cached.stale) {
      // Trigger a background refresh through the cache system
      appCache.getOrFetch<Deal[]>(
        CACHE_KEYS.DEALS(pipeline),
        () => fetchAllDealsForPipeline(pipeline),
        true // force refresh
      ).catch(() => {/* swallow — best effort */});
    }
    const stageOrderMap = await getStageOrder();
    const body = JSON.stringify({
      type: "full",
      deals,
      total: deals.length,
      stageOrder: stageOrderMap[pipeline] || [],
      cached: true,
      stale: cached.stale,
      lastUpdated: new Date(Date.now() - cached.age).toISOString(),
    }) + "\n";
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // --- Slow path: stream from HubSpot batch-by-batch ---
  const encoder = new TextEncoder();
  const pipelineId = PIPELINE_IDS[pipeline];
  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  const stream = new ReadableStream({
    async start(controller) {
      const allRawDeals: Record<string, unknown>[] = [];

      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        // Fetch dynamic stage maps (cached 10 min, falls back to static)
        const [dynamicStageMaps, dynamicActiveStages] = await Promise.all([
          getStageMaps(),
          getActiveStages(),
        ]);
        const dynStageMap = dynamicStageMaps[pipeline] || STAGE_MAPS[pipeline] || {};
        const dynActiveStageList = dynamicActiveStages[pipeline] || ACTIVE_STAGES[pipeline] || [];

        const stageMap = dynStageMap;
        const stageIds = Object.keys(stageMap);

        if (pipelineId === "default" && stageIds.length > 0) {
          // Sales pipeline: batch stage queries in groups of 5
          const BATCH_SIZE = 5;
          for (let batchStart = 0; batchStart < stageIds.length; batchStart += BATCH_SIZE) {
            const batch = stageIds.slice(batchStart, batchStart + BATCH_SIZE);
            if (batchStart > 0) await sleep(150);

            let after: string | undefined;
            do {
              const searchRequest: HubSpotSearchRequest = {
                filterGroups: batch.map((sid) => ({
                  filters: [{
                    propertyName: "dealstage" as const,
                    operator: FilterOperatorEnum.Eq,
                    value: sid,
                  }],
                })),
                properties: DEAL_PROPERTIES,
                limit: 100,
                ...(after ? { after } : {}),
              };
              const response = await searchWithRetry(searchRequest);
              const rawDeals = response.results.map((d) => d.properties);
              allRawDeals.push(...rawDeals);

              // Transform and stream this chunk immediately
              const transformed = rawDeals.map((d) => transformDeal(d, pipeline, portalId, dynStageMap, dynActiveStageList));
              const filtered = filterDeals(transformed, activeOnly, location, stage);
              if (filtered.length > 0) {
                send({
                  type: "batch",
                  deals: sortDeals(filtered, sortBy, sortOrder),
                  loaded: allRawDeals.length,
                  total: null, // unknown until done
                });
              }

              after = response.paging?.next?.after;
              if (after) await sleep(100);
            } while (after);
          }
        } else {
          // Non-sales pipelines: single pipeline filter
          let after: string | undefined;
          do {
            const searchRequest: HubSpotSearchRequest = {
              filterGroups: [{
                filters: [{
                  propertyName: "pipeline" as const,
                  operator: FilterOperatorEnum.Eq,
                  value: pipelineId,
                }],
              }],
              properties: DEAL_PROPERTIES,
              limit: 100,
              ...(after ? { after } : {}),
            };
            const response = await searchWithRetry(searchRequest);
            const rawDeals = response.results.map((d) => d.properties);
            allRawDeals.push(...rawDeals);

            const transformed = rawDeals.map((d) => transformDeal(d, pipeline, portalId, dynStageMap, dynActiveStageList));
            const filtered = filterDeals(transformed, activeOnly, location, stage);
            if (filtered.length > 0) {
              send({
                type: "batch",
                deals: sortDeals(filtered, sortBy, sortOrder),
                loaded: allRawDeals.length,
                total: null,
              });
            }

            after = response.paging?.next?.after;
          } while (after);
        }

        // All batches complete — build final dataset and cache it
        const allTransformed = allRawDeals.map((d) => transformDeal(d, pipeline, portalId, dynStageMap, dynActiveStageList));

        // Resolve company associations for service deals (needed for SO creation gating)
        if (pipeline === "service") {
          await resolveCompanyData(allTransformed);
        }

        // Write to shared cache so next request is instant
        appCache.set(CACHE_KEYS.DEALS(pipeline), allTransformed);

        const finalFiltered = sortDeals(filterDeals(allTransformed, activeOnly, location, stage), sortBy, sortOrder);
        const doneStageOrder = await getStageOrder();
        send({
          type: "done",
          deals: finalFiltered,
          total: finalFiltered.length,
          stageOrder: doneStageOrder[pipeline] || [],
          cached: false,
          stale: false,
          lastUpdated: new Date().toISOString(),
        });
      } catch (error) {
        Sentry.captureException(error);
        send({ type: "error", error: String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Full fetch (used for background refresh on stale cache)
async function fetchAllDealsForPipeline(pipelineKey: string): Promise<Deal[]> {
  const pipelineId = PIPELINE_IDS[pipelineKey];
  if (!pipelineId) throw new Error(`Unknown pipeline: ${pipelineKey}`);
  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";
  const allDeals: Record<string, unknown>[] = [];

  // Fetch dynamic stage maps for this fallback path too
  const [fallbackStageMaps, fallbackActiveStages] = await Promise.all([
    getStageMaps(),
    getActiveStages(),
  ]);
  const stageMap = fallbackStageMaps[pipelineKey] || STAGE_MAPS[pipelineKey] || {};
  const fallbackActiveList = fallbackActiveStages[pipelineKey] || ACTIVE_STAGES[pipelineKey] || [];
  const stageIds = Object.keys(stageMap);

  if (pipelineId === "default" && stageIds.length > 0) {
    const BATCH_SIZE = 5;
    for (let batchStart = 0; batchStart < stageIds.length; batchStart += BATCH_SIZE) {
      const batch = stageIds.slice(batchStart, batchStart + BATCH_SIZE);
      if (batchStart > 0) await sleep(150);
      let after: string | undefined;
      do {
        const searchRequest: HubSpotSearchRequest = {
          filterGroups: batch.map((sid) => ({
            filters: [{ propertyName: "dealstage" as const, operator: FilterOperatorEnum.Eq, value: sid }],
          })),
          properties: DEAL_PROPERTIES,
          limit: 100,
          ...(after ? { after } : {}),
        };
        const response = await searchWithRetry(searchRequest);
        allDeals.push(...response.results.map((d) => d.properties));
        after = response.paging?.next?.after;
        if (after) await sleep(100);
      } while (after);
    }
  } else {
    let after: string | undefined;
    do {
      const searchRequest: HubSpotSearchRequest = {
        filterGroups: [{ filters: [{ propertyName: "pipeline" as const, operator: FilterOperatorEnum.Eq, value: pipelineId }] }],
        properties: DEAL_PROPERTIES,
        limit: 100,
        ...(after ? { after } : {}),
      };
      const response = await searchWithRetry(searchRequest);
      allDeals.push(...response.results.map((d) => d.properties));
      after = response.paging?.next?.after;
    } while (after);
  }

  const transformedDeals = allDeals.map((d) => transformDeal(d, pipelineKey, portalId, stageMap, fallbackActiveList));

  // Resolve company associations for service deals (needed for SO creation gating)
  if (pipelineKey === "service") {
    await resolveCompanyData(transformedDeals);
  }

  return transformedDeals;
}
