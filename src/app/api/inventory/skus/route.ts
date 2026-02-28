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
import {
  CATEGORY_CONFIGS,
  filterMetadataToSpecFields,
  getCategoryFields,
  getSpecTableName,
} from "@/lib/catalog-fields";

// Roles allowed to create/upsert SKUs
const WRITE_ROLES = ["ADMIN", "OWNER", "PROJECT_MANAGER"];

// Valid EquipmentCategory values for validation
const VALID_CATEGORIES = Object.values(EquipmentCategory);

const SPEC_TABLES = Array.from(
  new Set(
    Object.values(CATEGORY_CONFIGS)
      .map((cfg) => cfg.specTable)
      .filter((table): table is string => Boolean(table))
  )
);

const SKU_INCLUDE = {
  stockLevels: {
    select: { location: true, quantityOnHand: true },
  },
  moduleSpec: true,
  inverterSpec: true,
  batterySpec: true,
  evChargerSpec: true,
  mountingHardwareSpec: true,
  electricalHardwareSpec: true,
  relayDeviceSpec: true,
} as const;

type ParsedNumber =
  | { provided: false }
  | { provided: true; value: number | null }
  | { provided: true; error: string };

type ParsedBoolean =
  | { provided: false }
  | { provided: true; value: boolean }
  | { provided: true; error: string };

type ParsedMetadata =
  | { provided: false }
  | { provided: true; value: Record<string, unknown> | null }
  | { provided: true; error: string };

function isPrismaMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2022";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

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

function parseOptionalBoolean(input: Record<string, unknown>, key: string): ParsedBoolean {
  if (!(key in input)) return { provided: false };
  const raw = input[key];
  if (typeof raw === "boolean") return { provided: true, value: raw };
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return { provided: true, value: true };
    if (normalized === "false") return { provided: true, value: false };
  }
  return { provided: true, error: `${key} must be a boolean` };
}

function parseOptionalMetadata(
  input: Record<string, unknown>,
  category: string,
  key = "metadata"
): ParsedMetadata {
  if (!(key in input)) return { provided: false };

  const raw = input[key];
  if (raw === null || raw === undefined) return { provided: true, value: null };
  if (!isRecord(raw)) {
    return { provided: true, error: `${key} must be an object` };
  }

  const filtered = filterMetadataToSpecFields(category, raw);
  const normalized: Record<string, unknown> = {};

  for (const field of getCategoryFields(category)) {
    if (!(field.key in filtered)) continue;
    const value = filtered[field.key];

    if (field.type === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return { provided: true, error: `${field.key} must be a valid number` };
      }
      normalized[field.key] = parsed;
      continue;
    }

    if (field.type === "toggle") {
      if (typeof value === "boolean") {
        normalized[field.key] = value;
        continue;
      }
      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true") {
          normalized[field.key] = true;
          continue;
        }
        if (lower === "false") {
          normalized[field.key] = false;
          continue;
        }
      }
      return { provided: true, error: `${field.key} must be a boolean` };
    }

    const text = String(value ?? "").trim();
    if (text) normalized[field.key] = text;
  }

  return { provided: true, value: Object.keys(normalized).length > 0 ? normalized : null };
}

function buildSyncHealth(sku: {
  zohoItemId: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  quickbooksItemId: string | null;
}) {
  const zoho = Boolean(sku.zohoItemId);
  const hubspot = Boolean(sku.hubspotProductId);
  const zuper = Boolean(sku.zuperItemId);
  const quickbooks = Boolean(sku.quickbooksItemId);
  const connectedCount = (zoho ? 1 : 0) + (hubspot ? 1 : 0) + (zuper ? 1 : 0) + (quickbooks ? 1 : 0);
  return {
    internal: true,
    zoho,
    hubspot,
    zuper,
    quickbooks,
    connectedCount,
    fullySynced: connectedCount === 4,
  };
}

function canonicalToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

interface DuplicateGroupEntry {
  id: string;
  brand: string;
  model: string;
  sku: string | null;
  vendorPartNumber: string | null;
  quickbooksItemId: string | null;
}

interface DuplicateGroup {
  key: string;
  category: string;
  canonicalBrand: string;
  canonicalModel: string;
  count: number;
  entries: DuplicateGroupEntry[];
}

function buildDuplicateGroups(skus: Array<Record<string, unknown>>): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();

  for (const sku of skus) {
    const category = String(sku.category || "");
    const canonicalBrand = canonicalToken(sku.brand);
    const canonicalModel = canonicalToken(sku.model);
    if (!category || !canonicalBrand || !canonicalModel) continue;

    const key = `${category}|${canonicalBrand}|${canonicalModel}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        category,
        canonicalBrand,
        canonicalModel,
        count: 0,
        entries: [],
      });
    }

    const group = groups.get(key)!;
    group.entries.push({
      id: String(sku.id || ""),
      brand: String(sku.brand || ""),
      model: String(sku.model || ""),
      sku: typeof sku.sku === "string" ? sku.sku : null,
      vendorPartNumber: typeof sku.vendorPartNumber === "string" ? sku.vendorPartNumber : null,
      quickbooksItemId: typeof sku.quickbooksItemId === "string" ? sku.quickbooksItemId : null,
    });
    group.count += 1;
  }

  return [...groups.values()]
    .filter((group) => group.count > 1)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function specRecordToMetadata(record: unknown): Record<string, unknown> {
  if (!isRecord(record)) return {};
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || key === "skuId") continue;
    if (value === null || value === undefined || value === "") continue;
    metadata[key] = value;
  }
  return metadata;
}

function buildSkuMetadata(category: string, sku: Record<string, unknown>): Record<string, unknown> {
  const specTable = getSpecTableName(category);
  if (!specTable) return {};
  return specRecordToMetadata(sku[specTable]);
}

async function applySkuMetadata(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  skuId: string,
  category: string,
  metadata: Record<string, unknown> | null
) {
  const targetTable = getSpecTableName(category);
  if (!targetTable) return;

  for (const table of SPEC_TABLES) {
    if (table === targetTable) continue;
    const model = tx[table];
    if (model?.deleteMany) {
      await model.deleteMany({ where: { skuId } });
    }
  }

  const model = tx[targetTable];
  if (!model?.deleteMany || !model?.upsert) return;

  if (!metadata || Object.keys(metadata).length === 0) {
    await model.deleteMany({ where: { skuId } });
    return;
  }

  await model.upsert({
    where: { skuId },
    create: { skuId, ...metadata },
    update: metadata,
  });
}

function enrichSku<T extends Record<string, unknown>>(sku: T) {
  const category = String(sku.category || "");
  const syncSource = sku as unknown as {
    zohoItemId: string | null;
    hubspotProductId: string | null;
    zuperItemId: string | null;
    quickbooksItemId: string | null;
  };
  return {
    ...sku,
    metadata: buildSkuMetadata(category, sku),
    syncHealth: buildSyncHealth(syncSource),
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

    const where = {
      ...(categoryParam && {
        category: categoryParam as EquipmentCategory,
      }),
      ...(activeOnly && { isActive: true }),
    };
    const orderBy = [
      { category: "asc" as const },
      { brand: "asc" as const },
      { model: "asc" as const },
    ];

    let skus: Array<Record<string, unknown>> = [];

    try {
      skus = await prisma.equipmentSku.findMany({
        where,
        include: SKU_INCLUDE,
        orderBy,
      }) as unknown as Array<Record<string, unknown>>;
    } catch (error) {
      if (!isPrismaMissingColumnError(error)) throw error;

      // Backward-compatible fallback for databases that have not applied the
      // latest EquipmentSku migration yet.
      console.warn(
        "[Inventory SKUs] Falling back to legacy SKU query due to missing database columns"
      );

      const legacySkus = await prisma.equipmentSku.findMany({
        where,
        select: {
          id: true,
          category: true,
          brand: true,
          model: true,
          unitSpec: true,
          unitLabel: true,
          isActive: true,
          zohoItemId: true,
          createdAt: true,
          updatedAt: true,
          stockLevels: {
            select: { location: true, quantityOnHand: true },
          },
        },
        orderBy,
      });

      skus = legacySkus.map((sku: Record<string, unknown>) => ({
        ...sku,
        description: null,
        vendorName: null,
        vendorPartNumber: null,
        unitCost: null,
        sellPrice: null,
        sku: null,
        hardToProcure: false,
        length: null,
        width: null,
        weight: null,
        hubspotProductId: null,
        zuperItemId: null,
        quickbooksItemId: null,
        metadata: {},
      }));
    }

    const enriched = skus.map((sku) => enrichSku(sku));
    const duplicateGroups = buildDuplicateGroups(enriched);
    const duplicateRows = duplicateGroups.reduce((sum, group) => sum + group.count, 0);

    const summary = {
      total: enriched.length,
      fullySynced: enriched.filter((s) => s.syncHealth.fullySynced).length,
      missingZoho: enriched.filter((s) => !s.syncHealth.zoho).length,
      missingHubspot: enriched.filter((s) => !s.syncHealth.hubspot).length,
      missingZuper: enriched.filter((s) => !s.syncHealth.zuper).length,
      missingQuickbooks: enriched.filter((s) => !s.syncHealth.quickbooks).length,
      duplicateGroups: duplicateGroups.length,
      duplicateRows,
      withPricing: enriched.filter((s) => s.unitCost != null && s.sellPrice != null).length,
    };

    return NextResponse.json({ skus: enriched, count: enriched.length, summary, duplicates: duplicateGroups });
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
 *   description?, vendorName?, vendorPartNumber?, sku?,
 *   unitSpec?, unitLabel?, unitCost?, sellPrice?,
 *   hardToProcure?, length?, width?, weight?, metadata?,
 *   zohoItemId?, hubspotProductId?, zuperItemId?, quickbooksItemId?
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
    const lengthParsed = parseOptionalNumber(body, "length");
    const widthParsed = parseOptionalNumber(body, "width");
    const weightParsed = parseOptionalNumber(body, "weight");

    if ("error" in unitSpecParsed) return NextResponse.json({ error: unitSpecParsed.error }, { status: 400 });
    if ("error" in unitCostParsed) return NextResponse.json({ error: unitCostParsed.error }, { status: 400 });
    if ("error" in sellPriceParsed) return NextResponse.json({ error: sellPriceParsed.error }, { status: 400 });
    if ("error" in lengthParsed) return NextResponse.json({ error: lengthParsed.error }, { status: 400 });
    if ("error" in widthParsed) return NextResponse.json({ error: widthParsed.error }, { status: 400 });
    if ("error" in weightParsed) return NextResponse.json({ error: weightParsed.error }, { status: 400 });

    const hardToProcureParsed = parseOptionalBoolean(body, "hardToProcure");
    if ("error" in hardToProcureParsed) return NextResponse.json({ error: hardToProcureParsed.error }, { status: 400 });

    const unitLabelParsed = parseOptionalString(body, "unitLabel");
    const descriptionParsed = parseOptionalString(body, "description");
    const skuParsed = parseOptionalString(body, "sku");
    const vendorNameParsed = parseOptionalString(body, "vendorName");
    const vendorPartParsed = parseOptionalString(body, "vendorPartNumber");
    const zohoItemParsed = parseOptionalString(body, "zohoItemId");
    const hubspotProductParsed = parseOptionalString(body, "hubspotProductId");
    const zuperItemParsed = parseOptionalString(body, "zuperItemId");
    const quickbooksItemParsed = parseOptionalString(body, "quickbooksItemId");
    const metadataParsed = parseOptionalMetadata(body, category as string);
    if ("error" in metadataParsed) return NextResponse.json({ error: metadataParsed.error }, { status: 400 });

    const upserted = await prisma.$transaction(async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx: any
    ) => {
      const skuRecord = await tx.equipmentSku.upsert({
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
          ...(skuParsed.provided && { sku: skuParsed.value }),
          ...(vendorNameParsed.provided && { vendorName: vendorNameParsed.value }),
          ...(vendorPartParsed.provided && { vendorPartNumber: vendorPartParsed.value }),
          ...(unitCostParsed.provided && { unitCost: unitCostParsed.value }),
          ...(sellPriceParsed.provided && { sellPrice: sellPriceParsed.value }),
          ...(hardToProcureParsed.provided && { hardToProcure: hardToProcureParsed.value }),
          ...(lengthParsed.provided && { length: lengthParsed.value }),
          ...(widthParsed.provided && { width: widthParsed.value }),
          ...(weightParsed.provided && { weight: weightParsed.value }),
          ...(zohoItemParsed.provided && { zohoItemId: zohoItemParsed.value }),
          ...(hubspotProductParsed.provided && { hubspotProductId: hubspotProductParsed.value }),
          ...(zuperItemParsed.provided && { zuperItemId: zuperItemParsed.value }),
          ...(quickbooksItemParsed.provided && { quickbooksItemId: quickbooksItemParsed.value }),
          isActive: true,
        },
        create: {
          category: category as EquipmentCategory,
          brand: trimmedBrand,
          model: trimmedModel,
          unitSpec: unitSpecParsed.provided ? unitSpecParsed.value : null,
          unitLabel: unitLabelParsed.provided ? unitLabelParsed.value : null,
          description: descriptionParsed.provided ? descriptionParsed.value : null,
          sku: skuParsed.provided ? skuParsed.value : null,
          vendorName: vendorNameParsed.provided ? vendorNameParsed.value : null,
          vendorPartNumber: vendorPartParsed.provided ? vendorPartParsed.value : null,
          unitCost: unitCostParsed.provided ? unitCostParsed.value : null,
          sellPrice: sellPriceParsed.provided ? sellPriceParsed.value : null,
          hardToProcure: hardToProcureParsed.provided ? hardToProcureParsed.value : false,
          length: lengthParsed.provided ? lengthParsed.value : null,
          width: widthParsed.provided ? widthParsed.value : null,
          weight: weightParsed.provided ? weightParsed.value : null,
          zohoItemId: zohoItemParsed.provided ? zohoItemParsed.value : null,
          hubspotProductId: hubspotProductParsed.provided ? hubspotProductParsed.value : null,
          zuperItemId: zuperItemParsed.provided ? zuperItemParsed.value : null,
          quickbooksItemId: quickbooksItemParsed.provided ? quickbooksItemParsed.value : null,
        },
      });

      if (metadataParsed.provided) {
        await applySkuMetadata(tx, skuRecord.id, category as string, metadataParsed.value);
      }

      return tx.equipmentSku.findUnique({
        where: { id: skuRecord.id },
        include: SKU_INCLUDE,
      });
    });

    if (!upserted) {
      throw new Error("SKU upsert failed");
    }

    return NextResponse.json({ sku: enrichSku(upserted as unknown as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    if (isPrismaMissingColumnError(error)) {
      console.error("SKU upsert blocked by missing database columns:", error);
      Sentry.captureException(error);
      return NextResponse.json(
        {
          error:
            "Inventory catalog schema migration is not applied yet. Run `prisma migrate deploy` on production.",
        },
        { status: 503 }
      );
    }
    console.error("Error creating/upserting SKU:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to create/upsert SKU" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/inventory/skus
 *
 * Body: {
 *   id: string,
 *   category?, brand?, model?,
 *   description?, vendorName?, vendorPartNumber?, sku?,
 *   unitSpec?, unitLabel?, unitCost?, sellPrice?,
 *   hardToProcure?, length?, width?, weight?, metadata?,
 *   zohoItemId?, hubspotProductId?, zuperItemId?, quickbooksItemId?,
 *   isActive?
 * }
 *
 * Updates a SKU by id.
 * Requires ADMIN, OWNER, or PROJECT_MANAGER role.
 */
export async function PATCH(request: NextRequest) {
  tagSentryRequest(request);
  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

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

    const idRaw = body.id;
    const id = typeof idRaw === "string" ? idRaw.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const existing = await prisma.equipmentSku.findUnique({
      where: { id },
      select: { id: true, category: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    const categoryProvided = "category" in body;
    const category = categoryProvided ? String(body.category || "").trim() : existing.category;
    if (!VALID_CATEGORIES.includes(category as EquipmentCategory)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }

    const brandProvided = "brand" in body;
    const modelProvided = "model" in body;
    const brand = brandProvided ? String(body.brand || "").trim() : "";
    const model = modelProvided ? String(body.model || "").trim() : "";
    if (brandProvided && !brand) {
      return NextResponse.json({ error: "brand must not be empty after trimming" }, { status: 400 });
    }
    if (modelProvided && !model) {
      return NextResponse.json({ error: "model must not be empty after trimming" }, { status: 400 });
    }

    const unitSpecParsed = parseOptionalNumber(body, "unitSpec");
    const unitCostParsed = parseOptionalNumber(body, "unitCost");
    const sellPriceParsed = parseOptionalNumber(body, "sellPrice");
    const lengthParsed = parseOptionalNumber(body, "length");
    const widthParsed = parseOptionalNumber(body, "width");
    const weightParsed = parseOptionalNumber(body, "weight");
    if ("error" in unitSpecParsed) return NextResponse.json({ error: unitSpecParsed.error }, { status: 400 });
    if ("error" in unitCostParsed) return NextResponse.json({ error: unitCostParsed.error }, { status: 400 });
    if ("error" in sellPriceParsed) return NextResponse.json({ error: sellPriceParsed.error }, { status: 400 });
    if ("error" in lengthParsed) return NextResponse.json({ error: lengthParsed.error }, { status: 400 });
    if ("error" in widthParsed) return NextResponse.json({ error: widthParsed.error }, { status: 400 });
    if ("error" in weightParsed) return NextResponse.json({ error: weightParsed.error }, { status: 400 });

    const isActiveParsed = parseOptionalBoolean(body, "isActive");
    const hardToProcureParsed = parseOptionalBoolean(body, "hardToProcure");
    if ("error" in isActiveParsed) return NextResponse.json({ error: isActiveParsed.error }, { status: 400 });
    if ("error" in hardToProcureParsed) return NextResponse.json({ error: hardToProcureParsed.error }, { status: 400 });

    const unitLabelParsed = parseOptionalString(body, "unitLabel");
    const descriptionParsed = parseOptionalString(body, "description");
    const skuParsed = parseOptionalString(body, "sku");
    const vendorNameParsed = parseOptionalString(body, "vendorName");
    const vendorPartParsed = parseOptionalString(body, "vendorPartNumber");
    const zohoItemParsed = parseOptionalString(body, "zohoItemId");
    const hubspotProductParsed = parseOptionalString(body, "hubspotProductId");
    const zuperItemParsed = parseOptionalString(body, "zuperItemId");
    const quickbooksItemParsed = parseOptionalString(body, "quickbooksItemId");

    const metadataParsed = parseOptionalMetadata(body, category as string);
    if ("error" in metadataParsed) return NextResponse.json({ error: metadataParsed.error }, { status: 400 });

    const updateData: Record<string, unknown> = {
      ...(categoryProvided && { category: category as EquipmentCategory }),
      ...(brandProvided && { brand }),
      ...(modelProvided && { model }),
      ...(unitSpecParsed.provided && { unitSpec: unitSpecParsed.value }),
      ...(unitLabelParsed.provided && { unitLabel: unitLabelParsed.value }),
      ...(descriptionParsed.provided && { description: descriptionParsed.value }),
      ...(skuParsed.provided && { sku: skuParsed.value }),
      ...(vendorNameParsed.provided && { vendorName: vendorNameParsed.value }),
      ...(vendorPartParsed.provided && { vendorPartNumber: vendorPartParsed.value }),
      ...(unitCostParsed.provided && { unitCost: unitCostParsed.value }),
      ...(sellPriceParsed.provided && { sellPrice: sellPriceParsed.value }),
      ...(hardToProcureParsed.provided && { hardToProcure: hardToProcureParsed.value }),
      ...(lengthParsed.provided && { length: lengthParsed.value }),
      ...(widthParsed.provided && { width: widthParsed.value }),
      ...(weightParsed.provided && { weight: weightParsed.value }),
      ...(zohoItemParsed.provided && { zohoItemId: zohoItemParsed.value }),
      ...(hubspotProductParsed.provided && { hubspotProductId: hubspotProductParsed.value }),
      ...(zuperItemParsed.provided && { zuperItemId: zuperItemParsed.value }),
      ...(quickbooksItemParsed.provided && { quickbooksItemId: quickbooksItemParsed.value }),
      ...(isActiveParsed.provided && { isActive: isActiveParsed.value }),
    };

    const categoryChanged = categoryProvided && category !== existing.category;
    if (categoryChanged && !metadataParsed.provided) {
      return NextResponse.json(
        { error: "metadata is required when changing category to prevent accidental spec data loss" },
        { status: 400 }
      );
    }

    const metadataMutatesSpecs = metadataParsed.provided || categoryChanged;
    if (Object.keys(updateData).length === 0 && !metadataMutatesSpecs) {
      return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx: any
    ) => {
      if (Object.keys(updateData).length > 0) {
        await tx.equipmentSku.update({
          where: { id },
          data: updateData,
        });
      }

      if (metadataMutatesSpecs) {
        const metadataToApply = metadataParsed.provided ? metadataParsed.value : null;
        await applySkuMetadata(tx, id, category as string, metadataToApply);
      }

      return tx.equipmentSku.findUnique({
        where: { id },
        include: SKU_INCLUDE,
      });
    });

    if (!updated) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    return NextResponse.json({ sku: enrichSku(updated as unknown as Record<string, unknown>) });
  } catch (error) {
    if (isPrismaMissingColumnError(error)) {
      console.error("SKU patch blocked by missing database columns:", error);
      Sentry.captureException(error);
      return NextResponse.json(
        {
          error:
            "Inventory catalog schema migration is not applied yet. Run `prisma migrate deploy` on production.",
        },
        { status: 503 }
      );
    }

    const prismaCode = (error as { code?: string } | null)?.code;
    if (prismaCode === "P2002") {
      return NextResponse.json(
        { error: "Another SKU already uses this category + brand + model combination." },
        { status: 409 }
      );
    }
    if (prismaCode === "P2025") {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    console.error("Error updating SKU:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to update SKU" },
      { status: 500 }
    );
  }
}
