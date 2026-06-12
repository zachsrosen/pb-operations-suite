import type { Project } from "@/lib/hubspot";
import { normalizeLocation } from "@/lib/locations";
import { statusLabel } from "@/lib/deal-status-labels";

// ─────────────────────────────────────────────────────────────────────────────
// Design & Engineering funnel
//
// A design-team-focused view of the project pipeline. Where the project funnel
// spans Sales Closed → PTO, this one zooms into the design production chain and
// surfaces the revision LOOPS that don't show up as forward progress:
//
//   Entered Design → DA Sent → DA Approved → Design Drafted → Design Complete
//                      └────────── revision loop ──────────┘
//
// "Entered Design" = survey complete / in the D&E stage (the design inflow).
// The DA loop lives between DA Sent and DA Approved (layout_status bounce
// states + da_revision_counter). The Design loop lives between DA Approved and
// Design Complete (design_status revision states).
// ─────────────────────────────────────────────────────────────────────────────

export const DESIGN_FUNNEL_STAGES = [
  "enteredDesign",
  "daSent",
  "daApproved",
  "designDrafted",
  "designComplete",
] as const;

export type DesignFunnelStageKey = (typeof DESIGN_FUNNEL_STAGES)[number];

export const DESIGN_STAGE_LABELS: Record<DesignFunnelStageKey, string> = {
  enteredDesign: "Entered Design",
  daSent: "DA Sent",
  daApproved: "DA Approved",
  designDrafted: "Design Drafted",
  designComplete: "Design Complete",
};

export interface DesignFunnelStageData {
  count: number;
  amount: number;
  cancelledCount: number;
  cancelledAmount: number;
}

export interface DesignFunnelMedianDays {
  enteredToDaSent: number | null;
  daSentToApproved: number | null;
  approvedToDrafted: number | null;
  draftedToComplete: number | null;
  approvedToComplete: number | null;
}

/** Per-deal row in a backlog bucket / revision-loop drill-down. */
export interface DesignFunnelDeal {
  id: number;
  name: string;
  projectNumber: string;
  amount: number;
  pbLocation: string;
  url: string;
  daysWaiting: number;
  /** Stage-relevant status label (layout_status or design_status). */
  status: string | null;
  /** da_revision_counter — how many times the DA has bounced for this deal. */
  revisionCount: number;
  designLead: string;
  projectManager: string;
  dealOwner: string;
  /** Parked / blocked / sales-change flag, kept in-bucket but marked not-actionable. */
  flag: DesignFunnelFlag | null;
}

export interface DesignFunnelFlag {
  label: string;
  tone: "yellow" | "red" | "orange";
  reason: string | null;
  parked: boolean;
}

/** A revision loop's rolled-up stats + the deals currently stuck in it. */
export interface DesignRevisionLoop {
  /** Deals sitting in a revision/bounce status right now. */
  inRevisionNow: number;
  inRevisionAmount: number;
  /** Deals (in scope, past this gate's entry) that have bounced ≥1 time. */
  dealsWithRevisions: number;
  /** Sum of revision counts across in-scope deals. */
  totalRevisions: number;
  /** Mean revisions per deal that reached this gate (2 dp upstream). */
  avgRevisions: number | null;
  /** Highest single-deal revision count seen. */
  maxRevisions: number;
  /** Current in-flight deals broken down by their (revision) status. */
  byStatus: Array<{ status: string; count: number }>;
  /** The deals currently stuck in a revision status, worst-first. */
  deals: DesignFunnelDeal[];
}

export interface DesignFunnelDrillDown {
  awaitingDaSend: DesignFunnelDeal[];
  awaitingDaApproval: DesignFunnelDeal[];
  awaitingDesignDraft: DesignFunnelDeal[];
  awaitingDesignComplete: DesignFunnelDeal[];
}

export interface DesignFunnelResponse {
  summary: Record<DesignFunnelStageKey, DesignFunnelStageData>;
  medianDays: DesignFunnelMedianDays;
  /** Status depth across all in-design deals — the design team's live work queue. */
  designStatusDepth: Array<{ status: string; count: number; amount: number }>;
  layoutStatusDepth: Array<{ status: string; count: number; amount: number }>;
  daLoop: DesignRevisionLoop;
  designLoop: DesignRevisionLoop;
  drillDown: DesignFunnelDrillDown;
  summaryByLocation: Record<string, Record<DesignFunnelStageKey, DesignFunnelStageData>>;
  filterOptions: { designLeads: string[]; projectManagers: string[] };
  generatedAt: string;
}

const CANCELLED_STAGE_ID = "68229433";
const ON_HOLD_STAGE_ID = "20440344";
const RTB_BLOCKED_STAGE_ID = "71052436";
const PROJECT_COMPLETE_STAGE_ID = "20440343";

const STAGE_PRIORITY_MAP: Record<string, number> = {
  "20461935": 0,
  "20461936": 1, // Site Survey
  "20461937": 2, // Design & Engineering
  "20461938": 3, // Permitting & Interconnection
  "71052436": 4, // RTB - Blocked
  "22580871": 5, // Ready To Build
  "20440342": 6, // Construction
  "22580872": 7, // Inspection
  "20461940": 8, // Permission To Operate
  "24743347": 9, // Close Out
  "20440343": 10, // Project Complete
  "68229433": 11, // Cancelled
  "20440344": 12, // On Hold
};

/**
 * layout_status (DA) raw values that mean the DA is bouncing rather than moving
 * forward — i.e. it's in a revision loop between Sent and Approved.
 */
const DA_REVISION_STATES = new Set<string>([
  "Needs Clarification",
  "Design Rejected",
  "In Revision",
  "Revision Returned From Design",
  "Resent For Approval",
  "Pending Sales Changes",
  "Pending Ops Changes",
  "Pending Design Changes",
  "Pending Resurvey",
]);

/**
 * design_status raw values that mean the permit-ready design is in a revision
 * loop (rejected / clarification / IDR revision) rather than progressing.
 */
const DESIGN_REVISION_STATES = new Set<string>([
  "Revision Needed - DA Rejected",
  "DA Revision In Progress",
  "IDR Revision Needed",
  "IDR Revision in Progress",
  "Needs Clarification",
  "Needs Clarification from Customer",
  "Needs Clarification from Sales",
  "Needs Clarification from Operations",
  "Pending Resurvey",
  "In Revision",
  "Revision Initial Review",
  "Revision Final Review",
  "Revision In Engineering",
]);

/** Active = still in flight: not cancelled and not project-complete. */
function isActiveDeal(p: Project): boolean {
  return p.stageId !== CANCELLED_STAGE_ID && p.stageId !== PROJECT_COMPLETE_STAGE_ID;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function emptyStage(): DesignFunnelStageData {
  return { count: 0, amount: 0, cancelledCount: 0, cancelledAmount: 0 };
}

function emptySummary(): Record<DesignFunnelStageKey, DesignFunnelStageData> {
  return {
    enteredDesign: emptyStage(),
    daSent: emptyStage(),
    daApproved: emptyStage(),
    designDrafted: emptyStage(),
    designComplete: emptyStage(),
  };
}

function addToStage(stage: DesignFunnelStageData, amount: number, cancelled: boolean): void {
  if (cancelled) {
    stage.cancelledCount += 1;
    stage.cancelledAmount += amount;
  } else {
    stage.count += 1;
    stage.amount += amount;
  }
}

/**
 * Resolve the design milestones for a deal using the same three layers as the
 * project funnel: stage-based floor (current pipeline stage implies milestones),
 * date detection, and implied progression (later cascades to earlier).
 *
 *   D&E (≥2)        → entered design
 *   P&I and beyond  → DA sent, DA approved, design drafted, design complete
 */
function resolveDesignMilestones(p: Project) {
  const rawSp = STAGE_PRIORITY_MAP[p.stageId ?? ""] ?? 0;
  // Cancelled / On Hold say nothing about how far the deal got — rely on dates.
  const sp = p.stageId === CANCELLED_STAGE_ID || p.stageId === ON_HOLD_STAGE_ID ? 0 : rawSp;

  const stageEntered = sp >= 2;
  // Anything in P&I (3) or later has cleared the whole design chain.
  const stageDesignDone = sp >= 3;

  const hasDesignComplete = stageDesignDone || !!p.designCompletionDate;
  const hasDesignDrafted = hasDesignComplete || !!p.designDraftDate;
  const hasDaApproved = hasDesignDrafted || stageDesignDone || !!p.designApprovalDate;
  const hasDaSent = hasDaApproved || stageDesignDone || !!p.designApprovalSentDate;
  const hasEnteredDesign =
    hasDaSent || stageEntered || !!p.siteSurveyCompletionDate;

  return { hasEnteredDesign, hasDaSent, hasDaApproved, hasDesignDrafted, hasDesignComplete };
}

/** Flag a deal that's parked / blocked / awaiting a sales change. */
function designFlag(p: Project): DesignFunnelFlag | null {
  if (p.stageId === ON_HOLD_STAGE_ID) {
    return { label: "On hold", tone: "yellow", reason: null, parked: true };
  }
  if (p.stageId === RTB_BLOCKED_STAGE_ID) {
    return { label: "RTB blocked", tone: "red", reason: null, parked: false };
  }
  if (p.layoutStatus === "Pending Sales Changes") {
    return { label: "Sales change", tone: "orange", reason: null, parked: false };
  }
  return null;
}

function toDeal(p: Project, daysWaiting: number, status: string | null): DesignFunnelDeal {
  return {
    id: p.id,
    name: p.name,
    projectNumber: p.projectNumber,
    amount: p.amount || 0,
    pbLocation: p.pbLocation,
    url: p.url,
    daysWaiting,
    status,
    revisionCount: p.daRevisionCounter || 0,
    designLead: p.designLead || "",
    projectManager: p.projectManager || "",
    dealOwner: p.dealOwner || "",
    flag: designFlag(p),
  };
}

function tallyStageSummary(deals: Project[]): Record<DesignFunnelStageKey, DesignFunnelStageData> {
  const summary = emptySummary();
  for (const p of deals) {
    const cancelled = p.stageId === CANCELLED_STAGE_ID;
    const amt = p.amount || 0;
    const m = resolveDesignMilestones(p);
    if (m.hasEnteredDesign) addToStage(summary.enteredDesign, amt, cancelled);
    if (m.hasDaSent) addToStage(summary.daSent, amt, cancelled);
    if (m.hasDaApproved) addToStage(summary.daApproved, amt, cancelled);
    if (m.hasDesignDrafted) addToStage(summary.designDrafted, amt, cancelled);
    if (m.hasDesignComplete) addToStage(summary.designComplete, amt, cancelled);
  }
  return summary;
}

function emptyLoop(): DesignRevisionLoop {
  return {
    inRevisionNow: 0,
    inRevisionAmount: 0,
    dealsWithRevisions: 0,
    totalRevisions: 0,
    avgRevisions: null,
    maxRevisions: 0,
    byStatus: [],
    deals: [],
  };
}

export function buildDesignFunnelData(
  projects: Project[],
  months: number,
  locations?: string[],
  range?: { start: string; end: string },
  filters?: { designLeads?: string[]; projectManagers?: string[] },
  options?: { scope?: "cohort" | "active" }
): DesignFunnelResponse {
  const activeScope = options?.scope === "active";
  const now = new Date();
  const cutoff = activeScope
    ? new Date(0)
    : range
      ? new Date(range.start + "T00:00:00")
      : new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  const endBound = activeScope ? null : range ? new Date(range.end + "T23:59:59") : null;
  const inWindow = (d: Date): boolean => d >= cutoff && (!endBound || d <= endBound);

  const locSet = locations && locations.length > 0 ? new Set(locations) : null;
  function matchesLocation(p: Project): boolean {
    if (!locSet) return true;
    const canonical = normalizeLocation(p.pbLocation);
    return canonical != null && locSet.has(canonical);
  }

  const leadSet = filters?.designLeads && filters.designLeads.length > 0 ? new Set(filters.designLeads) : null;
  const pmSet = filters?.projectManagers && filters.projectManagers.length > 0 ? new Set(filters.projectManagers) : null;
  function matchesStaff(p: Project): boolean {
    if (leadSet && !leadSet.has(p.designLead || "")) return false;
    if (pmSet && !pmSet.has(p.projectManager || "")) return false;
    return true;
  }

  // In-scope = entered design, within the window (or active), location-matched.
  // We window on close date (parity with the project funnel) so timeframe means
  // the same thing across both views.
  const scopeForOptions = projects.filter((p) => {
    if (!p.closeDate) return false;
    if (activeScope) {
      if (!isActiveDeal(p)) return false;
    } else if (!inWindow(new Date(p.closeDate + "T12:00:00"))) {
      return false;
    }
    if (!matchesLocation(p)) return false;
    return resolveDesignMilestones(p).hasEnteredDesign;
  });

  const filterOptions = {
    designLeads: [...new Set(scopeForOptions.map((p) => p.designLead).filter((v): v is string => !!v))].sort(),
    projectManagers: [...new Set(scopeForOptions.map((p) => p.projectManager).filter((v): v is string => !!v))].sort(),
  };

  const filtered = scopeForOptions.filter(matchesStaff);

  const summary = tallyStageSummary(filtered);

  // Per-location stage totals (hero matrix).
  const dealsByLocation = new Map<string, Project[]>();
  for (const p of filtered) {
    const loc = normalizeLocation(p.pbLocation) || "Unknown";
    if (!dealsByLocation.has(loc)) dealsByLocation.set(loc, []);
    dealsByLocation.get(loc)!.push(p);
  }
  const summaryByLocation: Record<string, Record<DesignFunnelStageKey, DesignFunnelStageData>> = {};
  for (const [loc, deals] of dealsByLocation) summaryByLocation[loc] = tallyStageSummary(deals);

  // Median-day accumulators
  const dEnteredToDaSent: number[] = [];
  const dDaSentToApproved: number[] = [];
  const dApprovedToDrafted: number[] = [];
  const dDraftedToComplete: number[] = [];
  const dApprovedToComplete: number[] = [];

  // Status-depth maps (live work queue across all in-design, not-yet-complete deals)
  const designDepth = new Map<string, { count: number; amount: number }>();
  const layoutDepth = new Map<string, { count: number; amount: number }>();

  // Revision-loop accumulators
  const daLoop = emptyLoop();
  const designLoop = emptyLoop();
  const daLoopStatus = new Map<string, number>();
  const designLoopStatus = new Map<string, number>();

  const drillDown: DesignFunnelDrillDown = {
    awaitingDaSend: [],
    awaitingDaApproval: [],
    awaitingDesignDraft: [],
    awaitingDesignComplete: [],
  };

  const today = todayStr();

  for (const p of filtered) {
    const cancelled = p.stageId === CANCELLED_STAGE_ID;
    const amt = p.amount || 0;
    const m = resolveDesignMilestones(p);

    // Median transition times (skip cancelled — they didn't really flow).
    if (!cancelled) {
      if (p.siteSurveyCompletionDate && p.designApprovalSentDate)
        dEnteredToDaSent.push(daysBetween(p.siteSurveyCompletionDate, p.designApprovalSentDate));
      if (p.designApprovalSentDate && p.designApprovalDate)
        dDaSentToApproved.push(daysBetween(p.designApprovalSentDate, p.designApprovalDate));
      if (p.designApprovalDate && p.designDraftDate)
        dApprovedToDrafted.push(daysBetween(p.designApprovalDate, p.designDraftDate));
      if (p.designDraftDate && p.designCompletionDate)
        dDraftedToComplete.push(daysBetween(p.designDraftDate, p.designCompletionDate));
      if (p.designApprovalDate && p.designCompletionDate)
        dApprovedToComplete.push(daysBetween(p.designApprovalDate, p.designCompletionDate));
    }

    // DA revision rollup: any deal that reached DA Sent contributes its counter.
    const revs = p.daRevisionCounter || 0;
    if (m.hasDaSent && !cancelled) {
      if (revs > 0) {
        daLoop.dealsWithRevisions += 1;
        daLoop.totalRevisions += revs;
        if (revs > daLoop.maxRevisions) daLoop.maxRevisions = revs;
      }
    }

    if (cancelled) continue; // backlog / loop drill-downs are live-pipeline only

    // Backlog buckets — first unmet gate after Entered Design.
    if (!m.hasDaSent) {
      const waitSince = p.siteSurveyCompletionDate || p.closeDate!;
      drillDown.awaitingDaSend.push(
        toDeal(p, daysBetween(waitSince, today), statusLabel("layout_status", p.layoutStatus))
      );
    } else if (!m.hasDaApproved) {
      const waitSince = p.designApprovalSentDate || p.closeDate!;
      const deal = toDeal(p, daysBetween(waitSince, today), statusLabel("layout_status", p.layoutStatus));
      drillDown.awaitingDaApproval.push(deal);
      // DA revision loop = DA-sent-not-approved deals sitting in a bounce status.
      if (p.layoutStatus && DA_REVISION_STATES.has(p.layoutStatus)) {
        daLoop.inRevisionNow += 1;
        daLoop.inRevisionAmount += amt;
        daLoop.deals.push(deal);
        const lbl = statusLabel("layout_status", p.layoutStatus) ?? p.layoutStatus;
        daLoopStatus.set(lbl, (daLoopStatus.get(lbl) || 0) + 1);
      }
    } else if (!m.hasDesignDrafted) {
      const waitSince = p.designApprovalDate || p.closeDate!;
      const deal = toDeal(p, daysBetween(waitSince, today), statusLabel("design_status", p.designStatus));
      drillDown.awaitingDesignDraft.push(deal);
      if (p.designStatus && DESIGN_REVISION_STATES.has(p.designStatus)) {
        designLoop.inRevisionNow += 1;
        designLoop.inRevisionAmount += amt;
        designLoop.deals.push(deal);
        const lbl = statusLabel("design_status", p.designStatus) ?? p.designStatus;
        designLoopStatus.set(lbl, (designLoopStatus.get(lbl) || 0) + 1);
      }
    } else if (!m.hasDesignComplete) {
      const waitSince = p.designDraftDate || p.designApprovalDate || p.closeDate!;
      const deal = toDeal(p, daysBetween(waitSince, today), statusLabel("design_status", p.designStatus));
      drillDown.awaitingDesignComplete.push(deal);
      if (p.designStatus && DESIGN_REVISION_STATES.has(p.designStatus)) {
        designLoop.inRevisionNow += 1;
        designLoop.inRevisionAmount += amt;
        designLoop.deals.push(deal);
        const lbl = statusLabel("design_status", p.designStatus) ?? p.designStatus;
        designLoopStatus.set(lbl, (designLoopStatus.get(lbl) || 0) + 1);
      }
    }

    // Status depth — every in-design deal not yet design-complete, by its
    // live design_status and layout_status.
    if (!m.hasDesignComplete) {
      const dLbl = statusLabel("design_status", p.designStatus) || "No status";
      const dEntry = designDepth.get(dLbl) || { count: 0, amount: 0 };
      dEntry.count += 1;
      dEntry.amount += amt;
      designDepth.set(dLbl, dEntry);

      const lLbl = statusLabel("layout_status", p.layoutStatus) || "No status";
      const lEntry = layoutDepth.get(lLbl) || { count: 0, amount: 0 };
      lEntry.count += 1;
      lEntry.amount += amt;
      layoutDepth.set(lLbl, lEntry);
    }
  }

  // Finalize revision loops
  daLoop.avgRevisions =
    summary.daSent.count > 0
      ? Math.round((daLoop.totalRevisions / summary.daSent.count) * 100) / 100
      : null;
  daLoop.byStatus = [...daLoopStatus.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
  daLoop.deals.sort((a, b) => b.revisionCount - a.revisionCount || b.daysWaiting - a.daysWaiting);

  designLoop.byStatus = [...designLoopStatus.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
  designLoop.deals.sort((a, b) => b.daysWaiting - a.daysWaiting);

  const byWaitDesc = (a: DesignFunnelDeal, b: DesignFunnelDeal) => b.daysWaiting - a.daysWaiting;
  drillDown.awaitingDaSend.sort(byWaitDesc);
  drillDown.awaitingDaApproval.sort(byWaitDesc);
  drillDown.awaitingDesignDraft.sort(byWaitDesc);
  drillDown.awaitingDesignComplete.sort(byWaitDesc);

  const designStatusDepth = [...designDepth.entries()]
    .map(([status, v]) => ({ status, count: v.count, amount: v.amount }))
    .sort((a, b) => b.count - a.count);
  const layoutStatusDepth = [...layoutDepth.entries()]
    .map(([status, v]) => ({ status, count: v.count, amount: v.amount }))
    .sort((a, b) => b.count - a.count);

  return {
    summary,
    medianDays: {
      enteredToDaSent: median(dEnteredToDaSent),
      daSentToApproved: median(dDaSentToApproved),
      approvedToDrafted: median(dApprovedToDrafted),
      draftedToComplete: median(dDraftedToComplete),
      approvedToComplete: median(dApprovedToComplete),
    },
    designStatusDepth,
    layoutStatusDepth,
    daLoop,
    designLoop,
    drillDown,
    summaryByLocation,
    filterOptions,
    generatedAt: new Date().toISOString(),
  };
}
