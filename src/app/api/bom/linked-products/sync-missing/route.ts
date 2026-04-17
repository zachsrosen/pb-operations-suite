import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma, getUserByEmail } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { isCatalogSyncEnabled } from "@/lib/catalog-sync-confirmation";
import { EquipmentCategory } from "@/generated/prisma/enums";
import {
  validateBulkSyncToken,
  hashToken,
  computeDealSyncChangesHash,
  withHubSpotRetry,
} from "@/lib/bulk-sync-confirmation";
import {
  fetchLineItemsForDeal,
  createOrUpdateHubSpotProduct,
  createDealLineItem,
  type LineItem,
} from "@/lib/hubspot";
import { tokenize, tokenSimilarity } from "@/lib/token-similarity";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);
const MATCH_THRESHOLD = 0.45;
const ITEM_DELAY_MS = 200;
const STALE_LOCK_MS = 15 * 60 * 1000; // 15 minutes

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface BomItem {
  category: string;
  brand: string | null;
  model: string | null;
  description: string;
  qty: number | string;
  unitSpec?: number | string | null;
  unitLabel?: string | null;
}

interface PreviewResult {
  missing: BomItem[];
  matched: Array<{
    bomItem: BomItem;
    lineItem: { id: string; name: string; sku: string };
    score: number;
  }>;
  changesHash: string;
}

interface ExecuteOutcome {
  item: BomItem;
  status: "created" | "skipped" | "failed";
  reason?: string;
  lineItemId?: string;
  hubspotProductId?: string;
}

// ──────────────────────────────────────────────
// Diff logic
// ──────────────────────────────────────────────

function diffBomVsLineItems(
  bomItems: BomItem[],
  lineItems: LineItem[],
): PreviewResult {
  const matched: PreviewResult["matched"] = [];
  const missing: BomItem[] = [];

  for (const bomItem of bomItems) {
    const bomTokens = new Set([
      ...tokenize(bomItem.brand),
      ...tokenize(bomItem.model),
      ...tokenize(bomItem.description),
    ]);

    let bestMatch: { lineItem: LineItem; score: number } | null = null;
    for (const li of lineItems) {
      const liTokens = new Set([
        ...tokenize(li.name),
        ...tokenize(li.description),
        ...tokenize(li.sku),
      ]);
      const score = tokenSimilarity(bomTokens, liTokens);
      if (score >= MATCH_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { lineItem: li, score };
      }
    }

    if (bestMatch) {
      matched.push({
        bomItem,
        lineItem: {
          id: bestMatch.lineItem.id,
          name: bestMatch.lineItem.name,
          sku: bestMatch.lineItem.sku,
        },
        score: Math.round(bestMatch.score * 100) / 100,
      });
    } else {
      missing.push(bomItem);
    }
  }

  const changesHash = computeDealSyncChangesHash(
    "", // dealId is bound separately in the token
    missing,
  );

  return { missing, matched, changesHash };
}

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

// ──────────────────────────────────────────────
// Preview
// ──────────────────────────────────────────────

async function handlePreview(body: Record<string, unknown>) {
  const dealId = String(body.dealId || "").trim();
  const items = body.items as BomItem[] | undefined;

  if (!dealId) {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  let existingLineItems: LineItem[];
  try {
    existingLineItems = await fetchLineItemsForDeal(dealId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch line items" },
      { status: 502 },
    );
  }

  const diff = diffBomVsLineItems(items, existingLineItems);

  return NextResponse.json({
    dealId,
    missing: diff.missing,
    matched: diff.matched,
    missingCount: diff.missing.length,
    matchedCount: diff.matched.length,
    existingLineItemCount: existingLineItems.length,
    changesHash: diff.changesHash,
  });
}

// ──────────────────────────────────────────────
// Execute
// ──────────────────────────────────────────────

async function handleExecute(body: Record<string, unknown>, userEmail: string) {
  // Role check
  const dbUser = await getUserByEmail(userEmail);
  const role = (ROLES[((dbUser?.role ?? "VIEWER") as UserRole)]?.normalizesTo ?? ((dbUser?.role ?? "VIEWER") as UserRole));
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  const dealId = String(body.dealId || "").trim();
  const items = body.items as BomItem[] | undefined;
  const token = String(body.token || "").trim();
  const issuedAt = Number(body.issuedAt) || 0;
  const changesHash = String(body.changesHash || "").trim();

  if (!dealId || !token || !issuedAt || !changesHash) {
    return NextResponse.json(
      { error: "dealId, items, token, issuedAt, and changesHash are required" },
      { status: 400 },
    );
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  // Server-side recompute: re-diff to get fresh changesHash
  let confirmLineItems: LineItem[];
  try {
    confirmLineItems = await fetchLineItemsForDeal(dealId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch line items" },
      { status: 502 },
    );
  }

  const freshDiff = diffBomVsLineItems(items, confirmLineItems);

  // Compare fresh hash to token-bound hash
  if (freshDiff.changesHash !== changesHash) {
    return NextResponse.json(
      {
        error: "Deal state has changed since preview. Please re-preview and confirm again.",
        freshHash: freshDiff.changesHash,
        tokenHash: changesHash,
      },
      { status: 409 },
    );
  }

  // Validate HMAC token against fresh hash
  const validation = validateBulkSyncToken({
    token,
    issuedAt,
    operation: "deal-line-item-sync",
    operationId: dealId,
    changesHash: freshDiff.changesHash,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 403 });
  }

  // DB-backed idempotency
  const tokenHashValue = hashToken(token);

  // Stale lock recovery
  await prisma.hubSpotSyncRun.updateMany({
    where: {
      operation: "deal-line-item-sync",
      operationId: dealId,
      status: "RUNNING",
      updatedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) },
    },
    data: {
      status: "FAILED",
      outcomes: { error: "Stale lock recovery — run exceeded 15 minute timeout" },
    },
  });

  let run;
  try {
    run = await prisma.hubSpotSyncRun.create({
      data: {
        tokenHash: tokenHashValue,
        operation: "deal-line-item-sync",
        operationId: dealId,
        status: "RUNNING",
        inputHash: freshDiff.changesHash,
        executedBy: userEmail,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);

    // Unique constraint on tokenHash → idempotent replay
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
          outcomes: existing.outcomes,
          idempotent: true,
        });
      }
    }

    // Partial unique index on (operation, operationId) WHERE status = 'RUNNING'
    if (msg.includes("Unique constraint") && msg.includes("running_lock")) {
      return NextResponse.json(
        { error: "A sync operation is already running for this deal. Please wait for it to complete." },
        { status: 409 },
      );
    }

    throw error;
  }

  // Process missing items
  const outcomes: ExecuteOutcome[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const bomItem of freshDiff.missing) {
    const outcome: ExecuteOutcome = { item: bomItem, status: "skipped" };

    try {
      // Look up InternalProduct by (category, brand, model)
      const categoryEnum = bomItem.category as EquipmentCategory;
      const validCategory = Object.values(EquipmentCategory).includes(categoryEnum);
      const sku = validCategory
        ? await prisma.internalProduct.findFirst({
            where: {
              category: categoryEnum,
              brand: bomItem.brand || "",
              model: bomItem.model || "",
              isActive: true,
            },
          })
        : null;

      if (!sku) {
        outcome.status = "skipped";
        outcome.reason = "No matching internal product";
        skipped++;
        outcomes.push(outcome);
        // Heartbeat update
        await prisma.hubSpotSyncRun.update({
          where: { id: run.id },
          data: { itemsSkipped: skipped, updatedAt: new Date() },
        });
        continue;
      }

      // Ensure HubSpot Product exists
      let hubspotProductId = sku.hubspotProductId;
      if (!hubspotProductId) {
        const productResult = await withHubSpotRetry(
          () =>
            createOrUpdateHubSpotProduct({
              brand: sku.brand,
              model: sku.model,
              description: sku.description || undefined,
              sku: sku.model,
              productCategory: sku.category,
              internalProductId: sku.id,
              zuperItemId: sku.zuperItemId || undefined,
              zohoItemId: sku.zohoItemId || undefined,
            }),
          `CreateProduct(${sku.brand} ${sku.model})`,
        );

        if (!productResult.ok) {
          outcome.status = "failed";
          outcome.reason = productResult.error;
          failed++;
          outcomes.push(outcome);
          await prisma.hubSpotSyncRun.update({
            where: { id: run.id },
            data: { itemsFailed: failed, updatedAt: new Date() },
          });
          continue;
        }

        hubspotProductId = productResult.data.hubspotProductId;

        // Guarded write-back
        await prisma.internalProduct.updateMany({
          where: { id: sku.id, hubspotProductId: null },
          data: { hubspotProductId },
        });
      }

      // Create line item linked to product
      const qty = Number(bomItem.qty) || 1;
      const lineItemResult = await withHubSpotRetry(
        () =>
          createDealLineItem({
            dealId,
            name: `${bomItem.brand || ""} ${bomItem.model || ""}`.trim() || bomItem.description,
            quantity: qty,
            description: bomItem.description || undefined,
            hubspotProductId,
          }),
        `CreateLineItem(${bomItem.brand} ${bomItem.model})`,
      );

      if (!lineItemResult.ok) {
        outcome.status = "failed";
        outcome.reason = lineItemResult.error;
        failed++;
      } else {
        outcome.status = "created";
        outcome.lineItemId = lineItemResult.data.lineItemId;
        outcome.hubspotProductId = hubspotProductId;
        created++;
      }
    } catch (error) {
      outcome.status = "failed";
      outcome.reason = error instanceof Error ? error.message : String(error);
      failed++;
    }

    outcomes.push(outcome);

    // Heartbeat update after each item
    await prisma.hubSpotSyncRun.update({
      where: { id: run.id },
      data: {
        itemsCreated: created,
        itemsSkipped: skipped,
        itemsFailed: failed,
        updatedAt: new Date(),
      },
    });

    // Rate limit delay between items
    if (outcomes.length < freshDiff.missing.length) {
      await new Promise((r) => setTimeout(r, ITEM_DELAY_MS));
    }
  }

  // Finalize run
  const finalStatus = failed > 0 && created === 0 ? "FAILED" : "COMPLETED";
  await prisma.hubSpotSyncRun.update({
    where: { id: run.id },
    data: {
      status: finalStatus,
      outcomes: JSON.parse(JSON.stringify(outcomes)),
      itemsCreated: created,
      itemsSkipped: skipped,
      itemsFailed: failed,
      completedAt: new Date(),
    },
  });

  return NextResponse.json({
    runId: run.id,
    status: finalStatus,
    added: outcomes.filter((o) => o.status === "created"),
    skipped: outcomes.filter((o) => o.status === "skipped"),
    errors: outcomes.filter((o) => o.status === "failed"),
    itemsCreated: created,
    itemsSkipped: skipped,
    itemsFailed: failed,
  });
}
