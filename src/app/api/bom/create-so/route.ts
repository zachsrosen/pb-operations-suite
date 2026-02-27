// src/app/api/bom/create-so/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";
import { logActivity, prisma } from "@/lib/db";
import { postProcessSoItems, type SoLineItem, type BomProject, type BomItem } from "@/lib/bom-so-post-process";

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

  // ── Main handler — wrapped so unhandled throws (Zoho item lookup, Prisma, etc.)
  // return a structured 500 instead of Next.js's generic empty response.
  try {

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
    project?: BomProject & { address?: string };
    items?: BomItem[];
  };

  const bomItems = Array.isArray(bomData?.items) ? bomData.items : [];

  // Feature flag — opt-in per environment (default off)
  const enablePostProcess = process.env.ENABLE_SO_POST_PROCESS === "true";
  const wantDebug = enablePostProcess && /^\s*true\s*$/i.test(request.headers.get("X-BOM-Debug") ?? "");

  // Build line items — only include items matched to an existing Zoho item_id.
  // Name-only fallback is intentionally avoided: unmatched items are skipped
  // so we never create phantom products in Zoho's item catalog.
  //
  // Process SEQUENTIALLY (not Promise.all) — findItemIdByName uses a shared
  // in-memory item cache, so there's no throughput benefit to concurrency, and
  // firing 30+ simultaneous requests hits Zoho's concurrent-request limit.
  let unmatchedCount = 0;
  const unmatchedItems: string[] = [];
  const matchedItems: Array<{ bomName: string; zohoName: string }> = [];
  const resolvedItems: (SoLineItem | null)[] = [];

  for (const item of bomItems) {
    const name =
      item.model
        ? `${item.brand ? item.brand + " " : ""}${item.model}`
        : item.description;

    // Try model first, then full "brand model" name, then description
    const searchTerms = [item.model, name, item.description].filter((t): t is string => !!t && t.trim().length > 1);
    let match: { item_id: string; zohoName: string; zohoSku?: string } | null = null;
    for (const term of searchTerms) {
      match = await zohoInventory.findItemIdByName(term);
      if (match) break;
    }

    if (!match) {
      unmatchedCount++;
      unmatchedItems.push(name); // record what we searched for so caller can diagnose
      resolvedItems.push(null);
      continue;
    }

    const parsedQty = Math.round(Number(item.qty));
    // Skip zero-qty items — e.g. Enphase jobs with no splices show qty=0 in BOM.
    // Do NOT default to 1: that would create line items for items not needed on this job.
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      resolvedItems.push(null);
      continue;
    }
    matchedItems.push({ bomName: name, zohoName: match.zohoName });
    resolvedItems.push({
      item_id: match.item_id,
      name,
      quantity: parsedQty,
      description: item.description,
      sku: match.zohoSku,
      bomCategory: item.category,
    });
  }

  let lineItems = resolvedItems.filter((item): item is NonNullable<typeof item> => item !== null);

  // 3b. Post-process line items (when enabled)
  let postProcessExtras: Record<string, unknown> = {};
  if (enablePostProcess) {
    const originalLineItems = wantDebug ? lineItems.map(i => ({ ...i })) : undefined;
    const ppResult = await postProcessSoItems(
      lineItems,
      bomData,
      (query) => zohoInventory.findItemIdByName(query),
    );
    lineItems = ppResult.lineItems;
    postProcessExtras = {
      corrections: ppResult.corrections,
      rulesVersion: ppResult.rulesVersion,
      jobContext: ppResult.jobContext,
      ...(wantDebug ? { originalLineItems, correctedLineItems: ppResult.lineItems } : {}),
    };
  }

  // 4. Create SO in Zoho
  const address = bomData?.project?.address ?? "";
  const projMatch = snapshot.dealName.match(/PROJ-(\d+)/);
  const soNumber = projMatch ? `SO-${projMatch[1]} (TEST)` : `SO-${dealId} (TEST)`;
  let soResult: { salesorder_id: string; salesorder_number: string };
  try {
    soResult = await zohoInventory.createSalesOrder({
      customer_id: customerId,
      salesorder_number: soNumber,
      reference_number: snapshot.dealName.slice(0, 50),
      notes: `Generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
      status: "draft",
      // Strip internal-only keys (sku, bomCategory) before sending to Zoho —
      // these are used by post-processing but are not part of Zoho's API contract.
      line_items: lineItems.map(({ item_id, name, quantity, description }) => ({
        ...(item_id ? { item_id } : {}),
        name,
        quantity,
        ...(description ? { description } : {}),
      })),
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
    unmatchedItems,
    matchedItems,
    ...postProcessExtras,
  });

  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[bom/create-so] Unhandled error:", message, e);
    await logActivity({
      type: "API_ERROR",
      description: `BOM create-so unhandled error: ${message}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "create_so",
      metadata: { event: "bom_create_so", outcome: "failed", reason: "unhandled_exception", error: message },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/create-so",
      requestMethod: "POST",
      responseStatus: 500,
      durationMs: Date.now() - startedAt,
    }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
