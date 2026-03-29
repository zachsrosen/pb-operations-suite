import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  hubspotClient,
  searchWithRetry,
  fetchLineItemsForDeal,
} from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS, getStageMaps } from "@/lib/deals-pipeline";
import { normalizeLocation } from "@/lib/locations";
import { matchLineItemToEquipment } from "@/lib/pricing-calculator";

// ---------------------------------------------------------------------------
// Search mode: ?q=term
// ---------------------------------------------------------------------------

const SEARCH_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "pb_location",
  "dealstage",
  "pipeline",
];

async function searchDeals(query: string) {
  const stageMaps = await getStageMaps();

  // Search across sales + project + D&R pipelines
  const pipelineKeys = ["sales", "project", "dnr"];
  const allResults: Array<{
    dealId: string;
    dealName: string;
    amount: number | null;
    location: string | null;
    stageLabel: string;
    pipeline: string;
  }> = [];

  const searchPromises = pipelineKeys
    .filter((pKey) => PIPELINE_IDS[pKey])
    .map(async (pKey) => {
      const pipelineId = PIPELINE_IDS[pKey];
      const response = await searchWithRetry({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "dealname",
                operator: FilterOperatorEnum.ContainsToken,
                value: `*${query}*`,
              },
              {
                propertyName: "pipeline",
                operator: FilterOperatorEnum.Eq,
                value: pipelineId,
              },
            ],
          },
        ],
        properties: SEARCH_PROPERTIES,
        sorts: [
          { propertyName: "dealname", direction: "ASCENDING" },
        ] as unknown as string[],
        limit: 10,
      });

      const stageMap = stageMaps[pKey] || {};
      return response.results.map((deal) => {
        const props = deal.properties;
        return {
          dealId: String(props.hs_object_id),
          dealName: String(props.dealname || ""),
          amount: props.amount ? parseFloat(String(props.amount)) : null,
          location: normalizeLocation(String(props.pb_location || "")),
          stageLabel:
            stageMap[String(props.dealstage || "")] ||
            String(props.dealstage || ""),
          pipeline: pKey,
        };
      });
    });

  const results = await Promise.allSettled(searchPromises);
  for (const result of results) {
    if (result.status === "fulfilled") {
      allResults.push(...result.value);
    }
  }

  // Sort by name relevance (exact prefix first) and limit to 10
  const q = query.toLowerCase();
  allResults.sort((a, b) => {
    const aStart = a.dealName.toLowerCase().startsWith(q) ? 0 : 1;
    const bStart = b.dealName.toLowerCase().startsWith(q) ? 0 : 1;
    if (aStart !== bStart) return aStart - bStart;
    return a.dealName.localeCompare(b.dealName);
  });

  return allResults.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Import mode: ?dealId=X
// ---------------------------------------------------------------------------

const IMPORT_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "pb_location",
  "postal_code",
  "project_type",
  "closedate",
  "is_participate_energy",
  "pipeline",
  "dealstage",
];

async function importDeal(dealId: string) {
  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  // Fetch deal properties
  const dealResponse = await hubspotClient.crm.deals.basicApi.getById(
    dealId,
    IMPORT_PROPERTIES,
  );
  const props = dealResponse.properties;

  const pbLocation = normalizeLocation(String(props.pb_location || ""));

  const deal = {
    dealId: String(props.hs_object_id),
    dealName: String(props.dealname || "Untitled"),
    amount: props.amount ? parseFloat(String(props.amount)) : null,
    pbLocation,
    postalCode: String(props.postal_code || "").trim() || null,
    projectType: String(props.project_type || "").toLowerCase(),
    isPE: String(props.is_participate_energy || "").toLowerCase() === "true",
    closeDate: props.closedate ? String(props.closedate) : null,
    hubspotUrl: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`,
  };

  // Fetch line items
  const rawLineItems = await fetchLineItemsForDeal(dealId);

  const lineItems = rawLineItems.map((li) => ({
    id: li.id,
    name: li.name,
    sku: li.sku,
    quantity: li.quantity,
    unitPrice: li.price,
    totalPrice: li.amount,
    category: li.productCategory,
    manufacturer: li.manufacturer,
    matchedEquipment: matchLineItemToEquipment(
      li.name,
      li.sku,
      li.productCategory,
      li.manufacturer,
    ),
  }));

  return { deal, lineItems };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");
  const dealId = searchParams.get("dealId");

  if (!query && !dealId) {
    return NextResponse.json(
      { error: "Provide ?q= for search or ?dealId= for import" },
      { status: 400 },
    );
  }

  if (query && query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    if (dealId) {
      const result = await importDeal(dealId);
      return NextResponse.json(result);
    }

    const results = await searchDeals(query!);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[deal-import] Error:", err);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 },
    );
  }
}
