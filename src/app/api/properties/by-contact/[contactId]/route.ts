import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getUserByEmail } from "@/lib/db";
import { canAccessRoute } from "@/lib/role-permissions";
import {
  computeEquipmentSummary,
  mapCacheRowToPropertyDetail,
  normalizeOwnershipLabel,
  type PropertyDetail,
  type EquipmentSummary,
} from "@/lib/property-detail";

/**
 * GET /api/properties/by-contact/[contactId]
 *
 * Returns every Property a given HubSpot contact is linked to, sorted
 * most-recently-associated first. The `ownershipLabel` + `associatedAt` on
 * each returned detail describe THIS contact's relationship to the property
 * (not the most-recent-across-all-contacts default used by the drawer
 * endpoint) — this is the whole reason the endpoint exists.
 *
 * Role gate mirrors the property drawer (Task 5.1) and the service customer
 * APIs: `canAccessRoute(role, "/api/service")`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
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

    if (!canAccessRoute(user.role, "/api/service")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { contactId } = await params;

    const links = await prisma.propertyContactLink.findMany({
      where: { contactId },
      include: {
        property: {
          include: {
            dealLinks: true,
            ticketLinks: true,
            contactLinks: true,
          },
        },
      },
      orderBy: { associatedAt: "desc" },
    });

    if (links.length === 0) {
      return NextResponse.json({ properties: [] });
    }

    // N+1 on HubSpot calls is acceptable at v1 scale — one contact rarely
    // owns >3 properties. If that changes, batch fetchLineItemsForDeals by
    // unioning dealIds across all properties and partitioning the result.
    const properties: PropertyDetail[] = [];
    for (const link of links) {
      const base = mapCacheRowToPropertyDetail(link.property, {
        ownershipLabel: normalizeOwnershipLabel(link.label),
        associatedAt: link.associatedAt,
      });

      let equipmentSummary: EquipmentSummary;
      try {
        equipmentSummary = await computeEquipmentSummary(base.dealIds);
      } catch (err) {
        console.error(
          `[PropertyByContact] equipment summary failed for property ${base.hubspotObjectId}; returning zeros`,
          err,
        );
        equipmentSummary = {
          modules: { count: 0, totalWattage: 0 },
          inverters: { count: 0 },
          batteries: { count: 0, totalKwh: 0 },
          evChargers: { count: 0 },
        };
      }

      properties.push({ ...base, equipmentSummary });
    }

    return NextResponse.json({ properties });
  } catch (error) {
    console.error("[PropertyByContact] Error:", error);
    return NextResponse.json(
      { error: "Failed to load properties for contact" },
      { status: 500 },
    );
  }
}
