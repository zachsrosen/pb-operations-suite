/**
 * PE Invoice Audit Cron
 *
 * Hourly check: finds PE deals where pe_m1_status or pe_m2_status is "Approved",
 * verifies whether the corresponding PE invoice (identified by line item name
 * "Participate Energy - M1" / "Participate Energy - M2") has been paid in
 * QuickBooks (synced to HubSpot as invoice status "paid"), and updates the
 * deal property to "Paid" when confirmed.
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

// HubSpot stage IDs for PTO / Close Out / Project Complete
const MILESTONE_STAGE_IDS = [
  "20461940", // Permission To Operate
  "24743347", // Close Out
  "20440343", // Project Complete
];

// Close Out + Complete — M2 is only relevant at these stages
const CLOSE_OUT_COMPLETE = new Set(["24743347", "20440343"]);

const PE_M1_LINE_ITEM = "Participate Energy - M1";
const PE_M2_LINE_ITEM = "Participate Energy - M2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InvoiceCheck {
  dealId: string;
  dealName: string;
  m1WasApproved: boolean;
  m2WasApproved: boolean;
  m1InvoicePaid: boolean;
  m2InvoicePaid: boolean;
}

interface AssocResult {
  results: Array<{ toObjectId: number }>;
}

interface ObjectResult {
  properties: Record<string, string | null>;
}

/**
 * Check if a deal has paid PE M1/M2 invoices by walking:
 *   deal → invoices → line items
 *
 * Uses raw HubSpot REST API (v4 for associations, v3 for object reads).
 */
async function checkPeInvoices(
  dealId: string,
  checkM1: boolean,
  checkM2: boolean,
): Promise<{ m1Paid: boolean; m2Paid: boolean }> {
  let m1Paid = false;
  let m2Paid = false;

  try {
    // Get invoices associated with deal
    const assocData = await hsFetch<AssocResult>(
      `/crm/v4/objects/deals/${dealId}/associations/invoices`,
    );
    const invoiceIds = (assocData.results || []).map((r) =>
      String(r.toObjectId),
    );

    for (const invoiceId of invoiceIds) {
      // Get invoice status
      const invoice = await hsFetch<ObjectResult>(
        `/crm/v3/objects/invoices/${invoiceId}?properties=hs_invoice_status`,
      );
      const status = String(
        invoice.properties.hs_invoice_status || "",
      ).toLowerCase();

      if (status !== "paid") continue;

      // Only check line items on paid invoices
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

        if (checkM1 && name.includes(PE_M1_LINE_ITEM)) m1Paid = true;
        if (checkM2 && name.includes(PE_M2_LINE_ITEM)) m2Paid = true;
      }

      // Early exit if we found everything we need
      if ((!checkM1 || m1Paid) && (!checkM2 || m2Paid)) break;
    }
  } catch (err) {
    console.error(
      `[pe-invoice-audit] Error checking invoices for deal ${dealId}:`,
      err,
    );
  }

  return { m1Paid, m2Paid };
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
    // Find PE deals at milestone stages with M1 or M2 = "Approved"
    // We search for each milestone stage separately since HubSpot search
    // doesn't support OR on the same property in one filter group.
    const candidateDeals: Array<{
      dealId: string;
      dealName: string;
      stageId: string;
      m1: string;
      m2: string;
    }> = [];

    for (const stageId of MILESTONE_STAGE_IDS) {
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

          // Only check deals where at least one milestone is "Approved"
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
      console.log("[pe-invoice-audit] No deals with Approved M1/M2 found");
      return NextResponse.json({
        checked: 0,
        updated: [],
        skipped: 0,
      });
    }

    console.log(
      `[pe-invoice-audit] Checking ${candidateDeals.length} deals with Approved M1/M2`,
    );

    // Check invoices for each candidate deal
    const results: InvoiceCheck[] = [];
    const updated: string[] = [];

    for (const deal of candidateDeals) {
      const checkM1 = deal.m1 === "Approved";
      const checkM2 =
        deal.m2 === "Approved" && CLOSE_OUT_COMPLETE.has(deal.stageId);

      const { m1Paid, m2Paid } = await checkPeInvoices(
        deal.dealId,
        checkM1,
        checkM2,
      );

      const entry: InvoiceCheck = {
        dealId: deal.dealId,
        dealName: deal.dealName,
        m1WasApproved: checkM1,
        m2WasApproved: checkM2,
        m1InvoicePaid: m1Paid,
        m2InvoicePaid: m2Paid,
      };
      results.push(entry);

      // Update deal properties where invoice is confirmed paid
      const propsToUpdate: Record<string, string> = {};
      if (checkM1 && m1Paid) propsToUpdate.pe_m1_status = "Paid";
      if (checkM2 && m2Paid) propsToUpdate.pe_m2_status = "Paid";

      if (Object.keys(propsToUpdate).length > 0) {
        const success = await updateDealProperty(
          deal.dealId,
          propsToUpdate,
        );
        if (success) {
          const fields = Object.keys(propsToUpdate).join(", ");
          updated.push(`${deal.dealName}: ${fields} → Paid`);
          console.log(
            `[pe-invoice-audit] Updated ${deal.dealName} (${deal.dealId}): ${fields} → Paid`,
          );
        }
      }
    }

    const skipped = results.filter(
      (r) => !r.m1InvoicePaid && !r.m2InvoicePaid,
    ).length;

    console.log(
      `[pe-invoice-audit] Done: checked ${results.length}, updated ${updated.length}, skipped ${skipped}`,
    );

    return NextResponse.json({
      checked: results.length,
      updated,
      skipped,
    });
  } catch (err) {
    console.error("[pe-invoice-audit] Error:", err);
    return NextResponse.json(
      { error: "PE invoice audit failed" },
      { status: 500 },
    );
  }
}
