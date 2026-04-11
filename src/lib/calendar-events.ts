// src/lib/calendar-events.ts
//
// Shared calendar-event generation logic extracted from the master scheduler.
// Used by the office-performance calendar carousel slide and potentially
// by any future calendar views.

import { normalizeLocation } from "@/lib/locations";
import type { CanonicalLocation } from "@/lib/locations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event types matching the master scheduler's event taxonomy */
export type CalendarEventType =
  | "survey"
  | "survey-complete"
  | "construction"
  | "construction-complete"
  | "inspection"
  | "inspection-pass"
  | "inspection-fail"
  | "rtb"
  | "blocked"
  | "service"
  | "dnr";

/** A single calendar event positioned on a date */
export interface CalendarEvent {
  id: string;
  projectId: string;
  name: string;
  date: string;           // YYYY-MM-DD start date
  days: number;           // Duration (1 for single-day, N for multi-day construction)
  eventType: CalendarEventType;
  assignee: string;
  isCompleted: boolean;
  isOverdue: boolean;
  isFailed: boolean;
  amount: number;
}

/**
 * A CalendarEvent expanded into per-day pills for rendering.
 * Multi-day events become multiple DayPill entries (one per day).
 */
export interface DayPill extends CalendarEvent {
  /** 1-indexed day within the multi-day span (e.g., 1 for D1/3) */
  dayIndex: number;
  /** Total days in the span (e.g., 3 for D1/3) */
  totalDays: number;
  /** True for day 1 (shows full info), false for continuation pills */
  isFirstDay: boolean;
}

/** Minimal project shape for event generation (clean, testable interface) */
export interface CalendarProject {
  id: string;
  name: string;
  location: string;
  amount: number;
  stage: string;
  crew: string | null;
  daysInstall: number;
  scheduleDate: string | null;
  constructionScheduleDate: string | null;
  inspectionScheduleDate: string | null;
  surveyScheduleDate: string | null;
  surveyCompleted: string | null;
  constructionCompleted: string | null;
  inspectionCompleted: string | null;
  inspectionStatus: string | null;
  zuperScheduledStart?: string | null;
  zuperScheduledEnd?: string | null;
  zuperJobCategory?: string | null;
}

/**
 * Shape of projects as returned by /api/projects?context=scheduling.
 * This is the `Project` type from hubspot.ts — camelCase field names.
 * Only the fields we actually use are listed here; the API returns more.
 */
export interface RawApiProject {
  id: number | string;
  name: string;
  pbLocation: string;
  amount: number;
  stage: string;
  installCrew: string;
  expectedDaysForInstall: number;
  daysForInstallers: number;
  constructionScheduleDate: string | null;
  inspectionScheduleDate: string | null;
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  constructionCompleteDate: string | null;
  inspectionPassDate: string | null;
  finalInspectionStatus: string | null;
  // Zuper-linked fields (may not be present on all projects)
  zuperScheduledStart?: string | null;
  zuperScheduledEnd?: string | null;
  zuperJobCategory?: string | null;
}

/** Map the raw API project to the clean CalendarProject interface */
export function toCalendarProject(p: RawApiProject): CalendarProject {
  // Derive scheduleDate (same logic as scheduler's transformProject)
  const stage = (p.stage || "").toLowerCase();
  let scheduleDate: string | null = null;
  if (stage.includes("survey")) {
    scheduleDate = p.siteSurveyScheduleDate || null;
  } else if (stage.includes("inspection")) {
    scheduleDate = p.inspectionScheduleDate || null;
  } else {
    scheduleDate = p.constructionScheduleDate || null;
  }

  return {
    id: String(p.id),
    name: p.name || "",
    location: p.pbLocation || "",
    amount: p.amount || 0,
    stage: p.stage || "",
    crew: p.installCrew || null,
    daysInstall: p.daysForInstallers || p.expectedDaysForInstall || 1,
    scheduleDate,
    constructionScheduleDate: p.constructionScheduleDate || null,
    inspectionScheduleDate: p.inspectionScheduleDate || null,
    surveyScheduleDate: p.siteSurveyScheduleDate || null,
    surveyCompleted: p.siteSurveyCompletionDate || null,
    constructionCompleted: p.constructionCompleteDate || null,
    inspectionCompleted: p.inspectionPassDate || null,
    inspectionStatus: p.finalInspectionStatus || null,
    zuperScheduledStart: p.zuperScheduledStart || null,
    zuperScheduledEnd: p.zuperScheduledEnd || null,
    zuperJobCategory: p.zuperJobCategory || null,
  };
}

/** Zuper job shape from /api/zuper/jobs/by-category response */
export interface ZuperCategoryJob {
  jobUid: string;
  title: string;
  categoryName: string;
  categoryUid: string;
  statusName: string;
  statusColor: string;
  dueDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  customerName: string;
  address: string;
  city: string;
  state: string;
  assignedUser: string;
  assignedUsers?: string[];
  teamName: string;
  hubspotDealId: string;
  jobTotal: number;
  createdAt: string;
  workOrderNumber: string;
}

// ---------------------------------------------------------------------------
// Color constants (matching master scheduler exactly)
// ---------------------------------------------------------------------------

export const EVENT_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  survey:                  { border: "border-l-cyan-500",    bg: "bg-cyan-500/15",    text: "text-cyan-300" },
  "survey-complete":       { border: "border-l-cyan-500",    bg: "bg-cyan-500/15",    text: "text-cyan-300" },
  construction:            { border: "border-l-blue-500",    bg: "bg-blue-500/15",    text: "text-blue-300" },
  "construction-complete": { border: "border-l-blue-500",    bg: "bg-blue-500/15",    text: "text-blue-300" },
  inspection:              { border: "border-l-violet-500",  bg: "bg-violet-500/15",  text: "text-violet-300" },
  "inspection-pass":       { border: "border-l-violet-500",  bg: "bg-violet-500/15",  text: "text-violet-300" },
  "inspection-fail":       { border: "border-l-amber-500",   bg: "bg-amber-900/70",   text: "text-amber-200" },
  rtb:                     { border: "border-l-emerald-500", bg: "bg-emerald-500/15", text: "text-emerald-300" },
  blocked:                 { border: "border-l-yellow-500",  bg: "bg-yellow-500/15",  text: "text-yellow-300" },
  service:                 { border: "border-l-purple-500",  bg: "bg-purple-500/15",  text: "text-purple-300" },
  dnr:                     { border: "border-l-amber-500",   bg: "bg-amber-500/15",   text: "text-amber-300" },
};

/** Legend items for the bottom of the calendar slide */
export const LEGEND_ITEMS: { label: string; dotColor: string }[] = [
  { label: "Survey",     dotColor: "bg-cyan-500" },
  { label: "Install",    dotColor: "bg-blue-500" },
  { label: "Inspection", dotColor: "bg-violet-500" },
  { label: "RTB",        dotColor: "bg-emerald-500" },
  { label: "Blocked",    dotColor: "bg-yellow-500" },
  { label: "Service",    dotColor: "bg-purple-500" },
  { label: "D&R",        dotColor: "bg-amber-500" },
];

/** Zuper category UIDs — same constants as master scheduler (scheduler/page.tsx:267-276) */
export const SERVICE_CATEGORY_UIDS = [
  "cff6f839-c043-46ee-a09f-8d0e9f363437", // Service Visit
  "8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de", // Service Revisit
].join(",");

export const DNR_CATEGORY_UIDS = [
  "d9d888a1-efc3-4f01-a8d6-c9e867374d71", // Detach
  "43df49e9-3835-48f2-80ca-cc77ad7c3f0d", // Reset
  "a5e54b76-8b79-4cd7-a960-bad53d24e1c5", // D&R Inspection
].join(",");

// ---------------------------------------------------------------------------
// Public API (stubs — implemented in subsequent tasks)
// ---------------------------------------------------------------------------

export function getCustomerName(fullName: string): string {
  return fullName.split(" | ")[1] || fullName;
}

export function formatAssignee(
  assigneeName: string | null | undefined
): string {
  if (!assigneeName) return "";
  const trimmed = assigneeName.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function isOverdue(
  dateStr: string,
  days: number,
  isCompleted: boolean,
  isConstruction: boolean,
  today?: Date
): boolean {
  if (isCompleted) return false;
  const todayMidnight = today ? new Date(today) : new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  // Parse YYYY-MM-DD to local midnight
  const [y, m, d] = dateStr.split("-").map(Number);
  const schedMidnight = new Date(y, m - 1, d);
  schedMidnight.setHours(0, 0, 0, 0);

  if (isConstruction) {
    const endDate = new Date(schedMidnight);
    endDate.setDate(schedMidnight.getDate() + Math.ceil(days));
    return endDate < todayMidnight;
  }
  return schedMidnight < todayMidnight;
}

export function generateProjectEvents(
  projects: CalendarProject[],
  location: CanonicalLocation
): CalendarEvent[] {
  throw new Error("not implemented");
}

export function generateZuperEvents(
  jobs: ZuperCategoryJob[],
  eventType: "service" | "dnr",
  location: CanonicalLocation
): CalendarEvent[] {
  throw new Error("not implemented");
}

export function expandToDayPills(
  events: CalendarEvent[],
  year: number,
  month: number
): Map<string, DayPill[]> {
  throw new Error("not implemented");
}
