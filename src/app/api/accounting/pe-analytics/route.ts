import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { searchWithRetry, hubspotClient } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS } from "@/lib/deals-pipeline";
import { PE_LEASE, calcLeaseFactorAdjustment, DC_QUALIFYING_MODULE_BRANDS, DC_QUALIFYING_BATTERY_BRANDS, type PeSystemType } from "@/lib/pricing-calculator";
import { EC_QUALIFYING_ZIPS } from "@/lib/ec-qualifying-zips";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { prisma } from "@/lib/db";
import {
  weekStartUTC,
  groupForStatus,
  computeMilestoneTiming,
  median,
  percentile,
  PIPELINE_GROUP_ORDER,
  PE_M1_DOC_NAMES,
  type PeAnalyticsPayload,
  type WeeklyPayments,
  type WeeklyLifecycle,
  type WeeklyReadiness,
  type MilestoneDrillRow,
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
}

// ---------------------------------------------------------------------------
// Payment amount fallback — same lease-factor math as the pe-deals route, for
// deals whose pe_payment_ic/pc were never opportunistically synced.
// ---------------------------------------------------------------------------

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
      },
      {
        deal, milestone: "M2", amount: deal.paymentPC, status: deal.m2Status, timing: m2Timing,
        submittedOn: deal.m2SubmissionDate ?? m2Timing.firstSubmitted,
        approvedOn: deal.m2ApprovalDate ?? m2Timing.firstApproved,
        paidOn: deal.m2PaidDate ?? m2Timing.firstPaid,
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
  const readinessMap = new Map<string, WeeklyReadiness>();
  for (const r of records) {
    const readyDate = r.timing.firstReadyToSubmit ?? r.submittedOn;
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
    const w = readinessMap.get(wk) || { weekStart: wk, submittedCount: 0, submittedAmount: 0, waitingCount: 0, waitingAmount: 0 };
    const amt = r.amount || 0;
    if (submittedSince) {
      w.submittedCount++;
      w.submittedAmount += amt;
    } else {
      w.waitingCount++;
      w.waitingAmount += amt;
    }
    readinessMap.set(wk, w);
  }
  const weeklyReadiness = [...readinessMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Lifecycle view: submission-week cohorts, colored by where each milestone
  // stands today (paid → approved-unpaid → still in review).
  const lifecycleMap = new Map<string, WeeklyLifecycle>();
  for (const r of records) {
    if (!r.submittedOn) continue;
    const wk = weekStartUTC(new Date(r.submittedOn));
    const w =
      lifecycleMap.get(wk) ||
      { weekStart: wk, paidCount: 0, paidAmount: 0, approvedCount: 0, approvedAmount: 0, inReviewCount: 0, inReviewAmount: 0 };
    const amt = r.amount || 0;
    if (r.status === "Paid" || r.paidOn) {
      w.paidCount++;
      w.paidAmount += amt;
    } else if (r.status === "Approved" || r.approvedOn) {
      w.approvedCount++;
      w.approvedAmount += amt;
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
  const [docRows, changeLog] = await Promise.all([
    prisma
      ? prisma.peDocumentReview.findMany({ select: { dealId: true, docName: true, status: true } })
      : Promise.resolve([]),
    prisma
      ? prisma.peDocChangeLog.findMany({
          where: { newStatus: { in: ["REJECTED", "ACTION_REQUIRED"] } },
          orderBy: { createdAt: "desc" },
          select: { docName: true, dealName: true, newNotes: true, createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  const byDocMap = new Map<
    string,
    { totalEvents: number; currentlyRejected: number; currentActionRequired: number; trackedDeals: number }
  >();
  for (const row of docRows) {
    const d = byDocMap.get(row.docName) || { totalEvents: 0, currentlyRejected: 0, currentActionRequired: 0, trackedDeals: 0 };
    d.trackedDeals++;
    if (row.status === "REJECTED") d.currentlyRejected++;
    if (row.status === "ACTION_REQUIRED") d.currentActionRequired++;
    byDocMap.set(row.docName, d);
  }
  for (const ev of changeLog) {
    const d = byDocMap.get(ev.docName) || { totalEvents: 0, currentlyRejected: 0, currentActionRequired: 0, trackedDeals: 0 };
    d.totalEvents++;
    byDocMap.set(ev.docName, d);
  }
  const byDoc = [...byDocMap.entries()]
    .map(([docName, d]) => ({ docName, ...d }))
    .filter((d) => d.totalEvents > 0 || d.currentlyRejected > 0 || d.currentActionRequired > 0)
    .sort((a, b) => b.totalEvents + b.currentlyRejected + b.currentActionRequired - (a.totalEvents + a.currentlyRejected + a.currentActionRequired));

  // --- Doc-status header stats -----------------------------------------------
  // All four cards are scoped to deals actively in a milestone (PTO stage owes
  // the 12 M1 docs, Close Out owes all 15); other stages owe nothing yet.
  const stageById = new Map(deals.map((d) => [d.dealId, d.stage]));
  const m1DocSet = new Set<string>(PE_M1_DOC_NAMES);
  const scopedDeals = new Set<string>();
  const relevantRows = docRows.filter((r) => {
    const stage = stageById.get(r.dealId);
    if (stage !== PTO_STAGE_ID && stage !== CLOSEOUT_STAGE_ID) return false;
    scopedDeals.add(r.dealId);
    return stage === CLOSEOUT_STAGE_ID || m1DocSet.has(r.docName);
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

  const recentNotes = changeLog
    .filter((ev) => ev.newNotes)
    .slice(0, 20)
    .map((ev) => ({
      docName: ev.docName,
      dealName: ev.dealName || "",
      note: ev.newNotes!,
      date: ev.createdAt.toISOString().split("T")[0],
    }));

  // --- Drill-down rows ---------------------------------------------------------
  const M2_DOC_NAMES = ["Signed Interconnection Agreement", "Conditional Waiver — Final Payment", "Permission to Operate (PTO)"];
  const docStatusByDeal = new Map<string, Map<string, string>>();
  for (const r of docRows) {
    (docStatusByDeal.get(r.dealId) || docStatusByDeal.set(r.dealId, new Map()).get(r.dealId)!).set(r.docName, r.status);
  }
  const portalId = (process.env.HUBSPOT_PORTAL_ID ?? "").trim();
  const milestones: MilestoneDrillRow[] = records
    .filter((r) => r.status || r.timing.firstReadyToSubmit)
    .map((r) => {
      const docMap = docStatusByDeal.get(r.deal.dealId);
      const names = r.milestone === "M1" ? [...PE_M1_DOC_NAMES] : M2_DOC_NAMES;
      const missingDocs = docMap
        ? names.filter((n) => (docMap.get(n) ?? "NOT_UPLOADED") === "NOT_UPLOADED")
        : [];
      return {
        dealId: r.deal.dealId,
        dealName: r.deal.dealName,
        hubspotUrl: portalId
          ? `https://app.hubspot.com/contacts/${portalId}/record/0-3/${r.deal.dealId}`
          : "",
        milestone: r.milestone,
        amount: r.amount || 0,
        status: r.status,
        readyOn: r.timing.firstReadyToSubmit?.slice(0, 10) ?? null,
        submittedOn: r.submittedOn?.slice(0, 10) ?? null,
        approvedOn: r.approvedOn?.slice(0, 10) ?? null,
        paidOn: r.paidOn?.slice(0, 10) ?? null,
        missingDocs,
      };
    });

  // --- Report 5: funnel ----------------------------------------------------------
  const funnelDeals: FunnelDeal[] = deals.map((d) => ({
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
    milestones,
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
