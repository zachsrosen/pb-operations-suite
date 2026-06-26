/**
 * Pure normalization helpers for scheduler-v2.
 * These are intentionally side-effect-free so they can be called from
 * server components, API routes, and unit tests without environment setup.
 */

import { isWeekendDateYmd } from "@/lib/scheduling-utils";

/* ------------------------------------------------------------------ */
/*  Stage mapping                                                      */
/* ------------------------------------------------------------------ */

const STAGE_MAP: Record<string, string> = {
  "Site Survey": "survey",
  "Ready To Build": "rtb",
  "RTB - Blocked": "blocked",
  Construction: "construction",
  Inspection: "inspection",
};

/**
 * Maps a raw HubSpot stage string to a normalized scheduler-v2 stage slug.
 * Mirrors mapStage() in scheduler/page.tsx.
 *
 * Returns "other" for unknown or empty values.
 */
export function mapStage(stageRaw?: string | null): string {
  const stage = (stageRaw || "").trim();
  if (!stage) return "other";

  const direct = STAGE_MAP[stage];
  if (direct) return direct;

  const normalized = stage.toLowerCase();
  if (normalized === "site survey" || normalized === "survey") return "survey";
  if (normalized === "ready to build" || normalized === "rtb") return "rtb";
  if (normalized === "rtb - blocked" || normalized === "blocked") return "blocked";
  if (normalized === "construction") return "construction";
  if (normalized === "inspection") return "inspection";

  return "other";
}

/* ------------------------------------------------------------------ */
/*  Name / ID parsing                                                  */
/* ------------------------------------------------------------------ */

/**
 * Extracts the customer name from a HubSpot deal name of the form:
 *   "PROJ-XXXX | Customer Name | Address"
 *
 * Returns the second pipe-delimited segment, or the full string if there
 * are no pipes. Mirrors getCustomerName() in scheduler/page.tsx.
 */
export function getCustomerName(fullName: string): string {
  return fullName.split(" | ")[1] ?? fullName;
}

/**
 * Extracts the project number (first segment) from a pipe-delimited deal name.
 * Mirrors getProjectId() in scheduler/page.tsx.
 */
export function getProjectId(fullName: string): string {
  return fullName.split(" | ")[0];
}

/* ------------------------------------------------------------------ */
/*  Overdue detection                                                  */
/* ------------------------------------------------------------------ */

/** Statuses that can never be overdue regardless of dates. */
const NON_OVERDUE_STATUSES = new Set(["done", "cancelled", "failed", "completed"]);

/**
 * Returns true when a work item is past its expected completion window.
 *
 * Rules mirror the v1 overdue logic in scheduler/page.tsx (~line 1849):
 *
 *   Construction (isSingleDay=false):
 *     End date = start + ceil(durationDays) business days.
 *     Overdue the day AFTER the end date (endDate < today, strict).
 *     e.g. 3-day install starting Mon → end Wed → overdue Thu.
 *
 *   Surveys / Inspections (isSingleDay=true):
 *     Overdue if the scheduled date is strictly before today.
 *     e.g. inspection on Mon → overdue on Tue.
 *
 * @param scheduledStart  YYYY-MM-DD start date (or null/undefined = not overdue)
 * @param durationDays    Duration in business days
 * @param status          Current work item status string
 * @param isSingleDay     True for survey/inspection; false for multi-day construction installs
 * @param today           YYYY-MM-DD string for "today" (injectable for tests; defaults to real now)
 */
export function isOverdue(
  scheduledStart: string | null | undefined,
  durationDays: number,
  status: string,
  isSingleDay: boolean,
  today?: string
): boolean {
  if (!scheduledStart) return false;
  if (NON_OVERDUE_STATUSES.has(status)) return false;

  const todayStr = today ?? todayDateStr();

  if (isSingleDay) {
    // Overdue if scheduled date is strictly before today
    return scheduledStart < todayStr;
  }

  // Construction: end date = start + ceil(durationDays) CALENDAR days.
  // Mirrors v1 isOverdueCheck() in scheduler/page.tsx:
  //   endDate.setDate(schedMidnight.getDate() + Math.ceil(days))
  // Overdue the day AFTER the end date (endDate < today, strict).
  const days = Math.ceil(durationDays);
  const endDate = addCalendarDaysYmd(scheduledStart, days);
  return endDate < todayStr;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Add calendar days to a YYYY-MM-DD string.
 * Mirrors the v1 approach: new Date(ymd); setDate(date + days); reformat.
 */
function addCalendarDaysYmd(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Re-export scheduling-utils helper that callers may want alongside normalize
export { isWeekendDateYmd };
