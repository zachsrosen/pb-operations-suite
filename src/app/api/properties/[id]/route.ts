import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getUserByEmail } from "@/lib/db";
import { canAccessRoute } from "@/lib/role-permissions";
import {
  computeEquipmentSummary,
  normalizeOwnershipLabel,
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
  if (!canAccessRoute(user.role, "/api/service")) {
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

  const dealIds = property.dealLinks.map((l) => l.dealId);
  const ticketIds = property.ticketLinks.map((l) => l.ticketId);
  const contactIds = property.contactLinks.map((l) => l.contactId);

  let equipmentSummary: EquipmentSummary;
  try {
    equipmentSummary = await computeEquipmentSummary(dealIds);
  } catch (err) {
    console.error(
      `[api/properties/${id}] equipment summary failed; returning zeros`,
      err,
    );
    equipmentSummary = {
      modules: { count: 0, totalWattage: 0 },
      inverters: { count: 0 },
      batteries: { count: 0, totalKwh: 0 },
      evChargers: { count: 0 },
    };
  }

  // Ownership/associatedAt describe the MOST RECENT contact link (see
  // property-detail.ts for the full rationale). Falls back to a synthetic
  // "Current Owner" tied to the row's creation timestamp when the property
  // has no contact links (e.g. deal-seeded before any contact attached).
  const latestLink = property.contactLinks[0];
  const ownershipLabel = latestLink
    ? normalizeOwnershipLabel(latestLink.label)
    : ("Current Owner" as const);
  const associatedAt = latestLink?.associatedAt ?? property.createdAt;

  const detail: PropertyDetail = {
    id: property.id,
    hubspotObjectId: property.hubspotObjectId,
    fullAddress: property.fullAddress,
    lat: property.latitude,
    lng: property.longitude,
    pbLocation: property.pbLocation,
    ahjName: property.ahjName,
    utilityName: property.utilityName,

    firstInstallDate: property.firstInstallDate,
    mostRecentInstallDate: property.mostRecentInstallDate,
    systemSizeKwDc: property.systemSizeKwDc,
    hasBattery: property.hasBattery,
    hasEvCharger: property.hasEvCharger,
    openTicketsCount: property.openTicketsCount,
    lastServiceDate: property.lastServiceDate,
    earliestWarrantyExpiry: property.earliestWarrantyExpiry,

    ownershipLabel,
    associatedAt,

    dealIds,
    ticketIds,
    contactIds,

    equipmentSummary,
  };

  return NextResponse.json(detail);
}
