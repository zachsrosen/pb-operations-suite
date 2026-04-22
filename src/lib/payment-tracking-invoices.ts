/**
 * HubSpot Invoices integration for payment-tracking.
 *
 * Each deal can have up to 5 milestone invoices (DA, CC, PTO, PE M1, PE M2).
 * Each milestone is identified by the LINE ITEM NAME on the invoice. Verified
 * against PROJ-8979, PROJ-9456, PROJ-8724, PROJ-8476, PROJ-6860 on 2026-04-21:
 *
 *   - DA:    line item name contains "Layout Approval Invoice"
 *   - CC:    line item name contains "Construction Complete Invoice"
 *   - PTO:   line item name contains "Permission to Operate"
 *   - PE M1: line item name contains "Participate Energy - M1"
 *   - PE M2: line item name contains "Participate Energy - M2"
 *
 * One invoice may contain multiple line items — e.g., a PE invoice typically
 * has both "Participate Energy - M1" AND "Participate Energy Markup" line
 * items totaling hs_amount_billed. The milestone is identified by the M1/M2
 * line item; markup/change-order line items are part of the same invoice's
 * total.
 *
 * Line items WITHOUT a product reference (PTO, PE M1, PE M2, change orders)
 * still have their `name` field populated, so name-based matching covers all
 * cases.
 */

import { hubspotClient } from "@/lib/hubspot";
import type { InvoiceSummary, PaymentTrackingDeal } from "@/lib/payment-tracking-types";

// Milestone keys; matches PaymentTrackingDeal.invoices keys.
type MilestoneKey = "da" | "cc" | "pto" | "peM1" | "peM2";

// Line-item-name patterns that identify each milestone. Substring matching
// (case-insensitive) so PB can rename the prefix later without breaking us.
const MILESTONE_PATTERNS: Array<[MilestoneKey, RegExp]> = [
  ["da", /layout approval/i],
  ["cc", /construction complete/i],
  ["pto", /permission to operate/i],
  ["peM1", /participate energy.*m1\b/i],
  ["peM2", /participate energy.*m2\b/i],
];

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
  properties: {
    name?: string | null;
    hs_product_id?: string | null;
    amount?: string | null;
  };
  associations?: {
    invoices?: { results?: { id: string }[] };
  };
}

function classifyLineItemName(name: string | null | undefined): MilestoneKey | null {
  if (!name) return null;
  for (const [key, pattern] of MILESTONE_PATTERNS) {
    if (pattern.test(name)) return key;
  }
  return null;
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
  // HubSpot Commerce Invoices live at /payments/{portalId}/invoices/{id}
  // (NOT /contacts/.../record/0-53/...; that pattern is for some other types
  // and was returning 404s for the Accounting team).
  return PORTAL_ID
    ? `https://app.hubspot.com/payments/${PORTAL_ID}/invoices/${invoiceId}`
    : `https://app.hubspot.com/payments/_/invoices/${invoiceId}`;
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
        properties: ["name", "hs_product_id", "amount"],
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

      // Match by line item name. An invoice may contain multiple line items
      // (e.g., PE invoices have both "Participate Energy - M1" and
      // "Participate Energy Markup"). The first milestone-tagged line item
      // wins — markup / change order line items don't tag a milestone.
      const liIds = invoiceToLineItems.get(invId) ?? [];
      let matched: MilestoneKey | null = null;
      for (const liId of liIds) {
        const li = lineItemById.get(liId);
        const key = classifyLineItemName(li?.properties.name);
        if (key) {
          matched = key;
          break;
        }
      }

      if (matched) {
        dealInvoices[matched] = toSummary(inv);
        continue;
      }

      // Defense-in-depth fallback: if no line item name matched (perhaps the
      // line items had no name, or PB renames the prefix), try matching the
      // invoice billed amount against PE payment fields. Drops in priority
      // because PE invoices already match by name above; this only catches
      // edge cases.
      const billed = parseNum(inv.properties.hs_amount_billed);
      if (deal.peM1Amount !== null && moneyEqual(billed, deal.peM1Amount)) {
        dealInvoices.peM1 = toSummary(inv);
        continue;
      }
      if (deal.peM2Amount !== null && moneyEqual(billed, deal.peM2Amount)) {
        dealInvoices.peM2 = toSummary(inv);
        continue;
      }

      // Truly unmatched invoice — a custom billing record we don't recognize.
      // Skip silently in v1.
    }

    if (Object.keys(dealInvoices).length > 0) {
      deal.invoices = dealInvoices;
      attachedCount++;
      // Re-derive money fields using invoice amounts (truer than deal-property
      // amounts, which are sometimes null even when the milestone is paid).
      reconcileMoneyWithInvoices(deal);
    }
  }

  console.log(
    `[payment-tracking-invoices] attached invoices to ${attachedCount}/${deals.length} deals ` +
    `(${allInvoiceIds.length} invoices, ${allLineItemIds.length} line items)`
  );
}

/**
 * After invoices are attached, recompute customerCollected / customerOutstanding
 * / peBonusCollected / peBonusOutstanding / collectedPct using invoice amounts.
 *
 * Why: the original transformDeal calculation used deal-property amounts
 * (da_invoice_amount, cc_invoice_amount, pe_payment_ic, pe_payment_pc). For
 * deals where the deal-property amount is null but the invoice amount is real,
 * the % collected was computing as 0 even though the milestone was paid.
 *
 * Strategy per milestone:
 *   - If invoice attached AND has amountPaid > 0 → use invoice.amountPaid
 *   - Else if deal-property status is "Paid In Full" / "Paid" → use deal-property amount
 *   - Else → counts as 0
 */
function reconcileMoneyWithInvoices(deal: PaymentTrackingDeal): void {
  // Customer-side (DA + CC). PTO is amount-rare; treat as $0 unless invoice present.
  const daPaid =
    deal.invoices?.da?.amountPaid ??
    (deal.daStatus === "Paid In Full" ? deal.daAmount ?? 0 : 0);
  const ccPaid =
    deal.invoices?.cc?.amountPaid ??
    (deal.ccStatus === "Paid In Full" ? deal.ccAmount ?? 0 : 0);
  const ptoPaid = deal.invoices?.pto?.amountPaid ?? 0;

  // Customer billed total (denominator). Prefer the deal contract amount; if
  // invoices add up to more (e.g., change orders bumped contract), use that.
  const invoicedTotal =
    (deal.invoices?.da?.amountBilled ?? 0) +
    (deal.invoices?.cc?.amountBilled ?? 0) +
    (deal.invoices?.pto?.amountBilled ?? 0);
  const customerBilled = Math.max(deal.customerContractTotal, invoicedTotal);

  deal.customerContractTotal = customerBilled;
  deal.customerCollected = daPaid + ccPaid + ptoPaid;
  deal.customerOutstanding = Math.max(0, customerBilled - deal.customerCollected);

  // PE-side
  if (deal.isPE) {
    const m1Paid =
      deal.invoices?.peM1?.amountPaid ??
      (deal.peM1Status === "Paid" ? deal.peM1Amount ?? 0 : 0);
    const m2Paid =
      deal.invoices?.peM2?.amountPaid ??
      (deal.peM2Status === "Paid" ? deal.peM2Amount ?? 0 : 0);
    const peBilled =
      (deal.invoices?.peM1?.amountBilled ?? deal.peM1Amount ?? 0) +
      (deal.invoices?.peM2?.amountBilled ?? deal.peM2Amount ?? 0);
    deal.peBonusTotal = peBilled;
    deal.peBonusCollected = m1Paid + m2Paid;
    deal.peBonusOutstanding = Math.max(0, peBilled - (m1Paid + m2Paid));
  }

  const totalCollectable = deal.customerContractTotal + (deal.peBonusTotal ?? 0);
  const totalCollected = deal.customerCollected + (deal.peBonusCollected ?? 0);
  deal.collectedPct = totalCollectable > 0 ? (totalCollected / totalCollectable) * 100 : 0;
}
