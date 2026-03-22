import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { isCatalogSyncEnabled } from "@/lib/catalog-sync-confirmation";
import {
  validateBulkSyncToken,
  validateContinuationToken,
  hashToken,
  computeBulkSkuSyncHash,
  buildContinuationToken,
  withHubSpotRetry,
} from "@/lib/bulk-sync-confirmation";
import { createOrUpdateHubSpotProduct } from "@/lib/hubspot";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);
const CHUNK_SIZE = 25;
const ITEM_DELAY_MS = 200;
const STALE_LOCK_MS = 15 * 60 * 1000; // 15 minutes

// ──────────────────────────────────────────────
// POST handler
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ error: "Catalog sync is not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action } = body as { action?: string };

  if (action === "preview") {
    return handlePreview();
  }

  if (action === "execute") {
    return handleExecute(body as Record<string, unknown>, authResult.email);
  }

  return NextResponse.json(
    { error: 'Invalid action. Use "preview" or "execute".' },
    { status: 400 },
  );
}

// ──────────────────────────────────────────────
// Preview
// ──────────────────────────────────────────────

async function handlePreview() {
  const skus = await prisma.internalProduct.findMany({
    where: { hubspotProductId: null, isActive: true },
    select: { id: true, category: true, brand: true, model: true },
    orderBy: { id: "asc" },
  });

  const changesHash = computeBulkSkuSyncHash(skus);

  return NextResponse.json({
    skus: skus.map((s) => ({
      id: s.id,
      category: s.category,
      brand: s.brand,
      model: s.model,
    })),
    count: skus.length,
    changesHash,
  });
}

// ──────────────────────────────────────────────
// Execute (chunked)
// ──────────────────────────────────────────────

async function handleExecute(body: Record<string, unknown>, userEmail: string) {
  // Role check
  const dbUser = await getUserByEmail(userEmail);
  const role = normalizeRole((dbUser?.role ?? "VIEWER") as UserRole);
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  const token = String(body.token || "").trim();
  const issuedAt = Number(body.issuedAt) || 0;
  const changesHash = String(body.changesHash || "").trim();
  const cursor = body.cursor ? String(body.cursor).trim() : undefined;
  const continuationToken = body.continuationToken
    ? String(body.continuationToken).trim()
    : undefined;
  const continuationIssuedAt = body.continuationIssuedAt
    ? Number(body.continuationIssuedAt)
    : undefined;
  const runId = body.runId ? String(body.runId).trim() : undefined;

  const isFirstChunk = !cursor && !continuationToken;

  if (isFirstChunk) {
    // First chunk: requires HMAC token
    if (!token || !issuedAt || !changesHash) {
      return NextResponse.json(
        { error: "token, issuedAt, and changesHash are required for first chunk" },
        { status: 400 },
      );
    }

    return executeFirstChunk({ token, issuedAt, changesHash, userEmail });
  } else {
    // Continuation chunk: requires continuation token + runId
    if (!continuationToken || !continuationIssuedAt || !runId || !cursor) {
      return NextResponse.json(
        { error: "continuationToken, continuationIssuedAt, runId, and cursor are required" },
        { status: 400 },
      );
    }

    return executeContinuationChunk({
      continuationToken,
      continuationIssuedAt,
      runId,
      cursor,
      userEmail,
    });
  }
}

// ──────────────────────────────────────────────
// First chunk
// ──────────────────────────────────────────────

async function executeFirstChunk(params: {
  token: string;
  issuedAt: number;
  changesHash: string;
  userEmail: string;
}) {
  const { token, issuedAt, changesHash, userEmail } = params;

  // Server-side recompute of missing SKUs
  const missingSkus = await prisma.internalProduct.findMany({
    where: { hubspotProductId: null, isActive: true },
    select: { id: true, category: true, brand: true, model: true },
    orderBy: { id: "asc" },
  });

  const freshHash = computeBulkSkuSyncHash(missingSkus);
  if (freshHash !== changesHash) {
    return NextResponse.json(
      {
        error: "Catalog state has changed since preview. Please re-preview and confirm again.",
        freshHash,
        tokenHash: changesHash,
      },
      { status: 409 },
    );
  }

  // Validate HMAC
  const validation = validateBulkSyncToken({
    token,
    issuedAt,
    operation: "hubspot-product-bulk-sync",
    operationId: "all",
    changesHash: freshHash,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 403 });
  }

  // Stale lock recovery
  await prisma.hubSpotSyncRun.updateMany({
    where: {
      operation: "hubspot-product-bulk-sync",
      operationId: "all",
      status: "RUNNING",
      updatedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) },
    },
    data: {
      status: "FAILED",
      outcomes: { error: "Stale lock recovery — run exceeded 15 minute timeout" },
    },
  });

  // DB idempotency + mutual exclusion
  const tokenHashValue = hashToken(token);
  let run;
  try {
    run = await prisma.hubSpotSyncRun.create({
      data: {
        tokenHash: tokenHashValue,
        operation: "hubspot-product-bulk-sync",
        operationId: "all",
        status: "RUNNING",
        inputHash: freshHash,
        targetIds: missingSkus.map((s) => s.id),
        executedBy: userEmail,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes("Unique constraint") && msg.includes("tokenHash")) {
      const existing = await prisma.hubSpotSyncRun.findUnique({
        where: { tokenHash: tokenHashValue },
      });
      if (existing) {
        return NextResponse.json({
          runId: existing.id,
          status: existing.status,
          itemsCreated: existing.itemsCreated,
          itemsSkipped: existing.itemsSkipped,
          itemsFailed: existing.itemsFailed,
          idempotent: true,
        });
      }
    }

    if (msg.includes("Unique constraint") && msg.includes("running_lock")) {
      return NextResponse.json(
        { error: "A bulk sync operation is already running. Please wait for it to complete." },
        { status: 409 },
      );
    }

    throw error;
  }

  // Process first chunk from frozen target set
  return processChunk(run.id, tokenHashValue, undefined, userEmail);
}

// ──────────────────────────────────────────────
// Continuation chunk
// ──────────────────────────────────────────────

async function executeContinuationChunk(params: {
  continuationToken: string;
  continuationIssuedAt: number;
  runId: string;
  cursor: string;
  userEmail: string;
}) {
  const { continuationToken, continuationIssuedAt, runId, cursor, userEmail } = params;

  // Look up the run
  const run = await prisma.hubSpotSyncRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (run.status !== "RUNNING") {
    return NextResponse.json({
      runId: run.id,
      status: run.status,
      itemsCreated: run.itemsCreated,
      itemsSkipped: run.itemsSkipped,
      itemsFailed: run.itemsFailed,
      completed: true,
    });
  }
  if (run.executedBy !== userEmail) {
    return NextResponse.json(
      { error: "Continuation must be by same user who started the run" },
      { status: 403 },
    );
  }

  // Validate continuation token
  const validation = validateContinuationToken({
    continuationToken,
    runId,
    tokenHash: run.tokenHash,
    cursor,
    executedBy: userEmail,
    issuedAt: continuationIssuedAt,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 403 });
  }

  return processChunk(run.id, run.tokenHash, cursor, userEmail);
}

// ──────────────────────────────────────────────
// Process a chunk of SKUs
// ──────────────────────────────────────────────

async function processChunk(
  runId: string,
  tokenHash: string,
  afterCursor: string | undefined,
  userEmail: string,
) {
  const run = await prisma.hubSpotSyncRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Get frozen target IDs
  const frozenIds = run.targetIds as string[] | null;
  if (!frozenIds || frozenIds.length === 0) {
    // No targets — complete immediately
    await prisma.hubSpotSyncRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return NextResponse.json({
      runId,
      status: "COMPLETED",
      created: 0,
      failed: 0,
      remaining: 0,
    });
  }

  // Get chunk of target SKUs (from frozen set, ordered by id, after cursor)
  const targetIdsForChunk = afterCursor
    ? frozenIds.filter((id) => id > afterCursor).slice(0, CHUNK_SIZE)
    : frozenIds.slice(0, CHUNK_SIZE);

  if (targetIdsForChunk.length === 0) {
    // All processed — finalize
    const updatedRun = await prisma.hubSpotSyncRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return NextResponse.json({
      runId,
      status: "COMPLETED",
      itemsCreated: updatedRun.itemsCreated,
      itemsSkipped: updatedRun.itemsSkipped,
      itemsFailed: updatedRun.itemsFailed,
      remaining: 0,
    });
  }

  // Fetch the actual SKU data
  const skus = await prisma.internalProduct.findMany({
    where: { id: { in: targetIdsForChunk }, isActive: true },
    orderBy: { id: "asc" },
  });

  let chunkCreated = 0;
  let chunkSkipped = 0;
  let chunkFailed = 0;
  const chunkOutcomes: Array<{
    internalProductId: string;
    brand: string;
    model: string;
    status: string;
    reason?: string;
    hubspotProductId?: string;
  }> = [];

  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i];

    // Skip if already has hubspotProductId (race protection)
    if (sku.hubspotProductId) {
      chunkSkipped++;
      chunkOutcomes.push({
        internalProductId: sku.id,
        brand: sku.brand,
        model: sku.model,
        status: "skipped",
        reason: "Already has HubSpot Product ID",
      });
      // Heartbeat
      await prisma.hubSpotSyncRun.update({
        where: { id: runId },
        data: { updatedAt: new Date() },
      });
      continue;
    }

    const productResult = await withHubSpotRetry(
      () =>
        createOrUpdateHubSpotProduct({
          brand: sku.brand,
          model: sku.model,
          description: sku.description || undefined,
          sku: sku.model,
          productCategory: sku.category,
        }),
      `BulkSync(${sku.brand} ${sku.model})`,
    );

    if (!productResult.ok) {
      chunkFailed++;
      chunkOutcomes.push({
        internalProductId: sku.id,
        brand: sku.brand,
        model: sku.model,
        status: "failed",
        reason: productResult.error,
      });
    } else {
      // Guarded write-back
      const updated = await prisma.internalProduct.updateMany({
        where: { id: sku.id, hubspotProductId: null },
        data: { hubspotProductId: productResult.data.hubspotProductId },
      });

      if (updated.count > 0) {
        chunkCreated++;
        chunkOutcomes.push({
          internalProductId: sku.id,
          brand: sku.brand,
          model: sku.model,
          status: "created",
          hubspotProductId: productResult.data.hubspotProductId,
        });
      } else {
        chunkSkipped++;
        chunkOutcomes.push({
          internalProductId: sku.id,
          brand: sku.brand,
          model: sku.model,
          status: "skipped",
          reason: "Guarded write — another process linked this product",
        });
      }
    }

    // Heartbeat update
    await prisma.hubSpotSyncRun.update({
      where: { id: runId },
      data: {
        itemsCreated: { increment: chunkOutcomes[chunkOutcomes.length - 1].status === "created" ? 1 : 0 },
        itemsSkipped: { increment: chunkOutcomes[chunkOutcomes.length - 1].status === "skipped" ? 1 : 0 },
        itemsFailed: { increment: chunkOutcomes[chunkOutcomes.length - 1].status === "failed" ? 1 : 0 },
        updatedAt: new Date(),
      },
    });

    // Rate limit delay between items (skip on last item)
    if (i < skus.length - 1) {
      await new Promise((r) => setTimeout(r, ITEM_DELAY_MS));
    }
  }

  // Also process target IDs not found in DB (deleted between preview and now)
  const processedIds = new Set(skus.map((s) => s.id));
  for (const missingId of targetIdsForChunk) {
    if (!processedIds.has(missingId)) {
      chunkSkipped++;
      chunkOutcomes.push({
        internalProductId: missingId,
        brand: "",
        model: "",
        status: "skipped",
        reason: "Product no longer exists or is inactive",
      });
    }
  }

  // Calculate remaining
  const lastProcessedId = targetIdsForChunk[targetIdsForChunk.length - 1];
  const remaining = frozenIds.filter((id) => id > lastProcessedId).length;

  // Update cursor
  await prisma.hubSpotSyncRun.update({
    where: { id: runId },
    data: { cursor: lastProcessedId, updatedAt: new Date() },
  });

  if (remaining === 0) {
    // All done
    const finalRun = await prisma.hubSpotSyncRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    return NextResponse.json({
      runId,
      status: "COMPLETED",
      chunkOutcomes,
      itemsCreated: finalRun.itemsCreated,
      itemsSkipped: finalRun.itemsSkipped,
      itemsFailed: finalRun.itemsFailed,
      remaining: 0,
    });
  }

  // Issue continuation token for next chunk
  const continuation = buildContinuationToken({
    runId,
    tokenHash,
    cursor: lastProcessedId,
    executedBy: userEmail,
  });

  return NextResponse.json({
    runId,
    status: "RUNNING",
    chunkOutcomes,
    chunkCreated,
    chunkSkipped,
    chunkFailed,
    remaining,
    cursor: lastProcessedId,
    continuationToken: continuation.continuationToken,
    continuationIssuedAt: continuation.issuedAt,
    continuationExpiresAt: continuation.expiresAt,
  });
}
