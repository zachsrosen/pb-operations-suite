// Type-only imports where possible — this file is pulled into client bundles,
// so it must stay free of server-only runtime dependencies. The runtime
// exports (parseTab, GROUP_LABELS, ...) are pure data and string narrowing.

/** The two status properties the hub works from, one per tab. */
export type Tab = "design" | "da";

/**
 * Narrow an untrusted query param to a Tab, or null when invalid. Lives here
 * rather than in access.ts because client components need it and access.ts is
 * server-only (it reads process.env.DESIGN_HUB_ENABLED).
 */
export function parseTab(value: string | null): Tab | null {
  return value === "design" || value === "da" ? value : null;
}

/**
 * Union of every group across BOTH tabs. Each tab's config declares only its
 * own subset (design tab: idr…other; da tab: send…rejection_revision), and the
 * Queue UI hides a tab strip entry whose group has no rows — same approach as
 * pi-hub, where "inspection" exists in the union but only permit uses it.
 */
export type GroupKey =
  // design tab
  | "idr"
  | "fdr"
  | "revisions_needed"
  | "revisions_in_progress"
  | "other"
  // da tab
  | "send"
  | "waiting_info"
  | "follow_up"
  | "rejection_revision";

export const GROUP_LABELS: Record<GroupKey, string> = {
  idr: "IDR",
  fdr: "FDR",
  revisions_needed: "Revisions Needed",
  revisions_in_progress: "Revisions In Progress",
  other: "Other",
  send: "Send",
  waiting_info: "Waiting on Info",
  follow_up: "Follow Up",
  rejection_revision: "Rejection/Revision",
};

/**
 * Revision type, used to split the two revision lanes into labelled sections.
 * Five sub-sections render INSIDE the lane rather than as five more tabs — the
 * queue rail is a fixed 420px and the strip would wrap.
 */
export type SubGroupKey = "da" | "permit" | "utility" | "as_built" | "idr";

export const SUB_GROUP_ORDER: readonly SubGroupKey[] = [
  "da",
  "permit",
  "utility",
  "as_built",
  "idr",
];

export const SUB_GROUP_LABELS: Record<SubGroupKey, string> = {
  da: "Design Approval",
  permit: "Permit / AHJ",
  utility: "Utility",
  as_built: "As-Built",
  idr: "IDR",
};

/** Open assignment summary attached to a queue row. */
export interface QueueAssignment {
  id: string;
  assigneeEmail: string;
  assigneeName: string;
  assignedBy: string;
  note: string | null;
  dueDate: string | null;
  createdAt: string;
  /**
   * True when the deal's status property no longer holds the value it had when
   * the assignment was created. Surfaced as a hint only — assignments are
   * never auto-cleared, because a HubSpot workflow flipping a status would
   * then silently eat the ask.
   */
  statusMoved: boolean;
  /** Status label at assignment time, shown alongside the moved hint. */
  statusAtAssignmentLabel: string;
}

export interface QueueItem {
  dealId: string;
  name: string;
  address: string | null;
  pbLocation: string | null;
  /** HubSpot internal VALUE — routing/filtering only. */
  status: string;
  /** Human label — display this. */
  statusLabel: string;
  dealStage: string | null;
  /** Computed server-side from config. */
  group: GroupKey;
  /** Only set on the two revision lanes; null everywhere else. */
  subGroup: SubGroupKey | null;
  daysInStatus: number | null;
  isStale: boolean;
  lead: string | null;
  leadOwnerId: string | null;
  pm: string | null;
  amount: number | null;
  /**
   * Open assignment, joined in the queue ROUTE (not the cached build) so a
   * clear never shows a stale badge for the cache's 15-minute stale window.
   */
  assignment?: QueueAssignment | null;
}

export interface SetStatusResult {
  ok: boolean;
  /** Non-fatal post-write failures ("note failed" etc.). */
  warnings: string[];
}

/** Revision counters, with the mismatch `sub-counter-attribution` repairs. */
export interface RevisionCounters {
  total: number | null;
  counter: number | null;
  da: number | null;
  permit: number | null;
  interconnection: number | null;
  asBuilt: number | null;
  /** IDR revisions are tracked in their own counter and do NOT roll into
   *  revision_counter — shown for context, excluded from the mismatch check. */
  idr: number | null;
  /** True when the DA/permit/utility/as-built sub-counters don't sum to
   *  `counter`, or `counter` !== `total`. IDR is not part of this. */
  mismatch: boolean;
}

/** A populated revision / change reason, labelled by the workstream it came
 *  from (DA, Permit, Utility, As-Built, IDR, Design, Sales, Ops). */
export interface RevisionReason {
  label: string;
  reason: string;
}

export interface ProjectDetail {
  deal: {
    id: string;
    name: string;
    address: string | null;
    amount: number | null;
    pbLocation: string | null;
    lead: string | null;
    pm: string | null;
    /** HubSpot internal VALUE for the ACTIVE tab's property. */
    status: string;
    /** Human label for `status`. Display this. */
    statusLabel: string;
    /** The other tab's status, shown for context (design ⇄ DA). */
    otherStatusLabel: string | null;
    systemSizeKw: number | null;
    dealStage: string | null;
    hubspotUrl: string;
    designFolderUrl: string | null;
    driveFolderUrl: string | null;
    /** Site-survey document folder (site_survey_documents). */
    surveyFolderUrl: string | null;
    /** Sales document folder (sales_documents). */
    salesFolderUrl: string | null;
    /** OpenSolar proposal (os_project_link / link_to_opensolar). */
    openSolarUrl: string | null;
    /** Vishtik project (vishtik_project_url deal property). */
    vishtikUrl: string | null;
    /** TrueDesign design PDF — a Drive file link built from the deal's most
     *  recent EagleViewOrder.designPdfDriveFileId. Null when no order has
     *  pulled a design export yet. */
    trueDesignUrl: string | null;
  };
  revisions: RevisionCounters;
  /** Populated revision / change reasons for this deal, most relevant first. */
  revisionReasons: RevisionReason[];
  assignment: QueueAssignment | null;
  /** Both status timelines, each entry tagged by `property` so the UI can
   *  split them into side-by-side Design and Design-Approval columns. */
  statusHistory: Array<{
    property: string;
    propertyLabel: string;
    value: string | null;
    valueLabel: string | null;
    timestamp: string;
  }>;
  activity: Array<{
    id: string;
    type: "email" | "call" | "note" | "meeting" | "task";
    subject: string | null;
    body: string | null;
    timestamp: string;
  }>;
}
