import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { isCatalogSyncEnabled } from "@/lib/catalog-sync-confirmation";
import { zohoInventory } from "@/lib/zoho-inventory";
import {
  buildDedupConfirmation,
  validateDedupConfirmationToken,
  hashToken,
  DEDUP_MAX_DELETES,
  type DedupClusterDecision,
} from "@/lib/catalog-dedup-confirmation";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);
const DELETE_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DedupItemOutcome {
  itemId: string;
  status: "deleted" | "skipped_has_stock" | "skipped_not_found" | "failed";
  message: string;
  stockOnHand?: number;
}

// POST: Two-phase endpoint — confirm or execute
export async function POST(request: NextRequest) {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ error: "Catalog sync is not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = (ROLES[((dbUser?.role ?? authResult.role) as UserRole)]?.normalizesTo ?? ((dbUser?.role ?? authResult.role) as UserRole));
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, clusters, token, issuedAt } = body as {
    action?: string;
    clusters?: DedupClusterDecision[];
    token?: string;
    issuedAt?: number;
  };

  if (!Array.isArray(clusters) || clusters.length === 0) {
    return NextResponse.json({ error: "clusters array is required" }, { status: 400 });
  }

  // Validate cluster shape
  for (const cluster of clusters) {
    if (!cluster.keepId || !Array.isArray(cluster.deleteIds)) {
      return NextResponse.json({ error: "Each cluster requires keepId and deleteIds" }, { status: 400 });
    }
  }

  const totalDeletes = clusters.reduce((sum, c) => sum + c.deleteIds.length, 0);
  if (totalDeletes > DEDUP_MAX_DELETES) {
    return NextResponse.json(
      { error: `Maximum ${DEDUP_MAX_DELETES} deletions per request. Got ${totalDeletes}. Break into smaller batches.` },
      { status: 400 },
    );
  }

  // Phase 1: Confirm — generate HMAC token
  if (action === "confirm") {
    try {
      const confirmation = buildDedupConfirmation({ clusters });
      return NextResponse.json(confirmation);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to generate confirmation" },
        { status: 500 },
      );
    }
  }

  // Phase 2: Execute — validate token and delete items
  if (action !== "execute") {
    return NextResponse.json({ error: "action must be 'confirm' or 'execute'" }, { status: 400 });
  }

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "token is required for execute" }, { status: 400 });
  }
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    return NextResponse.json({ error: "issuedAt is required for execute" }, { status: 400 });
  }

  // Validate HMAC token
  const validation = validateDedupConfirmationToken({ token, issuedAt, clusters });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 403 });
  }

  // State machine: upsert by tokenHash for idempotency
  const tHash = hashToken(token);

  try {
    // Try to create or find existing run
    let run = await prisma.zohoDedupRun.findUnique({ where: { tokenHash: tHash } });

    if (run) {
      if (run.status === "completed") {
        return NextResponse.json({
          message: "Already executed",
          runId: run.id,
          status: run.status,
          itemsDeleted: run.itemsDeleted,
          itemsSkipped: run.itemsSkipped,
          itemsFailed: run.itemsFailed,
          outcomes: run.outcomes,
        });
      }
      // pending or failed — resume
    } else {
      run = await prisma.zohoDedupRun.create({
        data: {
          tokenHash: tHash,
          status: "pending",
          clustersInput: clusters as unknown as Parameters<typeof prisma.zohoDedupRun.create>[0]["data"]["clustersInput"],
          executedBy: authResult.email,
        },
      });
    }

    // Collect all delete IDs, checking which ones were already processed
    const previousOutcomes: DedupItemOutcome[] = Array.isArray(run.outcomes)
      ? (run.outcomes as unknown as DedupItemOutcome[])
      : [];
    const alreadyProcessed = new Set(previousOutcomes.map((o) => o.itemId));

    const allDeleteIds = clusters.flatMap((c) => c.deleteIds);
    const remainingIds = allDeleteIds.filter((id) => !alreadyProcessed.has(id));
    const outcomes: DedupItemOutcome[] = [...previousOutcomes];

    // Process deletions sequentially with rate limiting
    for (const itemId of remainingIds) {
      // Re-fetch stock at execute time (never trust client-submitted flags)
      const item = await zohoInventory.getItemById(itemId);

      if (!item) {
        outcomes.push({
          itemId,
          status: "skipped_not_found",
          message: "Item not found in Zoho (may have been deleted already).",
        });
        continue;
      }

      const stockOnHand = Number(item.stock_on_hand ?? 0);
      if (stockOnHand > 0) {
        outcomes.push({
          itemId,
          status: "skipped_has_stock",
          message: `Skipped: item has ${stockOnHand} units in stock.`,
          stockOnHand,
        });
        continue;
      }

      try {
        const result = await zohoInventory.deleteItem(itemId);
        if (result.status === "deleted") {
          outcomes.push({ itemId, status: "deleted", message: result.message });
        } else if (result.status === "not_found") {
          outcomes.push({ itemId, status: "skipped_not_found", message: result.message });
        } else {
          outcomes.push({ itemId, status: "failed", message: result.message });
        }
      } catch (error) {
        outcomes.push({
          itemId,
          status: "failed",
          message: error instanceof Error ? error.message : "Delete failed",
        });
      }

      // Rate limit between deletes
      if (remainingIds.indexOf(itemId) < remainingIds.length - 1) {
        await sleep(DELETE_DELAY_MS);
      }
    }

    // Update run record
    const itemsDeleted = outcomes.filter((o) => o.status === "deleted").length;
    const itemsSkipped = outcomes.filter((o) => o.status.startsWith("skipped")).length;
    const itemsFailed = outcomes.filter((o) => o.status === "failed").length;

    await prisma.zohoDedupRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        outcomes: outcomes as unknown as Parameters<typeof prisma.zohoDedupRun.update>[0]["data"]["outcomes"],
        itemsDeleted,
        itemsSkipped,
        itemsFailed,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      runId: run.id,
      status: "completed",
      itemsDeleted,
      itemsSkipped,
      itemsFailed,
      outcomes,
    });
  } catch (error) {
    // If we have partial outcomes, save them as failed state
    console.error("[Zoho Dedup] Execute failed:", error);

    // Try to update the run to failed state
    try {
      await prisma.zohoDedupRun.updateMany({
        where: { tokenHash: tHash, status: "pending" },
        data: { status: "failed" },
      });
    } catch {
      // Best effort
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dedup execution failed" },
      { status: 500 },
    );
  }
}
