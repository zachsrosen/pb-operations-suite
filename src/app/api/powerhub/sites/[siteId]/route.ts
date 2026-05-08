import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
        },
      },
    },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // If site is linked to a HubSpot deal, fetch deal + contact summary
  let deal: {
    dealId: string;
    dealName: string;
    stage: string;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pbLocation: string | null;
    closeDate: Date | null;
    systemSizeKw: number | null;
    batteryCount: number | null;
    inverterCount: number | null;
    moduleCount: number | null;
  } | null = null;

  if (site.dealId) {
    const cached = await prisma.hubSpotProjectCache.findUnique({
      where: { dealId: site.dealId },
      select: {
        dealId: true,
        dealName: true,
        stage: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        address: true,
        city: true,
        state: true,
        pbLocation: true,
        closeDate: true,
        systemSizeKw: true,
        batteryCount: true,
        inverterCount: true,
        moduleCount: true,
      },
    });
    if (cached) {
      deal = cached;
    }
  }

  return NextResponse.json({ site, deal });
}
