import { NextRequest, NextResponse } from "next/server";
import { Client } from "@hubspot/api-client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getUserByEmail } from "@/lib/db";
import { isPathAllowedByAccess, resolveUserAccess } from "@/lib/user-access";
import { withRetry } from "@/lib/hubspot-custom-objects";
import {
  computeEquipmentSummary,
  createEmptySummary,
  mapCacheRowToPropertyDetail,
  type PropertyDetail,
  type EquipmentSummary,
} from "@/lib/property-detail";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 2,
});

async function resolveContactNames(
  contactIds: string[],
): Promise<{ id: string; name: string }[]> {
  if (!contactIds.length) return [];
  try {
    const response = await withRetry(() =>
      hubspotClient.crm.contacts.batchApi.read({
        inputs: contactIds.map((id) => ({ id })),
        properties: ["firstname", "lastname"],
        propertiesWithHistory: [],
      }),
    );
    return response.results.map((r) => {
      const first = (r.properties as Record<string, string>).firstname ?? "";
      const last = (r.properties as Record<string, string>).lastname ?? "";
      const name = [first, last].filter(Boolean).join(" ") || `Contact ${r.id}`;
      return { id: r.id, name };
    });
  } catch {
    return contactIds.map((id) => ({ id, name: `Contact ${id}` }));
  }
}

async function resolveDealNames(
  dealIds: string[],
): Promise<{ id: string; name: string }[]> {
  if (!dealIds.length) return [];
  try {
    const response = await withRetry(() =>
      hubspotClient.crm.deals.batchApi.read({
        inputs: dealIds.map((id) => ({ id })),
        properties: ["dealname"],
        propertiesWithHistory: [],
      }),
    );
    return response.results.map((r) => {
      const name = (r.properties as Record<string, string>).dealname || `Deal ${r.id}`;
      return { id: r.id, name };
    });
  } catch {
    return dealIds.map((id) => ({ id, name: `Deal ${id}` }));
  }
}

async function resolveTicketSubjects(
  ticketIds: string[],
): Promise<{ id: string; subject: string }[]> {
  if (!ticketIds.length) return [];
  try {
    const response = await withRetry(() =>
      hubspotClient.crm.tickets.batchApi.read({
        inputs: ticketIds.map((id) => ({ id })),
        properties: ["subject"],
        propertiesWithHistory: [],
      }),
    );
    return response.results.map((r) => {
      const subject = (r.properties as Record<string, string>).subject || `Ticket ${r.id}`;
      return { id: r.id, subject };
    });
  } catch {
    return ticketIds.map((id) => ({ id, subject: `Ticket ${id}` }));
  }
}

/**
 * GET /api/properties/[id]
 *
 * Drawer/detail endpoint for a single Property. The URL param is the HubSpot
 * object ID (not our cuid). Reads everything from the cache row + link tables
 * and makes one live HubSpot call — `fetchLineItemsForDeals` — to build the
 * equipment summary. Raw line items are not cached (plan decision 8), so a
 * small amount of live latency here is acceptable.
 *
 * If the HubSpot line-item fetch fails we degrade gracefully: the cached
 * rollup fields (`systemSizeKwDc`, `hasBattery`, …) still render, and the
 * summary returns zeros. Matches the codebase's "cache first, live fetch
 * degrades gracefully" pattern.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    // Property drawer is surfaced from Service Suite (customer 360, ticket
    // detail). Any role with `/api/service` access can read it. Using the real
    // `canAccessRoute` — tests must exercise the real function, not a mock.
    if (!isPathAllowedByAccess(resolveUserAccess(user), "/api/service")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Accept either hubspotObjectId (numeric string) or Prisma cuid
    const isHubSpotId = /^\d+$/.test(id);
    const property = await prisma.hubSpotPropertyCache.findUnique({
      where: isHubSpotId ? { hubspotObjectId: id } : { id },
      include: {
        contactLinks: { orderBy: { associatedAt: "desc" } },
        dealLinks: true,
        ticketLinks: true,
      },
    });

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const base = mapCacheRowToPropertyDetail(property);

    let equipmentSummary: EquipmentSummary;
    try {
      equipmentSummary = await computeEquipmentSummary(base.dealIds);
    } catch (err) {
      console.error(
        "[PropertyDetail] equipment summary failed; returning zeros",
        err,
      );
      equipmentSummary = createEmptySummary();
    }

    const [contacts, deals, tickets] = await Promise.all([
      resolveContactNames(base.contactIds),
      resolveDealNames(base.dealIds),
      resolveTicketSubjects(base.ticketIds),
    ]);

    const detail: PropertyDetail = { ...base, equipmentSummary, contacts, deals, tickets };

    return NextResponse.json(detail);
  } catch (error) {
    console.error("[PropertyDetail] Error:", error);
    return NextResponse.json(
      { error: "Failed to load property" },
      { status: 500 },
    );
  }
}
