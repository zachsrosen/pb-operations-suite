import type { Project } from "@/lib/hubspot";
import { DEAL_STAGE_MAP } from "@/lib/hubspot";
import { normalizeLocation } from "@/lib/locations";
import { statusLabel } from "@/lib/deal-status-labels";

export interface ProjectFunnelStageData {
  count: number;
  amount: number;
  cancelledCount: number;
  cancelledAmount: number;
  /**
   * Of the `count` that reached this milestone, how many are currently On Hold.
   * A SUBSET of `count` (not added to it) — on-hold deals stay counted as active
   * so the backlog/funnel counts still reconcile; this overlay just lets the
   * conversion arrow split "pending" into actively-stuck vs parked-on-hold.
   */
  onHoldCount: number;
  onHoldAmount: number;
}

export const PROJECT_FUNNEL_STAGES = [
  "salesClosed",
  "surveyScheduled",
  "surveyDone",
  "daSent",
  "daApproved",
  "designCompleted",
  "permitsSubmitted",
  "permitsIssued",
  "constructionScheduled",
  "constructionComplete",
  "inspectionPassed",
  "ptoGranted",
] as const;

export type ProjectFunnelStageKey = (typeof PROJECT_FUNNEL_STAGES)[number];

export interface ProjectFunnelCohort {
  month: string;
  salesClosed: ProjectFunnelStageData;
  surveyScheduled: ProjectFunnelStageData;
  surveyDone: ProjectFunnelStageData;
  daSent: ProjectFunnelStageData;
  daApproved: ProjectFunnelStageData;
  designCompleted: ProjectFunnelStageData;
  permitsSubmitted: ProjectFunnelStageData;
  permitsIssued: ProjectFunnelStageData;
  constructionScheduled: ProjectFunnelStageData;
  constructionComplete: ProjectFunnelStageData;
  inspectionPassed: ProjectFunnelStageData;
  ptoGranted: ProjectFunnelStageData;
}

export interface ProjectFunnelMedianDays {
  closedToSurveyScheduled: number | null;
  surveyScheduledToComplete: number | null;
  surveyToDaSent: number | null;
  daSentToApproved: number | null;
  approvedToDesignComplete: number | null;
  designCompleteToPermitSubmit: number | null;
  permitSubmitToIssued: number | null;
  permitIssuedToConstructionScheduled: number | null;
  constructionScheduledToComplete: number | null;
  constructionCompleteToInspection: number | null;
  inspectionToPto: number | null;
}

export interface ProjectMonthlyActivity {
  month: string;
  salesClosed: number;
  salesClosedAmount: number;
  surveysScheduled: number;
  surveysScheduledAmount: number;
  surveysCompleted: number;
  surveysCompletedAmount: number;
  dasSent: number;
  dasSentAmount: number;
  dasApproved: number;
  dasApprovedAmount: number;
  designsCompleted: number;
  designsCompletedAmount: number;
  permitsSubmitted: number;
  permitsSubmittedAmount: number;
  permitsIssued: number;
  permitsIssuedAmount: number;
  icSubmitted: number;
  icSubmittedAmount: number;
  icApproved: number;
  icApprovedAmount: number;
  constructionsScheduled: number;
  constructionsScheduledAmount: number;
  constructionsComplete: number;
  constructionsCompleteAmount: number;
  inspectionsPassed: number;
  inspectionsPassedAmount: number;
  ptosGranted: number;
  ptosGrantedAmount: number;
  closedOut: number;
  closedOutAmount: number;
  cancelled: number;
  cancelledAmount: number;
}

/** One deal in a current-stage drill-down (Current Pipeline Position chart). */
export interface ProjectFunnelStageDeal {
  id: number;
  name: string;
  projectNumber: string;
  amount: number;
  pbLocation: string;
  url: string;
  daysInStage: number;
  projectManager: string;
  dealOwner: string;
  /** Stage-relevant status, or the blocked / on-hold reason for those stages. */
  detail: string;
  /** Free-text on-hold notes, if any (On Hold stage only). */
  notes: string | null;
}

export interface ProjectFunnelStageGroup {
  stageId: string;
  stageName: string;
  count: number;
  amount: number;
  /** Deals in this current stage broken down by their stage-relevant status. */
  statusBreakdown: Array<{ status: string; count: number }>;
  /** The deals sitting in this stage right now, for drill-down. */
  deals: ProjectFunnelStageDeal[];
}

export interface ProjectFunnelDrillDownDeal {
  id: number;
  name: string;
  projectNumber: string;
  amount: number;
  pbLocation: string;
  closeDate: string;
  stage: string;
  url: string;
  daysWaiting: number;
  status: string | null;
  /** Optional scheduled / milestone date to display (e.g. survey date, construction date) */
  scheduledDate?: string | null;
  /** Optional second date with context label (e.g. inspection fail date) */
  extraDate?: string | null;
  extraLabel?: string;
  /** Staff assignments */
  projectManager: string;
  dealOwner: string;
  siteSurveyor: string;
  designLead: string;
  permitLead: string;
  operationsManager: string;
  inspectionsLead: string;
  interconnectionsLead: string;
  /** Interconnection workstream status (runs parallel to permitting) */
  interconnectionStatus: string | null;
  /** Deal is currently On Hold — kept in its bucket but flagged as not actionable. */
  isOnHold?: boolean;
  /** On-hold dropdown reason + free-text note (only set when isOnHold). */
  onHoldReason?: string | null;
  onHoldNotes?: string | null;
}

export interface ProjectFunnelDrillDown {
  awaitingSurveySchedule: ProjectFunnelDrillDownDeal[];
  awaitingSurvey: ProjectFunnelDrillDownDeal[];
  awaitingDaSend: ProjectFunnelDrillDownDeal[];
  awaitingApproval: ProjectFunnelDrillDownDeal[];
  awaitingDesignComplete: ProjectFunnelDrillDownDeal[];
  awaitingPermitSubmit: ProjectFunnelDrillDownDeal[];
  awaitingPermitIssue: ProjectFunnelDrillDownDeal[];
  awaitingConstructionSchedule: ProjectFunnelDrillDownDeal[];
  awaitingConstructionComplete: ProjectFunnelDrillDownDeal[];
  awaitingInspection: ProjectFunnelDrillDownDeal[];
  awaitingPto: ProjectFunnelDrillDownDeal[];
  awaitingCloseOut: ProjectFunnelDrillDownDeal[];
}

export interface ProjectFunnelResponse {
  summary: Record<ProjectFunnelStageKey, ProjectFunnelStageData>;
  /** Same stage totals over the immediately-preceding equal-length window, for trend deltas. */
  previousSummary: Record<ProjectFunnelStageKey, ProjectFunnelStageData>;
  cohorts: ProjectFunnelCohort[];
  monthlyActivity: ProjectMonthlyActivity[];
  stageDistribution: ProjectFunnelStageGroup[];
  drillDown: ProjectFunnelDrillDown;
  medianDays: ProjectFunnelMedianDays;
  /** Distinct PM / deal-owner names available in the current location+timeframe scope. */
  filterOptions: { projectManagers: string[]; dealOwners: string[] };
  /** Cohort stage totals broken out per PB location (for the funnel hero matrix). */
  summaryByLocation: Record<string, Record<ProjectFunnelStageKey, ProjectFunnelStageData>>;
  /** Throughput activity totals broken out per PB location (for the activity hero matrix). */
  activityByLocation: Record<string, ProjectMonthlyActivity>;
  generatedAt: string;
}

const CANCELLED_STAGE_ID = "68229433";
const ON_HOLD_STAGE_ID = "20440344";
const RTB_BLOCKED_STAGE_ID = "71052436";
const PROJECT_COMPLETE_STAGE_ID = "20440343";

/** Active = still in flight: not cancelled and not project-complete. */
function isActiveDeal(p: Project): boolean {
  return p.stageId !== CANCELLED_STAGE_ID && p.stageId !== PROJECT_COMPLETE_STAGE_ID;
}

/**
 * Stage priority from DEAL_STAGE_MAP / STAGE_PRIORITY.
 * Used to infer completed milestones from the deal's current pipeline stage
 * when date fields are missing.
 */
const STAGE_PRIORITY_MAP: Record<string, number> = {
  "20461935": 0,  // Project Rejected - Needs Review
  "20461936": 1,  // Site Survey
  "20461937": 2,  // Design & Engineering
  "20461938": 3,  // Permitting & Interconnection
  "71052436": 4,  // RTB - Blocked
  "22580871": 5,  // Ready To Build
  "20440342": 6,  // Construction
  "22580872": 7,  // Inspection
  "20461940": 8,  // Permission To Operate
  "24743347": 9,  // Close Out
  "20440343": 10, // Project Complete
  "68229433": 11, // Cancelled
  "20440344": 12, // On Hold
};

/**
 * Which deal status field is relevant to each current pipeline stage — used to
 * break down the "Current Pipeline Position" by status. Stages not listed
 * (RTB, Close Out, On Hold, …) fall back to "No status".
 */
const STAGE_STATUS_SOURCE: Record<string, { field: keyof Project; labelKey: string }> = {
  "20461936": { field: "siteSurveyStatus", labelKey: "site_survey_status" },        // Site Survey
  "20461937": { field: "designStatus", labelKey: "design_status" },                 // Design & Engineering
  "20461938": { field: "permittingStatus", labelKey: "permitting_status" },         // Permitting & Interconnection
  "71052436": { field: "permittingStatus", labelKey: "permitting_status" },         // RTB - Blocked
  "20440342": { field: "constructionStatus", labelKey: "install_status" },          // Construction
  "22580872": { field: "finalInspectionStatus", labelKey: "final_inspection_status" }, // Inspection
  "20461940": { field: "ptoStatus", labelKey: "pto_status" },                       // Permission To Operate
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDrillDown(
  p: Project,
  daysWaiting: number,
  status: string | null,
  extra?: { scheduledDate?: string | null; extraDate?: string | null; extraLabel?: string },
): ProjectFunnelDrillDownDeal {
  return {
    id: p.id,
    name: p.name,
    projectNumber: p.projectNumber,
    amount: p.amount || 0,
    pbLocation: p.pbLocation,
    closeDate: p.closeDate!,
    stage: p.stage,
    url: p.url,
    daysWaiting,
    status,
    ...(extra?.scheduledDate ? { scheduledDate: extra.scheduledDate } : {}),
    ...(extra?.extraDate ? { extraDate: extra.extraDate, extraLabel: extra.extraLabel } : {}),
    projectManager: p.projectManager || "",
    dealOwner: p.dealOwner || "",
    siteSurveyor: p.siteSurveyor || "",
    designLead: p.designLead || "",
    permitLead: p.permitLead || "",
    operationsManager: p.operationsManager || "",
    inspectionsLead: p.inspectionsLead || "",
    interconnectionsLead: p.interconnectionsLead || "",
    interconnectionStatus: statusLabel("interconnection_status", p.interconnectionStatus),
    // On-hold deals stay in their normal bucket (so milestone counts still
    // reconcile), but are flagged so the UI can mark them parked/not-actionable
    // and surface why — without their parked time skewing the bucket average.
    ...(p.stageId === ON_HOLD_STAGE_ID
      ? { isOnHold: true, onHoldReason: p.onHoldReason || null, onHoldNotes: p.onHoldNotes || null }
      : {}),
  };
}

function emptyStage(): ProjectFunnelStageData {
  return { count: 0, amount: 0, cancelledCount: 0, cancelledAmount: 0, onHoldCount: 0, onHoldAmount: 0 };
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addToStage(
  stage: ProjectFunnelStageData,
  amount: number,
  cancelled: boolean,
  onHold = false
): void {
  if (cancelled) {
    stage.cancelledCount += 1;
    stage.cancelledAmount += amount;
  } else {
    // On-hold deals still count as active (so counts reconcile); onHoldCount is
    // a subset overlay used only to split the conversion arrow's pending slice.
    stage.count += 1;
    stage.amount += amount;
    if (onHold) {
      stage.onHoldCount += 1;
      stage.onHoldAmount += amount;
    }
  }
}

function emptySummary(): Record<ProjectFunnelStageKey, ProjectFunnelStageData> {
  return {
    salesClosed: emptyStage(),
    surveyScheduled: emptyStage(),
    surveyDone: emptyStage(),
    daSent: emptyStage(),
    daApproved: emptyStage(),
    designCompleted: emptyStage(),
    permitsSubmitted: emptyStage(),
    permitsIssued: emptyStage(),
    constructionScheduled: emptyStage(),
    constructionComplete: emptyStage(),
    inspectionPassed: emptyStage(),
    ptoGranted: emptyStage(),
  };
}

function emptyCohort(month: string): ProjectFunnelCohort {
  return { month, ...emptySummary() };
}

/** Zeroed activity bucket. `label` lands in the `month` field (a month key or a location name). */
function emptyActivity(label: string): ProjectMonthlyActivity {
  return {
    month: label,
    salesClosed: 0,
    salesClosedAmount: 0,
    surveysScheduled: 0,
    surveysScheduledAmount: 0,
    surveysCompleted: 0,
    surveysCompletedAmount: 0,
    dasSent: 0,
    dasSentAmount: 0,
    dasApproved: 0,
    dasApprovedAmount: 0,
    designsCompleted: 0,
    designsCompletedAmount: 0,
    permitsSubmitted: 0,
    permitsSubmittedAmount: 0,
    permitsIssued: 0,
    permitsIssuedAmount: 0,
    icSubmitted: 0,
    icSubmittedAmount: 0,
    icApproved: 0,
    icApprovedAmount: 0,
    constructionsScheduled: 0,
    constructionsScheduledAmount: 0,
    constructionsComplete: 0,
    constructionsCompleteAmount: 0,
    inspectionsPassed: 0,
    inspectionsPassedAmount: 0,
    ptosGranted: 0,
    ptosGrantedAmount: 0,
    closedOut: 0,
    closedOutAmount: 0,
    cancelled: 0,
    cancelledAmount: 0,
  };
}

/**
 * Resolve milestone flags using three layers:
 *   1. Stage-based floor — the deal's current pipeline stage implies certain
 *      milestones are done even when date fields are missing.
 *   2. Date-based detection — milestone date exists.
 *   3. Implied progression — later milestones cascade to earlier ones.
 *
 * Stage → milestone mapping (RTB-Blocked does NOT imply permits submitted):
 *   D&E (≥2)           → survey
 *   P&I (≥3)           → survey, DA sent, DA approved, design complete
 *   RTB-Blocked (4)    → same as P&I (no permit assumption)
 *   RTB (≥5)           → + permits submitted, permits issued
 *   Construction (≥6)  → + construction scheduled
 *   Inspection (≥7)    → + construction complete
 *   PTO (≥8)           → + inspection passed
 *   Close Out (≥9)     → + PTO granted
 *   Project Complete   → all milestones
 */
function resolveMilestones(p: Project) {
  const rawSp = STAGE_PRIORITY_MAP[p.stageId ?? ""] ?? 0;
  // Cancelled and On Hold sit at the TOP of the priority map, but that does NOT
  // mean the deal progressed through every milestone — it was cancelled/held
  // from somewhere mid-pipeline. Their current stage says nothing about how far
  // they got, so drop the stage-based floor for them and rely purely on the
  // actual milestone date fields (+ the implied-progression cascade below).
  const sp =
    p.stageId === CANCELLED_STAGE_ID || p.stageId === ON_HOLD_STAGE_ID ? 0 : rawSp;

  // Stage-based floor: what must be true given the deal's current stage
  const stageSurvey = sp >= 2;
  const stageDaSent = sp >= 3;
  const stageDaApproved = sp >= 3;
  const stageDesignComplete = sp >= 3;
  // RTB-Blocked (4) does NOT imply permits — jump to 5
  const stagePermitSubmit = sp >= 5;
  const stagePermitIssued = sp >= 5;
  const stageConstructionScheduled = sp >= 6;
  const stageConstructionComplete = sp >= 7;
  const stageInspectionPassed = sp >= 8;
  const stagePtoGranted = sp >= 9;

  // Date-based + implied progression chain (later dates cascade to earlier)
  const hasPtoGranted = stagePtoGranted || !!p.ptoGrantedDate;
  const hasInspectionPassed = hasPtoGranted || stageInspectionPassed || !!p.inspectionPassDate;
  const hasConstructionComplete = hasInspectionPassed || stageConstructionComplete || !!p.constructionCompleteDate;
  const hasConstructionScheduled = hasConstructionComplete || stageConstructionScheduled || !!p.constructionScheduleDate;
  const hasPermitIssued = hasConstructionScheduled || stagePermitIssued || !!p.permitIssueDate;
  const hasPermitSubmit = hasPermitIssued || stagePermitSubmit || !!p.permitSubmitDate;
  const hasDesignComplete = hasPermitSubmit || stageDesignComplete || !!p.designCompletionDate;
  const hasDaApproved = hasDesignComplete || stageDaApproved || !!p.designApprovalDate;
  const hasDaSent = hasDaApproved || stageDaSent || !!p.designApprovalSentDate;
  const hasSurvey = hasDaSent || stageSurvey || !!p.siteSurveyCompletionDate;
  const hasSurveyScheduled = hasSurvey || !!p.siteSurveyScheduleDate || p.isSiteSurveyScheduled;

  return {
    hasSurveyScheduled,
    hasSurvey,
    hasDaSent,
    hasDaApproved,
    hasDesignComplete,
    hasPermitSubmit,
    hasPermitIssued,
    hasConstructionScheduled,
    hasConstructionComplete,
    hasInspectionPassed,
    hasPtoGranted,
  };
}

/**
 * Tally stage totals (count + amount, active vs cancelled) for a set of deals,
 * using the same milestone resolution as the main funnel. Used for the
 * prior-period trend comparison.
 */
function tallyStageSummary(deals: Project[]): Record<ProjectFunnelStageKey, ProjectFunnelStageData> {
  const summary = emptySummary();
  for (const p of deals) {
    const cancelled = p.stageId === CANCELLED_STAGE_ID;
    const onHold = p.stageId === ON_HOLD_STAGE_ID;
    const amt = p.amount || 0;
    const m = resolveMilestones(p);
    addToStage(summary.salesClosed, amt, cancelled, onHold);
    if (m.hasSurveyScheduled) addToStage(summary.surveyScheduled, amt, cancelled, onHold);
    if (m.hasSurvey) addToStage(summary.surveyDone, amt, cancelled, onHold);
    if (m.hasDaSent) addToStage(summary.daSent, amt, cancelled, onHold);
    if (m.hasDaApproved) addToStage(summary.daApproved, amt, cancelled, onHold);
    if (m.hasDesignComplete) addToStage(summary.designCompleted, amt, cancelled, onHold);
    if (m.hasPermitSubmit) addToStage(summary.permitsSubmitted, amt, cancelled, onHold);
    if (m.hasPermitIssued) addToStage(summary.permitsIssued, amt, cancelled, onHold);
    if (m.hasConstructionScheduled) addToStage(summary.constructionScheduled, amt, cancelled, onHold);
    if (m.hasConstructionComplete) addToStage(summary.constructionComplete, amt, cancelled, onHold);
    if (m.hasInspectionPassed) addToStage(summary.inspectionPassed, amt, cancelled, onHold);
    if (m.hasPtoGranted) addToStage(summary.ptoGranted, amt, cancelled, onHold);
  }
  return summary;
}

export function buildProjectFunnelData(
  projects: Project[],
  months: number,
  locations?: string[],
  /**
   * Optional explicit calendar window (inclusive "YYYY-MM-DD" bounds). When
   * provided it overrides the rolling `months` lookback — used so calendar
   * timeframes (This Year, Last Year, …) map to real month boundaries instead
   * of "N months back from today".
   */
  range?: { start: string; end: string },
  /** Optional PM / deal-owner filters (names). Empty/omitted = no filter. */
  filters?: { projectManagers?: string[]; dealOwners?: string[] },
  /**
   * scope "active" ignores the date window entirely and instead includes every
   * currently-active deal (not cancelled / not project-complete), regardless of
   * when any milestone happened — a snapshot of the live pipeline. Default
   * "cohort" windows deals by close date as before.
   */
  options?: { scope?: "cohort" | "active" }
): ProjectFunnelResponse {
  const activeScope = options?.scope === "active";
  const now = new Date();
  // Active scope spans all time (epoch → no end), so every date-based filter
  // below passes; deal selection is gated on isActiveDeal instead.
  const cutoff = activeScope
    ? new Date(0)
    : range
      ? new Date(range.start + "T00:00:00")
      : new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  const endBound = activeScope ? null : range ? new Date(range.end + "T23:59:59") : null;
  /** A milestone/close date falls inside the active window. */
  const inWindow = (d: Date): boolean => d >= cutoff && (!endBound || d <= endBound);

  const locSet = locations && locations.length > 0 ? new Set(locations) : null;
  function matchesLocation(p: Project): boolean {
    if (!locSet) return true;
    const canonical = normalizeLocation(p.pbLocation);
    return canonical != null && locSet.has(canonical);
  }

  const pmSet = filters?.projectManagers && filters.projectManagers.length > 0 ? new Set(filters.projectManagers) : null;
  const ownerSet = filters?.dealOwners && filters.dealOwners.length > 0 ? new Set(filters.dealOwners) : null;
  function matchesStaff(p: Project): boolean {
    if (pmSet && !pmSet.has(p.projectManager || "")) return false;
    if (ownerSet && !ownerSet.has(p.dealOwner || "")) return false;
    return true;
  }

  // PM / owner options reflect the location + timeframe scope (before the staff
  // filter narrows it), so the dropdowns stay populated while you filter.
  // On-Hold deals are closed-won and counted at whatever milestones they
  // actually reached (resolveMilestones drops their stage floor and relies on
  // real date fields), so the funnel reconciles with HubSpot's closed totals.
  const scopeForOptions = projects.filter((p) => {
    if (!p.closeDate) return false;
    if (activeScope) {
      if (!isActiveDeal(p)) return false;
    } else if (!inWindow(new Date(p.closeDate + "T12:00:00"))) {
      return false;
    }
    return matchesLocation(p);
  });
  const filterOptions = {
    projectManagers: [...new Set(scopeForOptions.map((p) => p.projectManager).filter((v): v is string => !!v))].sort(),
    dealOwners: [...new Set(scopeForOptions.map((p) => p.dealOwner).filter((v): v is string => !!v))].sort(),
  };

  const filtered = scopeForOptions.filter(matchesStaff);

  // Prior equal-length window (immediately preceding) for trend deltas.
  const spanMonths = range
    ? (() => {
        const [sy, sm] = range.start.split("-").map(Number);
        const [ey, em] = range.end.split("-").map(Number);
        return (ey - sy) * 12 + (em - sm) + 1;
      })()
    : months;
  const prevCutoff = new Date(cutoff);
  prevCutoff.setMonth(prevCutoff.getMonth() - spanMonths);
  const prevEnd = new Date(cutoff.getTime() - 1);
  const previousFiltered = projects.filter((p) => {
    if (!p.closeDate) return false;
    const cd = new Date(p.closeDate + "T12:00:00");
    if (cd < prevCutoff || cd > prevEnd) return false;
    return matchesLocation(p) && matchesStaff(p);
  });
  const previousSummary = tallyStageSummary(previousFiltered);

  // Cohort stage totals grouped by PB location (for the hero location matrix).
  const dealsByLocation = new Map<string, Project[]>();
  for (const p of filtered) {
    const loc = normalizeLocation(p.pbLocation) || "Unknown";
    if (!dealsByLocation.has(loc)) dealsByLocation.set(loc, []);
    dealsByLocation.get(loc)!.push(p);
  }
  const summaryByLocation: Record<string, Record<ProjectFunnelStageKey, ProjectFunnelStageData>> = {};
  for (const [loc, deals] of dealsByLocation) summaryByLocation[loc] = tallyStageSummary(deals);

  const summary = emptySummary();
  const cohortMap = new Map<string, ProjectFunnelCohort>();

  // Median-days accumulators
  const dClosedToSurveyScheduled: number[] = [];
  const dSurveyScheduledToComplete: number[] = [];
  const dSurveyToDaSent: number[] = [];
  const dDaSentToApproved: number[] = [];
  const dApprovedToDesignComplete: number[] = [];
  const dDesignCompleteToPermitSubmit: number[] = [];
  const dPermitSubmitToIssued: number[] = [];
  const dPermitIssuedToConstructionScheduled: number[] = [];
  const dConstructionScheduledToComplete: number[] = [];
  const dConstructionCompleteToInspection: number[] = [];
  const dInspectionToPto: number[] = [];

  for (const p of filtered) {
    const cancelled = p.stageId === CANCELLED_STAGE_ID;
    const onHold = p.stageId === ON_HOLD_STAGE_ID;
    const amt = p.amount || 0;
    const mk = monthKey(p.closeDate!);

    if (!cohortMap.has(mk)) cohortMap.set(mk, emptyCohort(mk));
    const cohort = cohortMap.get(mk)!;

    const m = resolveMilestones(p);

    addToStage(summary.salesClosed, amt, cancelled, onHold);
    addToStage(cohort.salesClosed, amt, cancelled, onHold);

    if (m.hasSurveyScheduled) {
      addToStage(summary.surveyScheduled, amt, cancelled, onHold);
      addToStage(cohort.surveyScheduled, amt, cancelled, onHold);
      if (!cancelled && p.siteSurveyScheduleDate)
        dClosedToSurveyScheduled.push(daysBetween(p.closeDate!, p.siteSurveyScheduleDate));
    }
    if (m.hasSurvey) {
      addToStage(summary.surveyDone, amt, cancelled, onHold);
      addToStage(cohort.surveyDone, amt, cancelled, onHold);
      if (!cancelled && p.siteSurveyScheduleDate && p.siteSurveyCompletionDate)
        dSurveyScheduledToComplete.push(daysBetween(p.siteSurveyScheduleDate, p.siteSurveyCompletionDate));
    }
    if (m.hasDaSent) {
      addToStage(summary.daSent, amt, cancelled, onHold);
      addToStage(cohort.daSent, amt, cancelled, onHold);
      if (!cancelled && p.siteSurveyCompletionDate && p.designApprovalSentDate)
        dSurveyToDaSent.push(daysBetween(p.siteSurveyCompletionDate, p.designApprovalSentDate));
    }
    if (m.hasDaApproved) {
      addToStage(summary.daApproved, amt, cancelled, onHold);
      addToStage(cohort.daApproved, amt, cancelled, onHold);
      if (!cancelled && p.designApprovalSentDate && p.designApprovalDate)
        dDaSentToApproved.push(daysBetween(p.designApprovalSentDate, p.designApprovalDate));
    }
    if (m.hasDesignComplete) {
      addToStage(summary.designCompleted, amt, cancelled, onHold);
      addToStage(cohort.designCompleted, amt, cancelled, onHold);
      if (!cancelled && p.designApprovalDate && p.designCompletionDate)
        dApprovedToDesignComplete.push(daysBetween(p.designApprovalDate, p.designCompletionDate));
    }
    if (m.hasPermitSubmit) {
      addToStage(summary.permitsSubmitted, amt, cancelled, onHold);
      addToStage(cohort.permitsSubmitted, amt, cancelled, onHold);
      if (!cancelled && p.designCompletionDate && p.permitSubmitDate)
        dDesignCompleteToPermitSubmit.push(daysBetween(p.designCompletionDate, p.permitSubmitDate));
    }
    if (m.hasPermitIssued) {
      addToStage(summary.permitsIssued, amt, cancelled, onHold);
      addToStage(cohort.permitsIssued, amt, cancelled, onHold);
      if (!cancelled && p.permitSubmitDate && p.permitIssueDate)
        dPermitSubmitToIssued.push(daysBetween(p.permitSubmitDate, p.permitIssueDate));
    }
    if (m.hasConstructionScheduled) {
      addToStage(summary.constructionScheduled, amt, cancelled, onHold);
      addToStage(cohort.constructionScheduled, amt, cancelled, onHold);
      if (!cancelled && p.permitIssueDate && p.constructionScheduleDate)
        dPermitIssuedToConstructionScheduled.push(daysBetween(p.permitIssueDate, p.constructionScheduleDate));
    }
    if (m.hasConstructionComplete) {
      addToStage(summary.constructionComplete, amt, cancelled, onHold);
      addToStage(cohort.constructionComplete, amt, cancelled, onHold);
      if (!cancelled && p.constructionScheduleDate && p.constructionCompleteDate)
        dConstructionScheduledToComplete.push(daysBetween(p.constructionScheduleDate, p.constructionCompleteDate));
    }
    if (m.hasInspectionPassed) {
      addToStage(summary.inspectionPassed, amt, cancelled, onHold);
      addToStage(cohort.inspectionPassed, amt, cancelled, onHold);
      if (!cancelled && p.constructionCompleteDate && p.inspectionPassDate)
        dConstructionCompleteToInspection.push(daysBetween(p.constructionCompleteDate, p.inspectionPassDate));
    }
    if (m.hasPtoGranted) {
      addToStage(summary.ptoGranted, amt, cancelled, onHold);
      addToStage(cohort.ptoGranted, amt, cancelled, onHold);
      if (!cancelled && p.inspectionPassDate && p.ptoGrantedDate)
        dInspectionToPto.push(daysBetween(p.inspectionPassDate, p.ptoGrantedDate));
    }
  }

  const cohorts = [...cohortMap.values()].sort((a, b) => b.month.localeCompare(a.month));

  // Activity-based counts: bin milestones by the month they happened, and
  // separately accumulate per-PB-location totals for the location matrix.
  const activityMap = new Map<string, ProjectMonthlyActivity>();
  function ensureActivity(mk: string): ProjectMonthlyActivity {
    if (!activityMap.has(mk)) activityMap.set(mk, emptyActivity(mk));
    return activityMap.get(mk)!;
  }
  const activityLocMap = new Map<string, ProjectMonthlyActivity>();
  function ensureLocActivity(loc: string): ProjectMonthlyActivity {
    if (!activityLocMap.has(loc)) activityLocMap.set(loc, emptyActivity(loc));
    return activityLocMap.get(loc)!;
  }

  const dateMilestones: Array<{
    field: keyof Project;
    activityKey: keyof ProjectMonthlyActivity;
    amountKey?: keyof ProjectMonthlyActivity;
  }> = [
    { field: "closeDate", activityKey: "salesClosed", amountKey: "salesClosedAmount" },
    { field: "siteSurveyScheduleDate", activityKey: "surveysScheduled", amountKey: "surveysScheduledAmount" },
    { field: "siteSurveyCompletionDate", activityKey: "surveysCompleted", amountKey: "surveysCompletedAmount" },
    { field: "designApprovalSentDate", activityKey: "dasSent", amountKey: "dasSentAmount" },
    { field: "designApprovalDate", activityKey: "dasApproved", amountKey: "dasApprovedAmount" },
    { field: "designCompletionDate", activityKey: "designsCompleted", amountKey: "designsCompletedAmount" },
    { field: "permitSubmitDate", activityKey: "permitsSubmitted", amountKey: "permitsSubmittedAmount" },
    { field: "permitIssueDate", activityKey: "permitsIssued", amountKey: "permitsIssuedAmount" },
    { field: "interconnectionSubmitDate", activityKey: "icSubmitted", amountKey: "icSubmittedAmount" },
    { field: "interconnectionApprovalDate", activityKey: "icApproved", amountKey: "icApprovedAmount" },
    { field: "constructionScheduleDate", activityKey: "constructionsScheduled", amountKey: "constructionsScheduledAmount" },
    { field: "constructionCompleteDate", activityKey: "constructionsComplete", amountKey: "constructionsCompleteAmount" },
    { field: "inspectionPassDate", activityKey: "inspectionsPassed", amountKey: "inspectionsPassedAmount" },
    { field: "ptoGrantedDate", activityKey: "ptosGranted", amountKey: "ptosGrantedAmount" },
  ];

  for (const p of projects) {
    if (!matchesLocation(p) || !matchesStaff(p)) continue;
    if (activeScope && !isActiveDeal(p)) continue;
    const locAct = ensureLocActivity(normalizeLocation(p.pbLocation) || "Unknown");
    for (const { field, activityKey, amountKey } of dateMilestones) {
      const dateVal = p[field] as string | null;
      if (dateVal) {
        const d = new Date(dateVal + "T12:00:00");
        if (inWindow(d)) {
          const act = ensureActivity(monthKey(dateVal));
          (act[activityKey] as number)++;
          (locAct[activityKey] as number)++;
          if (amountKey) {
            (act[amountKey] as number) += p.amount || 0;
            (locAct[amountKey] as number) += p.amount || 0;
          }
        }
      }
    }
    // Closed Out: binned by the date the deal entered Project Complete stage
    if (p.projectCompleteDate) {
      const d = new Date(p.projectCompleteDate + "T12:00:00");
      if (inWindow(d)) {
        const act = ensureActivity(monthKey(p.projectCompleteDate));
        act.closedOut++;
        act.closedOutAmount += p.amount || 0;
        locAct.closedOut++;
        locAct.closedOutAmount += p.amount || 0;
      }
    }
    // Cancelled: binned by the date the deal entered Cancelled stage
    if (p.cancelledDate) {
      const d = new Date(p.cancelledDate + "T12:00:00");
      if (inWindow(d)) {
        const act = ensureActivity(monthKey(p.cancelledDate));
        act.cancelled++;
        act.cancelledAmount += p.amount || 0;
        locAct.cancelled++;
        locAct.cancelledAmount += p.amount || 0;
      }
    }
  }

  const monthlyActivity = [...activityMap.values()].sort((a, b) => b.month.localeCompare(a.month));

  // Stage distribution — sorted by pipeline order (STAGE_PRIORITY_MAP), with a
  // per-stage breakdown + drill-down. RTB-Blocked and On Hold break down by their
  // reason (not a generic status), so the "why" is visible at a glance.
  const stageMap = new Map<string, ProjectFunnelStageGroup>();
  const stageStatusMap = new Map<string, Map<string, number>>();
  for (const p of filtered) {
    const sid = p.stageId || "unknown";
    if (!stageMap.has(sid)) {
      stageMap.set(sid, {
        stageId: sid,
        stageName: p.stage || DEAL_STAGE_MAP[sid] || sid,
        count: 0,
        amount: 0,
        statusBreakdown: [],
        deals: [],
      });
      stageStatusMap.set(sid, new Map());
    }
    const sg = stageMap.get(sid)!;
    sg.count++;
    sg.amount += p.amount || 0;

    // Blocked / On Hold stages surface their reason; everything else its
    // stage-relevant status. `detail` drives both the bar breakdown and the
    // drill-down's Status/Reason column.
    const reason =
      sid === RTB_BLOCKED_STAGE_ID
        ? p.rtbBlockedReason?.trim() || null
        : sid === ON_HOLD_STAGE_ID
          ? p.onHoldReason?.trim() || null
          : null;
    const src = STAGE_STATUS_SOURCE[sid];
    const statusLbl = (src && statusLabel(src.labelKey, p[src.field] as string | null)) || "No status";
    const detail = reason ?? statusLbl;

    const sm = stageStatusMap.get(sid)!;
    sm.set(detail, (sm.get(detail) || 0) + 1);

    sg.deals.push({
      id: p.id,
      name: p.name,
      projectNumber: p.projectNumber,
      amount: p.amount || 0,
      pbLocation: p.pbLocation,
      url: p.url,
      daysInStage: Math.max(0, p.daysSinceStageMovement || 0),
      projectManager: p.projectManager || "",
      dealOwner: p.dealOwner || "",
      detail,
      notes: sid === ON_HOLD_STAGE_ID ? p.onHoldNotes?.trim() || null : null,
    });
  }
  for (const [sid, sg] of stageMap) {
    sg.statusBreakdown = [...stageStatusMap.get(sid)!.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
    sg.deals.sort((a, b) => b.daysInStage - a.daysInStage);
  }
  const stageDistribution = [...stageMap.values()].sort(
    (a, b) => (STAGE_PRIORITY_MAP[a.stageId] ?? 99) - (STAGE_PRIORITY_MAP[b.stageId] ?? 99)
  );

  // Drill-down
  const today = todayStr();
  const drillDown: ProjectFunnelDrillDown = {
    awaitingSurveySchedule: [],
    awaitingSurvey: [],
    awaitingDaSend: [],
    awaitingApproval: [],
    awaitingDesignComplete: [],
    awaitingPermitSubmit: [],
    awaitingPermitIssue: [],
    awaitingConstructionSchedule: [],
    awaitingConstructionComplete: [],
    awaitingInspection: [],
    awaitingPto: [],
    awaitingCloseOut: [],
  };

  for (const p of filtered) {
    if (p.stageId === CANCELLED_STAGE_ID) continue;
    const m = resolveMilestones(p);

    if (!m.hasSurveyScheduled) {
      drillDown.awaitingSurveySchedule.push(
        toDrillDown(p, daysBetween(p.closeDate!, today), statusLabel("site_survey_status", p.siteSurveyStatus))
      );
    } else if (!m.hasSurvey) {
      // Use close date as "waiting since" — the scheduled date may be in the
      // future, which would produce negative days.
      drillDown.awaitingSurvey.push(
        toDrillDown(p, daysBetween(p.closeDate!, today), statusLabel("site_survey_status", p.siteSurveyStatus), {
          scheduledDate: p.siteSurveyScheduleDate,
        })
      );
    } else if (!m.hasDaSent) {
      const waitSince = p.siteSurveyCompletionDate || p.closeDate!;
      drillDown.awaitingDaSend.push(
        toDrillDown(p, daysBetween(waitSince, today), statusLabel("layout_status", p.layoutStatus))
      );
    } else if (!m.hasDaApproved) {
      const waitSince = p.designApprovalSentDate || p.closeDate!;
      drillDown.awaitingApproval.push(
        toDrillDown(p, daysBetween(waitSince, today), statusLabel("layout_status", p.layoutStatus))
      );
    } else if (!m.hasDesignComplete) {
      const waitSince = p.designApprovalDate || p.closeDate!;
      drillDown.awaitingDesignComplete.push(
        toDrillDown(p, daysBetween(waitSince, today), statusLabel("design_status", p.designStatus))
      );
    } else if (!m.hasPermitSubmit) {
      const waitSince = p.designCompletionDate || p.closeDate!;
      drillDown.awaitingPermitSubmit.push(
        toDrillDown(p, daysBetween(waitSince, today), statusLabel("permitting_status", p.permittingStatus))
      );
    } else if (!m.hasPermitIssued) {
      const waitSince = p.permitSubmitDate || p.closeDate!;
      drillDown.awaitingPermitIssue.push(
        toDrillDown(p, daysBetween(waitSince, today), statusLabel("permitting_status", p.permittingStatus))
      );
    } else if (!m.hasConstructionScheduled) {
      const waitSince = p.permitIssueDate || p.closeDate!;
      drillDown.awaitingConstructionSchedule.push(
        toDrillDown(p, daysBetween(waitSince, today), statusLabel("install_status", p.constructionStatus))
      );
    } else if (!m.hasConstructionComplete) {
      const waitSince = p.constructionScheduleDate || p.closeDate!;
      drillDown.awaitingConstructionComplete.push(
        toDrillDown(p, daysBetween(waitSince, today), statusLabel("install_status", p.constructionStatus), {
          scheduledDate: p.constructionScheduleDate,
        })
      );
    } else if (!m.hasInspectionPassed) {
      const waitSince = p.constructionCompleteDate || p.closeDate!;
      drillDown.awaitingInspection.push(
        toDrillDown(p, daysBetween(waitSince, today), statusLabel("final_inspection_status", p.finalInspectionStatus), {
          scheduledDate: p.inspectionScheduleDate,
          extraDate: p.inspectionFailDate,
          extraLabel: "Failed",
        })
      );
    } else if (!m.hasPtoGranted) {
      const waitSince = p.inspectionPassDate || p.closeDate!;
      drillDown.awaitingPto.push(
        toDrillDown(p, daysBetween(waitSince, today), statusLabel("pto_status", p.ptoStatus))
      );
    } else {
      // In Close Out stage (priority 9) but not yet Project Complete
      const sp = STAGE_PRIORITY_MAP[p.stageId ?? ""] ?? 0;
      if (sp === 9) {
        const waitSince = p.ptoGrantedDate || p.closeDate!;
        drillDown.awaitingCloseOut.push(
          toDrillDown(p, daysBetween(waitSince, today), null)
        );
      }
    }
  }

  const byWaitDesc = (a: ProjectFunnelDrillDownDeal, b: ProjectFunnelDrillDownDeal) =>
    b.daysWaiting - a.daysWaiting;
  drillDown.awaitingSurveySchedule.sort(byWaitDesc);
  drillDown.awaitingSurvey.sort(byWaitDesc);
  drillDown.awaitingDaSend.sort(byWaitDesc);
  drillDown.awaitingApproval.sort(byWaitDesc);
  drillDown.awaitingDesignComplete.sort(byWaitDesc);
  drillDown.awaitingPermitSubmit.sort(byWaitDesc);
  drillDown.awaitingPermitIssue.sort(byWaitDesc);
  drillDown.awaitingConstructionSchedule.sort(byWaitDesc);
  drillDown.awaitingConstructionComplete.sort(byWaitDesc);
  drillDown.awaitingInspection.sort(byWaitDesc);
  drillDown.awaitingPto.sort(byWaitDesc);
  drillDown.awaitingCloseOut.sort(byWaitDesc);

  const activityByLocation: Record<string, ProjectMonthlyActivity> = {};
  for (const [loc, act] of activityLocMap) activityByLocation[loc] = act;

  return {
    summary,
    previousSummary,
    cohorts,
    monthlyActivity,
    stageDistribution,
    drillDown,
    filterOptions,
    summaryByLocation,
    activityByLocation,
    medianDays: {
      closedToSurveyScheduled: median(dClosedToSurveyScheduled),
      surveyScheduledToComplete: median(dSurveyScheduledToComplete),
      surveyToDaSent: median(dSurveyToDaSent),
      daSentToApproved: median(dDaSentToApproved),
      approvedToDesignComplete: median(dApprovedToDesignComplete),
      designCompleteToPermitSubmit: median(dDesignCompleteToPermitSubmit),
      permitSubmitToIssued: median(dPermitSubmitToIssued),
      permitIssuedToConstructionScheduled: median(dPermitIssuedToConstructionScheduled),
      constructionScheduledToComplete: median(dConstructionScheduledToComplete),
      constructionCompleteToInspection: median(dConstructionCompleteToInspection),
      inspectionToPto: median(dInspectionToPto),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestone Cohort
//
// "Of the deals that hit milestone X during window W, where are they now?"
// Unlike the funnel (which windows every deal on its close date), this windows
// on a chosen milestone's own date, then buckets the matching deals two ways:
//   • by current pipeline stage   (live HubSpot stage)
//   • by furthest milestone reached (funnel-derived progression)
// ─────────────────────────────────────────────────────────────────────────────

/** Funnel stage → the Project date field that marks when it was reached. */
const MILESTONE_DATE_FIELD: Record<ProjectFunnelStageKey, keyof Project> = {
  salesClosed: "closeDate",
  surveyScheduled: "siteSurveyScheduleDate",
  surveyDone: "siteSurveyCompletionDate",
  daSent: "designApprovalSentDate",
  daApproved: "designApprovalDate",
  designCompleted: "designCompletionDate",
  permitsSubmitted: "permitSubmitDate",
  permitsIssued: "permitIssueDate",
  constructionScheduled: "constructionScheduleDate",
  constructionComplete: "constructionCompleteDate",
  inspectionPassed: "inspectionPassDate",
  ptoGranted: "ptoGrantedDate",
};

/** Display labels for the 12 funnel milestones (shared with the UI). */
export const FUNNEL_STAGE_LABELS: Record<ProjectFunnelStageKey, string> = {
  salesClosed: "Sales Closed",
  surveyScheduled: "Survey Scheduled",
  surveyDone: "Survey Done",
  daSent: "DA Sent",
  daApproved: "DA Approved",
  designCompleted: "Design Complete",
  permitsSubmitted: "Permits Submitted",
  permitsIssued: "Permits Issued",
  constructionScheduled: "Construction Sched.",
  constructionComplete: "Construction Complete",
  inspectionPassed: "Inspection Passed",
  ptoGranted: "PTO Granted",
};

export interface MilestoneCohortBucket {
  /** stageId (current-stage buckets) or funnel stage key (furthest buckets). */
  key: string;
  label: string;
  count: number;
  amount: number;
}

export interface MilestoneCohortDeal {
  id: number;
  name: string;
  projectNumber: string;
  amount: number;
  pbLocation: string;
  url: string;
  /** The selected milestone's date (the value that put the deal in this cohort). */
  milestoneDate: string;
  currentStageId: string;
  currentStage: string;
  furthestMilestone: ProjectFunnelStageKey;
  furthestMilestoneLabel: string;
  projectManager: string;
  dealOwner: string;
}

export interface MilestoneCohortResponse {
  milestone: ProjectFunnelStageKey;
  milestoneLabel: string;
  rangeStart: string;
  rangeEnd: string;
  totalCount: number;
  totalAmount: number;
  byCurrentStage: MilestoneCohortBucket[];
  byFurthestMilestone: MilestoneCohortBucket[];
  deals: MilestoneCohortDeal[];
  generatedAt: string;
}

/** Highest funnel milestone a deal has actually reached (defaults to Sales Closed). */
function furthestMilestoneKey(p: Project): ProjectFunnelStageKey {
  const m = resolveMilestones(p);
  if (m.hasPtoGranted) return "ptoGranted";
  if (m.hasInspectionPassed) return "inspectionPassed";
  if (m.hasConstructionComplete) return "constructionComplete";
  if (m.hasConstructionScheduled) return "constructionScheduled";
  if (m.hasPermitIssued) return "permitsIssued";
  if (m.hasPermitSubmit) return "permitsSubmitted";
  if (m.hasDesignComplete) return "designCompleted";
  if (m.hasDaApproved) return "daApproved";
  if (m.hasDaSent) return "daSent";
  if (m.hasSurvey) return "surveyDone";
  if (m.hasSurveyScheduled) return "surveyScheduled";
  return "salesClosed";
}

export function buildMilestoneCohort(
  projects: Project[],
  milestone: ProjectFunnelStageKey,
  range: { start: string; end: string },
  locations?: string[],
  filters?: { projectManagers?: string[]; dealOwners?: string[] }
): MilestoneCohortResponse {
  const cutoff = new Date(range.start + "T00:00:00");
  const endBound = new Date(range.end + "T23:59:59");
  const field = MILESTONE_DATE_FIELD[milestone];

  const locSet = locations && locations.length > 0 ? new Set(locations) : null;
  const pmSet = filters?.projectManagers && filters.projectManagers.length > 0 ? new Set(filters.projectManagers) : null;
  const ownerSet = filters?.dealOwners && filters.dealOwners.length > 0 ? new Set(filters.dealOwners) : null;

  const byCurrent = new Map<string, MilestoneCohortBucket>();
  const byFurthest = new Map<string, MilestoneCohortBucket>();
  const deals: MilestoneCohortDeal[] = [];
  let totalCount = 0;
  let totalAmount = 0;

  for (const p of projects) {
    const dateVal = p[field] as string | null;
    if (!dateVal) continue;
    const d = new Date(dateVal + "T12:00:00");
    if (d < cutoff || d > endBound) continue;

    if (locSet) {
      const canon = normalizeLocation(p.pbLocation);
      if (!canon || !locSet.has(canon)) continue;
    }
    if (pmSet && !pmSet.has(p.projectManager || "")) continue;
    if (ownerSet && !ownerSet.has(p.dealOwner || "")) continue;

    const amt = p.amount || 0;
    totalCount++;
    totalAmount += amt;

    const sid = p.stageId || "unknown";
    const stageName = p.stage || DEAL_STAGE_MAP[sid] || sid;
    if (!byCurrent.has(sid)) byCurrent.set(sid, { key: sid, label: stageName, count: 0, amount: 0 });
    const cb = byCurrent.get(sid)!;
    cb.count++;
    cb.amount += amt;

    const fk = furthestMilestoneKey(p);
    if (!byFurthest.has(fk)) byFurthest.set(fk, { key: fk, label: FUNNEL_STAGE_LABELS[fk], count: 0, amount: 0 });
    const fb = byFurthest.get(fk)!;
    fb.count++;
    fb.amount += amt;

    deals.push({
      id: p.id,
      name: p.name,
      projectNumber: p.projectNumber,
      amount: amt,
      pbLocation: p.pbLocation,
      url: p.url,
      milestoneDate: dateVal,
      currentStageId: sid,
      currentStage: stageName,
      furthestMilestone: fk,
      furthestMilestoneLabel: FUNNEL_STAGE_LABELS[fk],
      projectManager: p.projectManager || "",
      dealOwner: p.dealOwner || "",
    });
  }

  const byCurrentStage = [...byCurrent.values()].sort(
    (a, b) => (STAGE_PRIORITY_MAP[a.key] ?? 99) - (STAGE_PRIORITY_MAP[b.key] ?? 99)
  );
  const byFurthestMilestone = [...byFurthest.values()].sort(
    (a, b) =>
      PROJECT_FUNNEL_STAGES.indexOf(a.key as ProjectFunnelStageKey) -
      PROJECT_FUNNEL_STAGES.indexOf(b.key as ProjectFunnelStageKey)
  );
  deals.sort((a, b) => b.milestoneDate.localeCompare(a.milestoneDate));

  return {
    milestone,
    milestoneLabel: FUNNEL_STAGE_LABELS[milestone],
    rangeStart: range.start,
    rangeEnd: range.end,
    totalCount,
    totalAmount,
    byCurrentStage,
    byFurthestMilestone,
    deals,
    generatedAt: new Date().toISOString(),
  };
}
