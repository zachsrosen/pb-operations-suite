/**
 * HubSpot Invoices integration for payment-tracking.
 *
 * Each deal can have up to 5 milestone invoices (DA, CC, PTO, PE M1, PE M2).
 * Identifying which invoice represents which milestone:
 *
 *   - DA: line item product = "Layout Approval Invoice" (id 2421119808 / SKU INST_PV_3)
 *   - CC: line item product = "Construction Complete Invoice" (id 2416872282 / SKU INST_PV_2)
 *   - PE M1: hs_amount_billed === deal.pe_payment_ic (PE invoices have no
 *     identifying line item product, but the amount is auto-calculated and
 *     unique per deal)
 *   - PE M2: hs_amount_billed === deal.pe_payment_pc
 *   - PTO: not yet observed as a separate invoice record in sampled data;
 *     falls back to deal property pto_invoice_status
 *
 * Verified against PROJ-8979, PROJ-9456, PROJ-8724 on 2026-04-21.
 */

import { hubspotClient } from "@/lib/hubspot";
import type { InvoiceSummary, PaymentTrackingDeal } from "@/lib/payment-tracking-types";

// HubSpot product IDs that identify the milestone an invoice represents.
// Discovered via probe on 2026-04-21.
const PRODUCT_DA = "2421119808"; // Layout Approval Invoice
const PRODUCT_CC = "2416872282"; // Construction Complete Invoice

const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? "";

interface RawInvoice {
  id: string;
  properties: {
    hs_number?: string | null;
    hs_invoice_status?: string | null;
    hs_amount_billed?: string | null;
    hs_amount_paid?: string | null;
    hs_balance_due?: string | null;
    hs_invoice_date?: string | null;
    hs_due_date?: string | null;
    hs_payment_date?: string | null;
    hs_days_overdue?: string | null;
  };
  associations?: {
    "line items"?: { results?: { id: string }[] };
    line_items?: { results?: { id: string }[] };
    deals?: { results?: { id: string }[] };
  };
}

interface RawLineItem {
  id: string;
  properties: { hs_product_id?: string | null; amount?: string | null };
  associations?: {
    invoices?: { results?: { id: string }[] };
  };
}

const INVOICE_PROPS = [
  "hs_number",
  "hs_invoice_status",
  "hs_amount_billed",
  "hs_amount_paid",
  "hs_balance_due",
  "hs_invoice_date",
  "hs_due_date",
  "hs_payment_date",
  "hs_days_overdue",
];

function parseNum(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function moneyEqual(a: number | null, b: number | null, tolerance = 0.5): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) < tolerance;
}

function invoiceUrl(invoiceId: string): string {
  return PORTAL_ID
    ? `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-53/${invoiceId}`
    : `https://app.hubspot.com/contacts/_/record/0-53/${invoiceId}`;
}

function toSummary(inv: RawInvoice): InvoiceSummary {
  return {
    invoiceId: inv.id,
    number: inv.properties.hs_number ?? null,
    status: inv.properties.hs_invoice_status ?? null,
    amountBilled: parseNum(inv.properties.hs_amount_billed),
    amountPaid: parseNum(inv.properties.hs_amount_paid),
    balanceDue: parseNum(inv.properties.hs_balance_due),
    invoiceDate: inv.properties.hs_invoice_date ?? null,
    dueDate: inv.properties.hs_due_date ?? null,
    paymentDate: inv.properties.hs_payment_date ?? null,
    daysOverdue: parseNum(inv.properties.hs_days_overdue),
    hubspotUrl: invoiceUrl(inv.id),
  };
}

/**
 * Bulk-fetch invoices for a set of deal IDs and attach them to each deal,
 * keyed by milestone. Mutates the deals array in place; safe to call with
 * an empty list.
 *
 * Performance:
 *   - 1 batch read for deal→invoice associations (chunked at 100)
 *   - 1 batch read of invoice details (chunked at 100, with line-item assoc)
 *   - 1 batch read of line items for all distinct line item IDs
 *
 * Total HubSpot calls: O(N/100) per stage = ~5-10 calls for ~500 deals.
 */
export async function attachInvoicesToDeals(
  deals: PaymentTrackingDeal[]
): Promise<void> {
  if (deals.length === 0) return;

  // 1) Batch-fetch deal→invoice association IDs.
  const dealIds = deals.map((d) => d.dealId).filter(Boolean);
  if (dealIds.length === 0) return;

  // The associations v4 batch read endpoint can take up to 1000 IDs per call.
  const dealToInvoices = new Map<string, string[]>();
  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100);
    try {
      const resp = await hubspotClient.crm.associations.v4.batchApi.getPage(
        "deals",
        "invoices",
        { inputs: chunk.map((id) => ({ id })) }
      );
      for (const r of resp.results ?? []) {
        const rec = r as unknown as { _from?: { id?: string }; from?: { id?: string }; to?: Array<{ toObjectId?: number; id?: string }> };
        const fromId = rec._from?.id ?? rec.from?.id;
        const toIds = (rec.to ?? []).map((t) => String(t.toObjectId ?? t.id ?? ""))
          .filter((id) => id !== "");
        if (fromId) dealToInvoices.set(fromId, toIds);
      }
    } catch (err) {
      console.warn("[payment-tracking-invoices] deal→invoice assoc fetch failed:", (err as Error).message);
    }
  }

  // Collect every distinct invoice ID we need to read.
  const allInvoiceIds = Array.from(new Set(Array.from(dealToInvoices.values()).flat()));
  if (allInvoiceIds.length === 0) {
    console.log(`[payment-tracking-invoices] no invoices found for ${dealIds.length} deals`);
    return;
  }

  // 2) Batch-read invoice details + line item associations.
  const invoiceById = new Map<string, RawInvoice>();
  for (let i = 0; i < allInvoiceIds.length; i += 100) {
    const chunk = allInvoiceIds.slice(i, i + 100);
    try {
      const resp = await hubspotClient.crm.objects.batchApi.read(
        "invoices",
        {
          inputs: chunk.map((id) => ({ id })),
          properties: INVOICE_PROPS,
          propertiesWithHistory: [],
          // batchApi.read does NOT return associations. We fetch line item
          // associations in a separate v4 batch call below.
        }
      );
      for (const r of resp.results ?? []) {
        invoiceById.set(r.id, r as unknown as RawInvoice);
      }
    } catch (err) {
      console.warn("[payment-tracking-invoices] batch invoice read failed:", (err as Error).message);
    }
  }

  // 3) Fetch invoice→line item associations in batch.
  const invoiceToLineItems = new Map<string, string[]>();
  for (let i = 0; i < allInvoiceIds.length; i += 100) {
    const chunk = allInvoiceIds.slice(i, i + 100);
    try {
      const resp = await hubspotClient.crm.associations.v4.batchApi.getPage(
        "invoices",
        "line_items",
        { inputs: chunk.map((id) => ({ id })) }
      );
      for (const r of resp.results ?? []) {
        const rec = r as unknown as { _from?: { id?: string }; from?: { id?: string }; to?: Array<{ toObjectId?: number; id?: string }> };
        const fromId = rec._from?.id ?? rec.from?.id;
        const toIds = (rec.to ?? []).map((t) => String(t.toObjectId ?? t.id ?? ""))
          .filter((id) => id !== "");
        if (fromId) invoiceToLineItems.set(fromId, toIds);
      }
    } catch (err) {
      console.warn("[payment-tracking-invoices] line item assoc fetch failed:", (err as Error).message);
    }
  }

  // 4) Batch-read line items to get product IDs.
  const allLineItemIds = Array.from(
    new Set(Array.from(invoiceToLineItems.values()).flat())
  );
  const lineItemById = new Map<string, RawLineItem>();
  for (let i = 0; i < allLineItemIds.length; i += 100) {
    const chunk = allLineItemIds.slice(i, i + 100);
    try {
      const resp = await hubspotClient.crm.lineItems.batchApi.read({
        inputs: chunk.map((id) => ({ id })),
        properties: ["hs_product_id", "amount"],
        propertiesWithHistory: [],
      });
      for (const r of resp.results ?? []) {
        lineItemById.set(r.id, r as unknown as RawLineItem);
      }
    } catch (err) {
      console.warn("[payment-tracking-invoices] batch line item read failed:", (err as Error).message);
    }
  }

  // 5) Map each deal's invoices to milestones.
  let attachedCount = 0;
  for (const deal of deals) {
    const invIds = dealToInvoices.get(deal.dealId) ?? [];
    if (invIds.length === 0) continue;

    const dealInvoices: NonNullable<PaymentTrackingDeal["invoices"]> = {};

    for (const invId of invIds) {
      const inv = invoiceById.get(invId);
      if (!inv) continue;

      // Try line item product matching first (DA, CC).
      const liIds = invoiceToLineItems.get(invId) ?? [];
      const productIds = liIds
        .map((id) => lineItemById.get(id)?.properties.hs_product_id)
        .filter(Boolean);

      let assigned = false;
      if (productIds.includes(PRODUCT_DA)) {
        dealInvoices.da = toSummary(inv);
        assigned = true;
      } else if (productIds.includes(PRODUCT_CC)) {
        dealInvoices.cc = toSummary(inv);
        assigned = true;
      }
      if (assigned) continue;

      // Fall back to amount-matching against PE payment fields. PE invoices
      // don't have a recognizable line item product; their amount equals the
      // auto-computed pe_payment_ic / pe_payment_pc on the deal.
      const billed = parseNum(inv.properties.hs_amount_billed);
      if (deal.peM1Amount !== null && moneyEqual(billed, deal.peM1Amount)) {
        dealInvoices.peM1 = toSummary(inv);
        continue;
      }
      if (deal.peM2Amount !== null && moneyEqual(billed, deal.peM2Amount)) {
        dealInvoices.peM2 = toSummary(inv);
        continue;
      }

      // Unmatched invoice. Most likely a PTO invoice (rare) or a custom
      // billing record. We don't expose it in v1 (would clutter the row);
      // could add an "other" bucket in a future iteration.
    }

    if (Object.keys(dealInvoices).length > 0) {
      deal.invoices = dealInvoices;
      attachedCount++;
    }
  }

  console.log(
    `[payment-tracking-invoices] attached invoices to ${attachedCount}/${deals.length} deals ` +
    `(${allInvoiceIds.length} invoices, ${allLineItemIds.length} line items)`
  );
}
