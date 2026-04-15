/**
 * Service Team — Sales Pipeline Summary
 *
 * Surfaces sales-pipeline deals assigned to the service team members
 * (Ted, Jake, Terrell, Mike Wagner) on the Service Overview dashboard.
 * These are sales opportunities owned by service-side folks — the service
 * team needs visibility into them without context-switching into the
 * sales suite.
 *
 * Owner IDs are hardcoded because they're identity, not configuration.
 * To add someone: append to SERVICE_TEAM_OWNERS below.
 */
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { searchWithRetry } from "@/lib/hubspot";
import { PIPELINE_IDS, getStageMaps } from "@/lib/deals-pipeline";
import { getHubSpotDealUrl } from "@/lib/external-links";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

// HubSpot owner IDs for the service team. Resolved via HubSpot search_owners
// on 2026-04-15. If someone rotates off the service team, remove them here.
const SERVICE_TEAM_OWNERS: Array<{ id: string; name: string }> = [
  { id: "611711241", name: "Ted Barnett" },
  { id: "218237058", name: "Jake Brann" },
  { id: "1220714576", name: "Terrell Sanks" },
  { id: "395832312", name: "Mike Wagner" },
];

const MAX_DEALS = 200;

interface SalesDeal {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  ownerId: string | null;
  ownerName: string | null;
  closeDate: string | null;
  lastModified: string;
  url: string;
}

interface SalesPipelineResponse {
  deals: SalesDeal[];
  summary: {
    totalDeals: number;
    totalValue: number;
    byOwner: Array<{ ownerId: string; ownerName: string; deals: number; value: number }>;
  };
  lastUpdated: string;
}

async function fetchSalesPipeline(): Promise<Omit<SalesPipelineResponse, "lastUpdated">> {
  const salesPipelineId = PIPELINE_IDS.sales;
  const ownerIds = SERVICE_TEAM_OWNERS.map((o) => o.id);
  const ownerNameById = new Map(SERVICE_TEAM_OWNERS.map((o) => [o.id, o.name]));

  const stageMaps = await getStageMaps();
  const salesStageMap = stageMaps.sales || {};

  // HubSpot search: pipeline = sales AND owner IN [...service team].
  // Exclude closed stages at the filter level to reduce payload.
  const searchRequest = {
    filterGroups: [
      {
        filters: [
          { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: salesPipelineId },
          { propertyName: "hubspot_owner_id", operator: FilterOperatorEnum.In, values: ownerIds },
          { propertyName: "dealstage", operator: FilterOperatorEnum.NotIn, values: ["closedwon", "closedlost"] },
        ],
      },
    ],
    properties: [
      "dealname",
      "dealstage",
      "amount",
      "hubspot_owner_id",
      "closedate",
      "hs_lastmodifieddate",
    ],
    limit: MAX_DEALS,
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }] as unknown as string[],
    after: "0",
  };

  const response = await searchWithRetry(searchRequest);
  const rawDeals = response.results || [];

  const deals: SalesDeal[] = rawDeals.map((d) => {
    const stageId = d.properties?.dealstage || "";
    const stageLabel = salesStageMap[stageId] || stageId || "Unknown";
    const amountStr = d.properties?.amount;
    const amount = amountStr ? Number(amountStr) : null;
    const ownerId = d.properties?.hubspot_owner_id || null;
    return {
      id: d.id,
      name: d.properties?.dealname || "Untitled Deal",
      stage: stageLabel,
      amount: Number.isFinite(amount) ? amount : null,
      ownerId,
      ownerName: ownerId ? ownerNameById.get(ownerId) ?? null : null,
      closeDate: d.properties?.closedate || null,
      lastModified: d.properties?.hs_lastmodifieddate || "",
      url: getHubSpotDealUrl(d.id),
    };
  });

  // Summary: per-owner deal count + total value.
  const byOwnerMap = new Map<string, { ownerId: string; ownerName: string; deals: number; value: number }>();
  for (const { id, name } of SERVICE_TEAM_OWNERS) {
    byOwnerMap.set(id, { ownerId: id, ownerName: name, deals: 0, value: 0 });
  }
  let totalValue = 0;
  for (const d of deals) {
    if (d.ownerId && byOwnerMap.has(d.ownerId)) {
      const bucket = byOwnerMap.get(d.ownerId)!;
      bucket.deals += 1;
      if (d.amount) bucket.value += d.amount;
    }
    if (d.amount) totalValue += d.amount;
  }

  return {
    deals,
    summary: {
      totalDeals: deals.length,
      totalValue,
      byOwner: Array.from(byOwnerMap.values()),
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "true";

    const { data, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEYS.SERVICE_SALES_PIPELINE,
      fetchSalesPipeline,
      forceRefresh,
    );

    return NextResponse.json({ ...data, lastUpdated });
  } catch (error) {
    console.error("[ServiceSalesPipeline] Error:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to load sales pipeline" },
      { status: 500 },
    );
  }
}
