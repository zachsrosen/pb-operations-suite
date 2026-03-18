import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { hubspotClient } from "@/lib/hubspot";
import {
  fetchServiceTickets,
  getTicketStageMap,
  type EnrichedTicketItem,
} from "@/lib/hubspot-tickets";

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
    const search = searchParams.get("search");
    const forceRefresh = searchParams.get("refresh") === "true";

    const { data: tickets, lastUpdated } = await appCache.getOrFetch<EnrichedTicketItem[]>(
      CACHE_KEYS.SERVICE_TICKETS,
      fetchServiceTickets,
      forceRefresh
    );

    // Only apply search server-side (reduces payload); all other filtering is client-side
    let filtered = tickets;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.id.includes(q)
      );
    }

    // Get unique locations for filter dropdown
    const locations = [...new Set(tickets.map(t => t.location).filter((l): l is string => !!l))].sort();

    // Fetch stage map for metadata + pipeline display order
    const { map: stageMap, orderedStageIds } = await getTicketStageMap();

    // Return stages in pipeline display order (not alphabetical)
    // Only include stages that have tickets OR are in the pipeline
    const stageNames = orderedStageIds.map(id => stageMap[id]).filter(Boolean);

    // Derive owner filter options from tickets that actually have owners assigned.
    // Fetch all HubSpot owners once (paginated), then filter to only IDs in the data.
    const ownerIdsInData = new Set(
      tickets.map(t => t.ownerId).filter((id): id is string => !!id)
    );

    let owners: Array<{ id: string; name: string }> = [];
    if (ownerIdsInData.size > 0) {
      try {
        let after: string | undefined;
        do {
          const ownersResponse = await hubspotClient.crm.owners.ownersApi.getPage(
            undefined, after, 100
          );
          for (const o of ownersResponse.results || []) {
            if (ownerIdsInData.has(o.id)) {
              owners.push({
                id: o.id,
                name: `${o.firstName || ""} ${o.lastName || ""}`.trim() || o.email || o.id,
              });
            }
          }
          after = ownersResponse.paging?.next?.after;
        } while (after);
        owners.sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        owners = [...ownerIdsInData].map(id => ({ id, name: id }));
        console.warn("[ServiceTickets] Failed to resolve owner names, using IDs");
      }
    }

    return NextResponse.json({
      tickets: filtered,
      total: tickets.length,
      locations,
      stages: stageNames,
      stageMap: stageMap,
      owners,
      lastUpdated,
    });
  } catch (error) {
    console.error("[ServiceTickets] Error:", error);
    return NextResponse.json({ error: "Failed to load service tickets" }, { status: 500 });
  }
}
