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
    let skuCreated = 0, skuUpdated = 0, skuSkipped = 0;
    const allItemsToSync: BomItem[] = [
      ...processedBomData.items,
      ...(processedBomData.suggestedAdditions ?? []),
    ];
    for (const item of allItemsToSync) {
      const inventoryCategory = INVENTORY_CATEGORIES[item.category];
      if (!inventoryCategory) { skuSkipped++; continue; }
      const brand = item.brand?.trim();
      const model = item.model?.trim();
      const description = item.description?.trim();
      if (!brand || !model) { skuSkipped++; continue; }

      const unitSpec = item.unitSpec != null ? Number(item.unitSpec) : null;
      const result = await prisma.equipmentSku.upsert({
        where: { category_brand_model: { category: inventoryCategory, brand, model } },
        update: {
          description: description || undefined,
          unitSpec: unitSpec ?? undefined,
          unitLabel: item.unitLabel ?? undefined,
          isActive: true,
        },
        create: {
          category: inventoryCategory,
          brand,
          model,
          description: description || null,
          unitSpec,
          unitLabel: item.unitLabel ?? null,
        },
      });
      if (result.createdAt.getTime() === result.updatedAt.getTime()) skuCreated++; else skuUpdated++;
    }

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
