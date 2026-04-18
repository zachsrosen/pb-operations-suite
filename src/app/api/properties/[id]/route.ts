import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getUserByEmail } from "@/lib/db";
import { isPathAllowedByAccess, resolveUserAccess } from "@/lib/user-access";
import {
  computeEquipmentSummary,
  createEmptySummary,
  mapCacheRowToPropertyDetail,
  type PropertyDetail,
  type EquipmentSummary,
} from "@/lib/property-detail";

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

    const property = await prisma.hubSpotPropertyCache.findUnique({
      where: { hubspotObjectId: id },
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

    const detail: PropertyDetail = { ...base, equipmentSummary };

    return NextResponse.json(detail);
  } catch (error) {
    console.error("[PropertyDetail] Error:", error);
    return NextResponse.json(
      { error: "Failed to load property" },
      { status: 500 },
    );
  }
}
