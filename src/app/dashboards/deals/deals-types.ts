import type { Project } from "@/lib/hubspot";

// --- Unified deal type for the table ---

/** Slim deal shape from /api/deals (non-project pipelines) */
export interface SlimDeal {
  id: number;
  name: string;
  amount: number;
  stage: string;
  stageId: string;
  pipeline: string;
  pbLocation: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  projectType: string;
  closeDate: string | null;
  createDate: string | null;
  lastModified: string | null;
  url: string;
  isActive: boolean;
  daysSinceCreate: number;
}

/** Fields available only on project pipeline deals */
export interface ProjectFields {
  siteSurveyStatus: string | null;
  designStatus: string | null;
  layoutStatus: string | null;
  permittingStatus: string | null;
  interconnectionStatus: string | null;
  constructionStatus: string | null;
  finalInspectionStatus: string | null;
  ptoStatus: string | null;
  dealOwner: string;
  daysSinceStageMovement: number;
  // Milestone dates
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  designDraftDate: string | null;
  designApprovalSentDate: string | null;
  designCompletionDate: string | null;
  designApprovalDate: string | null;
  permitSubmitDate: string | null;
  permitIssueDate: string | null;
  interconnectionSubmitDate: string | null;
  interconnectionApprovalDate: string | null;
  readyToBuildDate: string | null;
  constructionScheduleDate: string | null;
  constructionCompleteDate: string | null;
  inspectionScheduleDate: string | null;
  inspectionPassDate: string | null;
  ptoSubmitDate: string | null;
  ptoGrantedDate: string | null;
}

/** Table row: either a full project or a slim deal */
export type TableDeal = SlimDeal & Partial<ProjectFields>;

/** Convert a Project to a TableDeal */
export function projectToTableDeal(p: Project): TableDeal {
  return {
    id: p.id,
    name: p.name,
    amount: p.amount,
    stage: p.stage,
    stageId: p.stageId,
    pipeline: "project",
    pbLocation: p.pbLocation,
    address: p.address,
    city: p.city,
    state: p.state,
    postalCode: p.postalCode,
    projectType: p.projectType,
    closeDate: p.closeDate,
    createDate: null, // Project type tracks closeDate, not createDate
    lastModified: null,
    url: p.url,
    isActive: p.isActive,
    daysSinceCreate: 0, // Not available on Project type (use daysSinceClose for project context)
    // Project-only fields
    siteSurveyStatus: p.siteSurveyStatus,
    designStatus: p.designStatus,
    layoutStatus: p.layoutStatus,
    permittingStatus: p.permittingStatus,
    interconnectionStatus: p.interconnectionStatus,
    constructionStatus: p.constructionStatus,
    finalInspectionStatus: p.finalInspectionStatus,
    ptoStatus: p.ptoStatus,
    dealOwner: p.dealOwner,
    daysSinceStageMovement: p.daysSinceStageMovement,
    siteSurveyScheduleDate: p.siteSurveyScheduleDate,
    siteSurveyCompletionDate: p.siteSurveyCompletionDate,
    designDraftDate: p.designDraftDate,
    designApprovalSentDate: p.designApprovalSentDate,
    designCompletionDate: p.designCompletionDate,
    designApprovalDate: p.designApprovalDate,
    permitSubmitDate: p.permitSubmitDate,
    permitIssueDate: p.permitIssueDate,
    interconnectionSubmitDate: p.interconnectionSubmitDate,
    interconnectionApprovalDate: p.interconnectionApprovalDate,
    readyToBuildDate: p.readyToBuildDate,
    constructionScheduleDate: p.constructionScheduleDate,
    constructionCompleteDate: p.constructionCompleteDate,
    inspectionScheduleDate: p.inspectionScheduleDate,
    inspectionPassDate: p.inspectionPassDate,
    ptoSubmitDate: p.ptoSubmitDate,
    ptoGrantedDate: p.ptoGrantedDate,
  };
}

// --- Status column config ---

export interface StatusColumn {
  key: keyof ProjectFields;
  abbrev: string;
  fullName: string;
}

export const STATUS_COLUMNS: StatusColumn[] = [
  { key: "siteSurveyStatus", abbrev: "SS", fullName: "Site Survey" },
  { key: "designStatus", abbrev: "Dsgn", fullName: "Design" },
  { key: "layoutStatus", abbrev: "DA", fullName: "Design Approval" },
  { key: "permittingStatus", abbrev: "Perm", fullName: "Permitting" },
  { key: "interconnectionStatus", abbrev: "IC", fullName: "Interconnection" },
  { key: "constructionStatus", abbrev: "Const", fullName: "Construction" },
  { key: "finalInspectionStatus", abbrev: "Insp", fullName: "Final Inspection" },
  { key: "ptoStatus", abbrev: "PTO", fullName: "Permission to Operate" },
];

// --- Status dot color mapping ---

/** General color categories for status values */
export type StatusColor = "green" | "blue" | "yellow" | "red" | "gray";

export const STATUS_COLOR_HEX: Record<StatusColor, string> = {
  green: "#4ade80",
  blue: "#38bdf8",
  yellow: "#facc15",
  red: "#f87171",
  gray: "#555",
};

/**
 * Map known status string values to colors.
 * During implementation, inspect real HubSpot data to refine this mapping.
 * Unknown values default to yellow (needs review) to surface them for mapping.
 */
export function getStatusColor(value: string | null | undefined): StatusColor {
  if (!value || value === "" || value === "Not Started") return "gray";

  const lower = value.toLowerCase();

  // Green — complete/approved/passed/done
  if (
    lower.includes("complete") ||
    lower.includes("approved") ||
    lower.includes("passed") ||
    lower.includes("done") ||
    lower.includes("issued") ||
    lower.includes("granted") ||
    lower === "yes"
  ) return "green";

  // Blue — in progress/submitted/scheduled/active
  if (
    lower.includes("in progress") ||
    lower.includes("submitted") ||
    lower.includes("scheduled") ||
    lower.includes("active") ||
    lower.includes("in review") ||
    lower.includes("started")
  ) return "blue";

  // Red — issue/failed/rejected/blocked/denied
  if (
    lower.includes("issue") ||
    lower.includes("failed") ||
    lower.includes("rejected") ||
    lower.includes("blocked") ||
    lower.includes("denied") ||
    lower.includes("revision") ||
    lower.includes("hold")
  ) return "red";

  // Yellow — pending/waiting/needs review (default for unknown)
  return "yellow";
}

/**
 * HubSpot status value → display label mappings, keyed by field name.
 * Sourced from HubSpot property definitions (enum options).
 */
const STATUS_DISPLAY_LABELS: Record<string, Record<string, string>> = {
  siteSurveyStatus: {
    "Ready to Schedule": "Ready to Schedule",
    "Awaiting Reply": "Awaiting Reply",
    "Scheduled": "Scheduled",
    "On Our Way": "On Our Way",
    "Started": "Started",
    "In Progress": "In Progress",
    "Needs Revisit": "Needs Revisit",
    "Completed": "Completed",
    "Scheduling On-Hold": "Scheduling On-Hold",
    "No Site Survey Needed": "No Site Survey Needed",
    "Pending Loan Approval": "Pending Loan Approval",
    "Waiting on Change Order": "Waiting on Change Order",
  },
  designStatus: {
    "Ready for Design": "Ready for Design",
    "In Progress": "In Progress",
    "Initial Review": "Initial Design Review",
    "Ready for Review": "Final Review/Stamping",
    "Draft Complete": "Draft Complete - Waiting on Approvals",
    "DA Approved": "Final Design Review",
    "Submitted To Engineering": "Submitted To Engineering",
    "Complete": "Design Complete",
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
    "In Revision": "Revision In Progress",
    "Revision Complete": "Revision Complete",
    "Revision Initial Review": "Revision Initial Review",
    "Revision Final Review": "Revision Final Review/Stamping",
    "Revision In Engineering": "Revision In Engineering",
  },
  layoutStatus: {
    "Ready": "Review In Progress",
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
  },
  permittingStatus: {
    "Awaiting Utility Approval": "Awaiting Utility Approval",
    "Ready For Permitting": "Ready For Permitting",
    "Submitted To Customer": "Submitted To Customer",
    "Customer Signature Acquired": "Customer Signature Acquired",
    "Waiting On Information": "Waiting On Information",
    "Submitted to AHJ": "Submitted to AHJ",
    "Non-Design Related Rejection": "Non-Design Related Rejection",
    "Rejected": "Permit Rejected - Needs Revision",
    "In Design For Revision": "Design Revision In Progress",
    "Returned from Design": "Revision Ready To Resubmit",
    "Resubmitted to AHJ": "Resubmitted to AHJ",
    "Complete": "Permit Issued",
    "Permit Issued Pending Payment": "Permit Issued; Pending Documents",
    "Pending SolarApp": "Ready to Submit for SolarApp",
    "Not Needed": "Not Needed",
    "Submit SolarApp to AHJ": "Submit SolarApp to AHJ",
    "As-Built Revision Needed": "As-Built Revision Needed",
    "As-Built Revision In Progress": "As-Built Revision In Progress",
    "As-Built Ready To Resubmit": "As-Built Ready To Resubmit",
    "As-Built Revision Resubmitted": "As-Built Revision Resubmitted",
  },
  interconnectionStatus: {
    "Ready for Interconnection": "Ready for Interconnection",
    "Submitted To Customer": "Submitted To Customer",
    "Ready To Submit - Pending Design": "Ready To Submit - Pending Design",
    "Signature Acquired By Customer": "Ready To Submit",
    "Submitted To Utility": "Submitted To Utility",
    "Waiting On Information": "Waiting On Information",
    "Waiting on Utility Bill": "Waiting on Utility Bill",
    "Waiting on New Construction": "Waiting on New Construction",
    "In Review": "In Review",
    "Non-Design Related Rejection": "Non-Design Related Rejection",
    "Rejected (New)": "Rejected",
    "Rejected": "Rejected - Revisions Needed",
    "In Design For Revisions": "Design Revision In Progress",
    "Revision Returned From Design": "Revision Ready To Resubmit",
    "Resubmitted To Utility": "Resubmitted To Utility",
    "Application Approved": "Application Approved",
    "Application Approved - Pending Signatures": "Application Approved - Pending Signatures",
    "Transformer Upgrade": "Transformer Upgrade",
    "Supplemental Review": "Supplemental Review",
    "RBC On Hold": "RBC On Hold",
    "Not Needed": "Not Needed",
    "Conditional Application Approval": "Conditional Application Approval",
    "As-Built Ready to Resubmit": "As-Built Ready to Resubmit",
    "As-Built Resubmitted": "As-Built Resubmitted",
  },
  constructionStatus: {
    "Rejected": "Rejected",
    "Blocked": "Blocked",
    "Ready to Build": "Ready to Build",
    "Scheduled": "Scheduled",
    "On Our Way": "On Our Way",
    "Started": "Started",
    "In Progress": "In Progress",
    "Loose Ends Remaining": "Loose Ends Remaining",
    "Construction Complete": "Construction Complete",
    "Revisions Needed": "Revisions Needed",
    "In Design For Revisions": "In Design For Revisions",
    "Revisions Complete": "Revisions Complete",
    "Pending New Construction Design Review": "Pending New Construction Design Review",
  },
  finalInspectionStatus: {
    "Ready For Inspection": "Ready For Inspection",
    "Scheduled": "Scheduled",
    "On Our Way": "On Our Way",
    "Started": "Started",
    "In Progress": "In Progress",
    "Failed": "Failed",
    "Rejected": "Rejected",
    "Waiting on Revisions": "Waiting on Permit Revisions",
    "Revisions Complete": "Revisions Complete",
    "Passed": "Passed",
    "Partial Pass": "Partial Pass",
    "Not Needed": "Not Needed",
    "Pending New Construction Sign Off": "Pending New Construction Sign Off",
    "Pending Fire Inspection": "Pending Fire Inspection",
    "Pending BUS Install": "Pending BUS Install",
    "Pending New Construction": "Pending New Construction",
  },
  ptoStatus: {
    "PTO Waiting on Interconnection Approval": "PTO Waiting on IC Approval",
    "Inspection Passed - Ready for Utility": "Ready for PTO Submission",
    "Inspection Submitted to Utility": "Submitted to Utility",
    "Inspection Rejected By Utility": "Rejected By Utility",
    "Ops Related PTO Rejection": "Ops Related PTO Rejection",
    "Waiting On Information": "Waiting On Information",
    "Waiting on New Construction": "Waiting on New Construction",
    "Resubmitted to Utility": "PTO Revision Resubmitted",
    "PTO": "PTO Granted",
    "Not Needed": "Not Needed",
    "Xcel Photos Ready to Submit": "Xcel Photos Ready to Submit",
    "Xcel Photos Submitted": "Xcel Photos Submitted",
    "XCEL Photos Rejected": "XCEL Photos Rejected",
    "Xcel Photos Ready to Resubmit": "Xcel Photos Ready to Resubmit",
    "Xcel Photos Resubmitted": "Xcel Photos Resubmitted",
    "Xcel Photos Approved": "Xcel Photos Approved",
    "Conditional PTO - Pending Transformer Upgrade": "Conditional PTO - Pending Transformer Upgrade",
    "Pending Truck Roll": "Pending Truck Roll",
  },
};

/** Look up the HubSpot display label for a status value, with field context */
export function formatStatusValue(value: string | null | undefined, field?: string): string {
  if (!value || value === "") return "Not Started";
  if (field && STATUS_DISPLAY_LABELS[field]) {
    return STATUS_DISPLAY_LABELS[field][value] ?? value;
  }
  return value;
}

// --- Pipeline config for the page ---

export const PIPELINE_OPTIONS = [
  { value: "project", label: "Project Pipeline" },
  { value: "sales", label: "Sales" },
  { value: "dnr", label: "D&R" },
  { value: "service", label: "Service" },
  { value: "roofing", label: "Roofing" },
] as const;

export function isProjectPipeline(pipeline: string): boolean {
  return pipeline === "project";
}
