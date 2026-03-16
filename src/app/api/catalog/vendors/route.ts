import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const includeId = req.nextUrl.searchParams.get("includeId");

  const where = includeId
    ? { OR: [{ isActive: true }, { zohoVendorId: includeId }] }
    : { isActive: true };

  const vendors = await prisma.vendorLookup.findMany({
    where,
    select: { zohoVendorId: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ vendors });
}
