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
    hs_invoice_link?: string | null;
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
  "hs_invoice_link", // public sent link (when invoice was emailed via HubSpot)
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

function invoiceUrl(invoiceId: string, hsInvoiceLink?: string | null): string {
  // Prefer the public sent-invoice link when available (HubSpot only sets
  // this when the invoice has been emailed via HubSpot). Otherwise link to
  // the canonical record page.
  if (hsInvoiceLink) return hsInvoiceLink;
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
    hubspotUrl: invoiceUrl(inv.id, inv.properties.hs_invoice_link),
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

    // First pass: match by line item name (covers most invoices).
    const unmatched: typeof invIds = [];
    for (const invId of invIds) {
      const inv = invoiceById.get(invId);
      if (!inv) continue;

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

      // Try amount-matching against PE payment fields (PE invoices may have
      // line items with no recognizable name).
      const billed = parseNum(inv.properties.hs_amount_billed);
      if (deal.peM1Amount !== null && moneyEqual(billed, deal.peM1Amount)) {
        dealInvoices.peM1 = toSummary(inv);
        continue;
      }
      if (deal.peM2Amount !== null && moneyEqual(billed, deal.peM2Amount)) {
        dealInvoices.peM2 = toSummary(inv);
        continue;
      }

      unmatched.push(invId);
    }

    // Second pass: fallback for invoices with NO line items (HubSpot data
    // quality issue — observed on PROJ-9456's CC invoice). Sort by invoice
    // date and fill the next empty milestone slot in customer-side order
    // (DA → CC → PTO for non-PE; DA → CC for PE).
    if (unmatched.length > 0) {
      const customerSlots: MilestoneKey[] = deal.isPE ? ["da", "cc"] : ["da", "cc", "pto"];
      const sortedUnmatched = unmatched
        .map((id) => invoiceById.get(id))
        .filter((inv): inv is RawInvoice => !!inv)
        .sort((a, b) => {
          const ad = a.properties.hs_invoice_date ?? "";
          const bd = b.properties.hs_invoice_date ?? "";
          return ad.localeCompare(bd);
        });
      for (const inv of sortedUnmatched) {
        const slot = customerSlots.find((k) => !dealInvoices[k]);
        if (!slot) break; // no empty customer slot left; skip
        dealInvoices[slot] = toSummary(inv);
      }
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
 * After invoices are attached, recompute money fields using invoice amounts.
 *
 * Money model (unified across PE and non-PE):
 *   deal.amount = total contract value (customerContractTotal)
 *   For non-PE: customer pays 100% via DA + CC + PTO invoices
 *   For PE:     customer pays ~70% via DA + CC + PTO,
 *               PE program pays the other ~30% via PE M1 + PE M2 invoices
 *   Either way, all 5 milestones collect against the SAME deal.amount.
 *
 * Why this matters: deal-property amounts (da_invoice_amount etc.) are
 * sometimes null even when the milestone is paid. Invoice records have the
 * real numbers. Without this reconcile, % collected was reading as 0 on paid
 * deals.
 */
function reconcileMoneyWithInvoices(deal: PaymentTrackingDeal): void {
  // Per-milestone paid amount: invoice.amountPaid, falling back to deal
  // property when no invoice attached.
  const daPaid =
    deal.invoices?.da?.amountPaid ??
    (deal.daStatus === "Paid In Full" ? deal.daAmount ?? 0 : 0);
  const ccPaid =
    deal.invoices?.cc?.amountPaid ??
    (deal.ccStatus === "Paid In Full" ? deal.ccAmount ?? 0 : 0);
  // PTO only counts for non-PE deals (PE deals don't have a PTO milestone).
  const ptoPaid = deal.isPE ? 0 : deal.invoices?.pto?.amountPaid ?? 0;

  // If change orders bumped the customer-side invoiced total above the deal
  // contract, use the invoiced total. (Change orders are billed via the same
  // milestone invoices; deal.amount may not reflect them.) For PE deals,
  // exclude PTO from this calc since PTO isn't part of the contract.
  const customerInvoicedTotal =
    (deal.invoices?.da?.amountBilled ?? 0) +
    (deal.invoices?.cc?.amountBilled ?? 0) +
    (deal.isPE ? 0 : deal.invoices?.pto?.amountBilled ?? 0);
  if (customerInvoicedTotal > deal.customerContractTotal) {
    deal.customerContractTotal = customerInvoicedTotal;
  }

  deal.customerCollected = daPaid + ccPaid + ptoPaid;

  // PE-side: PE pays a portion of the same contract (NOT additional revenue).
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
  }

  // Outstanding for the deal = contract minus EVERYTHING collected (customer
  // side AND PE side).
  const totalCollected = deal.customerCollected + (deal.peBonusCollected ?? 0);
  deal.customerOutstanding = Math.max(0, deal.customerContractTotal - totalCollected);
  deal.peBonusOutstanding = deal.isPE ? deal.customerOutstanding : null;

  // Total PB revenue is the deal contract (PE doesn't add to it).
  deal.totalPBRevenue = deal.customerContractTotal;

  // Cap at 100%. Real PE invoices include a "Participate Energy Markup"
  // line item that PE pays in addition to the contract — that inflates
  // total paid above deal.amount. We display the % capped so accounting
  // doesn't see misleading 105% values.
  deal.collectedPct =
    deal.customerContractTotal > 0
      ? Math.min(100, (totalCollected / deal.customerContractTotal) * 100)
      : 0;
}
