/**
 * Inventory SKU API
 *
 * GET  /api/inventory/skus - List SKUs with optional filtering
 * POST /api/inventory/skus - Create or upsert a SKU (admin/manager only)
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { tagSentryRequest } from "@/lib/sentry-request";
import { EquipmentCategory } from "@/generated/prisma/enums";

// Roles allowed to create/upsert SKUs
const WRITE_ROLES = ["ADMIN", "OWNER", "PROJECT_MANAGER"];

// Valid EquipmentCategory values for validation
const VALID_CATEGORIES = Object.values(EquipmentCategory);

type ParsedNumber = { provided: false } | { provided: true; value: number | null } | { provided: true; error: string };

function parseOptionalNumber(input: Record<string, unknown>, key: string): ParsedNumber {
  if (!(key in input)) return { provided: false };
  const raw = input[key];
  if (raw === null || raw === undefined || raw === "") return { provided: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") return { provided: true, value: null };

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return { provided: true, error: `${key} must be a valid number` };
  }
  return { provided: true, value: parsed };
}

function parseOptionalString(input: Record<string, unknown>, key: string): { provided: boolean; value: string | null } {
  if (!(key in input)) return { provided: false, value: null };
  const raw = input[key];
  if (raw === null || raw === undefined) return { provided: true, value: null };
  const trimmed = String(raw).trim();
  return { provided: true, value: trimmed || null };
}

function buildSyncHealth(sku: {
  zohoItemId: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
}) {
  const zoho = Boolean(sku.zohoItemId);
  const hubspot = Boolean(sku.hubspotProductId);
  const zuper = Boolean(sku.zuperItemId);
  const connectedCount = (zoho ? 1 : 0) + (hubspot ? 1 : 0) + (zuper ? 1 : 0);
  return {
    internal: true,
    zoho,
    hubspot,
    zuper,
    connectedCount,
    fullySynced: connectedCount === 3,
  };
}

/**
 * GET /api/inventory/skus
 *
 * Query params:
 *   category - Filter by EquipmentCategory enum value
 *   active   - "true" (default) to show only active SKUs, "false" to include inactive
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const categoryParam = searchParams.get("category");
    const activeParam = searchParams.get("active");
    const activeOnly = activeParam !== "false"; // default true

    // Validate category if provided
    if (
      categoryParam &&
      !VALID_CATEGORIES.includes(categoryParam as EquipmentCategory)
    ) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const skus = await prisma.equipmentSku.findMany({
      where: {
        ...(categoryParam && {
          category: categoryParam as EquipmentCategory,
        }),
        ...(activeOnly && { isActive: true }),
      },
      include: {
        stockLevels: {
          select: { location: true, quantityOnHand: true },
        },
      },
      orderBy: [
        { category: "asc" },
        { brand: "asc" },
        { model: "asc" },
      ],
    });

    const enriched = skus.map((sku) => ({
      ...sku,
      syncHealth: buildSyncHealth(sku),
    }));

    const summary = {
      total: enriched.length,
      fullySynced: enriched.filter((s) => s.syncHealth.fullySynced).length,
      missingZoho: enriched.filter((s) => !s.syncHealth.zoho).length,
      missingHubspot: enriched.filter((s) => !s.syncHealth.hubspot).length,
      missingZuper: enriched.filter((s) => !s.syncHealth.zuper).length,
      withPricing: enriched.filter((s) => s.unitCost != null && s.sellPrice != null).length,
    };

    return NextResponse.json({ skus: enriched, count: enriched.length, summary });
  } catch (error) {
    console.error("Error fetching SKUs:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to fetch SKUs" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/inventory/skus
 *
 * Body: {
 *   category, brand, model,
 *   description?, vendorName?, vendorPartNumber?,
 *   unitSpec?, unitLabel?, unitCost?, sellPrice?,
 *   zohoItemId?, hubspotProductId?, zuperItemId?
 * }
 *
 * Upserts on the compound unique (category + brand + model).
 * Requires ADMIN, OWNER, or PROJECT_MANAGER role.
 */
export async function POST(request: NextRequest) {
  tagSentryRequest(request);
  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  // Auth check
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  // Role check
  if (!WRITE_ROLES.includes(authResult.role)) {
    return NextResponse.json(
      { error: "Insufficient permissions. Requires ADMIN, EXECUTIVE, or PROJECT_MANAGER role." },
      { status: 403 }
    );
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const category = body.category;
    const brand = body.brand;
    const model = body.model;

    // Validate required fields
    if (!category || !brand || !model) {
      return NextResponse.json(
        { error: "category, brand, and model are required" },
        { status: 400 }
      );
    }

    // Validate category enum
    if (!VALID_CATEGORIES.includes(category as EquipmentCategory)) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const trimmedBrand = String(brand).trim();
    const trimmedModel = String(model).trim();

    if (!trimmedBrand || !trimmedModel) {
      return NextResponse.json(
        { error: "brand and model must not be empty after trimming" },
        { status: 400 }
      );
    }

    const unitSpecParsed = parseOptionalNumber(body, "unitSpec");
    const unitCostParsed = parseOptionalNumber(body, "unitCost");
    const sellPriceParsed = parseOptionalNumber(body, "sellPrice");

    if ("error" in unitSpecParsed) return NextResponse.json({ error: unitSpecParsed.error }, { status: 400 });
    if ("error" in unitCostParsed) return NextResponse.json({ error: unitCostParsed.error }, { status: 400 });
    if ("error" in sellPriceParsed) return NextResponse.json({ error: sellPriceParsed.error }, { status: 400 });

    const unitLabelParsed = parseOptionalString(body, "unitLabel");
    const descriptionParsed = parseOptionalString(body, "description");
    const vendorNameParsed = parseOptionalString(body, "vendorName");
    const vendorPartParsed = parseOptionalString(body, "vendorPartNumber");
    const zohoItemParsed = parseOptionalString(body, "zohoItemId");
    const hubspotProductParsed = parseOptionalString(body, "hubspotProductId");
    const zuperItemParsed = parseOptionalString(body, "zuperItemId");

    const sku = await prisma.equipmentSku.upsert({
      where: {
        category_brand_model: {
          category: category as EquipmentCategory,
          brand: trimmedBrand,
          model: trimmedModel,
        },
      },
      update: {
        ...(unitSpecParsed.provided && { unitSpec: unitSpecParsed.value }),
        ...(unitLabelParsed.provided && { unitLabel: unitLabelParsed.value }),
        ...(descriptionParsed.provided && { description: descriptionParsed.value }),
        ...(vendorNameParsed.provided && { vendorName: vendorNameParsed.value }),
        ...(vendorPartParsed.provided && { vendorPartNumber: vendorPartParsed.value }),
        ...(unitCostParsed.provided && { unitCost: unitCostParsed.value }),
        ...(sellPriceParsed.provided && { sellPrice: sellPriceParsed.value }),
        ...(zohoItemParsed.provided && { zohoItemId: zohoItemParsed.value }),
        ...(hubspotProductParsed.provided && { hubspotProductId: hubspotProductParsed.value }),
        ...(zuperItemParsed.provided && { zuperItemId: zuperItemParsed.value }),
        isActive: true,
      },
      create: {
        category: category as EquipmentCategory,
        brand: trimmedBrand,
        model: trimmedModel,
        unitSpec: unitSpecParsed.provided ? unitSpecParsed.value : null,
        unitLabel: unitLabelParsed.provided ? unitLabelParsed.value : null,
        description: descriptionParsed.provided ? descriptionParsed.value : null,
        vendorName: vendorNameParsed.provided ? vendorNameParsed.value : null,
        vendorPartNumber: vendorPartParsed.provided ? vendorPartParsed.value : null,
        unitCost: unitCostParsed.provided ? unitCostParsed.value : null,
        sellPrice: sellPriceParsed.provided ? sellPriceParsed.value : null,
        zohoItemId: zohoItemParsed.provided ? zohoItemParsed.value : null,
        hubspotProductId: hubspotProductParsed.provided ? hubspotProductParsed.value : null,
        zuperItemId: zuperItemParsed.provided ? zuperItemParsed.value : null,
      },
      include: {
        stockLevels: {
          select: { location: true, quantityOnHand: true },
        },
      },
    });

    return NextResponse.json({ sku: { ...sku, syncHealth: buildSyncHealth(sku) } }, { status: 201 });
  } catch (error) {
    console.error("Error creating/upserting SKU:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to create/upsert SKU" },
      { status: 500 }
    );
  }
}
