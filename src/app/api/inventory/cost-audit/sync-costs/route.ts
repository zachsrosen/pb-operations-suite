/**
 * Cost Audit — Bulk Sync Costs
 *
 * POST /api/inventory/cost-audit/sync-costs
 *   Updates Zoho item `purchase_rate` to match the latest vendor bill price
 *   for the requested item IDs, and mirrors the new cost to the linked
 *   InternalProduct.unitCost. Server is authoritative for the price — clients
 *   only specify which itemIds to sync; the server resolves latestBillPrice
 *   from the same audit logic the dashboard reads from.
 *
 *   Body:
 *     {
 *       itemIds: string[],          // Zoho item IDs to update
 *       days?: number,               // Audit window (default 90, max 365)
 *       dateStart?, dateEnd?: string // Window override (YYYY-MM-DD)
 *     }
 *
 *   Auth: ADMIN, OWNER, or PROJECT_MANAGER.
 *
 *   Returns { updated, skipped, failed, results: [{ itemId, status, ... }] }
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { tagSentryRequest } from "@/lib/sentry-request";
import { prisma, getUserByEmail, logActivity } from "@/lib/db";
import { zohoInventory } from "@/lib/zoho-inventory";
import { runCostAudit, parseAuditOptions, clearAuditCache } from "../route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_ROLES = new Set(["ADMIN", "OWNER", "PROJECT_MANAGER"]);

interface SyncResult {
  itemId: string;
  status: "updated" | "no_change" | "no_bill_data" | "not_found" | "failed";
  oldCost: number | null;
  newCost: number | null;
  internalProductSynced: boolean;
  message?: string;
}

export async function POST(request: NextRequest) {
  tagSentryRequest(request);

  // ── Auth ─────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user || !user.roles?.some((r) => ALLOWED_ROLES.has(r))) {
    return NextResponse.json(
      { error: "Cost sync requires ADMIN, OWNER, or PROJECT_MANAGER role" },
      { status: 403 },
    );
  }
  // Capture for closures inside the bounded-concurrency worker
  const userId = user.id;
  const userEmail = user.email;
  const userName = user.name || undefined;

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      {
        error: "Zoho Inventory is not configured",
        missing: zohoInventory.getMissingConfig(),
      },
      { status: 503 },
    );
  }

  let body: { itemIds?: unknown; days?: unknown; dateStart?: unknown; dateEnd?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (itemIds.length === 0) {
    return NextResponse.json({ error: "itemIds[] is required and must be non-empty" }, { status: 400 });
  }
  if (itemIds.length > 500) {
    return NextResponse.json({ error: "Maximum 500 items per sync request" }, { status: 400 });
  }

  // Build a URLSearchParams-shaped object so we can reuse parseAuditOptions
  const sp = new URLSearchParams();
  if (typeof body.days === "number") sp.set("days", String(body.days));
  if (typeof body.dateStart === "string") sp.set("dateStart", body.dateStart);
  if (typeof body.dateEnd === "string") sp.set("dateEnd", body.dateEnd);
  const auditOptions = parseAuditOptions(sp);

  try {
    // ── 1. Resolve latest bill price per requested item via the audit ──
    const audit = await runCostAudit(auditOptions);
    const rowByItemId = new Map(audit.rows.map((r) => [r.itemId, r]));

    // ── 2. Apply updates with bounded concurrency ──────────────────────
    const results: SyncResult[] = [];
    const requested = new Set(itemIds);
    let cursor = 0;
    const idArray = Array.from(requested);

    async function worker() {
      while (cursor < idArray.length) {
        const idx = cursor++;
        const itemId = idArray[idx];
        const row = rowByItemId.get(itemId);
        if (!row) {
          results.push({
            itemId,
            status: "no_bill_data",
            oldCost: null,
            newCost: null,
            internalProductSynced: false,
            message: "No bill data in selected window",
          });
          continue;
        }
        const newCost = row.latestBillPrice;
        if (newCost == null || !Number.isFinite(newCost) || newCost <= 0) {
          results.push({
            itemId,
            status: "no_bill_data",
            oldCost: row.storedCost,
            newCost: null,
            internalProductSynced: false,
            message: "Latest bill price unavailable",
          });
          continue;
        }
        // Skip when already matching to within $0.01 — cheap and avoids no-op writes
        if (row.storedCost != null && Math.abs(row.storedCost - newCost) < 0.01) {
          results.push({
            itemId,
            status: "no_change",
            oldCost: row.storedCost,
            newCost,
            internalProductSynced: false,
            message: "Cost already matches latest bill",
          });
          continue;
        }

        try {
          const zohoResult = await zohoInventory.updateItem(itemId, {
            purchase_rate: newCost,
          });
          if (zohoResult.status === "not_found") {
            results.push({
              itemId,
              status: "not_found",
              oldCost: row.storedCost,
              newCost: null,
              internalProductSynced: false,
              message: zohoResult.message,
            });
            continue;
          }
          if (zohoResult.status !== "updated") {
            results.push({
              itemId,
              status: "failed",
              oldCost: row.storedCost,
              newCost: null,
              internalProductSynced: false,
              message: zohoResult.message,
            });
            continue;
          }

          // Mirror to InternalProduct.unitCost when linked. Non-fatal on error.
          let internalSynced = false;
          if (prisma && row.internalProductId) {
            try {
              await prisma.internalProduct.update({
                where: { id: row.internalProductId },
                data: { unitCost: newCost },
              });
              internalSynced = true;
            } catch (err) {
              Sentry.captureException(err, {
                tags: { route: "sync-costs", phase: "internal-product", item_id: itemId },
              });
            }
          }

          // Audit log — uses CATALOG_PRODUCT_UPDATED (closest existing enum)
          try {
            await logActivity({
              type: "CATALOG_PRODUCT_UPDATED",
              description: `Cost synced from latest bill: ${row.name} ($${row.storedCost?.toFixed(2) ?? "—"} → $${newCost.toFixed(2)})`,
              userId,
              userEmail,
              userName,
              entityType: "ZohoItem",
              entityId: itemId,
              entityName: row.name,
              metadata: {
                source: "cost-audit-bulk-sync",
                zohoItemId: itemId,
                internalProductId: row.internalProductId,
                oldCost: row.storedCost,
                newCost,
                latestBillDate: row.latestBillDate,
                latestBillVendor: row.latestBillVendor,
                billCountInWindow: row.billCount,
                internalProductSynced: internalSynced,
              },
            });
          } catch (err) {
            // Activity log failure shouldn't fail the sync
            Sentry.captureException(err, { tags: { route: "sync-costs", phase: "log" } });
          }

          results.push({
            itemId,
            status: "updated",
            oldCost: row.storedCost,
            newCost,
            internalProductSynced: internalSynced,
          });
        } catch (err) {
          results.push({
            itemId,
            status: "failed",
            oldCost: row.storedCost,
            newCost: null,
            internalProductSynced: false,
            message: err instanceof Error ? err.message : "Unknown error",
          });
          Sentry.captureException(err, { tags: { route: "sync-costs", item_id: itemId } });
        }
      }
    }

    // Bounded concurrency — same as bill detail fetch ceiling
    const workers = Array.from(
      { length: Math.min(4, idArray.length) },
      () => worker(),
    );
    await Promise.all(workers);

    // Bust the audit cache so the next dashboard refresh reads fresh costs
    clearAuditCache();

    const summary = results.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      {} as Record<SyncResult["status"], number>,
    );

    return NextResponse.json({
      requested: idArray.length,
      updated: summary.updated || 0,
      noChange: summary.no_change || 0,
      noBillData: summary.no_bill_data || 0,
      notFound: summary.not_found || 0,
      failed: summary.failed || 0,
      results,
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { route: "/api/inventory/cost-audit/sync-costs" } });
    const message = error instanceof Error ? error.message : "Bulk sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
