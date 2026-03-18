/**
 * BOM → HubSpot Line Items Push Module
 *
 * Pushes BOM snapshot line items to HubSpot deals.
 * Manages a PENDING lock per deal to prevent duplicate concurrent pushes,
 * deletes prior BOM-managed line items only when all new creates succeed,
 * and records the result in BomHubSpotPushLog.
 */

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { buildCanonicalKey } from "@/lib/canonical";
import {
  findInternalAliasCandidates,
  extractModelFamily,
  pickUniqueInternalCandidate,
} from "@/lib/bom-catalog-match";
import {
  parseBomTag,
  fetchLineItemsForDealStrict,
  deleteLineItem,
  createDealLineItem,
} from "@/lib/hubspot";
import type { BomItem, BomData } from "@/lib/bom-snapshot";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkipReason =
  | "invalid_qty"
  | "catalog_missing"
  | "hubspot_link_missing"
  | "create_failed";

export interface PushToHubSpotResult {
  dealId: string;
  snapshotId: string;
  snapshotVersion: number;
  rulesVersion: string | null;
  pushedCount: number;
  pushedItems: Array<{
    bomName: string;
    hubspotProductId: string;
    quantity: number;
  }>;
  skippedItems: Array<{ bomName: string; reason: SkipReason }>;
  catalogMissing: Array<{
    category: string;
    brand: string | null;
    model: string | null;
    description: string;
  }>;
  hubspotLinkMissing: Array<{
    internalProductId: string;
    name: string;
    sku: string | null;
  }>;
  deletedPriorCount: number;
  jobContext: Record<string, unknown> | null;
}

/**
 * Extended BomData that may include suggested additions from the BOM pipeline
 * and post-processing metadata.
 */
type SnapshotBomData = BomData & {
  suggestedAdditions?: BomItem[];
  postProcess?: {
    rulesVersion?: string;
    jobContext?: Record<string, unknown>;
  };
};

// ---------------------------------------------------------------------------
// DuplicatePushError
// ---------------------------------------------------------------------------

export class DuplicatePushError extends Error {
  constructor(dealId: string) {
    super(`Push already in progress for deal ${dealId}`);
    this.name = "DuplicatePushError";
  }
}

// ---------------------------------------------------------------------------
// Lock management
// ---------------------------------------------------------------------------

/** Stale PENDING lock threshold: 5 minutes. */
const STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Acquire a PENDING lock for a deal push.
 *
 * 1. Recover stale PENDING rows older than 5 minutes (mark FAILED).
 * 2. Delete any completed (SUCCESS / PARTIAL / FAILED) rows for this deal.
 * 3. Insert a new PENDING row — if the @unique dealId constraint fires,
 *    a genuine in-flight PENDING push exists → throw DuplicatePushError.
 *
 * @returns The new BomHubSpotPushLog row ID.
 */
async function acquirePushLock(
  dealId: string,
  snapshotId: string,
  snapshotVersion: number,
  pushedBy: string,
): Promise<string> {
  if (!prisma) throw new Error("Database not configured");

  return prisma.$transaction(async (tx) => {
    const staleThreshold = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS);

    // Step 1: Mark stale PENDING rows as FAILED.
    await tx.bomHubSpotPushLog.updateMany({
      where: {
        dealId,
        status: "PENDING",
        createdAt: { lt: staleThreshold },
      },
      data: {
        status: "FAILED",
        errorMessage: "Timed out (stale lock recovery)",
      },
    });

    // Step 2: Remove any completed rows so the unique insert can proceed.
    await tx.bomHubSpotPushLog.deleteMany({
      where: {
        dealId,
        status: { in: ["SUCCESS", "PARTIAL", "FAILED"] },
      },
    });

    // Step 3: Insert new PENDING row. P2002 → a live PENDING push is in flight.
    try {
      const log = await tx.bomHubSpotPushLog.create({
        data: {
          dealId,
          snapshotId,
          snapshotVersion,
          pushedBy,
          status: "PENDING",
        },
      });
      return log.id;
    } catch (e: unknown) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        throw new DuplicatePushError(dealId);
      }
      throw e;
    }
  });
}

/**
 * Update the PENDING push log row with final status and counts.
 */
async function updatePushLog(
  pushLogId: string,
  data: {
    status: "SUCCESS" | "PARTIAL" | "FAILED";
    pushedCount: number;
    skippedCount: number;
    deletedCount: number;
    errorMessage?: string | null;
    rulesVersion?: string | null;
    jobContext?: Record<string, unknown> | null;
  },
): Promise<void> {
  if (!prisma) throw new Error("Database not configured");

  await prisma.bomHubSpotPushLog.update({
    where: { id: pushLogId },
    data: {
      status: data.status,
      pushedCount: data.pushedCount,
      skippedCount: data.skippedCount,
      deletedCount: data.deletedCount,
      errorMessage: data.errorMessage ?? null,
      rulesVersion: data.rulesVersion ?? null,
      jobContext: data.jobContext ? (data.jobContext as Prisma.InputJsonValue) : undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Catalog matching
// ---------------------------------------------------------------------------

interface MatchedItem {
  item: BomItem;
  qty: number;
  internalProductId: string;
  hubspotProductId: string;
  name: string | null;
  sku: string | null;
}

interface PartitionResult {
  matched: MatchedItem[];
  skipped: Array<{ bomName: string; reason: SkipReason }>;
  catalogMissing: Array<{
    category: string;
    brand: string | null;
    model: string | null;
    description: string;
  }>;
  hubspotLinkMissing: Array<{
    internalProductId: string;
    name: string;
    sku: string | null;
  }>;
}

/**
 * Run three-phase catalog matching for a list of BOM items and partition
 * them into matched / skipped / catalogMissing / hubspotLinkMissing buckets.
 */
async function matchAndPartition(items: BomItem[]): Promise<PartitionResult> {
  if (!prisma) throw new Error("Database not configured");

  const matched: MatchedItem[] = [];
  const skipped: Array<{ bomName: string; reason: SkipReason }> = [];
  const catalogMissing: PartitionResult["catalogMissing"] = [];
  const hubspotLinkMissing: PartitionResult["hubspotLinkMissing"] = [];

  for (const item of items) {
    const bomName = [item.brand, item.model, item.description]
      .filter(Boolean)
      .join(" ")
      .trim() || item.description;

    // Validate quantity.
    const qty = Math.round(Number(item.qty));
    if (!Number.isFinite(qty) || qty <= 0) {
      skipped.push({ bomName, reason: "invalid_qty" });
      continue;
    }

    // Must have brand and model for catalog matching.
    if (!item.brand || !item.model) {
      skipped.push({ bomName, reason: "catalog_missing" });
      continue;
    }

    // Phase 1: canonical key exact match.
    const canonicalKey = buildCanonicalKey(item.category, item.brand, item.model);
    let internalProduct: {
      id: string;
      hubspotProductId: string | null;
      name: string | null;
      brand: string;
      model: string;
      sku: string | null;
    } | null = null;

    if (canonicalKey) {
      internalProduct = await prisma.internalProduct.findFirst({
        where: { canonicalKey, isActive: true },
        select: {
          id: true,
          hubspotProductId: true,
          name: true,
          brand: true,
          model: true,
          sku: true,
        },
      });
    }

    // Phase 2: alias match.
    if (!internalProduct) {
      const aliasCandidates = await findInternalAliasCandidates({
        category: item.category,
        brand: item.brand,
        model: item.model,
      });

      if (aliasCandidates.length > 0) {
        // Exact normalized alias match.
        const normalizedModel = item.model.trim().toUpperCase();
        const exactMatch = aliasCandidates.find(
          (c) => c.model.trim().toUpperCase() === normalizedModel,
        );
        const candidate = exactMatch
          ? { id: exactMatch.id, model: exactMatch.model, canonicalKey: exactMatch.canonicalKey }
          : pickUniqueInternalCandidate(aliasCandidates);

        if (candidate) {
          internalProduct = await prisma.internalProduct.findUnique({
            where: { id: candidate.id },
            select: {
              id: true,
              hubspotProductId: true,
              name: true,
              brand: true,
              model: true,
              sku: true,
            },
          });
        }
      }
    }

    // Phase 3: model family match.
    if (!internalProduct) {
      const family = extractModelFamily(item.model);
      if (family) {
        const familyCandidates = await prisma.internalProduct.findMany({
          where: {
            isActive: true,
            model: { startsWith: family },
          },
          select: {
            id: true,
            model: true,
            canonicalKey: true,
          },
        });

        const candidate = pickUniqueInternalCandidate(
          familyCandidates.map((c) => ({
            id: c.id,
            model: String(c.model || "").trim(),
            canonicalKey: c.canonicalKey,
          })),
        );

        if (candidate) {
          internalProduct = await prisma.internalProduct.findUnique({
            where: { id: candidate.id },
            select: {
              id: true,
              hubspotProductId: true,
              name: true,
              brand: true,
              model: true,
              sku: true,
            },
          });
        }
      }
    }

    // No match at any phase → catalogMissing.
    if (!internalProduct) {
      catalogMissing.push({
        category: item.category,
        brand: item.brand,
        model: item.model,
        description: item.description,
      });
      continue;
    }

    // Match found but no HubSpot link → hubspotLinkMissing.
    if (!internalProduct.hubspotProductId) {
      hubspotLinkMissing.push({
        internalProductId: internalProduct.id,
        name: internalProduct.name ?? `${internalProduct.brand} ${internalProduct.model}`.trim(),
        sku: internalProduct.sku,
      });
      continue;
    }

    matched.push({
      item,
      qty,
      internalProductId: internalProduct.id,
      hubspotProductId: internalProduct.hubspotProductId,
      name: internalProduct.name,
      sku: internalProduct.sku,
    });
  }

  return { matched, skipped, catalogMissing, hubspotLinkMissing };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Push BOM snapshot line items to a HubSpot deal.
 *
 * Flow:
 * 1. Load the snapshot by id + dealId.
 * 2. Combine bomData.items + suggestedAdditions.
 * 3. Run three-phase catalog matching.
 * 4. Acquire a PENDING push lock (throws DuplicatePushError if in-flight).
 * 5. Create new line items tagged with [BOM:{pushLogId}].
 * 6. If all creates succeeded: delete prior BOM-managed line items.
 *    If any failed: skip the delete to avoid data loss.
 * 7. Update the push log with final status and counts.
 * 8. Return PushToHubSpotResult.
 */
export async function pushBomToHubSpotLineItems(
  dealId: string,
  snapshotId: string,
  pushedBy: string,
): Promise<PushToHubSpotResult> {
  if (!prisma) throw new Error("Database not configured");

  // 1. Load snapshot.
  const snapshot = await prisma.projectBomSnapshot.findFirst({
    where: { id: snapshotId, dealId },
  });
  if (!snapshot) {
    throw new Error(`Snapshot not found: id=${snapshotId} dealId=${dealId}`);
  }

  const bomData = snapshot.bomData as unknown as SnapshotBomData;
  const rulesVersion = bomData.postProcess?.rulesVersion ?? null;
  const jobContext = bomData.postProcess?.jobContext ?? null;

  // 2. Combine items + suggestedAdditions.
  const allItems: BomItem[] = [
    ...(bomData.items ?? []),
    ...(bomData.suggestedAdditions ?? []),
  ];

  // 3. Catalog matching (before acquiring lock to keep lock window small).
  const { matched, skipped, catalogMissing, hubspotLinkMissing } =
    await matchAndPartition(allItems);

  // 4. Acquire push lock.
  const pushLogId = await acquirePushLock(
    dealId,
    snapshotId,
    snapshot.version,
    pushedBy,
  );

  // Track results.
  const pushedItems: PushToHubSpotResult["pushedItems"] = [];
  const createFailures: Array<{ bomName: string; reason: SkipReason }> = [];

  try {
    // 5a. Fetch current line items (strict — throws on API failure).
    const existingLineItems = await fetchLineItemsForDealStrict(dealId);

    // 5b. Create new line items for each matched item.
    for (const matchedItem of matched) {
      // Use brand+model as the display name if internalProduct.name is null.
      const brandModel = [matchedItem.item.brand, matchedItem.item.model]
        .filter(Boolean)
        .join(" ")
        .trim();
      const displayName = matchedItem.name ?? (brandModel || matchedItem.item.description);

      const bomName = [matchedItem.item.brand, matchedItem.item.model]
        .filter(Boolean)
        .join(" ")
        .trim() || displayName;

      const description = `[BOM:${pushLogId}]`;

      try {
        await createDealLineItem({
          dealId,
          name: displayName,
          quantity: matchedItem.qty,
          description,
          sku: matchedItem.sku ?? null,
          hubspotProductId: matchedItem.hubspotProductId,
        });

        pushedItems.push({
          bomName,
          hubspotProductId: matchedItem.hubspotProductId,
          quantity: matchedItem.qty,
        });
      } catch {
        createFailures.push({ bomName, reason: "create_failed" });
      }
    }

    const allCreateSucceeded = createFailures.length === 0;

    // 5c. Delete prior BOM-managed line items only when all creates succeeded.
    let deletedPriorCount = 0;

    if (allCreateSucceeded) {
      const priorBomItems = existingLineItems.filter((li) => {
        const { isBomManaged, pushLogId: liPushLogId } = parseBomTag(
          li.description,
        );
        return isBomManaged && liPushLogId !== pushLogId;
      });

      for (const li of priorBomItems) {
        try {
          await deleteLineItem(li.id);
          deletedPriorCount++;
        } catch {
          // Best-effort — don't fail the whole push for a delete error.
        }
      }
    }

    // 5d. Determine final status and update log.
    const finalSkipped = [...skipped, ...createFailures];
    const finalStatus =
      createFailures.length === 0
        ? "SUCCESS"
        : pushedItems.length > 0
          ? "PARTIAL"
          : "FAILED";

    await updatePushLog(pushLogId, {
      status: finalStatus,
      pushedCount: pushedItems.length,
      skippedCount: finalSkipped.length,
      deletedCount: deletedPriorCount,
      rulesVersion,
      jobContext,
    });

    return {
      dealId,
      snapshotId,
      snapshotVersion: snapshot.version,
      rulesVersion,
      pushedCount: pushedItems.length,
      pushedItems,
      skippedItems: finalSkipped,
      catalogMissing,
      hubspotLinkMissing,
      deletedPriorCount,
      jobContext,
    };
  } catch (err: unknown) {
    // Mark the push log as FAILED.
    await updatePushLog(pushLogId, {
      status: "FAILED",
      pushedCount: pushedItems.length,
      skippedCount: skipped.length + createFailures.length,
      deletedCount: 0,
      errorMessage:
        err instanceof Error ? err.message : "Unknown error",
      rulesVersion,
      jobContext,
    }).catch(() => {
      // Log update failure should not shadow the original error.
    });

    throw err;
  }
}
