import { NextRequest, NextResponse } from "next/server";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { requireApiAuth } from "@/lib/api-auth";

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

// Pipeline IDs - loaded from environment variables with hardcoded fallbacks
const PIPELINE_IDS: Record<string, string> = {
  sales: process.env.HUBSPOT_PIPELINE_SALES || "default",
  project: process.env.HUBSPOT_PIPELINE_PROJECT || "6900017",
  dnr: process.env.HUBSPOT_PIPELINE_DNR || "21997330",
  service: process.env.HUBSPOT_PIPELINE_SERVICE || "23928924",
  roofing: process.env.HUBSPOT_PIPELINE_ROOFING || "765928545",
};

// Stage mappings for each pipeline
const STAGE_MAPS: Record<string, Record<string, string>> = {
  sales: {
    qualifiedtobuy: "Qualified to buy",
    decisionmakerboughtin: "Proposal Submitted",
    "1241097777": "Proposal Accepted",
    contractsent: "Finalizing Deal",
    "70699053": "Sales Follow Up",
    "70695977": "Nurture",
    closedwon: "Closed won",
    closedlost: "Closed lost",
  },
  dnr: {
    "52474739": "Kickoff",
    "52474740": "Site Survey",
    "52474741": "Design",
    "52474742": "Permit",
    "78437201": "Ready for Detach",
    "52474743": "Detach",
    "78453339": "Detach Complete - Roofing In Progress",
    "78412639": "Reset Blocked - Waiting on Payment",
    "78412640": "Ready for Reset",
    "52474744": "Reset",
    "55098156": "Inspection",
    "52498440": "Closeout",
    "68245827": "Complete",
    "72700977": "On-hold",
    "52474745": "Cancelled",
  },
  service: {
    "1058744644": "Project Preparation",
    "1058924076": "Site Visit Scheduling",
    "171758480": "Work In Progress",
    "1058924077": "Inspection",
    "1058924078": "Invoicing",
    "76979603": "Completed",
    "56217769": "Cancelled",
  },
  roofing: {
    "1117662745": "On Hold",
    "1117662746": "Color Selection",
    "1215078279": "Material & Labor Order",
    "1117662747": "Confirm Dates",
    "1215078280": "Staged",
    "1215078281": "Production",
    "1215078282": "Post Production",
    "1215078283": "Invoice/Collections",
    "1215078284": "Job Close Out Paperwork",
    "1215078285": "Job Completed",
  },
};

// Active stages (exclude completed/cancelled)
const ACTIVE_STAGES: Record<string, string[]> = {
  sales: ["Qualified to buy", "Proposal Submitted", "Proposal Accepted", "Finalizing Deal", "Sales Follow Up", "Nurture"],
  dnr: ["Kickoff", "Site Survey", "Design", "Permit", "Ready for Detach", "Detach", "Detach Complete - Roofing In Progress", "Reset Blocked - Waiting on Payment", "Ready for Reset", "Reset", "Inspection", "Closeout"],
  service: ["Project Preparation", "Site Visit Scheduling", "Work In Progress", "Inspection", "Invoicing"],
  roofing: ["On Hold", "Color Selection", "Material & Labor Order", "Confirm Dates", "Staged", "Production", "Post Production", "Invoice/Collections", "Job Close Out Paperwork"],
};

// Active stage IDs (for filtering at HubSpot level to reduce API calls)
const ACTIVE_STAGE_IDS: Record<string, string[]> = {
  sales: ["qualifiedtobuy", "decisionmakerboughtin", "1241097777", "contractsent", "70699053", "70695977"],
  dnr: ["52474739", "52474740", "52474741", "52474742", "78437201", "52474743", "78453339", "78412639", "78412640", "52474744", "55098156", "52498440"],
  service: ["1058744644", "1058924076", "171758480", "1058924077", "1058924078"],
  roofing: ["1117662745", "1117662746", "1215078279", "1117662747", "1215078280", "1215078281", "1215078282", "1215078283", "1215078284"],
};

// Common properties to fetch
const DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "createdate",
  "hs_lastmodifieddate",
  "pb_location",
  "address_line_1",
  "city",
  "state",
  "postal_code",
  "project_type",
  "hubspot_owner_id",
  "deal_currency_code",
  // D&R specific properties
  "detach_status",
  "reset_status",
];

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
  // D&R specific fields
  detachStatus?: string;
  resetStatus?: string;
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

function transformDeal(deal: Record<string, unknown>, pipelineKey: string, portalId: string): Deal {
  const stageId = String(deal.dealstage || "");
  const stageName = STAGE_MAPS[pipelineKey]?.[stageId] || stageId;
  const activeStages = ACTIVE_STAGES[pipelineKey] || [];
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
    // D&R specific fields
    detachStatus: deal.detach_status ? String(deal.detach_status) : undefined,
    resetStatus: deal.reset_status ? String(deal.reset_status) : undefined,
  };
}

// Helper to delay execution
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Simple retry for rate-limited requests - fail fast to avoid Vercel timeout
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 1,
  retryDelay: number = 300
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Check if it's a rate limit error
    if (maxRetries > 0 && (errorMessage.includes("429") || errorMessage.includes("RATE_LIMIT"))) {
      console.log(`Rate limited, waiting ${retryDelay}ms before retry`);
      await delay(retryDelay);
      return withRetry(fn, maxRetries - 1, retryDelay);
    }
    throw error;
  }
}

// Max deals to fetch to avoid Vercel timeout (roughly 500 per 3 seconds)
const MAX_DEALS_FETCH = 500;
const MAX_PAGES = 5; // 5 pages * 100 deals = 500 max

async function fetchDealsForPipeline(pipelineKey: string, activeOnly: boolean = true): Promise<Deal[]> {
  const pipelineId = PIPELINE_IDS[pipelineKey];
  if (!pipelineId) throw new Error(`Unknown pipeline: ${pipelineKey}`);

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";
  const allDeals: Record<string, unknown>[] = [];
  let after: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const pageCount = 0;

  // Get active stage IDs for filtering at HubSpot level
  const activeStageIds = activeOnly ? ACTIVE_STAGE_IDS[pipelineKey] : null;

  // For the default sales pipeline, search by each deal stage separately
  // because HubSpot's search API rejects pipeline="default" as a filter value.
  const stageMap = STAGE_MAPS[pipelineKey] || {};
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

  return allDeals.map((deal) => transformDeal(deal, pipelineKey, portalId));
}

export async function GET(request: NextRequest) {
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
