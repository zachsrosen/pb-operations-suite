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
  | "Internally Rejected"
  | "In Review"
  | "Rejected — pending fix"
  | "Approved (unpaid)"
  | "Paid"
  | "Other";

export const PIPELINE_GROUP_ORDER: PipelineGroup[] = [
  "Onboarding",
  "Ready to Submit",
  "Internally Rejected",
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
  // Set by us before/instead of a real PE submission — back in our court, not a
  // PE review state. Not "submitted" (it has no stamped submission date, so the
  // strict-date resolvers never count it).
  "Internally Rejected": "Internally Rejected",
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

/**
 * Date a milestone counts as "submitted" / "approved" / "rejected" / "paid" for
 * chart bucketing — STRICTLY the stamped HubSpot property, no status-history
 * fallback.
 *
 * The PE workflow stamps pe_m*_submission_date / _approval_date / _rejection_date
 * / _paid_date on every real event, so a missing date means the event simply
 * isn't counted yet. Status history is unreliable here: a status briefly flipped
 * to (e.g.) "Submitted" or "Paid" and then reverted leaves a permanent entry
 * that would otherwise be miscounted as a phantom event. Counting only stamped
 * dates can't be fooled by those reverted flips.
 *
 * resolveSubmittedOn keeps its 3-arg signature (call sites pass status /
 * firstSubmitted) so this stays the single decision point if a history fallback
 * is ever reconsidered, but the extra args are intentionally unused today.
 */
export function resolveSubmittedOn(
  submissionDate: string | null | undefined,
  _status?: string | null,
  _firstSubmitted?: string | null,
): string | null {
  return submissionDate || null;
}

/** Date a milestone counts as approved — strictly the stamped pe_m*_approval_date. */
export function resolveApprovedOn(approvalDate: string | null | undefined): string | null {
  return approvalDate || null;
}

/** Date a milestone counts as rejected — strictly the stamped pe_m*_rejection_date. */
export function resolveRejectedOn(rejectionDate: string | null | undefined): string | null {
  return rejectionDate || null;
}

/** Date a milestone counts as paid — strictly the stamped pe_m*_paid_date. */
export function resolvePaidOn(paidDate: string | null | undefined): string | null {
  return paidDate || null;
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
  resubmittedCount: number; // resubmitted after a rejection, back in PE review
  resubmittedAmount: number;
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

export interface RejectionDrillDeal {
  dealName: string;
  dealId: string;
  hubspotUrl: string;
  pePortalUrl: string | null;
  driveUrl: string | null;
  comment: string | null; // latest genuine PE rejection reason
  dateRejected: string | null; // YYYY-MM-DD
  dateResubmitted: string | null;
  dateApproved: string | null;
}

export interface RejectionByDoc {
  docName: string;
  totalEvents: number;
  trackedDeals: number;
  // Outcome of docs that were ever genuinely rejected, split three ways.
  open: number; // still rejected / action-required
  resubmitted: number; // fixed and back under review (awaiting PE)
  approved: number; // PE accepted the fix
  openDeals: RejectionDrillDeal[];
  resubmittedDeals: RejectionDrillDeal[];
  approvedDeals: RejectionDrillDeal[];
}

export interface RejectionNote {
  docName: string;
  dealName: string;
  note: string;
  date: string;
  pePortalUrl: string | null;
  hubspotUrl: string;
}

/** A deal that owes a doc (in a milestone) but hasn't uploaded it yet. */
export interface MissingDrillDeal {
  dealName: string;
  dealId: string;
  hubspotUrl: string;
  pePortalUrl: string | null;
  driveUrl: string | null;
}

/** Per-document breakdown of NOT_UPLOADED docs across deals that owe them. */
export interface MissingByDoc {
  docName: string;
  missing: number; // count of scoped deals (in a milestone) missing this doc
  deals: MissingDrillDeal[];
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
  "Bill of Materials", // split into its own PE upload 2026-06 (was bundled in Photos)
  "Signed Final Permit",
  "Access to Monitoring",
  "Certificate of Acceptance",
  "Attestation of Customer Payment",
  "Conditional Progress Lien Waiver",
] as const;

/**
 * Docs PE only requires on *some* projects. Unlike the always-required docs, a
 * conditional doc is "owed" by a deal only when PE actually includes its slot —
 * i.e. when a synced doc row exists for it. PE adds the Bill of Materials slot
 * only to the projects it wants one for (it's absent from the documents object
 * on the rest), so we must not show it as missing everywhere. The sync skips
 * writing a NOT_UPLOADED row for these when the API omits the slot, and the
 * tracker/analytics only count them as owed when a row exists.
 */
export const PE_CONDITIONAL_DOC_NAMES = new Set<string>(["Bill of Materials"]);

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
   * 13 M1 docs, Close Out deals owe all 16. Other stages don't count.
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
  // Subset of paymentsOwned where PE has actually PAID the milestone (status
  // "Paid"), so the UI can split approved-awaiting-payment from already-paid.
  paidPaymentsOwned: number; // $ of paid milestone payments owned
  paidMilestonesOwned: number; // count of those milestones
  // Same ownership, but for milestones submitted to PE and still awaiting
  // approval (not yet approved/paid) — the "in review" payment pipeline.
  pendingPaymentsOwned: number; // $ of submitted-but-unapproved milestone payments owned
  pendingMilestonesOwned: number; // count of those milestones
}

/** One approved/paid milestone with its payment amount and doc set. */
export interface MilestonePayment {
  dealId: string;
  docNames: string[]; // the milestone's canonical doc set (M1 = 12, M2 = 3)
  amount: number;
  isApprovedPayment: boolean; // milestone status is Approved or Paid
  isPaid: boolean; // milestone status is specifically Paid (subset of approved)
  isPendingPayment: boolean; // milestone submitted to PE, awaiting approval (not yet approved/paid)
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
): Map<string, { amount: number; count: number; paidAmount: number; paidCount: number; pendingAmount: number; pendingCount: number }> {
  const owned = new Map<string, { amount: number; count: number; paidAmount: number; paidCount: number; pendingAmount: number; pendingCount: number }>();
  const ensure = (who: string) => {
    let e = owned.get(who);
    if (!e) { e = { amount: 0, count: 0, paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0 }; owned.set(who, e); }
    return e;
  };
  // Credit a milestone's $ to the top KNOWN uploader of its `qualifying` docs
  // (approved docs for approved milestones; in-review docs for pending ones).
  const credit = (m: MilestonePayment, qualifyingStatuses: Set<string>, pending: boolean) => {
    const docs = m.docNames.filter((n) => qualifyingStatuses.has(statusByDoc.get(`${m.dealId}|${n}`) ?? ""));
    if (docs.length === 0) return;
    const tally = new Map<string, number>();
    for (const n of docs) {
      const by = latestUploaderByDoc.get(`${m.dealId}|${n}`)?.trim() || UNKNOWN_UPLOADER;
      tally.set(by, (tally.get(by) ?? 0) + 1);
    }
    const knownTop = [...tally.entries()]
      .filter(([w]) => w !== UNKNOWN_UPLOADER)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const e = ensure(knownTop ? knownTop[0] : UNKNOWN_UPLOADER);
    if (pending) { e.pendingAmount += m.amount; e.pendingCount += 1; }
    else {
      e.amount += m.amount; e.count += 1;
      if (m.isPaid) { e.paidAmount += m.amount; e.paidCount += 1; }
    }
  };
  const APPROVED = new Set(["APPROVED"]);
  const IN_REVIEW = new Set(["UNDER_REVIEW", "UPLOADED"]);
  for (const m of milestones) {
    if (m.amount <= 0) continue;
    if (m.isApprovedPayment) credit(m, APPROVED, false);
    else if (m.isPendingPayment) credit(m, IN_REVIEW, true);
  }
  return owned;
}

/**
 * Fractional variant of buildPaymentOwnership: instead of crediting a whole
 * milestone's $ to its top uploader, SPLIT it across the uploaders of its
 * qualifying docs by their share (uploader's doc count ÷ total qualifying docs).
 * Counts become fractional too. Unknown gets the share of any docs with no
 * known uploader. Same return shape as buildPaymentOwnership.
 */
export function buildPaymentOwnershipFractional(
  milestones: MilestonePayment[],
  statusByDoc: Map<string, string>,
  latestUploaderByDoc: Map<string, string | null>,
): Map<string, { amount: number; count: number; paidAmount: number; paidCount: number; pendingAmount: number; pendingCount: number }> {
  const owned = new Map<string, { amount: number; count: number; paidAmount: number; paidCount: number; pendingAmount: number; pendingCount: number }>();
  const ensure = (who: string) => {
    let e = owned.get(who);
    if (!e) { e = { amount: 0, count: 0, paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0 }; owned.set(who, e); }
    return e;
  };
  const credit = (m: MilestonePayment, qualifyingStatuses: Set<string>, pending: boolean) => {
    const docs = m.docNames.filter((n) => qualifyingStatuses.has(statusByDoc.get(`${m.dealId}|${n}`) ?? ""));
    if (docs.length === 0) return;
    const tally = new Map<string, number>();
    for (const n of docs) {
      const by = latestUploaderByDoc.get(`${m.dealId}|${n}`)?.trim() || UNKNOWN_UPLOADER;
      tally.set(by, (tally.get(by) ?? 0) + 1);
    }
    const total = docs.length;
    for (const [who, cnt] of tally) {
      const share = cnt / total;
      const e = ensure(who);
      if (pending) { e.pendingAmount += m.amount * share; e.pendingCount += share; }
      else {
        e.amount += m.amount * share; e.count += share;
        if (m.isPaid) { e.paidAmount += m.amount * share; e.paidCount += share; }
      }
    }
  };
  const APPROVED = new Set(["APPROVED"]);
  const IN_REVIEW = new Set(["UNDER_REVIEW", "UPLOADED"]);
  for (const m of milestones) {
    if (m.amount <= 0) continue;
    if (m.isApprovedPayment) credit(m, APPROVED, false);
    else if (m.isPendingPayment) credit(m, IN_REVIEW, true);
  }
  return owned;
}

/**
 * "Last submitter" variant of buildPaymentOwnership: credit each milestone's
 * WHOLE payment to whoever uploaded its most-recently-uploaded qualifying doc —
 * the person who effectively pushed the milestone over the line to PE. Winner-
 * take-all like the majority view, but the winner is the *last* uploader rather
 * than the one who did the most. Ties broken by doc name for determinism.
 * Same return shape as buildPaymentOwnership.
 */
export function buildPaymentOwnershipLast(
  milestones: MilestonePayment[],
  statusByDoc: Map<string, string>, // `${dealId}|${docName}` → status
  latestUploaderByDoc: Map<string, string | null>, // `${dealId}|${docName}` → uploader (override-adjusted)
  latestUploadAtByDoc: Map<string, number>, // `${dealId}|${docName}` → ms timestamp of latest upload
): Map<string, { amount: number; count: number; paidAmount: number; paidCount: number; pendingAmount: number; pendingCount: number }> {
  const owned = new Map<string, { amount: number; count: number; paidAmount: number; paidCount: number; pendingAmount: number; pendingCount: number }>();
  const ensure = (who: string) => {
    let e = owned.get(who);
    if (!e) { e = { amount: 0, count: 0, paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0 }; owned.set(who, e); }
    return e;
  };
  const credit = (m: MilestonePayment, qualifyingStatuses: Set<string>, pending: boolean) => {
    const docs = m.docNames.filter((n) => qualifyingStatuses.has(statusByDoc.get(`${m.dealId}|${n}`) ?? ""));
    if (docs.length === 0) return;
    // The qualifying doc uploaded most recently wins (ties → doc name).
    let lastDoc: string | null = null;
    let lastAt = -Infinity;
    for (const n of docs) {
      const at = latestUploadAtByDoc.get(`${m.dealId}|${n}`) ?? -Infinity;
      if (at > lastAt || (at === lastAt && lastDoc !== null && n < lastDoc)) { lastAt = at; lastDoc = n; }
    }
    const by = (lastDoc ? latestUploaderByDoc.get(`${m.dealId}|${lastDoc}`)?.trim() : null) || UNKNOWN_UPLOADER;
    const e = ensure(by);
    if (pending) { e.pendingAmount += m.amount; e.pendingCount += 1; }
    else {
      e.amount += m.amount; e.count += 1;
      if (m.isPaid) { e.paidAmount += m.amount; e.paidCount += 1; }
    }
  };
  const APPROVED = new Set(["APPROVED"]);
  const IN_REVIEW = new Set(["UNDER_REVIEW", "UPLOADED"]);
  for (const m of milestones) {
    if (m.amount <= 0) continue;
    if (m.isApprovedPayment) credit(m, APPROVED, false);
    else if (m.isPendingPayment) credit(m, IN_REVIEW, true);
  }
  return owned;
}

/** Per-period upload counts segmented by uploader, for the stacked bars. */
export interface DailyUpload {
  day: string; // period key: YYYY-MM-DD (day/week-start) or YYYY-MM (month)
  total: number;
  deals: number; // distinct deals touched that period
  byUploader: Record<string, number>; // uploader → uploads that period
  byDocType: Record<string, number>; // canonical doc name → uploads that period
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
  rows: { uploadedAt: Date | string; uploadedBy: string | null; dealId?: string | null; docName?: string | null }[],
  granularity: UploadGranularity = "day",
  now: Date = new Date(),
): DailyUpload[] {
  const cutoff = granularity === "day" ? new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) : null;
  const buckets = new Map<string, Map<string, number>>();
  const docBuckets = new Map<string, Map<string, number>>();
  const dealsByKey = new Map<string, Set<string>>();
  for (const r of rows) {
    const at = typeof r.uploadedAt === "string" ? new Date(r.uploadedAt) : r.uploadedAt;
    if (isNaN(at.getTime()) || (cutoff && at < cutoff)) continue;
    const key = granularity === "month" ? at.toISOString().slice(0, 7) : granularity === "week" ? weekKey(at) : at.toISOString().slice(0, 10);
    const who = r.uploadedBy?.trim() || UNKNOWN_UPLOADER;
    const m = buckets.get(key) ?? new Map<string, number>();
    m.set(who, (m.get(who) ?? 0) + 1);
    buckets.set(key, m);
    const doc = r.docName?.trim();
    if (doc) {
      const dm = docBuckets.get(key) ?? new Map<string, number>();
      dm.set(doc, (dm.get(doc) ?? 0) + 1);
      docBuckets.set(key, dm);
    }
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
      const byDocType: Record<string, number> = {};
      for (const [doc, n] of docBuckets.get(day) ?? []) byDocType[doc] = n;
      return { day, total, deals: dealsByKey.get(day)?.size ?? 0, byUploader, byDocType };
    });
}

/** Build all three period series in one pass. */
export function buildUploadsByPeriod(
  rows: { uploadedAt: Date | string; uploadedBy: string | null; dealId?: string | null; docName?: string | null }[],
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
  // Owner per `${dealId}|${docName}` — overrides the latest-version uploader for
  // docsOwned/outcome crediting (admin reassignment). Upload *volume* (`total`)
  // always stays with whoever actually uploaded, so a reassigned doc moves into
  // the previous owner's "superseded" segment rather than vanishing.
  ownerByDoc?: Map<string, string | null>,
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
    const ov = ownerByDoc?.get(k);
    const owner = (ov !== undefined ? ov : r.uploadedBy)?.trim() || UNKNOWN_UPLOADER;
    const e = ensure(owner);
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
      paidPaymentsOwned: 0,
      paidMilestonesOwned: 0,
      pendingPaymentsOwned: 0,
      pendingMilestonesOwned: 0,
    }))
    .sort((a, b) => {
      if (a.uploader === UNKNOWN_UPLOADER) return 1;
      if (b.uploader === UNKNOWN_UPLOADER) return -1;
      return b.total - a.total || a.uploader.localeCompare(b.uploader);
    });
}

export interface SharedOwner { who: string; weight: number }

/**
 * Shared (fractional) ownership per `${dealId}|${docName}`. A doc's credit is
 * split among its TRACKED uploaders by how many versions each uploaded
 * (person's tracked versions ÷ total tracked versions). Pre-tracking-only docs
 * stay Unknown=1. An admin override pins the WHOLE doc (weight 1) to one person,
 * ignoring the split. Weights for a doc always sum to 1.
 */
export function computeSharedOwners(
  rows: VersionRow[],
  overrideByDoc?: Map<string, string | null>,
): Map<string, SharedOwner[]> {
  const byKey = new Map<string, VersionRow[]>();
  for (const r of rows) {
    if (!r.dealId) continue;
    const k = `${r.dealId}|${r.docName}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
  }
  const out = new Map<string, SharedOwner[]>();
  for (const [k, list] of byKey) {
    if (overrideByDoc?.has(k)) {
      out.set(k, [{ who: overrideByDoc.get(k)?.trim() || UNKNOWN_UPLOADER, weight: 1 }]);
      continue;
    }
    const tracked = list.filter((v) => v.uploadedBy?.trim());
    if (tracked.length === 0) {
      out.set(k, [{ who: UNKNOWN_UPLOADER, weight: 1 }]);
      continue;
    }
    const counts = new Map<string, number>();
    for (const v of tracked) {
      const who = v.uploadedBy!.trim();
      counts.set(who, (counts.get(who) ?? 0) + 1);
    }
    out.set(k, [...counts.entries()].map(([who, n]) => ({ who, weight: n / tracked.length })));
  }
  return out;
}

/**
 * Uploader stats with fractional (shared) doc ownership. Upload *volume*
 * (`total`/`last8w`/`deals`) still follows whoever actually uploaded; only
 * docsOwned and the outcome buckets are split by `sharedOwners` weights.
 */
export function buildSharedUploaderStats(
  rows: VersionRow[],
  statusByDoc: Map<string, string>,
  sharedOwners: Map<string, SharedOwner[]>,
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
  for (const r of rows) {
    const e = ensure(r.uploadedBy?.trim() || UNKNOWN_UPLOADER);
    e.total++;
    const at = typeof r.uploadedAt === "string" ? new Date(r.uploadedAt) : r.uploadedAt;
    if (at >= cutoff) e.last8w++;
    if (r.dealId) e.deals.add(r.dealId);
  }
  for (const [k, owners] of sharedOwners) {
    const status = statusByDoc.get(k);
    for (const { who, weight } of owners) {
      const e = ensure(who);
      e.docsOwned += weight;
      if (status === "APPROVED") e.approved += weight;
      else if (status === "ACTION_REQUIRED" || status === "REJECTED") e.rejected += weight;
      else if (status === "UNDER_REVIEW" || status === "UPLOADED") e.inReview += weight;
    }
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
      paymentsOwned: 0,
      milestonesOwned: 0,
      paidPaymentsOwned: 0,
      paidMilestonesOwned: 0,
      pendingPaymentsOwned: 0,
      pendingMilestonesOwned: 0,
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
  remittanceOn: string | null;
  expectedPaidOn: string | null;
  /** Milestone-relevant docs not yet uploaded (empty when fully uploaded or untracked). */
  missingDocs: string[];
  /** Milestone-relevant docs currently flagged ACTION_REQUIRED/REJECTED by PE. */
  actionRequiredDocs: string[];
  /** Latest PE reviewer note on an action-required doc for this milestone. */
  latestRejectionNote: string | null;
}

/** One doc an uploader owns (latest version), for the per-outcome drill-downs. */
export interface UploaderDoc {
  dealId: string;
  dealName: string;
  docName: string;
  hubspotUrl: string;
  pePortalUrl: string | null;
  driveUrl: string | null;
  note: string | null; // latest PE reviewer note (rejections only); null otherwise
  overridden?: boolean; // credited uploader pinned by an admin override
  resubmitted?: boolean; // a newer version landed after the override — re-check
  weight?: number; // fractional credit for this person in shared mode (1 in owner mode)
  version?: number; // the upload's version number (superseded uploads)
  uploadedAt?: string; // YYYY-MM-DD this version landed (superseded uploads)
  supersededBy?: string; // uploader of the latest version that replaced this one
}
/** An uploader's owned docs split by current outcome. */
export interface UploaderOutcomeDocs {
  approved: UploaderDoc[];
  inReview: UploaderDoc[];
  rejected: UploaderDoc[];
  /** Older versions of a doc that a newer upload replaced (resubmissions). */
  superseded: UploaderDoc[];
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
  // All weekly charts are emitted at DAY granularity; the client rolls them up
  // to week/month on demand (summing daily buckets is exact).
  dailyPaid: WeeklyPayments[];
  dailyApprovals: WeeklyPayments[];
  dailySubmissions: WeeklyPayments[];
  dailyRemittance: WeeklyPayments[]; // dated by PE remittance day, done = received
  dailyExpectedPaid: WeeklyPayments[]; // dated by expected-paid day, done = received
  dailyLifecycle: WeeklyLifecycle[]; // lifecycle dated by READY day
  dailyLifecycleSubmitted: WeeklyLifecycle[]; // lifecycle dated by SUBMITTED day
  dailyLifecycleRejected: WeeklyLifecycle[]; // lifecycle dated by REJECTION day
  dailyReadiness: WeeklySplitCohort[];
  dailyRejections: WeeklySplitCohort[];
  milestones: MilestoneDrillRow[];
  docRejectionEvents: DocRejectionEvent[];
  docSubmissionEvents: DocRejectionEvent[];
  docApprovalEvents: DocRejectionEvent[];
  /** Doc uploads per person (PE version history); Unknown bucket = pre-tracking uploads. */
  uploaderStats: UploaderStat[];
  /** Same stats under shared (fractional) ownership — docs split across tracked contributors; overrides pin the whole doc. Powers the Owner⇄Shared toggle. */
  uploaderStatsShared: UploaderStat[];
  /** Same base stats but payment $ credited to the LAST submitter — whoever uploaded each milestone's most-recent qualifying doc. Powers the payment table's "Last" mode. */
  uploaderStatsLast: UploaderStat[];
  /** Per-uploader owned docs split by outcome (approved / inReview / rejected) — powers the drill-downs. Keyed by uploader (UNKNOWN_UPLOADER for null). */
  uploaderDocs: Record<string, UploaderOutcomeDocs>;
  /** Shared-mode drills — a multi-contributor doc appears under each person with its fractional `weight`. */
  uploaderDocsShared: Record<string, UploaderOutcomeDocs>;
  uploadsByPeriod: UploadsByPeriod;
  docTypeByUploader: UploaderDocTypes[];
  pipeline: PipelineGroupRow[];
  timing: { overall: TimingSummary[]; monthly: MonthlyTiming[] };
  rejections: { byDoc: RejectionByDoc[]; recentNotes: RejectionNote[] };
  missingByDoc: MissingByDoc[];
  funnelDeals: FunnelDeal[];
  // Date PE first recorded an uploader (YYYY-MM-DD). Uploads before this are the
  // genuine pre-tracking "Unknown" bucket. Null if nothing is attributed yet.
  attributionStart: string | null;
  // Atomic upload rows for the client-side Uploads Explorer (filter by doc +
  // uploader, drill anywhere). The client re-runs the pure builders on the
  // filtered subset. `status` is the doc's current status (same per version).
  uploaderRows: UploaderRow[];
  dealLinks: Record<string, DealLink>;
}

export interface UploaderRow {
  by: string | null; // uploader email, null = Unknown
  at: string; // YYYY-MM-DD
  dealId: string;
  doc: string; // canonical doc name
  ver: number;
  status: string; // current status of (dealId, doc)
}

export interface DealLink {
  name: string;
  hubspotUrl: string;
  pePortalUrl: string | null;
  driveUrl: string | null;
}
