// src/app/api/catalog/push-requests/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { EquipmentCategory } from "@/generated/prisma/enums";
import { getSpecTableName } from "@/lib/catalog-fields";

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
    const parsedUnitSpec = push.unitSpec ? parseFloat(push.unitSpec) : null;
    const unitSpecValue = parsedUnitSpec != null && !isNaN(parsedUnitSpec) ? parsedUnitSpec : null;

    const commonFields = {
      description: push.description || null,
      unitSpec: unitSpecValue,
      unitLabel: push.unitLabel || null,
      sku: push.sku || null,
      vendorName: push.vendorName || null,
      vendorPartNumber: push.vendorPartNumber || null,
      unitCost: push.unitCost,
      sellPrice: push.sellPrice,
      hardToProcure: push.hardToProcure,
      length: push.length,
      width: push.width,
      weight: push.weight,
    };

    const skuRecord = await prisma.$transaction(async (tx) => {
      // 1. Upsert EquipmentSku with all common fields
      const sku = await tx.equipmentSku.upsert({
        where: {
          category_brand_model: {
            category: push.category as EquipmentCategory,
            brand: push.brand,
            model: push.model,
          },
        },
        update: { isActive: true, ...commonFields },
        create: {
          category: push.category as EquipmentCategory,
          brand: push.brand,
          model: push.model,
          ...commonFields,
        },
      });

      // 2. Write category spec table from metadata (if present)
      const metadata = push.metadata as Record<string, unknown> | null;
      if (metadata && Object.keys(metadata).length > 0) {
        const specTable = getSpecTableName(push.category);
        if (specTable) {
          // Dynamic upsert for the correct spec table
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const prismaModel = (tx as any)[specTable];
          if (prismaModel?.upsert) {
            await prismaModel.upsert({
              where: { skuId: sku.id },
              create: { skuId: sku.id, ...metadata },
              update: metadata,
            });
          }
        }
      }

      return sku;
    });

    results.internalSkuId = skuRecord.id;
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
