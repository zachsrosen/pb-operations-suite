/**
 * PE Analytics — pure helpers and shared types.
 *
 * Logic for bucketing PE milestone payments by week, grouping M1/M2 statuses
 * into pipeline stages, and computing submission→approval→payment timing from
 * HubSpot property history. Kept free of I/O so it can be unit-tested.
 */

// ---------------------------------------------------------------------------
// Week bucketing
// ---------------------------------------------------------------------------

/** ISO date (YYYY-MM-DD) of the UTC Monday starting the week containing d. */
export function weekStartUTC(d: Date): string {
  const dt = new Date(d);
  const day = (dt.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Status grouping (Report 2 — expected revenue pipeline)
// ---------------------------------------------------------------------------

export type PipelineGroup =
  | "Onboarding"
  | "Ready to Submit"
  | "In Review"
  | "Rejected — pending fix"
  | "Approved (unpaid)"
  | "Paid"
  | "Other";

export const PIPELINE_GROUP_ORDER: PipelineGroup[] = [
  "Onboarding",
  "Ready to Submit",
  "In Review",
  "Rejected — pending fix",
  "Approved (unpaid)",
  "Paid",
  "Other",
];

const STATUS_TO_GROUP: Record<string, PipelineGroup> = {
  "Waiting on Information": "Onboarding",
  "Ready for Onboarding": "Onboarding",
  "Onboarding Submitted": "Onboarding",
  "Onboarding Rejected": "Onboarding",
  "Onboarding Ready to Resubmit": "Onboarding",
  "Onboarding Resubmitted": "Onboarding",
  "Ready to Submit": "Ready to Submit",
  Submitted: "In Review",
  Resubmitted: "In Review",
  Rejected: "Rejected — pending fix",
  "Ready to Resubmit": "Rejected — pending fix",
  Approved: "Approved (unpaid)",
  Paid: "Paid",
};

/** Map a raw pe_m1_status / pe_m2_status value to its pipeline group. */
export function groupForStatus(status: string | null | undefined): PipelineGroup | null {
  if (!status) return null;
  return STATUS_TO_GROUP[status] ?? "Other";
}

// ---------------------------------------------------------------------------
// Timing from property history
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  value: string;
  timestamp: string;
}

export interface MilestoneTiming {
  firstReadyToSubmit: string | null;
  firstRejected: string | null;
  firstSubmitted: string | null;
  firstApproved: string | null;
  firstPaid: string | null;
  rejectionCount: number;
  daysSubmitToApprove: number | null;
  daysApproveToPaid: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const diff = (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY;
  return diff >= 0 ? Math.round(diff * 10) / 10 : null;
}

/**
 * Compute timing landmarks from a milestone's status history.
 * History entries may be in any order; submission = first Submitted or
 * Resubmitted, approval = first Approved, payment = first Paid.
 * Onboarding-phase statuses are ignored (they track onboarding, not the
 * milestone package itself).
 */
export function computeMilestoneTiming(history: HistoryEntry[]): MilestoneTiming {
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const firstWith = (values: string[]): string | null =>
    sorted.find((h) => values.includes(h.value))?.timestamp ?? null;

  const firstReadyToSubmit = firstWith(["Ready to Submit"]);
  const firstRejected = firstWith(["Rejected"]);
  const firstSubmitted = firstWith(["Submitted", "Resubmitted"]);
  const firstApproved = firstWith(["Approved"]);
  const firstPaid = firstWith(["Paid"]);
  const rejectionCount = sorted.filter((h) => h.value === "Rejected").length;

  return {
    firstReadyToSubmit,
    firstRejected,
    firstSubmitted,
    firstApproved,
    firstPaid,
    rejectionCount,
    daysSubmitToApprove: daysBetween(firstSubmitted, firstApproved),
    daysApproveToPaid: daysBetween(firstApproved, firstPaid),
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// API payload types (shared by route + page)
// ---------------------------------------------------------------------------

export interface WeeklyPayments {
  weekStart: string;
  m1Count: number;
  m2Count: number;
  m1Amount: number;
  m2Amount: number;
  /**
   * Subset that has progressed past this stage (rendered faded):
   * approvals view → already paid; submissions view → already approved.
   */
  m1DoneCount?: number;
  m2DoneCount?: number;
  m1DoneAmount?: number;
  m2DoneAmount?: number;
  /** Submissions view: subset currently rejected / pending fix (orange slice). */
  m1RejCount?: number;
  m2RejCount?: number;
  m1RejAmount?: number;
  m2RejAmount?: number;
  /** Submissions view: subset already paid (deep-green slice under approved). */
  m1PaidCount?: number;
  m2PaidCount?: number;
  m1PaidAmount?: number;
  m2PaidAmount?: number;
}

/**
 * Two-segment cohort weeks: done = progressed past the stage (green),
 * pending = still stuck at it. Used by the Ready-to-Submit view
 * (done = submitted since, pending = waiting on submission) and the
 * Rejections view (done = resolved since, pending = still pending fix).
 */
export interface WeeklySplitCohort {
  weekStart: string;
  doneCount: number;
  doneAmount: number;
  pendingCount: number;
  pendingAmount: number;
}

/** Lifecycle view: ready-to-submit-week cohorts colored by current outcome. */
export interface WeeklyLifecycle {
  weekStart: string;
  paidCount: number;
  paidAmount: number;
  approvedCount: number; // approved, awaiting payment
  approvedAmount: number;
  inReviewCount: number; // submitted, in PE review
  inReviewAmount: number;
  rejectedCount: number; // currently rejected / pending fix
  rejectedAmount: number;
  waitingCount: number; // ready but not yet submitted
  waitingAmount: number;
}

export interface PipelineGroupRow {
  group: PipelineGroup;
  m1Count: number;
  m1Amount: number;
  m2Count: number;
  m2Amount: number;
}

export interface TimingSummary {
  milestone: "M1" | "M2";
  submittedCount: number;
  approvedCount: number;
  paidCount: number;
  medianSubmitToApprove: number | null;
  p75SubmitToApprove: number | null;
  medianApproveToPaid: number | null;
  p75ApproveToPaid: number | null;
  avgRejections: number;
}

export interface MonthlyTiming {
  month: string; // YYYY-MM
  medianSubmitToApprove: number | null;
  approvals: number;
}

export interface RejectionByDoc {
  docName: string;
  totalEvents: number;
  currentlyRejected: number;
  currentActionRequired: number;
  trackedDeals: number;
}

export interface RejectionNote {
  docName: string;
  dealName: string;
  note: string;
  date: string;
}

export interface FunnelDeal {
  location: string;
  m1: string | null;
  m2: string | null;
}

/**
 * Doc → milestone mapping. M1 includes the 4 onboarding docs plus the
 * inspection package (12 total); M2 is only IC agreement, final lien
 * waiver, and PTO. The PE_DOC_HUBSPOT_MAP order does NOT encode this.
 */
export const PE_M1_DOC_NAMES = [
  "Customer Agreement (PPA/ESA)",
  "Installation Order",
  "State Disclosures",
  "Utility Bill",
  "Signed Proposal",
  "Design Plan",
  "Photos per Policy",
  "Signed Final Permit",
  "Access to Monitoring",
  "Certificate of Acceptance",
  "Attestation of Customer Payment",
  "Conditional Progress Lien Waiver",
] as const;

export interface DocStatusStat {
  docs: number;
  deals: number;
}

export interface DocStats {
  actionRequired: DocStatusStat; // incl. legacy REJECTED — fixes owed to PE
  underReview: DocStatusStat; // incl. legacy UPLOADED — waiting on PE
  approvedDocs: number;
  uploadedDocs: number; // any status except NOT_UPLOADED
  /**
   * Expected-but-missing docs, scoped by deal stage: PTO-stage deals owe the
   * 12 M1 docs, Close Out deals owe all 15. Other stages don't count.
   */
  missingExpected: DocStatusStat;
  scopedDeals: number; // tracked deals in PTO or Close Out
}

/** Document-level rejection event (PE reviewer response), one per deal+doc+day. */
export interface DocRejectionEvent {
  date: string; // YYYY-MM-DD — PE's Responded date (scrape date fallback)
  dealId: string;
  dealName: string;
  docName: string;
  note: string | null;
  /** Submission events only: the doc's CURRENT outcome. */
  outcome?: "approved" | "inReview" | "rejected";
  /** Submission events only: uploader email from PE version history; null = unknown (pre-tracking). */
  uploadedBy?: string | null;
}

/** Label used wherever an upload has no attribution (pre-tracking versions). */
export const UNKNOWN_UPLOADER = "Unknown";

/** Doc-upload counts per person, from PE portal version history. */
export interface UploaderStat {
  uploader: string; // email, or UNKNOWN_UPLOADER for null-attribution uploads
  total: number; // all-time uploads (every version action)
  last8w: number; // uploads in the trailing 56 days
  deals: number; // distinct deals touched (all time)
  // Outcome of the docs this person most-recently uploaded (per distinct
  // deal+doc, attributed to whoever uploaded the latest version). Denominator
  // for the approval rate is approved + rejected + inReview.
  docsOwned: number; // distinct docs where this person uploaded the latest version
  approved: number;
  rejected: number; // ACTION_REQUIRED or REJECTED
  inReview: number; // UNDER_REVIEW or UPLOADED
  // Approved PE milestone payments this person "owns" — they uploaded the most
  // approved docs on the milestone (top KNOWN uploader wins; Unknown only when
  // no approved doc has a known uploader). Populated by buildPaymentOwnership.
  paymentsOwned: number; // $ of approved/paid milestone payments owned
  milestonesOwned: number; // count of those milestones
}

/** One approved/paid milestone with its payment amount and doc set. */
export interface MilestonePayment {
  dealId: string;
  docNames: string[]; // the milestone's canonical doc set (M1 = 12, M2 = 3)
  amount: number;
  isApprovedPayment: boolean; // milestone status is Approved or Paid
}

/**
 * Attribute each approved/paid milestone's payment to the person who uploaded
 * the most of its APPROVED docs (by latest version). The top KNOWN uploader
 * wins even if Unknown technically uploaded more — Unknown only owns a payment
 * when no approved doc on it has a known uploader. Returns uploader → {amount,
 * count}. Keys match UploaderStat.uploader (UNKNOWN_UPLOADER for the no-known
 * case).
 */
export function buildPaymentOwnership(
  milestones: MilestonePayment[],
  statusByDoc: Map<string, string>, // `${dealId}|${docName}` → status
  latestUploaderByDoc: Map<string, string | null>, // `${dealId}|${docName}` → uploader
): Map<string, { amount: number; count: number }> {
  const owned = new Map<string, { amount: number; count: number }>();
  const add = (who: string, amt: number) => {
    const e = owned.get(who) ?? { amount: 0, count: 0 };
    e.amount += amt;
    e.count += 1;
    owned.set(who, e);
  };
  for (const m of milestones) {
    if (!m.isApprovedPayment || m.amount <= 0) continue;
    const approvedDocs = m.docNames.filter((n) => statusByDoc.get(`${m.dealId}|${n}`) === "APPROVED");
    if (approvedDocs.length === 0) continue;
    const tally = new Map<string, number>();
    for (const n of approvedDocs) {
      const by = latestUploaderByDoc.get(`${m.dealId}|${n}`)?.trim() || UNKNOWN_UPLOADER;
      tally.set(by, (tally.get(by) ?? 0) + 1);
    }
    const knownTop = [...tally.entries()]
      .filter(([w]) => w !== UNKNOWN_UPLOADER)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    add(knownTop ? knownTop[0] : UNKNOWN_UPLOADER, m.amount);
  }
  return owned;
}

/** Per-period upload counts segmented by uploader, for the stacked bars. */
export interface DailyUpload {
  day: string; // period key: YYYY-MM-DD (day/week-start) or YYYY-MM (month)
  total: number;
  deals: number; // distinct deals touched that period
  byUploader: Record<string, number>; // uploader → uploads that period
}

export type UploadGranularity = "day" | "week" | "month";

/** All three period series, so the chart can toggle without a refetch. */
export interface UploadsByPeriod {
  day: DailyUpload[]; // trailing 90 days
  week: DailyUpload[]; // all time, ISO week
  month: DailyUpload[]; // all time, calendar month
}

/** Monday-start ISO week key (YYYY-MM-DD of the week's Monday, UTC). */
function weekKey(at: Date): string {
  const x = new Date(at);
  const dow = (x.getUTCDay() + 6) % 7; // 0 = Monday
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

/**
 * Bucket version uploads into per-period counts segmented by uploader. Day
 * granularity keeps the trailing 90 days; week/month cover all time. Empty
 * periods are omitted. Null uploaders group under UNKNOWN_UPLOADER. Sorted
 * oldest → newest.
 */
export function buildPeriodUploads(
  rows: { uploadedAt: Date | string; uploadedBy: string | null; dealId?: string | null }[],
  granularity: UploadGranularity = "day",
  now: Date = new Date(),
): DailyUpload[] {
  const cutoff = granularity === "day" ? new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) : null;
  const buckets = new Map<string, Map<string, number>>();
  const dealsByKey = new Map<string, Set<string>>();
  for (const r of rows) {
    const at = typeof r.uploadedAt === "string" ? new Date(r.uploadedAt) : r.uploadedAt;
    if (isNaN(at.getTime()) || (cutoff && at < cutoff)) continue;
    const key = granularity === "month" ? at.toISOString().slice(0, 7) : granularity === "week" ? weekKey(at) : at.toISOString().slice(0, 10);
    const who = r.uploadedBy?.trim() || UNKNOWN_UPLOADER;
    const m = buckets.get(key) ?? new Map<string, number>();
    m.set(who, (m.get(who) ?? 0) + 1);
    buckets.set(key, m);
    if (r.dealId) {
      const s = dealsByKey.get(key) ?? new Set<string>();
      s.add(r.dealId);
      dealsByKey.set(key, s);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, m]) => {
      const byUploader: Record<string, number> = {};
      let total = 0;
      for (const [who, n] of m) {
        byUploader[who] = n;
        total += n;
      }
      return { day, total, deals: dealsByKey.get(day)?.size ?? 0, byUploader };
    });
}

/** Build all three period series in one pass. */
export function buildUploadsByPeriod(
  rows: { uploadedAt: Date | string; uploadedBy: string | null; dealId?: string | null }[],
  now: Date = new Date(),
): UploadsByPeriod {
  return {
    day: buildPeriodUploads(rows, "day", now),
    week: buildPeriodUploads(rows, "week", now),
    month: buildPeriodUploads(rows, "month", now),
  };
}

/** Per-person breakdown of which document types they uploaded. */
export interface UploaderDocTypes {
  uploader: string;
  total: number; // distinct docs owned
  byDoc: Record<string, number>; // canonical doc name → count
}

/**
 * For each uploader, count the distinct docs they own (latest version) by
 * document type. Null uploaders group under UNKNOWN_UPLOADER. Sorted by total
 * descending, Unknown last.
 */
export function buildDocTypeByUploader(
  rows: { uploadedBy: string | null; dealId: string | null; docName: string; version: number }[],
): UploaderDocTypes[] {
  const latest = new Map<string, { version: number; by: string | null; doc: string }>();
  for (const r of rows) {
    if (!r.dealId) continue;
    const k = `${r.dealId}|${r.docName}`;
    const cur = latest.get(k);
    if (!cur || r.version > cur.version) latest.set(k, { version: r.version, by: r.uploadedBy, doc: r.docName });
  }
  const byUploader = new Map<string, Map<string, number>>();
  for (const [, o] of latest) {
    const who = o.by?.trim() || UNKNOWN_UPLOADER;
    const m = byUploader.get(who) ?? new Map<string, number>();
    m.set(o.doc, (m.get(o.doc) ?? 0) + 1);
    byUploader.set(who, m);
  }
  return [...byUploader.entries()]
    .map(([uploader, m]) => {
      const byDoc: Record<string, number> = {};
      let total = 0;
      for (const [doc, n] of m) {
        byDoc[doc] = n;
        total += n;
      }
      return { uploader, total, byDoc };
    })
    .sort((a, b) => {
      if (a.uploader === UNKNOWN_UPLOADER) return 1;
      if (b.uploader === UNKNOWN_UPLOADER) return -1;
      return b.total - a.total || a.uploader.localeCompare(b.uploader);
    });
}

type VersionRow = {
  uploadedBy: string | null;
  uploadedAt: Date | string;
  dealId: string | null;
  docName: string;
  version: number;
};

/**
 * Roll PE doc version rows up into per-uploader stats. Null/empty uploadedBy
 * groups under UNKNOWN_UPLOADER (PE only started attributing uploads partway
 * through — we admit the gap rather than guess). Sorted by total descending,
 * with the Unknown bucket always last.
 *
 * Outcome attribution: each distinct (dealId, docName) is credited to whoever
 * uploaded its LATEST version — that's the upload currently under PE review —
 * and its current status (from statusByDoc, keyed `${dealId}|${docName}`)
 * lands in approved / rejected / inReview. Docs with no status, or a
 * NOT_UPLOADED status, count toward docsOwned but no outcome bucket.
 */
export function buildUploaderStats(
  rows: VersionRow[],
  statusByDoc: Map<string, string> = new Map(),
  now: Date = new Date(),
): UploaderStat[] {
  const cutoff = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000);
  const byUploader = new Map<
    string,
    { total: number; last8w: number; deals: Set<string>; docsOwned: number; approved: number; rejected: number; inReview: number }
  >();
  const ensure = (key: string) => {
    let e = byUploader.get(key);
    if (!e) {
      e = { total: 0, last8w: 0, deals: new Set<string>(), docsOwned: 0, approved: 0, rejected: 0, inReview: 0 };
      byUploader.set(key, e);
    }
    return e;
  };

  // Volume metrics: every version action.
  for (const r of rows) {
    const e = ensure(r.uploadedBy?.trim() || UNKNOWN_UPLOADER);
    e.total++;
    const at = typeof r.uploadedAt === "string" ? new Date(r.uploadedAt) : r.uploadedAt;
    if (at >= cutoff) e.last8w++;
    if (r.dealId) e.deals.add(r.dealId);
  }

  // Outcome metrics: latest version per (deal, doc) owns the current status.
  const latest = new Map<string, VersionRow>();
  for (const r of rows) {
    if (!r.dealId) continue;
    const k = `${r.dealId}|${r.docName}`;
    const cur = latest.get(k);
    if (!cur || r.version > cur.version) latest.set(k, r);
  }
  for (const [k, r] of latest) {
    const e = ensure(r.uploadedBy?.trim() || UNKNOWN_UPLOADER);
    e.docsOwned++;
    const status = statusByDoc.get(k);
    if (status === "APPROVED") e.approved++;
    else if (status === "ACTION_REQUIRED" || status === "REJECTED") e.rejected++;
    else if (status === "UNDER_REVIEW" || status === "UPLOADED") e.inReview++;
  }

  return [...byUploader.entries()]
    .map(([uploader, e]) => ({
      uploader,
      total: e.total,
      last8w: e.last8w,
      deals: e.deals.size,
      docsOwned: e.docsOwned,
      approved: e.approved,
      rejected: e.rejected,
      inReview: e.inReview,
      paymentsOwned: 0, // merged in by the route via buildPaymentOwnership
      milestonesOwned: 0,
    }))
    .sort((a, b) => {
      if (a.uploader === UNKNOWN_UPLOADER) return 1;
      if (b.uploader === UNKNOWN_UPLOADER) return -1;
      return b.total - a.total || a.uploader.localeCompare(b.uploader);
    });
}

/** Per-milestone record powering the chart drill-down. */
export interface MilestoneDrillRow {
  dealId: string;
  dealName: string;
  hubspotUrl: string;
  /** Direct link to the PE (Participate Energy) portal project, if known. */
  pePortalUrl: string | null;
  /** Link to the deal's Google Drive document folder, if known. */
  driveUrl: string | null;
  milestone: "M1" | "M2";
  amount: number;
  status: string | null;
  readyOn: string | null;
  rejectedOn: string | null;
  submittedOn: string | null;
  approvedOn: string | null;
  paidOn: string | null;
  /** Milestone-relevant docs not yet uploaded (empty when fully uploaded or untracked). */
  missingDocs: string[];
  /** Milestone-relevant docs currently flagged ACTION_REQUIRED/REJECTED by PE. */
  actionRequiredDocs: string[];
  /** Latest PE reviewer note on an action-required doc for this milestone. */
  latestRejectionNote: string | null;
}

/** One currently-rejected doc, for the per-uploader rejected-docs drill-down. */
export interface RejectedDoc {
  dealName: string;
  docName: string;
  hubspotUrl: string;
  pePortalUrl: string | null;
  note: string | null; // latest PE reviewer note, cleaned
}

export interface PeAnalyticsPayload {
  lastUpdated: string;
  totals: {
    totalPaid: number;
    paidCount: number;
    inFlight: number; // submitted + approved, unpaid
    inFlightCount: number;
    medianApproveToPaidDays: number | null;
    rejectionRatePct: number | null; // % of submitted milestones rejected at least once
  };
  docStats: DocStats;
  weekly: WeeklyPayments[];
  weeklyApprovals: WeeklyPayments[];
  weeklySubmissions: WeeklyPayments[];
  weeklyLifecycle: WeeklyLifecycle[];
  weeklyReadiness: WeeklySplitCohort[];
  weeklyRejections: WeeklySplitCohort[];
  milestones: MilestoneDrillRow[];
  docRejectionEvents: DocRejectionEvent[];
  docSubmissionEvents: DocRejectionEvent[];
  docApprovalEvents: DocRejectionEvent[];
  /** Doc uploads per person (PE version history); Unknown bucket = pre-tracking uploads. */
  uploaderStats: UploaderStat[];
  /** Per-uploader list of docs currently ACTION_REQUIRED/REJECTED (latest version owner) — powers the rejected-docs drill-down. Keyed by uploader (UNKNOWN_UPLOADER for null). */
  uploaderRejections: Record<string, RejectedDoc[]>;
  uploadsByPeriod: UploadsByPeriod;
  docTypeByUploader: UploaderDocTypes[];
  pipeline: PipelineGroupRow[];
  timing: { overall: TimingSummary[]; monthly: MonthlyTiming[] };
  rejections: { byDoc: RejectionByDoc[]; recentNotes: RejectionNote[] };
  funnelDeals: FunnelDeal[];
}
