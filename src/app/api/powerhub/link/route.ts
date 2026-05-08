import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { siteId, dealId } = await request.json();
  if (!siteId || !dealId) {
    return NextResponse.json({ error: "siteId and dealId required" }, { status: 400 });
  }

  const site = await prisma.powerhubSite.findUnique({
    where: { siteId },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Backfill address from the deal's HubSpot cache when linking
  const dealCache = await prisma.hubSpotProjectCache.findUnique({
    where: { dealId },
    select: { address: true, city: true, state: true, zipCode: true },
  });

  await prisma.powerhubSite.update({
    where: { siteId },
    data: {
      dealId,
      linkMethod: "MANUAL",
      linkConfidence: "HIGH",
      // Populate address from deal if site has none
      ...(dealCache?.address && !site.address
        ? {
            address: dealCache.address,
            city: dealCache.city || "",
            state: dealCache.state || "",
            zip: dealCache.zipCode || null,
          }
        : {}),
    },
  });

  return NextResponse.json({ success: true });
}
