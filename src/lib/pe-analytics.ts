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

  const firstSubmitted = firstWith(["Submitted", "Resubmitted"]);
  const firstApproved = firstWith(["Approved"]);
  const firstPaid = firstWith(["Paid"]);
  const rejectionCount = sorted.filter((h) => h.value === "Rejected").length;

  return {
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
  weekly: WeeklyPayments[];
  weeklyApprovals: WeeklyPayments[];
  pipeline: PipelineGroupRow[];
  timing: { overall: TimingSummary[]; monthly: MonthlyTiming[] };
  rejections: { byDoc: RejectionByDoc[]; recentNotes: RejectionNote[] };
  funnelDeals: FunnelDeal[];
}
