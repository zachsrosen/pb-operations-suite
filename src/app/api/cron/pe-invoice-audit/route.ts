/**
 * Invoice Payment Audit Cron
 *
 * Hourly check across ALL project-pipeline deals. Two passes:
 *
 * 1. **DA / CC / PTO** — any deal where da_invoice_status, cc_invoice_status,
 *    or pto_invoice_status is "Pending Approval" or "Open" (invoice exists but
 *    not yet marked paid). Walks deal → invoices → line items to verify the
 *    corresponding invoice is paid in QuickBooks (synced to HubSpot as
 *    hs_invoice_status = "paid"). Updates the deal property to "Paid In Full".
 *
 * 2. **PE M1 / M2** — PE-tagged deals where pe_m1_status or pe_m2_status is
 *    "Approved". Same invoice walk; updates to "Paid" when confirmed.
 *
 * Only updates based on verified paid invoices — never assumes.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  searchWithRetry,
  updateDealProperty,
} from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS } from "@/lib/deals-pipeline";

const LOG_TAG = "[invoice-audit]";
const HS_BASE = "https://api.hubapi.com";

function hsHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function hsFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${HS_BASE}${path}`, {
    headers: hsHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HubSpot ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Line item name patterns that identify each invoice type
const LINE_ITEM_PATTERNS: Record<string, string> = {
  da: "Layout Approval Invoice",
  cc: "Construction Complete Invoice",
  pto: "Permission to Operate",
  pe_m1: "Participate Energy - M1",
  pe_m2: "Participate Energy - M2",
};

// HubSpot stage IDs for PTO / Close Out / Project Complete
const PE_MILESTONE_STAGE_IDS = [
  "20461940", // Permission To Operate
  "24743347", // Close Out
  "20440343", // Project Complete
];

// Close Out + Complete — M2 is only relevant at these stages
const CLOSE_OUT_COMPLETE = new Set(["24743347", "20440343"]);

// DA/CC/PTO statuses that mean "invoiced but not yet marked paid"
const UNPAID_CUSTOMER_STATUSES = new Set(["Pending Approval", "Open"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssocResult {
  results: Array<{ toObjectId: number }>;
}

interface ObjectResult {
  properties: Record<string, string | null>;
}

/** Result of checking which invoice types are paid for a deal. */
interface InvoicePaidMap {
  da: boolean;
  cc: boolean;
  pto: boolean;
  pe_m1: boolean;
  pe_m2: boolean;
}

// ---------------------------------------------------------------------------
// Shared invoice checker
// ---------------------------------------------------------------------------

/**
 * Check which invoice types are paid for a deal by walking:
 *   deal → invoices → line items
 *
 * Only walks line items on invoices with hs_invoice_status = "paid".
 * `typesToCheck` limits which line item patterns we look for.
 */
async function checkDealInvoices(
  dealId: string,
  typesToCheck: Set<string>,
): Promise<InvoicePaidMap> {
  const result: InvoicePaidMap = {
    da: false,
    cc: false,
    pto: false,
    pe_m1: false,
    pe_m2: false,
  };

  if (typesToCheck.size === 0) return result;

  try {
    const assocData = await hsFetch<AssocResult>(
      `/crm/v4/objects/deals/${dealId}/associations/invoices`,
    );
    const invoiceIds = (assocData.results || []).map((r) =>
      String(r.toObjectId),
    );

    for (const invoiceId of invoiceIds) {
      const invoice = await hsFetch<ObjectResult>(
        `/crm/v3/objects/invoices/${invoiceId}?properties=hs_invoice_status`,
      );
      const status = String(
        invoice.properties.hs_invoice_status || "",
      ).toLowerCase();

      if (status !== "paid") continue;

      // Walk line items on this paid invoice
      const liAssoc = await hsFetch<AssocResult>(
        `/crm/v4/objects/invoices/${invoiceId}/associations/line_items`,
      );
      const liIds = (liAssoc.results || []).map((r) =>
        String(r.toObjectId),
      );

      for (const liId of liIds) {
        const li = await hsFetch<ObjectResult>(
          `/crm/v3/objects/line_items/${liId}?properties=name`,
        );
        const name = String(li.properties.name || "");

        const types = Array.from(typesToCheck);
        for (const type of types) {
          const pattern = LINE_ITEM_PATTERNS[type];
          if (pattern && name.includes(pattern)) {
            result[type as keyof InvoicePaidMap] = true;
          }
        }
      }

      // Early exit if all requested types found
      const allFound = Array.from(typesToCheck).every(
        (t) => result[t as keyof InvoicePaidMap],
      );
      if (allFound) break;
    }
  } catch (err) {
    console.error(
      `${LOG_TAG} Error checking invoices for deal ${dealId}:`,
      err,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pass 1: DA / CC / PTO audit (all project pipeline deals)
// ---------------------------------------------------------------------------

interface CustomerAuditResult {
  dealId: string;
  dealName: string;
  checked: string[];
  updated: string[];
}

/**
 * Find project pipeline deals where DA, CC, or PTO is invoiced but not yet
 * marked "Paid In Full", verify against actual invoice status, and update.
 */
async function auditCustomerInvoices(
  pipelineId: string,
): Promise<{ results: CustomerAuditResult[]; updated: string[] }> {
  const results: CustomerAuditResult[] = [];
  const updated: string[] = [];

  // Search for deals where at least one customer milestone is in an unpaid
  // invoiced state. HubSpot search doesn't support OR across properties in
  // one filter group, so we use multiple filter groups (implicit OR).
  const filterGroups = [
    // DA = Pending Approval or Open
    ...["Pending Approval", "Open"].map((val) => ({
      filters: [
        {
          propertyName: "pipeline",
          operator: FilterOperatorEnum.Eq,
          value: pipelineId,
        },
        {
          propertyName: "da_invoice_status",
          operator: FilterOperatorEnum.Eq,
          value: val,
        },
      ],
    })),
    // CC = Pending Approval or Open
    ...["Pending Approval", "Open"].map((val) => ({
      filters: [
        {
          propertyName: "pipeline",
          operator: FilterOperatorEnum.Eq,
          value: pipelineId,
        },
        {
          propertyName: "cc_invoice_status",
          operator: FilterOperatorEnum.Eq,
          value: val,
        },
      ],
    })),
    // PTO = Pending Approval or Open
    ...["Pending Approval", "Open"].map((val) => ({
      filters: [
        {
          propertyName: "pipeline",
          operator: FilterOperatorEnum.Eq,
          value: pipelineId,
        },
        {
          propertyName: "pto_invoice_status",
          operator: FilterOperatorEnum.Eq,
          value: val,
        },
      ],
    })),
  ];

  // HubSpot allows max 5 filter groups per search — we have 6.
  // Split into two searches: DA+CC (4 groups) and PTO (2 groups).
  const daAndCcGroups = filterGroups.slice(0, 4);
  const ptoGroups = filterGroups.slice(4, 6);

  // Dedupe across both searches
  const seenDeals = new Map<
    string,
    { dealName: string; da: string; cc: string; pto: string }
  >();

  for (const groups of [daAndCcGroups, ptoGroups]) {
    let after: string | undefined;
    do {
      const response = await searchWithRetry({
        filterGroups: groups,
        properties: [
          "hs_object_id",
          "dealname",
          "da_invoice_status",
          "cc_invoice_status",
          "pto_invoice_status",
        ],
        limit: 100,
        ...(after ? { after } : {}),
      } as any);

      for (const deal of response.results) {
        const p = deal.properties;
        const dealId = String(p.hs_object_id);
        if (!seenDeals.has(dealId)) {
          seenDeals.set(dealId, {
            dealName: String(p.dealname || "Untitled"),
            da: String(p.da_invoice_status || ""),
            cc: String(p.cc_invoice_status || ""),
            pto: String(p.pto_invoice_status || ""),
          });
        }
      }

      after = response.paging?.next?.after;
    } while (after);
  }

  if (seenDeals.size === 0) {
    console.log(`${LOG_TAG} No deals with unpaid DA/CC/PTO invoices found`);
    return { results, updated };
  }

  console.log(
    `${LOG_TAG} Checking ${seenDeals.size} deals with unpaid DA/CC/PTO`,
  );

  const dealEntries = Array.from(seenDeals.entries());
  for (const [dealId, deal] of dealEntries) {
    const typesToCheck = new Set<string>();
    if (UNPAID_CUSTOMER_STATUSES.has(deal.da)) typesToCheck.add("da");
    if (UNPAID_CUSTOMER_STATUSES.has(deal.cc)) typesToCheck.add("cc");
    if (UNPAID_CUSTOMER_STATUSES.has(deal.pto)) typesToCheck.add("pto");

    if (typesToCheck.size === 0) continue;

    const paidMap = await checkDealInvoices(dealId, typesToCheck);

    const propsToUpdate: Record<string, string> = {};
    const updatedFields: string[] = [];

    if (typesToCheck.has("da") && paidMap.da) {
      propsToUpdate.da_invoice_status = "Paid In Full";
      updatedFields.push("DA");
    }
    if (typesToCheck.has("cc") && paidMap.cc) {
      propsToUpdate.cc_invoice_status = "Paid In Full";
      updatedFields.push("CC");
    }
    if (typesToCheck.has("pto") && paidMap.pto) {
      propsToUpdate.pto_invoice_status = "Paid In Full";
      updatedFields.push("PTO");
    }

    results.push({
      dealId,
      dealName: deal.dealName,
      checked: Array.from(typesToCheck),
      updated: updatedFields,
    });

    if (Object.keys(propsToUpdate).length > 0) {
      const success = await updateDealProperty(dealId, propsToUpdate);
      if (success) {
        const label = `${deal.dealName}: ${updatedFields.join(", ")} → Paid In Full`;
        updated.push(label);
        console.log(`${LOG_TAG} Updated ${deal.dealName} (${dealId}): ${updatedFields.join(", ")} → Paid In Full`);
      }
    }
  }

  return { results, updated };
}

// ---------------------------------------------------------------------------
// Pass 2: PE M1 / M2 audit (PE-tagged deals only)
// ---------------------------------------------------------------------------

interface PeAuditResult {
  dealId: string;
  dealName: string;
  m1WasApproved: boolean;
  m2WasApproved: boolean;
  m1InvoicePaid: boolean;
  m2InvoicePaid: boolean;
}

async function auditPeInvoices(
  pipelineId: string,
): Promise<{ results: PeAuditResult[]; updated: string[] }> {
  const results: PeAuditResult[] = [];
  const updated: string[] = [];

  const candidateDeals: Array<{
    dealId: string;
    dealName: string;
    stageId: string;
    m1: string;
    m2: string;
  }> = [];

  for (const stageId of PE_MILESTONE_STAGE_IDS) {
    let after: string | undefined;
    do {
      const response = await searchWithRetry({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "pipeline",
                operator: FilterOperatorEnum.Eq,
                value: pipelineId,
              },
              {
                propertyName: "dealstage",
                operator: FilterOperatorEnum.Eq,
                value: stageId,
              },
              {
                propertyName: "tags",
                operator: FilterOperatorEnum.ContainsToken,
                value: "Participate Energy",
              },
            ],
          },
        ],
        properties: [
          "hs_object_id",
          "dealname",
          "dealstage",
          "pe_m1_status",
          "pe_m2_status",
        ],
        limit: 100,
        ...(after ? { after } : {}),
      } as any);

      for (const deal of response.results) {
        const p = deal.properties;
        const m1 = String(p.pe_m1_status || "");
        const m2 = String(p.pe_m2_status || "");

        const m1Approved = m1 === "Approved";
        const m2Approved =
          m2 === "Approved" && CLOSE_OUT_COMPLETE.has(stageId);

        if (m1Approved || m2Approved) {
          candidateDeals.push({
            dealId: String(p.hs_object_id),
            dealName: String(p.dealname || "Untitled"),
            stageId,
            m1,
            m2,
          });
        }
      }

      after = response.paging?.next?.after;
    } while (after);
  }

  if (candidateDeals.length === 0) {
    console.log(`${LOG_TAG} No PE deals with Approved M1/M2 found`);
    return { results, updated };
  }

  console.log(
    `${LOG_TAG} Checking ${candidateDeals.length} PE deals with Approved M1/M2`,
  );

  for (const deal of candidateDeals) {
    const typesToCheck = new Set<string>();
    if (deal.m1 === "Approved") typesToCheck.add("pe_m1");
    if (deal.m2 === "Approved" && CLOSE_OUT_COMPLETE.has(deal.stageId)) {
      typesToCheck.add("pe_m2");
    }

    const paidMap = await checkDealInvoices(deal.dealId, typesToCheck);

    const entry: PeAuditResult = {
      dealId: deal.dealId,
      dealName: deal.dealName,
      m1WasApproved: typesToCheck.has("pe_m1"),
      m2WasApproved: typesToCheck.has("pe_m2"),
      m1InvoicePaid: paidMap.pe_m1,
      m2InvoicePaid: paidMap.pe_m2,
    };
    results.push(entry);

    const propsToUpdate: Record<string, string> = {};
    if (typesToCheck.has("pe_m1") && paidMap.pe_m1)
      propsToUpdate.pe_m1_status = "Paid";
    if (typesToCheck.has("pe_m2") && paidMap.pe_m2)
      propsToUpdate.pe_m2_status = "Paid";

    if (Object.keys(propsToUpdate).length > 0) {
      const success = await updateDealProperty(deal.dealId, propsToUpdate);
      if (success) {
        const fields = Object.keys(propsToUpdate).join(", ");
        updated.push(`${deal.dealName}: ${fields} → Paid`);
        console.log(
          `${LOG_TAG} Updated ${deal.dealName} (${deal.dealId}): ${fields} → Paid`,
        );
      }
    }
  }

  return { results, updated };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pipelineId = PIPELINE_IDS.project;
  if (!pipelineId) {
    return NextResponse.json(
      { error: "Project pipeline ID not configured" },
      { status: 500 },
    );
  }

  try {
    // Pass 1: DA / CC / PTO (all project pipeline deals)
    const customer = await auditCustomerInvoices(pipelineId);

    // Pass 2: PE M1 / M2 (PE-tagged deals at milestone stages)
    const pe = await auditPeInvoices(pipelineId);

    const totalChecked =
      customer.results.length + pe.results.length;
    const allUpdated = [...customer.updated, ...pe.updated];

    console.log(
      `${LOG_TAG} Done: checked ${totalChecked} deals, updated ${allUpdated.length}`,
    );

    return NextResponse.json({
      customer: {
        checked: customer.results.length,
        updated: customer.updated,
      },
      pe: {
        checked: pe.results.length,
        updated: pe.updated,
      },
      totalChecked,
      totalUpdated: allUpdated.length,
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error:`, err);
    return NextResponse.json(
      { error: "Invoice audit failed" },
      { status: 500 },
    );
  }
}
