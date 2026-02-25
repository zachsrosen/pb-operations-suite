// src/app/api/bom/create-so/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";
import { logActivity, prisma } from "@/lib/db";
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

// Only these BOM categories map to EquipmentSku rows
const INVENTORY_CATEGORIES = new Set<EquipmentCategory>([
  "MODULE",
  "INVERTER",
  "BATTERY",
  "EV_CHARGER",
]);

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ALLOWED_ROLES.has(authResult.role)) {
    await logActivity({
      type: "API_ERROR",
      description: "BOM create-so denied: insufficient permissions",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_so",
      metadata: { event: "bom_create_so", outcome: "failed", reason: "insufficient_permissions" },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-so",
      requestMethod: "POST",
      responseStatus: 403,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!zohoInventory.isConfigured()) {
    await logActivity({
      type: "API_ERROR",
      description: "BOM create-so failed: Zoho Inventory not configured",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_so",
      metadata: { event: "bom_create_so", outcome: "failed", reason: "zoho_not_configured" },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-so",
      requestMethod: "POST",
      responseStatus: 503,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  let body: { dealId?: string; version?: number; customerId?: string };
  try {
    body = await request.json();
  } catch {
    await logActivity({
      type: "API_ERROR",
      description: "BOM create-so failed: invalid JSON",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_so",
      metadata: { event: "bom_create_so", outcome: "failed", reason: "invalid_json" },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-so",
      requestMethod: "POST",
      responseStatus: 400,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, version, customerId } = body;
  if (!dealId || typeof version !== "number" || !customerId) {
    await logActivity({
      type: "API_ERROR",
      description: "BOM create-so failed: missing required fields",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_so",
      metadata: { event: "bom_create_so", outcome: "failed", reason: "missing_fields", dealId, version, hasCustomerId: !!customerId },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-so",
      requestMethod: "POST",
      responseStatus: 400,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "dealId, version, and customerId are required" },
      { status: 400 }
    );
  }

  // 1. Load the BOM snapshot
  const snapshot = await prisma.projectBomSnapshot.findFirst({
    where: { dealId: String(dealId), version },
  });
  if (!snapshot) {
    await logActivity({
      type: "API_ERROR",
      description: `BOM create-so failed: snapshot not found for ${dealId} v${version}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: String(dealId),
      entityName: "create_so",
      metadata: { event: "bom_create_so", outcome: "failed", reason: "snapshot_not_found", dealId, version },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-so",
      requestMethod: "POST",
      responseStatus: 404,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "BOM snapshot not found" }, { status: 404 });
  }

  // 2. Idempotency guard — return existing SO if already created
  if (snapshot.zohoSoId) {
    await logActivity({
      type: "FEATURE_USED",
      description: `BOM create-so reused existing SO for ${snapshot.dealName} v${version}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: String(dealId),
      entityName: snapshot.dealName,
      metadata: {
        event: "bom_create_so",
        outcome: "existing_so_reused",
        dealId: snapshot.dealId,
        dealName: snapshot.dealName,
        version,
        salesorder_id: snapshot.zohoSoId,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-so",
      requestMethod: "POST",
      responseStatus: 200,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      salesorder_id: snapshot.zohoSoId,
      salesorder_number: null,
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

  const skuMap = new Map<string, string | null>();
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

    const parsedQty = Math.round(Number(item.qty));
    const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;

    return {
      ...(zohoItemId ? { item_id: zohoItemId } : {}),
      name,
      quantity,
      description: item.description,
    };
  });

  // 4. Create SO in Zoho
  const address = bomData?.project?.address ?? "";
  let soResult: { salesorder_id: string; salesorder_number: string };
  try {
    soResult = await zohoInventory.createSalesOrder({
      customer_id: customerId,
      reference_number: snapshot.dealName,
      notes: `Generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
      status: "draft",
      line_items: lineItems,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Zoho API error";
    console.error("[bom/create-so] Zoho error:", message);
    await logActivity({
      type: "API_ERROR",
      description: `BOM create-so failed for ${snapshot.dealName}: ${message}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: String(dealId),
      entityName: snapshot.dealName,
      metadata: {
        event: "bom_create_so",
        outcome: "failed",
        reason: "zoho_api_error",
        dealId: snapshot.dealId,
        dealName: snapshot.dealName,
        version,
        error: message,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-so",
      requestMethod: "POST",
      responseStatus: 502,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 5. Store zohoSoId on snapshot
  await prisma.projectBomSnapshot.update({
    where: { id: snapshot.id },
    data: { zohoSoId: soResult.salesorder_id },
  });

  await logActivity({
    type: "FEATURE_USED",
    description: `Created Zoho SO for ${snapshot.dealName} BOM v${version}`,
    userEmail: authResult.email,
    userName: authResult.name,
    entityType: "bom",
    entityId: String(dealId),
    entityName: snapshot.dealName,
    metadata: {
      event: "bom_create_so",
      outcome: "created",
      dealId: snapshot.dealId,
      dealName: snapshot.dealName,
      version,
      salesorder_id: soResult.salesorder_id,
      salesorder_number: soResult.salesorder_number,
      unmatchedCount,
    },
    ipAddress: authResult.ip,
    userAgent: authResult.userAgent,
    requestPath: "/api/bom/create-so",
    requestMethod: "POST",
    responseStatus: 200,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    salesorder_id: soResult.salesorder_id,
    salesorder_number: soResult.salesorder_number,
    unmatchedCount,
  });
}
