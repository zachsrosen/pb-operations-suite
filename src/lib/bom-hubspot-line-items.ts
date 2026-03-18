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
import { notifyAdminsOfNewCatalogRequest } from "@/lib/catalog-notify";

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
  catalogRequestsCreated: number;
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
 * 2. Insert a new PENDING row — if the partial unique index on
 *    (dealId, status=PENDING) fires, a genuine in-flight push exists
 *    → throw DuplicatePushError. Completed rows are preserved for audit.
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

    // Step 2: Insert new PENDING row. The partial unique index on
    // (dealId) WHERE status='PENDING' rejects if another is in-flight.
    // Completed rows (SUCCESS/PARTIAL/FAILED) are preserved for audit history.
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
    deletedPriorCount: number;
    catalogMissingCount: number;
    hubspotLinkMissingCount: number;
    errorMessage?: string | null;
  },
): Promise<void> {
  if (!prisma) throw new Error("Database not configured");

  await prisma.bomHubSpotPushLog.update({
    where: { id: pushLogId },
    data: {
      status: data.status,
      pushedCount: data.pushedCount,
      skippedCount: data.skippedCount,
      deletedPriorCount: data.deletedPriorCount,
      catalogMissingCount: data.catalogMissingCount,
      hubspotLinkMissingCount: data.hubspotLinkMissingCount,
      errorMessage: data.errorMessage ?? null,
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

    // Phase 2: alias match (hoisted for Phase 3 reuse).
    const aliasCandidates = !internalProduct
      ? await findInternalAliasCandidates({
          category: item.category,
          brand: item.brand,
          model: item.model,
        })
      : [];

    if (!internalProduct && aliasCandidates.length > 0) {
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

    // Phase 3: model family match — filter from alias candidates
    // (same scope as bom-snapshot.ts), not all active products.
    if (!internalProduct && aliasCandidates.length > 0) {
      const family = extractModelFamily(item.model);
      if (family) {
        const familyCandidates = aliasCandidates.filter((c) => {
          const cFamily = extractModelFamily(c.model);
          return cFamily === family;
        });

        const candidate = pickUniqueInternalCandidate(familyCandidates);

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
// Catalog request creation
// ---------------------------------------------------------------------------

/**
 * For each catalogMissing item, find or create a PendingCatalogPush row.
 *
 * Idempotent: if a PENDING row with the same canonicalKey already exists,
 * it is reused (no duplicate row, no admin notification). Only genuinely
 * new rows trigger the admin email.
 *
 * @returns The number of newly created pending requests.
 */
/** Default TTL for pending catalog requests (matches bom-snapshot.ts). */
const DEFAULT_PENDING_TTL_DAYS = 90;

function parsePendingTtlDays(): number {
  const raw = Number(process.env.CATALOG_PENDING_TTL_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PENDING_TTL_DAYS;
  return Math.min(Math.floor(raw), 3650);
}

async function createCatalogRequests(
  catalogMissing: PartitionResult["catalogMissing"],
  dealId: string,
  pushedBy: string,
): Promise<number> {
  if (!prisma || catalogMissing.length === 0) return 0;

  const ttlDays = parsePendingTtlDays();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  let newlyCreated = 0;

  for (const item of catalogMissing) {
    const canonicalKey = buildCanonicalKey(item.category, item.brand ?? "", item.model ?? "");
    if (!canonicalKey) continue;

    // Check for an existing PENDING row with the same canonicalKey.
    const existing = await prisma.pendingCatalogPush.findFirst({
      where: { canonicalKey, status: "PENDING" },
      select: { id: true, systems: true },
    });

    if (existing) {
      // Merge HUBSPOT into systems if the existing row doesn't have it
      // (e.g., created by BOM extraction with systems: ["INTERNAL"]).
      const systems = Array.isArray(existing.systems) ? (existing.systems as string[]) : [];
      if (!systems.includes("HUBSPOT")) {
        await prisma.pendingCatalogPush.update({
          where: { id: existing.id },
          data: { systems: [...systems, "HUBSPOT"] },
        });
      }
      continue;
    }

    try {
      const created = await prisma.pendingCatalogPush.create({
        data: {
          brand: item.brand ?? "Unknown",
          model: item.model ?? "Unknown",
          description: item.description,
          category: item.category,
          systems: ["INTERNAL", "HUBSPOT"],
          requestedBy: pushedBy,
          source: "bom_hubspot_push",
          canonicalKey,
          reviewReason: "no_catalog_match",
          dealId,
          expiresAt,
        },
        select: { id: true },
      });

      notifyAdminsOfNewCatalogRequest({
        id: created.id,
        brand: item.brand ?? "Unknown",
        model: item.model ?? "Unknown",
        category: item.category,
        requestedBy: pushedBy,
        systems: ["INTERNAL", "HUBSPOT"],
        dealId,
      });

      newlyCreated++;
    } catch (err: unknown) {
      // P2002 = race condition — another request created the same canonicalKey
      // between our findFirst and create. Safe to skip.
      if ((err as { code?: string }).code === "P2002") continue;
      throw err;
    }
  }

  return newlyCreated;
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
 * 3b. Create PendingCatalogPush rows for catalogMissing items (idempotent).
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

  // 3b. Create PendingCatalogPush rows for catalogMissing items.
  //     Idempotent — reuses existing PENDING rows, only notifies on new ones.
  const catalogRequestsCreated = await createCatalogRequests(
    catalogMissing,
    dealId,
    pushedBy,
  );

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

    const allCreateSucceeded =
      createFailures.length === 0 && pushedItems.length > 0;

    // 5c. Delete prior BOM-managed line items only when ALL creates succeeded
    //     AND at least one item was actually pushed (zero-match push must not
    //     delete prior items).
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
      deletedPriorCount,
      catalogMissingCount: catalogMissing.length,
      hubspotLinkMissingCount: hubspotLinkMissing.length,
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
      catalogRequestsCreated,
      deletedPriorCount,
      jobContext,
    };
  } catch (err: unknown) {
    // Mark the push log as FAILED.
    await updatePushLog(pushLogId, {
      status: "FAILED",
      pushedCount: pushedItems.length,
      skippedCount: skipped.length + createFailures.length,
      deletedPriorCount: 0,
      catalogMissingCount: catalogMissing.length,
      hubspotLinkMissingCount: hubspotLinkMissing.length,
      errorMessage:
        err instanceof Error ? err.message : "Unknown error",
    }).catch(() => {
      // Log update failure should not shadow the original error.
    });

    throw err;
  }
}
