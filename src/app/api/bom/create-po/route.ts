// src/app/api/bom/create-po/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";
import { prisma } from "@/lib/db";
import { EquipmentCategory } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",
]);

// Only these BOM categories map to EquipmentSku rows — others (RACKING,
// RAPID_SHUTDOWN, etc.) are not in the DB and must not be cast to the enum.
const INVENTORY_CATEGORIES = new Set<EquipmentCategory>([
  "MODULE",
  "INVERTER",
  "BATTERY",
  "EV_CHARGER",
]);

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  let body: { dealId?: string; version?: number; vendorId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, version, vendorId } = body;
  if (!dealId || typeof version !== "number" || !vendorId) {
    return NextResponse.json(
      { error: "dealId, version, and vendorId are required" },
      { status: 400 }
    );
  }

  // 1. Load the BOM snapshot
  const snapshot = await prisma.projectBomSnapshot.findFirst({
    where: { dealId: String(dealId), version },
  });
  if (!snapshot) {
    return NextResponse.json({ error: "BOM snapshot not found" }, { status: 404 });
  }

  // 2. If PO already created, return existing ID (idempotency guard)
  // This handles the primary duplicate risk: UI retry after Zoho success + DB failure.
  // Concurrent-click protection is handled by `creatingPo` UI state (button disables on click).
  if (snapshot.zohoPoId) {
    return NextResponse.json({
      purchaseorder_id: snapshot.zohoPoId,
      purchaseorder_number: null,
      unmatchedCount: 0,
      alreadyExisted: true,
    });
  }

  // 3. Build line items — look up zohoItemId per BOM item
  const bomData = snapshot.bomData as {
    project?: { address?: string };
    items?: Array<{
      category: string;
      brand?: string | null;
      model?: string | null;
      description: string;
      qty: number | string;
    }>;
  };

  const bomItems = Array.isArray(bomData?.items) ? bomData.items : [];

  // Batch-lookup SKUs by (category, brand, model) to get zohoItemId.
  // Only include items whose category maps to the EquipmentSku table —
  // non-inventory categories (RACKING, RAPID_SHUTDOWN, etc.) are not stored
  // there and casting them to the Prisma enum would throw a validation error.
  const skuLookups = bomItems
    .filter(
      (item) =>
        item.category &&
        item.brand &&
        item.model &&
        INVENTORY_CATEGORIES.has(item.category as EquipmentCategory)
    )
    .map((item) => ({
      category: item.category as EquipmentCategory,
      brand: item.brand!,
      model: item.model!,
    }));

  const skuMap = new Map<string, string | null>(); // "category:brand:model" → zohoItemId
  if (skuLookups.length > 0) {
    const skus = await prisma.equipmentSku.findMany({
      where: {
        OR: skuLookups.map((s) => ({
          category: s.category,
          brand: s.brand,
          model: s.model,
        })),
      },
      select: { category: true, brand: true, model: true, zohoItemId: true },
    });
    for (const sku of skus) {
      skuMap.set(`${sku.category}:${sku.brand}:${sku.model}`, sku.zohoItemId ?? null);
    }
  }

  let unmatchedCount = 0;
  const lineItems = bomItems.map((item) => {
    const key = `${item.category}:${item.brand ?? ""}:${item.model ?? ""}`;
    const zohoItemId = skuMap.get(key) ?? null;
    const name =
      item.model
        ? `${item.brand ? item.brand + " " : ""}${item.model}`
        : item.description;

    if (!zohoItemId) unmatchedCount++;

    // Quantity: parse carefully — `|| 1` would silently over-order on invalid values.
    // Use 1 as minimum only when the parsed value is truly 0/NaN after rounding.
    const parsedQty = Math.round(Number(item.qty));
    const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;

    return {
      ...(zohoItemId ? { item_id: zohoItemId } : {}),
      name,
      quantity,
      description: item.description,
    };
  });

  // 4. Create PO in Zoho
  const address = bomData?.project?.address ?? "";
  let poResult: { purchaseorder_id: string; purchaseorder_number: string };
  try {
    poResult = await zohoInventory.createPurchaseOrder({
      vendor_id: vendorId,
      reference_number: snapshot.dealName,
      notes: `Generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
      status: "draft",
      line_items: lineItems,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Zoho API error";
    console.error("[bom/create-po] Zoho error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 5. Store zohoPoId on snapshot
  await prisma.projectBomSnapshot.update({
    where: { id: snapshot.id },
    data: { zohoPoId: poResult.purchaseorder_id },
  });

  return NextResponse.json({
    purchaseorder_id: poResult.purchaseorder_id,
    purchaseorder_number: poResult.purchaseorder_number,
    unmatchedCount,
  });
}
