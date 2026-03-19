import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { requireApiAuth } from "@/lib/api-auth";
import { PIPELINE_IDS, STAGE_MAPS, ACTIVE_STAGES, DEAL_PROPERTIES, getStageMaps, getActiveStages } from "@/lib/deals-pipeline";
import { chunk } from "@/lib/utils";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 1, // Limit internal retries
});

// Rate limiting helpers
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchWithRetry(
  searchRequest: {
    filterGroups: { filters: { propertyName: string; operator: typeof FilterOperatorEnum.Eq; value: string }[] }[];
    properties: string[];
    limit: number;
    after?: string;
  },
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
        const delay = Math.pow(2, attempt + 1) * 500; // 1s, 2s, 4s
        console.log(`Rate limited on attempt ${attempt + 1}, retrying in ${delay}ms...`);
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
  if (str.includes("T")) {
    return str.split("T")[0];
  }
  return str;
}

function daysBetween(date1: Date, date2: Date): number {
  const diffTime = date2.getTime() - date1.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
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

async function fetchDealsForPipeline(pipelineKey: string): Promise<Deal[]> {
  const pipelineId = PIPELINE_IDS[pipelineKey];
  if (!pipelineId) throw new Error(`Unknown pipeline: ${pipelineKey}`);

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";
  const allDeals: Record<string, unknown>[] = [];
  let after: string | undefined;

  // Fetch dynamic stage maps (cached 10 min, falls back to static)
  const [dynamicStageMaps, dynamicActiveStages] = await Promise.all([
    getStageMaps(),
    getActiveStages(),
  ]);
  const stageMap = dynamicStageMaps[pipelineKey] || STAGE_MAPS[pipelineKey] || {};
  const activeStageList = dynamicActiveStages[pipelineKey] || ACTIVE_STAGES[pipelineKey] || [];

  // For the default sales pipeline, search by each deal stage separately
  // because HubSpot's search API rejects pipeline="default" as a filter value.
  const stageIds = Object.keys(stageMap);

  if (pipelineId === "default" && stageIds.length > 0) {
    // HubSpot's search API rejects pipeline="default" as a filter value.
    // Instead, use multiple filterGroups (OR logic) to batch stage queries.
    // HubSpot allows up to 5 filterGroups per request, so we chunk stages.
    const BATCH_SIZE = 5;
    for (let batchStart = 0; batchStart < stageIds.length; batchStart += BATCH_SIZE) {
      const batch = stageIds.slice(batchStart, batchStart + BATCH_SIZE);
      if (batchStart > 0) await sleep(150); // small delay between batches

      after = undefined;
      do {
        const searchRequest: {
          filterGroups: { filters: { propertyName: string; operator: typeof FilterOperatorEnum.Eq; value: string }[] }[];
          properties: string[];
          limit: number;
          after?: string;
        } = {
          filterGroups: batch.map((stageId) => ({
            filters: [
              {
                propertyName: "dealstage",
                operator: FilterOperatorEnum.Eq,
                value: stageId,
              },
            ],
          })),
          properties: DEAL_PROPERTIES,
          limit: 100,
        };
        if (after) {
          searchRequest.after = after;
        }
        const response = await searchWithRetry(searchRequest);
        allDeals.push(...response.results.map((deal) => deal.properties));
        after = response.paging?.next?.after;
        if (after) await sleep(100);
      } while (after);
    }
  } else {
    const MAX_PAGINATION_PAGES = 50; // Safety limit: 50 pages * 100 = 5,000 deals max
    let paginationCount = 0;
    do {
      if (paginationCount >= MAX_PAGINATION_PAGES) {
        console.warn(`[Deals] Hit pagination safety limit (${MAX_PAGINATION_PAGES} pages) for pipeline ${pipelineKey}. Some deals may be missing.`);
        break;
      }
      const searchRequest: {
        filterGroups: { filters: { propertyName: string; operator: typeof FilterOperatorEnum.Eq; value: string }[] }[];
        properties: string[];
        limit: number;
        after?: string;
      } = {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "pipeline",
                operator: FilterOperatorEnum.Eq,
                value: pipelineId,
              },
            ],
          },
        ],
        properties: DEAL_PROPERTIES,
        limit: 100,
      };
      if (after) {
        searchRequest.after = after;
      }

      const response = await searchWithRetry(searchRequest);
      allDeals.push(...response.results.map((deal) => deal.properties));
      after = response.paging?.next?.after;
      paginationCount++;
      if (after) await sleep(100);
    } while (after);
  }

  const transformedDeals = allDeals.map((deal) => transformDeal(deal, pipelineKey, portalId, stageMap, activeStageList));

  // Resolve company associations for service deals (needed for SO creation gating)
  if (pipelineKey === "service" && transformedDeals.length > 0) {
    const dealIds = transformedDeals.map(d => String(d.id));
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
      console.warn("[Deals] Company association lookup failed:", err);
    }

    for (const deal of transformedDeals) {
      const company = companyMap.get(String(deal.id));
      deal.companyId = company?.companyId || null;
      deal.companyName = company?.companyName || null;
    }
  }

  return transformedDeals;
}

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const pipeline = searchParams.get("pipeline");
    const activeOnly = searchParams.get("active") !== "false";
    const location = searchParams.get("location");
    const stage = searchParams.get("stage");
    const search = searchParams.get("search");
    const forceRefresh = searchParams.get("refresh") === "true";

    // Pagination parameters
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const rawLimit = parseInt(searchParams.get("limit") || "0");
    const limit = rawLimit > 0 ? Math.min(200, rawLimit) : 0; // 0 = no pagination
    const sortBy = searchParams.get("sort") || "amount";
    const sortOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

    if (!pipeline || !PIPELINE_IDS[pipeline]) {
      return NextResponse.json(
        { error: "Invalid or missing pipeline parameter. Valid values: sales, dnr, service, roofing" },
        { status: 400 }
      );
    }

    // Use shared cache with stale-while-revalidate + request coalescing
    const { data: allDeals, cached, stale, lastUpdated } = await appCache.getOrFetch<Deal[]>(
      CACHE_KEYS.DEALS(pipeline),
      () => fetchDealsForPipeline(pipeline),
      forceRefresh
    );

    let deals = allDeals || [];

    // Apply filters
    if (activeOnly) {
      deals = deals.filter((d) => d.isActive);
    }
    if (location) {
      deals = deals.filter((d) => d.pbLocation === location);
    }
    if (stage) {
      deals = deals.filter((d) => d.stage === stage);
    }

    // Text search
    if (search) {
      const q = search.toLowerCase();
      deals = deals.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.address.toLowerCase().includes(q) ||
          d.city.toLowerCase().includes(q)
      );
    }

    // Sort
    const sortKey = sortBy as keyof Deal;
    deals = deals.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
      }
      const aStr = String(aVal ?? "");
      const bStr = String(bVal ?? "");
      return sortOrder === "desc" ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
    });

    // Calculate stats BEFORE pagination
    const totalValue = deals.reduce((sum, d) => sum + d.amount, 0);
    const stageCounts = deals.reduce((acc, d) => {
      acc[d.stage] = (acc[d.stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const locationCounts = deals.reduce((acc, d) => {
      acc[d.pbLocation] = (acc[d.pbLocation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const totalCount = deals.length;

    // Apply pagination (limit=0 means no pagination for backwards compat)
    let paginationMeta = null;
    if (limit > 0) {
      const offset = (page - 1) * limit;
      const totalPages = Math.ceil(totalCount / limit);
      deals = deals.slice(offset, offset + limit);
      paginationMeta = {
        page,
        limit,
        totalCount,
        totalPages,
        hasMore: page < totalPages,
      };
    }

    return NextResponse.json({
      deals,
      count: deals.length,
      totalCount,
      stats: {
        totalValue,
        stageCounts,
        locationCounts,
      },
      pagination: paginationMeta,
      pipeline,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("Error fetching deals:", error);
    Sentry.captureException(error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's a rate limit error and return appropriate status
    if (errorMessage.includes("429") || errorMessage.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "HubSpot API rate limited. Please try again in a few seconds.", details: errorMessage },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch deals", details: errorMessage },
      { status: 500 }
    );
  }
}
