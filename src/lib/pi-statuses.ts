// src/lib/pi-statuses.ts
// Shared permitting, interconnection, and PTO status constants
// Used by: pi-overview, pi-action-queue, ahj-tracker, utility-tracker

// ---- Permitting ----

/** Active permit statuses (pre-decision, in-review) */
export const PERMIT_ACTIVE_STATUSES = [
  "Awaiting Utility Approval",
  "Ready For Permitting",
  "Submitted To Customer",
  "Customer Signature Acquired",
  "Waiting On Information",
  "Submitted to AHJ",
  "Resubmitted to AHJ",
  "Pending SolarApp",
  "Submit SolarApp to AHJ",
];

/** Permit revision/rejection statuses */
export const PERMIT_REVISION_STATUSES = [
  "Non-Design Related Rejection",
  "Rejected",
  "In Design For Revision",
  "Returned from Design",
  "As-Built Revision Needed",
  "As-Built Revision In Progress",
  "As-Built Ready To Resubmit",
  "As-Built Revision Resubmitted",
];

/** Statuses where the ball is in our court — permitting */
export const PERMIT_ACTION_STATUSES: Record<string, string> = {
  "Ready For Permitting": "Submit to AHJ",
  "Customer Signature Acquired": "Submit to AHJ",
  "Non-Design Related Rejection": "Review rejection",
  "Rejected": "Revise & resubmit",
  "In Design For Revision": "Complete revision",
  "Returned from Design": "Resubmit to AHJ",
  "As-Built Revision Needed": "Start as-built revision",
  "As-Built Revision In Progress": "Complete as-built",
  "As-Built Ready To Resubmit": "Resubmit as-built",
  "Pending SolarApp": "Submit SolarApp",
  "Submit SolarApp to AHJ": "Submit SolarApp to AHJ",
  "Submitted to AHJ": "Follow up with AHJ",
  "Resubmitted to AHJ": "Follow up with AHJ",
};

// ---- Permit Hub action kinds (internal routing to action forms) ----

/** Tuple used for Zod enums and exhaustive switches — keep in sync with the object below. */
export const PERMIT_ACTION_KINDS = [
  "SUBMIT_TO_AHJ",
  "RESUBMIT_TO_AHJ",
  "REVIEW_REJECTION",
  "FOLLOW_UP",
  "COMPLETE_REVISION",
  "START_AS_BUILT_REVISION",
  "COMPLETE_AS_BUILT",
  "SUBMIT_SOLARAPP",
  "MARK_PERMIT_ISSUED",
] as const;

export type PermitActionKind = (typeof PERMIT_ACTION_KINDS)[number];

/**
 * Maps a permit action kind to candidate HubSpot task subject patterns.
 * When completing an action, the hub looks up an open task on the deal whose
 * subject matches one of these patterns (case-insensitive, substring match).
 * If none match, the action route surfaces a warning + "write status field
 * directly" escape hatch.
 */
export const PERMIT_ACTION_TASK_SUBJECTS: Record<PermitActionKind, readonly string[]> = {
  SUBMIT_TO_AHJ: ["submit to ahj", "submit permit"],
  RESUBMIT_TO_AHJ: ["resubmit to ahj", "resubmit permit"],
  REVIEW_REJECTION: ["review rejection", "permit rejected"],
  FOLLOW_UP: ["follow up with ahj", "permit follow up"],
  COMPLETE_REVISION: ["complete revision", "revision complete"],
  START_AS_BUILT_REVISION: ["start as-built", "as-built revision"],
  COMPLETE_AS_BUILT: ["complete as-built"],
  SUBMIT_SOLARAPP: ["submit solarapp", "solarapp submission"],
  MARK_PERMIT_ISSUED: ["permit issued", "permit approved"],
};

/** Maps a HubSpot `permitting_status` value to the internal action kind. */
export function actionKindForStatus(status: string): PermitActionKind | null {
  const map: Record<string, PermitActionKind> = {
    "Ready For Permitting": "SUBMIT_TO_AHJ",
    "Customer Signature Acquired": "SUBMIT_TO_AHJ",
    "Rejected": "REVIEW_REJECTION",
    "Non-Design Related Rejection": "REVIEW_REJECTION",
    "In Design For Revision": "COMPLETE_REVISION",
    "Returned from Design": "RESUBMIT_TO_AHJ",
    "As-Built Revision Needed": "START_AS_BUILT_REVISION",
    "As-Built Revision In Progress": "COMPLETE_AS_BUILT",
    "As-Built Ready To Resubmit": "RESUBMIT_TO_AHJ",
    "Pending SolarApp": "SUBMIT_SOLARAPP",
    "Submit SolarApp to AHJ": "SUBMIT_SOLARAPP",
    "Submitted to AHJ": "FOLLOW_UP",
    "Resubmitted to AHJ": "FOLLOW_UP",
    "Awaiting Utility Approval": "FOLLOW_UP",
  };
  return map[status] ?? null;
}

// ---- Interconnection ----

/** IC statuses indicating active applications */
export const IC_ACTIVE_STATUSES = [
  "Ready for Interconnection",
  "Submitted To Customer",
  "Ready To Submit - Pending Design",
  "Signature Acquired By Customer",
  "Submitted To Utility",
  "Waiting On Information",
  "Waiting on Utility Bill",
  "Waiting on New Construction",
  "In Review",
];

/** IC revision/rejection statuses */
export const IC_REVISION_STATUSES = [
  "Non-Design Related Rejection",
  "Rejected (New)",
  "Rejected",
  "In Design For Revisions",
  "Revision Returned From Design",
  "Resubmitted To Utility",
];

/** Statuses where the ball is in our court — interconnection */
export const IC_ACTION_STATUSES: Record<string, string> = {
  "Ready for Interconnection": "Submit to utility",
  "Signature Acquired By Customer": "Submit to utility",
  "Non-Design Related Rejection": "Review rejection",
  "Rejected (New)": "Review rejection",
  "Rejected": "Revise & resubmit",
  "In Design For Revisions": "Complete revision",
  "Revision Returned From Design": "Resubmit to utility",
  "Waiting On Information": "Provide information",
  "Submitted To Utility": "Follow up with utility",
  "Resubmitted To Utility": "Follow up with utility",
};

// ---- IC Hub action kinds (internal routing to action forms) ----

export const IC_ACTION_KINDS = [
  "SUBMIT_TO_UTILITY",
  "RESUBMIT_TO_UTILITY",
  "REVIEW_IC_REJECTION",
  "COMPLETE_IC_REVISION",
  "PROVIDE_INFORMATION",
  "FOLLOW_UP_UTILITY",
  "MARK_IC_APPROVED",
] as const;

export type IcActionKind = (typeof IC_ACTION_KINDS)[number];

/** Maps a permit-hub-style action kind to HubSpot task subject patterns. */
export const IC_ACTION_TASK_SUBJECTS: Record<IcActionKind, readonly string[]> = {
  SUBMIT_TO_UTILITY: ["submit to utility", "submit ic", "submit interconnection"],
  RESUBMIT_TO_UTILITY: ["resubmit to utility", "resubmit ic", "resubmit interconnection"],
  REVIEW_IC_REJECTION: ["review rejection", "ic rejected", "interconnection rejected"],
  COMPLETE_IC_REVISION: ["complete revision", "ic revision complete"],
  PROVIDE_INFORMATION: ["provide information", "send information", "respond to utility"],
  FOLLOW_UP_UTILITY: ["follow up with utility", "ic follow up"],
  MARK_IC_APPROVED: ["ic approved", "interconnection approved"],
};

export function icActionKindForStatus(status: string): IcActionKind | null {
  const map: Record<string, IcActionKind> = {
    "Ready for Interconnection": "SUBMIT_TO_UTILITY",
    "Signature Acquired By Customer": "SUBMIT_TO_UTILITY",
    "Rejected": "REVIEW_IC_REJECTION",
    "Rejected (New)": "REVIEW_IC_REJECTION",
    "Non-Design Related Rejection": "REVIEW_IC_REJECTION",
    "In Design For Revisions": "COMPLETE_IC_REVISION",
    "Revision Returned From Design": "RESUBMIT_TO_UTILITY",
    "Waiting On Information": "PROVIDE_INFORMATION",
    "Submitted To Utility": "FOLLOW_UP_UTILITY",
    "Resubmitted To Utility": "FOLLOW_UP_UTILITY",
  };
  return map[status] ?? null;
}

// ---- PTO ----

/** PTO pipeline statuses */
export const PTO_PIPELINE_STATUSES = [
  "PTO Waiting on Interconnection Approval",
  "Inspection Passed - Ready for Utility",
  "Inspection Submitted to Utility",
  "Resubmitted to Utility",
  "Inspection Rejected By Utility",
  "Ops Related PTO Rejection",
  "Waiting On Information",
  "Waiting on New Construction",
  "Pending Truck Roll",
  "Xcel Photos Ready to Submit",
  "Xcel Photos Submitted",
  "XCEL Photos Rejected",
  "Xcel Photos Ready to Resubmit",
  "Xcel Photos Resubmitted",
  "Xcel Photos Approved",
];

/** PTO action statuses */
export const PTO_ACTION_STATUSES: Record<string, string> = {
  "Inspection Passed - Ready for Utility": "Submit PTO",
  "Inspection Rejected By Utility": "Review rejection",
  "Ops Related PTO Rejection": "Fix ops issue",
  "Resubmitted to Utility": "Follow up",
  "Xcel Photos Ready to Submit": "Submit photos",
  "XCEL Photos Rejected": "Fix & resubmit photos",
  "Xcel Photos Ready to Resubmit": "Resubmit photos",
  "Pending Truck Roll": "Schedule truck roll",
};

// ---- Thresholds ----

/** Days threshold for marking an item as stale */
export const STALE_THRESHOLD_DAYS = 14;

// ---- Display name helpers (legacy parity) ----

const PERMIT_STATUS_DISPLAY_NAMES: Record<string, string> = {
  Complete: "Permit Issued",
  Rejected: "Permit Rejected - Needs Revision",
  "In Design For Revision": "Design Revision In Progress",
  "Returned from Design": "Revision Ready To Resubmit",
  "Pending SolarApp": "Ready to Submit for SolarApp",
};

const IC_STATUS_DISPLAY_NAMES: Record<string, string> = {
  "Signature Acquired By Customer": "Ready To Submit",
  "Rejected (New)": "Rejected",
  Rejected: "Rejected - Revisions Needed",
  "In Design For Revisions": "Design Revision In Progress",
  "Revision Returned From Design": "Revision Ready To Resubmit",
};

const PTO_STATUS_DISPLAY_NAMES: Record<string, string> = {
  "Inspection Passed - Ready for Utility": "Inspection Passed - Ready for PTO Submission",
  "Resubmitted to Utility": "PTO Revision Resubmitted",
  PTO: "PTO Granted",
};

export function getPermitStatusDisplayName(status: string | null | undefined): string {
  if (!status) return "";
  return PERMIT_STATUS_DISPLAY_NAMES[status] || status;
}

export function getICStatusDisplayName(status: string | null | undefined): string {
  if (!status) return "";
  return IC_STATUS_DISPLAY_NAMES[status] || status;
}

export function getPTOStatusDisplayName(status: string | null | undefined): string {
  if (!status) return "";
  return PTO_STATUS_DISPLAY_NAMES[status] || status;
}

// ---- Dynamic classifiers (active-data driven) ----

function hasAnyToken(status: string, tokens: string[]): boolean {
  return tokens.some((t) => status.includes(t));
}

export function isPermitRevisionStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return hasAnyToken(s, ["revision", "rejected", "returned from design", "resubmit"]);
}

export function isPermitCompletedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return hasAnyToken(s, ["issued", "approved", "complete", "received"]);
}

export function isPermitActiveStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  if (PERMIT_ACTIVE_STATUSES.includes(status) || isPermitRevisionStatus(status)) return true;
  if (isPermitCompletedStatus(status)) return false;
  const s = status.toLowerCase();
  return hasAnyToken(s, ["submitted", "in review", "pending", "in progress", "under review", "waiting", "ready"]);
}

export function isICRevisionStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return hasAnyToken(s, ["revision", "rejected", "returned from design", "resubmit"]);
}

export function isICCompletedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return hasAnyToken(s, ["approved", "granted", "complete", "received"]);
}

export function isICActiveStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  if (IC_ACTIVE_STATUSES.includes(status) || isICRevisionStatus(status)) return true;
  if (isICCompletedStatus(status)) return false;
  const s = status.toLowerCase();
  return hasAnyToken(s, ["submitted", "in review", "pending", "in progress", "under review", "waiting", "ready"]);
}

export function isPTOCompletedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return hasAnyToken(s, ["pto", "granted", "approved"]);
}

export function isPTOPipelineStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  if (PTO_PIPELINE_STATUSES.includes(status)) return true;
  if (isPTOCompletedStatus(status)) return false;
  const s = status.toLowerCase();
  return hasAnyToken(s, ["submitted", "resubmitted", "rejected", "waiting", "pending", "truck roll", "photos"]);
}

// ---- Dynamic fallback actions ----

export function getPermitAction(status: string | null | undefined): string | null {
  if (!status) return null;
  if (PERMIT_ACTION_STATUSES[status]) return PERMIT_ACTION_STATUSES[status];
  const s = status.toLowerCase();
  if (s.includes("ready to resubmit") || s.includes("returned from design")) return "Resubmit to AHJ";
  if (s.includes("resubmitted")) return "Follow up with AHJ";
  if (s.includes("rejected") || s.includes("revision")) return "Revise & resubmit";
  if (s.includes("ready") || s.includes("submitted to customer") || s.includes("signature")) return "Submit to AHJ";
  if (s.includes("waiting")) return "Provide information";
  return null;
}

export function getICAction(status: string | null | undefined): string | null {
  if (!status) return null;
  if (IC_ACTION_STATUSES[status]) return IC_ACTION_STATUSES[status];
  const s = status.toLowerCase();
  if (s.includes("ready to resubmit") || s.includes("returned from design")) return "Resubmit to utility";
  if (s.includes("resubmitted")) return "Follow up with utility";
  if (s.includes("rejected") || s.includes("revision")) return "Revise & resubmit";
  if (s.includes("ready") || s.includes("submitted to customer") || s.includes("signature")) return "Submit to utility";
  if (s.includes("waiting")) return "Provide information";
  return null;
}

export function getPTOAction(status: string | null | undefined): string | null {
  if (!status) return null;
  if (PTO_ACTION_STATUSES[status]) return PTO_ACTION_STATUSES[status];
  const s = status.toLowerCase();
  if (s.includes("ready to resubmit")) return "Resubmit to utility";
  if (s.includes("resubmitted")) return "Follow up";
  if (s.includes("rejected")) return "Fix & resubmit";
  if (s.includes("ready") || s.includes("inspection passed")) return "Submit PTO";
  if (s.includes("waiting")) return "Provide information";
  return null;
}
