/**
 * Value → display-label maps for HubSpot deal enumeration "status" properties.
 *
 * HubSpot stores an internal option *value* that often differs from the *label*
 * shown in the UI (e.g. permitting_status value "Complete" displays as
 * "Permit Issued"). Dashboards that surface these raw values look wrong, so
 * resolve them to their HubSpot labels via `statusLabel()`.
 *
 * Maps mirror the live HubSpot property option definitions. Unknown values
 * fall back to the raw value so nothing ever renders blank.
 */

type StatusMap = Record<string, string>;

const SITE_SURVEY_STATUS: StatusMap = {
  "Ready to Schedule": "Ready to Schedule",
  "Awaiting Reply": "Awaiting Reply",
  Scheduled: "Scheduled",
  "On Our Way": "On Our Way",
  Started: "Started",
  "In Progress": "In Progress",
  "Needs Revisit": "Needs Revisit",
  Completed: "Completed",
  "Scheduling On-Hold": "Scheduling On-Hold",
  "No Site Survey Needed": "No Site Survey Needed",
  "Pending Loan Approval": "Pending Loan Approval",
  "Waiting on Change Order": "Waiting on Change Order",
};

const LAYOUT_STATUS: StatusMap = {
  Ready: "Review In Progress",
  "Draft Created": "Draft Complete",
  "Sent to Customer": "Sent For Approval",
  "Needs Clarification": "Needs Clarification",
  "Design Approved": "Design Approved",
  "Design Rejected": "Design Rejected",
  "In Revision": "In Revision",
  "Revision Returned From Design": "DA Revision Ready To Send",
  "Resent For Approval": "Resent For Approval",
  "Pending Sales Changes": "Pending Sales Changes",
  "Pending Ops Changes": "Pending Ops Changes",
  "Pending Design Changes": "Pending Design Changes",
  "Pending Resurvey": "Pending Resurvey",
  "Pending Review": "Pending Review",
};

const DESIGN_STATUS: StatusMap = {
  "Ready for Design": "Ready for Design",
  "In Progress": "In Progress",
  "Initial Review": "Initial Design Review",
  "Ready for Review": "Final Review/Stamping",
  "Draft Complete": "Draft Complete - Waiting on Approvals",
  "DA Approved": "Final Design Review",
  "Submitted To Engineering": "Submitted To Engineering",
  Complete: "Design Complete",
  "Revision Needed - DA Rejected": "Revision Needed - DA Rejected",
  "DA Revision In Progress": "DA Revision In Progress",
  "DA Revision Completed": "DA Revision Completed",
  "Revision Needed - Rejected by AHJ": "Revision Needed - Rejected by AHJ",
  "Permit Revision In Progress": "Permit Revision In Progress",
  "Permit Revision Completed": "Permit Revision Completed",
  "Revision Needed - Rejected by Utility": "Revision Needed - Rejected by Utility",
  "Utility Revision In Progress": "Utility Revision In Progress",
  "Utility Revision Completed": "Utility Revision Completed",
  "Revision Needed - Rejected": "Revision Needed - As-Built",
  "As-Built Revision In Progress": "As-Built Revision In Progress",
  "As-Built Revision Completed": "As-Built Revision Completed",
  "Needs Clarification": "Needs Clarification",
  "Needs Clarification from Customer": "Needs Clarification from Customer",
  "Needs Clarification from Sales": "Needs Clarification from Sales",
  "Needs Clarification from Operations": "Needs Clarification from Operations",
  "Pending Resurvey": "Pending Resurvey",
  "On Hold": "On Hold",
  "No Design Needed": "No Design Needed",
  "New Construction - Design Needed": "New Construction - Design Needed",
  "New Construction - In Progress": "New Construction - In Progress",
  "New Construction - Ready for Review": "New Construction - Ready for Review",
  "New Construction - Design Completed": "New Construction - Design Completed",
  "Xcel - Design Needed": "Xcel - Design Needed",
  "Xcel - In Progress": "Xcel - In Progress",
  "Xcel - Site Plan & SLD Completed": "Xcel - Site Plan & SLD Completed",
  "In Revision": "(Archived) Revision In Progress",
  "Revision Complete": "(Archived) Revision Complete",
  "Revision Initial Review": "(Archived) Revision Initial Review",
  "Revision Final Review": "(Archived) Revision Final Review/Stamping",
  "Revision In Engineering": "(Archived) Revision In Engineering",
  "IDR Revision Needed": "IDR Revision Needed",
  "IDR Revision in Progress": "IDR Revision in Progress",
  "IDR Revision Complete": "IDR Revision Complete",
};

const PERMITTING_STATUS: StatusMap = {
  "Awaiting Utility Approval": "Awaiting Utility Approval",
  "Ready For Permitting": "Ready For Permitting",
  "Submitted To Customer": "Submitted To Customer",
  "Customer Signature Acquired": "Customer Signature Acquired",
  "Waiting On Information": "Waiting On Information",
  "Submitted to AHJ": "Submitted to AHJ",
  "Non-Design Related Rejection": "Non-Design Related Rejection",
  Rejected: "Permit Rejected - Needs Revision",
  "In Design For Revision": "Design Revision In Progress",
  "Returned from Design": "Revision Ready To Resubmit",
  "Resubmitted to AHJ": "Resubmitted to AHJ",
  Complete: "Permit Issued",
  "Permit Issued Pending Payment": "Permit Issued; Pending Documents",
  "Pending SolarApp": "Ready to Submit for SolarApp",
  "Not Needed": "Not Needed",
  "Submit SolarApp to AHJ": "Submit SolarApp to AHJ",
  "As-Built Revision Needed": "As-Built Revision Needed",
  "As-Built Revision In Progress": "As-Built Revision In Progress",
  "As-Built Ready To Resubmit": "As-Built Ready To Resubmit",
  "As-Built Revision Resubmitted": "As-Built Revision Resubmitted",
};

const CONSTRUCTION_STATUS: StatusMap = {
  Rejected: "Rejected",
  Blocked: "Blocked",
  "Ready to Build": "Ready to Build",
  Scheduled: "Scheduled",
  "On Our Way": "On Our Way",
  Started: "Started",
  "In Progress": "In Progress",
  "Return Scheduled": "Return Scheduled",
  "Loose Ends Remaining": "Loose Ends Remaining",
  "Construction Complete": "Construction Complete",
  "Revisions Needed": "Revisions Needed",
  "In Design For Revisions": "In Design For Revisions",
  "Revisions Complete": "Revisions Complete",
  "Pending New Construction Design Review": "Pending New Construction Design Review",
};

const FINAL_INSPECTION_STATUS: StatusMap = {
  "Ready For Inspection": "Ready For Inspection",
  Scheduled: "Scheduled",
  "On Our Way": "On Our Way",
  Started: "Started",
  "In Progress": "In Progress",
  Failed: "Failed",
  Rejected: "Rejected",
  "Waiting on Revisions": "Waiting on Permit Revisions",
  "Revisions Complete": "Revisions Complete",
  Passed: "Passed",
  "Partial Pass": "Partial Pass",
  "Not Needed": "Not Needed",
  "Pending New Construction Sign Off": "Pending New Construction Sign Off",
  "Pending Fire Inspection": "Pending Fire Inspection",
  "Fire Inspection Scheduled": "Fire Inspection Scheduled",
  "Pending BUS Install": "Pending BUS Install",
  "Pending New Construction": "Pending New Construction",
  "Pending Site Corrections": "Pending Site Corrections",
};

const PTO_STATUS: StatusMap = {
  "PTO Waiting on Interconnection Approval": "PTO Waiting on Interconnection Approval",
  "Inspection Passed - Ready for Utility": "Inspection Passed - Ready for PTO Submission",
  "Inspection Submitted to Utility": "Inspection Submitted to Utility",
  "Inspection Rejected By Utility": "Inspection Rejected By Utility",
  "Ops Related PTO Rejection": "Ops Related PTO Rejection",
  "Ready to Resubmit": "Ready to Resubmit",
  "Waiting On Information": "Waiting On Information",
  "Waiting on New Construction": "Waiting on New Construction",
  "Resubmitted to Utility": "PTO Revision Resubmitted",
  PTO: "PTO Granted",
  "Not Needed": "Not Needed",
  "Xcel Photos Ready to Submit": "Xcel Photos Ready to Submit",
  "Xcel Photos Submitted": "Xcel Photos Submitted",
  "XCEL Photos Rejected": "XCEL Photos Rejected",
  "Xcel Photos Ready to Resubmit": "Xcel Photos Ready to Resubmit",
  "Xcel Photos Resubmitted": "Xcel Photos Resubmitted",
  "Xcel Photos Approved": "Xcel Photos Approved",
  "Conditional PTO - Pending Transformer Upgrade": "Conditional PTO - Pending Transformer Upgrade",
  "Pending Truck Roll": "Pending Truck Roll",
};

const STATUS_MAPS: Record<string, StatusMap> = {
  site_survey_status: SITE_SURVEY_STATUS,
  layout_status: LAYOUT_STATUS,
  design_status: DESIGN_STATUS,
  permitting_status: PERMITTING_STATUS,
  install_status: CONSTRUCTION_STATUS,
  final_inspection_status: FINAL_INSPECTION_STATUS,
  pto_status: PTO_STATUS,
};

/**
 * Resolve a raw HubSpot status option value to its display label.
 * Falls back to the raw value when the property or value is unknown.
 */
export function statusLabel(
  property: keyof typeof STATUS_MAPS | string,
  value: string | null | undefined
): string | null {
  if (value == null || value === "") return null;
  const map = STATUS_MAPS[property];
  return map?.[value] ?? value;
}
