import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { searchWithRetry, hubspotClient, updateDealProperty } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS, getStageMaps } from "@/lib/deals-pipeline";
import { safeWaitUntil } from "@/lib/safe-wait-until";
import { prisma } from "@/lib/db";
import { getPaymentAdjustments } from "@/lib/pe-payment-adjustments";
import { computePeSplit, currencyStr, currencyPropStr } from "@/lib/pe-payment-split";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pending HubSpot write for a single deal's PE payment properties. */
interface PeSyncEntry {
  dealId: string;
  properties: Record<string, string>;
}

interface PeDeal {
  dealId: string;
  dealName: string;
  pbLocation: string;
  dealStage: string;
  dealStageLabel: string;
  closeDate: string | null;
  systemType: "solar" | "battery" | "solar+battery";
  epcPrice: number | null;
  customerPays: number | null;
  pePaymentTotal: number | null;
  pePaymentIC: number | null;
  pePaymentPC: number | null;
  totalPBRevenue: number | null;
  postalCode: string | null;
  energyCommunity: boolean;
  ecLookupFailed: boolean;
  solarDC: boolean;
  batteryDC: boolean;
  leaseFactor: number;
  peM1Status: string | null;
  peM2Status: string | null;
  m1PaymentShort: number; // admin-recorded short-pay on M1 (IC), dollars
  m2PaymentShort: number; // admin-recorded short-pay on M2 (PC), dollars
  milestoneHighlight: "m1" | "m2" | "complete" | null;
  // Customer payment status (DA/CC/PTO invoice milestones)
  daInvoiceStatus: string | null;
  ccInvoiceStatus: string | null;
  ptoInvoiceStatus: string | null;
  paidInFull: boolean;
  inspectionPassDate: string | null;
  ptoGrantedDate: string | null;
  hubspotUrl: string;
  pePortalUrl: string | null;
  peProjectId: string | null;
  driveUrl: string | null;
  // Team leads — for by-team sub-grouping on the Docs page
  dealOwner: string | null;
  designLead: string | null;
  permitLead: string | null;
  interconnectionLead: string | null;
  docReviews: PeDocReviewRow[];
}

interface PeDocReviewRow {
  dealId: string;
  docName: string;
  status: string;
  notes: string | null;
  // Latest open PE reviewer comment for this doc (from PeActionItem). null when
  // there's no open action item — `notes` typically holds only sync metadata.
  peComment: string | null;
}

// ---------------------------------------------------------------------------
// EC lookup — static zip set from Treasury IRS Notice 2025-31 data
// Source: EC_MSA_FFE_U2024 (Statistical Area) + Census ZCTA-County crosswalk
// Covers all CO (53 counties) + CA (35 counties) qualifying under FFE+unemployment
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HubSpot deal properties to fetch
// ---------------------------------------------------------------------------

const PE_DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "pb_location",
  "postal_code",
  "project_type",
  "battery_count",
  "battery_brand",
  "module_brand",
  "tags",
  // PE-specific
  "participate_energy_status",
  "is_participate_energy",
  // PE milestone statuses (confirmed via HubSpot property search)
  "pe_m1_status",
  "pe_m2_status",
  // Free-text reason shown when a milestone is "Waiting on Information"
  "pe_info_needed",
  // PE portal cross-reference
  "pe_portal_url",
  "pe_project_id",
  // Team leads (for by-team sub-grouping on the Docs page)
  "hubspot_owner_id",
  "design",
  "permit_tech",
  "interconnections_tech",
  // PE payment properties — synced back to HubSpot on each load
  "pe_payment_ic",
  "pe_payment_pc",
  "pe_total_pb_revenue",
  // Customer payment milestones (DA/CC/PTO invoice statuses)
  "da_invoice_status",
  "cc_invoice_status",
  "pto_invoice_status",
  "paid_in_full",
  // Milestone completion dates (for PE Submission Gap timeline)
  "inspections_completion_date",
  "pto_completion_date",
  // Google Drive project folder (quick access to source docs)
  "all_document_parent_folder_id",
  "g_drive",
  "all_document_folder_url",
];

// ---------------------------------------------------------------------------
// Fetch PE deals from a single pipeline
// ---------------------------------------------------------------------------

const PE_TAG_VALUE = "Participate Energy";

async function fetchPeDealsFromPipeline(
  pipelineKey: string,
): Promise<Record<string, unknown>[]> {
  const pipelineId = PIPELINE_IDS[pipelineKey];
  if (!pipelineId) return [];

  const allDeals: Record<string, unknown>[] = [];

  // Project pipeline uses a numeric ID — filter by pipeline + tag
  let after: string | undefined;
  do {
    const searchRequest = {
      filterGroups: [{
        filters: [
          { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId },
          { propertyName: "tags", operator: FilterOperatorEnum.ContainsToken, value: PE_TAG_VALUE },
        ],
      }],
      properties: PE_DEAL_PROPERTIES,
      sorts: [{ propertyName: "closedate", direction: "DESCENDING" }] as unknown as string[],
      limit: 100,
      ...(after ? { after } : {}),
    } as any;
    const response = await searchWithRetry(searchRequest);
    allDeals.push(...response.results.map((d) => d.properties));
    after = response.paging?.next?.after;
  } while (after);

  return allDeals;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  try {
    // Exclude Cancelled only — Project Complete may still have pending PE payments
    const EXCLUDED_STAGES = ["68229433"];
    const projectDeals = await fetchPeDealsFromPipeline("project");
    const rawDeals = projectDeals.filter(
      (d) => !EXCLUDED_STAGES.includes(String(d.dealstage)),
    );

    // Resolve stage labels
    const stageMaps = await getStageMaps();
    const allStageMaps = (stageMaps.project || {}) as Record<string, string>;

    // EC lookup — static set, no network calls needed

    // PE doc statuses come from the peDocumentReview table — the source of
    // truth, populated by the PE portal scraper. HubSpot deal props are synced
    // downstream of this table, so the DB is always at least as fresh and also
    // carries the full rejection notes (submission/response dates + PE comment).
    const dbDocs = await prisma.peDocumentReview.findMany({
      select: { dealId: true, docName: true, status: true, notes: true },
    });

    // The genuine PE reviewer comment lives in PeActionItem (full reviewer note
    // text), not peDocumentReview.notes — which holds only "Synced from PE API
    // …" metadata for most action-required docs. Join the latest OPEN action
    // item per (deal, doc); docLabel matches peDocumentReview.docName exactly.
    const openActionItems = await prisma.peActionItem.findMany({
      where: { resolvedAt: null, dealId: { not: null } },
      select: { dealId: true, docLabel: true, notes: true },
      orderBy: { actionDate: "desc" },
    });
    const commentByDoc = new Map<string, string>();
    for (const ai of openActionItems) {
      if (!ai.dealId) continue;
      const note = ai.notes?.trim();
      if (!note) continue;
      const key = `${ai.dealId}::${ai.docLabel}`;
      if (!commentByDoc.has(key)) commentByDoc.set(key, note); // desc order ⇒ first = latest
    }

    const docsByDeal = new Map<string, PeDocReviewRow[]>();
    for (const d of dbDocs) {
      if (!docsByDeal.has(d.dealId)) docsByDeal.set(d.dealId, []);
      // Only surface the comment on docs that are still actionable — an open
      // action item can linger on a doc that's since been resubmitted/approved.
      const actionable = d.status === "ACTION_REQUIRED" || d.status === "REJECTED";
      docsByDeal.get(d.dealId)!.push({
        dealId: d.dealId,
        docName: d.docName,
        status: d.status,
        notes: d.notes,
        peComment: actionable ? (commentByDoc.get(`${d.dealId}::${d.docName}`) ?? null) : null,
      });
    }

    // Admin-recorded short-pays (PE paid less than the milestone amount)
    const paymentAdjustments = await getPaymentAdjustments();

    // Resolve team-lead display names for the by-team sub-grouping. Deal owner
    // AND the design/permit/interconnection lead fields all store a HubSpot
    // owner id (those lead "select" fields are user references, not static
    // options), so one owner-id→name map resolves all four. Include archived
    // owners so a former lead still renders a name rather than a raw id.
    const ownerNameById = new Map<string, string>();
    for (const archived of [false, true]) {
      try {
        let after: string | undefined;
        do {
          const page = await hubspotClient.crm.owners.ownersApi.getPage(undefined, after, 100, archived);
          for (const o of page.results) {
            const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || String(o.id);
            if (o.id != null && !ownerNameById.has(String(o.id))) ownerNameById.set(String(o.id), name);
          }
          after = page.paging?.next?.after;
        } while (after);
      } catch (err) {
        console.error(`[pe-deals] owner name resolution failed (archived=${archived}):`, err);
      }
    }
    const resolveOwner = (raw: unknown): string | null => {
      const v = String(raw ?? "").trim();
      return v ? (ownerNameById.get(v) ?? null) : null;
    };

    // Transform deals + build HubSpot sync batch in one pass
    // (raw `deal` properties are only in scope inside this .map())
    const syncBatch: PeSyncEntry[] = [];

    const deals: PeDeal[] = rawDeals.map((deal) => {
      const dealId = String(deal.hs_object_id);
      const postalCode = String(deal.postal_code || "").trim() || null;
      const stageId = String(deal.dealstage || "");
      const stageLabel = allStageMaps[stageId] || stageId;

      // PE payment split — single source of truth in @/lib/pe-payment-split
      const {
        systemType,
        solarDC,
        batteryDC,
        energyCommunity,
        leaseFactor,
        epcPrice,
        customerPays,
        pePaymentTotal,
        ic: pePaymentIC,
        pc: pePaymentPC,
        totalPbRevenue: totalPBRevenue,
      } = computePeSplit(deal as Record<string, unknown>);
      const ecLookupFailed = false;

      // ------------------------------------------------------------------
      // HubSpot sync: compare calculated values against fetched properties.
      // Uses currencyStr() for both compare and store so rounding is
      // identical and floating-point drift never triggers a false write.
      // ------------------------------------------------------------------
      if (epcPrice !== null) {
        const calcIC = currencyStr(pePaymentIC)!;
        const calcPC = currencyStr(pePaymentPC)!;
        const calcRev = currencyStr(totalPBRevenue)!;

        const storedIC = currencyPropStr(deal.pe_payment_ic);
        const storedPC = currencyPropStr(deal.pe_payment_pc);
        const storedRev = currencyPropStr(deal.pe_total_pb_revenue);

        const propsToUpdate: Record<string, string> = {};
        if (storedIC !== calcIC) propsToUpdate.pe_payment_ic = calcIC;
        if (storedPC !== calcPC) propsToUpdate.pe_payment_pc = calcPC;
        if (storedRev !== calcRev) propsToUpdate.pe_total_pb_revenue = calcRev;

        if (Object.keys(propsToUpdate).length > 0) {
          syncBatch.push({ dealId, properties: propsToUpdate });
        }
      }

      // PE per-document statuses — from the peDocumentReview DB table
      const docReviews = docsByDeal.get(dealId) ?? [];

      // Google Drive project folder. all_document_parent_folder_id is the
      // HubSpot-automation-created folder (most reliable); g_drive /
      // all_document_folder_url are sparse legacy fallbacks.
      const folderId = deal.all_document_parent_folder_id;
      const driveUrl = folderId
        ? `https://drive.google.com/drive/folders/${String(folderId)}`
        : deal.g_drive
          ? String(deal.g_drive)
          : deal.all_document_folder_url
            ? String(deal.all_document_folder_url)
            : null;

      return {
        dealId,
        dealName: String(deal.dealname || "Untitled"),
        pbLocation: String(deal.pb_location || ""),
        dealStage: stageId,
        dealStageLabel: stageLabel,
        closeDate: deal.closedate ? String(deal.closedate) : null,
        systemType,
        epcPrice,
        customerPays,
        pePaymentTotal,
        pePaymentIC,
        pePaymentPC,
        totalPBRevenue,
        postalCode,
        energyCommunity,
        ecLookupFailed,
        solarDC,
        batteryDC,
        leaseFactor,
        peM1Status: deal.pe_m1_status ? String(deal.pe_m1_status) : null,
        peM2Status: deal.pe_m2_status ? String(deal.pe_m2_status) : null,
        peInfoNeeded: deal.pe_info_needed ? String(deal.pe_info_needed) : null,
        m1PaymentShort: paymentAdjustments[dealId]?.m1Short ?? 0,
        m2PaymentShort: paymentAdjustments[dealId]?.m2Short ?? 0,
        milestoneHighlight:
          stageLabel === "Permission To Operate" ? "m1" as const
          : stageLabel === "Close Out" ? "m2" as const
          : stageLabel === "Project Complete" ? "complete" as const
          : null,
        daInvoiceStatus: deal.da_invoice_status ? String(deal.da_invoice_status) : null,
        ccInvoiceStatus: deal.cc_invoice_status ? String(deal.cc_invoice_status) : null,
        ptoInvoiceStatus: deal.pto_invoice_status ? String(deal.pto_invoice_status) : null,
        paidInFull: String(deal.paid_in_full || "").toLowerCase() === "true",
        inspectionPassDate: deal.inspections_completion_date ? String(deal.inspections_completion_date) : null,
        ptoGrantedDate: deal.pto_completion_date ? String(deal.pto_completion_date) : null,
        hubspotUrl: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`,
        pePortalUrl: deal.pe_portal_url ? String(deal.pe_portal_url) : null,
        peProjectId: deal.pe_project_id ? String(deal.pe_project_id) : null,
        driveUrl,
        dealOwner: resolveOwner(deal.hubspot_owner_id),
        designLead: resolveOwner(deal.design),
        permitLead: resolveOwner(deal.permit_tech),
        interconnectionLead: resolveOwner(deal.interconnections_tech),
        docReviews,
      };
    });

    // Sync stale PE payment properties to HubSpot in the background
    if (syncBatch.length > 0) {
      safeWaitUntil(
        (async () => {
          const results = await Promise.allSettled(
            syncBatch.map(({ dealId, properties }) =>
              updateDealProperty(dealId, properties),
            ),
          );
          const synced = results.filter(
            (r) => r.status === "fulfilled" && r.value === true,
          ).length;
          const failed = results.length - synced;
          console.log(
            `[pe-deals] PE payment sync: ${synced} updated, ${failed} failed out of ${results.length} stale deals`,
          );
        })(),
      );
    }

    return NextResponse.json({ deals, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error("[pe-deals] Error fetching PE deals:", err);
    return NextResponse.json({ error: "Failed to fetch PE deals" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update M1/M2 status on a deal in HubSpot
// ---------------------------------------------------------------------------

// Sourced from HubSpot property definitions for pe_m1_status / pe_m2_status.
// M1 has an onboarding phase (5 statuses) before the submission phase.
const VALID_M1M2_VALUES = [
  // Onboarding phase (M1 only)
  "Ready for Onboarding",
  "Onboarding Submitted",
  "Onboarding Rejected",
  "Onboarding Ready to Resubmit",
  "Onboarding Resubmitted",
  // Submission phase (M1 + M2)
  "Ready to Submit",
  "Waiting on Information",
  "Submitted",
  "Rejected",
  "Ready to Resubmit",
  "Resubmitted",
  "Approved",
  "Paid",
];

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { dealId, field, value } = body as {
      dealId: string;
      field: "pe_m1_status" | "pe_m2_status" | "pe_info_needed";
      value: string;
    };

    if (!dealId || !field) {
      return NextResponse.json({ error: "Missing dealId or field" }, { status: 400 });
    }

    const isStatusField = field === "pe_m1_status" || field === "pe_m2_status";
    if (!isStatusField && field !== "pe_info_needed") {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }

    // Status fields: allow clearing (empty) or a known status value.
    if (isStatusField && value && !VALID_M1M2_VALUES.includes(value)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }
    // Free-text reason: allow clearing or any text up to a sane cap.
    if (field === "pe_info_needed" && value && value.length > 2000) {
      return NextResponse.json({ error: "Note too long (max 2000 chars)" }, { status: 400 });
    }

    await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: { [field]: value || "" },
    });

    console.log(`[pe-deals] ${user.email} updated ${field}="${value}" on deal ${dealId}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[pe-deals] Error updating milestone status:", err);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
