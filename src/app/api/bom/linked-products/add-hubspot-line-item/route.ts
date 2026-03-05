import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import {
  createDealLineItem,
  fetchLineItemsForDeal,
  fetchHubSpotProductById,
  createOrUpdateHubSpotProduct,
} from "@/lib/hubspot";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",
  "PERMITTING",
  "SALES",
]);

function parseOptionalString(input: Record<string, unknown>, key: string): string | null {
  if (!(key in input)) return null;
  const raw = input[key];
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
}

function parsePositiveNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  if (!(key in input)) return fallback;
  const parsed = Number(input[key]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isPrismaMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2022";
}

async function loadSku(skuId: string | null, category: string | null, brand: string | null, model: string | null) {
  if (!prisma) return null;

  const fullSelect = {
    id: true,
    category: true,
    brand: true,
    model: true,
    description: true,
    vendorPartNumber: true,
    sellPrice: true,
    hubspotProductId: true,
  } as const;

  const legacySelect = {
    id: true,
    category: true,
    brand: true,
    model: true,
    unitSpec: true,
    unitLabel: true,
    updatedAt: true,
  } as const;

  const where = skuId
    ? { id: skuId }
    : (brand && model
      ? { brand, model }
      : null);

  if (!where) return null;

  const pickBest = <T extends { category: string }>(rows: T[]): T | null => {
    if (!rows.length) return null;
    if (!category) return rows[0];
    const exact = rows.find((row) => row.category === category);
    return exact || rows[0];
  };

  try {
    if (skuId) {
      return await prisma.equipmentSku.findFirst({ where, select: fullSelect });
    }
    const rows = await prisma.equipmentSku.findMany({
      where,
      select: fullSelect,
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    return pickBest(rows);
  } catch (error) {
    if (!isPrismaMissingColumnError(error)) throw error;
    if (skuId) {
      const legacy = await prisma.equipmentSku.findFirst({ where, select: legacySelect });
      if (!legacy) return null;
      return {
        ...legacy,
        description: null,
        vendorPartNumber: null,
        sellPrice: null,
        hubspotProductId: null,
      };
    }
    const legacyRows = await prisma.equipmentSku.findMany({
      where,
      select: legacySelect,
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    const legacy = pickBest(legacyRows);
    if (!legacy) return null;
    return {
      ...legacy,
      description: null,
      vendorPartNumber: null,
      sellPrice: null,
      hubspotProductId: null,
    };
  }
}

/** Check if a matching line item already exists on the deal */
function findExistingLineItem(
  existing: Array<{ name: string; sku: string; hubspotProductId: string | null }>,
  hubspotProductId: string | null,
  sku: string | null,
  name: string
): { id: string; name: string } | null {
  for (const item of existing as Array<{ id: string; name: string; sku: string; hubspotProductId: string | null }>) {
    // Match by HubSpot product ID (strongest signal)
    if (hubspotProductId && item.hubspotProductId === hubspotProductId) {
      return { id: item.id, name: item.name };
    }
    // Match by SKU
    if (sku && item.sku && item.sku.toLowerCase() === sku.toLowerCase()) {
      return { id: item.id, name: item.name };
    }
    // Match by name (case-insensitive)
    if (name && item.name && item.name.toLowerCase() === name.toLowerCase()) {
      return { id: item.id, name: item.name };
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dealId = parseOptionalString(body, "dealId");
  if (!dealId) return NextResponse.json({ error: "dealId is required" }, { status: 400 });

  const skuId = parseOptionalString(body, "skuId");
  const category = parseOptionalString(body, "category");
  const brand = parseOptionalString(body, "brand");
  const model = parseOptionalString(body, "model");
  const explicitName = parseOptionalString(body, "name");
  const explicitDescription = parseOptionalString(body, "description");
  const explicitSku = parseOptionalString(body, "sku");
  const explicitHubspotProductId = parseOptionalString(body, "hubspotProductId");
  const quantity = parsePositiveNumber(body, "quantity", 1);
  const unitPrice = parsePositiveNumber(body, "unitPrice", NaN);

  const skuRecord = await loadSku(skuId, category, brand, model);

  // Resolve the HubSpot product ID from explicit input or SKU record
  let hubspotProductId = explicitHubspotProductId || skuRecord?.hubspotProductId || null;
  let productCreated = false;

  // If no HubSpot product exists yet, create one so line items are properly linked
  const resolvedBrand = (brand || skuRecord?.brand || "").trim() || null;
  const resolvedModel = (model || skuRecord?.model || "").trim() || null;
  if (!hubspotProductId && (resolvedBrand || resolvedModel)) {
    try {
      const productResult = await createOrUpdateHubSpotProduct({
        brand: resolvedBrand || "",
        model: resolvedModel || "",
        sku: explicitSku || skuRecord?.vendorPartNumber || resolvedModel,
        description: explicitDescription || skuRecord?.description || null,
        productCategory: category || skuRecord?.category || null,
        sellPrice: Number.isFinite(unitPrice) ? unitPrice : (skuRecord?.sellPrice ?? null),
      });
      hubspotProductId = productResult.hubspotProductId;
      productCreated = productResult.created;

      // Persist the new product ID back to the SKU record
      if (prisma && skuRecord?.id && !skuRecord.hubspotProductId) {
        try {
          await prisma.equipmentSku.update({
            where: { id: skuRecord.id },
            data: { hubspotProductId },
          });
        } catch (updateError) {
          if (!isPrismaMissingColumnError(updateError)) throw updateError;
        }
      }
    } catch (productError) {
      // Log but continue — we can still create an orphan line item
      console.warn("[AddLineItem] Failed to create HubSpot product:", productError);
    }
  }

  // If we have a HubSpot product ID, fetch the product's canonical properties
  const hsProduct = hubspotProductId
    ? await fetchHubSpotProductById(hubspotProductId)
    : null;

  // Prefer HubSpot product properties > explicit input > SKU record > fallback
  const name =
    hsProduct?.name ||
    explicitName ||
    [resolvedBrand || "", resolvedModel || ""].filter(Boolean).join(" ").trim() ||
    explicitDescription ||
    skuRecord?.description ||
    "BOM Item";

  const description = hsProduct?.description || explicitDescription || skuRecord?.description || null;
  const sku = hsProduct?.hs_sku || explicitSku || skuRecord?.vendorPartNumber || resolvedModel || null;
  const resolvedPrice = hsProduct?.price ?? (Number.isFinite(unitPrice) ? unitPrice : (skuRecord?.sellPrice ?? null));

  // Check for duplicate line items on the deal
  try {
    const existingItems = await fetchLineItemsForDeal(dealId);
    const duplicate = findExistingLineItem(
      existingItems.map((li) => ({
        id: li.id,
        name: li.name,
        sku: li.sku,
        hubspotProductId: li.hubspotProductId,
      })),
      hubspotProductId,
      sku,
      name
    );

    if (duplicate) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already_exists",
        existingLineItemId: duplicate.id,
        existingName: duplicate.name,
      });
    }
  } catch (error) {
    // If we can't fetch existing items, log but continue with creation
    console.warn("[AddLineItem] Failed to check for duplicates:", error);
  }

  try {
    const result = await createDealLineItem({
      dealId,
      name,
      quantity,
      description,
      unitPrice: resolvedPrice,
      sku,
      hubspotProductId,
    });

    // If caller explicitly provided a product ID, keep inventory linkage in sync.
    if (prisma && skuRecord?.id && explicitHubspotProductId && !skuRecord.hubspotProductId) {
      try {
        await prisma.equipmentSku.update({
          where: { id: skuRecord.id },
          data: { hubspotProductId: explicitHubspotProductId },
        });
      } catch (updateError) {
        if (!isPrismaMissingColumnError(updateError)) throw updateError;
      }
    }

    return NextResponse.json({
      ok: true,
      lineItemId: result.lineItemId,
      associated: result.associated,
      usedProductId: result.usedProductId,
      productCreated,
      skuId: skuRecord?.id || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add HubSpot line item";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
