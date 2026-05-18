/**
 * Sales Order extractor.
 *
 * Resolves a deal's linked Zoho Sales Order and normalises the line-item
 * payload. Used by SalesOrderAnalyzer to detect SO-level findings
 * (P2 wrong customer / incomplete, P3 missing PW3, P4 missing inverter,
 * P5 scope mismatch, P7 PW3 legacy text, P8 PW3 generic SKU, P9 BS
 * description not specific).
 *
 * Lookup priority:
 *   1. ProjectBomSnapshot.zohoSoId  — the canonical link recorded when
 *      the BOM pipeline created the SO. Most reliable.
 *   2. Zoho list search by deal id / customer name — best-effort fallback
 *      for deals where the BOM snapshot doesn't have zohoSoId.
 *   3. null — analyzer no-ops.
 */

import { prisma } from "@/lib/db";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { NormalizedSalesOrder } from "@/lib/pe-crossref/types";

export async function fetchSalesOrder(
  dealId: string,
  dealName: string,
): Promise<NormalizedSalesOrder | null> {
  // Strategy 1 — BOM snapshot has the canonical zohoSoId
  const snapshot = await prisma.projectBomSnapshot.findFirst({
    where: { dealId, zohoSoId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { zohoSoId: true },
  });

  let so = null;
  if (snapshot?.zohoSoId) {
    so = await zohoInventory.getSalesOrderById(snapshot.zohoSoId).catch((err: unknown) => {
      console.warn(`[pe-crossref] fetchSalesOrder: BOM-linked SO ${snapshot.zohoSoId} fetch failed:`, err);
      return null;
    });
  }

  // Strategy 2 — list-search by dealId (Zoho reference_number field often
  // contains the HubSpot deal id when BOM pipeline created the SO).
  if (!so) {
    const list = await zohoInventory
      .listSalesOrders({ search: dealId, perPage: 5 })
      .catch((err: unknown) => {
        console.warn(`[pe-crossref] fetchSalesOrder: list-by-dealId failed:`, err);
        return null;
      });
    const first = list?.salesorders?.[0];
    if (first?.salesorder_id) {
      so = await zohoInventory.getSalesOrderById(first.salesorder_id).catch(() => null);
    }
  }

  // Strategy 3 — last-ditch: list-search by customer last name
  if (!so) {
    // Parse "PROJ-9542 | Brownell, Matt | 16578 W..." → "Brownell"
    const parts = dealName.split("|").map((p) => p.trim());
    const customerPart = parts[1] ?? "";
    const lastName = customerPart.split(",")[0]?.trim();
    if (lastName) {
      const list = await zohoInventory
        .listSalesOrders({ search: lastName, perPage: 5 })
        .catch(() => null);
      const first = list?.salesorders?.[0];
      if (first?.salesorder_id) {
        so = await zohoInventory.getSalesOrderById(first.salesorder_id).catch(() => null);
      }
    }
  }

  if (!so) return null;

  return {
    soNumber: so.salesorder_number,
    customerName: so.customer_name ?? "",
    lineItems: (so.line_items ?? []).map((li, idx) => ({
      index: idx,
      sku: li.sku ?? null,
      description: li.description ?? li.name ?? "",
      qty: li.quantity ?? 0,
    })),
  };
}
