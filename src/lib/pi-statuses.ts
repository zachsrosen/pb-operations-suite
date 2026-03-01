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
