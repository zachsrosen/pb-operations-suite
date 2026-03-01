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
  "Resubmitted to AHJ": "Follow up with AHJ",
};

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
  "Resubmitted To Utility": "Follow up with utility",
};

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
