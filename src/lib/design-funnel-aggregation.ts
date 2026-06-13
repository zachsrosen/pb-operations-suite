import type { Project } from "@/lib/hubspot";
import { DEAL_STAGE_MAP } from "@/lib/hubspot";
import { normalizeLocation } from "@/lib/locations";
import { statusLabel } from "@/lib/deal-status-labels";
import { resolveMilestones } from "@/lib/project-funnel-aggregation";

// ─────────────────────────────────────────────────────────────────────────────
// Design & Engineering funnel
//
// Two independent views of the same set of active projects:
//
//   A. Deal-stage breakdown — each HubSpot pipeline stage, with its projects
//      broken down by design_status. "All design statuses, organized by stage."
//
//   B. Design-status funnel — every active project lands in exactly ONE bucket.
//      The DA-send / DA-approval / design-complete buckets reuse the SAME
//      milestone resolution as the Project Pipeline Funnel (resolveMilestones),
//      so "Awaiting DA Send / DA Approval / Design Complete" mean exactly what
//      they mean there. On top of that we split out the three post-completion
//      revision loops (utility / permit / as-built) that reopen a finished
//      design. IDR and DA revisions are *prior* to completion, so they stay
//      inside the awaiting buckets (visible as their design_status).
// ─────────────────────────────────────────────────────────────────────────────

export const DESIGN_BUCKETS = [
  "awaitingDesignUpload",
  "awaitingDesignReview",
  "awaitingDaSend",
  "awaitingDaApproval",
  "awaitingDesignComplete",
  "designComplete",
  "utilityRevision",
  "permitRevision",
  "asBuiltRevision",
] as const;

export type DesignBucketKey = (typeof DESIGN_BUCKETS)[number];

export const DESIGN_BUCKET_LABELS: Record<DesignBucketKey, string> = {
  awaitingDesignUpload: "Awaiting Design Upload",
  awaitingDesignReview: "Awaiting Design Review",
  awaitingDaSend: "Awaiting DA Send",
  awaitingDaApproval: "Awaiting DA Approval",
  awaitingDesignComplete: "Awaiting Design Complete",
  designComplete: "Design Complete",
  utilityRevision: "Utility Revision In Progress",
  permitRevision: "Permit Revision In Progress",
  asBuiltRevision: "As-Built Revision In Progress",
};

/** One project row for a bucket / stage drill-down. */
export interface DesignFunnelDeal {
  id: number;
  name: string;
  projectNumber: string;
  amount: number;
  pbLocation: string;
  url: string;
  /** Current HubSpot pipeline stage name. */
  stage: string;
  /** Resolved design_status label (or "No status"). */
  designStatus: string;
  daysInStage: number;
  designLead: string;
  projectManager: string;
  dealOwner: string;
  flag: DesignFunnelFlag | null;
}

export interface DesignFunnelFlag {
  label: string;
  tone: "yellow" | "red" | "orange";
  reason: string | null;
}

export interface DesignStatusSegment {
  status: string;
  count: number;
  amount: number;
}

/** A group (bucket or pipeline stage) with its design-status breakdown + deals. */
export interface DesignFunnelGroup {
  key: string;
  label: string;
  count: number;
  amount: number;
  statusBreakdown: DesignStatusSegment[];
  deals: DesignFunnelDeal[];
}

export interface DesignFunnelResponse {
  /** Section A — deal pipeline stages, each broken down by design_status. */
  stageBreakdown: DesignFunnelGroup[];
  /** Section B — the mutually-exclusive design-status funnel buckets, in order. */
  buckets: DesignFunnelGroup[];
  totalProjects: number;
  totalAmount: number;
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
  "20440344": 12, // On Hold
};

// Post-completion revision states (raw design_status values). A completed design
// that reopens for one of these lands in the matching revision bucket. "Needed"
// (the trigger) and "In Progress" both count as an active loop; "Completed" does
// not (it's flowed back to done).
const UTILITY_REVISION_STATES = new Set<string>([
  "Utility Revision In Progress",
  "Revision Needed - Rejected by Utility",
]);
const PERMIT_REVISION_STATES = new Set<string>([
  "Permit Revision In Progress",
  "Revision Needed - Rejected by AHJ",
]);
const AS_BUILT_REVISION_STATES = new Set<string>([
  "As-Built Revision In Progress",
  "Revision Needed - Rejected",
]);

// design_status raw values that mean the design has NOT yet cleared Initial
// Design Review (IDR). An uploaded design not in this set is "reviewed". Used
// only to split the pre-DA-send region into upload vs review vs ready-to-send.
const PRE_REVIEW_STATES = new Set<string>([
  "Ready for Design",
  "In Progress",
  "Draft Complete",
  "Initial Review",
  "IDR Revision Needed",
  "IDR Revision in Progress",
  "Needs Clarification",
  "Needs Clarification from Customer",
  "Needs Clarification from Sales",
  "Needs Clarification from Operations",
  "Pending Resurvey",
  "On Hold",
  "No Design Needed",
  "New Construction - Design Needed",
  "New Construction - In Progress",
  "Xcel - Design Needed",
  "Xcel - In Progress",
]);

/** Active = still in flight: not cancelled and not project-complete. */
function isActiveDeal(p: Project): boolean {
  return p.stageId !== CANCELLED_STAGE_ID && p.stageId !== PROJECT_COMPLETE_STAGE_ID;
}

/**
 * Which mutually-exclusive design bucket a project belongs to. The awaiting /
 * complete buckets are driven by the Project Pipeline Funnel's milestone
 * resolution so they reconcile with that funnel exactly; the three
 * post-completion revision loops are layered on top via design_status.
 */
function resolveBucket(p: Project): DesignBucketKey {
  const ds = p.designStatus;
  if (ds && AS_BUILT_REVISION_STATES.has(ds)) return "asBuiltRevision";
  if (ds && PERMIT_REVISION_STATES.has(ds)) return "permitRevision";
  if (ds && UTILITY_REVISION_STATES.has(ds)) return "utilityRevision";

  const m = resolveMilestones(p);
  if (m.hasDesignComplete) return "designComplete";
  if (m.hasDaApproved) return "awaitingDesignComplete";
  if (m.hasDaSent) return "awaitingDaApproval";

  // Pre-DA-send: subdivide by where the design is in upload → review → ready.
  // "Upload" = planset uploaded (design_draft_completion_date); "reviewed" =
  // past IDR (design_status no longer a pre-review state).
  const uploaded = !!p.designDraftDate || ds === "Draft Complete";
  if (!uploaded) return "awaitingDesignUpload";
  const reviewed = !!ds && !PRE_REVIEW_STATES.has(ds);
  return reviewed ? "awaitingDaSend" : "awaitingDesignReview";
}

/** Flag a parked / blocked / sales-change project. */
function designFlag(p: Project): DesignFunnelFlag | null {
  if (p.stageId === ON_HOLD_STAGE_ID) {
    return { label: "On hold", tone: "yellow", reason: p.onHoldReason || null };
  }
  if (p.stageId === RTB_BLOCKED_STAGE_ID) {
    return { label: "RTB blocked", tone: "red", reason: p.rtbBlockedReason || null };
  }
  if (p.layoutStatus === "Pending Sales Changes") {
    return { label: "Sales change", tone: "orange", reason: p.salesChangeOrderNotes || null };
  }
  return null;
}

function toDeal(p: Project, designStatus: string): DesignFunnelDeal {
  return {
    id: p.id,
    name: p.name,
    projectNumber: p.projectNumber,
    amount: p.amount || 0,
    pbLocation: p.pbLocation,
    url: p.url,
    stage: p.stage || DEAL_STAGE_MAP[p.stageId || ""] || "Unknown",
    designStatus,
    daysInStage: Math.max(0, p.daysSinceStageMovement || 0),
    designLead: p.designLead || "",
    projectManager: p.projectManager || "",
    dealOwner: p.dealOwner || "",
    flag: designFlag(p),
  };
}

/** Accumulator that builds one DesignFunnelGroup. */
class GroupBuilder {
  count = 0;
  amount = 0;
  private statuses = new Map<string, { count: number; amount: number }>();
  deals: DesignFunnelDeal[] = [];

  constructor(public key: string, public label: string) {}

  add(p: Project, statusLbl: string): void {
    const amt = p.amount || 0;
    this.count += 1;
    this.amount += amt;
    const s = this.statuses.get(statusLbl) || { count: 0, amount: 0 };
    s.count += 1;
    s.amount += amt;
    this.statuses.set(statusLbl, s);
    this.deals.push(toDeal(p, statusLbl));
  }

  build(): DesignFunnelGroup {
    return {
      key: this.key,
      label: this.label,
      count: this.count,
      amount: this.amount,
      statusBreakdown: [...this.statuses.entries()]
        .map(([status, v]) => ({ status, count: v.count, amount: v.amount }))
        .sort((a, b) => b.count - a.count),
      deals: this.deals.sort((a, b) => b.daysInStage - a.daysInStage),
    };
  }
}

export function buildDesignFunnelData(
  projects: Project[],
  locations?: string[],
  filters?: { designLeads?: string[]; projectManagers?: string[] }
): DesignFunnelResponse {
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

  const scopeForOptions = projects.filter((p) => isActiveDeal(p) && matchesLocation(p));
  const filterOptions = {
    designLeads: [...new Set(scopeForOptions.map((p) => p.designLead).filter((v): v is string => !!v))].sort(),
    projectManagers: [...new Set(scopeForOptions.map((p) => p.projectManager).filter((v): v is string => !!v))].sort(),
  };

  const filtered = scopeForOptions.filter(matchesStaff);

  // Section B — design-status buckets
  const bucketBuilders = new Map<DesignBucketKey, GroupBuilder>(
    DESIGN_BUCKETS.map((k) => [k, new GroupBuilder(k, DESIGN_BUCKET_LABELS[k])])
  );
  // Section A — pipeline-stage breakdown
  const stageBuilders = new Map<string, GroupBuilder>();

  let totalProjects = 0;
  let totalAmount = 0;

  for (const p of filtered) {
    totalProjects += 1;
    totalAmount += p.amount || 0;
    const statusLbl = statusLabel("design_status", p.designStatus) || "No status";

    bucketBuilders.get(resolveBucket(p))!.add(p, statusLbl);

    const sid = p.stageId || "unknown";
    if (!stageBuilders.has(sid)) {
      stageBuilders.set(sid, new GroupBuilder(sid, p.stage || DEAL_STAGE_MAP[sid] || sid));
    }
    stageBuilders.get(sid)!.add(p, statusLbl);
  }

  const buckets = DESIGN_BUCKETS.map((k) => bucketBuilders.get(k)!.build());
  const stageBreakdown = [...stageBuilders.values()]
    .map((b) => b.build())
    .sort((a, b) => (STAGE_PRIORITY_MAP[a.key] ?? 99) - (STAGE_PRIORITY_MAP[b.key] ?? 99));

  return {
    stageBreakdown,
    buckets,
    totalProjects,
    totalAmount,
    filterOptions,
    generatedAt: new Date().toISOString(),
  };
}
