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
  designCompletionDate: string | null;
  designApprovalDate: string | null;
  permitSubmitDate: string | null;
  permitIssueDate: string | null;
  interconnectionSubmitDate: string | null;
  interconnectionApprovalDate: string | null;
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
    designCompletionDate: p.designCompletionDate,
    designApprovalDate: p.designApprovalDate,
    permitSubmitDate: p.permitSubmitDate,
    permitIssueDate: p.permitIssueDate,
    interconnectionSubmitDate: p.interconnectionSubmitDate,
    interconnectionApprovalDate: p.interconnectionApprovalDate,
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
