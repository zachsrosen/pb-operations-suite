/**
 * deal-reader.ts
 *
 * Converts Prisma `Deal` rows into the three downstream types that existing
 * API routes return. Zero-change cutover: when the feature flag flips the API
 * response shape is identical to the HubSpot-sourced path.
 */

import type { Deal as PrismaDeal } from "@/generated/prisma/client";
import type { Project, Equipment } from "@/lib/hubspot";
import { ACTIVE_STAGES, computeDaysInStage, STAGE_PRIORITY, SCHEDULABLE_STAGES } from "@/lib/hubspot";
import { ACTIVE_STAGES as PIPELINE_ACTIVE_STAGES } from "@/lib/deals-pipeline";
import type { TransformedProject, Deal as DealType } from "@/lib/types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Maps DealPipeline enum → deals-pipeline.ts key for active-stage lookups */
const PIPELINE_KEY: Record<string, string> = {
  SALES: "sales",
  PROJECT: "project",
  DNR: "dnr",
  SERVICE: "service",
  ROOFING: "roofing",
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value) || 0;
}

function decimalToNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateToIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function dateToDateString(value: Date | null | undefined): string | null {
  if (!value) return null;
  // Return YYYY-MM-DD portion (UTC) to match the HubSpot parseDate behavior
  return value.toISOString().split("T")[0];
}

function daysBetween(date1: Date, date2: Date): number {
  const diffTime = date2.getTime() - date1.getTime();
  return Math.round(diffTime / MS_PER_DAY);
}

function parseTags(tagsValue: string | null | undefined): string[] {
  if (!tagsValue) return [];
  return tagsValue.split(";").map((t) => t.trim()).filter(Boolean);
}


function calculatePriorityScore(
  stage: string,
  daysSinceClose: number,
  isPE: boolean,
  isRTB: boolean,
  isBlocked: boolean
): number {
  let score = 0;
  score += Math.min(daysSinceClose * 0.5, 500);
  const stagePriority = STAGE_PRIORITY[stage] || 0;
  if (stagePriority > 0) {
    score += stagePriority * 50;
  }
  if (isPE) score += 200;
  if (isRTB) score += 150;
  if (isBlocked) score -= 100;
  return Math.round(score * 10) / 10;
}

// Parse departmentLeads JSON into named lead fields
interface DepartmentLeadsJson {
  design?: string;
  permit_tech?: string;
  interconnections_tech?: string;
  rtb_lead?: string;
}

function parseDepartmentLeads(value: unknown): DepartmentLeadsJson {
  if (!value) return {};
  if (typeof value === "object") return value as DepartmentLeadsJson;
  try {
    return JSON.parse(String(value)) as DepartmentLeadsJson;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// dealToProject
// ---------------------------------------------------------------------------

/**
 * Converts a Prisma Deal row to the Project type used by /api/projects.
 */
export function dealToProject(deal: PrismaDeal): Project {
  const now = new Date();
  const stage = deal.stage;

  const tags = parseTags(deal.tags);
  const isPE = tags.includes("Participate Energy");
  const isRTB = stage === "Ready To Build";
  const isBlocked = stage === "RTB - Blocked" || stage === "On Hold";
  const isSchedulable = SCHEDULABLE_STAGES.includes(stage);
  const isActive = ACTIVE_STAGES.includes(stage);

  const daysSinceClose = deal.closeDate
    ? Math.max(0, daysBetween(deal.closeDate, now))
    : 0;

  // Forecast dates — prefer explicit forecasted date, fall back to scheduled date
  const forecastInstall =
    deal.forecastedInstallDate ?? deal.installScheduleDate ?? null;
  const forecastInspection =
    deal.forecastedInspectionDate ?? deal.inspectionScheduleDate ?? null;
  const forecastPto = deal.forecastedPtoDate ?? null;

  const daysToInstall = forecastInstall
    ? daysBetween(now, forecastInstall)
    : null;
  const daysToInspection = forecastInspection
    ? daysBetween(now, forecastInspection)
    : null;
  const daysToPto = forecastPto ? daysBetween(now, forecastPto) : null;

  const priorityScore = calculatePriorityScore(
    stage,
    daysSinceClose,
    isPE,
    isRTB,
    isBlocked
  );

  const leads = parseDepartmentLeads(deal.departmentLeads);

  // Build Equipment shape from deal columns
  const equipment: Equipment = {
    modules: {
      brand: deal.moduleBrand ?? "",
      model: deal.moduleModel ?? "",
      count: deal.moduleCount ?? 0,
      wattage: deal.moduleWattage ?? 0,
      productName: deal.moduleName ?? "",
    },
    inverter: {
      brand: deal.inverterBrand ?? "",
      model: deal.inverterModel ?? "",
      count: deal.inverterQty ?? 0,
      sizeKwac: decimalToNumber(deal.inverterSizeKwac),
      productName: deal.inverterName ?? "",
    },
    battery: {
      brand: deal.batteryBrand ?? "",
      model: deal.batteryModel ?? "",
      count: deal.batteryCount ?? 0,
      sizeKwh: decimalToNumber(deal.batterySizeKwh),
      expansionCount: deal.batteryExpansionCount ?? 0,
      productName: deal.batteryName ?? "",
      expansionProductName: deal.batteryExpansionName ?? "",
      expansionModel: deal.batteryExpansionModel ?? "",
    },
    evCount: deal.evCount ?? 0,
    systemSizeKwdc: decimalToNumber(deal.systemSizeKwdc),
    systemSizeKwac: decimalToNumber(deal.systemSizeKwac),
  };

  // Three-way fallback for design folder URL
  const designFolderUrl =
    deal.designDocumentsUrl ||
    deal.designFolderUrl ||
    deal.allDocumentFolderUrl ||
    null;

  const daysSinceStageMovement = computeDaysInStage(
    deal.dateEnteredCurrentStage,
    now
  );

  return {
    id: Number(deal.hubspotDealId),
    name: deal.dealName,
    projectNumber: deal.projectNumber ?? "",

    // Location & Admin
    pbLocation: deal.pbLocation ?? "Unknown",
    ahj: deal.ahj ?? "Unknown",
    utility: deal.utility ?? "Unknown",
    address: deal.address ?? "",
    city: deal.city ?? "",
    state: deal.state ?? "",
    postalCode: deal.zipCode ?? "",

    // Project details
    projectType: deal.projectType ?? "Unknown",
    stage,
    stageId: deal.stageId,
    amount: decimalToNumber(deal.amount),
    url: deal.hubspotUrl ?? "",

    // Tags
    tags,
    isParticipateEnergy: isPE,
    participateEnergyStatus: deal.participateEnergyStatus ?? null,

    // Preconstruction milestone booleans
    isSiteSurveyScheduled: deal.isSiteSurveyScheduled,
    isSiteSurveyCompleted: deal.isSiteSurveyCompleted,
    isDASent: deal.isDaSent,
    isDesignApproved: deal.isLayoutApproved,
    isDesignDrafted: deal.isDesignDrafted,
    isDesignCompleted: deal.isDesignCompleted,
    isPermitSubmitted: deal.isPermitSubmitted,
    isPermitIssued: deal.isPermitIssued,
    isInterconnectionSubmitted: deal.isIcSubmitted,
    isInterconnectionApproved: deal.isIcApproved,

    // Incentive Programs
    threeceEvStatus: deal.n3ceEvStatus ?? null,
    threeceBatteryStatus: deal.n3ceBatteryStatus ?? null,
    sgipStatus: deal.sgipStatus ?? null,
    pbsrStatus: deal.pbsrStatus ?? null,
    cpaStatus: deal.cpaStatus ?? null,

    // Key dates
    closeDate: dateToDateString(deal.closeDate),

    // Site Survey
    siteSurveyScheduleDate:
      dateToDateString(deal.siteSurveyScheduleDate) ??
      dateToDateString(deal.siteSurveyScheduledDate),
    siteSurveyCompletionDate: dateToDateString(deal.siteSurveyCompletionDate),
    siteSurveyStatus: deal.surveyStatus ?? null,

    // Design
    designCompletionDate: dateToDateString(deal.designCompletionDate),
    designApprovalDate: dateToDateString(deal.layoutApprovalDate),
    designDraftDate: dateToDateString(deal.designDraftCompletionDate),
    designApprovalSentDate: dateToDateString(deal.designApprovalSentDate),
    designStartDate: dateToDateString(deal.designStartDate),
    dateReturnedFromDesigners: dateToDateString(deal.dateReturnedFromDesigners),
    daRevisionCounter: deal.daRevisionCount ?? null,
    asBuiltRevisionCounter: deal.asBuiltRevisionCount ?? null,
    permitRevisionCounter: deal.permitRevisionCount ?? null,
    interconnectionRevisionCounter: deal.icRevisionCount ?? null,
    totalRevisionCount: deal.totalRevisionCount ?? null,
    designStatus: deal.designStatus ?? null,
    layoutStatus: deal.layoutStatus ?? null,

    // Permitting
    permitSubmitDate: dateToDateString(deal.permitSubmitDate),
    permitIssueDate: dateToDateString(deal.permitIssueDate),
    permittingStatus: deal.permittingStatus ?? null,

    // Interconnection
    interconnectionSubmitDate: dateToDateString(deal.icSubmitDate),
    interconnectionApprovalDate: dateToDateString(deal.icApprovalDate),
    interconnectionStatus: deal.icStatus ?? null,

    // Construction
    readyToBuildDate: dateToDateString(deal.rtbDate),
    constructionScheduleDate: dateToDateString(deal.installScheduleDate),
    constructionCompleteDate: dateToDateString(deal.constructionCompleteDate),
    constructionStatus: deal.installStatus ?? null,

    // Inspection
    inspectionScheduleDate: dateToDateString(deal.inspectionScheduleDate),
    inspectionPassDate: dateToDateString(deal.inspectionPassDate),
    finalInspectionStatus: deal.finalInspectionStatus ?? null,
    inspectionFailDate: dateToDateString(deal.inspectionFailDate),
    inspectionBookedDate: dateToDateString(deal.inspectionBookedDate),
    inspectionFailCount: deal.inspectionFailCount ?? null,
    isInspectionPassed: deal.isInspectionPassed,
    hasInspectionFailed: deal.hasInspectionFailed,
    isFirstTimeInspectionPass: deal.firstTimeInspectionPass,
    inspectionFailureReason: deal.inspectionFailureReason ?? null,
    inspectionTurnaroundTime: decimalToNumberOrNull(deal.inspectionTurnaroundDays),
    hasInspectionFailedNotRejected: deal.hasInspectionFailedNotRejected,
    isFirstTimePassNotRejected: deal.firstTimeInspectionPassNotRejected,
    readyForInspection: deal.readyForInspection ?? null,

    // PTO
    ptoSubmitDate: dateToDateString(deal.ptoStartDate),
    ptoGrantedDate: dateToDateString(deal.ptoCompletionDate),
    ptoStatus: deal.ptoStatus ?? null,

    // Forecasted dates
    forecastedInstallDate: dateToDateString(deal.forecastedInstallDate),
    forecastedInspectionDate: dateToDateString(deal.forecastedInspectionDate),
    forecastedPtoDate: dateToDateString(deal.forecastedPtoDate),

    // Calculated fields
    daysToInstall,
    daysToInspection,
    daysToPto,
    daysSinceClose,
    daysSinceStageMovement,

    // Status flags
    systemPerformanceReview:
      String(deal.systemPerformanceReview ?? "").toLowerCase() === "true",
    stagePriority: STAGE_PRIORITY[stage] ?? 0,
    isRtb: isRTB,
    isSchedulable,
    isActive,
    isBlocked,

    // Priority
    priorityScore,

    // Crew & Install planning
    expectedDaysForInstall: deal.expectedDaysForInstall ?? 0,
    daysForInstallers: deal.daysForInstallers ?? 0,
    daysForElectricians: deal.daysForElectricians ?? 1,
    installCrew: deal.installCrew ?? "Unassigned",
    installDifficulty: deal.installDifficulty ?? 3,
    installNotes: deal.installNotes ?? "",
    roofersCount: deal.expectedInstallerCount ?? 0,
    electriciansCount: deal.expectedElectricianCount ?? 0,

    // Equipment
    equipment,

    // Team
    projectManager: deal.projectManager ?? "",
    operationsManager: deal.operationsManager ?? "",
    dealOwner: deal.dealOwnerName ?? "",
    siteSurveyor: deal.siteSurveyor ?? "",

    // Department leads
    designLead: leads.design ?? "",
    permitLead: leads.permit_tech ?? "",
    interconnectionsLead: leads.interconnections_tech ?? "",
    preconstructionLead: leads.rtb_lead ?? "",

    // QC Time Metrics (stored as Decimal days, Project expects number | null)
    siteSurveyTurnaroundTime: decimalToNumberOrNull(deal.siteSurveyTurnaroundDays),
    timeDAReadyToSent: decimalToNumberOrNull(deal.daReadyToSentDays),
    daTurnaroundTime: decimalToNumberOrNull(deal.daSentToApprovedDays),
    timeToSubmitPermit: decimalToNumberOrNull(deal.timeToSubmitPermitDays),
    timeToSubmitInterconnection: decimalToNumberOrNull(deal.timeToSubmitIcDays),
    daToRtb: decimalToNumberOrNull(deal.daToRtbDays),
    constructionTurnaroundTime: decimalToNumberOrNull(deal.constructionTurnaroundDays),
    timeCcToPto: decimalToNumberOrNull(deal.ccToPtoDays),
    timeToCc: decimalToNumberOrNull(deal.timeToCcDays),
    timeToDa: decimalToNumberOrNull(deal.timeToDaDays),
    timeToPto: decimalToNumberOrNull(deal.timeToPtoDays),
    interconnectionTurnaroundTime: decimalToNumberOrNull(deal.icTurnaroundDays),
    permitTurnaroundTime: decimalToNumberOrNull(deal.permitTurnaroundDays),
    timeRtbToConstructionSchedule: decimalToNumberOrNull(deal.rtbToConstructionDays),
    designTurnaroundTime: decimalToNumberOrNull(deal.designTurnaroundDays),
    projectTurnaroundTime: decimalToNumberOrNull(deal.projectTurnaroundDays),
    timeToRtb: decimalToNumberOrNull(deal.timeToRtbDays),
    timeRtbToCc: decimalToNumberOrNull(deal.rtbToCcDays),
    daToCc: decimalToNumberOrNull(deal.daToCcDays),
    daToPermit: decimalToNumberOrNull(deal.daToPermitDays),

    // External links
    designFolderUrl,
    driveUrl: deal.driveUrl ?? null,
    openSolarUrl: deal.openSolarUrl ?? null,
    openSolarId: deal.openSolarId ?? null,
    zuperUid: deal.zuperUid ?? null,
    hubspotContactId: deal.hubspotContactId ?? null,
  };
}

// ---------------------------------------------------------------------------
// dealToTransformedProject
// ---------------------------------------------------------------------------

/**
 * Converts a Prisma Deal row to the TransformedProject (snake_case) type used
 * by executive, locations, and at-risk dashboards.
 */
export function dealToTransformedProject(deal: PrismaDeal): TransformedProject {
  const now = new Date();

  const daysSinceClose = deal.closeDate
    ? Math.max(0, daysBetween(deal.closeDate, now))
    : 0;

  // Forecast dates — prefer explicit forecasted date, fall back to scheduled
  const forecastInstall =
    deal.forecastedInstallDate ?? deal.installScheduleDate ?? null;
  const forecastInspection =
    deal.forecastedInspectionDate ?? deal.inspectionScheduleDate ?? null;
  const forecastPto = deal.forecastedPtoDate ?? null;

  const daysToInstall = forecastInstall
    ? daysBetween(now, forecastInstall)
    : null;
  const daysToInspection = forecastInspection
    ? daysBetween(now, forecastInspection)
    : null;
  const daysToPto = forecastPto ? daysBetween(now, forecastPto) : null;

  return {
    id: deal.hubspotDealId,
    name: deal.dealName,
    pb_location: deal.pbLocation ?? "",
    ahj: deal.ahj ?? "",
    utility: deal.utility ?? "",
    project_type: deal.projectType ?? "",
    stage: deal.stage,
    amount: decimalToNumber(deal.amount),
    url: deal.hubspotUrl ?? undefined,

    close_date: dateToIso(deal.closeDate) ?? undefined,
    permit_submit: dateToIso(deal.permitSubmitDate) ?? undefined,
    permit_issued: dateToIso(deal.permitIssueDate) ?? undefined,
    install_scheduled: dateToIso(deal.installScheduleDate) ?? undefined,
    construction_complete: dateToIso(deal.constructionCompleteDate) ?? undefined,
    inspection_scheduled: dateToIso(deal.inspectionScheduleDate) ?? undefined,
    inspection_pass: dateToIso(deal.inspectionPassDate) ?? undefined,
    pto_granted: dateToIso(deal.ptoCompletionDate) ?? undefined,

    forecast_install: dateToIso(forecastInstall),
    forecast_inspection: dateToIso(forecastInspection),
    forecast_pto: dateToIso(forecastPto),

    days_to_install: daysToInstall,
    days_to_inspection: daysToInspection,
    days_to_pto: daysToPto,
    days_since_close: daysSinceClose,

    // V1: forecast engine output not computed from Deal mirror
    forecast: null,
  };
}

// ---------------------------------------------------------------------------
// dealToDeal
// ---------------------------------------------------------------------------

/**
 * Converts a Prisma Deal row to the Deal type used by /api/deals (sales,
 * service, D&R dashboards).
 */
export function dealToDeal(deal: PrismaDeal): DealType {
  const now = new Date();

  const stage = deal.stage;
  const pipelineKey = PIPELINE_KEY[deal.pipeline] ?? "";
  // Project pipeline active stages live in hubspot.ts; others in deals-pipeline.ts
  const activeStages = PIPELINE_ACTIVE_STAGES[pipelineKey] ?? ACTIVE_STAGES;
  const isActive = activeStages.includes(stage);

  const daysSinceCreate = deal.createDate
    ? Math.max(0, daysBetween(deal.createDate, now))
    : 0;

  return {
    id: Number(deal.hubspotDealId),
    name: deal.dealName,
    amount: decimalToNumber(deal.amount),
    stage,
    stageId: deal.stageId,
    pipeline: deal.pipeline,
    pbLocation: deal.pbLocation ?? "",
    address: deal.address ?? "",
    city: deal.city ?? "",
    state: deal.state ?? "",
    postalCode: deal.zipCode ?? "",
    projectType: deal.projectType ?? "",
    closeDate: dateToIso(deal.closeDate),
    createDate: dateToIso(deal.createDate),
    lastModified: dateToIso(deal.hubspotUpdatedAt),
    url: deal.hubspotUrl ?? "",
    isActive,
    daysSinceCreate,
  };
}
