// src/lib/product-sync.ts
//
// Cross-system product sync orchestrator.
// Polls Zoho, HubSpot, and Zuper for unlinked products, imports them into
// InternalProduct, and pushes outward to the other systems.

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { EquipmentCategory } from "@/generated/prisma/enums";
import { canonicalToken, buildCanonicalKey } from "@/lib/canonical";
import {
  resolveZohoCategoryName,
  resolveHubSpotCategory,
  resolveZuperCategory,
} from "@/lib/product-sync-categories";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { ZohoInventoryItem } from "@/lib/zoho-inventory";
import { listRecentHubSpotProducts } from "@/lib/hubspot";
import type { HubSpotProductRecord } from "@/lib/hubspot";
import { listRecentZuperProducts } from "@/lib/zuper-catalog";
import type { ZuperProductRecord } from "@/lib/zuper-catalog";
import { pushToMissingSystems } from "@/lib/product-sync-outbound";

// ── Types ────────────────────────────────────────────────────────────────────

export type SyncSource = "zoho" | "hubspot" | "zuper";

export interface ExternalProductFields {
  externalId: string;
  source: SyncSource;
  name: string;
  brand: string;
  model: string;
  description: string;
  sku?: string;
  unitCost?: number;
  sellPrice?: number;
  sourceCategory?: string;
  rawMetadata: Record<string, unknown>;
}

interface SyncRunStats {
  zohoScanned: number;
  hubspotScanned: number;
  zuperScanned: number;
  imported: number;
  linked: number;
  flagged: number;
  skipped: number;
  errors: string[];
}

interface SyncRunOptions {
  trigger: "cron" | "manual";
  triggeredBy?: string;
  backfill?: boolean;
}

// ── Concurrency Lock (unique index on lockSentinel) ─────────────────────────
// Only one row with lockSentinel="ACTIVE" can exist (unique constraint).
// PostgreSQL treats NULLs as distinct in unique indexes, so completed runs
// (lockSentinel=null) coexist without conflict. Not a partial index — it works
// because of Postgres NULL semantics.

const STALE_RUN_MS = 5 * 60 * 1000; // 5 minutes

// ── Field Extraction ─────────────────────────────────────────────────────────

export function extractFieldsFromZohoItem(
  item: ZohoInventoryItem & { category_name?: string },
): ExternalProductFields {
  const brand = (item.brand || item.manufacturer || "").trim();
  let model = (item.part_number || "").trim();

  // If no part_number, try to extract model from name by removing brand prefix
  if (!model && item.name && brand) {
    const lower = item.name.toLowerCase();
    const brandLower = brand.toLowerCase();
    const nameWithoutBrand = lower.startsWith(brandLower)
      ? item.name.slice(brand.length).trim()
      : item.name;
    model = nameWithoutBrand || item.name;
  } else if (!model) {
    model = item.name || "";
  }

  return {
    externalId: item.item_id,
    source: "zoho",
    name: item.name || "",
    brand,
    model,
    description: item.description || "",
    sku: item.sku,
    unitCost: item.purchase_rate,
    sellPrice: item.rate,
    sourceCategory: item.category_name,
    rawMetadata: item as unknown as Record<string, unknown>,
  };
}

export function extractFieldsFromHubSpotProduct(
  product: HubSpotProductRecord,
): ExternalProductFields {
  const props = product.properties;
  const name = props.name || "";
  const brand = (props.manufacturer || "").trim();
  let model = "";

  // Try to extract model from name by removing brand prefix
  if (brand && name.toLowerCase().startsWith(brand.toLowerCase())) {
    model = name.slice(brand.length).trim();
  } else {
    model = name;
  }

  return {
    externalId: product.id,
    source: "hubspot",
    name,
    brand,
    model,
    description: props.description || "",
    sku: props.hs_sku || undefined,
    unitCost: props.hs_cost_of_goods_sold
      ? parseFloat(props.hs_cost_of_goods_sold)
      : undefined,
    sellPrice: props.price ? parseFloat(props.price) : undefined,
    sourceCategory: props.product_category || undefined,
    rawMetadata: props as unknown as Record<string, unknown>,
  };
}

export function extractFieldsFromZuperProduct(
  product: ZuperProductRecord,
): ExternalProductFields {
  return {
    externalId: product.id,
    source: "zuper",
    name: product.name || "",
    brand: product.brand || "",
    model: product.model || (product.raw?.part_number as string) || "",
    description: product.description || "",
    sku: product.sku,
    unitCost: product.purchasePrice,
    sellPrice: product.price,
    sourceCategory: product.categoryName,
    rawMetadata: product.raw,
  };
}

// ── Category Resolution ──────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set(Object.values(EquipmentCategory));

function resolveCategory(
  source: SyncSource,
  sourceCategory: string | undefined,
): EquipmentCategory | "skip" | null {
  let raw: string | null;
  switch (source) {
    case "zoho":
      raw = resolveZohoCategoryName(sourceCategory);
      break;
    case "hubspot":
      raw = resolveHubSpotCategory(sourceCategory);
      break;
    case "zuper":
      raw = resolveZuperCategory(sourceCategory);
      break;
  }
  if (raw === null) return null;
  if (raw === "skip") return "skip";
  if (VALID_CATEGORIES.has(raw as EquipmentCategory)) {
    return raw as EquipmentCategory;
  }
  return null; // Invalid enum value — route to review
}

// ── External ID Field Helpers ────────────────────────────────────────────────

function externalIdField(source: SyncSource): "zohoItemId" | "hubspotProductId" | "zuperItemId" {
  switch (source) {
    case "zoho": return "zohoItemId";
    case "hubspot": return "hubspotProductId";
    case "zuper": return "zuperItemId";
  }
}

function sourceLabel(source: SyncSource): string {
  switch (source) {
    case "zoho": return "ZOHO_SYNC";
    case "hubspot": return "HUBSPOT_SYNC";
    case "zuper": return "ZUPER_SYNC";
  }
}

// ── Per-Item Processing ──────────────────────────────────────────────────────

async function processItem(
  fields: ExternalProductFields,
  stats: SyncRunStats,
): Promise<void> {
  const idField = externalIdField(fields.source);

  // 1. Category resolution
  const category = resolveCategory(fields.source, fields.sourceCategory);

  if (category === "skip") {
    stats.skipped += 1;
    return;
  }

  if (!category) {
    // Route to review queue
    await createPendingReview(fields, "unknown_category", []);
    stats.flagged += 1;
    return;
  }

  // 2. Missing critical fields
  if (!fields.name && !fields.brand && !fields.model) {
    await createPendingReview(fields, "incomplete_data", []);
    stats.flagged += 1;
    return;
  }

  // 3. Canonical key dedup
  const cBrand = canonicalToken(fields.brand);
  const cModel = canonicalToken(fields.model);
  const canonicalKey = buildCanonicalKey(category, fields.brand, fields.model);

  if (canonicalKey) {
    // Exact match check
    const exactMatch = await prisma.internalProduct.findFirst({
      where: { canonicalKey },
    });

    if (exactMatch) {
      // Check if the external ID slot is empty
      const currentExternalId = exactMatch[idField];
      if (!currentExternalId) {
        // Auto-link
        await prisma.internalProduct.update({
          where: { id: exactMatch.id },
          data: { [idField]: fields.externalId },
        });
        // Push to any other missing systems
        await pushToMissingSystems(exactMatch.id).catch((err) =>
          stats.errors.push(`Outbound sync failed for linked product ${exactMatch.id}: ${err}`),
        );
        stats.linked += 1;
        return;
      } else if (currentExternalId !== fields.externalId) {
        // Canonical conflict — slot already occupied by different ID
        await createPendingReview(fields, "canonical_conflict", [exactMatch.id]);
        stats.flagged += 1;
        return;
      } else {
        // Already linked to this exact ID — skip
        stats.skipped += 1;
        return;
      }
    }

    // Ambiguous match check: same brand OR model in same-ish space
    if (cBrand && cModel) {
      const ambiguousCandidates = await prisma.internalProduct.findMany({
        where: {
          canonicalBrand: cBrand,
          canonicalModel: { not: null },
          NOT: canonicalKey ? { canonicalKey } : undefined,
        },
        select: { id: true, canonicalModel: true, category: true },
        take: 50,
      });

      // Bidirectional suffix check + cross-category exact match
      const filtered = ambiguousCandidates.filter((c) => {
        if (!c.canonicalModel) return false;
        // Same brand+model but different category
        if (c.canonicalModel === cModel && c.category !== category) return true;
        // Either direction: one is a prefix of the other (suffix variant)
        if (c.canonicalModel !== cModel) {
          return cModel.startsWith(c.canonicalModel) || c.canonicalModel.startsWith(cModel);
        }
        return false;
      });

      if (filtered.length > 0) {
        await createPendingReview(
          fields,
          "ambiguous_match",
          filtered.map((c) => c.id),
        );
        stats.flagged += 1;
        return;
      }
    }
  }

  // 4. No match — create new InternalProduct
  try {
    const newProduct = await prisma.internalProduct.create({
      data: {
        category,
        brand: fields.brand || "Unknown",
        model: fields.model || fields.name || "Unknown",
        name: fields.name || undefined,
        description: fields.description || undefined,
        sku: fields.sku || undefined,
        unitCost: fields.unitCost,
        sellPrice: fields.sellPrice,
        [idField]: fields.externalId,
        canonicalBrand: cBrand || undefined,
        canonicalModel: cModel || undefined,
        canonicalKey: canonicalKey || undefined,
      },
    });

    // Push to missing systems
    await pushToMissingSystems(newProduct.id).catch((err) =>
      stats.errors.push(`Outbound sync failed for new product ${newProduct.id}: ${err}`),
    );

    stats.imported += 1;
  } catch (error) {
    // Handle unique constraint violation (race condition safety net)
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      stats.skipped += 1;
      return;
    }
    throw error;
  }
}

async function createPendingReview(
  fields: ExternalProductFields,
  reason: string,
  candidateIds: string[],
): Promise<void> {
  const idField = externalIdField(fields.source);

  await prisma.pendingCatalogPush.create({
    data: {
      brand: fields.brand || "Unknown",
      model: fields.model || fields.name || "Unknown",
      name: fields.name || undefined,
      description: fields.description || "",
      category: fields.sourceCategory || "UNKNOWN",
      sku: fields.sku || undefined,
      unitCost: fields.unitCost,
      sellPrice: fields.sellPrice,
      metadata: fields.rawMetadata as Prisma.InputJsonValue,
      systems: ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"],
      requestedBy: "product-sync@system",
      source: sourceLabel(fields.source),
      reviewReason: reason,
      candidateSkuIds: candidateIds,
      [idField]: fields.externalId,
    },
  });
}

// ── Known External IDs ───────────────────────────────────────────────────────

async function getKnownExternalIds(field: "zohoItemId" | "hubspotProductId" | "zuperItemId"): Promise<Set<string>> {
  const [products, pending] = await Promise.all([
    prisma.internalProduct.findMany({
      where: { [field]: { not: null } },
      select: { [field]: true },
    }),
    prisma.pendingCatalogPush.findMany({
      where: { [field]: { not: null } },
      select: { [field]: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const p of products) {
    const val = (p as Record<string, unknown>)[field];
    if (typeof val === "string") ids.add(val);
  }
  for (const p of pending) {
    const val = (p as Record<string, unknown>)[field];
    if (typeof val === "string") ids.add(val);
  }
  return ids;
}

// ── Main Orchestrator ────────────────────────────────────────────────────────

export async function runProductSync(options: SyncRunOptions): Promise<{
  id: string;
  stats: SyncRunStats;
}> {
  // 1. Mark stale runs as failed (>5 min without completing)
  await prisma.productSyncRun.updateMany({
    where: {
      lockSentinel: "ACTIVE",
      startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) },
    },
    data: {
      completedAt: new Date(),
      lockSentinel: null,
      errors: JSON.stringify(["Marked as failed: exceeded 5-minute timeout"]),
    },
  });

  // 2. Atomically create run record
  let run: { id: string };
  try {
    run = await prisma.productSyncRun.create({
      data: {
        trigger: options.trigger,
        triggeredBy: options.triggeredBy,
        lockSentinel: "ACTIVE",  // no schema default — explicit on create
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      throw new Error("Another product sync is already in progress");
    }
    throw error;
  }

  const stats: SyncRunStats = {
    zohoScanned: 0,
    hubspotScanned: 0,
    zuperScanned: 0,
    imported: 0,
    linked: 0,
    flagged: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // 4. Determine time window
    let since: Date | undefined;
    if (!options.backfill) {
      const lastSuccessful = await prisma.productSyncRun.findFirst({
        where: {
          completedAt: { not: null },
          errors: null,
          id: { not: run.id },
        },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      });
      // First run (no prior successful run): full scan per spec.
      // Subsequent runs: time-bounded from last successful run, minus a 60s
      // overlap buffer to account for clock skew between servers. The dedup
      // logic in processItem handles re-encounters gracefully (skips already-linked).
      if (lastSuccessful?.startedAt) {
        since = new Date(lastSuccessful.startedAt.getTime() - 60_000);
      }
      // else since stays undefined = full scan
    }
    // backfill mode: since stays undefined = full scan

    // 5. Poll all three systems in parallel
    const [knownZoho, knownHubSpot, knownZuper] = await Promise.all([
      getKnownExternalIds("zohoItemId"),
      getKnownExternalIds("hubspotProductId"),
      getKnownExternalIds("zuperItemId"),
    ]);

    const [zohoItems, hubspotProducts, zuperProducts] = await Promise.allSettled([
      zohoInventory.listItemsSince(since).catch((err) => {
        stats.errors.push(`Zoho poll failed: ${err}`);
        return [] as ZohoInventoryItem[];
      }),
      listRecentHubSpotProducts(since).catch((err) => {
        stats.errors.push(`HubSpot poll failed: ${err}`);
        return [] as HubSpotProductRecord[];
      }),
      listRecentZuperProducts(since).catch((err) => {
        stats.errors.push(`Zuper poll failed: ${err}`);
        return [] as ZuperProductRecord[];
      }),
    ]);

    const zoho = zohoItems.status === "fulfilled" ? zohoItems.value : [];
    const hubspot = hubspotProducts.status === "fulfilled" ? hubspotProducts.value : [];
    const zuper = zuperProducts.status === "fulfilled" ? zuperProducts.value : [];

    stats.zohoScanned = zoho.length;
    stats.hubspotScanned = hubspot.length;
    stats.zuperScanned = zuper.length;

    // 6. Filter to unlinked items
    const unlinkedZoho = zoho.filter(
      (item) => item.item_id && !knownZoho.has(item.item_id),
    );
    const unlinkedHubSpot = hubspot.filter(
      (p) => p.id && !knownHubSpot.has(p.id),
    );
    const unlinkedZuper = zuper.filter(
      (p) => p.id && !knownZuper.has(p.id),
    );

    // 7. Process each unlinked item sequentially (to avoid DB race conditions)
    for (const item of unlinkedZoho) {
      try {
        await processItem(
          extractFieldsFromZohoItem(item as ZohoInventoryItem & { category_name?: string }),
          stats,
        );
      } catch (error) {
        stats.errors.push(`Zoho item ${item.item_id}: ${error}`);
      }
    }

    for (const product of unlinkedHubSpot) {
      try {
        await processItem(extractFieldsFromHubSpotProduct(product), stats);
      } catch (error) {
        stats.errors.push(`HubSpot product ${product.id}: ${error}`);
      }
    }

    for (const product of unlinkedZuper) {
      try {
        await processItem(extractFieldsFromZuperProduct(product), stats);
      } catch (error) {
        stats.errors.push(`Zuper product ${product.id}: ${error}`);
      }
    }
  } catch (fatalError) {
    // Capture fatal errors so the run is never marked as successful
    stats.errors.push(
      `Fatal: ${fatalError instanceof Error ? fatalError.message : String(fatalError)}`,
    );
    throw fatalError;
  } finally {
    // 8. Complete run record (releases the lock by clearing lockSentinel)
    await prisma.productSyncRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        lockSentinel: null,
        ...stats,
        errors: stats.errors.length > 0 ? JSON.stringify(stats.errors) : null,
      },
    });
  }

  return { id: run.id, stats };
}
