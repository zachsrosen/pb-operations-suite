/**
 * BOM Snapshot — Shared Logic
 *
 * Saves a BOM extraction snapshot with auto-incrementing version,
 * BOM post-processing (feature-gated), and EquipmentSku sync. Used by both:
 *   - POST /api/bom/history (HTTP route)
 *   - BOM pipeline orchestrator (automated)
 *
 * Callers provide an ActorContext for audit logging — routes build it from
 * requireApiAuth(), the pipeline uses PIPELINE_ACTOR.
 */

import { prisma, logActivity } from "@/lib/db";
import { EquipmentCategory } from "@/generated/prisma/enums";
import type { ActorContext } from "@/lib/actor-context";
import { buildCanonicalKey, canonicalToken } from "@/lib/canonical";

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

export interface SnapshotResult {
  id: string;
  version: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Categories that map to the EquipmentSku inventory table */
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

// ---------------------------------------------------------------------------
// Shared SKU sync (used by both /api/bom/save and saveBomSnapshot)
// ---------------------------------------------------------------------------

export interface SkuSyncResult {
  created: number;
  updated: number;
  skipped: number;
  /** Pending catalog pushes created/updated (lockdown mode only, 0 otherwise) */
  pending: number;
  /** Read-only rollout telemetry when lockdown runs in shadow mode. */
  shadow?: {
    evaluated: number;
    exactMatches: number;
    ambiguous: number;
    unmatched: number;
    wouldQueue: number;
  };
}

type CatalogLockdownMode = "off" | "shadow" | "enforced";

interface LockdownConfig {
  mode: CatalogLockdownMode;
  categories: Set<EquipmentCategory> | null;
  pendingTtlDays: number;
}

const DEFAULT_PENDING_PUSH_TTL_DAYS = 90;

function parseLockdownMode(): CatalogLockdownMode {
  const rawMode = String(process.env.CATALOG_LOCKDOWN_MODE || "")
    .trim()
    .toLowerCase();

  if (rawMode === "off" || rawMode === "shadow" || rawMode === "enforced") {
    return rawMode;
  }

  const legacyEnabled =
    String(process.env.CATALOG_LOCKDOWN_ENABLED || "")
      .trim()
      .toLowerCase() === "true";
  return legacyEnabled ? "enforced" : "off";
}

function parseLockdownCategories(): Set<EquipmentCategory> | null {
  const raw = String(process.env.CATALOG_LOCKDOWN_CATEGORIES || "").trim();
  if (!raw) return null;

  const allowed = new Set<EquipmentCategory>();
  for (const entry of raw.split(",")) {
    const candidate = entry.trim().toUpperCase();
    if ((Object.values(EquipmentCategory) as string[]).includes(candidate)) {
      allowed.add(candidate as EquipmentCategory);
    }
  }

  if (allowed.size === 0) {
    console.warn(
      "[bom-snapshot] CATALOG_LOCKDOWN_CATEGORIES provided but no valid categories were parsed; lockdown category scope is empty."
    );
  }

  return allowed;
}

function parsePendingTtlDays(): number {
  const raw = Number(process.env.CATALOG_PENDING_TTL_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PENDING_PUSH_TTL_DAYS;
  return Math.min(Math.floor(raw), 3650);
}

function getLockdownConfig(): LockdownConfig {
  return {
    mode: parseLockdownMode(),
    categories: parseLockdownCategories(),
    pendingTtlDays: parsePendingTtlDays(),
  };
}

function appliesToLockdownCategory(
  item: ValidSkuItem,
  categories: Set<EquipmentCategory> | null
): boolean {
  if (!categories) return true;
  return categories.has(item.category as EquipmentCategory);
}

/** Validated item shape after filtering in syncEquipmentSkus. */
interface ValidSkuItem {
  category: string;
  brand: string;
  model: string;
  description: string | null;
  unitSpec: number | null;
  unitLabel: string | null;
}

/**
 * Batch-upsert BOM items into the EquipmentSku table using a single
 * INSERT ... ON CONFLICT per batch (eliminates N+1 query pattern).
 *
 * When lockdown mode is active (`CATALOG_LOCKDOWN_MODE=shadow|enforced` or
 * legacy `CATALOG_LOCKDOWN_ENABLED=true`), can fuzzy-match against canonical
 * keys and create PendingCatalogPush records for unmatched/ambiguous items.
 *
 * Uses Postgres xmax system column to distinguish inserts (xmax=0) from
 * updates (xmax>0) without an extra SELECT.
 */
export async function syncEquipmentSkus(items: BomItem[]): Promise<SkuSyncResult> {
  if (!prisma) {
    throw new Error("Database not configured");
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
    return { created: 0, updated: 0, skipped, pending: 0 };
  }

  const lockdown = getLockdownConfig();

  // ----- Legacy mode: direct INSERT ON CONFLICT for all categories -----
  if (lockdown.mode === "off") {
    return syncWithDirectInsert(validItems, skipped);
  }

  const lockdownItems = validItems.filter((item) =>
    appliesToLockdownCategory(item, lockdown.categories)
  );
  const legacyItems = validItems.filter(
    (item) => !appliesToLockdownCategory(item, lockdown.categories)
  );

  // ----- Shadow mode: evaluate fuzzy matching but keep writes on legacy path -----
  if (lockdown.mode === "shadow") {
    const directResult = await syncWithDirectInsert(validItems, skipped);
    const shadow = lockdownItems.length
      ? await simulateFuzzyMatch(lockdownItems)
      : { evaluated: 0, exactMatches: 0, ambiguous: 0, unmatched: 0, wouldQueue: 0 };
    return { ...directResult, shadow };
  }

  // ----- Enforced mode: fuzzy for configured categories, direct insert otherwise -----
  const [fuzzyResult, directResult] = await Promise.all([
    lockdownItems.length
      ? syncWithFuzzyMatch(lockdownItems, 0, lockdown.pendingTtlDays)
      : Promise.resolve({ created: 0, updated: 0, skipped: 0, pending: 0 } as SkuSyncResult),
    legacyItems.length
      ? syncWithDirectInsert(legacyItems, 0)
      : Promise.resolve({ created: 0, updated: 0, skipped: 0, pending: 0 } as SkuSyncResult),
  ]);

  return {
    created: fuzzyResult.created + directResult.created,
    updated: fuzzyResult.updated + directResult.updated,
    skipped: skipped + fuzzyResult.skipped + directResult.skipped,
    pending: fuzzyResult.pending + directResult.pending,
  };
}

// ---------------------------------------------------------------------------
// Legacy path: direct INSERT ON CONFLICT
// ---------------------------------------------------------------------------

async function syncWithDirectInsert(
  validItems: ValidSkuItem[],
  initialSkipped: number
): Promise<SkuSyncResult> {
  let created = 0;
  let updated = 0;

  // Deduplicate by (category, brand, model) — PostgreSQL's ON CONFLICT DO UPDATE
  // cannot affect the same row twice in a single INSERT statement. Keep the last
  // occurrence so that later (potentially more complete) data wins.
  const deduped = new Map<string, ValidSkuItem>();
  for (const item of validItems) {
    deduped.set(`${item.category}\0${item.brand}\0${item.model}`, item);
  }
  const uniqueItems = Array.from(deduped.values());

  // Batch in groups of 50 — one SQL statement per batch
  const BATCH_SIZE = 50;
  for (let i = 0; i < uniqueItems.length; i += BATCH_SIZE) {
    const batch = uniqueItems.slice(i, i + BATCH_SIZE);

    // Build parameterized VALUES list: each row has 10 params
    // (id, category, brand, model, description, unitSpec, unitLabel,
    //  canonicalBrand, canonicalModel, canonicalKey)
    // plus SQL literals for isActive/createdAt/updatedAt.
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
        crypto.randomUUID(),  // id
        item.category,        // category (enum cast)
        item.brand,           // brand
        item.model,           // model
        item.description,     // description
        item.unitSpec,         // unitSpec
        item.unitLabel,        // unitLabel
        cb || null,            // canonicalBrand
        cm || null,            // canonicalModel
        ck,                    // canonicalKey
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
      // xmax = 0 means the row was inserted; xmax > 0 means it was updated
      if (row.xmax === "0") {
        created++;
      } else {
        updated++;
      }
    }
  }

  return { created, updated, skipped: initialSkipped, pending: 0 };
}

// ---------------------------------------------------------------------------
// Lockdown helpers
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
// Lockdown path: fuzzy match against canonical keys
// ---------------------------------------------------------------------------

async function syncWithFuzzyMatch(
  validItems: ValidSkuItem[],
  initialSkipped: number,
  pendingTtlDays: number
): Promise<SkuSyncResult> {
  let updated = 0;
  let pending = 0;
  let skipped = initialSkipped;

  const keyedItems: Array<{ item: ValidSkuItem; canonicalKey: string }> = [];
  for (const item of validItems) {
    const ck = buildCanonicalKey(item.category, item.brand, item.model);
    if (!ck) {
      skipped++;
      continue;
    }
    keyedItems.push({ item, canonicalKey: ck });
  }

  if (keyedItems.length === 0) {
    return { created: 0, updated, skipped, pending };
  }

  const uniqueCanonicalKeys = Array.from(
    new Set(keyedItems.map((entry) => entry.canonicalKey))
  );

  const [skuMatches, pendingRows] = await Promise.all([
    prisma!.equipmentSku.findMany({
      where: { canonicalKey: { in: uniqueCanonicalKeys }, isActive: true },
      select: { id: true, canonicalKey: true },
    }),
    prisma!.pendingCatalogPush.findMany({
      where: { canonicalKey: { in: uniqueCanonicalKeys }, status: "PENDING" },
      select: { id: true, canonicalKey: true, candidateSkuIds: true },
    }),
  ]);

  const matchesByCanonicalKey = new Map<string, string[]>();
  for (const row of skuMatches) {
    if (!row.canonicalKey) continue;
    const existing = matchesByCanonicalKey.get(row.canonicalKey) || [];
    existing.push(row.id);
    matchesByCanonicalKey.set(row.canonicalKey, existing);
  }

  const pendingByCanonicalKey = new Map<
    string,
    { id: string; candidateSkuIds: string[] }
  >();
  for (const row of pendingRows) {
    if (!row.canonicalKey) continue;
    pendingByCanonicalKey.set(row.canonicalKey, {
      id: row.id,
      candidateSkuIds: Array.isArray(row.candidateSkuIds)
        ? (row.candidateSkuIds as string[])
        : [],
    });
  }

  for (const entry of keyedItems) {
    const { item, canonicalKey } = entry;
    const matchIds = matchesByCanonicalKey.get(canonicalKey) || [];

    if (matchIds.length === 1) {
      // Exact match — use existing SKU, no insert needed
      updated++;
      continue;
    }

    // Determine review reason and candidate IDs
    const reviewReason = matchIds.length > 1 ? "ambiguous_bom_match" : "no_match";
    const refreshedPending = await upsertPendingPush(
      pendingByCanonicalKey.get(canonicalKey) || null,
      {
        brand: item.brand,
        model: item.model,
        description: item.description || "",
        category: item.category,
        canonicalKey,
        candidateSkuIds: matchIds,
        reviewReason,
      },
      pendingTtlDays
    );
    pendingByCanonicalKey.set(canonicalKey, refreshedPending);
    pending++;
  }

  // Lockdown path never creates SKUs directly — created is always 0
  return { created: 0, updated, skipped, pending };
}

async function simulateFuzzyMatch(
  validItems: ValidSkuItem[]
): Promise<NonNullable<SkuSyncResult["shadow"]>> {
  const keyedItems = validItems
    .map((item) => ({
      canonicalKey: buildCanonicalKey(item.category, item.brand, item.model),
    }))
    .filter((entry): entry is { canonicalKey: string } => Boolean(entry.canonicalKey));

  if (keyedItems.length === 0) {
    return { evaluated: 0, exactMatches: 0, ambiguous: 0, unmatched: 0, wouldQueue: 0 };
  }

  const uniqueCanonicalKeys = Array.from(new Set(keyedItems.map((entry) => entry.canonicalKey)));
  const skuMatches = await prisma!.equipmentSku.findMany({
    where: { canonicalKey: { in: uniqueCanonicalKeys }, isActive: true },
    select: { id: true, canonicalKey: true },
  });

  const countsByCanonicalKey = new Map<string, number>();
  for (const row of skuMatches) {
    if (!row.canonicalKey) continue;
    countsByCanonicalKey.set(
      row.canonicalKey,
      (countsByCanonicalKey.get(row.canonicalKey) || 0) + 1
    );
  }

  let exactMatches = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const entry of keyedItems) {
    const count = countsByCanonicalKey.get(entry.canonicalKey) || 0;
    if (count === 1) exactMatches++;
    else if (count > 1) ambiguous++;
    else unmatched++;
  }

  return {
    evaluated: keyedItems.length,
    exactMatches,
    ambiguous,
    unmatched,
    wouldQueue: ambiguous + unmatched,
  };
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Save a BOM snapshot for a deal with auto-incrementing version.
 *
 * Runs the BOM post-processor (if enabled via ENABLE_BOM_POST_PROCESS),
 * saves the snapshot to Postgres, and syncs EquipmentSku records.
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
    const {
      created: skuCreated,
      updated: skuUpdated,
      skipped: skuSkipped,
      pending: skuPending,
      shadow: skuShadow,
    } = await syncEquipmentSkus(allItemsToSync);

    await logSnapshot("succeeded", {
      dealId,
      dealName,
      version: nextVersion,
      sourceFile,
      skuCreated,
      skuUpdated,
      skuSkipped,
      skuPending,
      ...(skuShadow ? { skuShadow } : {}),
    });

    return { id: snapshot.id, version: snapshot.version, createdAt: snapshot.createdAt };
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
