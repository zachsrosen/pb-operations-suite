import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { createDealLineItem } from "@/lib/hubspot";

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
  } as const;

  const where = skuId
    ? { id: skuId }
    : (category && brand && model
      ? { category: category as never, brand, model }
      : null);

  if (!where) return null;

  try {
    return await prisma.equipmentSku.findFirst({ where, select: fullSelect });
  } catch (error) {
    if (!isPrismaMissingColumnError(error)) throw error;
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

  const name =
    explicitName ||
    [brand || skuRecord?.brand || "", model || skuRecord?.model || ""].filter(Boolean).join(" ").trim() ||
    explicitDescription ||
    skuRecord?.description ||
    "BOM Item";

  const description = explicitDescription || skuRecord?.description || null;
  const sku = explicitSku || skuRecord?.vendorPartNumber || model || skuRecord?.model || null;
  const hubspotProductId = explicitHubspotProductId || skuRecord?.hubspotProductId || null;

  try {
    const result = await createDealLineItem({
      dealId,
      name,
      quantity,
      description,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : (skuRecord?.sellPrice ?? null),
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
      skuId: skuRecord?.id || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add HubSpot line item";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
