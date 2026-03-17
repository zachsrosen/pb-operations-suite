import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { buildPriorityQueue, type PriorityItem, type PriorityTier } from "@/lib/service-priority";
import { initPriorityQueueCascade, QUEUE_CACHE_KEY } from "@/lib/service-priority-cache";
import { PIPELINE_IDS, STAGE_MAPS, ACTIVE_STAGES } from "@/lib/deals-pipeline";
import { hubspotClient } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

// Initialize cascade listener at module scope (singleton, process-local)
initPriorityQueueCascade();

async function fetchServiceDeals(): Promise<PriorityItem[]> {
  const pipelineId = PIPELINE_IDS.service;
  const stageMap = STAGE_MAPS.service;
  const activeStageNames = new Set(ACTIVE_STAGES.service);

  const properties = [
    "hs_object_id", "dealname", "amount", "dealstage", "pipeline",
    "closedate", "createdate", "hs_lastmodifieddate",
    "pb_location", "hubspot_owner_id", "notes_last_contacted",
  ];

  const activeStageIds = Object.entries(stageMap)
    .filter(([, name]) => activeStageNames.has(name))
    .map(([id]) => id);

  // Single filterGroup with IN operator — avoids the 5-filterGroups-per-request limit
  const searchRequest = {
    filterGroups: [{
      filters: [
        { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId },
        { propertyName: "dealstage", operator: FilterOperatorEnum.In, values: activeStageIds },
      ],
    }],
    properties,
    limit: 100,
  };

  try {
    const response = await hubspotClient.crm.deals.searchApi.doSearch(searchRequest);
    const deals = response.results || [];

    return deals.map(deal => {
      const dealstage = deal.properties.dealstage ?? "";
      return {
        id: deal.properties.hs_object_id || deal.id,
        type: "deal" as const,
        title: deal.properties.dealname || "Untitled Deal",
        stage: stageMap[dealstage] || dealstage || "Unknown",
        lastModified: deal.properties.hs_lastmodifieddate || deal.properties.createdate || new Date().toISOString(),
        lastContactDate: deal.properties.notes_last_contacted || null,
        createDate: deal.properties.createdate || new Date().toISOString(),
        amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
        location: deal.properties.pb_location || null,
        url: `https://app.hubspot.com/contacts/${process.env.HUBSPOT_PORTAL_ID || ""}/deal/${deal.id}`,
      };
    });
  } catch (error) {
    console.error("[PriorityQueue] Error fetching service deals:", error);
    return [];
  }
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

    const { searchParams } = new URL(request.url);
    const location = searchParams.get("location");
    const forceRefresh = searchParams.get("refresh") === "true";

    // Fetch with cache (bypass debounce on manual refresh)
    const { data, lastUpdated } = await appCache.getOrFetch(
      QUEUE_CACHE_KEY,
      async () => {
        const deals = await fetchServiceDeals();

        // Fetch overrides from DB
        const overrides = prisma
          ? await prisma.servicePriorityOverride.findMany({
              where: {
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            })
          : [];

        const queue = buildPriorityQueue(
          deals,
          overrides.map(o => ({
            itemId: o.itemId,
            itemType: o.itemType,
            overridePriority: o.overridePriority as PriorityTier,
          }))
        );

        return { queue, fetchedAt: new Date().toISOString() };
      },
      forceRefresh
    );

    let queue = data.queue;

    // Apply location filter
    if (location && location !== "all") {
      queue = queue.filter(item => item.item.location === location);
    }

    // Compute stats
    const stats = {
      total: queue.length,
      critical: queue.filter(i => i.tier === "critical").length,
      high: queue.filter(i => i.tier === "high").length,
      medium: queue.filter(i => i.tier === "medium").length,
      low: queue.filter(i => i.tier === "low").length,
    };

    // Get unique locations for filter
    const locations = [...new Set(
      data.queue
        .map(i => i.item.location)
        .filter((l): l is string => !!l)
    )].sort();

    return NextResponse.json({
      queue,
      stats,
      locations,
      lastUpdated,
    });
  } catch (error) {
    console.error("[PriorityQueue] Error:", error);
    return NextResponse.json({ error: "Failed to load priority queue" }, { status: 500 });
  }
}
