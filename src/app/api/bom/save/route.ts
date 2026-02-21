/**
 * BOM Save API
 *
 * POST /api/bom/save
 *   Accepts a structured BOM from the planset-bom skill and upserts
 *   equipment SKUs (MODULE, INVERTER, BATTERY, EV_CHARGER) into EquipmentSku.
 *   Returns counts of created/updated items.
 *   Auth required.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { EquipmentCategory } from "@/generated/prisma/enums";

// Only these categories map to the EquipmentCategory enum
const INVENTORY_CATEGORIES: Record<string, EquipmentCategory> = {
  MODULE: "MODULE",
  INVERTER: "INVERTER",
  BATTERY: "BATTERY",
  EV_CHARGER: "EV_CHARGER",
};

interface BomItem {
  category: string;
  brand: string | null;
  model: string | null;
  description: string;
  qty: number | string;
  unitSpec?: number | string | null;
  unitLabel?: string | null;
  source?: string;
  flags?: string[];
}

interface BomData {
  project: {
    customer?: string;
    address?: string;
    systemSizeKwdc?: number;
    systemSizeKwac?: number;
    moduleCount?: number;
    plansetRev?: string;
    stampDate?: string;
    utility?: string;
    ahj?: string;
  };
  items: BomItem[];
  validation?: {
    moduleCountMatch?: boolean | null;
    batteryCapacityMatch?: boolean | null;
    ocpdMatch?: boolean | null;
    warnings?: string[];
  };
}

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  let body: { bom: BomData };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { bom } = body;
  if (!bom?.items?.length) {
    return NextResponse.json(
      { error: "BOM items array is required" },
      { status: 400 }
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of bom.items) {
    const inventoryCategory = INVENTORY_CATEGORIES[item.category];
    if (!inventoryCategory) {
      skipped++;
      continue;
    }

    const brand = item.brand?.trim();
    const model = item.model?.trim();
    if (!brand || !model) {
      skipped++;
      continue;
    }

    const unitSpec = item.unitSpec != null ? Number(item.unitSpec) : null;
    const unitLabel = item.unitLabel || null;

    const result = await prisma.equipmentSku.upsert({
      where: {
        category_brand_model: {
          category: inventoryCategory,
          brand,
          model,
        },
      },
      update: {
        unitSpec: unitSpec ?? undefined,
        unitLabel: unitLabel ?? undefined,
        isActive: true,
      },
      create: {
        category: inventoryCategory,
        brand,
        model,
        unitSpec,
        unitLabel,
      },
    });

    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  await logActivity({
    type: "INVENTORY_SKU_SYNCED",
    description: `BOM save: ${created} created, ${updated} updated, ${skipped} skipped (non-inventory categories) from planset ${bom.project?.customer || "unknown"}`,
    userEmail: authResult.email,
    userName: authResult.name,
    entityType: "inventory",
    metadata: {
      created,
      updated,
      skipped,
      customer: bom.project?.customer,
      address: bom.project?.address,
      plansetRev: bom.project?.plansetRev,
    },
    ipAddress: authResult.ip,
    userAgent: authResult.userAgent,
    requestPath: "/api/bom/save",
    requestMethod: "POST",
    responseStatus: 200,
  });

  return NextResponse.json({ created, updated, skipped });
}
