/**
 * Section registry — data-driven config mapping pipelines to UI sections.
 * Each section defines which fields to render from a SerializedDeal.
 * Adding a new section = adding an entry here. No component changes needed.
 */

import type { SerializedDeal, FieldDef, SectionConfig } from "./types";
import { STAGE_COLORS } from "@/lib/constants";

// --- Helper: shorthand field builder ---

function f(label: string, key: string, format?: FieldDef["format"]): FieldDef & { _key: string } {
  return { label, value: null, format, _key: key } as FieldDef & { _key: string };
}

function resolveFields(
  defs: ReturnType<typeof f>[],
  deal: SerializedDeal,
): FieldDef[] {
  return defs.map(({ label, format, _key }) => ({
    label,
    value: (deal[_key] as FieldDef["value"]) ?? null,
    format,
  }));
}

// --- Section Registry ---

export const SECTION_REGISTRY: SectionConfig[] = [
  {
    key: "project-details",
    title: "Project Details",
    defaultOpen: true,
    pipelines: "all",
    fields: (deal) =>
      resolveFields(
        [
          f("Address", "address"),
          f("City", "city"),
          f("State", "state"),
          f("Zip Code", "zipCode"),
          f("AHJ", "ahj"),
          f("Utility", "utility"),
          f("Location", "pbLocation"),
          f("Amount", "amount", "money"),
          f("Close Date", "closeDate", "date"),
          f("Project Type", "projectType"),
          f("Project Number", "projectNumber"),
          f("System Size (DC)", "systemSizeKwdc", "decimal"),
          f("System Size (AC)", "systemSizeKwac", "decimal"),
        ],
        deal,
      ),
  },
  {
    key: "milestone-dates",
    title: "Milestone Dates",
    defaultOpen: true,
    pipelines: "all",
    fields: (deal) =>
      resolveFields(
        [
          f("Survey Scheduled", "siteSurveyScheduleDate", "date"),
          f("Survey Scheduled Date", "siteSurveyScheduledDate", "date"),
          f("Survey Completed", "siteSurveyCompletionDate", "date"),
          f("Returned From Designers", "dateReturnedFromDesigners", "date"),
          f("Design Start", "designStartDate", "date"),
          f("Design Draft Completed", "designDraftCompletionDate", "date"),
          f("Design Completed", "designCompletionDate", "date"),
          f("Design Approval Sent", "designApprovalSentDate", "date"),
          f("Layout Approved", "layoutApprovalDate", "date"),
          f("Permit Submitted", "permitSubmitDate", "date"),
          f("Permit Issued", "permitIssueDate", "date"),
          f("IC Submitted", "icSubmitDate", "date"),
          f("IC Approved", "icApprovalDate", "date"),
          f("RTB Date", "rtbDate", "date"),
          f("Install Scheduled", "installScheduleDate", "date"),
          f("Construction Complete", "constructionCompleteDate", "date"),
          f("Inspection Scheduled", "inspectionScheduleDate", "date"),
          f("Inspection Booked", "inspectionBookedDate", "date"),
          f("Inspection Passed", "inspectionPassDate", "date"),
          f("Inspection Failed", "inspectionFailDate", "date"),
          f("Close Date", "closeDate", "date"),
          f("PTO Started", "ptoStartDate", "date"),
          f("PTO Completed", "ptoCompletionDate", "date"),
          f("Forecasted Install", "forecastedInstallDate", "date"),
          f("Forecasted Inspection", "forecastedInspectionDate", "date"),
          f("Forecasted PTO", "forecastedPtoDate", "date"),
          f("Created", "createDate", "date"),
        ],
        deal,
      ),
  },
  {
    key: "status-details",
    title: "Status Details",
    defaultOpen: true,
    pipelines: ["PROJECT"],
    fields: (deal) =>
      resolveFields(
        [
          f("Survey Status", "surveyStatus", "status"),
          f("Design Status", "designStatus", "status"),
          f("Layout Status", "layoutStatus", "status"),
          f("Permitting Status", "permittingStatus", "status"),
          f("IC Status", "icStatus", "status"),
          f("Install Status", "installStatus", "status"),
          f("Final Inspection", "finalInspectionStatus", "status"),
          f("PTO Status", "ptoStatus", "status"),
          f("Ready for Inspection", "readyForInspection"),
          f("Inspection Fail Count", "inspectionFailCount"),
          f("Inspection Failure Reason", "inspectionFailureReason"),
          f("Participate Energy Status", "participateEnergyStatus", "status"),
        ],
        deal,
      ),
  },
  {
    key: "install-planning",
    title: "Install Planning",
    defaultOpen: false,
    pipelines: ["PROJECT"],
    fields: (deal) =>
      resolveFields(
        [
          f("Install Crew", "installCrew"),
          f("Difficulty", "installDifficulty"),
          f("Expected Days", "expectedDaysForInstall"),
          f("Days for Installers", "daysForInstallers"),
          f("Days for Electricians", "daysForElectricians"),
          f("Expected Installers", "expectedInstallerCount"),
          f("Expected Electricians", "expectedElectricianCount"),
          f("Install Notes", "installNotes"),
        ],
        deal,
      ),
  },
  {
    key: "service-details",
    title: "Service Details",
    defaultOpen: true,
    pipelines: ["SERVICE"],
    fields: (deal) =>
      resolveFields(
        [
          f("Service Type", "serviceType"),
          f("Visit Status", "serviceVisitStatus", "status"),
          f("Visit Complete Date", "serviceVisitCompleteDate", "date"),
          f("Revisit Status", "serviceRevisitStatus", "status"),
          f("Issue Resolved", "serviceIssueResolved"),
          f("Account Number", "serviceAccountNumber"),
          f("Agreement ID", "serviceAgreementId"),
          f("Rate Equivalent", "serviceRateEquivalent"),
          f("Service Notes", "serviceNotes"),
        ],
        deal,
      ),
  },
  {
    key: "roofing-details",
    title: "Roofing Details",
    defaultOpen: true,
    pipelines: ["DNR", "ROOFING"],
    fields: (deal) =>
      resolveFields(
        [
          f("Roof Type", "roofType"),
          f("Roof Age", "roofAge"),
          f("Current Material", "currentRoofingMaterial"),
          f("Desired Material", "desiredRoofingMaterial"),
          f("Color Selection", "roofColorSelection"),
          f("Project Type", "roofingProjectType"),
          f("Roof Slope", "roofSlope"),
          f("Roofing Notes", "roofingNotes"),
        ],
        deal,
      ),
  },
];

// --- Field label lookup (for sync changelog display) ---

/**
 * Maps deal column names (camelCase) to human-readable labels.
 * Built by extracting the (key, label) pairs from all section field definitions.
 */
export const FIELD_LABELS: Record<string, string> = buildFieldLabels();

function buildFieldLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  // Use a Proxy-based SerializedDeal that records which keys are accessed
  // by the field functions, paired with the labels from the returned FieldDefs.
  for (const section of SECTION_REGISTRY) {
    const accessed: string[] = [];
    const proxy = new Proxy({} as SerializedDeal, {
      get(_target, prop: string) {
        accessed.push(prop);
        return null;
      },
    });
    const defs = section.fields(proxy);
    // accessed[] and defs[] are parallel arrays (same order)
    for (let i = 0; i < defs.length; i++) {
      if (accessed[i]) {
        labels[accessed[i]] = defs[i].label;
      }
    }
  }
  return labels;
}

// --- Pipeline filtering ---

export function getSectionsForPipeline(pipeline: string): SectionConfig[] {
  return SECTION_REGISTRY.filter(
    (s) => s.pipelines === "all" || s.pipelines.includes(pipeline),
  );
}

// --- Stage colors ---

/** Position-based color ramp for non-project pipelines */
const POSITION_PALETTE = [
  "#3B82F6", // blue-500
  "#6366F1", // indigo-500
  "#8B5CF6", // violet-500
  "#A855F7", // purple-500
  "#F97316", // orange-500
  "#F59E0B", // amber-500
  "#EAB308", // yellow-500
];

export function getStageColor(
  pipeline: string,
  stage: string,
  stageOrder: string[],
): string {
  // Project pipeline: use known STAGE_COLORS
  if (pipeline === "PROJECT") {
    const entry = STAGE_COLORS[stage];
    return entry?.hex ?? "#71717A";
  }

  // Terminal stage detection
  const lower = stage.toLowerCase();
  if (lower.includes("closed won") || lower.includes("complete")) return "#22C55E";
  if (lower.includes("closed lost") || lower.includes("cancelled")) return "#71717A";

  // Position-based color ramp
  const idx = stageOrder.indexOf(stage);
  if (idx < 0) return "#71717A";
  const paletteIdx = Math.round((idx / Math.max(stageOrder.length - 1, 1)) * (POSITION_PALETTE.length - 1));
  return POSITION_PALETTE[paletteIdx] ?? "#71717A";
}
