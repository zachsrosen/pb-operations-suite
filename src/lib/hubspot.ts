import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

// Rate limiting helpers
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchWithRetry(
  searchRequest: Parameters<typeof hubspotClient.crm.deals.searchApi.doSearch>[0],
  maxRetries = 3
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await hubspotClient.crm.deals.searchApi.doSearch(searchRequest);
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt + 1) * 500; // 1s, 2s, 4s
        console.log(`[hubspot] Rate limited on attempt ${attempt + 1}, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

// Project Pipeline ID
const PROJECT_PIPELINE_ID = "6900017";

// Deal stage ID to name mapping for Project Pipeline
const DEAL_STAGE_MAP: Record<string, string> = {
  "20461935": "Project Rejected - Needs Review",
  "20461936": "Site Survey",
  "20461937": "Design & Engineering",
  "20461938": "Permitting & Interconnection",
  "71052436": "RTB - Blocked",
  "22580871": "Ready To Build",
  "20440342": "Construction",
  "22580872": "Inspection",
  "20461940": "Permission To Operate",
  "24743347": "Close Out",
  "20440343": "Project Complete",
  "20440344": "On-Hold",
  "68229433": "Cancelled",
};

// Stage priority mapping (higher = closer to completion)
const STAGE_PRIORITY: Record<string, number> = {
  "Project Rejected - Needs Review": 0,
  "Site Survey": 1,
  "Design & Engineering": 2,
  "Permitting & Interconnection": 3,
  "RTB - Blocked": 4,
  "Ready To Build": 5,
  "Construction": 6,
  "Inspection": 7,
  "Permission To Operate": 8,
  "Close Out": 9,
  "Project Complete": 10,
  "On-Hold": -1,
  "Cancelled": -2,
};

// Stages that are schedulable for construction
const SCHEDULABLE_STAGES = ["Site Survey", "Ready To Build", "RTB - Blocked", "Construction", "Inspection"];

// Stages that are active (not completed, on-hold, or cancelled)
const ACTIVE_STAGES = [
  "Site Survey",
  "Design & Engineering",
  "Permitting & Interconnection",
  "RTB - Blocked",
  "Ready To Build",
  "Construction",
  "Inspection",
  "Permission To Operate",
  "Close Out",
];

export interface Equipment {
  modules: {
    brand: string;
    model: string;
    count: number;
    wattage: number;
  };
  inverter: {
    brand: string;
    model: string;
    count: number;
    sizeKwac: number;
  };
  battery: {
    brand: string;
    model: string;
    count: number;
    sizeKwh: number;
    expansionCount: number;
  };
  evCount: number;
  systemSizeKwdc: number;
  systemSizeKwac: number;
}

export interface Project {
  id: number;
  name: string;
  projectNumber: string;

  // Location & Admin
  pbLocation: string;
  ahj: string;
  utility: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;

  // Project details
  projectType: string;
  stage: string;
  stageId: string;
  amount: number;
  url: string;

  // Tags
  tags: string[];
  isParticipateEnergy: boolean;
  participateEnergyStatus: string | null;

  // Incentive Programs
  threeceEvStatus: string | null;
  threeceBatteryStatus: string | null;
  sgipStatus: string | null;
  pbsrStatus: string | null;
  cpaStatus: string | null;

  // Key dates
  closeDate: string | null;

  // Site Survey
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  siteSurveyStatus: string | null;

  // Design
  designCompletionDate: string | null;
  designApprovalDate: string | null;
  designStatus: string | null;
  layoutStatus: string | null;

  // Permitting
  permitSubmitDate: string | null;
  permitIssueDate: string | null;
  permittingStatus: string | null;

  // Interconnection
  interconnectionSubmitDate: string | null;
  interconnectionApprovalDate: string | null;
  interconnectionStatus: string | null;

  // Construction
  readyToBuildDate: string | null;
  constructionScheduleDate: string | null;
  constructionCompleteDate: string | null;
  constructionStatus: string | null;

  // Inspection
  inspectionScheduleDate: string | null;
  inspectionPassDate: string | null;
  finalInspectionStatus: string | null;

  // PTO
  ptoSubmitDate: string | null;
  ptoGrantedDate: string | null;
  ptoStatus: string | null;

  // Forecasted dates
  forecastedInstallDate: string | null;
  forecastedInspectionDate: string | null;
  forecastedPtoDate: string | null;

  // Calculated fields
  daysToInstall: number | null;
  daysToInspection: number | null;
  daysToPto: number | null;
  daysSinceClose: number;
  daysSinceStageMovement: number;

  // Status flags
  stagePriority: number;
  isRtb: boolean;
  isSchedulable: boolean;
  isActive: boolean;
  isBlocked: boolean;

  // Priority & Scoring
  priorityScore: number;

  // Crew & Install planning
  expectedDaysForInstall: number;
  daysForInstallers: number;
  daysForElectricians: number;
  installCrew: string;
  installDifficulty: number;
  installNotes: string;
  roofersCount: number;
  electriciansCount: number;

  // Equipment (from deal properties, not line items)
  equipment: Equipment;

  // Team
  projectManager: string;
  operationsManager: string;
  dealOwner: string;
  siteSurveyor: string;

  // QC Time Metrics (pre-calculated by HubSpot, in days)
  siteSurveyTurnaroundTime: number | null;
  timeDAReadyToSent: number | null;
  daTurnaroundTime: number | null;
  timeToSubmitPermit: number | null;
  timeToSubmitInterconnection: number | null;
  daToRtb: number | null;
  constructionTurnaroundTime: number | null;
  timeCcToPto: number | null;
  timeToCc: number | null;
  timeToDa: number | null;
  timeToPto: number | null;
  interconnectionTurnaroundTime: number | null;
  permitTurnaroundTime: number | null;
  timeRtbToConstructionSchedule: number | null;
  designTurnaroundTime: number | null;
  projectTurnaroundTime: number | null;
  timeToRtb: number | null;
  timeRtbToCc: number | null;
  daToCc: number | null;
  daToPermit: number | null;
}

export interface LineItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  price: number;
  amount: number;
  productCategory: string;
  manufacturer: string;
  dcSize: number;
  acSize: number;
  energyStorageCapacity: number;
}

// All properties we need from HubSpot deals
const DEAL_PROPERTIES = [
  // Standard
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",

  // Project identifiers
  "project_number",

  // Location
  "pb_location",
  "ahj",
  "utility_company",
  "address_line_1",
  "city",
  "state",
  "postal_code",

  // Project type & tags
  "project_type",
  "tags",
  "participate_energy_status",

  // Incentive Programs
  "n3ce_ev_status",
  "n3ce_battery_status",
  "sgip_incentive_status",
  "pbsr_incentive_status",
  "cpa_status",

  // Site Survey dates
  "site_survey_schedule_date",
  "site_survey_date", // completion date

  // Design dates & status
  "design_completion_date",
  "layout_approval_date", // design approval
  "design_status",
  "layout_status", // design approval status

  // Permit dates
  "permit_submit_date",
  "permit_completion_date", // issue date
  "permitting_status",

  // Interconnection dates
  "interconnections_submit_date",
  "interconnections_completion_date", // approval date
  "interconnection_status",

  // Construction dates
  "ready_to_build_date",
  "install_schedule_date", // construction schedule
  "construction_complete_date",

  // Inspection dates
  "inspections_schedule_date",
  "inspections_completion_date", // pass date
  "final_inspection_status",

  // PTO dates
  "pto_start_date", // submit date
  "pto_completion_date", // granted date
  "pto_status",

  // Status fields for dashboards
  "install_status", // labeled "Construction Status" in HubSpot
  "site_survey_status",

  // Forecasted dates
  "forecasted_installation_date",
  "forecasted_inspection_date",
  "forecasted_pto_date",

  // Calculated/tracking
  "days_since_stage_movement",

  // Install planning
  "expected_days_for_install",
  "days_for_installers",
  "days_for_electricians",
  "install_crew",
  "install_difficulty",
  "notes_for_install",
  "expected_installer_cont",
  "expected_electrician_count",

  // EV
  "ev_count",

  // Equipment (deal-level)
  "module_brand",
  "module_model",
  "module_count",
  "module_wattage",
  "inverter_brand",
  "inverter_model",
  "inverter_qty",
  "inverter_size_kwac",
  "battery_brand",
  "battery_model",
  "battery_count",
  "battery_size", // kWh
  "battery_expansion_count",
  "calculated_system_size__kwdc_",
  "system_size_kwac",

  // Team
  "project_manager",
  "operations_manager",
  "hubspot_owner_id",
  "site_surveyor",

  // QC Time Metrics (pre-calculated by HubSpot, in days)
  "site_survey_turnaround_time",
  "time_between_da_ready_and_da_sent",
  "time_between_da_sent_and_da_approved",
  "time_to_submit_permit",
  "time_to_submit_interconnection",
  "da_to_rtb",
  "construction_turnaround_time",
  "time_between_cc___pto",
  "time_to_cc",
  "time_to_da",
  "time_to_pto",
  "interconnection_turnaround_time",
  "permit_turnaround_time",
  "time_between_rtb___construction_schedule_date",
  "design_turnaround_time",
  "project_turnaround_time",
  "time_to_rtb",
  "time_from_rtb_to_cc",
  "da_to_cc",
  "da_to_permit",
];

function daysBetween(date1: Date, date2: Date): number {
  const diffTime = date2.getTime() - date1.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  const str = String(value).trim();
  // ISO datetime string like "2026-02-10T00:00:00.000Z" — extract date portion
  if (str.includes("T")) {
    return str.split("T")[0];
  }
  // Already YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  // Unix timestamp in milliseconds (HubSpot sometimes returns dates this way)
  if (/^\d{10,13}$/.test(str)) {
    const ts = parseInt(str, 10);
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      // Use UTC to avoid timezone shift (HubSpot stores dates at midnight UTC)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
  }
  return str;
}

function parseTags(tagsValue: unknown): string[] {
  if (!tagsValue) return [];
  const str = String(tagsValue);
  return str.split(";").map(t => t.trim()).filter(Boolean);
}

function calculatePriorityScore(
  stage: string,
  daysSinceClose: number,
  isPE: boolean,
  isRTB: boolean,
  isBlocked: boolean
): number {
  let score = 0;

  // Base score from days since close (older = higher priority)
  score += Math.min(daysSinceClose * 0.5, 500);

  // Stage-based scoring (later stages get higher priority)
  const stagePriority = STAGE_PRIORITY[stage] || 0;
  if (stagePriority > 0) {
    score += stagePriority * 50;
  }

  // PE bonus - these need to hit milestones
  if (isPE) score += 200;

  // RTB bonus - ready for scheduling
  if (isRTB) score += 150;

  // Blocked penalty
  if (isBlocked) score -= 100;

  return Math.round(score * 10) / 10;
}

function transformDealToProject(deal: Record<string, unknown>, portalId: string, ownerMap?: Record<string, string>, surveyorMap?: Record<string, string>): Project {
  const now = new Date();
  const closeDate = deal.closedate ? new Date(deal.closedate as string) : null;
  const stageId = String(deal.dealstage || "");
  const stageName = DEAL_STAGE_MAP[stageId] || stageId;

  const tags = parseTags(deal.tags);
  const isPE = tags.includes("Participate Energy");
  const isRTB = stageName === "Ready To Build";
  const isBlocked = stageName === "RTB - Blocked" || stageName === "On-Hold";
  const isSchedulable = SCHEDULABLE_STAGES.includes(stageName);
  const isActive = ACTIVE_STAGES.includes(stageName);

  const daysSinceClose = closeDate ? daysBetween(closeDate, now) : 0;

  // Calculate days to milestones
  // Use explicit forecast dates from HubSpot if available
  const explicitForecastInstall = parseDate(deal.forecasted_installation_date) || parseDate(deal.install_schedule_date);
  const explicitForecastInspection = parseDate(deal.forecasted_inspection_date) || parseDate(deal.inspections_schedule_date);
  const explicitForecastPto = parseDate(deal.forecasted_pto_date);

  // Calculate default forecasts from close date if no explicit dates
  // Default timeline: Install at close + 90 days, Inspection at close + 120 days, PTO at close + 150 days
  let forecastInstall = explicitForecastInstall;
  let forecastInspection = explicitForecastInspection;
  let forecastPto = explicitForecastPto;

  if (closeDate) {
    if (!forecastInstall) {
      const defaultInstall = new Date(closeDate);
      defaultInstall.setDate(defaultInstall.getDate() + 90);
      forecastInstall = defaultInstall.toISOString().split('T')[0];
    }
    if (!forecastInspection) {
      const defaultInspection = new Date(closeDate);
      defaultInspection.setDate(defaultInspection.getDate() + 120);
      forecastInspection = defaultInspection.toISOString().split('T')[0];
    }
    if (!forecastPto) {
      const defaultPto = new Date(closeDate);
      defaultPto.setDate(defaultPto.getDate() + 150);
      forecastPto = defaultPto.toISOString().split('T')[0];
    }
  }

  const daysToInstall = forecastInstall ? daysBetween(now, new Date(forecastInstall)) : null;
  const daysToInspection = forecastInspection ? daysBetween(now, new Date(forecastInspection)) : null;
  const daysToPto = forecastPto ? daysBetween(now, new Date(forecastPto)) : null;

  const priorityScore = calculatePriorityScore(stageName, daysSinceClose, isPE, isRTB, isBlocked);

  // Build equipment object from deal properties with null-safety
  const equipment: Equipment = {
    modules: {
      brand: String(deal?.module_brand ?? ""),
      model: String(deal?.module_model ?? ""),
      count: Number(deal?.module_count ?? 0) || 0,
      wattage: Number(deal?.module_wattage ?? 0) || 0,
    },
    inverter: {
      brand: String(deal?.inverter_brand ?? ""),
      model: String(deal?.inverter_model ?? ""),
      count: Number(deal?.inverter_qty ?? 0) || 0,
      sizeKwac: Number(deal?.inverter_size_kwac ?? 0) || 0,
    },
    battery: {
      brand: String(deal?.battery_brand ?? ""),
      model: String(deal?.battery_model ?? ""),
      count: Number(deal?.battery_count ?? 0) || 0,
      sizeKwh: Number(deal?.battery_size ?? 0) || 0,
      expansionCount: Number(deal?.battery_expansion_count ?? 0) || 0,
    },
    evCount: Number(deal?.ev_count ?? 0) || 0,
    systemSizeKwdc: Number(deal?.calculated_system_size__kwdc_ ?? 0) || 0,
    systemSizeKwac: Number(deal?.system_size_kwac ?? 0) || 0,
  };

  return {
    id: Number(deal.hs_object_id),
    name: String(deal.dealname || "Unknown Project"),
    projectNumber: String(deal.project_number || ""),

    // Location
    pbLocation: String(deal.pb_location || "Unknown"),
    ahj: String(deal.ahj || "Unknown"),
    utility: String(deal.utility_company || "Unknown"),
    address: String(deal.address_line_1 || ""),
    city: String(deal.city || ""),
    state: String(deal.state || ""),
    postalCode: String(deal.postal_code || ""),

    // Project details
    projectType: String(deal.project_type || "Unknown"),
    stage: stageName,
    stageId,
    amount: Number(deal.amount) || 0,
    url: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${deal.hs_object_id}`,

    // Tags
    tags,
    isParticipateEnergy: isPE,
    participateEnergyStatus: deal.participate_energy_status ? String(deal.participate_energy_status) : null,

    // Incentive Programs
    threeceEvStatus: deal.n3ce_ev_status ? String(deal.n3ce_ev_status) : null,
    threeceBatteryStatus: deal.n3ce_battery_status ? String(deal.n3ce_battery_status) : null,
    sgipStatus: deal.sgip_incentive_status ? String(deal.sgip_incentive_status) : null,
    pbsrStatus: deal.pbsr_incentive_status ? String(deal.pbsr_incentive_status) : null,
    cpaStatus: deal.cpa_status ? String(deal.cpa_status) : null,

    // Key dates
    closeDate: parseDate(deal.closedate),

    // Site Survey
    siteSurveyScheduleDate: parseDate(deal.site_survey_schedule_date),
    siteSurveyCompletionDate: parseDate(deal.site_survey_date),
    siteSurveyStatus: deal.site_survey_status ? String(deal.site_survey_status) : null,

    // Design
    designCompletionDate: parseDate(deal.design_completion_date),
    designApprovalDate: parseDate(deal.layout_approval_date),
    designStatus: deal.design_status ? String(deal.design_status) : null,
    layoutStatus: deal.layout_status ? String(deal.layout_status) : null,

    // Permitting
    permitSubmitDate: parseDate(deal.permit_submit_date),
    permitIssueDate: parseDate(deal.permit_completion_date),
    permittingStatus: deal.permitting_status ? String(deal.permitting_status) : null,

    // Interconnection
    interconnectionSubmitDate: parseDate(deal.interconnections_submit_date),
    interconnectionApprovalDate: parseDate(deal.interconnections_completion_date),
    interconnectionStatus: deal.interconnection_status ? String(deal.interconnection_status) : null,

    // Construction
    readyToBuildDate: parseDate(deal.ready_to_build_date),
    constructionScheduleDate: parseDate(deal.install_schedule_date),
    constructionCompleteDate: parseDate(deal.construction_complete_date),
    constructionStatus: deal.install_status ? String(deal.install_status) : null,

    // Inspection
    inspectionScheduleDate: parseDate(deal.inspections_schedule_date),
    inspectionPassDate: parseDate(deal.inspections_completion_date),
    finalInspectionStatus: deal.final_inspection_status ? String(deal.final_inspection_status) : null,

    // PTO
    ptoSubmitDate: parseDate(deal.pto_start_date),
    ptoGrantedDate: parseDate(deal.pto_completion_date),
    ptoStatus: deal.pto_status ? String(deal.pto_status) : null,

    // Forecasted dates
    forecastedInstallDate: parseDate(deal.forecasted_installation_date),
    forecastedInspectionDate: parseDate(deal.forecasted_inspection_date),
    forecastedPtoDate: parseDate(deal.forecasted_pto_date),

    // Calculated fields
    daysToInstall,
    daysToInspection,
    daysToPto,
    daysSinceClose,
    daysSinceStageMovement: Number(deal.days_since_stage_movement) || 0,

    // Status flags
    stagePriority: STAGE_PRIORITY[stageName] || 0,
    isRtb: isRTB,
    isSchedulable,
    isActive,
    isBlocked,

    // Priority
    priorityScore,

    // Crew & Install planning
    expectedDaysForInstall: Number(deal.expected_days_for_install) || 0,
    daysForInstallers: Number(deal.days_for_installers) || 0,
    daysForElectricians: Number(deal.days_for_electricians) || 1,
    installCrew: String(deal.install_crew || "Unassigned"),
    installDifficulty: Number(deal.install_difficulty) || 3,
    installNotes: String(deal.notes_for_install || ""),
    roofersCount: Number(deal.expected_installer_cont) || 0,
    electriciansCount: Number(deal.expected_electrician_count) || 0,

    // Equipment
    equipment,

    // Team
    projectManager: String(deal.project_manager || ""),
    operationsManager: String(deal.operations_manager || ""),
    dealOwner: ownerMap?.[String(deal.hubspot_owner_id || "")] || "",
    siteSurveyor: (() => {
      const raw = String(deal.site_surveyor || "");
      if (!raw) return "";
      // If surveyorMap exists and has a mapping, use the label; otherwise use the raw value
      // This handles both enum (ID→label) and text (raw name) properties
      return surveyorMap?.[raw] || raw;
    })(),

    // QC Time Metrics (pre-calculated by HubSpot, in days)
    siteSurveyTurnaroundTime: deal.site_survey_turnaround_time ? Number(deal.site_survey_turnaround_time) : null,
    timeDAReadyToSent: deal.time_between_da_ready_and_da_sent ? Number(deal.time_between_da_ready_and_da_sent) : null,
    daTurnaroundTime: deal.time_between_da_sent_and_da_approved ? Number(deal.time_between_da_sent_and_da_approved) : null,
    timeToSubmitPermit: deal.time_to_submit_permit ? Number(deal.time_to_submit_permit) : null,
    timeToSubmitInterconnection: deal.time_to_submit_interconnection ? Number(deal.time_to_submit_interconnection) : null,
    daToRtb: deal.da_to_rtb ? Number(deal.da_to_rtb) : null,
    constructionTurnaroundTime: deal.construction_turnaround_time ? Number(deal.construction_turnaround_time) : null,
    timeCcToPto: deal.time_between_cc___pto ? Number(deal.time_between_cc___pto) : null,
    timeToCc: deal.time_to_cc ? Number(deal.time_to_cc) : null,
    timeToDa: deal.time_to_da ? Number(deal.time_to_da) : null,
    timeToPto: deal.time_to_pto ? Number(deal.time_to_pto) : null,
    interconnectionTurnaroundTime: deal.interconnection_turnaround_time ? Number(deal.interconnection_turnaround_time) : null,
    permitTurnaroundTime: deal.permit_turnaround_time ? Number(deal.permit_turnaround_time) : null,
    timeRtbToConstructionSchedule: deal.time_between_rtb___construction_schedule_date ? Number(deal.time_between_rtb___construction_schedule_date) : null,
    designTurnaroundTime: deal.design_turnaround_time ? Number(deal.design_turnaround_time) : null,
    projectTurnaroundTime: deal.project_turnaround_time ? Number(deal.project_turnaround_time) : null,
    timeToRtb: deal.time_to_rtb ? Number(deal.time_to_rtb) : null,
    timeRtbToCc: deal.time_from_rtb_to_cc ? Number(deal.time_from_rtb_to_cc) : null,
    daToCc: deal.da_to_cc ? Number(deal.da_to_cc) : null,
    daToPermit: deal.da_to_permit ? Number(deal.da_to_permit) : null,
  };
}

export async function fetchAllProjects(options?: {
  activeOnly?: boolean;
  stages?: string[];
}): Promise<Project[]> {
  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  // ── Phase 1: Collect all deal IDs using search with MINIMAL properties ──
  // HubSpot search API truncates results when too many properties are
  // requested per deal (we need 63). Searching with just the ID is fast
  // and paginates reliably, then we batch-read full properties in Phase 2.
  const INACTIVE_STAGE_IDS = ["20440343", "20440344", "68229433", "20461935"];

  // Build search filters
  const filters: { propertyName: string; operator: typeof FilterOperatorEnum.Eq | typeof FilterOperatorEnum.Neq; value: string }[] = [
    {
      propertyName: "pipeline",
      operator: FilterOperatorEnum.Eq,
      value: PROJECT_PIPELINE_ID,
    },
  ];

  // When fetching active-only, exclude inactive stages at the HubSpot level.
  // This reduces results from ~6,500 to ~700 deals (10× faster).
  if (options?.activeOnly !== false) {
    for (const stageId of INACTIVE_STAGE_IDS) {
      filters.push({
        propertyName: "dealstage",
        operator: FilterOperatorEnum.Neq,
        value: stageId,
      });
    }
  }

  const allDealIds: string[] = [];
  let after: string | undefined;
  const MAX_PAGINATION_PAGES = 100; // 100 pages × 100 = 10,000 (HubSpot search max)
  let pageCount = 0;
  let searchTotal = 0;

  console.log(`[HubSpot] Starting project fetch (activeOnly=${options?.activeOnly !== false})`);

  do {
    if (pageCount >= MAX_PAGINATION_PAGES) {
      console.warn(`[HubSpot] Hit pagination limit (${MAX_PAGINATION_PAGES} pages, ${allDealIds.length} IDs)`);
      break;
    }

    const searchRequest: {
      filterGroups: { filters: typeof filters }[];
      properties: string[];
      limit: number;
      after?: string;
    } = {
      filterGroups: [{ filters }],
      properties: ["hs_object_id"],
      limit: 100,
    };
    if (after) {
      searchRequest.after = after;
    }

    const response = await searchWithRetry(searchRequest);

    if (pageCount === 0) {
      searchTotal = response.total;
      console.log(`[HubSpot] Search reports ${searchTotal} total matching deals`);
    }

    const ids = response.results.map((deal) => deal.id);
    allDealIds.push(...ids);
    after = response.paging?.next?.after;
    pageCount++;

    if (after) await sleep(50);
  } while (after);

  console.log(`[HubSpot] Phase 1 complete: ${allDealIds.length} IDs collected in ${pageCount} pages (HubSpot total: ${searchTotal})`);

  if (allDealIds.length === 0) return [];

  // ── Phase 2: Batch-read full properties ──
  // The batch API reliably returns all requested properties without truncation.
  const allDeals: Record<string, unknown>[] = [];
  const BATCH_SIZE = 100;
  const batches: string[][] = [];

  for (let i = 0; i < allDealIds.length; i += BATCH_SIZE) {
    batches.push(allDealIds.slice(i, i + BATCH_SIZE));
  }

  // Process batches with limited concurrency to respect rate limits
  const CONCURRENCY = 3;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const batchGroup = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batchGroup.map((batch) =>
        hubspotClient.crm.deals.batchApi.read({
          inputs: batch.map((id) => ({ id })),
          properties: DEAL_PROPERTIES,
          propertiesWithHistory: [],
        })
      )
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allDeals.push(...result.value.results.map((deal) => deal.properties));
      } else {
        console.error("[HubSpot] Batch read failed:", result.reason?.message || result.reason);
      }
    }

    if (i + CONCURRENCY < batches.length) await sleep(100);
  }

  console.log(`[HubSpot] Phase 2 complete: ${allDeals.length} deals with full properties`);

  // Resolve owner IDs to names — use BOTH property definitions and Owners API
  // to maximize coverage (property defs may be incomplete, Owners API may fail)
  // Parallelized for performance (was 3 sequential API calls)
  const ownerMap: Record<string, string> = {};

  const [ownerPropResult, surveyorPropResult, ownersApiResult] = await Promise.allSettled([
    // Source 1: Property definition options for hubspot_owner_id
    hubspotClient.crm.properties.coreApi.getByName("deals", "hubspot_owner_id"),
    // Source 2: Property definition options for site_surveyor
    hubspotClient.crm.properties.coreApi.getByName("deals", "site_surveyor"),
    // Source 3: Owners API (first page — covers most cases)
    hubspotClient.crm.owners.ownersApi.getPage(undefined, undefined, 500, false),
  ]);

  // Process Source 1: hubspot_owner_id property options
  if (ownerPropResult.status === "fulfilled") {
    for (const opt of ownerPropResult.value.options || []) {
      if (opt.value && opt.label && opt.label.trim()) {
        ownerMap[opt.value] = opt.label;
      }
    }
    console.log(`[HubSpot] Owner prop options: ${Object.keys(ownerMap).length} mappings`);
  } else {
    console.warn("[HubSpot] Failed to fetch hubspot_owner_id property:", ownerPropResult.reason?.message || ownerPropResult.reason);
  }

  // Process Source 2: site_surveyor property options
  if (surveyorPropResult.status === "fulfilled") {
    for (const opt of surveyorPropResult.value.options || []) {
      if (opt.value && opt.label && opt.label.trim() && !ownerMap[opt.value]) {
        ownerMap[opt.value] = opt.label;
      }
    }
    console.log(`[HubSpot] After surveyor prop: ${Object.keys(ownerMap).length} total mappings`);
  } else {
    console.warn("[HubSpot] Failed to fetch site_surveyor property:", surveyorPropResult.reason?.message || surveyorPropResult.reason);
  }

  // Process Source 3: Owners API (paginated — fills gaps)
  if (ownersApiResult.status === "fulfilled") {
    for (const owner of ownersApiResult.value.results || []) {
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
      if (name && owner.id && !ownerMap[owner.id]) {
        ownerMap[owner.id] = name;
      }
    }
    // Paginate remaining owners if needed
    let ownerAfter = ownersApiResult.value.paging?.next?.after;
    while (ownerAfter) {
      try {
        const ownersResponse = await hubspotClient.crm.owners.ownersApi.getPage(
          undefined, ownerAfter, 500, false
        );
        for (const owner of ownersResponse.results || []) {
          const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
          if (name && owner.id && !ownerMap[owner.id]) {
            ownerMap[owner.id] = name;
          }
        }
        ownerAfter = ownersResponse.paging?.next?.after;
      } catch (err) {
        console.warn("[HubSpot] Failed to paginate owners:", err instanceof Error ? err.message : err);
        break;
      }
    }
    console.log(`[HubSpot] After owners API: ${Object.keys(ownerMap).length} total mappings`);
  } else {
    console.warn("[HubSpot] Failed to fetch owners API:", ownersApiResult.reason?.message || ownersApiResult.reason);
  }

  console.log(`[HubSpot] Final owner map: ${Object.keys(ownerMap).length} ID→name mappings`);

  // Both hubspot_owner_id and site_surveyor store owner IDs, so one map covers both
  const surveyorMap = ownerMap;

  // Transform deals to projects
  let projects = allDeals.map((deal) => transformDealToProject(deal, portalId, ownerMap, surveyorMap));

  // Apply filters
  if (options?.activeOnly) {
    projects = projects.filter((p) => p.isActive);
  }
  if (options?.stages && options.stages.length > 0) {
    projects = projects.filter((p) => options.stages!.includes(p.stage));
  }

  return projects;
}

export async function fetchProjectById(id: string): Promise<Project | null> {
  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  try {
    const response = await hubspotClient.crm.deals.basicApi.getById(
      id,
      DEAL_PROPERTIES
    );
    return transformDealToProject(response.properties, portalId);
  } catch {
    return null;
  }
}

/**
 * Update a deal property in HubSpot
 * Invalidates related caches after successful update.
 */
export async function updateDealProperty(
  dealId: string,
  properties: Record<string, string>
): Promise<boolean> {
  try {
    await hubspotClient.crm.deals.basicApi.update(dealId, { properties });
    console.log(`[HubSpot] Updated deal ${dealId} properties:`, Object.keys(properties).join(", "));

    // Invalidate caches so updated data is fetched on next request
    try {
      const { appCache } = await import("@/lib/cache");
      appCache.invalidateByPrefix("projects:");
      appCache.invalidateByPrefix("deals:");
      appCache.invalidate("stats");
      console.log(`[HubSpot] Cache invalidated after deal ${dealId} update`);
    } catch {
      // Cache invalidation is best-effort, don't fail the update
    }

    return true;
  } catch (err) {
    console.error(`[HubSpot] Failed to update deal ${dealId}:`, err);
    return false;
  }
}

export async function fetchLineItemsForDeal(dealId: string): Promise<LineItem[]> {
  try {
    // Get associations using the associations API
    const associationsResponse = await hubspotClient.crm.associations.batchApi.read(
      "deals",
      "line_items",
      { inputs: [{ id: dealId }] }
    );

    const associations = associationsResponse.results?.[0]?.to || [];
    if (associations.length === 0) {
      return [];
    }

    const lineItemIds = associations.map((a) => a.id);

    const lineItemsResponse = await hubspotClient.crm.lineItems.batchApi.read({
      inputs: lineItemIds.map((id) => ({ id })),
      properties: [
        "name",
        "description",
        "quantity",
        "price",
        "amount",
        "product_category",
        "manufacturer",
        "dc_size",
        "ac_size",
        "energy_storage_capacity",
      ],
      propertiesWithHistory: [],
    });

    return lineItemsResponse.results.map((item) => ({
      id: item.id,
      name: String(item.properties.name || ""),
      description: String(item.properties.description || ""),
      quantity: Number(item.properties.quantity) || 1,
      price: Number(item.properties.price) || 0,
      amount: Number(item.properties.amount) || 0,
      productCategory: String(item.properties.product_category || ""),
      manufacturer: String(item.properties.manufacturer || ""),
      dcSize: Number(item.properties.dc_size) || 0,
      acSize: Number(item.properties.ac_size) || 0,
      energyStorageCapacity: Number(item.properties.energy_storage_capacity) || 0,
    }));
  } catch (error) {
    console.error("Error fetching line items:", error);
    return [];
  }
}

export function calculateStats(projects: Project[]) {
  const activeProjects = projects.filter((p) => p.isActive);
  const totalValue = activeProjects.reduce((sum, p) => sum + p.amount, 0);
  const peProjects = activeProjects.filter((p) => p.isParticipateEnergy);
  const rtbProjects = activeProjects.filter((p) => p.isRtb);
  const blockedProjects = activeProjects.filter((p) => p.isBlocked);
  const inspectionBacklog = activeProjects.filter((p) => p.stage === "Inspection");
  const ptoBacklog = activeProjects.filter((p) => p.stage === "Permission To Operate");
  const constructionProjects = activeProjects.filter((p) => p.stage === "Construction");

  // Location breakdown (counts and values)
  const locationCounts = activeProjects.reduce((acc, p) => {
    acc[p.pbLocation] = (acc[p.pbLocation] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const locationValues = activeProjects.reduce((acc, p) => {
    acc[p.pbLocation] = (acc[p.pbLocation] || 0) + p.amount;
    return acc;
  }, {} as Record<string, number>);

  // Stage breakdown (counts and values)
  const stageCounts = activeProjects.reduce((acc, p) => {
    acc[p.stage] = (acc[p.stage] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const stageValues = activeProjects.reduce((acc, p) => {
    acc[p.stage] = (acc[p.stage] || 0) + p.amount;
    return acc;
  }, {} as Record<string, number>);

  // Equipment summary
  const totalSystemSizeKw = activeProjects.reduce((sum, p) => sum + p.equipment.systemSizeKwdc, 0);
  const totalBatteryKwh = activeProjects.reduce((sum, p) => sum + (p.equipment.battery.count * p.equipment.battery.sizeKwh), 0);

  return {
    totalProjects: activeProjects.length,
    totalValue,
    peCount: peProjects.length,
    peValue: peProjects.reduce((sum, p) => sum + p.amount, 0),
    rtbCount: rtbProjects.length,
    rtbValue: rtbProjects.reduce((sum, p) => sum + p.amount, 0),
    blockedCount: blockedProjects.length,
    blockedValue: blockedProjects.reduce((sum, p) => sum + p.amount, 0),
    constructionCount: constructionProjects.length,
    constructionValue: constructionProjects.reduce((sum, p) => sum + p.amount, 0),
    inspectionBacklog: inspectionBacklog.length,
    inspectionValue: inspectionBacklog.reduce((sum, p) => sum + p.amount, 0),
    ptoBacklog: ptoBacklog.length,
    ptoValue: ptoBacklog.reduce((sum, p) => sum + p.amount, 0),
    locationCounts,
    locationValues,
    stageCounts,
    stageValues,
    totalSystemSizeKw: Math.round(totalSystemSizeKw * 10) / 10,
    totalBatteryKwh: Math.round(totalBatteryKwh * 10) / 10,
    lastUpdated: new Date().toISOString(),
  };
}

// Helper to get projects filtered for specific dashboard contexts
export function filterProjectsForContext(
  projects: Project[],
  context: "scheduling" | "equipment" | "pe" | "executive" | "at-risk" | "all"
): Project[] {
  switch (context) {
    case "scheduling":
      // Projects that need to be scheduled or are in construction/inspection stages
      // Also include projects that already completed construction (moved to PTO/Close Out)
      // so they still appear on the calendar at their scheduled date
      return projects.filter(
        (p) =>
          p.isSchedulable ||
          p.stage === "Construction" ||
          p.stage === "Inspection" ||
          (p.constructionScheduleDate && p.constructionCompleteDate) ||
          (p.inspectionScheduleDate && p.inspectionPassDate)
      );

    case "equipment":
      // All active projects with any equipment data (solar, battery, or EV)
      return projects.filter(
        (p) =>
          p.isActive &&
          (p.equipment.systemSizeKwdc > 0 ||
            p.equipment.battery.count > 0 ||
            p.equipment.evCount > 0)
      );

    case "pe":
      // Participate Energy projects
      return projects.filter((p) => p.isParticipateEnergy && p.isActive);

    case "executive":
      // All active projects for executive dashboard
      return projects.filter((p) => p.isActive);

    case "at-risk":
      // Projects that are overdue or blocked
      return projects.filter(
        (p) =>
          p.isActive &&
          (p.isBlocked ||
            p.daysSinceStageMovement > 30 ||
            (p.daysToInstall !== null && p.daysToInstall < 0 && !p.constructionCompleteDate) ||
            (p.daysToInspection !== null && p.daysToInspection < 0 && !p.inspectionPassDate) ||
            (p.daysToPto !== null && p.daysToPto < 0 && !p.ptoGrantedDate))
      );

    default:
      return projects;
  }
}
