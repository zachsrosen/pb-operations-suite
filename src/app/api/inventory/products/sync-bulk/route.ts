import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma, getUserByEmail } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { isCatalogSyncEnabled, type SyncSystem } from "@/lib/catalog-sync-confirmation";
import {
  validateBulkSyncToken,
  validateContinuationToken,
  hashToken,
  computeBulkSkuSyncHash,
  buildContinuationToken,
  withHubSpotRetry,
  type BulkSyncOperation,
} from "@/lib/bulk-sync-confirmation";
import {
  executeHubSpotSync,
  executeZohoSync,
  executeZuperSync,
  type SkuRecord,
  type SyncOutcome,
  type SyncPreview,
} from "@/lib/catalog-sync";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);
const CHUNK_SIZE = 25;
const ITEM_DELAY_MS = 200;
const STALE_LOCK_MS = 15 * 60 * 1000; // 15 minutes

const VALID_SYSTEMS = new Set<SyncSystem>(["zoho", "hubspot", "zuper"]);

const OPERATION_BY_SYSTEM: Record<SyncSystem, BulkSyncOperation> = {
  zoho: "zoho-product-bulk-sync",
  hubspot: "hubspot-product-bulk-sync",
  zuper: "zuper-product-bulk-sync",
};

const SYSTEM_FIELD_BY_SYSTEM: Record<SyncSystem, "zohoItemId" | "hubspotProductId" | "zuperItemId"> = {
  zoho: "zohoItemId",
  hubspot: "hubspotProductId",
  zuper: "zuperItemId",
};

const SKU_INCLUDE = {
  moduleSpec: true,
  inverterSpec: true,
  batterySpec: true,
  evChargerSpec: true,
  mountingHardwareSpec: true,
  electricalHardwareSpec: true,
  relayDeviceSpec: true,
} as const;

function parseSystem(input: unknown): SyncSystem | null {
  const value = String(input || "").trim().toLowerCase();
  return VALID_SYSTEMS.has(value as SyncSystem) ? (value as SyncSystem) : null;
}

function systemFromOperation(operation: string): SyncSystem | null {
  if (operation === "zoho-product-bulk-sync") return "zoho";
  if (operation === "hubspot-product-bulk-sync") return "hubspot";
  if (operation === "zuper-product-bulk-sync") return "zuper";
  return null;
}

function getMissingWhere(system: SyncSystem): Prisma.InternalProductWhereInput {
  if (system === "zoho") return { zohoItemId: null, isActive: true };
  if (system === "hubspot") return { hubspotProductId: null, isActive: true };
  return { zuperItemId: null, isActive: true };
}

async function updateRunProgress(
  runId: string,
  increments: { created?: number; skipped?: number; failed?: number } = {},
) {
  await prisma.hubSpotSyncRun.update({
    where: { id: runId },
    data: {
      itemsCreated: increments.created ? { increment: increments.created } : undefined,
      itemsSkipped: increments.skipped ? { increment: increments.skipped } : undefined,
      itemsFailed: increments.failed ? { increment: increments.failed } : undefined,
      updatedAt: new Date(),
    },
  });
}

function buildCreatePreview(system: SyncSystem): SyncPreview {
  return {
    system,
    externalId: null,
    linked: false,
    action: "create",
    changes: [],
    noChanges: false,
  };
}

function classifyOutcomeStatus(status: SyncOutcome["status"]): "created" | "skipped" | "failed" {
  if (status === "created" || status === "updated") return "created";
  if (status === "skipped") return "skipped";
  return "failed";
}

const EXECUTE_BY_SYSTEM: Record<
  SyncSystem,
  (sku: SkuRecord, preview: SyncPreview) => Promise<SyncOutcome>
> = {
  zoho: executeZohoSync,
  hubspot: executeHubSpotSync,
  zuper: executeZuperSync,
};

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

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { action } = body as { action?: string };

  if (action === "preview") {
    return handlePreview(body as Record<string, unknown>);
  }

  if (action === "execute") {
    return handleExecute(body as Record<string, unknown>, authResult.email);
  }

  return NextResponse.json(
    { error: 'Invalid action. Use "preview" or "execute".' },
    { status: 400 },
  );
}

async function handlePreview(body: Record<string, unknown>) {
  const system = parseSystem(body.system);
  if (!system) {
    return NextResponse.json({ error: "system is required (zoho|hubspot|zuper)" }, { status: 400 });
  }

  const skus = await prisma.internalProduct.findMany({
    where: getMissingWhere(system),
    select: { id: true, category: true, brand: true, model: true },
    orderBy: { id: "asc" },
  });

  const changesHash = computeBulkSkuSyncHash(skus);

  return NextResponse.json({
    system,
    skus,
    count: skus.length,
    changesHash,
  });
}

async function handleExecute(body: Record<string, unknown>, userEmail: string) {
  const dbUser = await getUserByEmail(userEmail);
  const role = (ROLES[((dbUser?.roles?.[0] ?? "VIEWER") as UserRole)]?.normalizesTo ?? ((dbUser?.roles?.[0] ?? "VIEWER") as UserRole));
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  const requestedSystem = parseSystem(body.system);
  if (!requestedSystem) {
    return NextResponse.json({ error: "system is required (zoho|hubspot|zuper)" }, { status: 400 });
  }

  const token = String(body.token || "").trim();
  const issuedAt = Number(body.issuedAt) || 0;
  const changesHash = String(body.changesHash || "").trim();

  const continuationToken = body.continuationToken
    ? String(body.continuationToken).trim()
    : undefined;
  const continuationIssuedAt = body.continuationIssuedAt
    ? Number(body.continuationIssuedAt)
    : undefined;
  const runId = body.runId ? String(body.runId).trim() : undefined;
  const cursor = body.cursor ? String(body.cursor).trim() : undefined;

  const isContinuationChunk = Boolean(
    continuationToken || continuationIssuedAt || runId || cursor,
  );

  if (!isContinuationChunk) {
    if (!token || !issuedAt || !changesHash) {
      return NextResponse.json(
        { error: "token, issuedAt, and changesHash are required for first chunk" },
        { status: 400 },
      );
    }

    return executeFirstChunk({
      system: requestedSystem,
      token,
      issuedAt,
      changesHash,
      userEmail,
    });
  }

  if (!continuationToken || !continuationIssuedAt || !runId || !cursor) {
    return NextResponse.json(
      { error: "continuationToken, continuationIssuedAt, runId, and cursor are required" },
      { status: 400 },
    );
  }

  return executeContinuationChunk({
    requestedSystem,
    continuationToken,
    continuationIssuedAt,
    runId,
    cursor,
    userEmail,
  });
}

async function executeFirstChunk(params: {
  system: SyncSystem;
  token: string;
  issuedAt: number;
  changesHash: string;
  userEmail: string;
}) {
  const { system, token, issuedAt, changesHash, userEmail } = params;
  const operation = OPERATION_BY_SYSTEM[system];

  const missingSkus = await prisma.internalProduct.findMany({
    where: getMissingWhere(system),
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

  const validation = validateBulkSyncToken({
    token,
    issuedAt,
    operation,
    operationId: "all",
    changesHash: freshHash,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 403 });
  }

  await prisma.hubSpotSyncRun.updateMany({
    where: {
      operation,
      operationId: "all",
      status: "RUNNING",
      updatedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) },
    },
    data: {
      status: "FAILED",
      outcomes: { error: "Stale lock recovery — run exceeded 15 minute timeout" },
    },
  });

  const tokenHashValue = hashToken(token);

  let run;
  try {
    run = await prisma.hubSpotSyncRun.create({
      data: {
        tokenHash: tokenHashValue,
        operation,
        operationId: "all",
        status: "RUNNING",
        inputHash: freshHash,
        targetIds: missingSkus.map((s) => s.id),
        executedBy: userEmail,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("Unique constraint") && message.includes("tokenHash")) {
      const existing = await prisma.hubSpotSyncRun.findUnique({
        where: { tokenHash: tokenHashValue },
      });
      if (existing) {
        return NextResponse.json({
          system,
          runId: existing.id,
          status: existing.status,
          itemsCreated: existing.itemsCreated,
          itemsSkipped: existing.itemsSkipped,
          itemsFailed: existing.itemsFailed,
          idempotent: true,
        });
      }
    }

    if (message.includes("Unique constraint") && message.includes("running_lock")) {
      return NextResponse.json(
        { error: "A bulk sync operation is already running. Please wait for it to complete." },
        { status: 409 },
      );
    }

    throw error;
  }

  return processChunk(run.id, tokenHashValue, undefined, userEmail);
}

async function executeContinuationChunk(params: {
  requestedSystem: SyncSystem;
  continuationToken: string;
  continuationIssuedAt: number;
  runId: string;
  cursor: string;
  userEmail: string;
}) {
  const {
    requestedSystem,
    continuationToken,
    continuationIssuedAt,
    runId,
    cursor,
    userEmail,
  } = params;

  const run = await prisma.hubSpotSyncRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const runSystem = systemFromOperation(run.operation);
  if (!runSystem) {
    return NextResponse.json({ error: "Run operation is not a product bulk sync" }, { status: 400 });
  }

  if (runSystem !== requestedSystem) {
    return NextResponse.json(
      { error: `Continuation system mismatch. Expected ${runSystem}.` },
      { status: 400 },
    );
  }

  if (run.status !== "RUNNING") {
    return NextResponse.json({
      system: runSystem,
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

  const system = systemFromOperation(run.operation);
  if (!system) {
    return NextResponse.json({ error: "Run operation is not a product bulk sync" }, { status: 400 });
  }

  const frozenIds = run.targetIds as string[] | null;
  if (!frozenIds || frozenIds.length === 0) {
    await prisma.hubSpotSyncRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return NextResponse.json({
      system,
      runId,
      status: "COMPLETED",
      itemsCreated: 0,
      itemsSkipped: 0,
      itemsFailed: 0,
      remaining: 0,
    });
  }

  const targetIdsForChunk = afterCursor
    ? frozenIds.filter((id) => id > afterCursor).slice(0, CHUNK_SIZE)
    : frozenIds.slice(0, CHUNK_SIZE);

  if (targetIdsForChunk.length === 0) {
    const finalizedRun = await prisma.hubSpotSyncRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return NextResponse.json({
      system,
      runId,
      status: "COMPLETED",
      itemsCreated: finalizedRun.itemsCreated,
      itemsSkipped: finalizedRun.itemsSkipped,
      itemsFailed: finalizedRun.itemsFailed,
      remaining: 0,
    });
  }

  const skus = await prisma.internalProduct.findMany({
    where: { id: { in: targetIdsForChunk }, isActive: true },
    include: SKU_INCLUDE,
    orderBy: { id: "asc" },
  });

  let chunkCreated = 0;
  let chunkSkipped = 0;
  let chunkFailed = 0;

  const chunkOutcomes: Array<{
    internalProductId: string;
    brand: string;
    model: string;
    status: "created" | "skipped" | "failed";
    reason?: string;
    externalId?: string;
  }> = [];

  const linkField = SYSTEM_FIELD_BY_SYSTEM[system];

  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i] as SkuRecord;

    if (sku[linkField]) {
      chunkSkipped += 1;
      chunkOutcomes.push({
        internalProductId: sku.id,
        brand: sku.brand,
        model: sku.model,
        status: "skipped",
        reason: `Already has ${system} ID`,
      });
      await updateRunProgress(runId, { skipped: 1 });
      if (i < skus.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, ITEM_DELAY_MS));
      }
      continue;
    }

    const syncResult = await withHubSpotRetry(
      () => EXECUTE_BY_SYSTEM[system](sku, buildCreatePreview(system)),
      `BulkSync(${system}:${sku.brand} ${sku.model})`,
    );

    if (!syncResult.ok) {
      chunkFailed += 1;
      chunkOutcomes.push({
        internalProductId: sku.id,
        brand: sku.brand,
        model: sku.model,
        status: "failed",
        reason: syncResult.error,
      });
      await updateRunProgress(runId, { failed: 1 });
      if (i < skus.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, ITEM_DELAY_MS));
      }
      continue;
    }

    const outcome = syncResult.data;
    const normalizedStatus = classifyOutcomeStatus(outcome.status);

    if (normalizedStatus === "created") {
      chunkCreated += 1;
      await updateRunProgress(runId, { created: 1 });
    } else if (normalizedStatus === "skipped") {
      chunkSkipped += 1;
      await updateRunProgress(runId, { skipped: 1 });
    } else {
      chunkFailed += 1;
      await updateRunProgress(runId, { failed: 1 });
    }

    chunkOutcomes.push({
      internalProductId: sku.id,
      brand: sku.brand,
      model: sku.model,
      status: normalizedStatus,
      reason: outcome.message,
      externalId: outcome.externalId || undefined,
    });

    if (i < skus.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, ITEM_DELAY_MS));
    }
  }

  const processedIds = new Set(skus.map((sku) => sku.id));
  for (const missingId of targetIdsForChunk) {
    if (processedIds.has(missingId)) continue;

    chunkSkipped += 1;
    chunkOutcomes.push({
      internalProductId: missingId,
      brand: "",
      model: "",
      status: "skipped",
      reason: "Product no longer exists or is inactive",
    });
    await updateRunProgress(runId, { skipped: 1 });
  }

  const lastProcessedId = targetIdsForChunk[targetIdsForChunk.length - 1];
  const remaining = frozenIds.filter((id) => id > lastProcessedId).length;

  const runWithCursor = await prisma.hubSpotSyncRun.update({
    where: { id: runId },
    data: { cursor: lastProcessedId, updatedAt: new Date() },
  });

  if (remaining === 0) {
    const finalRun = await prisma.hubSpotSyncRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    return NextResponse.json({
      system,
      runId,
      status: "COMPLETED",
      chunkOutcomes,
      chunkCreated,
      chunkSkipped,
      chunkFailed,
      itemsCreated: finalRun.itemsCreated,
      itemsSkipped: finalRun.itemsSkipped,
      itemsFailed: finalRun.itemsFailed,
      remaining: 0,
    });
  }

  const continuation = buildContinuationToken({
    runId,
    tokenHash,
    cursor: lastProcessedId,
    executedBy: userEmail,
  });

  return NextResponse.json({
    system,
    runId,
    status: "RUNNING",
    chunkOutcomes,
    chunkCreated,
    chunkSkipped,
    chunkFailed,
    itemsCreated: runWithCursor.itemsCreated,
    itemsSkipped: runWithCursor.itemsSkipped,
    itemsFailed: runWithCursor.itemsFailed,
    remaining,
    cursor: lastProcessedId,
    continuationToken: continuation.continuationToken,
    continuationIssuedAt: continuation.issuedAt,
    continuationExpiresAt: continuation.expiresAt,
  });
}
