/**
 * Invoice-driven milestone "Paid" sync.
 *
 * When a PE milestone's invoice is paid in full, advance the deal's milestone
 * from "Approved" → "Paid" and stamp pe_m*_paid_date from the invoice's actual
 * paid-in-full date. Gated to deals currently at "Approved" (the only legitimate
 * predecessor of Paid), so the candidate set is small and it never fights the
 * workflows/manual entry that manage earlier statuses.
 *
 * The authoritative paid date is the invoice's LATEST `hs_invoice_status → "paid"`
 * history timestamp — immune to the bulk last-modified edits and to revert/re-pay
 * (an invoice that went paid → open → paid keeps the latest transition).
 *
 * Kill switch: PE_INVOICE_PAID_SYNC_ENABLED=false short-circuits.
 */

const HS = "https://api.hubapi.com";
const PE_TAG = "Participate Energy";
const AMOUNT_TOL = 5; // dollars; IC/PC vs invoice billed amount

export interface InvoiceLite {
  hsNumber: string;
  status: string; // hs_invoice_status, e.g. "paid" | "open" | "draft"
  amountBilled: number;
  paidHistory: string[]; // ISO timestamps where hs_invoice_status became "paid", ascending
}

/** Latest timestamp at which the invoice status became "paid" (handles revert/re-pay). */
export function latestPaidTimestamp(inv: InvoiceLite): string | null {
  if (!inv.paidHistory.length) return null;
  return [...inv.paidHistory].sort()[inv.paidHistory.length - 1];
}

/**
 * Decide whether an "Approved" milestone should flip to "Paid", and to which date.
 * Returns null (no change) unless the milestone is Approved AND has a matching,
 * paid-in-full PE invoice.
 */
export function decidePaidFromInvoice(args: {
  milestoneStatus: string | null;
  milestoneAmount: number | null;
  invoices: InvoiceLite[];
}): { paidDate: string } | null {
  if (args.milestoneStatus !== "Approved") return null;
  if (args.milestoneAmount == null) return null;
  const inv = args.invoices.find(
    (v) =>
      v.hsNumber.endsWith("PE") &&
      v.status === "paid" &&
      Math.abs(v.amountBilled - (args.milestoneAmount as number)) < AMOUNT_TOL,
  );
  if (!inv) return null;
  const paidDate = latestPaidTimestamp(inv);
  return paidDate ? { paidDate } : null;
}

function midnightMs(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

interface HubDeal {
  id: string;
  properties: Record<string, string | null>;
}

export interface InvoicePaidSyncResult {
  enabled: boolean;
  dryRun: boolean;
  candidates: number; // Approved milestones examined
  updates: Array<{ dealId: string; dealName: string; milestone: "M1" | "M2"; paidDate: string }>;
  errors: string[];
}

async function hs(token: string, path: string, init?: RequestInit) {
  const r = await fetch(HS + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error(`HubSpot ${init?.method || "GET"} ${path} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Search PE deals with at least one milestone currently "Approved". */
async function fetchApprovedDeals(token: string): Promise<HubDeal[]> {
  const props = ["dealname", "tags", "pe_m1_status", "pe_m2_status", "pe_payment_ic", "pe_payment_pc", "pe_m1_paid_date", "pe_m2_paid_date"];
  const byId = new Map<string, HubDeal>();
  for (const statusProp of ["pe_m1_status", "pe_m2_status"]) {
    let after: string | undefined;
    do {
      const body: Record<string, unknown> = {
        filterGroups: [{ filters: [{ propertyName: statusProp, operator: "EQ", value: "Approved" }] }],
        properties: props,
        limit: 100,
        ...(after ? { after } : {}),
      };
      const j = (await hs(token, "/crm/v3/objects/deals/search", { method: "POST", body: JSON.stringify(body) })) as {
        results?: HubDeal[];
        paging?: { next?: { after?: string } };
      };
      for (const d of j.results || []) if (String(d.properties.tags || "").includes(PE_TAG)) byId.set(d.id, d);
      after = j.paging?.next?.after;
    } while (after);
  }
  return [...byId.values()];
}

/** Map dealId → associated invoice ids (batched). */
async function fetchDealInvoices(token: string, dealIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (let i = 0; i < dealIds.length; i += 100) {
    const inputs = dealIds.slice(i, i + 100).map((id) => ({ id }));
    const j = (await hs(token, "/crm/v4/associations/deals/invoices/batch/read", { method: "POST", body: JSON.stringify({ inputs }) })) as {
      results?: Array<{ from: { id: string }; to?: Array<{ toObjectId: string }> }>;
    };
    for (const row of j.results || []) map.set(row.from.id, (row.to || []).map((t) => t.toObjectId));
  }
  return map;
}

/** Read invoices (with status history) → InvoiceLite. Batch reads with history cap at 50. */
async function fetchInvoices(token: string, invoiceIds: string[]): Promise<Map<string, InvoiceLite>> {
  const map = new Map<string, InvoiceLite>();
  for (let i = 0; i < invoiceIds.length; i += 50) {
    const inputs = invoiceIds.slice(i, i + 50).map((id) => ({ id }));
    const j = (await hs(token, "/crm/v3/objects/invoices/batch/read", {
      method: "POST",
      body: JSON.stringify({ inputs, properties: ["hs_number", "hs_invoice_status", "hs_amount_billed"], propertiesWithHistory: ["hs_invoice_status"] }),
    })) as { results?: Array<{ id: string; properties: Record<string, string>; propertiesWithHistory?: { hs_invoice_status?: Array<{ value: string; timestamp: string }> } }> };
    for (const d of j.results || []) {
      const paidHistory = (d.propertiesWithHistory?.hs_invoice_status || []).filter((e) => e.value === "paid").map((e) => e.timestamp).sort();
      map.set(d.id, {
        hsNumber: String(d.properties.hs_number || ""),
        status: String(d.properties.hs_invoice_status || ""),
        amountBilled: parseFloat(d.properties.hs_amount_billed || "0"),
        paidHistory,
      });
    }
  }
  return map;
}

/**
 * Advance Approved milestones to Paid where their PE invoice is paid in full.
 * @param opts.dryRun when true, computes the updates but writes nothing.
 */
export async function syncMilestonePaidFromInvoices(opts?: { dryRun?: boolean }): Promise<InvoicePaidSyncResult> {
  const dryRun = !!opts?.dryRun;
  const result: InvoicePaidSyncResult = { enabled: true, dryRun, candidates: 0, updates: [], errors: [] };
  // Default OFF: only writes live when PE_INVOICE_PAID_SYNC_ENABLED=true. A dry run
  // always computes (so the rollout preview works before the flag is flipped).
  if (!dryRun && process.env.PE_INVOICE_PAID_SYNC_ENABLED !== "true") return { ...result, enabled: false };

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    result.errors.push("HUBSPOT_ACCESS_TOKEN not set");
    return result;
  }

  let deals: HubDeal[];
  try {
    deals = await fetchApprovedDeals(token);
  } catch (e) {
    result.errors.push(`fetchApprovedDeals: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }
  if (!deals.length) return result;

  const invByDeal = await fetchDealInvoices(token, deals.map((d) => d.id));
  const allInvIds = [...new Set([...invByDeal.values()].flat())];
  const inv = await fetchInvoices(token, allInvIds);

  const writeOps: Array<{ id: string; properties: Record<string, string> }> = [];
  for (const d of deals) {
    const p = d.properties;
    const invoices = (invByDeal.get(d.id) || []).map((x) => inv.get(x)).filter((v): v is InvoiceLite => !!v);
    const props: Record<string, string> = {};
    for (const [m, statusProp, amtProp, dateProp] of [
      ["M1", "pe_m1_status", "pe_payment_ic", "pe_m1_paid_date"],
      ["M2", "pe_m2_status", "pe_payment_pc", "pe_m2_paid_date"],
    ] as const) {
      if (p[statusProp] !== "Approved") continue;
      result.candidates++;
      const amt = p[amtProp] ? parseFloat(p[amtProp] as string) : null;
      const decision = decidePaidFromInvoice({ milestoneStatus: p[statusProp], milestoneAmount: amt, invoices });
      if (!decision) continue;
      props[statusProp] = "Paid";
      props[dateProp] = String(midnightMs(decision.paidDate));
      result.updates.push({ dealId: d.id, dealName: String(p.dealname || ""), milestone: m, paidDate: decision.paidDate.slice(0, 10) });
    }
    if (Object.keys(props).length) writeOps.push({ id: d.id, properties: props });
  }

  if (!dryRun && writeOps.length) {
    for (let i = 0; i < writeOps.length; i += 100) {
      try {
        await hs(token, "/crm/v3/objects/deals/batch/update", { method: "POST", body: JSON.stringify({ inputs: writeOps.slice(i, i + 100) }) });
      } catch (e) {
        result.errors.push(`batch update: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return result;
}
