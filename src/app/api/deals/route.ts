import { NextRequest, NextResponse } from "next/server";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

// Pipeline IDs
const PIPELINE_IDS: Record<string, string> = {
  sales: "default",
  project: "6900017",
  dnr: "21997330",
  service: "23928924",
  roofing: "765928545",
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
}

// Cache for each pipeline
const pipelineCache: Record<string, { data: Deal[] | null; timestamp: number }> = {
  sales: { data: null, timestamp: 0 },
  dnr: { data: null, timestamp: 0 },
  service: { data: null, timestamp: 0 },
  roofing: { data: null, timestamp: 0 },
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
  };
}

async function fetchDealsForPipeline(pipelineKey: string): Promise<Deal[]> {
  const pipelineId = PIPELINE_IDS[pipelineKey];
  if (!pipelineId) throw new Error(`Unknown pipeline: ${pipelineKey}`);

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";
  const allDeals: Record<string, unknown>[] = [];
  let after: string | undefined;

  do {
    const response = await hubspotClient.crm.deals.searchApi.doSearch({
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
      after: after || "0",
    });

    allDeals.push(...response.results.map((deal) => deal.properties));
    after = response.paging?.next?.after;
  } while (after);

  return allDeals.map((deal) => transformDeal(deal, pipelineKey, portalId));
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const pipeline = searchParams.get("pipeline");
    const activeOnly = searchParams.get("active") !== "false";
    const location = searchParams.get("location");
    const stage = searchParams.get("stage");
    const forceRefresh = searchParams.get("refresh") === "true";

    if (!pipeline || !PIPELINE_IDS[pipeline]) {
      return NextResponse.json(
        { error: "Invalid or missing pipeline parameter. Valid values: sales, dnr, service, roofing" },
        { status: 400 }
      );
    }

    // Check cache
    const now = Date.now();
    const cache = pipelineCache[pipeline];

    if (!forceRefresh && cache.data && now - cache.timestamp < CACHE_TTL) {
      // Use cached data
    } else {
      // Fetch fresh data
      pipelineCache[pipeline] = {
        data: await fetchDealsForPipeline(pipeline),
        timestamp: now,
      };
    }

    let deals = pipelineCache[pipeline].data || [];

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

    // Sort by amount (highest first)
    deals = deals.sort((a, b) => b.amount - a.amount);

    // Calculate stats
    const totalValue = deals.reduce((sum, d) => sum + d.amount, 0);
    const stageCounts = deals.reduce((acc, d) => {
      acc[d.stage] = (acc[d.stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const locationCounts = deals.reduce((acc, d) => {
      acc[d.pbLocation] = (acc[d.pbLocation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      deals,
      count: deals.length,
      stats: {
        totalValue,
        stageCounts,
        locationCounts,
      },
      pipeline,
      cached: now - pipelineCache[pipeline].timestamp < CACHE_TTL && !forceRefresh,
      lastUpdated: new Date(pipelineCache[pipeline].timestamp).toISOString(),
    });
  } catch (error) {
    console.error("Error fetching deals:", error);
    return NextResponse.json(
      { error: "Failed to fetch deals", details: String(error) },
      { status: 500 }
    );
  }
}
