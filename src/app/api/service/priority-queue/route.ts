import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { buildPriorityQueue, type PriorityItem, type PriorityTier } from "@/lib/service-priority";
import { initPriorityQueueCascade, QUEUE_CACHE_KEY } from "@/lib/service-priority-cache";
import { PIPELINE_IDS, STAGE_MAPS, ACTIVE_STAGES } from "@/lib/deals-pipeline";
import { hubspotClient } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { fetchServiceTickets } from "@/lib/hubspot-tickets";

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

  const allItems: PriorityItem[] = [];

  try {
    let after: string | undefined;
    do {
      // Single filterGroup with IN operator — avoids the 5-filterGroups-per-request limit
      const searchRequest: Record<string, unknown> = {
        filterGroups: [{
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId },
            { propertyName: "dealstage", operator: FilterOperatorEnum.In, values: activeStageIds },
          ],
        }],
        properties,
        limit: 100,
        ...(after ? { after } : {}),
      };

      const response = await hubspotClient.crm.deals.searchApi.doSearch(searchRequest);
      const deals = response.results || [];

      for (const deal of deals) {
        const dealstage = deal.properties.dealstage ?? "";
        allItems.push({
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
          ownerId: deal.properties.hubspot_owner_id || null,
        });
      }

      after = response.paging?.next?.after;
    } while (after);

    return allItems;
  } catch (error) {
    console.error("[PriorityQueue] Error fetching service deals:", error);
    return allItems; // Return whatever we collected before the error
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
    const forceRefresh = searchParams.get("refresh") === "true";

    // Fetch with cache (bypass debounce on manual refresh)
    const { data, lastUpdated } = await appCache.getOrFetch(
      QUEUE_CACHE_KEY,
      async () => {
        // Fetch deals and tickets in parallel
        const [deals, tickets] = await Promise.all([
          fetchServiceDeals(),
          fetchServiceTickets(),
        ]);

        const allItems = [...deals, ...tickets];

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
          allItems,
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

    const queue = data.queue;

    // Stats computed client-side now — still send global stats for initial render
    const stats = {
      total: queue.length,
      critical: queue.filter(i => i.tier === "critical").length,
      high: queue.filter(i => i.tier === "high").length,
      medium: queue.filter(i => i.tier === "medium").length,
      low: queue.filter(i => i.tier === "low").length,
    };

    // Get unique locations for filter
    const locations = [...new Set(
      queue
        .map(i => i.item.location)
        .filter((l): l is string => !!l)
    )].sort();

    // Fetch all HubSpot owners for filter dropdown (paginated)
    let owners: Array<{ id: string; name: string }> = [];
    try {
      let ownerAfter: string | undefined;
      do {
        const ownersResponse = await hubspotClient.crm.owners.ownersApi.getPage(
          undefined, ownerAfter, 100
        );
        for (const o of ownersResponse.results || []) {
          owners.push({
            id: o.id,
            name: `${o.firstName || ""} ${o.lastName || ""}`.trim() || o.email || o.id,
          });
        }
        ownerAfter = ownersResponse.paging?.next?.after;
      } while (ownerAfter);
      owners.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      console.warn("[PriorityQueue] Failed to fetch owners for dropdown");
    }

    return NextResponse.json({
      queue,
      stats,
      locations,
      owners,
      lastUpdated,
    });
  } catch (error) {
    console.error("[PriorityQueue] Error:", error);
    return NextResponse.json({ error: "Failed to load priority queue" }, { status: 500 });
  }
}
