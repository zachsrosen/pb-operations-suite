/**
 * Server-side serialization: Prisma Deal → SerializedDeal DTO.
 * Handles Decimal → number, Date → ISO string, Json → parsed object.
 * Called in page.tsx before passing props to the client component.
 */

import type { Deal as PrismaDeal } from "@/generated/prisma/client";
import type { SerializedDeal, DepartmentLeads, TimelineStage } from "./types";

// --- Helpers ---

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  return null;
}

function parseDepartmentLeads(value: unknown): DepartmentLeads {
  if (!value) return {};
  if (typeof value === "object" && !(value instanceof Date)) {
    return value as DepartmentLeads;
  }
  try {
    return JSON.parse(String(value)) as DepartmentLeads;
  } catch {
    return {};
  }
}

// --- Date fields on the Deal model (exhaustive list) ---
const DATE_FIELDS = new Set([
  "closeDate", "siteSurveyScheduleDate", "siteSurveyScheduledDate",
  "siteSurveyCompletionDate", "dateReturnedFromDesigners", "designStartDate",
  "designDraftCompletionDate", "designCompletionDate", "designApprovalSentDate",
  "layoutApprovalDate", "permitSubmitDate", "permitIssueDate",
  "icSubmitDate", "icApprovalDate", "rtbDate", "installScheduleDate",
  "constructionCompleteDate", "inspectionScheduleDate", "inspectionPassDate",
  "inspectionFailDate", "inspectionBookedDate", "ptoStartDate", "ptoCompletionDate",
  "forecastedInstallDate", "forecastedInspectionDate", "forecastedPtoDate",
  "dateEnteredCurrentStage", "createDate", "hubspotUpdatedAt", "lastSyncedAt",
  "serviceVisitCompleteDate",
  "createdAt", "updatedAt",
]);

// --- Decimal fields on the Deal model (exhaustive list) ---
const DECIMAL_FIELDS = new Set([
  "amount", "systemSizeKwdc", "systemSizeKwac", "inverterSizeKwac", "batterySizeKwh",
  "siteSurveyTurnaroundDays", "designTurnaroundDays", "permitTurnaroundDays",
  "icTurnaroundDays", "constructionTurnaroundDays", "projectTurnaroundDays",
  "inspectionTurnaroundDays", "daReadyToSentDays", "daSentToApprovedDays",
  "timeToSubmitPermitDays", "timeToSubmitIcDays", "daToRtbDays",
  "rtbToConstructionDays", "ccToPtoDays", "timeToCcDays", "timeToDaDays",
  "timeToPtoDays", "timeToRtbDays", "rtbToCcDays", "daToCcDays", "daToPermitDays",
]);

// --- Fields to skip (Prisma relations, raw JSON blob) ---
const SKIP_FIELDS = new Set(["syncLogs", "rawProperties"]);

/**
 * Convert a Prisma Deal to a client-safe SerializedDeal.
 * All Dates → ISO strings, all Decimals → numbers, departmentLeads → parsed.
 */
export function serializeDeal(deal: PrismaDeal): SerializedDeal {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(deal)) {
    if (SKIP_FIELDS.has(key)) continue;

    if (key === "departmentLeads") {
      result[key] = parseDepartmentLeads(value);
    } else if (DATE_FIELDS.has(key)) {
      result[key] = dateToIso(value);
    } else if (DECIMAL_FIELDS.has(key)) {
      result[key] = decimalToNumber(value);
    } else {
      result[key] = value;
    }
  }

  return result as SerializedDeal;
}

// --- Project pipeline: abstract 9-node flow ---
const PROJECT_ABSTRACT_STAGES: { label: string; dateField: string | null; stageMatch: string }[] = [
  { label: "Survey",      dateField: "siteSurveyCompletionDate", stageMatch: "survey" },
  { label: "Design",      dateField: "designCompletionDate",     stageMatch: "design" },
  { label: "Permitting",  dateField: "permitIssueDate",          stageMatch: "permitting" },
  { label: "IC",          dateField: "icApprovalDate",           stageMatch: "interconnection" },
  { label: "RTB",         dateField: "rtbDate",                  stageMatch: "ready to build" },
  { label: "Construction",dateField: "constructionCompleteDate", stageMatch: "construction" },
  { label: "Inspection",  dateField: "inspectionPassDate",       stageMatch: "inspection" },
  { label: "PTO",         dateField: "ptoCompletionDate",        stageMatch: "permission to operate" },
  { label: "Complete",    dateField: null,                       stageMatch: "complete" },
];

/**
 * Build the milestone timeline stages — pipeline-aware.
 *
 * - PROJECT: Uses abstract 9-node flow (separate Permitting + IC).
 *   Current stage matched by substring against deal.stage.
 * - SALES: If >10 raw stages, collapses to single current-stage indicator.
 * - Others (D&R, Service, Roofing): Uses raw DealPipelineConfig stage order.
 */
export function buildTimelineStages(
  pipeline: string,
  stageOrder: string[],
  deal: SerializedDeal,
): TimelineStage[] {
  // --- PROJECT: abstract 9-node flow ---
  if (pipeline === "PROJECT") {
    const dealStageLower = (deal.stage ?? "").toLowerCase();
    return PROJECT_ABSTRACT_STAGES.map((s) => ({
      key: s.label.toLowerCase().replace(/\s+/g, "-"),
      label: s.label,
      completedDate: s.dateField
        ? (deal[s.dateField] as string | null) ?? null
        : null,
      isCurrent: dealStageLower.includes(s.stageMatch),
    }));
  }

  // --- SALES: abbreviate if >10 stages ---
  if (pipeline === "SALES" && stageOrder.length > 10) {
    return [{
      key: deal.stage?.toLowerCase().replace(/\s+/g, "-") ?? "unknown",
      label: deal.stage ?? "Unknown",
      completedDate: null,
      isCurrent: true,
    }];
  }

  // --- Default: raw DealPipelineConfig stage order ---
  return stageOrder.map((stageName) => ({
    key: stageName.toLowerCase().replace(/\s+/g, "-"),
    label: stageName,
    completedDate: null,
    isCurrent: deal.stage === stageName,
  }));
}
