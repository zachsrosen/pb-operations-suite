/**
 * Inventory Zoho Sync API
 *
 * POST /api/inventory/sync-zoho
 *   Pulls item stock from Zoho Inventory and syncs into PB InventoryStock.
 *   - Auth required
 *   - Roles: ADMIN, OWNER, PROJECT_MANAGER
 *   - Writes ADJUSTED transactions for quantity deltas
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { tagSentryRequest } from "@/lib/sentry-request";
import { EquipmentCategory, TransactionType } from "@/generated/prisma/enums";
import { zohoInventory, type ZohoInventoryItem, type ZohoInventoryLocationStock } from "@/lib/zoho-inventory";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "PROJECT_MANAGER"];

const PB_LOCATIONS = [
  "Westminster",
  "Centennial",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
] as const;

const VALID_CATEGORIES = new Set<string>(Object.values(EquipmentCategory));

type SkuMapEntry = {
  category: EquipmentCategory;
  brand: string;
  model: string;
};

type SyncStats = {
  itemsFetched: number;
  mappedItems: number;
  unmappedItemCount: number;
  newSkus: number;
  stockCreated: number;
  stockUpdated: number;
  stockUnchanged: number;
  transactionsCreated: number;
  skippedLocations: number;
};

function norm(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonEnv<T>(raw: string | undefined, fallback: T): T {
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseQuantity(...values: Array<string | number | undefined | null>): number | null {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;

    const num = typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").trim());

    if (Number.isFinite(num)) {
      return Math.round(num);
    }
  }

  return null;
}

function canonicalizeLocation(rawName: string | undefined, rawId: string | undefined): string | null {
  const explicitMap = parseJsonEnv<Record<string, string>>(
    process.env.ZOHO_INVENTORY_LOCATION_MAP_JSON,
    {}
  );

  const candidates = [rawName, rawId].filter((v): v is string => !!v && !!v.trim());

  for (const candidate of candidates) {
    const direct = explicitMap[candidate];
    if (direct && PB_LOCATIONS.includes(direct as (typeof PB_LOCATIONS)[number])) {
      return direct;
    }

    const lowered = candidate.toLowerCase();
    const mappedByCaseInsensitiveKey = Object.entries(explicitMap).find(
      ([k]) => k.toLowerCase() === lowered
    )?.[1];
    if (
      mappedByCaseInsensitiveKey &&
      PB_LOCATIONS.includes(mappedByCaseInsensitiveKey as (typeof PB_LOCATIONS)[number])
    ) {
      return mappedByCaseInsensitiveKey;
    }
  }

  const source = (rawName || rawId || "").trim();
  if (!source) return null;

  const n = norm(source);

  const alias: Record<string, string> = {
    westminster: "Westminster",
    westy: "Westminster",
    centennial: "Centennial",
    dtc: "Centennial",
    "colorado springs": "Colorado Springs",
    "co springs": "Colorado Springs",
    cosp: "Colorado Springs",
    pueblo: "Colorado Springs",
    "san luis obispo": "San Luis Obispo",
    slo: "San Luis Obispo",
    camarillo: "Camarillo",
    cam: "Camarillo",
  };

  if (alias[n]) return alias[n];

  const exactMatch = PB_LOCATIONS.find((loc) => norm(loc) === n);
  if (exactMatch) return exactMatch;

  return null;
}

function parseSkuMapEntry(value: unknown): SkuMapEntry | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const category = String(candidate.category || "").trim().toUpperCase();
  const brand = String(candidate.brand || "").trim();
  const model = String(candidate.model || "").trim();

  if (!category || !brand || !model) return null;
  if (!VALID_CATEGORIES.has(category)) return null;

  return {
    category: category as EquipmentCategory,
    brand,
    model,
  };
}

function getItemMap(): Record<string, SkuMapEntry> {
  const rawMap = parseJsonEnv<Record<string, unknown>>(
    process.env.ZOHO_INVENTORY_ITEM_MAP_JSON,
    {}
  );

  const mapped: Record<string, SkuMapEntry> = {};
  for (const [key, value] of Object.entries(rawMap)) {
    const parsed = parseSkuMapEntry(value);
    if (!parsed) continue;

    mapped[key] = parsed;
    mapped[norm(key)] = parsed;
  }

  return mapped;
}

function parseEncodedSku(item: ZohoInventoryItem): SkuMapEntry | null {
  const raw = (item.sku || "").trim();
  if (!raw) return null;

  const match = raw.match(/^([A-Za-z_]+)\s*[:|]\s*([^:|]+)\s*[:|]\s*(.+)$/);
  if (!match) return null;

  const category = match[1].trim().toUpperCase();
  if (!VALID_CATEGORIES.has(category)) return null;

  const brand = match[2].trim();
  const model = match[3].trim();
  if (!brand || !model) return null;

  return {
    category: category as EquipmentCategory,
    brand,
    model,
  };
}

function resolveItemLocations(item: ZohoInventoryItem): ZohoInventoryLocationStock[] {
  const explicit = Array.isArray(item.locations) ? item.locations : [];
  if (explicit.length > 0) return explicit;

  const defaultLocation = (process.env.ZOHO_INVENTORY_DEFAULT_LOCATION || "").trim();
  if (!defaultLocation) return [];

  return [
    {
      location_name: defaultLocation,
      location_stock_on_hand: item.stock_on_hand ?? item.available_stock,
    },
  ];
}

function mapItemToSku(
  item: ZohoInventoryItem,
  itemMap: Record<string, SkuMapEntry>,
  existingSkusByKey: Map<string, { id: string; category: EquipmentCategory; brand: string; model: string }>
): { id: string; category: EquipmentCategory; brand: string; model: string; created: boolean } | null {
  const directCandidates = [item.item_id, item.sku, item.name, norm(item.item_id), norm(item.sku), norm(item.name)]
    .filter((v): v is string => !!v && !!v.trim());

  for (const key of directCandidates) {
    const mapped = itemMap[key];
    if (!mapped) continue;

    const skuKey = `${mapped.category}:${norm(mapped.brand)}:${norm(mapped.model)}`;
    const existing = existingSkusByKey.get(skuKey);
    if (existing) {
      return { ...existing, created: false };
    }

    return {
      id: "",
      category: mapped.category,
      brand: mapped.brand,
      model: mapped.model,
      created: true,
    };
  }

  const encoded = parseEncodedSku(item);
  if (encoded) {
    const skuKey = `${encoded.category}:${norm(encoded.brand)}:${norm(encoded.model)}`;
    const existing = existingSkusByKey.get(skuKey);
    if (existing) {
      return { ...existing, created: false };
    }

    return {
      id: "",
      category: encoded.category,
      brand: encoded.brand,
      model: encoded.model,
      created: true,
    };
  }

  const searchBlob = `${item.name || ""} ${item.sku || ""}`.toLowerCase();
  const fuzzy = [...existingSkusByKey.values()].filter((sku) => {
    const brand = sku.brand.toLowerCase();
    const model = sku.model.toLowerCase();
    return brand.length > 1 && model.length > 1 && searchBlob.includes(brand) && searchBlob.includes(model);
  });

  if (fuzzy.length === 1) {
    return { ...fuzzy[0], created: false };
  }

  return null;
}

export async function POST(request: NextRequest) {
  tagSentryRequest(request);

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!ALLOWED_ROLES.includes(authResult.role)) {
    return NextResponse.json(
      {
        error:
          "Insufficient permissions. Requires ADMIN, OWNER, or PROJECT_MANAGER role.",
      },
      { status: 403 }
    );
  }

  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      {
        error: "Zoho Inventory integration not configured",
        configured: false,
        missing: zohoInventory.getMissingConfig(),
      },
      { status: 503 }
    );
  }

  try {
    const itemMap = getItemMap();

    const existingSkus = await prisma.equipmentSku.findMany({
      select: { id: true, category: true, brand: true, model: true },
    });

    const existingSkusByKey = new Map(
      existingSkus.map((sku) => [
        `${sku.category}:${norm(sku.brand)}:${norm(sku.model)}`,
        sku,
      ])
    );

    const items = await zohoInventory.listItems();

    const stats: SyncStats = {
      itemsFetched: items.length,
      mappedItems: 0,
      unmappedItemCount: 0,
      newSkus: 0,
      stockCreated: 0,
      stockUpdated: 0,
      stockUnchanged: 0,
      transactionsCreated: 0,
      skippedLocations: 0,
    };

    const warnings: string[] = [];
    const unmappedItems: Array<{ itemId: string; name: string; sku?: string }> = [];

    for (const item of items) {
      const mapped = mapItemToSku(item, itemMap, existingSkusByKey);

      if (!mapped) {
        stats.unmappedItemCount += 1;
        unmappedItems.push({ itemId: item.item_id, name: item.name, sku: item.sku });
        continue;
      }

      let skuId = mapped.id;
      if (!skuId) {
        const createdSku = await prisma.equipmentSku.upsert({
          where: {
            category_brand_model: {
              category: mapped.category,
              brand: mapped.brand,
              model: mapped.model,
            },
          },
          update: {
            isActive: true,
          },
          create: {
            category: mapped.category,
            brand: mapped.brand,
            model: mapped.model,
            isActive: true,
          },
          select: { id: true, category: true, brand: true, model: true },
        });

        skuId = createdSku.id;
        const skuKey = `${createdSku.category}:${norm(createdSku.brand)}:${norm(createdSku.model)}`;
        if (!existingSkusByKey.has(skuKey)) {
          stats.newSkus += 1;
          existingSkusByKey.set(skuKey, createdSku);
        }
      }

      stats.mappedItems += 1;

      const locations = resolveItemLocations(item);
      if (locations.length === 0) {
        stats.skippedLocations += 1;
        warnings.push(`No location stock entries for item ${item.item_id} (${item.name})`);
        continue;
      }

      for (const loc of locations) {
        const rawLocationName = loc.location_name || loc.warehouse_name;
        const rawLocationId = loc.location_id || loc.warehouse_id;

        const mappedLocation = canonicalizeLocation(rawLocationName, rawLocationId);
        if (!mappedLocation) {
          stats.skippedLocations += 1;
          warnings.push(
            `Unmapped location for item ${item.item_id}: ${rawLocationName || rawLocationId || "(unknown)"}`
          );
          continue;
        }

        const targetQty = parseQuantity(
          loc.location_stock_on_hand,
          loc.warehouse_stock_on_hand,
          loc.stock_on_hand,
          loc.location_available_stock,
          loc.available_stock
        );

        if (targetQty === null) {
          stats.skippedLocations += 1;
          warnings.push(
            `Missing stock quantity for item ${item.item_id} at location ${mappedLocation}`
          );
          continue;
        }

        const deltaResult = await prisma.$transaction(async (tx) => {
          const existing = await tx.inventoryStock.findUnique({
            where: { skuId_location: { skuId, location: mappedLocation } },
            select: { id: true, quantityOnHand: true },
          });

          if (!existing) {
            const createdStock = await tx.inventoryStock.create({
              data: {
                skuId,
                location: mappedLocation,
                quantityOnHand: targetQty,
                lastCountedAt: new Date(),
              },
              select: { id: true },
            });

            if (targetQty !== 0) {
              await tx.stockTransaction.create({
                data: {
                  stockId: createdStock.id,
                  type: TransactionType.ADJUSTED,
                  quantity: targetQty,
                  reason: `Zoho sync (${item.item_id})`,
                  performedBy: "Zoho Inventory Sync",
                },
              });
            }

            return {
              createdStock: true,
              changed: targetQty !== 0,
              delta: targetQty,
            };
          }

          const delta = targetQty - existing.quantityOnHand;

          if (delta === 0) {
            await tx.inventoryStock.update({
              where: { id: existing.id },
              data: { lastCountedAt: new Date() },
              select: { id: true },
            });
            return { createdStock: false, changed: false, delta: 0 };
          }

          await tx.inventoryStock.update({
            where: { id: existing.id },
            data: {
              quantityOnHand: targetQty,
              lastCountedAt: new Date(),
            },
            select: { id: true },
          });

          await tx.stockTransaction.create({
            data: {
              stockId: existing.id,
              type: TransactionType.ADJUSTED,
              quantity: delta,
              reason: `Zoho sync (${item.item_id})`,
              performedBy: "Zoho Inventory Sync",
            },
          });

          return { createdStock: false, changed: true, delta };
        });

        if (deltaResult.createdStock) {
          stats.stockCreated += 1;
        } else if (deltaResult.changed) {
          stats.stockUpdated += 1;
        } else {
          stats.stockUnchanged += 1;
        }

        if (deltaResult.delta !== 0) {
          stats.transactionsCreated += 1;
        }
      }
    }

    try {
      await logActivity({
        type: "INVENTORY_ADJUSTED",
        description: `Zoho sync completed: ${stats.stockUpdated + stats.stockCreated} stock rows changed (${stats.transactionsCreated} adjustments)`,
        userEmail: authResult.email,
        userName: authResult.name,
        entityType: "inventory",
        metadata: {
          stats,
          unmappedItems: unmappedItems.slice(0, 20),
          warningCount: warnings.length,
        },
        ipAddress: authResult.ip,
        userAgent: authResult.userAgent,
        requestPath: "/api/inventory/sync-zoho",
        requestMethod: "POST",
        responseStatus: 200,
      });
    } catch (activityError) {
      console.error("Failed to log Zoho inventory sync activity (non-fatal):", activityError);
    }

    return NextResponse.json({
      configured: true,
      ...stats,
      unmappedItemCount: stats.unmappedItemCount,
      warnings: warnings.slice(0, 50),
      unmappedItems: unmappedItems.slice(0, 50),
    });
  } catch (error) {
    console.error("Zoho inventory sync failed:", error);
    Sentry.captureException(error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync from Zoho Inventory",
      },
      { status: 500 }
    );
  }
}
