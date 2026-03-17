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
    const location = searchParams.get("location");
    const priority = searchParams.get("priority");
    const stage = searchParams.get("stage");
    const search = searchParams.get("search");
    const forceRefresh = searchParams.get("refresh") === "true";

    const { data: tickets, lastUpdated } = await appCache.getOrFetch<EnrichedTicketItem[]>(
      CACHE_KEYS.SERVICE_TICKETS,
      fetchServiceTickets,
      forceRefresh
    );

    let filtered = tickets;

    // Apply filters
    if (location && location !== "all") {
      filtered = filtered.filter(t => t.location === location);
    }
    if (priority && priority !== "all") {
      filtered = filtered.filter(t => t.priority === priority);
    }
    if (stage && stage !== "all") {
      filtered = filtered.filter(t => t.stage === stage);
    }
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

    // Fetch HubSpot owners for assignee dropdown
    let owners: Array<{ id: string; name: string }> = [];
    try {
      const ownersResponse = await hubspotClient.crm.owners.ownersApi.getPage();
      owners = (ownersResponse.results || []).map(o => ({
        id: o.id,
        name: `${o.firstName || ""} ${o.lastName || ""}`.trim() || o.email || o.id,
      })).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      console.warn("[ServiceTickets] Failed to fetch owners for dropdown");
    }

    return NextResponse.json({
      tickets: filtered,
      total: tickets.length,
      filteredCount: filtered.length,
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
