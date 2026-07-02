import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { searchWithRetry, hubspotClient } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS } from "@/lib/deals-pipeline";
import { PE_LEASE, calcLeaseFactorAdjustment, DC_QUALIFYING_MODULE_BRANDS, DC_QUALIFYING_BATTERY_BRANDS, type PeSystemType } from "@/lib/pricing-calculator";
import { EC_QUALIFYING_ZIPS } from "@/lib/ec-qualifying-zips";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { listAllProjects, PE_ACTION_DOC_MAP } from "@/lib/pe-api";
import { getUploaderOverridesRaw } from "@/lib/pe-uploader-overrides";
import { getPaymentAdjustments } from "@/lib/pe-payment-adjustments";
import { prisma } from "@/lib/db";
import {
  groupForStatus,
  resolveSubmittedOn,
  resolveApprovedOn,
  resolveRejectedOn,
  resolvePaidOn,
  computeMilestoneTiming,
  median,
  percentile,
  buildUploaderStats,
  buildSharedUploaderStats,
  computeSharedOwners,
  buildPaymentOwnership,
  buildPaymentOwnershipFractional,
  buildPaymentOwnershipLast,
  buildUploadsByPeriod,
  buildDocTypeByUploader,
  PIPELINE_GROUP_ORDER,
  PE_M1_DOC_NAMES,
  PE_CONDITIONAL_DOC_NAMES,
  UNKNOWN_UPLOADER,
  type UploaderDoc,
  type UploaderOutcomeDocs,
  type MilestonePayment,
  type PaymentLine,
  type UploaderPaymentLine,
  type ReRejection,
  type PeAnalyticsPayload,
  type WeeklyPayments,
  type WeeklyLifecycle,
  type WeeklySplitCohort,
  type MilestoneDrillRow,
  type RejectionDrillDeal,
  type RejectionNote,
  type MissingDrillDeal,
  type DocRejectionEvent,
  type PipelineGroupRow,
  type TimingSummary,
  type MonthlyTiming,
  type HistoryEntry,
  type FunnelDeal,
} from "@/lib/pe-analytics";

// Heavy route: paginated PE deal search + ~10 property-history batch reads.
// Route-level maxDuration overrides the 60s vercel.json glob default.
export const maxDuration = 120;

const PE_TAG_VALUE = "Participate Energy";
const ANALYTICS_TTL_MS = 15 * 60 * 1000;

// Project-pipeline stages that gate doc expectations (same IDs as pe-doc-digest)
const PTO_STAGE_ID = "20461940"; // in M1 — owes the 12 M1 docs
const CLOSEOUT_STAGE_ID = "24743347"; // in M2 — owes all 15 docs
const COMPLETE_STAGE_ID = "20440343"; // Project Complete

const DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "dealstage",
  "amount",
  "pb_location",
  "postal_code",
  "project_type",
  "battery_count",
  "battery_brand",
  "module_brand",
  "pe_m1_status",
  "pe_m2_status",
  "pe_payment_ic",
  "pe_payment_pc",
  "pe_m1_submission_date",
  "pe_m2_submission_date",
  "pe_m1_ready_to_submit_date",
  "pe_m2_ready_to_submit_date",
  "pe_m1_approval_date",
  "pe_m2_approval_date",
  "pe_m1_paid_date",
  "pe_m2_paid_date",
  "pe_m1_rejection_date",
  "pe_m2_rejection_date",
  "pe_m1_remittance_date",
  "pe_m2_remittance_date",
  "pe_m1_expected_paid_by_date",
  "pe_m2_expected_paid_by_date",
  // Submission-based forecast: submission + avg submission→payment (datetime calc
  // prop). Reaches milestones that are submitted-but-not-yet-approved, which the
  // approval-based forecast can't see.
  "expected_m1_payment_date_based_on_averages",
  "expected_m2_payment_date_based_on_averages",
  // HubSpot-calculated timing legs (stored in MILLISECONDS) — the dashboard
  // summarizes these per-deal day-counts instead of deriving from the doc log.
  "pe_m1_time_from_submission_to_approval",
  "pe_m2_time_from_submission_to_approval",
  "pe_m1_time_from_approval_to_payment",
  "pe_m2_time_from_approval_to_payment",
  "pe_m1_time_from_remittance_to_payment",
  "pe_m2_time_from_remittance_to_payment",
  "pe_m1_time_from_inspection_pass_to_payment",
  "pe_m2_time_from_pto_to_payment",
  "pe_m1_time_from_submission_to_payment",
  "pe_m2_time_from_submission_to_payment",
  "inspections_completion_date",
  "pto_completion_date",
  "construction_complete_date",
  "pe_portal_url",
  "all_document_parent_folder_id",
];

// HubSpot date-difference calc props are stored in milliseconds — convert to days.
const msToDays = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round((n / 86_400_000) * 10) / 10 : null;
};

// Date calc props can come back as ISO ("2026-07-02T00:00:00Z") or, when the
// property is typed "date" rather than "datetime", as a raw epoch-millis string
// ("1782950400000"). Normalize both to an ISO string.
const toIsoDate = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

interface PeDealRow {
  dealId: string;
  dealName: string;
  stage: string;
  location: string;
  m1Status: string | null;
  m2Status: string | null;
  paymentIC: number | null;
  paymentPC: number | null;
  // Accounting-maintained date props (YYYY-MM-DD) — preferred over status
  // history for chart bucketing since backfilled corrections live here.
  m1SubmissionDate: string | null;
  m2SubmissionDate: string | null;
  m1ApprovalDate: string | null;
  m2ApprovalDate: string | null;
  m1PaidDate: string | null;
  m2PaidDate: string | null;
  m1RejectionDate: string | null;
  m2RejectionDate: string | null;
  m1RemittanceDate: string | null; // date PE remitted M1 (precedes our receipt)
  m2RemittanceDate: string | null;
  m1ExpectedPaidDate: string | null; // forecast: approval + ~14d (calculated prop)
  m2ExpectedPaidDate: string | null;
  m1ExpectedPaidBySubDate: string | null; // forecast: submission + avg (calc prop, ms)
  m2ExpectedPaidBySubDate: string | null;
  // Calculated timing legs, converted ms -> DAYS at mapping (null if not set).
  m1SubmitToApproveDays: number | null;
  m2SubmitToApproveDays: number | null;
  m1ApproveToPayDays: number | null;
  m2ApproveToPayDays: number | null;
  m1RemitToPayDays: number | null;
  m2RemitToPayDays: number | null;
  m1FullCycleDays: number | null; // inspection pass -> M1 payment
  m2FullCycleDays: number | null; // PTO granted -> M2 payment
  m1SubmitToPayDays: number | null;
  m2SubmitToPayDays: number | null;
  inspectionPassDate: string | null; // M1 operational ready
  ptoGrantedDate: string | null; // M2 operational ready
  constructionCompleteDate: string | null; // install/construction done — what Matt measures from
  m1ReadyToSubmitDate: string | null; // stamped when M1 hits "Ready to Submit"
  m2ReadyToSubmitDate: string | null; // stamped when M2 hits "Ready to Submit"
  pePortalUrl: string | null; // direct PE portal project link
  driveFolderId: string | null; // GDrive document parent folder id
}

// ---------------------------------------------------------------------------
// Payment amount fallback — same lease-factor math as the pe-deals route, for
// deals whose pe_payment_ic/pc were never opportunistically synced.
// ---------------------------------------------------------------------------

// A real PE reviewer comment vs a bare status-sync log line. Sync lines look
// like "Synced from PE API (X) | v2 | milestone: Inspection Complete" — no
// reason. Real rejections carry an [H###] code and/or actual reviewer text.
function hasReviewerComment(note: string | null | undefined): boolean {
  if (!note) return false;
  if (/\[H\d/i.test(note)) return true; // PE rejection code
  const stripped = note
    .replace(/Synced from PE (?:API|portal scraper) \([^)]*\)/gi, "")
    .replace(/\bv\d+\b/gi, "")
    .replace(/milestone:[^|]*/gi, "")
    .replace(/submitted:\s*\S+/gi, "")
    .replace(/responded:\s*\S+/gi, "")
    .replace(/approver:\s*(?:page\s*\d+|[\d/]+)/gi, "")
    .replace(/[\s|—-]+/g, " ")
    .trim();
  return stripped.length > 3;
}

/** Strip the sync prefix/metadata so a real rejection note shows just the reason. */
function cleanRejectionNote(note: string): string {
  return note
    .replace(/^Synced from PE (?:API|portal scraper) \([^)]*\)\s*\|?\s*/i, "")
    .replace(/^submitted:[^|]*\|\s*/i, "")
    .replace(/\s+\|\s+/g, " · ")
    .trim()
    .slice(0, 240);
}

function computePaymentsFromAmount(p: Record<string, unknown>): { ic: number | null; pc: number | null } {
  const amount = p.amount ? parseFloat(String(p.amount)) : null;
  if (!amount || amount <= 0) return { ic: null, pc: null };

  const projectType = String(p.project_type || "").toLowerCase();
  const batteryCount = parseInt(String(p.battery_count || "0")) || 0;
  let systemType: PeSystemType = "solar";
  if (projectType.includes("battery") && projectType.includes("solar")) {
    systemType = "solar+battery";
  } else if (projectType.includes("battery") || (batteryCount > 0 && !projectType)) {
    systemType = batteryCount > 0 && !projectType.includes("solar") ? "battery" : "solar+battery";
  }

  const moduleBrand = String(p.module_brand || "");
  const batteryBrand = String(p.battery_brand || "");
  const solarDC =
    moduleBrand.length > 0 &&
    DC_QUALIFYING_MODULE_BRANDS.some((b) => moduleBrand.toLowerCase().includes(b.toLowerCase()));
  const batteryDC =
    batteryCount > 0 &&
    DC_QUALIFYING_BATTERY_BRANDS.some((b) => batteryBrand.toLowerCase().includes(b.toLowerCase()));

  const zipMatch = String(p.postal_code || "").trim().match(/^(\d{5})/);
  const energyCommunity = zipMatch ? EC_QUALIFYING_ZIPS.has(zipMatch[1]) : false;

  const leaseFactor = PE_LEASE.baselineFactor + calcLeaseFactorAdjustment(systemType, solarDC, batteryDC, energyCommunity);
  const total = amount - amount / leaseFactor;
  return { ic: total * (2 / 3), pc: total * (1 / 3) };
}

// ---------------------------------------------------------------------------
// Data fetch
// ---------------------------------------------------------------------------

async function fetchPeDeals(): Promise<PeDealRow[]> {
  const pipelineId = PIPELINE_IDS.project;
  const deals: PeDealRow[] = [];
  let after: string | undefined;
  do {
    const response = await searchWithRetry({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId },
            { propertyName: "tags", operator: FilterOperatorEnum.ContainsToken, value: PE_TAG_VALUE },
          ],
        },
      ],
      properties: DEAL_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    } as never);
    for (const d of response.results) {
      const p = d.properties as Record<string, unknown>;
      const storedIC = p.pe_payment_ic ? parseFloat(String(p.pe_payment_ic)) : null;
      const storedPC = p.pe_payment_pc ? parseFloat(String(p.pe_payment_pc)) : null;
      const fallback = storedIC === null || storedPC === null ? computePaymentsFromAmount(p) : null;
      deals.push({
        dealId: String(p.hs_object_id),
        dealName: String(p.dealname || ""),
        stage: String(p.dealstage || ""),
        location: String(p.pb_location || "Unknown"),
        m1Status: p.pe_m1_status ? String(p.pe_m1_status) : null,
        m2Status: p.pe_m2_status ? String(p.pe_m2_status) : null,
        paymentIC: storedIC ?? fallback?.ic ?? null,
        paymentPC: storedPC ?? fallback?.pc ?? null,
        m1SubmissionDate: p.pe_m1_submission_date ? String(p.pe_m1_submission_date) : null,
        m2SubmissionDate: p.pe_m2_submission_date ? String(p.pe_m2_submission_date) : null,
        m1ApprovalDate: p.pe_m1_approval_date ? String(p.pe_m1_approval_date) : null,
        m2ApprovalDate: p.pe_m2_approval_date ? String(p.pe_m2_approval_date) : null,
        m1PaidDate: p.pe_m1_paid_date ? String(p.pe_m1_paid_date) : null,
        m2PaidDate: p.pe_m2_paid_date ? String(p.pe_m2_paid_date) : null,
        m1RejectionDate: p.pe_m1_rejection_date ? String(p.pe_m1_rejection_date) : null,
        m2RejectionDate: p.pe_m2_rejection_date ? String(p.pe_m2_rejection_date) : null,
        m1RemittanceDate: p.pe_m1_remittance_date ? String(p.pe_m1_remittance_date) : null,
        m2RemittanceDate: p.pe_m2_remittance_date ? String(p.pe_m2_remittance_date) : null,
        m1ExpectedPaidDate: p.pe_m1_expected_paid_by_date ? String(p.pe_m1_expected_paid_by_date) : null,
        m2ExpectedPaidDate: p.pe_m2_expected_paid_by_date ? String(p.pe_m2_expected_paid_by_date) : null,
        m1ExpectedPaidBySubDate: toIsoDate(p.expected_m1_payment_date_based_on_averages),
        m2ExpectedPaidBySubDate: toIsoDate(p.expected_m2_payment_date_based_on_averages),
        m1SubmitToApproveDays: msToDays(p.pe_m1_time_from_submission_to_approval),
        m2SubmitToApproveDays: msToDays(p.pe_m2_time_from_submission_to_approval),
        m1ApproveToPayDays: msToDays(p.pe_m1_time_from_approval_to_payment),
        m2ApproveToPayDays: msToDays(p.pe_m2_time_from_approval_to_payment),
        m1RemitToPayDays: msToDays(p.pe_m1_time_from_remittance_to_payment),
        m2RemitToPayDays: msToDays(p.pe_m2_time_from_remittance_to_payment),
        m1FullCycleDays: msToDays(p.pe_m1_time_from_inspection_pass_to_payment),
        m2FullCycleDays: msToDays(p.pe_m2_time_from_pto_to_payment),
        m1SubmitToPayDays: msToDays(p.pe_m1_time_from_submission_to_payment),
        m2SubmitToPayDays: msToDays(p.pe_m2_time_from_submission_to_payment),
        inspectionPassDate: p.inspections_completion_date ? String(p.inspections_completion_date) : null,
        ptoGrantedDate: p.pto_completion_date ? String(p.pto_completion_date) : null,
        constructionCompleteDate: p.construction_complete_date ? String(p.construction_complete_date) : null,
        m1ReadyToSubmitDate: p.pe_m1_ready_to_submit_date ? String(p.pe_m1_ready_to_submit_date) : null,
        m2ReadyToSubmitDate: p.pe_m2_ready_to_submit_date ? String(p.pe_m2_ready_to_submit_date) : null,
        pePortalUrl: p.pe_portal_url ? String(p.pe_portal_url) : null,
        driveFolderId: p.all_document_parent_folder_id ? String(p.all_document_parent_folder_id) : null,
      });
    }
    after = response.paging?.next?.after;
  } while (after);
  return deals;
}

interface DealHistory {
  m1: HistoryEntry[];
  m2: HistoryEntry[];
}

async function fetchStatusHistory(dealIds: string[]): Promise<Map<string, DealHistory>> {
  const out = new Map<string, DealHistory>();
  for (let i = 0; i < dealIds.length; i += 50) {
    const batch = dealIds.slice(i, i + 50);
    const res = (await hubspotClient.apiRequest({
      method: "POST",
      path: "/crm/v3/objects/deals/batch/read",
      body: {
        inputs: batch.map((id) => ({ id })),
        properties: ["dealname"],
        propertiesWithHistory: ["pe_m1_status", "pe_m2_status"],
      },
    })) as unknown as { json(): Promise<unknown> };
    const data = (await res.json()) as {
      results?: { id: string; propertiesWithHistory?: Record<string, { value: string; timestamp: string }[]> }[];
    };
    for (const deal of data.results || []) {
      out.set(deal.id, {
        m1: deal.propertiesWithHistory?.pe_m1_status || [],
        m2: deal.propertiesWithHistory?.pe_m2_status || [],
      });
    }
    if (i + 50 < dealIds.length) await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

async function buildPayload(): Promise<PeAnalyticsPayload> {
  const deals = await fetchPeDeals();

  // Admin-recorded short-pays: PE paid less than the milestone amount. Net them
  // out of PAID milestone amounts so every "paid" figure (totalPaid, weekly
  // paid, uploader paid) reflects dollars actually received. Approved-but-unpaid
  // milestones are untouched.
  const paymentAdjustments = await getPaymentAdjustments();
  for (const d of deals) {
    const adj = paymentAdjustments[d.dealId];
    if (!adj) continue;
    if (d.m1Status === "Paid" && d.paymentIC !== null) d.paymentIC = Math.max(0, d.paymentIC - (adj.m1Short ?? 0));
    if (d.m2Status === "Paid" && d.paymentPC !== null) d.paymentPC = Math.max(0, d.paymentPC - (adj.m2Short ?? 0));
  }

  const history = await fetchStatusHistory(deals.map((d) => d.dealId));

  // --- Per-milestone records ------------------------------------------------
  interface MilestoneRecord {
    deal: PeDealRow;
    milestone: "M1" | "M2";
    amount: number | null;
    status: string | null;
    timing: ReturnType<typeof computeMilestoneTiming>;
    /** Date-prop preferred, history fallback — used for chart bucketing. */
    submittedOn: string | null;
    approvedOn: string | null;
    paidOn: string | null;
    rejectedOn: string | null;
    readyOn: string | null;
    remittanceOn: string | null;
    expectedPaidOn: string | null;
    expectedPaidBySubOn: string | null;
  }
  const records: MilestoneRecord[] = [];
  for (const deal of deals) {
    const h = history.get(deal.dealId) || { m1: [], m2: [] };
    const m1Timing = computeMilestoneTiming(h.m1);
    const m2Timing = computeMilestoneTiming(h.m2);
    records.push(
      {
        deal, milestone: "M1", amount: deal.paymentIC, status: deal.m1Status, timing: m1Timing,
        // Event dates count strictly by their stamped property (no history
        // fallback) — see the resolve* docs in pe-analytics.ts.
        submittedOn: resolveSubmittedOn(deal.m1SubmissionDate),
        approvedOn: resolveApprovedOn(deal.m1ApprovalDate),
        paidOn: resolvePaidOn(deal.m1PaidDate),
        rejectedOn: resolveRejectedOn(deal.m1RejectionDate),
        // readyOn = the date it hit "Ready to Submit" (stamped property, workflow-
        // set + backfilled), else inspection-passed. The status-history fallback was
        // dropped: a manual/regressed status move (e.g. set then reverted to
        // Onboarding) used to leave a phantom "ready since X". The property is
        // correctable; a regressed deal that was never backfilled resolves to null.
        readyOn: deal.m1ReadyToSubmitDate ?? deal.inspectionPassDate ?? deal.m1SubmissionDate ?? m1Timing.firstSubmitted,
        remittanceOn: deal.m1RemittanceDate,
        expectedPaidOn: deal.m1ExpectedPaidDate,
        expectedPaidBySubOn: deal.m1ExpectedPaidBySubDate,
      },
      {
        deal, milestone: "M2", amount: deal.paymentPC, status: deal.m2Status, timing: m2Timing,
        submittedOn: resolveSubmittedOn(deal.m2SubmissionDate),
        approvedOn: resolveApprovedOn(deal.m2ApprovalDate),
        paidOn: resolvePaidOn(deal.m2PaidDate),
        rejectedOn: resolveRejectedOn(deal.m2RejectionDate),
        readyOn: deal.m2ReadyToSubmitDate ?? deal.ptoGrantedDate ?? deal.m2SubmissionDate ?? m2Timing.firstSubmitted,
        remittanceOn: deal.m2RemittanceDate,
        expectedPaidOn: deal.m2ExpectedPaidDate,
        expectedPaidBySubOn: deal.m2ExpectedPaidBySubDate,
      },
    );
  }

  // --- Report 1: payments + approvals per DAY ---------------------------------
  // All weekly charts are bucketed by day here; the client rolls these up to
  // week or month on demand (summing daily buckets is exact), so a single
  // granularity toggle drives every chart without a refetch.
  const dayKey = (date: string) => new Date(date).toISOString().slice(0, 10);
  const bucketByDay = (dateOf: (r: MilestoneRecord) => string | null): WeeklyPayments[] => {
    const map = new Map<string, WeeklyPayments>();
    for (const r of records) {
      const date = dateOf(r);
      if (!date) continue;
      const wk = dayKey(date);
      const w = map.get(wk) || { weekStart: wk, m1Count: 0, m2Count: 0, m1Amount: 0, m2Amount: 0 };
      if (r.milestone === "M1") {
        w.m1Count++;
        w.m1Amount += r.amount || 0;
      } else {
        w.m2Count++;
        w.m2Amount += r.amount || 0;
      }
      map.set(wk, w);
    }
    return [...map.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  };
  const dailyPaid = bucketByDay((r) => r.paidOn);
  const dailyApprovals = bucketByDay((r) => r.approvedOn);
  const dailySubmissions = bucketByDay((r) => r.submittedOn);
  const dailyRemittance = bucketByDay((r) => r.remittanceOn);
  const dailyExpectedPaid = bucketByDay((r) => r.expectedPaidOn);
  const dailyExpectedPaidBySub = bucketByDay((r) => r.expectedPaidBySubOn);

  // Mark the subset that has progressed past each stage (rendered faded in
  // the UI — the vivid remainder is what's still outstanding).
  const markDone = (
    arr: WeeklyPayments[],
    dateOf: (r: MilestoneRecord) => string | null,
    isDone: (r: MilestoneRecord) => boolean,
  ) => {
    const byDay = new Map(arr.map((w) => [w.weekStart, w]));
    for (const r of records) {
      const date = dateOf(r);
      if (!date || !isDone(r)) continue;
      const w = byDay.get(dayKey(date));
      if (!w) continue;
      if (r.milestone === "M1") {
        w.m1DoneCount = (w.m1DoneCount ?? 0) + 1;
        w.m1DoneAmount = (w.m1DoneAmount ?? 0) + (r.amount || 0);
      } else {
        w.m2DoneCount = (w.m2DoneCount ?? 0) + 1;
        w.m2DoneAmount = (w.m2DoneAmount ?? 0) + (r.amount || 0);
      }
    }
  };
  // Readiness view: ready-to-submit-week cohorts — has it been submitted yet?
  // Submission implies readiness: milestones that skipped the Ready to Submit
  // status (straight from onboarding to Submitted) bucket at their submission
  // week, so Total Ready − waiting always equals Total Submitted.
  const readinessMap = new Map<string, WeeklySplitCohort>();
  for (const r of records) {
    const readyDate = r.readyOn;
    if (!readyDate) continue;
    // Submitted-since requires an actual submission date so Ready − waiting
    // always equals Total Submitted exactly; waiting means the status is
    // still pre-submission. Status anomalies (past-submission status with no
    // submission date) are excluded rather than miscounted.
    const submittedSince = !!r.submittedOn;
    const waiting =
      !submittedSince &&
      (!r.status || groupForStatus(r.status) === "Onboarding" || groupForStatus(r.status) === "Ready to Submit");
    if (!submittedSince && !waiting) continue;
    const wk = dayKey(readyDate);
    const w = readinessMap.get(wk) || { weekStart: wk, doneCount: 0, doneAmount: 0, pendingCount: 0, pendingAmount: 0 };
    const amt = r.amount || 0;
    if (submittedSince) {
      w.doneCount++;
      w.doneAmount += amt;
    } else {
      w.pendingCount++;
      w.pendingAmount += amt;
    }
    readinessMap.set(wk, w);
  }
  const dailyReadiness = [...readinessMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Rejections view: first-rejection-week cohorts — fixed since (resubmitted/
  // approved/paid) vs still pending fix.
  const rejectionsMap = new Map<string, WeeklySplitCohort>();
  for (const r of records) {
    if (!r.rejectedOn) continue;
    const wk = dayKey(r.rejectedOn);
    const w = rejectionsMap.get(wk) || { weekStart: wk, doneCount: 0, doneAmount: 0, pendingCount: 0, pendingAmount: 0 };
    const amt = r.amount || 0;
    if (groupForStatus(r.status) === "Rejected — pending fix") {
      w.pendingCount++;
      w.pendingAmount += amt;
    } else {
      w.doneCount++;
      w.doneAmount += amt;
    }
    rejectionsMap.set(wk, w);
  }
  const dailyRejections = [...rejectionsMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Lifecycle view: cohorts colored by where each milestone stands today,
  // bucketed by DAY (client rolls up to week/month). Two date bases: by the
  // day each milestone became READY (inspection passed / PTO granted), and by
  // the day it was SUBMITTED — the UI toggles between them. The submitted-basis
  // series excludes not-yet-submitted milestones (they have no submission day).
  const lifecycleDayMap = new Map<string, WeeklyLifecycle>();
  const lifecycleSubmittedDayMap = new Map<string, WeeklyLifecycle>();
  const lifecycleRejectedDayMap = new Map<string, WeeklyLifecycle>();
  const emptyLifecycle = (start: string): WeeklyLifecycle => ({
    weekStart: start, paidCount: 0, paidAmount: 0, approvedCount: 0, approvedAmount: 0,
    inReviewCount: 0, inReviewAmount: 0, resubmittedCount: 0, resubmittedAmount: 0,
    rejectedCount: 0, rejectedAmount: 0, waitingCount: 0, waitingAmount: 0,
  });
  for (const r of records) {
    const readyDate = r.readyOn;
    if (!readyDate) continue;
    const waiting =
      !r.submittedOn &&
      (!r.status || groupForStatus(r.status) === "Onboarding" || groupForStatus(r.status) === "Ready to Submit");
    if (!r.submittedOn && !waiting) continue; // status anomalies excluded (matches readiness)
    const amt = r.amount || 0;
    // Classify once, then fold the same outcome into each bucket it belongs to.
    const apply = (w: WeeklyLifecycle) => {
      if (waiting) {
        w.waitingCount++;
        w.waitingAmount += amt;
      } else if (r.status === "Paid" || r.paidOn) {
        w.paidCount++;
        w.paidAmount += amt;
      } else if (r.status === "Approved" || r.approvedOn) {
        w.approvedCount++;
        w.approvedAmount += amt;
      } else if (r.status === "Resubmitted") {
        w.resubmittedCount++;
        w.resubmittedAmount += amt;
      } else if (groupForStatus(r.status) === "Rejected — pending fix") {
        w.rejectedCount++;
        w.rejectedAmount += amt;
      } else {
        w.inReviewCount++;
        w.inReviewAmount += amt;
      }
    };
    const day = dayKey(readyDate);
    const wd = lifecycleDayMap.get(day) || emptyLifecycle(day);
    apply(wd);
    lifecycleDayMap.set(day, wd);
    // Submitted-basis: only milestones that were actually submitted.
    if (r.submittedOn) {
      const sday = dayKey(r.submittedOn);
      const ws = lifecycleSubmittedDayMap.get(sday) || emptyLifecycle(sday);
      apply(ws);
      lifecycleSubmittedDayMap.set(sday, ws);
    }
    // Rejected-basis: milestones that were rejected at least once — full outcome
    // today, dated by their rejection day (recovery view: where did they land).
    if (r.rejectedOn) {
      const rday = dayKey(r.rejectedOn);
      const wr = lifecycleRejectedDayMap.get(rday) || emptyLifecycle(rday);
      apply(wr);
      lifecycleRejectedDayMap.set(rday, wr);
    }
  }
  const dailyLifecycle = [...lifecycleDayMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const dailyLifecycleSubmitted = [...lifecycleSubmittedDayMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const dailyLifecycleRejected = [...lifecycleRejectedDayMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  markDone(dailyApprovals, (r) => r.approvedOn, (r) => r.status === "Paid" || !!r.paidOn);
  // Remittance + Expected-Paid cohorts: green "done" = actually received (paid).
  markDone(dailyRemittance, (r) => r.remittanceOn, (r) => r.status === "Paid" || !!r.paidOn);
  markDone(dailyExpectedPaid, (r) => r.expectedPaidOn, (r) => r.status === "Paid" || !!r.paidOn);
  markDone(dailyExpectedPaidBySub, (r) => r.expectedPaidBySubOn, (r) => r.status === "Paid" || !!r.paidOn);
  markDone(
    dailySubmissions,
    (r) => r.submittedOn,
    (r) => !!r.approvedOn || r.status === "Approved" || r.status === "Paid",
  );
  // Submissions view also splits out the currently-rejected slice (our court)
  // and the already-paid slice (so paid is distinguishable from approved).
  {
    const byDay = new Map(dailySubmissions.map((w) => [w.weekStart, w]));
    for (const r of records) {
      if (!r.submittedOn) continue;
      const w = byDay.get(dayKey(r.submittedOn));
      if (!w) continue;
      if (groupForStatus(r.status) === "Rejected — pending fix") {
        if (r.milestone === "M1") {
          w.m1RejCount = (w.m1RejCount ?? 0) + 1;
          w.m1RejAmount = (w.m1RejAmount ?? 0) + (r.amount || 0);
        } else {
          w.m2RejCount = (w.m2RejCount ?? 0) + 1;
          w.m2RejAmount = (w.m2RejAmount ?? 0) + (r.amount || 0);
        }
      }
      if (r.status === "Paid" || r.paidOn) {
        if (r.milestone === "M1") {
          w.m1PaidCount = (w.m1PaidCount ?? 0) + 1;
          w.m1PaidAmount = (w.m1PaidAmount ?? 0) + (r.amount || 0);
        } else {
          w.m2PaidCount = (w.m2PaidCount ?? 0) + 1;
          w.m2PaidAmount = (w.m2PaidAmount ?? 0) + (r.amount || 0);
        }
      }
    }
  }

  // --- Report 2: pipeline groups ----------------------------------------------
  const pipelineMap = new Map<string, PipelineGroupRow>();
  for (const r of records) {
    const group = groupForStatus(r.status);
    if (!group) continue;
    const row = pipelineMap.get(group) || { group, m1Count: 0, m1Amount: 0, m2Count: 0, m2Amount: 0 };
    if (r.milestone === "M1") {
      row.m1Count++;
      row.m1Amount += r.amount || 0;
    } else {
      row.m2Count++;
      row.m2Amount += r.amount || 0;
    }
    pipelineMap.set(group, row);
  }
  const pipeline = PIPELINE_GROUP_ORDER.map((g) => pipelineMap.get(g)).filter(
    (r): r is PipelineGroupRow => !!r,
  );

  // --- Report 3: timing --------------------------------------------------------
  const meanDays = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const overall: TimingSummary[] = (["M1", "M2"] as const).map((m) => {
    const rs = records.filter((r) => r.milestone === m);
    const submitted = rs.filter((r) => r.timing.firstSubmitted);
    const s2a = rs.map((r) => r.timing.daysSubmitToApprove).filter((v): v is number => v !== null);
    const a2p = rs.map((r) => r.timing.daysApproveToPaid).filter((v): v is number => v !== null);
    const rejections = submitted.map((r) => r.timing.rejectionCount);
    // Averages from the HubSpot-calculated timing props (one value per deal).
    const prop = (sel: (d: PeDealRow) => number | null) => rs.map((r) => sel(r.deal)).filter((v): v is number => v !== null);
    const pS2A = prop((d) => (m === "M1" ? d.m1SubmitToApproveDays : d.m2SubmitToApproveDays));
    const pA2P = prop((d) => (m === "M1" ? d.m1ApproveToPayDays : d.m2ApproveToPayDays));
    const pR2P = prop((d) => (m === "M1" ? d.m1RemitToPayDays : d.m2RemitToPayDays));
    const pFC = prop((d) => (m === "M1" ? d.m1FullCycleDays : d.m2FullCycleDays));
    const pS2P = prop((d) => (m === "M1" ? d.m1SubmitToPayDays : d.m2SubmitToPayDays));
    // Date-derived legs as {gap, anchor} pairs so we can also window them by the
    // terminal event date below. `anchor` is the leg's endpoint (paid / submit).
    const gapPair = (start: string | null, end: string | null): { v: number | null; anchor: string | null } => {
      if (!start || !end) return { v: null, anchor: end };
      const a = Date.parse(start.length <= 10 ? `${start}T00:00:00Z` : start);
      const b = Date.parse(end.length <= 10 ? `${end}T00:00:00Z` : end);
      if (Number.isNaN(a) || Number.isNaN(b)) return { v: null, anchor: end };
      const g = Math.round((b - a) / 86_400_000);
      return { v: g >= 0 ? g : null, anchor: end };
    };
    // Construction Complete → payment, measured straight from the dates.
    const cc2pPairs = rs.map((r) => gapPair(r.deal.constructionCompleteDate, m === "M1" ? r.deal.m1PaidDate : r.deal.m2PaidDate));
    const cc2p = cc2pPairs.map((p) => p.v).filter((v): v is number => v !== null);
    // Operational-ready → submission: M1 inspection pass / M2 PTO granted → submission.
    const op2subPairs = rs.map((r) => gapPair(m === "M1" ? r.deal.inspectionPassDate : r.deal.ptoGrantedDate, m === "M1" ? r.deal.m1SubmissionDate : r.deal.m2SubmissionDate));
    const op2sub = op2subPairs.map((p) => p.v).filter((v): v is number => v !== null);

    // --- Last-30-day window: same six legs, restricted to milestones whose
    // terminal event (payment, approval, or submission) landed in the last 30
    // days. Prop legs are gated by the milestone's terminal date; date legs use
    // the pair anchors above. Small samples are expected (noisier than lifetime).
    const cutoff = Date.now() - 30 * 86_400_000;
    const within30 = (d: string | null): boolean => {
      if (!d) return false;
      const t = Date.parse(d.length <= 10 ? `${d}T00:00:00Z` : d);
      return !Number.isNaN(t) && t >= cutoff;
    };
    const paidAnchor = (d: PeDealRow) => (m === "M1" ? d.m1PaidDate : d.m2PaidDate);
    const winProp = (sel: (d: PeDealRow) => number | null, anchor: (d: PeDealRow) => string | null) => {
      const vals = rs.filter((r) => within30(anchor(r.deal))).map((r) => sel(r.deal)).filter((v): v is number => v !== null);
      return { avg: meanDays(vals), n: vals.length };
    };
    const winDates = (pairs: { v: number | null; anchor: string | null }[]) => {
      const vals = pairs.filter((p) => p.v !== null && within30(p.anchor)).map((p) => p.v as number);
      return { avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, n: vals.length };
    };
    const last30 = {
      ccToPaid: winDates(cc2pPairs),
      fullCycle: winProp((d) => (m === "M1" ? d.m1FullCycleDays : d.m2FullCycleDays), paidAnchor),
      opToSub: winDates(op2subPairs),
      submitToPay: winProp((d) => (m === "M1" ? d.m1SubmitToPayDays : d.m2SubmitToPayDays), paidAnchor),
      submitToApprove: winProp((d) => (m === "M1" ? d.m1SubmitToApproveDays : d.m2SubmitToApproveDays), (d) => (m === "M1" ? d.m1ApprovalDate : d.m2ApprovalDate)),
      approveToPay: winProp((d) => (m === "M1" ? d.m1ApproveToPayDays : d.m2ApproveToPayDays), paidAnchor),
    };
    return {
      milestone: m,
      submittedCount: submitted.length,
      approvedCount: rs.filter((r) => r.timing.firstApproved).length,
      paidCount: rs.filter((r) => r.timing.firstPaid).length,
      medianSubmitToApprove: median(s2a),
      p75SubmitToApprove: percentile(s2a, 75),
      medianApproveToPaid: median(a2p),
      p75ApproveToPaid: percentile(a2p, 75),
      avgRejections: rejections.length
        ? Math.round((rejections.reduce((a, b) => a + b, 0) / rejections.length) * 100) / 100
        : 0,
      avgSubmitToApprove: meanDays(pS2A),
      nSubmitToApprove: pS2A.length,
      avgApproveToPay: meanDays(pA2P),
      nApproveToPay: pA2P.length,
      avgRemitToPay: meanDays(pR2P),
      nRemitToPay: pR2P.length,
      avgFullCycle: meanDays(pFC),
      nFullCycle: pFC.length,
      avgSubmitToPay: meanDays(pS2P),
      nSubmitToPay: pS2P.length,
      medianCcToPaid: median(cc2p),
      avgCcToPaid: cc2p.length ? Math.round(cc2p.reduce((a, b) => a + b, 0) / cc2p.length) : null,
      ccToPaidCount: cc2p.length,
      medianOpToSub: median(op2sub),
      avgOpToSub: op2sub.length ? Math.round(op2sub.reduce((a, b) => a + b, 0) / op2sub.length) : null,
      opToSubCount: op2sub.length,
      last30,
    };
  });

  const monthlyMap = new Map<string, number[]>();
  for (const r of records) {
    if (r.timing.daysSubmitToApprove === null || !r.timing.firstApproved) continue;
    const month = r.timing.firstApproved.slice(0, 7);
    (monthlyMap.get(month) || monthlyMap.set(month, []).get(month)!).push(r.timing.daysSubmitToApprove);
  }
  const monthly: MonthlyTiming[] = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, vals]) => ({ month, medianSubmitToApprove: median(vals), approvals: vals.length }));

  // --- Report 4: rejections (DB) ------------------------------------------------
  const [docRows, changeLog, versionRows, actionItems] = await Promise.all([
    prisma
      ? prisma.peDocumentReview.findMany({ select: { dealId: true, docName: true, status: true, notes: true } })
      : Promise.resolve([]),
    prisma
      ? prisma.peDocChangeLog.findMany({
          orderBy: { createdAt: "desc" },
          select: { dealId: true, docName: true, dealName: true, newNotes: true, newStatus: true, oldStatus: true, createdAt: true },
        })
      : Promise.resolve([]),
    prisma
      ? prisma.peDocVersion
          .findMany({
            where: { dealId: { not: null } },
            select: { dealId: true, peProjectId: true, docName: true, version: true, uploadedAt: true, uploadedBy: true, fileName: true, source: true },
          })
          // Table ships with this feature — don't 500 the dashboard if the
          // migration hasn't been applied yet.
          .catch(() => [])
      : Promise.resolve([]),
    // PE reviewer action items — the authoritative rejection comment source since
    // the switch to the PE API (~2026-06-15). Before that, comments lived in
    // changeLog.newNotes; the API-sync path only writes a "Synced from PE API"
    // stub there, so the rejection panels froze. Fold these in below.
    prisma
      ? prisma.peActionItem
          .findMany({
            where: { dealId: { not: null } },
            orderBy: { actionDate: "desc" },
            select: { dealId: true, docType: true, docLabel: true, notes: true, reviewer: true, actionDate: true, resolvedAt: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const byDocMap = new Map<string, { totalEvents: number; trackedDeals: number }>();
  // Status-change events that are genuine rejections (carry a reviewer comment),
  // not bare sync log lines — these drive the rejection counts and notes.
  const rejectionLog = changeLog
    .filter((ev) => ev.newStatus === "REJECTED" || ev.newStatus === "ACTION_REQUIRED")
    .filter((ev) => hasReviewerComment(ev.newNotes));
  // deal+doc pairs that ever had a genuine (commented) rejection.
  const realRejectionHistory = new Set<string>(rejectionLog.map((ev) => `${ev.dealId}::${ev.docName}`));
  for (const row of docRows) {
    const d = byDocMap.get(row.docName) || { totalEvents: 0, trackedDeals: 0 };
    d.trackedDeals++;
    byDocMap.set(row.docName, d);
  }
  for (const ev of rejectionLog) {
    const d = byDocMap.get(ev.docName) || { totalEvents: 0, trackedDeals: 0 };
    d.totalEvents++;
    byDocMap.set(ev.docName, d);
  }

  // Rejection drill-down: split every ever-rejected (deal, doc) into open /
  // resubmitted / approved by current status, each with the rejected/resubmitted/
  // approved dates, the reviewer comment, and HubSpot + PE portal + Drive links.
  const PORTAL_ID = (process.env.HUBSPOT_PORTAL_ID ?? "").trim();
  const rejectionHsUrl = (id: string) => (PORTAL_ID ? `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-3/${id}` : "");
  const dealMetaById = new Map(deals.map((d) => [d.dealId, {
    name: d.dealName,
    portal: d.pePortalUrl,
    drive: d.driveFolderId ? `https://drive.google.com/drive/folders/${d.driveFolderId}` : null,
  }]));
  const statusByDealDoc = new Map<string, string>();
  for (const r of docRows) statusByDealDoc.set(`${r.dealId}::${r.docName}`, r.status);
  // Full status timeline per (deal, doc) for the rejected/resubmitted/approved dates.
  const changeLogByKey = new Map<string, { status: string; date: string; note: string | null }[]>();
  for (const ev of changeLog) {
    const k = `${ev.dealId}::${ev.docName}`;
    (changeLogByKey.get(k) ?? changeLogByKey.set(k, []).get(k)!).push({ status: ev.newStatus, date: ev.createdAt.toISOString(), note: ev.newNotes });
  }
  for (const list of changeLogByKey.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  // --- Fold in PE reviewer action items ---------------------------------------
  // changeLog.newNotes stopped carrying the reviewer comment when the source
  // flipped to the PE API (~2026-06-15), so any (deal, doc) rejected after that
  // is invisible to the changeLog-driven panels. PeActionItem still has the real
  // comment (reviewer, [H##] code, page, actionDate, resolvedAt). Use it to (a)
  // expand the ever-rejected history so post-cutoff rejections enter the buckets,
  // and (b) supply the comment + rejection date for drill rows and recent notes.
  const normActionDoc = (docType: string | null, docLabel: string | null) =>
    (docType ? PE_ACTION_DOC_MAP[docType] : undefined) ?? docLabel ?? docType ?? "";
  const latestActionByKey = new Map<string, { note: string; date: string; reviewer: string | null }>();
  const actionsByDeal = new Map<string, { docName: string; note: string; date: string }[]>();
  for (const ai of actionItems) {
    if (!ai.dealId) continue;
    const docName = normActionDoc(ai.docType, ai.docLabel);
    if (!docName) continue;
    const key = `${ai.dealId}::${docName}`;
    realRejectionHistory.add(key); // Set — safe to re-add existing keys
    // actionItems are ordered newest-first, so the first seen per key is latest.
    if (!latestActionByKey.has(key)) {
      latestActionByKey.set(key, { note: (ai.notes ?? "").trim(), date: ai.actionDate.toISOString(), reviewer: ai.reviewer });
    }
    if (ai.notes) {
      (actionsByDeal.get(ai.dealId) ?? actionsByDeal.set(ai.dealId, []).get(ai.dealId)!)
        .push({ docName, note: ai.notes.trim(), date: ai.actionDate.toISOString() });
    }
  }
  // Latest reviewer comment for a (deal, doc): prefer the fresh action item,
  // fall back to the pre-cutoff changeLog comment.
  const latestRejNote = (dealId: string, docName: string): string | null => {
    const a = latestActionByKey.get(`${dealId}::${docName}`);
    if (a?.note) return a.note;
    const cl = rejectionLog.find((ev) => ev.dealId === dealId && ev.docName === docName && ev.newNotes)?.newNotes;
    return cl ? cleanRejectionNote(cl) : null;
  };

  // Re-rejections after approval, at the DOC level: a doc PE had APPROVED flips
  // back to ACTION_REQUIRED/REJECTED. Days-after is measured from the doc's OWN
  // prior approval (not the milestone), so single-doc clawbacks count even before
  // the milestone is fully approved (the ANCHOR pattern on Customer Agreements).
  // `afterMilestoneApproval` flags the subset where the milestone was already
  // approved (the costliest). Same-day churn on one doc is collapsed to one row.
  const M2_RR_SET = new Set(["Signed Interconnection Agreement", "Conditional Waiver — Final Payment", "Permission to Operate (PTO)"]);
  const dealById = new Map(deals.map((d) => [d.dealId, d]));
  const reRejSeen = new Set<string>();
  const dayMs = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
  const reRejections: ReRejection[] = [];
  for (const ev of changeLog) {
    if (ev.oldStatus !== "APPROVED" || (ev.newStatus !== "ACTION_REQUIRED" && ev.newStatus !== "REJECTED")) continue;
    const deal = dealById.get(ev.dealId);
    if (!deal) continue;
    const isM2 = M2_RR_SET.has(ev.docName);
    const rejIso = ev.createdAt.toISOString();
    const rejDay = rejIso.slice(0, 10);
    // The doc's own approval date = the last APPROVED transition before this
    // re-rejection in the doc's timeline; fall back to the milestone approval
    // date if the doc's approval predates the change-log window.
    const list = changeLogByKey.get(`${ev.dealId}::${ev.docName}`) ?? [];
    const priorApproval = [...list].reverse().find((x) => x.status === "APPROVED" && x.date < rejIso);
    const milestoneApproval = isM2 ? deal.m2ApprovalDate : deal.m1ApprovalDate;
    const docApprovedOn = (priorApproval?.date ?? milestoneApproval ?? undefined)?.slice(0, 10);
    if (!docApprovedOn) continue; // can't date the approval — skip
    const dedupKey = `${ev.dealId}|${ev.docName}|${rejDay}`;
    if (reRejSeen.has(dedupKey)) continue;
    reRejSeen.add(dedupKey);
    const reAppr = list.find((x) => x.status === "APPROVED" && x.date > rejIso);
    const meta = dealMetaById.get(ev.dealId);
    reRejections.push({
      dealId: ev.dealId,
      dealName: meta?.name ?? ev.dealName ?? ev.dealId,
      milestone: isM2 ? "M2" : "M1",
      docName: ev.docName,
      approvedOn: docApprovedOn,
      reRejectedOn: rejDay,
      daysAfterApproval: Math.round((dayMs(rejDay) - dayMs(docApprovedOn)) / 86_400_000),
      fixedOn: reAppr ? reAppr.date.slice(0, 10) : null,
      daysToFix: reAppr ? Math.round((Date.parse(reAppr.date) - Date.parse(rejIso)) / 86_400_000) : null,
      reviewerNote: ev.newNotes ?? null,
      afterMilestoneApproval: !!milestoneApproval && rejDay > milestoneApproval.slice(0, 10),
      hubspotUrl: rejectionHsUrl(ev.dealId),
      pePortalUrl: meta?.portal ?? null,
    });
  }
  reRejections.sort((a, b) => b.reRejectedOn.localeCompare(a.reRejectedOn) || b.daysAfterApproval - a.daysAfterApproval);

  const dayOf = (iso: string | undefined) => (iso ? iso.slice(0, 10) : null);
  const buildDrillRow = (key: string): RejectionDrillDeal => {
    const dealId = key.slice(0, key.indexOf("::"));
    const evs = changeLogByKey.get(key) ?? [];
    const action = latestActionByKey.get(key);
    const lastRejCl = evs.filter((e) => (e.status === "REJECTED" || e.status === "ACTION_REQUIRED") && hasReviewerComment(e.note)).at(-1);
    // Rejection anchor: prefer the PE action item (fresh since the API cutoff),
    // fall back to the last commented changeLog rejection (pre-cutoff history).
    const rejDate = action?.date ?? lastRejCl?.date;
    const resub = evs.filter((e) => (e.status === "UNDER_REVIEW" || e.status === "UPLOADED") && (!rejDate || e.date > rejDate)).at(-1);
    const appr = evs.filter((e) => e.status === "APPROVED").at(-1);
    const comment = action?.note || (lastRejCl ? cleanRejectionNote(lastRejCl.note ?? "") : "");
    const meta = dealMetaById.get(dealId);
    return {
      dealName: meta?.name ?? dealId,
      dealId,
      hubspotUrl: rejectionHsUrl(dealId),
      pePortalUrl: meta?.portal ?? null,
      driveUrl: meta?.drive ?? null,
      comment: comment || null,
      dateRejected: dayOf(rejDate),
      dateResubmitted: dayOf(resub?.date),
      dateApproved: dayOf(appr?.date),
    };
  };
  const bucketsByDoc = new Map<string, { open: RejectionDrillDeal[]; resubmitted: RejectionDrillDeal[]; approved: RejectionDrillDeal[] }>();
  for (const key of realRejectionHistory) {
    const dealId = key.slice(0, key.indexOf("::"));
    const docName = key.slice(key.indexOf("::") + 2);
    if (!dealMetaById.has(dealId)) continue;
    const status = statusByDealDoc.get(key);
    const b = bucketsByDoc.get(docName) ?? { open: [], resubmitted: [], approved: [] };
    const row = buildDrillRow(key);
    if (status === "APPROVED") b.approved.push(row);
    else if (status === "UNDER_REVIEW" || status === "UPLOADED") b.resubmitted.push(row);
    else b.open.push(row); // REJECTED / ACTION_REQUIRED / NOT_UPLOADED / missing
    bucketsByDoc.set(docName, b);
  }
  const byName = (a: RejectionDrillDeal, z: RejectionDrillDeal) => a.dealName.localeCompare(z.dealName);
  const byDoc = [...byDocMap.entries()]
    .map(([docName, d]) => {
      const b = bucketsByDoc.get(docName) ?? { open: [], resubmitted: [], approved: [] };
      return {
        docName,
        totalEvents: d.totalEvents,
        trackedDeals: d.trackedDeals,
        open: b.open.length,
        resubmitted: b.resubmitted.length,
        approved: b.approved.length,
        openDeals: [...b.open].sort(byName),
        resubmittedDeals: [...b.resubmitted].sort(byName),
        approvedDeals: [...b.approved].sort(byName),
      };
    })
    .filter((d) => d.totalEvents > 0 || d.open + d.resubmitted + d.approved > 0)
    .sort((a, b) => (b.open + b.resubmitted + b.approved) - (a.open + a.resubmitted + a.approved) || b.totalEvents - a.totalEvents);

  // --- Doc-status header stats -----------------------------------------------
  // All four cards are scoped to deals actively in a milestone (PTO stage owes
  // the 12 M1 docs, Close Out owes all 15); other stages owe nothing yet.
  const stageById = new Map(deals.map((d) => [d.dealId, d.stage]));
  const m1DocSet = new Set<string>(PE_M1_DOC_NAMES);
  const scopedDeals = new Set<string>();
  const relevantRows = docRows.filter((r) => {
    const stage = stageById.get(r.dealId);
    if (stage !== PTO_STAGE_ID && stage !== CLOSEOUT_STAGE_ID && stage !== COMPLETE_STAGE_ID) return false;
    scopedDeals.add(r.dealId);
    // PTO-stage deals owe the 12 M1 docs; Close Out and Complete owe all 15.
    return stage !== PTO_STAGE_ID || m1DocSet.has(r.docName);
  });
  const docStat = (statuses: string[]) => {
    const rows = relevantRows.filter((r) => statuses.includes(r.status));
    return { docs: rows.length, deals: new Set(rows.map((r) => r.dealId)).size };
  };
  const docStats = {
    actionRequired: docStat(["ACTION_REQUIRED", "REJECTED"]),
    underReview: docStat(["UNDER_REVIEW", "UPLOADED"]),
    approvedDocs: relevantRows.filter((r) => r.status === "APPROVED").length,
    uploadedDocs: relevantRows.filter((r) => r.status !== "NOT_UPLOADED").length,
    missingExpected: docStat(["NOT_UPLOADED"]),
    scopedDeals: scopedDeals.size,
  };

  // --- Missing by document: per-doc breakdown of NOT_UPLOADED across deals that
  // owe the doc (same milestone scope as the doc-status cards). Mirrors the
  // Rejections-by-Document panel, with the same drill-down links. Excludes MOOT
  // docs: a NOT_UPLOADED doc whose milestone PE already Approved/Paid isn't a
  // real gap (PE closed the milestone without it — e.g. CA State Disclosures).
  const milestoneStatusById = new Map(deals.map((d) => [d.dealId, { m1: d.m1Status, m2: d.m2Status }]));
  const MILESTONE_DONE = new Set(["Approved", "Paid"]);
  const missingMap = new Map<string, MissingDrillDeal[]>();
  for (const r of relevantRows) {
    if (r.status !== "NOT_UPLOADED") continue;
    const ms = milestoneStatusById.get(r.dealId);
    const milestoneStatus = m1DocSet.has(r.docName) ? ms?.m1 : ms?.m2;
    if (milestoneStatus && MILESTONE_DONE.has(milestoneStatus)) continue; // moot
    const meta = dealMetaById.get(r.dealId);
    const arr = missingMap.get(r.docName) ?? [];
    arr.push({
      dealName: meta?.name ?? r.dealId,
      dealId: r.dealId,
      hubspotUrl: rejectionHsUrl(r.dealId),
      pePortalUrl: meta?.portal ?? null,
      driveUrl: meta?.drive ?? null,
    });
    missingMap.set(r.docName, arr);
  }
  const missingByDoc = [...missingMap.entries()]
    .map(([docName, ds]) => ({ docName, missing: ds.length, deals: ds.sort((a, b) => a.dealName.localeCompare(b.dealName)) }))
    .sort((a, b) => b.missing - a.missing);

  // Latest reviewer comment per doc that is STILL open (action-required), from
  // PeActionItem (the fresh source). actionItems are newest-first, so the first
  // occurrence per (deal, doc) is the latest note; keep docs currently sitting in
  // ACTION_REQUIRED / REJECTED so resolved ones drop off.
  const recentSeen = new Set<string>();
  const recentNotes: RejectionNote[] = [];
  for (const ai of actionItems) {
    if (!ai.dealId || !ai.notes) continue;
    const docName = normActionDoc(ai.docType, ai.docLabel);
    if (!docName) continue;
    const key = `${ai.dealId}::${docName}`;
    if (recentSeen.has(key)) continue;
    const cur = statusByDealDoc.get(key);
    if (cur !== "REJECTED" && cur !== "ACTION_REQUIRED") continue;
    const meta = dealMetaById.get(ai.dealId);
    if (!meta) continue;
    recentSeen.add(key);
    recentNotes.push({
      docName,
      dealName: meta.name ?? "",
      note: ai.notes.trim(),
      date: ai.actionDate.toISOString().split("T")[0],
      pePortalUrl: meta.portal ?? null,
      hubspotUrl: rejectionHsUrl(ai.dealId),
    });
    if (recentNotes.length >= 20) break;
  }

  // --- Drill-down rows ---------------------------------------------------------
  const M2_DOC_NAMES = ["Signed Interconnection Agreement", "Conditional Waiver — Final Payment", "Permission to Operate (PTO)"];
  const docStatusByDeal = new Map<string, Map<string, string>>();
  for (const r of docRows) {
    (docStatusByDeal.get(r.dealId) || docStatusByDeal.set(r.dealId, new Map()).get(r.dealId)!).set(r.docName, r.status);
  }
  const portalId = (process.env.HUBSPOT_PORTAL_ID ?? "").trim();
  // Last document upload per (deal, milestone) — the real PE review clock
  // (submission-date props get overwritten on resubmit and overstate the wait).
  // M1/M2 split mirrors the doc-name buckets above.
  const lastUploadByMile = new Map<string, Date>();
  for (const v of versionRows) {
    if (!v.dealId) continue;
    const key = `${v.dealId}::${M2_DOC_NAMES.includes(v.docName) ? "M2" : "M1"}`;
    const cur = lastUploadByMile.get(key);
    if (!cur || v.uploadedAt > cur) lastUploadByMile.set(key, v.uploadedAt);
  }
  // M1 approved gates M2 review: PE won't review M2 until M1 is approved.
  const m1ApprovedByDeal = new Map<string, boolean>();
  for (const d of deals) m1ApprovedByDeal.set(d.dealId, d.m1Status === "Approved" || d.m1Status === "Paid" || !!d.m1ApprovalDate || !!d.m1PaidDate);
  const milestones: MilestoneDrillRow[] = records
    .filter((r) => r.status || r.readyOn)
    .map((r) => {
      const docMap = docStatusByDeal.get(r.deal.dealId);
      // Conditional docs (BOM) are owed only when PE includes the slot (a row
      // exists) — don't default them to NOT_UPLOADED on deals PE didn't ask.
      const names = (r.milestone === "M1" ? [...PE_M1_DOC_NAMES] : M2_DOC_NAMES)
        .filter((n) => !PE_CONDITIONAL_DOC_NAMES.has(n) || !!docMap?.get(n));
      const missingDocs = docMap
        ? names.filter((n) => (docMap.get(n) ?? "NOT_UPLOADED") === "NOT_UPLOADED")
        : [];
      const actionRequiredDocs = docMap
        ? names.filter((n) => ["ACTION_REQUIRED", "REJECTED"].includes(docMap.get(n) ?? ""))
        : [];
      // Prefer the fresh PE action item note (newest for one of this milestone's
      // docs); fall back to the pre-cutoff changeLog comment.
      const latestActionNote = (actionsByDeal.get(r.deal.dealId) ?? []).find((a) => names.includes(a.docName))?.note ?? null;
      const latestRejectionRaw =
        rejectionLog.find(
          (ev) => ev.dealId === r.deal.dealId && ev.newNotes && names.includes(ev.docName),
        )?.newNotes ?? null;
      const latestRejectionNote = latestActionNote ?? (latestRejectionRaw ? cleanRejectionNote(latestRejectionRaw) : null);
      return {
        dealId: r.deal.dealId,
        dealName: r.deal.dealName,
        hubspotUrl: portalId
          ? `https://app.hubspot.com/contacts/${portalId}/record/0-3/${r.deal.dealId}`
          : "",
        pePortalUrl: r.deal.pePortalUrl,
        driveUrl: r.deal.driveFolderId
          ? `https://drive.google.com/drive/folders/${r.deal.driveFolderId}`
          : null,
        milestone: r.milestone,
        amount: r.amount || 0,
        status: r.status,
        // Submission implies readiness — milestones that skipped the RTS
        // status get their submission date (same rule as the cohort charts).
        readyOn: r.readyOn?.slice(0, 10) ?? null,
        rejectedOn: r.rejectedOn?.slice(0, 10) ?? null,
        submittedOn: r.submittedOn?.slice(0, 10) ?? null,
        approvedOn: r.approvedOn?.slice(0, 10) ?? null,
        paidOn: r.paidOn?.slice(0, 10) ?? null,
        remittanceOn: r.remittanceOn?.slice(0, 10) ?? null,
        expectedPaidOn: r.expectedPaidOn?.slice(0, 10) ?? null,
        expectedPaidBySubOn: r.expectedPaidBySubOn?.slice(0, 10) ?? null,
        lastUploadOn: lastUploadByMile.get(`${r.deal.dealId}::${r.milestone}`)?.toISOString().slice(0, 10) ?? null,
        // Reviewable by PE now? M1 always; M2 only once M1 is approved (M1 gates M2).
        peReviewable: r.milestone === "M1" || (m1ApprovedByDeal.get(r.deal.dealId) ?? false),
        m1ApprovedOn: r.deal.m1ApprovalDate ? String(r.deal.m1ApprovalDate).slice(0, 10) : null,
        missingDocs,
        actionRequiredDocs,
        latestRejectionNote,
      };
    });

  // --- Doc-level rejection events per day --------------------------------------
  // One event per deal+doc+day, dated by PE's "Responded:" timestamp embedded
  // in the reviewer note (true response date, goes back well before scrape
  // coverage); falls back to the scrape date.
  const dealNameById = new Map(deals.map((d) => [d.dealId, d.dealName]));
  const docRejectionSeen = new Set<string>();
  const docRejectionEvents: DocRejectionEvent[] = [];
  for (const ev of rejectionLog) {
    const responded = (ev.newNotes ?? "").match(/Responded:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    const date = responded ?? ev.createdAt.toISOString().slice(0, 10);
    const key = `${ev.dealId}|${ev.docName}|${date}`;
    if (docRejectionSeen.has(key)) continue;
    docRejectionSeen.add(key);
    const note = (ev.newNotes ?? "")
      .replace(/^Synced from PE portal scraper \([^)]*\)\s*\|\s*/, "")
      .slice(0, 240) || null;
    docRejectionEvents.push({
      date,
      dealId: ev.dealId,
      dealName: dealNameById.get(ev.dealId) ?? ev.dealName ?? ev.dealId,
      docName: ev.docName,
      note,
    });
  }
  // Fold in PE action items so the per-day chart stays fresh past the changeLog
  // comment cutoff. One event per (deal, doc, day), deduped against changeLog.
  for (const ai of actionItems) {
    if (!ai.dealId) continue;
    const docName = normActionDoc(ai.docType, ai.docLabel);
    if (!docName) continue;
    const date = ai.actionDate.toISOString().slice(0, 10);
    const key = `${ai.dealId}|${docName}|${date}`;
    if (docRejectionSeen.has(key)) continue;
    docRejectionSeen.add(key);
    docRejectionEvents.push({
      date,
      dealId: ai.dealId,
      dealName: dealNameById.get(ai.dealId) ?? ai.dealId,
      docName,
      note: (ai.notes ?? "").slice(0, 240) || null,
    });
  }
  docRejectionEvents.sort((a, b) => a.date.localeCompare(b.date));

  // Doc submissions per day: "Submitted:" stamps from portal notes (current
  // rows + change-log history) plus first transitions into review; deduped
  // per deal+doc+date so re-scrapes don't inflate counts.
  const SUBMITTED_DOC_STATES = new Set(["UNDER_REVIEW", "UPLOADED", "ACTION_REQUIRED", "REJECTED", "APPROVED"]);
  const cleanNote = (n: string | null | undefined) =>
    (n ?? "").replace(/^Synced from PE portal scraper \([^)]*\)\s*\|\s*/, "").slice(0, 240) || null;
  const subSeen = new Set<string>();
  const docSubmissionEvents: DocRejectionEvent[] = [];
  const currentDocStatus = new Map<string, string>();
  for (const r of docRows) currentDocStatus.set(`${r.dealId}|${r.docName}`, r.status);
  // PE version history (exact upload timestamps + uploader attribution),
  // keyed per deal+doc and sorted by upload time.
  const versionsByKey = new Map<string, { date: string; uploadedBy: string | null }[]>();
  for (const v of versionRows) {
    const key = `${v.dealId}|${v.docName}`;
    (versionsByKey.get(key) ?? versionsByKey.set(key, []).get(key)!).push({
      date: v.uploadedAt.toISOString().slice(0, 10),
      uploadedBy: v.uploadedBy,
    });
  }
  for (const list of versionsByKey.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  const dayDiff = (a: string, b: string) =>
    Math.abs(new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400000;
  // Uploader for a note/changelog-sourced event: nearest version within 3 days.
  const uploaderNear = (dealId: string, docName: string, date: string): string | null => {
    const list = versionsByKey.get(`${dealId}|${docName}`);
    if (!list) return null;
    let best: { d: number; by: string | null } | null = null;
    for (const v of list) {
      const d = dayDiff(v.date, date);
      if (d <= 3 && (!best || d < best.d)) best = { d, by: v.uploadedBy };
    }
    return best?.by ?? null;
  };
  const outcomeOf = (dealId: string, docName: string): "approved" | "inReview" | "rejected" => {
    const st = currentDocStatus.get(`${dealId}|${docName}`) ?? "";
    if (st === "APPROVED") return "approved";
    if (st === "ACTION_REQUIRED" || st === "REJECTED") return "rejected";
    return "inReview";
  };
  const pushSub = (dealId: string, docName: string, date: string, note: string | null, uploadedBy?: string | null) => {
    const key = `${dealId}|${docName}|${date}`;
    if (subSeen.has(key)) return;
    subSeen.add(key);
    docSubmissionEvents.push({
      date,
      dealId,
      dealName: dealNameById.get(dealId) ?? dealId,
      docName,
      note,
      outcome: outcomeOf(dealId, docName),
      uploadedBy: uploadedBy !== undefined ? uploadedBy : uploaderNear(dealId, docName, date),
    });
  };
  for (const r of docRows) {
    for (const m of (r.notes ?? "").matchAll(/Submitted:\s*(\d{4}-\d{2}-\d{2})/g)) pushSub(r.dealId, r.docName, m[1], null);
  }
  for (const ev of changeLog) {
    for (const m of (ev.newNotes ?? "").matchAll(/Submitted:\s*(\d{4}-\d{2}-\d{2})/g)) pushSub(ev.dealId, ev.docName, m[1], null);
    if (SUBMITTED_DOC_STATES.has(ev.newStatus) && !SUBMITTED_DOC_STATES.has(ev.oldStatus)) {
      pushSub(ev.dealId, ev.docName, ev.createdAt.toISOString().slice(0, 10), null);
    }
  }
  // Version uploads are submissions too — they extend history before scrape
  // coverage and capture resubmits. Only add when no note/changelog event
  // already exists within a day (timezone skew otherwise double-counts).
  const eventDatesByKey = new Map<string, string[]>();
  for (const e of docSubmissionEvents) {
    const key = `${e.dealId}|${e.docName}`;
    (eventDatesByKey.get(key) ?? eventDatesByKey.set(key, []).get(key)!).push(e.date);
  }
  for (const [key, list] of versionsByKey) {
    const [dealId, docName] = key.split("|");
    const existingDates = eventDatesByKey.get(key) ?? [];
    for (const v of list) {
      if (!existingDates.some((d) => dayDiff(d, v.date) <= 1)) {
        pushSub(dealId, docName, v.date, null, v.uploadedBy);
        existingDates.push(v.date);
        eventDatesByKey.set(key, existingDates);
      }
    }
  }
  docSubmissionEvents.sort((a, b) => a.date.localeCompare(b.date));

  // Doc approvals per day: transitions to APPROVED (change log) dated by PE's
  // "Responded:" stamp when present, plus currently-approved rows whose notes
  // carry a response date (pre-tracking approvals).
  const appSeen = new Set<string>();
  const docApprovalEvents: DocRejectionEvent[] = [];
  const pushApp = (dealId: string, docName: string, date: string, note: string | null) => {
    const key = `${dealId}|${docName}`;
    if (appSeen.has(key)) return; // a doc is approved once — keep earliest-seen
    appSeen.add(key);
    docApprovalEvents.push({ date, dealId, dealName: dealNameById.get(dealId) ?? dealId, docName, note });
  };
  for (const ev of [...changeLog].reverse()) {
    if (ev.newStatus !== "APPROVED") continue;
    const responded = (ev.newNotes ?? "").match(/Responded:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    pushApp(ev.dealId, ev.docName, responded ?? ev.createdAt.toISOString().slice(0, 10), cleanNote(ev.newNotes));
  }
  for (const r of docRows) {
    if (r.status !== "APPROVED") continue;
    const responded = (r.notes ?? "").match(/Responded:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    if (responded) pushApp(r.dealId, r.docName, responded, cleanNote(r.notes));
  }
  docApprovalEvents.sort((a, b) => a.date.localeCompare(b.date));

  // --- Report 5: funnel ----------------------------------------------------------
  // Funnel scope: only deals actually in milestone stages (PTO / Close Out /
  // Complete) — pre-milestone deals would drown the funnel in onboarding rows.
  const funnelDeals: FunnelDeal[] = deals
    .filter((d) => [PTO_STAGE_ID, CLOSEOUT_STAGE_ID, COMPLETE_STAGE_ID].includes(d.stage))
    .map((d) => ({
      location: d.location,
      m1: d.m1Status,
      m2: d.m2Status,
    }));

  // --- Header totals ---------------------------------------------------------------
  const paid = records.filter((r) => r.status === "Paid");
  const inFlightRecords = records.filter((r) => {
    const g = groupForStatus(r.status);
    return g === "In Review" || g === "Approved (unpaid)";
  });
  const a2pAll = records.map((r) => r.timing.daysApproveToPaid).filter((v): v is number => v !== null);
  const submittedAll = records.filter((r) => r.timing.firstSubmitted);
  const rejectedAtLeastOnce = submittedAll.filter((r) => r.timing.rejectionCount > 0);

  // --- Uploader payment ownership ---------------------------------------------
  // Cancelled/removed PE projects disappear from the live feed (Closed/Paid stay
  // in it), so their docs would otherwise keep dragging down approval rates with
  // no way to act on them. Exclude feed-absent projects from all uploader views.
  // Fail open: if the feed can't be fetched, include everything (no worse than before).
  let activeProjectIds: Set<string> | null = null;
  try {
    activeProjectIds = new Set((await listAllProjects()).map((p) => (p.projectId || "").trim().toUpperCase()));
  } catch (err) {
    console.warn("[pe-analytics] PE feed fetch failed; not filtering cancelled projects:", err);
  }
  // PE began recording fileName + source + uploadedBy together (~Apr 2026). A
  // version row dated after that with NO file AND NO source isn't a real upload
  // — it's an action resolved without a document (e.g. a PandaDoc lien waiver
  // pushed forward). Drop these "phantom" rows so they don't pollute uploader
  // stats or inflate the Unknown bucket. Pre-tracking rows (before metadata
  // existed) are genuine uploads and stay (they're the real "Unknown").
  const metadataStart = Math.min(
    ...versionRows.filter((v) => v.source).map((v) => new Date(v.uploadedAt).getTime()),
    Infinity,
  );
  const isPhantomVersion = (v: (typeof versionRows)[number]) =>
    !v.source && !v.fileName && new Date(v.uploadedAt).getTime() >= metadataStart;

  const uploaderVersionRows = versionRows.filter(
    (v) =>
      v.dealId &&
      dealNameById.has(v.dealId) &&
      !isPhantomVersion(v) &&
      (!activeProjectIds || !v.peProjectId || activeProjectIds.has(v.peProjectId.trim().toUpperCase())),
  );

  // When PE first recorded an uploader — everything before this is the genuine
  // pre-tracking "Unknown". Shown in the UI so Unknown reads as "pre-{date}".
  const attributionTimes = uploaderVersionRows.filter((v) => v.uploadedBy?.trim()).map((v) => new Date(v.uploadedAt).getTime());
  const attributionStart = attributionTimes.length ? new Date(Math.min(...attributionTimes)).toISOString().slice(0, 10) : null;

  // Atomic rows + deal links for the client-side Uploads Explorer.
  const uploaderRows = uploaderVersionRows.map((v) => ({
    by: v.uploadedBy?.trim() || null,
    at: new Date(v.uploadedAt).toISOString().slice(0, 10),
    dealId: v.dealId as string,
    doc: v.docName,
    ver: v.version,
    status: currentDocStatus.get(`${v.dealId}|${v.docName}`) ?? "NOT_UPLOADED",
  }));
  const dealLinks: Record<string, { name: string; hubspotUrl: string; pePortalUrl: string | null; driveUrl: string | null }> = {};
  for (const id of new Set(uploaderRows.map((r) => r.dealId))) {
    const meta = dealMetaById.get(id);
    dealLinks[id] = { name: meta?.name ?? id, hubspotUrl: rejectionHsUrl(id), pePortalUrl: meta?.portal ?? null, driveUrl: meta?.drive ?? null };
  }

  // Latest-version uploader per (deal, doc), then credit each approved/paid
  // milestone's payment to whoever owns the most of its approved docs.
  const latestUploaderByDoc = new Map<string, string | null>();
  const latestUploadAtByDoc = new Map<string, number>(); // latest version's upload time (ms) — for "last submitter"
  const maxVerByKey = new Map<string, number>();
  for (const v of uploaderVersionRows) {
    if (!v.dealId) continue;
    const k = `${v.dealId}|${v.docName}`;
    if (!maxVerByKey.has(k) || v.version > maxVerByKey.get(k)!) {
      maxVerByKey.set(k, v.version);
      latestUploaderByDoc.set(k, v.uploadedBy);
      latestUploadAtByDoc.set(k, new Date(v.uploadedAt).getTime());
    }
  }
  // Admin owner-overrides: pin the credited uploader for a (deal, doc), winning
  // over the latest-version rule (e.g. a later wrong version superseded the
  // correct one). Flows through to docsOwned, approval rate, and payment $.
  // A doc that gained a newer version since its override is flagged for re-check.
  const uploaderOverridesRaw = await getUploaderOverridesRaw();
  const overrideKeys = new Set(Object.keys(uploaderOverridesRaw));
  const resubmittedOverrideKeys = new Set<string>();
  for (const [k, ov] of Object.entries(uploaderOverridesRaw)) {
    latestUploaderByDoc.set(k, ov.uploader ? ov.uploader : null);
    if (ov.versionAtOverride != null && (maxVerByKey.get(k) ?? 0) > ov.versionAtOverride) {
      resubmittedOverrideKeys.add(k);
    }
  }
  // Unattributed PAYMENT credit: any nameless doc (no recorded uploader, any
  // date) is credited to Layla — she does the PE uploads, so unattributed
  // milestone $ is hers. This is a payment-ownership-only map; the count views
  // (Submissions / By Time / By Doc Type) keep the original Unknown, since we
  // don't actually know who physically uploaded each nameless doc. Respects
  // admin overrides (an explicit pin wins over this fallback).
  const UNATTRIBUTED_PAYMENT_OWNER = "layla@photonbrothers.com";
  const latestUploaderByDocForPay = new Map(latestUploaderByDoc);
  for (const [k, by] of latestUploaderByDoc) {
    if ((by == null || by.trim() === "") && !overrideKeys.has(k)) {
      latestUploaderByDocForPay.set(k, UNATTRIBUTED_PAYMENT_OWNER);
    }
  }

  const APPROVED_PAY = new Set(["Approved", "Paid"]);
  const PENDING_PAY = new Set(["Submitted", "Resubmitted"]); // submitted to PE, awaiting approval
  const milestonePayments: MilestonePayment[] = deals.flatMap((d) => [
    { dealId: d.dealId, milestone: "M1", docNames: [...PE_M1_DOC_NAMES], amount: d.paymentIC ?? 0, isApprovedPayment: !!d.m1Status && APPROVED_PAY.has(d.m1Status), isPaid: d.m1Status === "Paid", isPendingPayment: !!d.m1Status && PENDING_PAY.has(d.m1Status) },
    { dealId: d.dealId, milestone: "M2", docNames: M2_DOC_NAMES, amount: d.paymentPC ?? 0, isApprovedPayment: !!d.m2Status && APPROVED_PAY.has(d.m2Status), isPaid: d.m2Status === "Paid", isPendingPayment: !!d.m2Status && PENDING_PAY.has(d.m2Status) },
  ]);
  // Any payment that still lands in Unknown — e.g. a qualifying doc with a PE
  // status but no recorded upload version, which the per-doc remap above can't
  // reach — is unattributed, so fold it into Layla too. Keeps the Unknown $
  // bucket empty across the aggregates and the drill lines, for every mode.
  const foldUnknownPay = (
    owned: Map<string, { amount: number; count: number; paidAmount: number; paidCount: number; pendingAmount: number; pendingCount: number }>,
    lines: Map<string, PaymentLine[]>,
  ) => {
    const u = owned.get(UNKNOWN_UPLOADER);
    if (u) {
      const l = owned.get(UNATTRIBUTED_PAYMENT_OWNER) ?? { amount: 0, count: 0, paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0 };
      l.amount += u.amount; l.count += u.count; l.paidAmount += u.paidAmount; l.paidCount += u.paidCount; l.pendingAmount += u.pendingAmount; l.pendingCount += u.pendingCount;
      owned.set(UNATTRIBUTED_PAYMENT_OWNER, l);
      owned.delete(UNKNOWN_UPLOADER);
    }
    const ul = lines.get(UNKNOWN_UPLOADER);
    if (ul) {
      lines.set(UNATTRIBUTED_PAYMENT_OWNER, [...(lines.get(UNATTRIBUTED_PAYMENT_OWNER) ?? []), ...ul]);
      lines.delete(UNKNOWN_UPLOADER);
    }
  };
  const { owned: paymentOwnership, lines: paymentLines } = buildPaymentOwnership(milestonePayments, currentDocStatus, latestUploaderByDocForPay);
  foldUnknownPay(paymentOwnership, paymentLines);
  const withPaymentOwnership = buildUploaderStats(
    uploaderVersionRows,
    currentDocStatus,
    new Date(),
    latestUploaderByDoc, // override-adjusted owner per doc → moves docsOwned/outcomes
  ).map((s) => {
    const pay = paymentOwnership.get(s.uploader);
    return pay ? { ...s, paymentsOwned: pay.amount, milestonesOwned: pay.count, paidPaymentsOwned: pay.paidAmount, paidMilestonesOwned: pay.paidCount, pendingPaymentsOwned: pay.pendingAmount, pendingMilestonesOwned: pay.pendingCount } : s;
  });

  // Shared (fractional) ownership: split each doc among its tracked uploaders by
  // version count; an override pins the whole doc (weight 1) to its target.
  // Payment $ is ALSO split fractionally in shared mode (each milestone's $
  // shared across its approved-doc uploaders) — owner mode stays winner-take-all.
  const overrideByDoc = new Map<string, string | null>(
    Object.entries(uploaderOverridesRaw).map(([k, ov]) => [k, ov.uploader ? ov.uploader : null]),
  );
  const sharedOwners = computeSharedOwners(uploaderVersionRows, overrideByDoc);
  const { owned: paymentOwnershipFractional, lines: paymentLinesFractional } = buildPaymentOwnershipFractional(milestonePayments, currentDocStatus, latestUploaderByDocForPay);
  foldUnknownPay(paymentOwnershipFractional, paymentLinesFractional);
  const uploaderStatsShared = buildSharedUploaderStats(uploaderVersionRows, currentDocStatus, sharedOwners).map((s) => {
    const pay = paymentOwnershipFractional.get(s.uploader);
    return pay ? { ...s, paymentsOwned: pay.amount, milestonesOwned: pay.count, paidPaymentsOwned: pay.paidAmount, paidMilestonesOwned: pay.paidCount, pendingPaymentsOwned: pay.pendingAmount, pendingMilestonesOwned: pay.pendingCount } : s;
  });

  // "Last submitter" payment ownership: whole milestone $ to whoever uploaded
  // its most-recent qualifying doc. Same base (owner) stats — only the payment
  // columns differ — so the payment table can toggle Owner / Fractional / Last.
  const { owned: paymentOwnershipLast, lines: paymentLinesLast } = buildPaymentOwnershipLast(milestonePayments, currentDocStatus, latestUploaderByDocForPay, latestUploadAtByDoc);
  foldUnknownPay(paymentOwnershipLast, paymentLinesLast);
  const uploaderStatsLast = withPaymentOwnership.map((s) => {
    const pay = paymentOwnershipLast.get(s.uploader);
    return {
      ...s,
      paymentsOwned: pay?.amount ?? 0,
      milestonesOwned: pay?.count ?? 0,
      paidPaymentsOwned: pay?.paidAmount ?? 0,
      paidMilestonesOwned: pay?.paidCount ?? 0,
      pendingPaymentsOwned: pay?.pendingAmount ?? 0,
      pendingMilestonesOwned: pay?.pendingCount ?? 0,
    };
  });

  // Enrich each ownership mode's per-uploader milestone lines with deal name +
  // links — the drill behind every $ figure in the Approved $ view.
  const enrichPaymentLines = (lm: Map<string, PaymentLine[]>): Record<string, UploaderPaymentLine[]> => {
    const out: Record<string, UploaderPaymentLine[]> = {};
    for (const [who, arr] of lm) {
      out[who] = arr
        .map((l) => {
          const meta = dealMetaById.get(l.dealId);
          return {
            dealId: l.dealId,
            dealName: meta?.name ?? l.dealId,
            milestone: (l.milestone === "M1" ? "IC" : "PC") as "IC" | "PC",
            amount: l.amount,
            bucket: l.bucket,
            hubspotUrl: rejectionHsUrl(l.dealId),
            pePortalUrl: meta?.portal ?? null,
            driveUrl: meta?.drive ?? null,
          };
        })
        .sort((a, b) => b.amount - a.amount);
    }
    return out;
  };
  const uploaderPayments = enrichPaymentLines(paymentLines);
  const uploaderPaymentsShared = enrichPaymentLines(paymentLinesFractional);
  const uploaderPaymentsLast = enrichPaymentLines(paymentLinesLast);

  // Per-uploader owned docs split by current outcome (latest version owns the
  // status) — powers the approved / in-review / rejected drill-downs.
  const dealPortalUrl = new Map(deals.map((d) => [d.dealId, d.pePortalUrl]));
  const uploaderDocs: Record<string, UploaderOutcomeDocs> = {};
  for (const [k, who] of latestUploaderByDoc) {
    const status = currentDocStatus.get(k);
    const bucket: keyof UploaderOutcomeDocs | null =
      status === "APPROVED" ? "approved"
        : status === "ACTION_REQUIRED" || status === "REJECTED" ? "rejected"
          : status === "UNDER_REVIEW" || status === "UPLOADED" ? "inReview"
            : null;
    if (!bucket) continue;
    const sep = k.indexOf("|");
    const dealId = k.slice(0, sep);
    const docName = k.slice(sep + 1);
    if (!dealNameById.has(dealId)) continue;
    const clean = bucket === "rejected" ? latestRejNote(dealId, docName) : null;
    const key = who?.trim() || UNKNOWN_UPLOADER;
    const entry = (uploaderDocs[key] ??= { approved: [], inReview: [], rejected: [], superseded: [] });
    const doc: UploaderDoc = {
      dealId,
      dealName: dealNameById.get(dealId) ?? dealId,
      docName,
      hubspotUrl: portalId ? `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}` : "",
      pePortalUrl: dealPortalUrl.get(dealId) ?? null,
      driveUrl: dealMetaById.get(dealId)?.drive ?? null,
      note: clean,
      overridden: overrideKeys.has(k),
      resubmitted: resubmittedOverrideKeys.has(k),
    };
    entry[bucket].push(doc);
  }

  // Shared-mode drills: a multi-contributor doc appears under each person with weight.
  const uploaderDocsShared: Record<string, UploaderOutcomeDocs> = {};
  for (const [k, owners] of sharedOwners) {
    const status = currentDocStatus.get(k);
    const bucket: keyof UploaderOutcomeDocs | null =
      status === "APPROVED" ? "approved"
        : status === "ACTION_REQUIRED" || status === "REJECTED" ? "rejected"
          : status === "UNDER_REVIEW" || status === "UPLOADED" ? "inReview"
            : null;
    if (!bucket) continue;
    const sep = k.indexOf("|");
    const dealId = k.slice(0, sep);
    const docName = k.slice(sep + 1);
    if (!dealNameById.has(dealId)) continue;
    const clean = bucket === "rejected" ? latestRejNote(dealId, docName) : null;
    for (const { who, weight } of owners) {
      const key = who?.trim() || UNKNOWN_UPLOADER;
      const entry = (uploaderDocsShared[key] ??= { approved: [], inReview: [], rejected: [], superseded: [] });
      entry[bucket].push({
        dealId,
        dealName: dealNameById.get(dealId) ?? dealId,
        docName,
        hubspotUrl: portalId ? `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}` : "",
        pePortalUrl: dealPortalUrl.get(dealId) ?? null,
      driveUrl: dealMetaById.get(dealId)?.drive ?? null,
        note: clean,
        overridden: overrideKeys.has(k),
        resubmitted: resubmittedOverrideKeys.has(k),
        weight,
      });
    }
  }

  // Who superseded each doc: the actual latest-version uploader (pre-override).
  const latestVerUploaderByKey = new Map<string, string | null>();
  for (const v of uploaderVersionRows) {
    if (!v.dealId) continue;
    const k = `${v.dealId}|${v.docName}`;
    if (v.version >= (maxVerByKey.get(k) ?? 0)) latestVerUploaderByKey.set(k, v.uploadedBy);
  }
  // Superseded uploads: any version below the latest for its (deal, doc) — an
  // older upload that a resubmission replaced — credited to whoever uploaded it.
  // Feeds both owner and shared drill-downs (it's the same upload event).
  for (const v of uploaderVersionRows) {
    if (!v.dealId) continue;
    const k = `${v.dealId}|${v.docName}`;
    if (v.version >= (maxVerByKey.get(k) ?? 0)) continue; // the latest isn't superseded
    if (!dealNameById.has(v.dealId)) continue;
    const key = v.uploadedBy?.trim() || UNKNOWN_UPLOADER;
    const doc: UploaderDoc = {
      dealId: v.dealId,
      dealName: dealNameById.get(v.dealId) ?? v.dealId,
      docName: v.docName,
      hubspotUrl: portalId ? `https://app.hubspot.com/contacts/${portalId}/record/0-3/${v.dealId}` : "",
      pePortalUrl: dealPortalUrl.get(v.dealId) ?? null,
      driveUrl: dealMetaById.get(v.dealId)?.drive ?? null,
      note: null,
      version: v.version,
      uploadedAt: new Date(v.uploadedAt).toISOString().slice(0, 10),
      supersededBy: latestVerUploaderByKey.get(k)?.trim() || undefined,
    };
    (uploaderDocs[key] ??= { approved: [], inReview: [], rejected: [], superseded: [] }).superseded.push(doc);
    (uploaderDocsShared[key] ??= { approved: [], inReview: [], rejected: [], superseded: [] }).superseded.push(doc);
  }

  return {
    lastUpdated: new Date().toISOString(),
    totals: {
      totalPaid: paid.reduce((s, r) => s + (r.amount || 0), 0),
      paidCount: paid.length,
      inFlight: inFlightRecords.reduce((s, r) => s + (r.amount || 0), 0),
      inFlightCount: inFlightRecords.length,
      medianApproveToPaidDays: median(a2pAll),
      rejectionRatePct: submittedAll.length
        ? Math.round((rejectedAtLeastOnce.length / submittedAll.length) * 1000) / 10
        : null,
    },
    docStats,
    dailyPaid,
    dailyApprovals,
    dailySubmissions,
    dailyRemittance,
    dailyExpectedPaid,
    dailyExpectedPaidBySub,
    dailyLifecycle,
    dailyLifecycleSubmitted,
    dailyLifecycleRejected,
    dailyReadiness,
    dailyRejections,
    milestones,
    docRejectionEvents,
    docSubmissionEvents,
    docApprovalEvents,
    // Scope uploader stats to docs on deals in this payload's PE deal set —
    // versionRows already excludes unmatched portal projects (dealId null).
    // currentDocStatus (keyed `${dealId}|${docName}`) drives the per-person
    // approved / rejected / in-review outcome split, and the merged-in payment
    // ownership ($ of approved milestone payments each person drove).
    uploaderStats: withPaymentOwnership,
    uploaderStatsShared,
    uploaderStatsLast,
    uploaderDocs,
    uploaderDocsShared,
    reRejections,
    uploaderPayments,
    uploaderPaymentsShared,
    uploaderPaymentsLast,
    // Per-period uploads segmented by person — powers the By Day/Week/Month
    // stacked bars; doc-type breakdown powers the "By Doc Type" view.
    uploadsByPeriod: buildUploadsByPeriod(
      uploaderVersionRows,
    ),
    docTypeByUploader: buildDocTypeByUploader(
      uploaderVersionRows,
    ),
    pipeline,
    timing: { overall, monthly },
    rejections: { byDoc, recentNotes },
    missingByDoc,
    funnelDeals,
    attributionStart,
    uploaderRows,
    dealLinks,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEYS.PE_ANALYTICS,
      buildPayload,
      false,
      { ttl: ANALYTICS_TTL_MS },
    );
    return NextResponse.json({ ...data, lastUpdated });
  } catch (error) {
    console.error("[pe-analytics] failed:", error);
    return NextResponse.json(
      { error: "Failed to build PE analytics" },
      { status: 502 },
    );
  }
}
