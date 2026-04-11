/**
 * Deal Property Map — single source of truth for HubSpot property → Deal column.
 *
 * Drives: batch sync upserts, webhook updates, change diffs, future write-back.
 * See spec: docs/superpowers/specs/2026-04-10-deal-mirror-design.md
 */

export type PropertyType =
  | "string"
  | "decimal"
  | "int"
  | "boolean"
  | "datetime"
  | "json";

export interface PropertyMapping {
  column: string;
  type: PropertyType;
  transform?: (value: string | null | undefined) => unknown;
}

// --- Transform helpers ---

export function msToDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = parseFloat(value);
  if (isNaN(ms)) return null;
  return Math.round((ms / 86_400_000) * 10) / 10; // 1 decimal — matches existing hubspot.ts msToDays()
}

function toBool(value: string | null | undefined): boolean {
  return value === "true" || value === "True" || value === "TRUE";
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function toDecimal(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

function toInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

// --- The map ---

export const dealPropertyMap: Record<string, PropertyMapping> = {
  // Identity
  dealname: { column: "dealName", type: "string" },
  amount: { column: "amount", type: "decimal" },
  dealstage: { column: "stageId", type: "string" },

  // Location
  pb_location: { column: "pbLocation", type: "string" },
  address_line_1: { column: "address", type: "string" },
  city: { column: "city", type: "string" },
  state: { column: "state", type: "string" },
  postal_code: { column: "zipCode", type: "string" },
  ahj: { column: "ahj", type: "string" },
  utility_company: { column: "utility", type: "string" },

  // Team
  hubspot_owner_id: { column: "hubspotOwnerId", type: "string" },
  project_manager: { column: "projectManager", type: "string" },
  operations_manager: { column: "operationsManager", type: "string" },
  site_surveyor: { column: "siteSurveyor", type: "string" },
  design: { column: "_dept_design", type: "string" },
  permit_tech: { column: "_dept_permit_tech", type: "string" },
  interconnections_tech: { column: "_dept_ic_tech", type: "string" },
  rtb_lead: { column: "_dept_rtb_lead", type: "string" },

  // Milestones (all datetime)
  closedate: { column: "closeDate", type: "datetime" },
  site_survey_schedule_date: { column: "siteSurveyScheduleDate", type: "datetime" },
  site_survey_scheduled_date: { column: "siteSurveyScheduledDate", type: "datetime" },
  site_survey_date: { column: "siteSurveyCompletionDate", type: "datetime" },
  date_returned_from_designers: { column: "dateReturnedFromDesigners", type: "datetime" },
  design_start_date: { column: "designStartDate", type: "datetime" },
  design_draft_completion_date: { column: "designDraftCompletionDate", type: "datetime" },
  design_completion_date: { column: "designCompletionDate", type: "datetime" },
  design_approval_sent_date: { column: "designApprovalSentDate", type: "datetime" },
  layout_approval_date: { column: "layoutApprovalDate", type: "datetime" },
  permit_submit_date: { column: "permitSubmitDate", type: "datetime" },
  permit_completion_date: { column: "permitIssueDate", type: "datetime" },
  interconnections_submit_date: { column: "icSubmitDate", type: "datetime" },
  interconnections_completion_date: { column: "icApprovalDate", type: "datetime" },
  ready_to_build_date: { column: "rtbDate", type: "datetime" },
  install_schedule_date: { column: "installScheduleDate", type: "datetime" },
  construction_complete_date: { column: "constructionCompleteDate", type: "datetime" },
  inspections_schedule_date: { column: "inspectionScheduleDate", type: "datetime" },
  inspections_completion_date: { column: "inspectionPassDate", type: "datetime" },
  inspections_fail_date: { column: "inspectionFailDate", type: "datetime" },
  inspection_booked_date: { column: "inspectionBookedDate", type: "datetime" },
  pto_start_date: { column: "ptoStartDate", type: "datetime" },
  pto_completion_date: { column: "ptoCompletionDate", type: "datetime" },
  forecasted_installation_date: { column: "forecastedInstallDate", type: "datetime" },
  forecasted_inspection_date: { column: "forecastedInspectionDate", type: "datetime" },
  forecasted_pto_date: { column: "forecastedPtoDate", type: "datetime" },
  hs_v2_date_entered_current_stage: { column: "dateEnteredCurrentStage", type: "datetime" },
  hs_createdate: { column: "createDate", type: "datetime" },

  // Status Flags (booleans)
  is_site_survey_scheduled_: { column: "isSiteSurveyScheduled", type: "boolean" },
  is_site_survey_completed_: { column: "isSiteSurveyCompleted", type: "boolean" },
  is_da_sent_: { column: "isDaSent", type: "boolean" },
  layout_approved: { column: "isLayoutApproved", type: "boolean" },
  is_design_drafted_: { column: "isDesignDrafted", type: "boolean" },
  is_design_completed_: { column: "isDesignCompleted", type: "boolean" },
  is_permit_submitted_: { column: "isPermitSubmitted", type: "boolean" },
  permit_issued_: { column: "isPermitIssued", type: "boolean" },
  is_interconnection_submitted_: { column: "isIcSubmitted", type: "boolean" },
  interconnection_approved_: { column: "isIcApproved", type: "boolean" },
  is_inspection_passed_: { column: "isInspectionPassed", type: "boolean" },
  has_inspection_failed_: { column: "hasInspectionFailed", type: "boolean" },
  first_time_inspection_pass_: { column: "firstTimeInspectionPass", type: "boolean" },
  "has_inspection_failed__not_rejected__": { column: "hasInspectionFailedNotRejected", type: "boolean" },
  "first_time_inspection_pass____not_rejected_": { column: "firstTimeInspectionPassNotRejected", type: "boolean" },

  // Status Flags (strings/ints)
  ready_for_inspection_: { column: "readyForInspection", type: "string" },
  final_inspection_status: { column: "finalInspectionStatus", type: "string" },
  inspection_fail_count: { column: "inspectionFailCount", type: "int" },
  inspection_failure_reason: { column: "inspectionFailureReason", type: "string" },
  install_status: { column: "installStatus", type: "string" },
  design_status: { column: "designStatus", type: "string" },
  site_survey_status: { column: "surveyStatus", type: "string" },
  permitting_status: { column: "permittingStatus", type: "string" },
  layout_status: { column: "layoutStatus", type: "string" },
  interconnection_status: { column: "icStatus", type: "string" },
  pto_status: { column: "ptoStatus", type: "string" },

  // Equipment
  calculated_system_size__kwdc_: { column: "systemSizeKwdc", type: "decimal" },
  system_size_kwac: { column: "systemSizeKwac", type: "decimal" },
  module_brand: { column: "moduleBrand", type: "string" },
  module_model: { column: "moduleModel", type: "string" },
  module_count: { column: "moduleCount", type: "int" },
  module_wattage: { column: "moduleWattage", type: "int" },
  modules: { column: "moduleName", type: "string" },
  inverter_brand: { column: "inverterBrand", type: "string" },
  inverter_model: { column: "inverterModel", type: "string" },
  inverter_qty: { column: "inverterQty", type: "int" },
  inverter_size_kwac: { column: "inverterSizeKwac", type: "decimal" },
  inverter: { column: "inverterName", type: "string" },
  battery_brand: { column: "batteryBrand", type: "string" },
  battery_model: { column: "batteryModel", type: "string" },
  battery_count: { column: "batteryCount", type: "int" },
  battery_size: { column: "batterySizeKwh", type: "decimal" },
  battery: { column: "batteryName", type: "string" },
  battery_expansion_count: { column: "batteryExpansionCount", type: "int" },
  battery_expansion: { column: "batteryExpansionName", type: "string" },
  expansion_model: { column: "batteryExpansionModel", type: "string" },
  ev_count: { column: "evCount", type: "int" },

  // QC Metrics (ms → days)
  site_survey_turnaround_time: { column: "siteSurveyTurnaroundDays", type: "decimal", transform: msToDays },
  design_turnaround_time: { column: "designTurnaroundDays", type: "decimal", transform: msToDays },
  permit_turnaround_time: { column: "permitTurnaroundDays", type: "decimal", transform: msToDays },
  interconnection_turnaround_time: { column: "icTurnaroundDays", type: "decimal", transform: msToDays },
  construction_turnaround_time: { column: "constructionTurnaroundDays", type: "decimal", transform: msToDays },
  project_turnaround_time: { column: "projectTurnaroundDays", type: "decimal", transform: msToDays },
  inspection_turnaround_time: { column: "inspectionTurnaroundDays", type: "decimal", transform: msToDays },
  time_between_da_ready_and_da_sent: { column: "daReadyToSentDays", type: "decimal", transform: msToDays },
  time_between_da_sent_and_da_approved: { column: "daSentToApprovedDays", type: "decimal", transform: msToDays },
  time_to_submit_permit: { column: "timeToSubmitPermitDays", type: "decimal", transform: msToDays },
  time_to_submit_interconnection: { column: "timeToSubmitIcDays", type: "decimal", transform: msToDays },
  da_to_rtb: { column: "daToRtbDays", type: "decimal", transform: msToDays },
  time_between_rtb___construction_schedule_date: { column: "rtbToConstructionDays", type: "decimal", transform: msToDays },
  time_between_cc___pto: { column: "ccToPtoDays", type: "decimal", transform: msToDays },
  time_to_cc: { column: "timeToCcDays", type: "decimal", transform: msToDays },
  time_to_da: { column: "timeToDaDays", type: "decimal", transform: msToDays },
  time_to_pto: { column: "timeToPtoDays", type: "decimal", transform: msToDays },
  time_to_rtb: { column: "timeToRtbDays", type: "decimal", transform: msToDays },
  time_from_rtb_to_cc: { column: "rtbToCcDays", type: "decimal", transform: msToDays },
  da_to_cc: { column: "daToCcDays", type: "decimal", transform: msToDays },
  da_to_permit: { column: "daToPermitDays", type: "decimal", transform: msToDays },

  // Revisions
  da_revision_counter: { column: "daRevisionCount", type: "int" },
  as_built_revision_counter: { column: "asBuiltRevisionCount", type: "int" },
  permit_revision_counter: { column: "permitRevisionCount", type: "int" },
  interconnection_revision_counter: { column: "icRevisionCount", type: "int" },
  total_revision_count: { column: "totalRevisionCount", type: "int" },

  // External Links
  design_documents: { column: "designDocumentsUrl", type: "string" },
  design_document_folder_id: { column: "designFolderUrl", type: "string" },
  all_document_parent_folder_id: { column: "allDocumentFolderUrl", type: "string" },
  g_drive: { column: "driveUrl", type: "string" },
  link_to_opensolar: { column: "openSolarUrl", type: "string" },
  os_project_id: { column: "openSolarId", type: "string" },
  zuper_site_survey_uid: { column: "zuperUid", type: "string" },

  // Install Planning
  expected_days_for_install: { column: "expectedDaysForInstall", type: "int" },
  days_for_installers: { column: "daysForInstallers", type: "int" },
  days_for_electricians: { column: "daysForElectricians", type: "int" },
  install_crew: { column: "installCrew", type: "string" },
  install_difficulty: { column: "installDifficulty", type: "int" },
  notes_for_install: { column: "installNotes", type: "string" },
  expected_installer_cont: { column: "expectedInstallerCount", type: "int" },
  expected_electrician_count: { column: "expectedElectricianCount", type: "int" },

  // Incentives
  n3ce_ev_status: { column: "n3ceEvStatus", type: "string" },
  n3ce_battery_status: { column: "n3ceBatteryStatus", type: "string" },
  sgip_incentive_status: { column: "sgipStatus", type: "string" },
  pbsr_incentive_status: { column: "pbsrStatus", type: "string" },
  cpa_status: { column: "cpaStatus", type: "string" },
  participate_energy_status: { column: "participateEnergyStatus", type: "string" },

  // Misc
  project_number: { column: "projectNumber", type: "string" },
  project_type: { column: "projectType", type: "string" },
  tags: { column: "tags", type: "string" },
  disco__reco: { column: "discoReco", type: "string" },
  interior_access: { column: "interiorAccess", type: "string" },
  site_survey_documents: { column: "siteSurveyDocuments", type: "string" },
  system_performance_review: { column: "systemPerformanceReview", type: "string" },
};

/**
 * All HubSpot properties the sync engine should request.
 * Derived from the map keys + system properties needed for sync.
 */
export const DEAL_SYNC_PROPERTIES: string[] = [
  ...Object.keys(dealPropertyMap),
  "hs_object_id",        // deal ID
  "hs_lastmodifieddate", // watermark for incremental sync
  "pipeline",            // pipeline resolution
  "is_participate_energy", // secondary PE check
  "os_project_link",     // openSolarUrl fallback (not in map, consumed in mapHubSpotToDeal)
];

/** Department lead property keys for building departmentLeads Json */
const DEPT_LEAD_PROPS = ["design", "permit_tech", "interconnections_tech", "rtb_lead"] as const;

/**
 * Convert a flat HubSpot properties object into a partial Deal upsert payload.
 * Does NOT set: pipeline, stage (name), dealOwnerName, associations, hubspotDealId.
 * Those are resolved separately during sync.
 */
export function mapHubSpotToDeal(
  properties: Record<string, string | null | undefined>,
  options?: { portalId?: string }
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [hsProp, mapping] of Object.entries(dealPropertyMap)) {
    // Skip department lead intermediate columns
    if (mapping.column.startsWith("_dept_")) continue;

    const raw = properties[hsProp];

    if (mapping.transform) {
      result[mapping.column] = mapping.transform(raw);
    } else {
      switch (mapping.type) {
        case "string":
          result[mapping.column] = raw ?? null;
          break;
        case "decimal":
          result[mapping.column] = toDecimal(raw);
          break;
        case "int":
          result[mapping.column] = toInt(raw);
          break;
        case "boolean":
          result[mapping.column] = toBool(raw);
          break;
        case "datetime":
          result[mapping.column] = toDate(raw);
          break;
        case "json":
          if (raw) {
            try { result[mapping.column] = JSON.parse(raw); }
            catch { result[mapping.column] = null; }
          } else {
            result[mapping.column] = null;
          }
          break;
      }
    }
  }

  // Computed: isParticipateEnergy from tags
  const tags = (properties.tags ?? "") as string;
  result.isParticipateEnergy =
    tags.includes("Participate Energy") ||
    toBool(properties.is_participate_energy);

  // Computed: departmentLeads JSON
  const deptLeads: Record<string, string | null> = {};
  for (const key of DEPT_LEAD_PROPS) {
    deptLeads[key] = (properties[key] as string) ?? null;
  }
  result.departmentLeads = deptLeads;

  // Computed: hubspotUrl — uses /record/0-3/ format (NOT /deal/)
  const dealId = properties.hs_object_id;
  const portalId = options?.portalId ?? process.env.HUBSPOT_PORTAL_ID;
  if (dealId && portalId) {
    result.hubspotUrl = `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
  }

  // Computed: openSolarUrl fallback
  if (!result.openSolarUrl && properties.os_project_link) {
    result.openSolarUrl = properties.os_project_link;
  }

  // Sync metadata
  result.hubspotUpdatedAt = toDate(properties.hs_lastmodifieddate);

  return result;
}
