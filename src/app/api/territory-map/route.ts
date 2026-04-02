import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { searchWithRetry } from "@/lib/hubspot";
import { requireApiAuth } from "@/lib/api-auth";
import { CacheStore, CACHE_KEYS } from "@/lib/cache";
import { normalizeLocation } from "@/lib/locations";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TerritoryDeal {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  pbLocation: string;
  amount: number;
  stage: string;
  url: string;
}

/* ------------------------------------------------------------------ */
/*  Dedicated cache — 15-min fresh / 20-min stale                      */
/*  (appCache is fixed at 5/10 min with no per-key override)           */
/* ------------------------------------------------------------------ */

const territoryCache = new CacheStore(15 * 60 * 1000, 20 * 60 * 1000);

/* ------------------------------------------------------------------ */
/*  HubSpot properties (minimal set for map rendering)                 */
/* ------------------------------------------------------------------ */

const MAP_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "latitude",
  "longitude",
  "pb_location",
  "amount",
  "dealstage",
];

const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "21710069";
const PROJECT_PIPELINE_ID = "6900017";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transformDeal(raw: Record<string, string>): TerritoryDeal {
  const lat = parseFloat(raw.latitude);
  const lng = parseFloat(raw.longitude);
  const id = parseInt(raw.hs_object_id, 10);

  return {
    id,
    name: raw.dealname || "",
    latitude: lat,
    longitude: lng,
    pbLocation: normalizeLocation(raw.pb_location) || "Unknown",
    amount: parseFloat(raw.amount) || 0,
    stage: raw.dealstage || "",
    url: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-3/${id}`,
  };
}

/* ------------------------------------------------------------------ */
/*  Fetcher — paginate through all CO project-pipeline deals           */
/* ------------------------------------------------------------------ */

async function fetchTerritoryDeals(): Promise<TerritoryDeal[]> {
  const deals: TerritoryDeal[] = [];
  let after: string | undefined;

  for (;;) {
    const searchRequest: {
      filterGroups: { filters: { propertyName: string; operator: FilterOperatorEnum; value?: string }[] }[];
      properties: string[];
      limit: number;
      after?: string;
    } = {
      filterGroups: [
        {
          filters: [
            { propertyName: "state", operator: FilterOperatorEnum.Eq, value: "CO" },
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PROJECT_PIPELINE_ID },
            { propertyName: "latitude", operator: FilterOperatorEnum.HasProperty },
            { propertyName: "longitude", operator: FilterOperatorEnum.HasProperty },
          ],
        },
      ],
      properties: MAP_PROPERTIES,
      limit: 200,
      ...(after ? { after } : {}),
    };

    const response = await searchWithRetry(searchRequest);
    const results = response?.results || [];

    for (const result of results) {
      const props = result.properties as unknown as Record<string, string>;
      const deal = transformDeal(props);
      // Only include deals with valid coordinates
      if (!isNaN(deal.latitude) && !isNaN(deal.longitude)) {
        deals.push(deal);
      }
    }

    // Check for next page
    const paging = (response as unknown as { paging?: { next?: { after?: string } } })?.paging;
    if (paging?.next?.after) {
      after = paging.next.after;
      // 150ms delay between pages to avoid rate limits (matches fetchDealsForPipeline pattern)
      await sleep(150);
    } else {
      break;
    }
  }

  return deals;
}

/* ------------------------------------------------------------------ */
/*  GET /api/territory-map                                             */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const { data, cached, stale, lastUpdated } = await territoryCache.getOrFetch<TerritoryDeal[]>(
      CACHE_KEYS.TERRITORY_MAP,
      fetchTerritoryDeals,
    );

    return NextResponse.json(
      {
        deals: data,
        total: data.length,
        lastUpdated,
        cached,
        stale,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
        },
      },
    );
  } catch (error) {
    console.error("[territory-map] Error fetching deals:", error);
    Sentry.captureException(error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("429") || errorMessage.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "HubSpot API rate limited. Please try again in a few seconds.", details: errorMessage },
        { status: 429 },
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch territory map data", details: errorMessage },
      { status: 500 },
    );
  }
}
