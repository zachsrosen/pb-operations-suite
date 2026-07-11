import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveDealSummaries,
  resolveTicketSummaries,
  resolveContactNames,
} from "@/lib/powerhub-site-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const { siteId } = await params;

  const site = await prisma.powerhubSite.findUnique({
    where: { siteId },
    include: {
      telemetrySnapshot: true,
      alerts: {
        where: { isActive: true },
        orderBy: { reportedAt: "desc" },
      },
      property: {
        select: {
          id: true,
          fullAddress: true,
          streetAddress: true,
          city: true,
          state: true,
          zip: true,
          systemSizeKwDc: true,
          hasBattery: true,
          hasEvCharger: true,
          openTicketsCount: true,
          associatedDealsCount: true,
          firstInstallDate: true,
          mostRecentInstallDate: true,
          earliestWarrantyExpiry: true,
          ahjName: true,
          utilityName: true,
          pbLocation: true,
          contactLinks: {
            select: {
              contactId: true,
              label: true,
            },
            take: 5,
          },
          ticketLinks: {
            select: {
              ticketId: true,
            },
            orderBy: { associatedAt: "desc" },
            take: 10,
          },
        },
      },
    },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Nearly all sites are GEO-linked to a property with no direct dealId —
  // resolve the deal through the property's most recent PropertyDealLink.
  let effectiveDealId = site.dealId;
  if (!effectiveDealId && site.propertyId) {
    const link = await prisma.propertyDealLink.findFirst({
      where: { propertyId: site.propertyId },
      orderBy: { associatedAt: "desc" },
      select: { dealId: true },
    });
    effectiveDealId = link?.dealId ?? null;
  }

  // Resolve human labels live from HubSpot (the HubSpotProjectCache table
  // this route previously read has no writer and is empty in prod). Each
  // resolver degrades to an empty map, so the payload falls back to IDs.
  const [dealMap, ticketMap, contactMap] = await Promise.all([
    effectiveDealId ? resolveDealSummaries([effectiveDealId]) : Promise.resolve(new Map()),
    site.property?.ticketLinks.length
      ? resolveTicketSummaries(site.property.ticketLinks.map((l) => l.ticketId))
      : Promise.resolve(new Map()),
    site.property?.contactLinks.length
      ? resolveContactNames(site.property.contactLinks.map((l) => l.contactId))
      : Promise.resolve(new Map()),
  ]);

  const dealSummary = effectiveDealId ? dealMap.get(effectiveDealId) : undefined;
  const deal = dealSummary
    ? {
        dealId: effectiveDealId,
        dealName: dealSummary.dealName,
        stage: dealSummary.stageLabel,
      }
    : null;

  const property = site.property
    ? {
        ...site.property,
        ticketLinks: site.property.ticketLinks.map((l) => ({
          ...l,
          ...(ticketMap.get(l.ticketId) ?? {}),
        })),
        contactLinks: site.property.contactLinks.map((l) => {
          const name = contactMap.get(l.contactId);
          return name ? { ...l, name } : l;
        }),
      }
    : null;

  return NextResponse.json({ site: { ...site, property }, deal });
}
