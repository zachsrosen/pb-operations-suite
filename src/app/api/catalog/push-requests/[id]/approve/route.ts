// src/app/api/catalog/push-requests/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { EquipmentCategory } from "@/generated/prisma/enums";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const INTERNAL_CATEGORIES = Object.values(EquipmentCategory) as string[];

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.includes(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  const push = await prisma.pendingCatalogPush.findUnique({ where: { id } });
  if (!push) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (push.status !== "PENDING") {
    return NextResponse.json({ error: `Already ${push.status.toLowerCase()}` }, { status: 409 });
  }

  const results: Record<string, string | null> = {
    internalSkuId: null,
    zohoItemId: null,
    hubspotProductId: null,
    zuperItemId: null,
  };

  // INTERNAL catalog
  if (push.systems.includes("INTERNAL") && INTERNAL_CATEGORIES.includes(push.category)) {
    const sku = await prisma.equipmentSku.upsert({
      where: {
        category_brand_model: {
          category: push.category as EquipmentCategory,
          brand: push.brand,
          model: push.model,
        },
      },
      update: { isActive: true },
      create: {
        category: push.category as EquipmentCategory,
        brand: push.brand,
        model: push.model,
        unitSpec: (() => {
          if (!push.unitSpec) return null;
          const parsed = parseFloat(push.unitSpec);
          return isNaN(parsed) ? null : parsed;
        })(),
        unitLabel: push.unitLabel,
      },
    });
    results.internalSkuId = sku.id;
  }

  // ZOHO — TODO: implement when Zoho item-create API is wired
  if (push.systems.includes("ZOHO")) {
    // TODO: call zoho-inventory create item API
    console.log("[catalog/approve] ZOHO push not yet implemented for:", push.model);
  }

  // HUBSPOT — TODO: implement when HubSpot product API is wired
  if (push.systems.includes("HUBSPOT")) {
    // TODO: call HubSpot Products API
    console.log("[catalog/approve] HUBSPOT push not yet implemented for:", push.model);
  }

  // ZUPER — TODO: implement when Zuper parts API is wired
  if (push.systems.includes("ZUPER")) {
    // TODO: call Zuper parts/items API
    console.log("[catalog/approve] ZUPER push not yet implemented for:", push.model);
  }

  const updated = await prisma.pendingCatalogPush.update({
    where: { id },
    data: {
      status: "APPROVED",
      resolvedAt: new Date(),
      ...results,
    },
  });

  return NextResponse.json({ push: updated });
}
