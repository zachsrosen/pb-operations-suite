import type { GroupKey, SubGroupKey, Tab } from "./types";

/**
 * Per-tab configuration. The two tabs are structurally identical and differ
 * only in which HubSpot status property they read and how its values bucket —
 * the same shape pi-hub uses for permit / ic / pto.
 *
 * All status strings here are HubSpot internal VALUES, not labels. Several
 * differ sharply from what the UI shows (design_status "Ready for Review"
 * displays as "Final Review/Stamping", "DA Approved" as "Final Design
 * Review", "Revision Needed - Rejected" as "Revision Needed - As-Built").
 * See lib/deal-status-labels.ts for the full value→label maps.
 */
export interface TabConfig {
  key: Tab;
  label: string;
  accent: "purple" | "cyan";
  statusProperty: string;
  /** The OTHER tab's property, shown as context on the detail pane. */
  otherStatusProperty: string;
  /** HubSpot enum property naming the design lead (not an owner ID). */
  roleProperty: string;
  leadLabel: string;
  /** Excluded from the queue entirely — the work is done or never existed. */
  terminalStatuses: readonly string[];
  /** Ordered: the tab strip renders groups in this order. */
  groupOrder: readonly GroupKey[];
  groups: Partial<Record<GroupKey, readonly string[]>>;
  /**
   * Status → revision type, for the lanes that sub-group. Absent on tabs
   * without sub-grouped lanes.
   */
  subGroups?: Partial<Record<SubGroupKey, readonly string[]>>;
  /**
   * True when `groups` is exhaustive over the property's non-terminal values,
   * i.e. the tab has no catch-all. The config test asserts full coverage for
   * these tabs; a new HubSpot option would otherwise vanish from the queue.
   */
  exhaustive: boolean;
}

export const TAB_CONFIGS: Record<Tab, TabConfig> = {
  design: {
    key: "design",
    label: "Design",
    accent: "purple",
    statusProperty: "design_status",
    otherStatusProperty: "layout_status",
    roleProperty: "design",
    leadLabel: "Design Lead",
    // "Complete" is labelled "Design Complete". The five *Revision Completed
    // states are terminal by decision (Zach 2026-07-22) — that revision is
    // done, so the deal is off the designer's plate.
    terminalStatuses: [
      "Complete",
      "DA Revision Completed",
      "Permit Revision Completed",
      "Utility Revision Completed",
      "As-Built Revision Completed",
      "IDR Revision Complete",
      "No Design Needed",
      "New Construction - Design Completed",
      "Xcel - Site Plan & SLD Completed",
    ],
    groupOrder: [
      "idr",
      "fdr",
      "revisions_needed",
      "revisions_in_progress",
      "other",
    ],
    groups: {
      // "Initial Review" is labelled "Initial Design Review".
      idr: ["Initial Review"],
      // Both final-review states share one lane (Zach 2026-07-22):
      // "Ready for Review" = Final Review/Stamping, "DA Approved" = Final
      // Design Review.
      fdr: ["Ready for Review", "DA Approved"],
      revisions_needed: [
        "Revision Needed - DA Rejected",
        "Revision Needed - Rejected by AHJ",
        "Revision Needed - Rejected by Utility",
        "Revision Needed - Rejected", // labelled "Revision Needed - As-Built"
        "IDR Revision Needed",
      ],
      revisions_in_progress: [
        "DA Revision In Progress",
        "Permit Revision In Progress",
        "Utility Revision In Progress",
        "As-Built Revision In Progress",
        "IDR Revision in Progress", // lowercase "in" — matches HubSpot exactly
      ],
      // other (catch-all): Ready for Design, In Progress, Draft Complete,
      // Submitted To Engineering, Needs Clarification (+ from Customer /
      // Sales / Operations), Pending Resurvey, On Hold, New Construction
      // Design Needed / In Progress / Ready for Review, Xcel Design Needed /
      // In Progress, and the five (Archived) statuses. Archived statuses land
      // here rather than in terminal on purpose: a deal still sitting on a
      // dead status should be visible, not silently gone.
    },
    subGroups: {
      da: ["Revision Needed - DA Rejected", "DA Revision In Progress"],
      permit: ["Revision Needed - Rejected by AHJ", "Permit Revision In Progress"],
      utility: [
        "Revision Needed - Rejected by Utility",
        "Utility Revision In Progress",
      ],
      as_built: ["Revision Needed - Rejected", "As-Built Revision In Progress"],
      idr: ["IDR Revision Needed", "IDR Revision in Progress"],
    },
    exhaustive: false, // has an `other` catch-all
  },
  da: {
    key: "da",
    label: "Design Approval",
    accent: "cyan",
    statusProperty: "layout_status",
    otherStatusProperty: "design_status",
    roleProperty: "design",
    leadLabel: "Design Lead",
    terminalStatuses: ["Design Approved"],
    groupOrder: ["send", "waiting_info", "follow_up", "rejection_revision"],
    groups: {
      // "Ready" is labelled "Review In Progress", "Draft Created" is labelled
      // "Draft Complete", "Revision Returned From Design" is labelled "DA
      // Revision Ready To Send".
      send: [
        "Ready",
        "Pending Review",
        "Draft Created",
        "Revision Returned From Design",
      ],
      waiting_info: [
        "Needs Clarification",
        "Pending Sales Changes",
        "Pending Ops Changes",
        "Pending Design Changes",
        "Pending Resurvey",
      ],
      // "Sent to Customer" is labelled "Sent For Approval".
      follow_up: ["Sent to Customer", "Resent For Approval"],
      rejection_revision: ["Design Rejected", "In Revision"],
    },
    // All 14 layout_status values are placed across the four groups plus
    // terminal, so this tab has no catch-all and the config test asserts
    // exhaustive coverage.
    exhaustive: true,
  },
};

/** Group for a status value. Falls back to "other" on non-exhaustive tabs. */
export function groupForStatus(config: TabConfig, status: string): GroupKey {
  for (const [group, statuses] of Object.entries(config.groups)) {
    if (statuses?.includes(status)) return group as GroupKey;
  }
  return "other";
}

/** Revision type for a status, or null when the status isn't a revision. */
export function subGroupForStatus(
  config: TabConfig,
  status: string,
): SubGroupKey | null {
  if (!config.subGroups) return null;
  for (const [sub, statuses] of Object.entries(config.subGroups)) {
    if (statuses?.includes(status)) return sub as SubGroupKey;
  }
  return null;
}
