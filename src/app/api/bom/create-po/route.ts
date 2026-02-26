// src/app/api/bom/create-po/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";
import { logActivity, prisma } from "@/lib/db";

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
      description: "BOM create-po denied: insufficient permissions",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_po",
      metadata: { event: "bom_create_po", outcome: "failed", reason: "insufficient_permissions" },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 403,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!zohoInventory.isConfigured()) {
    await logActivity({
      type: "API_ERROR",
      description: "BOM create-po failed: Zoho Inventory not configured",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_po",
      metadata: { event: "bom_create_po", outcome: "failed", reason: "zoho_not_configured" },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 503,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  let body: { dealId?: string; version?: number; vendorId?: string };
  try {
    body = await request.json();
  } catch {
    await logActivity({
      type: "API_ERROR",
      description: "BOM create-po failed: invalid JSON",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_po",
      metadata: { event: "bom_create_po", outcome: "failed", reason: "invalid_json" },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 400,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, version, vendorId } = body;
  if (!dealId || typeof version !== "number" || !vendorId) {
    await logActivity({
      type: "API_ERROR",
      description: "BOM create-po failed: missing required fields",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: String(dealId || ""),
      entityName: "create_po",
      metadata: { event: "bom_create_po", outcome: "failed", reason: "missing_fields", dealId, version, hasVendorId: !!vendorId },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 400,
      durationMs: Date.now() - startedAt,
    });
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
    await logActivity({
      type: "API_ERROR",
      description: `BOM create-po failed: snapshot not found for ${dealId} v${version}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: String(dealId),
      entityName: "create_po",
      metadata: { event: "bom_create_po", outcome: "failed", reason: "snapshot_not_found", dealId, version },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 404,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "BOM snapshot not found" }, { status: 404 });
  }

  // 2. If PO already created, return existing ID (idempotency guard)
  // This handles the primary duplicate risk: UI retry after Zoho success + DB failure.
  // Concurrent-click protection is handled by `creatingPo` UI state (button disables on click).
  if (snapshot.zohoPoId) {
    await logActivity({
      type: "FEATURE_USED",
      description: `BOM create-po reused existing PO for ${snapshot.dealName} v${version}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: String(dealId),
      entityName: snapshot.dealName,
      metadata: {
        event: "bom_create_po",
        outcome: "existing_po_reused",
        dealId: snapshot.dealId,
        dealName: snapshot.dealName,
        version,
        purchaseorder_id: snapshot.zohoPoId,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 200,
      durationMs: Date.now() - startedAt,
    });
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

  // Build line items — only include items matched to an existing Zoho item_id.
  // Name-only fallback is intentionally avoided: unmatched items are skipped
  // so we never create phantom products in Zoho's item catalog.
  // Note: matched items must have "Can be Purchased" enabled in Zoho to appear on POs.
  let unmatchedCount = 0;
  const resolvedItems = await Promise.all(bomItems.map(async (item) => {
    const name =
      item.model
        ? `${item.brand ? item.brand + " " : ""}${item.model}`
        : item.description;

    // Try model first, then full "brand model" name, then description
    const searchTerms = [item.model, name, item.description].filter((t): t is string => !!t && t.trim().length > 1);
    let zohoItemId: string | null = null;
    for (const term of searchTerms) {
      zohoItemId = await zohoInventory.findItemIdByName(term);
      if (zohoItemId) break;
    }

    if (!zohoItemId) {
      unmatchedCount++;
      return null; // will be filtered out — do not create name-only lines
    }

    // Quantity: parse carefully — `|| 1` would silently over-order on invalid values.
    // Use 1 as minimum only when the parsed value is truly 0/NaN after rounding.
    const parsedQty = Math.round(Number(item.qty));
    const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;

    return { item_id: zohoItemId, name, quantity, description: item.description };
  }));

  const lineItems = resolvedItems.filter((item): item is NonNullable<typeof item> => item !== null);

  // 4. Create PO in Zoho
  const address = bomData?.project?.address ?? "";
  let poResult: { purchaseorder_id: string; purchaseorder_number: string };
  try {
    poResult = await zohoInventory.createPurchaseOrder({
      vendor_id: vendorId,
      purchaseorder_number: `PO-${dealId}`,
      reference_number: snapshot.dealName.slice(0, 50),
      notes: `Generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
      status: "draft",
      line_items: lineItems,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Zoho API error";
    console.error("[bom/create-po] Zoho error:", message);
    await logActivity({
      type: "API_ERROR",
      description: `BOM create-po failed for ${snapshot.dealName}: ${message}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: String(dealId),
      entityName: snapshot.dealName,
      metadata: {
        event: "bom_create_po",
        outcome: "failed",
        reason: "zoho_api_error",
        dealId: snapshot.dealId,
        dealName: snapshot.dealName,
        version,
        error: message,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-po",
      requestMethod: "POST",
      responseStatus: 502,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 5. Store zohoPoId on snapshot
  await prisma.projectBomSnapshot.update({
    where: { id: snapshot.id },
    data: { zohoPoId: poResult.purchaseorder_id },
  });

  await logActivity({
    type: "FEATURE_USED",
    description: `Created Zoho PO for ${snapshot.dealName} BOM v${version}`,
    userEmail: authResult.email,
    userName: authResult.name,
    entityType: "bom",
    entityId: String(dealId),
    entityName: snapshot.dealName,
    metadata: {
      event: "bom_create_po",
      outcome: "created",
      dealId: snapshot.dealId,
      dealName: snapshot.dealName,
      version,
      purchaseorder_id: poResult.purchaseorder_id,
      purchaseorder_number: poResult.purchaseorder_number,
      unmatchedCount,
    },
    ipAddress: authResult.ip,
    userAgent: authResult.userAgent,
    requestPath: "/api/bom/create-po",
    requestMethod: "POST",
    responseStatus: 200,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    purchaseorder_id: poResult.purchaseorder_id,
    purchaseorder_number: poResult.purchaseorder_number,
    unmatchedCount,
  });
}
