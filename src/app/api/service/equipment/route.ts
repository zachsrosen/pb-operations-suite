import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { appCache } from "@/lib/cache";

/**
 * Service pipeline equipment endpoint.
 *
 * Fetches service deals from HubSpot with equipment properties,
 * transforms them into the same shape as the solar equipment backlog.
 */

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

const SERVICE_PIPELINE_ID = "23928924";

const SERVICE_STAGE_MAP: Record<string, string> = {
  "1058744644": "Project Preparation",
  "1058924076": "Site Visit Scheduling",
  "171758480": "Work In Progress",
  "1058924077": "Inspection",
  "1058924078": "Invoicing",
  "76979603": "Completed",
  "56217769": "Cancelled",
};

const COMPLETED_STAGE_IDS = ["76979603", "56217769"]; // Completed, Cancelled

const DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "pb_location",
  "address_line_1",
  "city",
  "state",
  "postal_code",
  "createdate",
  "hs_lastmodifieddate",
  // Equipment fields (same as solar)
  "module_brand",
  "module_model",
  "module_count",
  "module_wattage",
  "modules",
  "inverter_brand",
  "inverter_model",
  "inverter_qty",
  "inverter_size_kwac",
  "inverter",
  "battery_brand",
  "battery_model",
  "battery_count",
  "battery_size",
  "battery_expansion_count",
  "battery",
  "battery_expansion",
  "expansion_model",
  "ev_count",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ServiceDeal {
  id: number;
  name: string;
  projectNumber: string;
  pbLocation: string;
  stage: string;
  amount: number;
  address: string;
  city: string;
  url: string;
  equipment: {
    modules: { brand: string; model: string; count: number; wattage: number; productName: string };
    inverter: { brand: string; model: string; count: number; sizeKwac: number; productName: string };
    battery: {
      brand: string; model: string; count: number; sizeKwh: number;
      expansionCount: number; productName: string; expansionProductName: string; expansionModel: string;
    };
    evCount: number;
  };
}

function transformDeal(deal: Record<string, unknown>, portalId: string): ServiceDeal {
  const stageId = String(deal.dealstage || "");
  const name = String(deal.dealname || "");
  // Extract project number from "SVC | PROJ-XXXX | ..."
  const projMatch = name.match(/PROJ-(\d+)/);
  const projectNumber = projMatch ? `PROJ-${projMatch[1]}` : "";

  return {
    id: Number(deal.hs_object_id),
    name,
    projectNumber,
    pbLocation: String(deal.pb_location || "Unknown"),
    stage: SERVICE_STAGE_MAP[stageId] || stageId,
    amount: Number(deal.amount) || 0,
    address: String(deal.address_line_1 || ""),
    city: String(deal.city || ""),
    url: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${deal.hs_object_id}`,
    equipment: {
      modules: {
        brand: String(deal.module_brand ?? ""),
        model: String(deal.module_model ?? ""),
        count: Number(deal.module_count) || 0,
        wattage: Number(deal.module_wattage) || 0,
        productName: String(deal.modules ?? ""),
      },
      inverter: {
        brand: String(deal.inverter_brand ?? ""),
        model: String(deal.inverter_model ?? ""),
        count: Number(deal.inverter_qty) || 0,
        sizeKwac: Number(deal.inverter_size_kwac) || 0,
        productName: String(deal.inverter ?? ""),
      },
      battery: {
        brand: String(deal.battery_brand ?? ""),
        model: String(deal.battery_model ?? ""),
        count: Number(deal.battery_count) || 0,
        sizeKwh: Number(deal.battery_size) || 0,
        expansionCount: Number(deal.battery_expansion_count) || 0,
        productName: String(deal.battery ?? ""),
        expansionProductName: String(deal.battery_expansion ?? ""),
        expansionModel: String(deal.expansion_model ?? ""),
      },
      evCount: Number(deal.ev_count) || 0,
    },
  };
}

async function fetchServiceDeals(): Promise<ServiceDeal[]> {
  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";
  const allDeals: ServiceDeal[] = [];

  // Fetch active service deals (exclude completed/cancelled)
  let after: string | undefined;
  let pages = 0;

  do {
    const searchRequest = {
      filterGroups: [{
        filters: [
          { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: SERVICE_PIPELINE_ID },
          ...COMPLETED_STAGE_IDS.map((id) => ({
            propertyName: "dealstage",
            operator: FilterOperatorEnum.Neq,
            value: id,
          })),
        ],
      }],
      properties: DEAL_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    };

    const response = await hubspotClient.crm.deals.searchApi.doSearch(searchRequest);
    const deals = response.results.map((d) => transformDeal(d.properties, portalId));
    allDeals.push(...deals);

    after = response.paging?.next?.after;
    pages++;
    if (pages > 50) break; // Safety limit

    if (after) await sleep(150); // Rate limit
  } while (after);

  return allDeals;
}

const CACHE_KEY = "service:equipment";

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

    const { data: deals, lastUpdated } = await appCache.getOrFetch<ServiceDeal[]>(
      CACHE_KEY,
      fetchServiceDeals,
      forceRefresh
    );

    return NextResponse.json({
      projects: deals || [],
      lastUpdated,
    });
  } catch (error) {
    console.error("[Service Equipment] Error:", error);
    Sentry.captureException(error);
    return NextResponse.json({ error: "Failed to fetch service equipment" }, { status: 500 });
  }
}
