import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { searchWithRetry, hubspotClient } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS } from "@/lib/deals-pipeline";
import { PE_LEASE, calcLeaseFactorAdjustment, DC_QUALIFYING_MODULE_BRANDS, DC_QUALIFYING_BATTERY_BRANDS, type PeSystemType } from "@/lib/pricing-calculator";
import { EC_QUALIFYING_ZIPS } from "@/lib/ec-qualifying-zips";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { listAllProjects } from "@/lib/pe-api";
import { getUploaderOverridesRaw } from "@/lib/pe-uploader-overrides";
import { prisma } from "@/lib/db";
import {
  weekStartUTC,
  groupForStatus,
  computeMilestoneTiming,
  median,
  percentile,
  buildUploaderStats,
  buildSharedUploaderStats,
  computeSharedOwners,
  buildPaymentOwnership,
  buildUploadsByPeriod,
  buildDocTypeByUploader,
  PIPELINE_GROUP_ORDER,
  PE_M1_DOC_NAMES,
  UNKNOWN_UPLOADER,
  type UploaderDoc,
  type UploaderOutcomeDocs,
  type PeAnalyticsPayload,
  type WeeklyPayments,
  type WeeklyLifecycle,
  type WeeklySplitCohort,
  type MilestoneDrillRow,
  type RejectionDrillDeal,
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
  "pe_m1_approval_date",
  "pe_m2_approval_date",
  "pe_m1_paid_date",
  "pe_m2_paid_date",
  "pe_m1_rejection_date",
  "pe_m2_rejection_date",
  "inspections_completion_date",
  "pto_completion_date",
  "pe_portal_url",
  "all_document_parent_folder_id",
];

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
  inspectionPassDate: string | null; // M1 operational ready
  ptoGrantedDate: string | null; // M2 operational ready
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
        inspectionPassDate: p.inspections_completion_date ? String(p.inspections_completion_date) : null,
        ptoGrantedDate: p.pto_completion_date ? String(p.pto_completion_date) : null,
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
  }
  const records: MilestoneRecord[] = [];
  for (const deal of deals) {
    const h = history.get(deal.dealId) || { m1: [], m2: [] };
    const m1Timing = computeMilestoneTiming(h.m1);
    const m2Timing = computeMilestoneTiming(h.m2);
    records.push(
      {
        deal, milestone: "M1", amount: deal.paymentIC, status: deal.m1Status, timing: m1Timing,
        submittedOn: deal.m1SubmissionDate ?? m1Timing.firstSubmitted,
        approvedOn: deal.m1ApprovalDate ?? m1Timing.firstApproved,
        paidOn: deal.m1PaidDate ?? m1Timing.firstPaid,
        rejectedOn: deal.m1RejectionDate ?? m1Timing.firstRejected,
        readyOn: deal.inspectionPassDate ?? m1Timing.firstReadyToSubmit ?? deal.m1SubmissionDate ?? m1Timing.firstSubmitted,
      },
      {
        deal, milestone: "M2", amount: deal.paymentPC, status: deal.m2Status, timing: m2Timing,
        submittedOn: deal.m2SubmissionDate ?? m2Timing.firstSubmitted,
        approvedOn: deal.m2ApprovalDate ?? m2Timing.firstApproved,
        paidOn: deal.m2PaidDate ?? m2Timing.firstPaid,
        rejectedOn: deal.m2RejectionDate ?? m2Timing.firstRejected,
        readyOn: deal.ptoGrantedDate ?? m2Timing.firstReadyToSubmit ?? deal.m2SubmissionDate ?? m2Timing.firstSubmitted,
      },
    );
  }

  // --- Report 1: payments + approvals per week --------------------------------
  const bucketByWeek = (dateOf: (r: MilestoneRecord) => string | null): WeeklyPayments[] => {
    const map = new Map<string, WeeklyPayments>();
    for (const r of records) {
      const date = dateOf(r);
      if (!date) continue;
      const wk = weekStartUTC(new Date(date));
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
  const weekly = bucketByWeek((r) => r.paidOn);
  const weeklyApprovals = bucketByWeek((r) => r.approvedOn);
  const weeklySubmissions = bucketByWeek((r) => r.submittedOn);

  // Mark the subset that has progressed past each stage (rendered faded in
  // the UI — the vivid remainder is what's still outstanding).
  const markDone = (
    arr: WeeklyPayments[],
    dateOf: (r: MilestoneRecord) => string | null,
    isDone: (r: MilestoneRecord) => boolean,
  ) => {
    const byWeek = new Map(arr.map((w) => [w.weekStart, w]));
    for (const r of records) {
      const date = dateOf(r);
      if (!date || !isDone(r)) continue;
      const w = byWeek.get(weekStartUTC(new Date(date)));
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
    const wk = weekStartUTC(new Date(readyDate));
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
  const weeklyReadiness = [...readinessMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Rejections view: first-rejection-week cohorts — fixed since (resubmitted/
  // approved/paid) vs still pending fix.
  const rejectionsMap = new Map<string, WeeklySplitCohort>();
  for (const r of records) {
    if (!r.rejectedOn) continue;
    const wk = weekStartUTC(new Date(r.rejectedOn));
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
  const weeklyRejections = [...rejectionsMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Lifecycle view: ready-to-submit-week cohorts (same inclusion rules as the
  // readiness view), colored by where each milestone stands today.
  const lifecycleMap = new Map<string, WeeklyLifecycle>();
  for (const r of records) {
    const readyDate = r.readyOn;
    if (!readyDate) continue;
    const waiting =
      !r.submittedOn &&
      (!r.status || groupForStatus(r.status) === "Onboarding" || groupForStatus(r.status) === "Ready to Submit");
    if (!r.submittedOn && !waiting) continue; // status anomalies excluded (matches readiness)
    const wk = weekStartUTC(new Date(readyDate));
    const w =
      lifecycleMap.get(wk) ||
      { weekStart: wk, paidCount: 0, paidAmount: 0, approvedCount: 0, approvedAmount: 0, inReviewCount: 0, inReviewAmount: 0, rejectedCount: 0, rejectedAmount: 0, waitingCount: 0, waitingAmount: 0 };
    const amt = r.amount || 0;
    if (waiting) {
      w.waitingCount++;
      w.waitingAmount += amt;
    } else if (r.status === "Paid" || r.paidOn) {
      w.paidCount++;
      w.paidAmount += amt;
    } else if (r.status === "Approved" || r.approvedOn) {
      w.approvedCount++;
      w.approvedAmount += amt;
    } else if (groupForStatus(r.status) === "Rejected — pending fix") {
      w.rejectedCount++;
      w.rejectedAmount += amt;
    } else {
      w.inReviewCount++;
      w.inReviewAmount += amt;
    }
    lifecycleMap.set(wk, w);
  }
  const weeklyLifecycle = [...lifecycleMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  markDone(weeklyApprovals, (r) => r.approvedOn, (r) => r.status === "Paid" || !!r.paidOn);
  markDone(
    weeklySubmissions,
    (r) => r.submittedOn,
    (r) => !!r.approvedOn || r.status === "Approved" || r.status === "Paid",
  );
  // Submissions view also splits out the currently-rejected slice (our court)
  // and the already-paid slice (so paid is distinguishable from approved).
  {
    const byWeek = new Map(weeklySubmissions.map((w) => [w.weekStart, w]));
    for (const r of records) {
      if (!r.submittedOn) continue;
      const w = byWeek.get(weekStartUTC(new Date(r.submittedOn)));
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
  const overall: TimingSummary[] = (["M1", "M2"] as const).map((m) => {
    const rs = records.filter((r) => r.milestone === m);
    const submitted = rs.filter((r) => r.timing.firstSubmitted);
    const s2a = rs.map((r) => r.timing.daysSubmitToApprove).filter((v): v is number => v !== null);
    const a2p = rs.map((r) => r.timing.daysApproveToPaid).filter((v): v is number => v !== null);
    const rejections = submitted.map((r) => r.timing.rejectionCount);
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
  const [docRows, changeLog, versionRows] = await Promise.all([
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
            select: { dealId: true, peProjectId: true, docName: true, version: true, uploadedAt: true, uploadedBy: true },
          })
          // Table ships with this feature — don't 500 the dashboard if the
          // migration hasn't been applied yet.
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
  const dayOf = (iso: string | undefined) => (iso ? iso.slice(0, 10) : null);
  const buildDrillRow = (key: string): RejectionDrillDeal => {
    const dealId = key.slice(0, key.indexOf("::"));
    const evs = changeLogByKey.get(key) ?? [];
    const lastRej = evs.filter((e) => (e.status === "REJECTED" || e.status === "ACTION_REQUIRED") && hasReviewerComment(e.note)).at(-1);
    const resub = evs.filter((e) => (e.status === "UNDER_REVIEW" || e.status === "UPLOADED") && (!lastRej || e.date > lastRej.date)).at(-1);
    const appr = evs.filter((e) => e.status === "APPROVED").at(-1);
    const meta = dealMetaById.get(dealId);
    return {
      dealName: meta?.name ?? dealId,
      dealId,
      hubspotUrl: rejectionHsUrl(dealId),
      pePortalUrl: meta?.portal ?? null,
      driveUrl: meta?.drive ?? null,
      comment: lastRej ? cleanRejectionNote(lastRej.note ?? "") : null,
      dateRejected: dayOf(lastRej?.date),
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

  const recentNotes = rejectionLog
    .filter((ev) => ev.newNotes)
    // Only docs still OPEN (rejected / action-required) — drop notes whose doc
    // has since been resubmitted or approved (the rejection is resolved).
    .filter((ev) => {
      const cur = statusByDealDoc.get(`${ev.dealId}::${ev.docName}`);
      return cur === "REJECTED" || cur === "ACTION_REQUIRED";
    })
    .slice(0, 20)
    .map((ev) => ({
      docName: ev.docName,
      dealName: dealMetaById.get(ev.dealId)?.name ?? ev.dealName ?? "",
      note: cleanRejectionNote(ev.newNotes!),
      date: ev.createdAt.toISOString().split("T")[0],
      pePortalUrl: dealMetaById.get(ev.dealId)?.portal ?? null,
      hubspotUrl: rejectionHsUrl(ev.dealId),
    }));

  // --- Drill-down rows ---------------------------------------------------------
  const M2_DOC_NAMES = ["Signed Interconnection Agreement", "Conditional Waiver — Final Payment", "Permission to Operate (PTO)"];
  const docStatusByDeal = new Map<string, Map<string, string>>();
  for (const r of docRows) {
    (docStatusByDeal.get(r.dealId) || docStatusByDeal.set(r.dealId, new Map()).get(r.dealId)!).set(r.docName, r.status);
  }
  const portalId = (process.env.HUBSPOT_PORTAL_ID ?? "").trim();
  const milestones: MilestoneDrillRow[] = records
    .filter((r) => r.status || r.readyOn)
    .map((r) => {
      const docMap = docStatusByDeal.get(r.deal.dealId);
      const names = r.milestone === "M1" ? [...PE_M1_DOC_NAMES] : M2_DOC_NAMES;
      const missingDocs = docMap
        ? names.filter((n) => (docMap.get(n) ?? "NOT_UPLOADED") === "NOT_UPLOADED")
        : [];
      const actionRequiredDocs = docMap
        ? names.filter((n) => ["ACTION_REQUIRED", "REJECTED"].includes(docMap.get(n) ?? ""))
        : [];
      const latestRejectionRaw =
        rejectionLog.find(
          (ev) => ev.dealId === r.deal.dealId && ev.newNotes && names.includes(ev.docName),
        )?.newNotes ?? null;
      const latestRejectionNote = latestRejectionRaw ? cleanRejectionNote(latestRejectionRaw) : null;
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
  const uploaderVersionRows = versionRows.filter(
    (v) =>
      v.dealId &&
      dealNameById.has(v.dealId) &&
      (!activeProjectIds || !v.peProjectId || activeProjectIds.has(v.peProjectId.trim().toUpperCase())),
  );

  // Latest-version uploader per (deal, doc), then credit each approved/paid
  // milestone's payment to whoever owns the most of its approved docs.
  const latestUploaderByDoc = new Map<string, string | null>();
  const maxVerByKey = new Map<string, number>();
  for (const v of uploaderVersionRows) {
    if (!v.dealId) continue;
    const k = `${v.dealId}|${v.docName}`;
    if (!maxVerByKey.has(k) || v.version > maxVerByKey.get(k)!) {
      maxVerByKey.set(k, v.version);
      latestUploaderByDoc.set(k, v.uploadedBy);
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
  const APPROVED_PAY = new Set(["Approved", "Paid"]);
  const PENDING_PAY = new Set(["Submitted", "Resubmitted"]); // submitted to PE, awaiting approval
  const milestonePayments = deals.flatMap((d) => [
    { dealId: d.dealId, docNames: [...PE_M1_DOC_NAMES], amount: d.paymentIC ?? 0, isApprovedPayment: !!d.m1Status && APPROVED_PAY.has(d.m1Status), isPendingPayment: !!d.m1Status && PENDING_PAY.has(d.m1Status) },
    { dealId: d.dealId, docNames: M2_DOC_NAMES, amount: d.paymentPC ?? 0, isApprovedPayment: !!d.m2Status && APPROVED_PAY.has(d.m2Status), isPendingPayment: !!d.m2Status && PENDING_PAY.has(d.m2Status) },
  ]);
  const paymentOwnership = buildPaymentOwnership(milestonePayments, currentDocStatus, latestUploaderByDoc);
  const withPaymentOwnership = buildUploaderStats(
    uploaderVersionRows,
    currentDocStatus,
    new Date(),
    latestUploaderByDoc, // override-adjusted owner per doc → moves docsOwned/outcomes
  ).map((s) => {
    const pay = paymentOwnership.get(s.uploader);
    return pay ? { ...s, paymentsOwned: pay.amount, milestonesOwned: pay.count, pendingPaymentsOwned: pay.pendingAmount, pendingMilestonesOwned: pay.pendingCount } : s;
  });

  // Shared (fractional) ownership: split each doc among its tracked uploaders by
  // version count; an override pins the whole doc (weight 1) to its target.
  // Payment $ stays owner-based in both modes (it tracks who drove the payment).
  const overrideByDoc = new Map<string, string | null>(
    Object.entries(uploaderOverridesRaw).map(([k, ov]) => [k, ov.uploader ? ov.uploader : null]),
  );
  const sharedOwners = computeSharedOwners(uploaderVersionRows, overrideByDoc);
  const uploaderStatsShared = buildSharedUploaderStats(uploaderVersionRows, currentDocStatus, sharedOwners).map((s) => {
    const pay = paymentOwnership.get(s.uploader);
    return pay ? { ...s, paymentsOwned: pay.amount, milestonesOwned: pay.count, pendingPaymentsOwned: pay.pendingAmount, pendingMilestonesOwned: pay.pendingCount } : s;
  });

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
    const note = bucket === "rejected"
      ? (rejectionLog.find((ev) => ev.dealId === dealId && ev.docName === docName && ev.newNotes)?.newNotes ?? null)
      : null;
    const clean = note ? cleanRejectionNote(note) : null;
    const key = who?.trim() || UNKNOWN_UPLOADER;
    const entry = (uploaderDocs[key] ??= { approved: [], inReview: [], rejected: [] });
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
    const note = bucket === "rejected"
      ? (rejectionLog.find((ev) => ev.dealId === dealId && ev.docName === docName && ev.newNotes)?.newNotes ?? null)
      : null;
    const clean = note ? cleanRejectionNote(note) : null;
    for (const { who, weight } of owners) {
      const key = who?.trim() || UNKNOWN_UPLOADER;
      const entry = (uploaderDocsShared[key] ??= { approved: [], inReview: [], rejected: [] });
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
    weekly,
    weeklyApprovals,
    weeklySubmissions,
    weeklyLifecycle,
    weeklyReadiness,
    weeklyRejections,
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
    uploaderDocs,
    uploaderDocsShared,
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
    funnelDeals,
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
