/**
 * BOM Snapshot — Shared Logic
 *
 * Saves a BOM extraction snapshot with auto-incrementing version,
 * BOM post-processing (feature-gated), and InternalProduct sync. Used by both:
 *   - POST /api/bom/history (HTTP route)
 *   - BOM pipeline orchestrator (automated)
 *
 * Callers provide an ActorContext for audit logging — routes build it from
 * requireApiAuth(), the pipeline uses PIPELINE_ACTOR.
 */

import { prisma, logActivity } from "@/lib/db";
import { EquipmentCategory } from "@/generated/prisma/enums";
import type { ActorContext } from "@/lib/actor-context";
import { notifyAdminsOfNewCatalogRequest } from "@/lib/catalog-notify";
import { buildCanonicalKey, canonicalToken } from "@/lib/canonical";
import { buildBomSearchTerms } from "@/lib/bom-search-terms";
import { zohoInventory } from "@/lib/zoho-inventory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BomItem {
  category: string;
  brand: string | null;
  model: string | null;
  description: string;
  aiFeedbackNotes?: string | null;
  qty: number | string;
  unitSpec?: number | string | null;
  unitLabel?: string | null;
  source?: string;
  flags?: string[];
}

export interface BomData {
  project: {
    customer?: string;
    address?: string;
    aiFeedbackOverall?: string;
    systemSizeKwdc?: number | string;
    systemSizeKwac?: number | string;
    moduleCount?: number | string;
    plansetRev?: string;
    stampDate?: string;
    utility?: string;
    ahj?: string;
    apn?: string;
    roofType?: string;
  };
  items: BomItem[];
  validation?: {
    moduleCountMatch?: boolean | null;
    batteryCapacityMatch?: boolean | null;
    ocpdMatch?: boolean | null;
    warnings?: string[];
  };
}

export interface SkuSyncItemResult {
  category: string;
  brand: string;
  model: string;
  matchSource: "zoho" | "internal" | "pending" | "skipped";
  zohoItemId?: string;
  zohoItemName?: string;
  internalProductId?: string;
  pendingPushId?: string;
  action: "linked" | "matched" | "created_with_zoho" | "queued_pending" | "skipped";
}

export interface SkuSyncResult {
  created: number;
  updated: number;
  skipped: number;
  /** PendingCatalogPush records created/updated for items with no match */
  pending: number;
  /** Items matched via Zoho inventory */
  zohoMatched: number;
  /** Per-item matching detail for UI display */
  items: SkuSyncItemResult[];
}

export interface SnapshotResult {
  id: string;
  version: number;
  createdAt: Date;
  skuSync?: SkuSyncResult;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Categories that map to the InternalProduct inventory table */
const INVENTORY_CATEGORIES: Record<string, EquipmentCategory> = {
  MODULE: "MODULE",
  INVERTER: "INVERTER",
  BATTERY: "BATTERY",
  EV_CHARGER: "EV_CHARGER",
  RAPID_SHUTDOWN: "RAPID_SHUTDOWN",
  RACKING: "RACKING",
  ELECTRICAL_BOS: "ELECTRICAL_BOS",
  MONITORING: "MONITORING",
};

const DEFAULT_PENDING_PUSH_TTL_DAYS = 90;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Validated item shape after filtering in syncInternalProducts. */
interface ValidSkuItem {
  category: string;
  brand: string;
  model: string;
  description: string | null;
  unitSpec: number | null;
  unitLabel: string | null;
}

// ---------------------------------------------------------------------------
// Shared SKU sync
// ---------------------------------------------------------------------------

function parsePendingTtlDays(): number {
  const raw = Number(process.env.CATALOG_PENDING_TTL_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PENDING_PUSH_TTL_DAYS;
  return Math.min(Math.floor(raw), 3650);
}

/** Build search terms for Zoho inventory matching. */
function buildSearchTerms(item: ValidSkuItem): string[] {
  return buildBomSearchTerms({
    brand: item.brand,
    model: item.model,
    description: item.description,
  });
}

function itemBase(item: ValidSkuItem): Pick<SkuSyncItemResult, "category" | "brand" | "model"> {
  return { category: item.category, brand: item.brand, model: item.model };
}

/**
 * Match BOM items against Zoho Inventory (first) then internal InternalProduct
 * catalog. Unmatched items create PendingCatalogPush records for review.
 *
 * New InternalProduct records are only created when backed by a real Zoho item.
 */
export async function syncInternalProducts(items: BomItem[]): Promise<SkuSyncResult> {
  if (!prisma) {
    throw new Error("Database not configured");
  }

  // Legacy escape hatch
  if (process.env.CATALOG_SKU_SYNC_LEGACY === "true") {
    return syncWithDirectInsertLegacy(items);
  }

  const validItems = items
    .map((item) => {
      const inventoryCategory = INVENTORY_CATEGORIES[item.category];
      if (!inventoryCategory) return null;
      const brand = item.brand?.trim();
      const model = item.model?.trim();
      if (!brand || !model) return null;
      return {
        category: inventoryCategory,
        brand,
        model,
        description: item.description?.trim() || null,
        unitSpec: item.unitSpec != null ? Number(item.unitSpec) : null,
        unitLabel: item.unitLabel ?? null,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const skipped = items.length - validItems.length;
  if (validItems.length === 0) {
    return { created: 0, updated: 0, skipped, pending: 0, zohoMatched: 0, items: [] };
  }

  return matchItemsAgainstInventory(validItems, skipped);
}

// ---------------------------------------------------------------------------
// Core matching pipeline
// ---------------------------------------------------------------------------

async function matchItemsAgainstInventory(
  validItems: ValidSkuItem[],
  initialSkipped: number,
): Promise<SkuSyncResult> {
  let created = 0;
  let updated = 0;
  let pending = 0;
  let zohoMatched = 0;
  const itemResults: SkuSyncItemResult[] = [];
  const pendingTtlDays = parsePendingTtlDays();

  // Check if Zoho is available (cache hydrates on first call)
  let zohoAvailable = true;
  try {
    await zohoInventory.getItemsForMatching();
  } catch (e) {
    console.warn("[bom-snapshot] Zoho unavailable, falling back to internal-only matching:", e);
    zohoAvailable = false;
  }

  // Process SEQUENTIALLY — findItemIdByName uses a shared in-memory item
  // cache, and firing 30+ simultaneous requests hits Zoho's concurrent limit.
  for (const item of validItems) {
    const searchTerms = buildSearchTerms(item);
    const canonicalKey = buildCanonicalKey(item.category, item.brand, item.model);

    // ── Step 1: Try Zoho inventory match ──
    let zohoMatch: { item_id: string; zohoName: string; zohoSku?: string } | null = null;
    if (zohoAvailable) {
      for (const term of searchTerms) {
        try {
          zohoMatch = await zohoInventory.findItemIdByName(term);
          if (zohoMatch) break;
        } catch {
          // Individual term failure — try next
        }
      }
    }

    if (zohoMatch) {
      zohoMatched++;
      const result = await linkOrCreateSkuFromZoho(item, zohoMatch, canonicalKey);
      if (result.action === "created_with_zoho") created++;
      else updated++;
      itemResults.push(result);
      continue;
    }

    // ── Step 2: Try internal InternalProduct by canonical key ──
    if (canonicalKey) {
      const skuMatch = await prisma!.internalProduct.findFirst({
        where: { canonicalKey, isActive: true },
        select: { id: true },
      });

      if (skuMatch) {
        updated++;
        itemResults.push({
          ...itemBase(item),
          matchSource: "internal",
          internalProductId: skuMatch.id,
          action: "matched",
        });
        continue;
      }
    }

    // ── Step 3: No match — create PendingCatalogPush ──
    if (!canonicalKey) {
      itemResults.push({ ...itemBase(item), matchSource: "skipped", action: "skipped" });
      continue;
    }

    const existingPending = await prisma!.pendingCatalogPush.findFirst({
      where: { canonicalKey, status: "PENDING" },
      select: { id: true, candidateSkuIds: true },
    });

    const pushResult = await upsertPendingPush(existingPending, {
      brand: item.brand,
      model: item.model,
      description: item.description || "",
      category: item.category,
      canonicalKey,
      candidateSkuIds: [],
      reviewReason: "no_match",
    }, pendingTtlDays);

    pending++;
    itemResults.push({
      ...itemBase(item),
      matchSource: "pending",
      pendingPushId: pushResult.id,
      action: "queued_pending",
    });
  }

  return {
    created,
    updated,
    skipped: initialSkipped,
    pending,
    zohoMatched,
    items: itemResults,
  };
}

// ---------------------------------------------------------------------------
// Zoho → InternalProduct bridge
// ---------------------------------------------------------------------------

/**
 * When a Zoho match is found, find or create the corresponding InternalProduct.
 * Priority: zohoItemId → canonicalKey → create new (Zoho-backed).
 */
async function linkOrCreateSkuFromZoho(
  item: ValidSkuItem,
  zohoMatch: { item_id: string; zohoName: string; zohoSku?: string },
  canonicalKey: string | null,
): Promise<SkuSyncItemResult> {
  const base = itemBase(item);
  const zohoFields = {
    zohoItemId: zohoMatch.item_id,
    zohoItemName: zohoMatch.zohoName,
  };

  // 1. Find by zohoItemId
  let sku = await prisma!.internalProduct.findFirst({
    where: { zohoItemId: zohoMatch.item_id, isActive: true },
    select: { id: true },
  });

  if (sku) {
    return { ...base, matchSource: "zoho", ...zohoFields, internalProductId: sku.id, action: "linked" };
  }

  // 2. Find by canonical key and backfill zohoItemId
  if (canonicalKey) {
    sku = await prisma!.internalProduct.findFirst({
      where: { canonicalKey, isActive: true },
      select: { id: true },
    });
    if (sku) {
      await prisma!.internalProduct.update({
        where: { id: sku.id },
        data: { zohoItemId: zohoMatch.item_id },
      });
      return { ...base, matchSource: "zoho", ...zohoFields, internalProductId: sku.id, action: "linked" };
    }
  }

  // 3. No InternalProduct exists — create one backed by Zoho item
  const cb = canonicalToken(item.brand);
  const cm = canonicalToken(item.model);
  try {
    const newSku = await prisma!.internalProduct.create({
      data: {
        category: item.category as EquipmentCategory,
        brand: item.brand,
        model: item.model,
        description: item.description,
        unitSpec: item.unitSpec,
        unitLabel: item.unitLabel,
        zohoItemId: zohoMatch.item_id,
        canonicalBrand: cb || null,
        canonicalModel: cm || null,
        canonicalKey,
        isActive: true,
      },
      select: { id: true },
    });
    return { ...base, matchSource: "zoho", ...zohoFields, internalProductId: newSku.id, action: "created_with_zoho" };
  } catch (err: unknown) {
    // P2002 = unique constraint race — another request created it first
    if ((err as { code?: string }).code === "P2002") {
      const existing = await prisma!.internalProduct.findFirst({
        where: {
          category: item.category as EquipmentCategory,
          brand: item.brand,
          model: item.model,
        },
        select: { id: true },
      });
      if (existing) {
        await prisma!.internalProduct.update({
          where: { id: existing.id },
          data: { zohoItemId: zohoMatch.item_id },
        });
        return { ...base, matchSource: "zoho", ...zohoFields, internalProductId: existing.id, action: "linked" };
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// PendingCatalogPush helpers
// ---------------------------------------------------------------------------

/** Merge two candidateSkuIds arrays into a deduplicated union. */
function mergeCandidateIds(
  existing: unknown,
  incoming: string[]
): string[] {
  const prev = Array.isArray(existing) ? (existing as string[]) : [];
  return Array.from(new Set([...prev, ...incoming]));
}

/**
 * Create-or-update a PendingCatalogPush record idempotently.
 *
 * If `existing` is provided we update it (merge candidateSkuIds, refresh expiry).
 * Otherwise we create a new record, catching the P2002 unique-constraint race
 * (two concurrent requests both passed findFirst before either created) by
 * falling back to an update.
 */
async function upsertPendingPush(
  existing: { id: string; candidateSkuIds: unknown } | null,
  data: {
    brand: string;
    model: string;
    description: string;
    category: string;
    canonicalKey: string;
    candidateSkuIds: string[];
    reviewReason: string;
  },
  pendingTtlDays: number
): Promise<{ id: string; candidateSkuIds: string[] }> {
  const expiry = new Date(Date.now() + pendingTtlDays * 24 * 60 * 60 * 1000);

  if (existing) {
    const candidateSkuIds = mergeCandidateIds(
      existing.candidateSkuIds,
      data.candidateSkuIds
    );
    const updated = await prisma!.pendingCatalogPush.update({
      where: { id: existing.id },
      data: {
        candidateSkuIds,
        reviewReason: data.reviewReason,
        expiresAt: expiry,
      },
      select: { id: true, candidateSkuIds: true },
    });
    return {
      id: updated.id,
      candidateSkuIds: Array.isArray(updated.candidateSkuIds)
        ? (updated.candidateSkuIds as string[])
        : [],
    };
  }

  try {
    const created = await prisma!.pendingCatalogPush.create({
      data: {
        brand: data.brand,
        model: data.model,
        description: data.description,
        category: data.category,
        systems: ["INTERNAL"],
        requestedBy: "bom_extraction",
        source: "bom_extraction",
        canonicalKey: data.canonicalKey,
        candidateSkuIds: data.candidateSkuIds,
        reviewReason: data.reviewReason,
        expiresAt: expiry,
      },
      select: { id: true, candidateSkuIds: true },
    });
    notifyAdminsOfNewCatalogRequest({
      id: created.id,
      brand: data.brand,
      model: data.model,
      category: data.category,
      requestedBy: "bom_extraction",
      systems: ["INTERNAL"],
    });
    return {
      id: created.id,
      candidateSkuIds: Array.isArray(created.candidateSkuIds)
        ? (created.candidateSkuIds as string[])
        : [],
    };
  } catch (err: unknown) {
    // P2002 = unique constraint violation — another concurrent request won the
    // race between our findFirst and this create. Fall back to update.
    if ((err as { code?: string }).code === "P2002") {
      const conflict = await prisma!.pendingCatalogPush.findFirst({
        where: { canonicalKey: data.canonicalKey, status: "PENDING" },
        select: { id: true, candidateSkuIds: true },
      });
      if (conflict) {
        const candidateSkuIds = mergeCandidateIds(
          conflict.candidateSkuIds,
          data.candidateSkuIds
        );
        const updated = await prisma!.pendingCatalogPush.update({
          where: { id: conflict.id },
          data: {
            candidateSkuIds,
            reviewReason: data.reviewReason,
            expiresAt: expiry,
          },
          select: { id: true, candidateSkuIds: true },
        });
        return {
          id: updated.id,
          candidateSkuIds: Array.isArray(updated.candidateSkuIds)
            ? (updated.candidateSkuIds as string[])
            : [],
        };
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Legacy path: direct INSERT ON CONFLICT (escape hatch)
// ---------------------------------------------------------------------------

async function syncWithDirectInsertLegacy(items: BomItem[]): Promise<SkuSyncResult> {
  const validItems = items
    .map((item) => {
      const inventoryCategory = INVENTORY_CATEGORIES[item.category];
      if (!inventoryCategory) return null;
      const brand = item.brand?.trim();
      const model = item.model?.trim();
      if (!brand || !model) return null;
      return {
        category: inventoryCategory,
        brand,
        model,
        description: item.description?.trim() || null,
        unitSpec: item.unitSpec != null ? Number(item.unitSpec) : null,
        unitLabel: item.unitLabel ?? null,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const skipped = items.length - validItems.length;
  if (validItems.length === 0) {
    return { created: 0, updated: 0, skipped, pending: 0, zohoMatched: 0, items: [] };
  }

  let created = 0;
  let updated = 0;

  // Deduplicate by (category, brand, model)
  const deduped = new Map<string, ValidSkuItem>();
  for (const item of validItems) {
    deduped.set(`${item.category}\0${item.brand}\0${item.model}`, item);
  }
  const uniqueItems = Array.from(deduped.values());

  const BATCH_SIZE = 50;
  for (let i = 0; i < uniqueItems.length; i += BATCH_SIZE) {
    const batch = uniqueItems.slice(i, i + BATCH_SIZE);

    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < batch.length; j++) {
      const item = batch[j];
      const offset = j * 10;
      const cb = canonicalToken(item.brand);
      const cm = canonicalToken(item.model);
      const ck = buildCanonicalKey(item.category, item.brand, item.model);
      placeholders.push(
        `($${offset + 1}, $${offset + 2}::"EquipmentCategory", $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::double precision, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, true, NOW(), NOW())`
      );
      values.push(
        crypto.randomUUID(),
        item.category,
        item.brand,
        item.model,
        item.description,
        item.unitSpec,
        item.unitLabel,
        cb || null,
        cm || null,
        ck,
      );
    }

    const rows = await prisma!.$queryRawUnsafe<Array<{ xmax: string }>>(
      `INSERT INTO "EquipmentSku" ("id", "category", "brand", "model", "description", "unitSpec", "unitLabel", "canonicalBrand", "canonicalModel", "canonicalKey", "isActive", "createdAt", "updatedAt")
       VALUES ${placeholders.join(", ")}
       ON CONFLICT ("category", "brand", "model") DO UPDATE SET
         "description"    = COALESCE(NULLIF(EXCLUDED."description", ''), "EquipmentSku"."description"),
         "unitSpec"       = COALESCE(EXCLUDED."unitSpec", "EquipmentSku"."unitSpec"),
         "unitLabel"      = COALESCE(EXCLUDED."unitLabel", "EquipmentSku"."unitLabel"),
         "canonicalBrand" = COALESCE(EXCLUDED."canonicalBrand", "EquipmentSku"."canonicalBrand"),
         "canonicalModel" = COALESCE(EXCLUDED."canonicalModel", "EquipmentSku"."canonicalModel"),
         "canonicalKey"   = COALESCE(EXCLUDED."canonicalKey", "EquipmentSku"."canonicalKey"),
         "isActive"       = true,
         "updatedAt"      = NOW()
       RETURNING xmax::text`,
      ...values
    );

    for (const row of rows) {
      if (row.xmax === "0") created++;
      else updated++;
    }
  }

  return { created, updated, skipped, pending: 0, zohoMatched: 0, items: [] };
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Save a BOM snapshot for a deal with auto-incrementing version.
 *
 * Runs the BOM post-processor (if enabled via ENABLE_BOM_POST_PROCESS),
 * saves the snapshot to Postgres, and syncs InternalProduct records.
 *
 * @returns The created snapshot's id, version, and createdAt.
 */
export async function saveBomSnapshot(params: {
  dealId: string;
  dealName: string;
  bomData: BomData;
  sourceFile?: string;
  blobUrl?: string;
  actor: ActorContext;
}): Promise<SnapshotResult> {
  const { dealId, dealName, bomData, sourceFile, blobUrl, actor } = params;
  const startedAt = Date.now();

  if (!prisma) {
    throw new Error("Database not configured");
  }

  if (!dealId || !dealName || !bomData?.items) {
    throw new Error("dealId, dealName, and bomData are required");
  }

  const logSnapshot = async (
    outcome: "succeeded" | "failed",
    details: Record<string, unknown>,
  ) => {
    await logActivity({
      type: outcome === "failed" ? "API_ERROR" : "INVENTORY_SKU_SYNCED",
      description:
        outcome === "succeeded"
          ? "Saved BOM snapshot"
          : "BOM snapshot save failed",
      userEmail: actor.email,
      userName: actor.name,
      entityType: "project",
      entityName: "bom_history",
      metadata: {
        event: "bom_snapshot_save",
        outcome,
        ...details,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestPath: actor.requestPath ?? "/api/bom/history",
      requestMethod: actor.requestMethod ?? "POST",
      responseStatus: outcome === "failed" ? 500 : 200,
      durationMs: Date.now() - startedAt,
    });
  };

  // ── BOM Post-Processor (feature-gated) ──────────────────────────────
  const enableBomPostProcess = process.env.ENABLE_BOM_POST_PROCESS === "true";
  let processedBomData: BomData & { suggestedAdditions?: BomItem[]; postProcess?: object } = bomData;

  if (enableBomPostProcess && Array.isArray(bomData?.items)) {
    try {
      const { postProcessBomItems } = await import("@/lib/bom-post-process");
      const result = postProcessBomItems(bomData.project, bomData.items);
      processedBomData = {
        ...bomData,
        items: result.items as unknown as BomItem[],
        suggestedAdditions: result.suggestedAdditions as unknown as BomItem[],
        postProcess: {
          rulesVersion: result.rulesVersion,
          jobContext: result.jobContext,
          corrections: result.corrections,
          appliedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      // Fail-open: log error, save raw data unchanged
      console.error("[bom-snapshot] BOM post-process error:", e);
    }
  }

  try {
    // Find the current highest version for this deal
    const latest = await prisma.projectBomSnapshot.findFirst({
      where: { dealId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    // Save snapshot
    const snapshot = await prisma.projectBomSnapshot.create({
      data: {
        dealId,
        dealName,
        version: nextVersion,
        bomData: processedBomData as object,
        sourceFile: sourceFile ?? null,
        blobUrl: blobUrl ?? null,
        savedBy: actor.email,
      },
    });

    // Sync inventory SKUs — both extracted items and suggested additions
    const allItemsToSync: BomItem[] = [
      ...processedBomData.items,
      ...(processedBomData.suggestedAdditions ?? []),
    ];
    const skuSync = await syncInternalProducts(allItemsToSync);

    await logSnapshot("succeeded", {
      dealId,
      dealName,
      version: nextVersion,
      sourceFile,
      skuCreated: skuSync.created,
      skuUpdated: skuSync.updated,
      skuSkipped: skuSync.skipped,
      skuPending: skuSync.pending,
      skuZohoMatched: skuSync.zohoMatched,
    });

    return {
      id: snapshot.id,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      skuSync,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSnapshot("failed", {
      reason: "snapshot_save_failed",
      dealId,
      dealName,
      error: message,
    });
    throw new Error(`Failed to save BOM snapshot: ${message}`);
  }
}
