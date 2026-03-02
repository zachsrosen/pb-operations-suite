// Shared project transformation utilities
// Extracted from at-risk, executive, locations, timeline pages
// which all had nearly identical transformProject() functions

import { RawProject, TransformedProject } from "./types";
import type { BaselineTable, ForecastSet } from "./forecasting";
import { computeProjectForecasts, MILESTONE_CHAIN } from "./forecasting";
import type { Project } from "./hubspot";

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** @deprecated Use forecasting engine instead. Kept for backwards compatibility. */
export const FORECAST_OFFSETS = {
  install: 90,
  inspection: 120,
  pto: 150,
} as const;

/**
 * Transform a raw HubSpot project into a normalized format
 * with computed forecast dates and day-delta calculations.
 *
 * When a baselineTable is provided, uses the QC-data-driven forecasting
 * engine. Otherwise falls back to static FORECAST_OFFSETS.
 */
export function transformProject(
  p: RawProject,
  baselineTable?: BaselineTable | null,
): TransformedProject {
  const now = new Date();
  const closeDate = p.closeDate ? new Date(p.closeDate + "T12:00:00") : null;
  const daysSinceClose = closeDate
    ? Math.floor((now.getTime() - closeDate.getTime()) / MS_PER_DAY)
    : 0;

  let forecastInstall: string | null = null;
  let forecastInspection: string | null = null;
  let forecastPto: string | null = null;
  let forecastData: TransformedProject["forecast"] = null;

  if (baselineTable && Object.keys(baselineTable).length > 0) {
    // Use the forecasting engine
    // Build a Project-like shape from RawProject for the engine
    const projectLike = rawToProjectLike(p);
    const { original, live } = computeProjectForecasts(projectLike, baselineTable);

    forecastData = { original, live };

    // Backwards compat: populate old fields from live forecast
    forecastInstall = live.install?.date ?? null;
    forecastInspection = live.inspection?.date ?? null;
    forecastPto = live.pto?.date ?? null;
  } else {
    // Legacy fallback: static offsets
    forecastInstall =
      p.forecastedInstallDate ||
      p.constructionScheduleDate ||
      (closeDate
        ? new Date(closeDate.getTime() + FORECAST_OFFSETS.install * MS_PER_DAY)
            .toISOString()
            .split("T")[0]
        : null);

    forecastInspection =
      p.forecastedInspectionDate ||
      (closeDate
        ? new Date(
            closeDate.getTime() + FORECAST_OFFSETS.inspection * MS_PER_DAY,
          )
            .toISOString()
            .split("T")[0]
        : null);

    forecastPto =
      p.forecastedPtoDate ||
      (closeDate
        ? new Date(closeDate.getTime() + FORECAST_OFFSETS.pto * MS_PER_DAY)
            .toISOString()
            .split("T")[0]
        : null);
  }

  const daysToInstall = forecastInstall
    ? Math.floor(
        (new Date(forecastInstall).getTime() - now.getTime()) / MS_PER_DAY,
      )
    : null;

  const daysToInspection = forecastInspection
    ? Math.floor(
        (new Date(forecastInspection).getTime() - now.getTime()) / MS_PER_DAY,
      )
    : null;

  const daysToPto = forecastPto
    ? Math.floor(
        (new Date(forecastPto).getTime() - now.getTime()) / MS_PER_DAY,
      )
    : null;

  return {
    id: p.id,
    name: p.name,
    pb_location: p.pbLocation || "Unknown",
    ahj: p.ahj || "Unknown",
    utility: p.utility || "Unknown",
    project_type: p.projectType || "Unknown",
    stage: p.stage || "Unknown",
    amount: p.amount || 0,
    url: p.url,
    close_date: p.closeDate,
    permit_submit: p.permitSubmitDate,
    permit_issued: p.permitIssueDate,
    install_scheduled: p.constructionScheduleDate,
    construction_complete: p.constructionCompleteDate,
    inspection_scheduled: p.inspectionScheduleDate,
    inspection_pass: p.inspectionPassDate,
    pto_granted: p.ptoGrantedDate,
    forecast_install: forecastInstall,
    forecast_inspection: forecastInspection,
    forecast_pto: forecastPto,
    days_to_install: daysToInstall,
    days_to_inspection: daysToInspection,
    days_to_pto: daysToPto,
    days_since_close: daysSinceClose,
    forecast: forecastData,
  };
}

/** Calculate average of a number array, returns null if empty */
export function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

/**
 * Map RawProject fields to the Project field names expected by the
 * forecasting engine's MILESTONE_DATE_FIELD mapping.
 * Only the date fields used by the engine need to be populated.
 */
function rawToProjectLike(p: RawProject): Project {
  return {
    // Location fields (used for segment key resolution)
    pbLocation: p.pbLocation || "Unknown",
    ahj: p.ahj || "Unknown",
    utility: p.utility || "Unknown",
    // Milestone dates (used by MILESTONE_DATE_FIELD)
    closeDate: p.closeDate ?? null,
    designCompletionDate: p.designCompletionDate ?? null,
    permitSubmitDate: p.permitSubmitDate ?? null,
    permitIssueDate: p.permitIssueDate ?? null,
    interconnectionSubmitDate: p.interconnectionSubmitDate ?? null,
    interconnectionApprovalDate: p.interconnectionApprovalDate ?? null,
    readyToBuildDate: p.readyToBuildDate ?? null,
    constructionCompleteDate: p.constructionCompleteDate ?? null,
    inspectionPassDate: p.inspectionPassDate ?? null,
    ptoGrantedDate: p.ptoGrantedDate ?? null,
  } as Project;
}
