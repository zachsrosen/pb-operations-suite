/**
 * Inventory Cost Audit API
 *
 * GET /api/inventory/cost-audit?days=90&maxBills=1000&refresh=1
 *   Cross-references Zoho item purchase_rate (stored cost) against actual
 *   line-item rates from recent vendor bills, and surfaces variance per item.
 *
 *   Query params:
 *     - days       (default 90, max 365)   Window of bills to scan, ending today
 *     - dateStart  (YYYY-MM-DD)            Override start date (takes precedence over days)
 *     - dateEnd    (YYYY-MM-DD)            Override end date
 *     - maxBills   (default 1500, max 5000) Safety cap on bills fetched
 *     - refresh    (any truthy value)      Bypass module cache
 *
 *   Returns { dateStart, dateEnd, billsScanned, itemsAnalyzed, unmatchedLineItems,
 *             rows, unmatchedRows, lastUpdated }
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import {
  zohoInventory,
  type ZohoBillRecord,
  type ZohoBillLineItem,
  type ZohoInventoryItem,
} from "@/lib/zoho-inventory";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ── Module-level result cache (keyed by date range) ─────────────────────
interface AuditCacheEntry {
  payload: AuditPayload;
  expiresAt: number;
}
const AUDIT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const _auditCache = new Map<string, AuditCacheEntry>();

interface ItemRow {
  itemId: string;
  name: string;
  sku: string | null;
  vendor: string | null;
  category: string | null;
  storedCost: number | null;
  storedPrice: number | null;
  latestBillDate: string | null;
  latestBillPrice: number | null;
  latestBillVendor: string | null;
  avgBillPrice: number; // qty-weighted
  minBillPrice: number;
  maxBillPrice: number;
  billCount: number;
  totalQty: number;
  variancePct: number | null; // (latest - stored) / stored * 100
  varianceAbs: number | null; // |latest - stored|
  status: "match" | "mismatch" | "no_stored_cost" | "large_swing";
}

interface UnmatchedRow {
  description: string;
  vendor: string | null;
  latestDate: string;
  billCount: number;
  totalQty: number;
  avgRate: number;
}

interface AuditPayload {
  dateStart: string;
  dateEnd: string;
  billsScanned: number;
  billsWithErrors: number;
  itemsAnalyzed: number;
  unmatchedLineItems: number;
  rows: ItemRow[];
  unmatchedRows: UnmatchedRow[];
  lastUpdated: string;
}

const MATCH_TOLERANCE_PCT = 2; // <2% diff = match
const LARGE_SWING_PCT = 25; // >25% diff = large_swing

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function classify(stored: number | null, latest: number | null): ItemRow["status"] {
  if (stored == null || stored === 0) return "no_stored_cost";
  if (latest == null) return "no_stored_cost";
  const pct = Math.abs(((latest - stored) / stored) * 100);
  if (pct < MATCH_TOLERANCE_PCT) return "match";
  if (pct >= LARGE_SWING_PCT) return "large_swing";
  return "mismatch";
}

/**
 * Fetch bill detail for a list of bill IDs with bounded concurrency.
 * Zoho's concurrent-request ceiling is low, so we cap at 4 in-flight.
 */
async function fetchBillDetailsConcurrent(
  billIds: string[],
  concurrency = 4,
): Promise<{ bills: ZohoBillRecord[]; errors: number }> {
  const out: ZohoBillRecord[] = [];
  let errors = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < billIds.length) {
      const idx = cursor++;
      const id = billIds[idx];
      try {
        const bill = await zohoInventory.getBill(id);
        if (bill) out.push(bill);
        else errors += 1;
      } catch (err) {
        errors += 1;
        Sentry.captureException(err, { tags: { route: "cost-audit", bill_id: id } });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, billIds.length) }, () => worker());
  await Promise.all(workers);
  return { bills: out, errors };
}

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    if (!zohoInventory.isConfigured()) {
      return NextResponse.json(
        {
          error: "Zoho Inventory is not configured",
          missing: zohoInventory.getMissingConfig(),
        },
        { status: 503 },
      );
    }

    const { searchParams } = request.nextUrl;
    const refresh = !!searchParams.get("refresh");

    // Parse window
    let dateStart: string;
    let dateEnd: string;
    const dateStartParam = searchParams.get("dateStart");
    const dateEndParam = searchParams.get("dateEnd");
    if (dateStartParam || dateEndParam) {
      const today = fmtDate(new Date());
      dateEnd = dateEndParam || today;
      dateStart = dateStartParam || dateEnd;
    } else {
      const daysParam = Number(searchParams.get("days") || "90");
      const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 365) : 90;
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - days);
      dateStart = fmtDate(start);
      dateEnd = fmtDate(end);
    }

    const maxBillsParam = Number(searchParams.get("maxBills") || "1500");
    const maxBills = Number.isFinite(maxBillsParam)
      ? Math.min(Math.max(maxBillsParam, 1), 5000)
      : 1500;

    const cacheKey = `${dateStart}:${dateEnd}:${maxBills}`;
    if (!refresh) {
      const hit = _auditCache.get(cacheKey);
      if (hit && Date.now() < hit.expiresAt) {
        return NextResponse.json({ ...hit.payload, cached: true });
      }
    }

    // ── 1. Fetch bills + items in parallel ───────────────────────────
    const [billSummaries, items] = await Promise.all([
      zohoInventory.listBills({ dateStart, dateEnd, maxResults: maxBills }),
      zohoInventory.listItems(),
    ]);

    // ── 2. Filter to non-void bills, fetch line items ─────────────────
    const usableBills = billSummaries.filter((b) => {
      const status = (b.status || "").toLowerCase();
      return status !== "void" && status !== "draft";
    });

    const { bills, errors: billErrors } = await fetchBillDetailsConcurrent(
      usableBills.map((b) => b.bill_id),
    );

    // ── 3. Aggregate per item_id ─────────────────────────────────────
    interface Agg {
      lines: Array<{ rate: number; qty: number; date: string; vendor: string | null }>;
      totalQty: number;
      weightedRateSum: number; // Σ rate*qty
      latestDate: string;
      latestRate: number;
      latestVendor: string | null;
      minRate: number;
      maxRate: number;
    }
    const itemAgg = new Map<string, Agg>();
    const unmatchedAgg = new Map<
      string,
      { vendor: string | null; latestDate: string; count: number; rateSum: number; qty: number }
    >();
    let unmatchedLineItems = 0;

    for (const bill of bills) {
      const billDate = bill.date || "";
      const vendor = bill.vendor_name || null;
      for (const li of bill.line_items as ZohoBillLineItem[]) {
        const rate = Number(li.rate);
        const qty = Number(li.quantity);
        if (!Number.isFinite(rate) || rate <= 0) continue;
        if (!Number.isFinite(qty) || qty <= 0) continue;

        const itemId = (li.item_id || "").trim();
        if (!itemId) {
          // Free-text bill line — track separately
          unmatchedLineItems += 1;
          const desc = (li.name || li.description || "").trim();
          if (!desc) continue;
          const key = desc.toLowerCase();
          const cur = unmatchedAgg.get(key);
          if (cur) {
            cur.count += 1;
            cur.rateSum += rate;
            cur.qty += qty;
            if (billDate > cur.latestDate) {
              cur.latestDate = billDate;
              cur.vendor = vendor;
            }
          } else {
            unmatchedAgg.set(key, {
              vendor,
              latestDate: billDate,
              count: 1,
              rateSum: rate,
              qty,
            });
          }
          continue;
        }

        const cur = itemAgg.get(itemId);
        if (cur) {
          cur.lines.push({ rate, qty, date: billDate, vendor });
          cur.totalQty += qty;
          cur.weightedRateSum += rate * qty;
          if (rate < cur.minRate) cur.minRate = rate;
          if (rate > cur.maxRate) cur.maxRate = rate;
          if (billDate > cur.latestDate) {
            cur.latestDate = billDate;
            cur.latestRate = rate;
            cur.latestVendor = vendor;
          }
        } else {
          itemAgg.set(itemId, {
            lines: [{ rate, qty, date: billDate, vendor }],
            totalQty: qty,
            weightedRateSum: rate * qty,
            latestDate: billDate,
            latestRate: rate,
            latestVendor: vendor,
            minRate: rate,
            maxRate: rate,
          });
        }
      }
    }

    // ── 4. Join with item catalog → rows ─────────────────────────────
    const itemById = new Map<string, ZohoInventoryItem>();
    for (const i of items) itemById.set(i.item_id, i);

    const rows: ItemRow[] = [];
    for (const [itemId, agg] of itemAgg) {
      const item = itemById.get(itemId);
      if (!item) continue; // Item deleted from catalog — skip silently
      const storedCost = typeof item.purchase_rate === "number" ? item.purchase_rate : null;
      const storedPrice = typeof item.rate === "number" ? item.rate : null;
      const latestBillPrice = agg.latestRate;
      const avgBillPrice = agg.totalQty > 0 ? agg.weightedRateSum / agg.totalQty : 0;
      const variancePct =
        storedCost != null && storedCost !== 0
          ? ((latestBillPrice - storedCost) / storedCost) * 100
          : null;
      const varianceAbs = storedCost != null ? latestBillPrice - storedCost : null;
      rows.push({
        itemId,
        name: item.name,
        sku: item.sku || null,
        vendor: agg.latestVendor || item.vendor_name || null,
        category: item.category_name || item.group_name || null,
        storedCost,
        storedPrice,
        latestBillDate: agg.latestDate || null,
        latestBillPrice,
        latestBillVendor: agg.latestVendor,
        avgBillPrice,
        minBillPrice: agg.minRate,
        maxBillPrice: agg.maxRate,
        billCount: agg.lines.length,
        totalQty: agg.totalQty,
        variancePct,
        varianceAbs,
        status: classify(storedCost, latestBillPrice),
      });
    }

    // Sort by absolute variance pct desc — biggest mismatches first.
    // No-stored-cost rows go to the bottom of the active sort (null pct).
    rows.sort((a, b) => {
      const aPct = a.variancePct == null ? -1 : Math.abs(a.variancePct);
      const bPct = b.variancePct == null ? -1 : Math.abs(b.variancePct);
      return bPct - aPct;
    });

    const unmatchedRows: UnmatchedRow[] = Array.from(unmatchedAgg.entries())
      .map(([key, v]) => ({
        description: key,
        vendor: v.vendor,
        latestDate: v.latestDate,
        billCount: v.count,
        totalQty: v.qty,
        avgRate: v.count > 0 ? v.rateSum / v.count : 0,
      }))
      .sort((a, b) => b.billCount - a.billCount)
      .slice(0, 100); // Cap unmatched detail at 100 rows

    const payload: AuditPayload = {
      dateStart,
      dateEnd,
      billsScanned: bills.length,
      billsWithErrors: billErrors,
      itemsAnalyzed: rows.length,
      unmatchedLineItems,
      rows,
      unmatchedRows,
      lastUpdated: new Date().toISOString(),
    };

    _auditCache.set(cacheKey, { payload, expiresAt: Date.now() + AUDIT_CACHE_TTL_MS });

    return NextResponse.json({ ...payload, cached: false });
  } catch (error) {
    Sentry.captureException(error, { tags: { route: "/api/inventory/cost-audit" } });
    const message = error instanceof Error ? error.message : "Cost audit failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
