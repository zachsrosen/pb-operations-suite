// Shared project transformation utilities
// Extracted from at-risk, executive, locations, timeline pages
// which all had nearly identical transformProject() functions

import { RawProject, TransformedProject } from "./types";

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Milestone forecast offsets from close date (in days).
 * Must match the server-side defaults in hubspot.ts transformDealToProject. */
export const FORECAST_OFFSETS = {
  install: 90,
  inspection: 120,
  pto: 150,
} as const;

/**
 * Transform a raw HubSpot project into a normalized format
 * with computed forecast dates and day-delta calculations.
 */
export function transformProject(p: RawProject): TransformedProject {
  const now = new Date();
  const closeDate = p.closeDate ? new Date(p.closeDate) : null;
  const daysSinceClose = closeDate
    ? Math.floor((now.getTime() - closeDate.getTime()) / MS_PER_DAY)
    : 0;

  const forecastInstall =
    p.forecastedInstallDate ||
    p.constructionScheduleDate ||
    (closeDate
      ? new Date(closeDate.getTime() + FORECAST_OFFSETS.install * MS_PER_DAY)
          .toISOString()
          .split("T")[0]
      : null);

  const forecastInspection =
    p.forecastedInspectionDate ||
    (closeDate
      ? new Date(
          closeDate.getTime() + FORECAST_OFFSETS.inspection * MS_PER_DAY
        )
          .toISOString()
          .split("T")[0]
      : null);

  const forecastPto =
    p.forecastedPtoDate ||
    (closeDate
      ? new Date(closeDate.getTime() + FORECAST_OFFSETS.pto * MS_PER_DAY)
          .toISOString()
          .split("T")[0]
      : null);

  const daysToInstall = forecastInstall
    ? Math.floor(
        (new Date(forecastInstall).getTime() - now.getTime()) / MS_PER_DAY
      )
    : null;

  const daysToInspection = forecastInspection
    ? Math.floor(
        (new Date(forecastInspection).getTime() - now.getTime()) / MS_PER_DAY
      )
    : null;

  const daysToPto = forecastPto
    ? Math.floor(
        (new Date(forecastPto).getTime() - now.getTime()) / MS_PER_DAY
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
  };
}

/** Calculate average of a number array, returns null if empty */
export function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}
