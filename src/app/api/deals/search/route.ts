import { NextRequest, NextResponse } from "next/server";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { requireApiAuth } from "@/lib/api-auth";
import { STAGE_MAPS } from "@/lib/deals-pipeline";
import { resolveHubSpotOwnerContact } from "@/lib/hubspot";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 1,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchWithRetry(
  searchRequest: Parameters<typeof hubspotClient.crm.deals.searchApi.doSearch>[0],
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
        await sleep(Math.pow(2, attempt + 1) * 500);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

const SEARCH_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pb_location",
  "address_line_1",
  "city",
  "state",
  "project_type",
  "hubspot_owner_id",
  "site_survey_schedule_date",
  "site_survey_status",
];

const SALES_STAGE_MAP = STAGE_MAPS.sales || {};

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ deals: [], message: "Query must be at least 2 characters" });
  }
  const normalizedQuery = q.toLowerCase();

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  try {
    // HubSpot search API rejects pipeline="default" as a filter value.
    // Filter by active sales stage IDs instead (OR logic via filterGroups).
    const activeStageIds = Object.keys(SALES_STAGE_MAP).filter(
      (id) => !["closedwon", "closedlost"].includes(id)
    );

    // HubSpot allows max 5 filterGroups per search request.
    // Chunk stage IDs into batches of 3 (conservative) and merge results.
    const BATCH_SIZE = 3;
    const batches: string[][] = [];
    for (let i = 0; i < activeStageIds.length; i += BATCH_SIZE) {
      batches.push(activeStageIds.slice(i, i + BATCH_SIZE));
    }

    const allResults = await Promise.all(
      batches.map((batch) =>
        searchWithRetry({
          query: q,
          filterGroups: batch.map((stageId) => ({
            filters: [
              { propertyName: "dealstage", operator: FilterOperatorEnum.Eq, value: stageId },
            ],
          })),
          properties: SEARCH_PROPERTIES,
          limit: 20,
        })
      )
    );

    const getRelevanceScore = (deal: {
      id: string;
      properties?: Record<string, string | null> | null;
    }): number => {
      const props = deal.properties || {};
      const name = String(props.dealname || "").toLowerCase();
      const address = [props.address_line_1, props.city, props.state].filter(Boolean).join(" ").toLowerCase();
      const location = String(props.pb_location || "").toLowerCase();
      let score = 0;

      if (name === normalizedQuery) score += 100;
      else if (name.startsWith(normalizedQuery)) score += 75;
      else if (name.includes(normalizedQuery)) score += 55;

      if (address.startsWith(normalizedQuery)) score += 35;
      else if (address.includes(normalizedQuery)) score += 20;

      if (location.startsWith(normalizedQuery)) score += 15;
      else if (location.includes(normalizedQuery)) score += 10;

      return score;
    };

    // Merge and dedupe by deal ID, then apply deterministic relevance ordering.
    const seen = new Set<string>();
    const response = {
      results: allResults.flatMap((r) =>
        (r.results || []).filter((deal) => {
          const id = deal.id;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
      )
        .sort((a, b) => {
          const scoreDiff = getRelevanceScore(b) - getRelevanceScore(a);
          if (scoreDiff !== 0) return scoreDiff;
          const amountDiff = Number(b.properties?.amount || 0) - Number(a.properties?.amount || 0);
          if (amountDiff !== 0) return amountDiff;
          return String(a.id).localeCompare(String(b.id));
        })
        .slice(0, 20),
    };

    const ownerIds = [...new Set(
      (response.results || [])
        .map((deal) => String(deal.properties?.hubspot_owner_id || "").trim())
        .filter(Boolean)
    )];

    const ownerNameMap = new Map<string, string>();
    if (ownerIds.length > 0) {
      // Resolve owner IDs in sequence to avoid concurrent owner-directory fan-out.
      for (const ownerId of ownerIds) {
        try {
          const owner = await resolveHubSpotOwnerContact(ownerId);
          if (owner?.name) ownerNameMap.set(ownerId, owner.name);
        } catch (ownerErr) {
          console.warn(`[Deals Search] Failed to resolve owner ${ownerId}:`, ownerErr);
        }
      }
    }

    const deals = (response.results || []).map((deal) => {
      const props = deal.properties || {};
      const stageId = props.dealstage || "";
      const ownerId = String(props.hubspot_owner_id || "").trim();
      return {
        id: props.hs_object_id || deal.id,
        name: props.dealname || "Unknown",
        amount: Number(props.amount) || 0,
        stage: SALES_STAGE_MAP[stageId] || stageId,
        location: props.pb_location || "Unknown",
        address: [props.address_line_1, props.city, props.state].filter(Boolean).join(", ") || "",
        city: props.city || "",
        state: props.state || "",
        type: props.project_type || "Solar",
        dealOwner: ownerNameMap.get(ownerId) || ownerId || "",
        surveyDate: props.site_survey_schedule_date || null,
        surveyStatus: props.site_survey_status || null,
        url: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${props.hs_object_id || deal.id}`,
      };
    });

    return NextResponse.json({ deals });
  } catch (error) {
    console.error("[Deals Search] Error:", error);
    return NextResponse.json({ error: "Failed to search deals" }, { status: 500 });
  }
}
