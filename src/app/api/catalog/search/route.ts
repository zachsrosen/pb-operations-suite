import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!prisma) return NextResponse.json([], { status: 503 });

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  const results = await prisma.equipmentSku.findMany({
    where: {
      isActive: true,
      OR: [
        { brand: { contains: q, mode: "insensitive" } },
        { model: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { vendorPartNumber: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      category: true,
      brand: true,
      model: true,
      description: true,
      unitSpec: true,
      unitLabel: true,
      unitCost: true,
      sellPrice: true,
      sku: true,
      vendorName: true,
      zohoVendorId: true,
      vendorPartNumber: true,
      hardToProcure: true,
      length: true,
      width: true,
      weight: true,
      hubspotProductId: true,
      zuperItemId: true,
      zohoItemId: true,
      // photoUrl deferred to Task 13 when schema column lands
      // Include category-specific spec relations for clone prefill
      moduleSpec: true,
      inverterSpec: true,
      batterySpec: true,
      evChargerSpec: true,
      mountingHardwareSpec: true,
      electricalHardwareSpec: true,
      relayDeviceSpec: true,
    },
    take: 20,
    orderBy: { brand: "asc" },
  });

  return NextResponse.json(results);
}
