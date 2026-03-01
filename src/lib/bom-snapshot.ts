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
import { buildCanonicalKey } from "@/lib/canonical";

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
}

/** Check whether catalog lockdown mode is enabled via env var. */
function isLockdownEnabled(): boolean {
  return (
    String(process.env.CATALOG_LOCKDOWN_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  );
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
 * When CATALOG_LOCKDOWN_ENABLED=true, instead of direct INSERT ON CONFLICT,
 * fuzzy-matches against canonical keys and creates PendingCatalogPush records
 * for unmatched or ambiguous items.
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
    return { created: 0, updated: 0, skipped };
  }

  // ----- Lockdown path: fuzzy match against canonical keys -----
  if (isLockdownEnabled()) {
    return syncWithFuzzyMatch(validItems, skipped);
  }

  // ----- Legacy path: direct INSERT ON CONFLICT -----
  return syncWithDirectInsert(validItems, skipped);
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

  // Batch in groups of 50 — one SQL statement per batch
  const BATCH_SIZE = 50;
  for (let i = 0; i < validItems.length; i += BATCH_SIZE) {
    const batch = validItems.slice(i, i + BATCH_SIZE);

    // Build parameterized VALUES list: each row has 7 params
    // (id, category, brand, model, description, unitSpec, unitLabel)
    // plus SQL literals for isActive/createdAt/updatedAt.
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < batch.length; j++) {
      const item = batch[j];
      const offset = j * 7;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}::"EquipmentCategory", $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::double precision, $${offset + 7}, true, NOW(), NOW())`
      );
      values.push(
        crypto.randomUUID(),  // id
        item.category,        // category (enum cast)
        item.brand,           // brand
        item.model,           // model
        item.description,     // description
        item.unitSpec,         // unitSpec
        item.unitLabel,        // unitLabel
      );
    }

    const rows = await prisma!.$queryRawUnsafe<Array<{ xmax: string }>>(
      `INSERT INTO "EquipmentSku" ("id", "category", "brand", "model", "description", "unitSpec", "unitLabel", "isActive", "createdAt", "updatedAt")
       VALUES ${placeholders.join(", ")}
       ON CONFLICT ("category", "brand", "model") DO UPDATE SET
         "description" = COALESCE(NULLIF(EXCLUDED."description", ''), "EquipmentSku"."description"),
         "unitSpec"    = COALESCE(EXCLUDED."unitSpec", "EquipmentSku"."unitSpec"),
         "unitLabel"   = COALESCE(EXCLUDED."unitLabel", "EquipmentSku"."unitLabel"),
         "isActive"    = true,
         "updatedAt"   = NOW()
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

  return { created, updated, skipped: initialSkipped };
}

// ---------------------------------------------------------------------------
// Lockdown path: fuzzy match against canonical keys
// ---------------------------------------------------------------------------

async function syncWithFuzzyMatch(
  validItems: ValidSkuItem[],
  initialSkipped: number
): Promise<SkuSyncResult> {
  let updated = 0;
  let created = 0; // pending pushes created
  let skipped = initialSkipped;

  for (const item of validItems) {
    const ck = buildCanonicalKey(item.category, item.brand, item.model);
    if (!ck) {
      skipped++;
      continue;
    }

    // Query for existing SKUs matching this canonical key
    const matches = await prisma!.equipmentSku.findMany({
      where: { canonicalKey: ck, isActive: true },
      select: { id: true, canonicalKey: true },
    });

    if (matches.length === 1) {
      // Exact match — use existing SKU, no insert needed
      updated++;
      continue;
    }

    if (matches.length > 1) {
      // Ambiguous — create pending push with candidate IDs
      await prisma!.pendingCatalogPush.create({
        data: {
          brand: item.brand,
          model: item.model,
          description: item.description || "",
          category: item.category,
          systems: ["INTERNAL"],
          requestedBy: "bom_extraction",
          source: "bom_extraction",
          canonicalKey: ck,
          candidateSkuIds: matches.map((m) => m.id),
          reviewReason: "ambiguous_bom_match",
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      });
      created++;
      continue;
    }

    // Zero matches — create pending push
    await prisma!.pendingCatalogPush.create({
      data: {
        brand: item.brand,
        model: item.model,
        description: item.description || "",
        category: item.category,
        systems: ["INTERNAL"],
        requestedBy: "bom_extraction",
        source: "bom_extraction",
        canonicalKey: ck,
        candidateSkuIds: [],
        reviewReason: "no_match",
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    created++;
  }

  return { created, updated, skipped };
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
    const { created: skuCreated, updated: skuUpdated, skipped: skuSkipped } =
      await syncEquipmentSkus(allItemsToSync);

    await logSnapshot("succeeded", {
      dealId,
      dealName,
      version: nextVersion,
      sourceFile,
      skuCreated,
      skuUpdated,
      skuSkipped,
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
