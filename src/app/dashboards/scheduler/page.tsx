"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/contexts/ToastContext";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { LOCATION_TIMEZONES } from "@/lib/constants";
import { formatCurrency, formatDateShort, formatShortDate } from "@/lib/format";
import { extractInstallerNote } from "@/lib/schedule-notes";
import { generateOptimizedSchedule, type OptimizableProject, type ScoringPreset, type ExistingBooking, DEFAULT_LOCATION_CAPACITY } from "@/lib/schedule-optimizer";
import {
  addBusinessDaysYmd,
  addDaysYmd,
  countBusinessDaysInclusive,
  getBusinessDatesInSpan as getBusinessDatesInSpanShared,
  getConstructionSpanDaysFromZuper,
  isWeekendDateYmd,
  normalizeZuperBoundaryDates as normalizeZuperBoundaryDatesShared,
  toDateStr,
} from "@/lib/scheduling-utils";
import { normalizeLocation as normalizeLocationAlias } from "@/lib/locations";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RawProject {
  id: string | number;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  pbLocation?: string;
  amount?: number;
  projectType?: string;
  stage: string;
  url?: string;
  siteSurveyScheduleDate?: string;
  siteSurveyCompletionDate?: string;
  inspectionScheduleDate?: string;
  inspectionPassDate?: string;
  finalInspectionStatus?: string;
  constructionScheduleDate?: string;
  constructionCompleteDate?: string;
  daysForInstallers?: number;
  daysForElectricians?: number;
  expectedDaysForInstall?: number;
  roofersCount?: number;
  electriciansCount?: number;
  installDifficulty?: number;
  installNotes?: string;
  daysToInstall?: number | null;
  ahj?: string;
  utility?: string;
  isParticipateEnergy?: boolean;
  equipment?: {
    systemSizeKwdc?: number;
    modules?: { count?: number; brand?: string; model?: string; wattage?: number };
    inverter?: { count?: number; brand?: string; model?: string; sizeKwac?: number };
    battery?: { count?: number; expansionCount?: number; brand?: string; sizeKwh?: number };
    evCount?: number;
  };
}

interface SchedulerProject {
  id: string;
  name: string;
  address: string;
  location: string;
  amount: number;
  type: string;
  stage: string;
  systemSize: number;
  moduleCount: number;
  inverterCount: number;
  batteries: number;
  batteryExpansion: number;
  batteryModel: string | null;
  evCount: number;
  moduleBrand: string;
  moduleModel: string;
  moduleWattage: number;
  inverterBrand: string;
  inverterModel: string;
  inverterSizeKwac: number;
  batterySizeKwh: number;
  ahj: string;
  utility: string;
  crew: string | null;
  daysInstall: number;
  daysElec: number;
  totalDays: number;
  roofersCount: number;
  electriciansCount: number;
  difficulty: number;
  installNotes: string;
  roofType: string | null;
  scheduleDate: string | null;
  // Additional schedule dates for generating multi-milestone calendar events
  constructionScheduleDate: string | null;
  inspectionScheduleDate: string | null;
  surveyScheduleDate: string | null;
  surveyCompleted: string | null;
  constructionCompleted: string | null;
  inspectionCompleted: string | null;
  inspectionStatus: string | null; // "Pass", "Fail", etc.
  hubspotUrl: string;
  isPE: boolean;
  zuperJobUid?: string;
  zuperJobStatus?: string;
  zuperScheduledDays?: number;
  zuperScheduledStart?: string; // ISO date from Zuper
  zuperScheduledEnd?: string;   // ISO date from Zuper
  zuperJobCategory?: string;    // Which Zuper category matched: "survey" | "construction" | "inspection"
  zuperAssignedTo?: string[];    // Zuper assigned user names (directors/technicians)
  daysToInstall: number | null;
  isCompletedPastStage: boolean; // Project moved past its stage (e.g. Close Out with inspection data) — calendar only, not sidebar
}

interface CrewConfig {
  name: string;
  roofers: number;
  electricians: number;
  color: string;
}

interface ZuperAssignee {
  name: string;
  userUid: string;
  teamUid: string;
}

interface ManualSchedule {
  startDate: string;
  days: number;
  crew: string;
  isTentative?: boolean;
  recordId?: string;
  scheduleType?: string;
  fromOptimizer?: boolean;
  tentativeNotes?: string;
}

interface ScheduledEvent extends SchedulerProject {
  date: string;
  eventType: string;
  days: number;
  isCompleted?: boolean;
  isOverdue?: boolean;
  isInspectionFailed?: boolean;
  isTentative?: boolean;
  tentativeRecordId?: string;
  isForecast?: boolean;
}

interface OverlayEvent {
  id: string;
  name: string;
  date: string;
  days: number;
  amount: number;
  crew: string;
  address: string;
  location: string;
  eventType: "service" | "dnr";
  eventSubtype: string;
  isOverlay: true;
  isOverdue: false;
  isForecast: false;
  isTentative: false;
  status: string;
  scheduledTime: string | null;
}

type DisplayEvent = ScheduledEvent | OverlayEvent;

function isOverlayEvent(e: DisplayEvent): e is OverlayEvent {
  return "isOverlay" in e && e.isOverlay === true;
}

interface ZuperCategoryJob {
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
  teamName: string;
  hubspotDealId: string;
  jobTotal: number;
  createdAt: string;
  workOrderNumber: string;
}

interface PendingSchedule {
  project: SchedulerProject;
  date: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CREWS: Record<string, CrewConfig[]> = {
  Westminster: [
    { name: "WESTY Alpha", roofers: 2, electricians: 1, color: "#3b82f6" },
    { name: "WESTY Bravo", roofers: 2, electricians: 1, color: "#10b981" },
  ],
  Centennial: [
    { name: "DTC Alpha", roofers: 2, electricians: 1, color: "#8b5cf6" },
    { name: "DTC Bravo", roofers: 2, electricians: 1, color: "#ec4899" },
  ],
  "Colorado Springs": [
    { name: "COSP Alpha", roofers: 3, electricians: 1, color: "#f97316" },
  ],
  "San Luis Obispo": [
    { name: "SLO Solar", roofers: 2, electricians: 1, color: "#06b6d4" },
    { name: "SLO Electrical 1", roofers: 0, electricians: 2, color: "#a855f7" },
    { name: "SLO Electrical 2", roofers: 0, electricians: 2, color: "#14b8a6" },
  ],
  Camarillo: [
    { name: "CAM Crew", roofers: 2, electricians: 1, color: "#f43f5e" },
  ],
};

// Pre-computed set of all valid crew names for crew resolution
const ALL_CREW_NAMES = new Set(
  Object.values(CREWS).flat().map((c) => c.name)
);

const LOCATIONS = [
  "All",
  "Westminster",
  "Centennial",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
];

const LOCATION_COLORS: Record<string, string> = {
  Westminster: "#3b82f6",
  Centennial: "#8b5cf6",
  "Colorado Springs": "#f97316",
  "San Luis Obispo": "#06b6d4",
  Camarillo: "#f43f5e",
};

const SERVICE_CATEGORY_UIDS = [
  "cff6f839-c043-46ee-a09f-8d0e9f363437", // Service Visit
  "8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de", // Service Revisit
].join(",");

const DNR_CATEGORY_UIDS = [
  "d9d888a1-efc3-4f01-a8d6-c9e867374d71", // Detach
  "43df49e9-3835-48f2-80ca-cc77ad7c3f0d", // Reset
  "a5e54b76-8b79-4cd7-a960-bad53d24e1c5", // D&R Inspection
].join(",");

/* ---- Zuper default assignees per location (for auto-assignment when scheduling) ---- */
// Construction default assignee per location (same defaults as construction scheduler).
const ZUPER_CONSTRUCTION_DIRECTORS: Record<string, ZuperAssignee> = {
  Westminster: { name: "Joe Lynch", userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
  Centennial: { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  DTC: { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  "Colorado Springs": { name: "Rolando", userUid: "a89ed2f5-222b-4b09-8bb0-14dc45c2a51b", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
  "San Luis Obispo": { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  Camarillo: { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" }, // Camarillo shares SLO install crew
};

// Survey: available surveyors per location (first entry is the default)
// userUid can be empty string — the schedule API will resolve by name at runtime
const ZUPER_SURVEY_USERS: Record<string, { name: string; userUid: string; teamUid: string }[]> = {
  Westminster: [
    { name: "Joe Lynch", userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
    { name: "Ryszard Szymanski", userUid: "e043bf1d-006b-4033-a46e-3b5d06ed3d00", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
  ],
  Centennial: [
    { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  DTC: [
    { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  "Colorado Springs": [
    { name: "Rolando", userUid: "a89ed2f5-222b-4b09-8bb0-14dc45c2a51b", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
  ],
  "San Luis Obispo": [
    { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  ],
  Camarillo: [
    { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" }, // shares SLO crew
  ],
};

// Inspection: available inspectors per location (first entry is the default)
// userUid can be empty string — the schedule API will resolve by name at runtime
const ZUPER_INSPECTION_USERS: Record<string, { name: string; userUid: string; teamUid: string }[]> = {
  Westminster: [
    { name: "Daniel Kelly", userUid: "f0a5aca8-0137-478c-a910-1380b9a31a79", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
    { name: "Chad Schollman", userUid: "", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
  ],
  Centennial: [
    { name: "Daniel Kelly", userUid: "f0a5aca8-0137-478c-a910-1380b9a31a79", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  DTC: [
    { name: "Daniel Kelly", userUid: "f0a5aca8-0137-478c-a910-1380b9a31a79", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  "Colorado Springs": [
    { name: "Rolando", userUid: "a89ed2f5-222b-4b09-8bb0-14dc45c2a51b", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
    { name: "Alexander Swope", userUid: "", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
  ],
  "San Luis Obispo": [
    { name: "Anthony Villanueva", userUid: "", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  ],
};

// Construction assignee choices in the master scheduler modal.
// Starts with each location's construction director, then adds known survey/inspection users.
const ZUPER_CONSTRUCTION_USERS: Record<string, ZuperAssignee[]> = Object.fromEntries(
  Object.keys(ZUPER_CONSTRUCTION_DIRECTORS).map((location) => {
    const locationTeamUid = ZUPER_CONSTRUCTION_DIRECTORS[location]?.teamUid;
    const merged = [
      ZUPER_CONSTRUCTION_DIRECTORS[location],
      ...(ZUPER_SURVEY_USERS[location] || []),
      ...(ZUPER_INSPECTION_USERS[location] || []),
    ].filter((assignee) => !!assignee.userUid && assignee.teamUid === locationTeamUid);
    const seen = new Set<string>();
    const deduped = merged.filter((assignee) => {
      const key = `${assignee.userUid || ""}|${assignee.name.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [location, deduped];
  })
) as Record<string, ZuperAssignee[]>;

function dedupeAssignees(assignees: ZuperAssignee[]): ZuperAssignee[] {
  const seen = new Set<string>();
  return assignees.filter((assignee) => {
    const key = `${assignee.userUid}|${assignee.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Location → IANA timezone (imported from shared constants)

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"]; // Weekdays only

const STAGE_MAP: Record<string, string> = {
  "Site Survey": "survey",
  "Ready To Build": "rtb",
  "RTB - Blocked": "blocked",
  Construction: "construction",
  Inspection: "inspection",
};

function mapStage(stageRaw?: string | null): string {
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

const STAGE_ICONS: Record<string, string> = {
  survey: "Survey",
  rtb: "RTB",
  blocked: "Blocked",
  construction: "Construction",
  inspection: "Inspection",
};

const STAGE_BORDER_COLORS: Record<string, string> = {
  survey: "border-l-cyan-500",
  rtb: "border-l-emerald-500",
  blocked: "border-l-yellow-500",
  construction: "border-l-blue-500",
  inspection: "border-l-violet-500",
};

const STAGE_TEXT_COLORS: Record<string, string> = {
  survey: "text-cyan-400",
  rtb: "text-emerald-400",
  blocked: "text-yellow-400",
  construction: "text-blue-400",
  inspection: "text-violet-400",
};

const STAGE_TAB_ACTIVE: Record<string, string> = {
  all: "border-orange-500 text-orange-400 bg-orange-500/10",
  survey: "border-cyan-500 text-cyan-400 bg-cyan-500/10",
  rtb: "border-emerald-500 text-emerald-400 bg-emerald-500/10",
  blocked: "border-yellow-500 text-yellow-400 bg-yellow-500/10",
  construction: "border-blue-500 text-blue-400 bg-blue-500/10",
  inspection: "border-violet-500 text-violet-400 bg-violet-500/10",
};

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                    */
/* ------------------------------------------------------------------ */

// Format revenue without $ sign for display contexts that add their own
function formatRevenueCompact(amount: number): string {
  if (amount >= 1_000_000) return (amount / 1_000_000).toFixed(1) + "M";
  return (amount / 1000).toFixed(0) + "K";
}

function getCustomerName(fullName: string): string {
  return fullName.split(" | ")[1] || fullName;
}

function getProjectId(fullName: string): string {
  return fullName.split(" | ")[0];
}

function isWeekend(dateStr: string): boolean {
  return isWeekendDateYmd(dateStr);
}

function addDays(dateStr: string, days: number): string {
  return addDaysYmd(dateStr, days);
}

function normalizeZuperBoundaryDates(
  startIso?: string | null,
  endIso?: string | null,
  location?: string | null
): { startDate?: string; endDate?: string } {
  return normalizeZuperBoundaryDatesShared({
    startIso,
    endIso,
    timezone: LOCATION_TIMEZONES[location || ""] || "America/Denver",
  });
}

function getNextWorkday(dateStr: string): string {
  return addBusinessDaysYmd(dateStr, 0);
}

function getBusinessDatesInSpan(startDate: string, totalDays: number): string[] {
  return getBusinessDatesInSpanShared(startDate, totalDays);
}

function hasBlockedDateConflict(blockedDates: Set<string> | undefined, startDate: string, totalDays: number): boolean {
  if (!blockedDates || blockedDates.size === 0) return false;
  const spanDates = getBusinessDatesInSpan(startDate, totalDays);
  return spanDates.some((date) => blockedDates.has(date));
}

function normalizeLocation(location?: string | null): string {
  const value = (location || "").trim();
  if (!value) return "Unknown";
  if (value === "DTC") return "Centennial";
  return value;
}

function mapZuperJobsToOverlays(
  jobs: ZuperCategoryJob[],
  eventType: "service" | "dnr"
): OverlayEvent[] {
  return jobs
    .map((j): OverlayEvent | null => {
      const dateStr = j.scheduledStart
        ? j.scheduledStart.slice(0, 10)
        : j.dueDate
          ? j.dueDate.slice(0, 10)
          : null;
      if (!dateStr) return null;

      let days = 1;
      if (j.scheduledStart && j.scheduledEnd) {
        const startYmd = j.scheduledStart.slice(0, 10);
        const endYmd = j.scheduledEnd.slice(0, 10);
        if (endYmd > startYmd) {
          days = countBusinessDaysInclusive(startYmd, endYmd);
        }
      }

      const loc = normalizeLocationAlias(j.teamName) || normalizeLocationAlias(j.city) || "Unknown";

      return {
        id: j.jobUid,
        name: j.title || j.customerName || "Untitled",
        date: dateStr,
        days,
        amount: 0,
        crew: j.assignedUser || "",
        address: j.address || "",
        location: loc,
        eventType,
        eventSubtype: j.categoryName,
        isOverlay: true,
        isOverdue: false,
        isForecast: false,
        isTentative: false,
        status: j.statusName || "",
        scheduledTime: j.scheduledStart && j.scheduledEnd
          ? `${new Date(j.scheduledStart).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} – ${new Date(j.scheduledEnd).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
          : j.scheduledStart
            ? new Date(j.scheduledStart).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
            : null,
      };
    })
    .filter((e): e is OverlayEvent => e !== null);
}

function getOverlayColorClass(e: DisplayEvent): string | null {
  if (!isOverlayEvent(e)) return null;
  return e.eventType === "service"
    ? "bg-purple-500/20 text-purple-300 border border-dashed border-purple-400"
    : "bg-amber-500/20 text-amber-300 border border-dashed border-amber-400";
}

function getOverlayBadge(e: DisplayEvent): string | null {
  if (!isOverlayEvent(e)) return null;
  return e.eventType === "service" ? "SVC" : "D&R";
}

/* ------------------------------------------------------------------ */
/*  Transform API data                                                 */
/* ------------------------------------------------------------------ */

function transformProject(p: RawProject): SchedulerProject | null {
  const stage = mapStage(p.stage);
  const isSchedulable =
    stage === "survey" ||
    stage === "rtb" ||
    stage === "blocked" ||
    stage === "construction" ||
    stage === "inspection";

  // Also include projects that have moved past construction/inspection but had schedule dates
  // (these are completed projects that should still show on the calendar)
  const isCompletedWithSchedule =
    !isSchedulable &&
    ((p.constructionScheduleDate && p.constructionCompleteDate) ||
      (p.inspectionScheduleDate && p.inspectionPassDate));

  if (!isSchedulable && !isCompletedWithSchedule) return null;

  // For completed projects that moved past mapped stages, determine their effective stage
  const effectiveStage = isSchedulable
    ? stage
    : p.inspectionPassDate
      ? "inspection"
      : "construction";

  let scheduleDate: string | null = null;
  if (effectiveStage === "survey") {
    scheduleDate = p.siteSurveyScheduleDate || null;
  } else if (effectiveStage === "inspection") {
    scheduleDate = p.inspectionScheduleDate || null;
  } else {
    scheduleDate = p.constructionScheduleDate || null;
  }

  const loc = normalizeLocation(p.pbLocation);
  const isBuildStage =
    effectiveStage === "rtb" || effectiveStage === "blocked" || effectiveStage === "construction";

  return {
    id: String(p.id),
    name: p.name || `Project ${p.id}`,
    address: [p.address, p.city, p.state].filter(Boolean).join(", ") || "Address TBD",
    location: loc,
    amount: p.amount || 0,
    type: p.projectType || "Solar",
    stage: effectiveStage,
    systemSize: p.equipment?.systemSizeKwdc || 0,
    moduleCount: p.equipment?.modules?.count || 0,
    inverterCount: p.equipment?.inverter?.count || 0,
    batteries: p.equipment?.battery?.count || 0,
    batteryExpansion: p.equipment?.battery?.expansionCount || 0,
    batteryModel: p.equipment?.battery?.brand || null,
    evCount: p.equipment?.evCount || 0,
    moduleBrand: p.equipment?.modules?.brand || "",
    moduleModel: p.equipment?.modules?.model || "",
    moduleWattage: p.equipment?.modules?.wattage || 0,
    inverterBrand: p.equipment?.inverter?.brand || "",
    inverterModel: p.equipment?.inverter?.model || "",
    inverterSizeKwac: p.equipment?.inverter?.sizeKwac || 0,
    batterySizeKwh: p.equipment?.battery?.sizeKwh || 0,
    ahj: p.ahj || "",
    utility: p.utility || "",
    crew: null, // No default — user must pick crew when scheduling
    daysInstall: isBuildStage
      ? p.daysForInstallers || p.expectedDaysForInstall || 2
      : stage === "survey" || stage === "inspection"
        ? 1
        : 0,
    daysElec: isBuildStage ? p.daysForElectricians || 0 : 0,
    totalDays: isBuildStage ? p.expectedDaysForInstall || 0 : 0,
    roofersCount: isBuildStage ? p.roofersCount || 0 : 0,
    electriciansCount: isBuildStage ? p.electriciansCount || 0 : 0,
    difficulty: isBuildStage ? p.installDifficulty || 3 : 0,
    installNotes: isBuildStage ? p.installNotes || "" : "",
    roofType: null,
    scheduleDate,
    constructionScheduleDate: p.constructionScheduleDate || null,
    inspectionScheduleDate: p.inspectionScheduleDate || null,
    surveyScheduleDate: p.siteSurveyScheduleDate || null,
    surveyCompleted: p.siteSurveyCompletionDate || null,
    constructionCompleted: p.constructionCompleteDate || null,
    inspectionCompleted: p.inspectionPassDate || null,
    inspectionStatus: p.finalInspectionStatus || null,
    isPE: !!p.isParticipateEnergy,
    daysToInstall: p.daysToInstall ?? null,
    isCompletedPastStage: !!isCompletedWithSchedule,
    hubspotUrl:
      p.url ||
      `https://app.hubspot.com/contacts/21710069/record/0-3/${p.id}`,
  };
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function SchedulerPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView, trackFeature } = useActivityTracking();
  const hasTrackedView = useRef(false);

  /* ---- core data ---- */
  const [projects, setProjects] = useState<SchedulerProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- view / nav ---- */
  const [currentView, setCurrentView] = useState<"calendar" | "week" | "gantt">("calendar");
  // Hydration-safe: defer Date-dependent state to client via useEffect
  const [mounted, setMounted] = useState(false);
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const todayStr = useRef("");
  useEffect(() => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    todayStr.current = now.toDateString();
    setMounted(true);
  }, []);

  /* ---- filters ---- */
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]); // For project list filtering (multi-select)
  const [calendarLocations, setCalendarLocations] = useState<string[]>([]); // Multi-select for calendar
  const [calendarScheduleTypes, setCalendarScheduleTypes] = useState<string[]>([]); // Multi-select for calendar
  const [showScheduled, setShowScheduled] = useState(true); // Toggle active/upcoming events on calendar
  const [showCompleted, setShowCompleted] = useState(true); // Toggle completed events on calendar
  const [showIncomplete, setShowIncomplete] = useState(true); // Toggle overdue events on calendar
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"amount" | "date" | "days" | "location" | "type">("amount");

  /* ---- forecast ghost toggle ---- */
  const [showForecasts, setShowForecasts] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("scheduler-show-forecasts");
    if (stored === "true") setShowForecasts(true);
  }, []);
  const toggleForecasts = useCallback(() => {
    setShowForecasts((prev) => {
      const next = !prev;
      localStorage.setItem("scheduler-show-forecasts", String(next));
      return next;
    });
  }, []);

  /* ---- service & D&R overlay toggles ---- */
  const [showService, setShowService] = useState(false);
  const [showDnr, setShowDnr] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("scheduler-show-service") === "true") setShowService(true);
    if (localStorage.getItem("scheduler-show-dnr") === "true") setShowDnr(true);
  }, []);
  const toggleService = useCallback(() => {
    setShowService((prev) => {
      const next = !prev;
      localStorage.setItem("scheduler-show-service", String(next));
      return next;
    });
  }, []);
  const toggleDnr = useCallback(() => {
    setShowDnr((prev) => {
      const next = !prev;
      localStorage.setItem("scheduler-show-dnr", String(next));
      return next;
    });
  }, []);

  /* ---- collapsible sidebar ---- */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("scheduler-sidebar-collapsed") === "true") setSidebarCollapsed(true);
  }, []);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("scheduler-sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  /* ---- selection / scheduling ---- */
  const [selectedProject, setSelectedProject] = useState<SchedulerProject | null>(null);
  const [manualSchedules, setManualSchedules] = useState<Record<string, ManualSchedule>>({});
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);

  /* ---- modals ---- */
  const [scheduleModal, setScheduleModal] = useState<PendingSchedule | null>(null);
  const [detailModal, setDetailModal] = useState<SchedulerProject | null>(null);
  const [detailModalEvent, setDetailModalEvent] = useState<ScheduledEvent | null>(null);
  const [overlayDetail, setOverlayDetail] = useState<OverlayEvent | null>(null);
  const [installDaysInput, setInstallDaysInput] = useState(2);
  const [crewSelectInput, setCrewSelectInput] = useState("");
  const [constructionAssigneeNames, setConstructionAssigneeNames] = useState<string[]>([]);
  const [installerNotesInput, setInstallerNotesInput] = useState("");
  const [tentativeConfirmNotes, setTentativeConfirmNotes] = useState("");
  const [liveConstructionAssigneesByLocation, setLiveConstructionAssigneesByLocation] = useState<
    Record<string, ZuperAssignee[]>
  >({});
  const [loadingConstructionAssignees, setLoadingConstructionAssignees] = useState(false);

  // Initialize tentative confirm notes when detail modal opens
  useEffect(() => {
    if (detailModal && manualSchedules[detailModal.id]?.isTentative) {
      const noteBlob = manualSchedules[detailModal.id]?.tentativeNotes || "";
      setTentativeConfirmNotes(extractInstallerNote(noteBlob));
    } else {
      setTentativeConfirmNotes("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailModal?.id]);

  /* ---- Availability time slots (for survey/inspection scheduling) ---- */
  interface AvailSlot {
    startTime: string;
    endTime: string;
    displayTime: string;
    userName: string;
    userUid?: string;
    teamUid?: string;
    timezone?: string;
  }
  const [availableSlots, setAvailableSlots] = useState<AvailSlot[]>([]);
  const [selectedSlotIdx, setSelectedSlotIdx] = useState(0);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // Cache the full availability response so changing surveyor doesn't re-fetch
  const [availCache, setAvailCache] = useState<{ date: string; location: string; type: string; slots: Record<string, AvailSlot[]> } | null>(null);

  /* ---- Zuper integration ---- */
  const [zuperConfigured, setZuperConfigured] = useState(false);
  const [zuperWebBaseUrl, setZuperWebBaseUrl] = useState("https://web.zuperpro.com");
  const [syncToZuper, setSyncToZuper] = useState(true);
  const [syncingToZuper, setSyncingToZuper] = useState(false);
  const [reschedulingProjectId, setReschedulingProjectId] = useState<string | null>(null);
  const [rescheduleConfirm, setRescheduleConfirm] = useState<{
    project: SchedulerProject;
    fromDate: string;
    toDate: string;
    days: number;
  } | null>(null);

  /* ---- revenue sidebar ---- */
  const [revenueSidebarOpen, setRevenueSidebarOpen] = useState(true);
  const [revenueSidebarTab, setRevenueSidebarTab] = useState<"weekly" | "monthly">("weekly");

  /* ---- toast (via ToastContext) ---- */
  const { addToast } = useToast();

  /* ---- optimizer ---- */
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizePreset, setOptimizePreset] = useState<ScoringPreset>("balanced");
  const [optimizeLocations, setOptimizeLocations] = useState<string[]>([]); // empty = all locations
  const [optimizeStartDate, setOptimizeStartDate] = useState<string>(""); // empty = default (next business day)
  const [optimizeResult, setOptimizeResult] = useState<ReturnType<typeof generateOptimizedSchedule> | null>(null);
  const [optimizeApplying, setOptimizeApplying] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState({ current: 0, total: 0, failed: 0 });
  const PRESET_DESCRIPTIONS: Record<ScoringPreset, { label: string; desc: string }> = {
    balanced: {
      label: "Balanced",
      desc: "Equal weight to revenue, PE status, and urgency",
    },
    "revenue-first": {
      label: "Revenue",
      desc: "Prioritizes highest-value projects (3x revenue weight)",
    },
    "pe-priority": {
      label: "PE Priority",
      desc: "Prioritizes Participate Energy projects (3x PE weight)",
    },
    "urgency-first": {
      label: "Urgency",
      desc: "Prioritizes overdue and near-deadline projects (3x urgency weight)",
    },
  };

  /* ================================================================ */
  /*  Data fetching                                                    */
  /* ================================================================ */

  const queryClient = useQueryClient();

  const fetchProjectsQueryFn = useCallback(async () => {
    const response = await fetch("/api/projects?context=scheduling");
    if (!response.ok) throw new Error("Failed to fetch projects");
    const data = await response.json();
    const transformed = data.projects
      .map((p: RawProject) => transformProject(p))
      .filter((p: SchedulerProject | null): p is SchedulerProject => p !== null);

    // Look up Zuper job UIDs for these projects (all job categories)
    if (transformed.length > 0) {
      try {
        const projectIds = transformed.map((p: SchedulerProject) => p.id);
        const projectNames = transformed.map((p: SchedulerProject) => p.name);

        const categories = ["survey", "construction", "inspection"];
        const lookupPromises = categories.map(category =>
          fetch("/api/zuper/jobs/lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectIds, projectNames, category }),
          })
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
        );

        const results = await Promise.all(lookupPromises);

        for (const project of transformed) {
          const stageToCategory: Record<string, string> = {
            survey: "survey",
            rtb: "construction",
            blocked: "construction",
            construction: "construction",
            inspection: "inspection",
          };
          const matchCategory = stageToCategory[project.stage] || "construction";
          const matchIndex = categories.indexOf(matchCategory);

          const zuperData = results[matchIndex];
          if (zuperData?.jobs?.[project.id]) {
            const zJob = zuperData.jobs[project.id];
            project.zuperJobUid = zJob.jobUid;
            project.zuperJobStatus = zJob.status;
            project.zuperJobCategory = categories[matchIndex];
            if (zJob.scheduledDays) project.zuperScheduledDays = zJob.scheduledDays;
            if (zJob.scheduledDate) project.zuperScheduledStart = zJob.scheduledDate;
            if (zJob.scheduledEnd) project.zuperScheduledEnd = zJob.scheduledEnd;
            if (zJob.assignedTo) project.zuperAssignedTo = Array.isArray(zJob.assignedTo) ? zJob.assignedTo : [zJob.assignedTo];
          }
        }
      } catch (zuperErr) {
        console.warn("Failed to lookup Zuper jobs:", zuperErr);
      }
    }

    // Rehydrate tentative schedules from DB
    let restoredManualSchedules: Record<string, ManualSchedule> | null = null;
    if (transformed.length > 0) {
      try {
        const ids = transformed.map((p: SchedulerProject) => p.id).join(",");
        const tentRes = await fetch(`/api/zuper/schedule-records?projectIds=${encodeURIComponent(ids)}&status=tentative`);
        if (tentRes.ok) {
          const tentData = await tentRes.json();
          const records = tentData.records as Record<string, {
            id: string; projectId: string; scheduledDate: string; assignedUser?: string;
            scheduleType?: string; scheduledDays?: number; scheduledStart?: string; scheduledEnd?: string;
            notes?: string;
          }>;
          if (records && Object.keys(records).length > 0) {
            restoredManualSchedules = {};
            for (const [projId, rec] of Object.entries(records)) {
              const proj = transformed.find((p: SchedulerProject) => p.id === projId);
              if (proj?.zuperJobStatus && proj?.zuperScheduledStart) continue;
              const isSI = proj?.stage === "survey" || proj?.stage === "inspection";
              const fallbackDays = isSI ? 1 : (proj?.daysInstall || proj?.totalDays || 2);
              // Resolve crew name: rec.assignedUser may be a director name
              // Extract crew from notes "— CREW_NAME" pattern (used by optimizer
              // and rebalancer), falling back to assignedUser.
              let rehydratedCrew = rec.assignedUser || "";
              if (rec.notes) {
                const crewMatch = rec.notes.match(/—\s*(.+)$/);
                if (crewMatch) {
                  const parsed = crewMatch[1].trim();
                  if (ALL_CREW_NAMES.has(parsed)) rehydratedCrew = parsed;
                }
              }
              restoredManualSchedules[projId] = {
                startDate: rec.scheduledDate,
                days: rec.scheduledDays || fallbackDays,
                crew: rehydratedCrew,
                isTentative: true,
                recordId: rec.id,
                scheduleType: rec.scheduleType,
                fromOptimizer: !!rec.notes?.includes("[AUTO_OPTIMIZED]"),
                tentativeNotes: rec.notes || "",
              };
            }
          }
        }
      } catch (tentErr) {
        console.warn("Failed to rehydrate tentative schedules:", tentErr);
      }
    }

    return { transformed, restoredManualSchedules };
  }, []);

  const projectsQuery = useQuery({
    queryKey: ["scheduler", "main-projects"],
    queryFn: fetchProjectsQueryFn,
    refetchInterval: 5 * 60 * 1000,
  });

  // Sync query results to component state
  useEffect(() => {
    if (projectsQuery.data) {
      const { transformed, restoredManualSchedules } = projectsQuery.data;
      setProjects(transformed);
      if (restoredManualSchedules) {
        setManualSchedules((prev) => {
          const next: Record<string, ManualSchedule> = {};
          for (const [projectId, schedule] of Object.entries(prev)) {
            if (!schedule.isTentative) {
              next[projectId] = schedule;
              continue;
            }
            if (!schedule.recordId) {
              next[projectId] = schedule;
            }
          }
          for (const [projectId, schedule] of Object.entries(restoredManualSchedules)) {
            next[projectId] = schedule;
          }
          return next;
        });
      }
      setLoading(false);
      setError(null);
    }
    if (projectsQuery.error) {
      const msg = projectsQuery.error instanceof Error ? projectsQuery.error.message : "Unknown error";
      setError(msg);
      setLoading(false);
    }
  }, [projectsQuery.data, projectsQuery.error]);

  // ---- Forecast data for ghost events (conditional on toggle) ----
  interface TimelineMilestone {
    key: string;
    liveForecast: string | null;
    basis: string;
    varianceDays: number | null;
    name: string;
  }
  interface TimelineProject {
    dealId: string;
    projectNumber: string;
    customerName: string;
    location: string;
    currentStage: string;
    milestones: TimelineMilestone[];
  }

  const forecastQuery = useQuery<{ projects: TimelineProject[]; rawProjects: RawProject[] }>({
    queryKey: ["scheduler", "forecasts"],
    queryFn: async () => {
      const [timelineRes, rawRes] = await Promise.all([
        fetch("/api/forecasting/timeline"),
        fetch("/api/projects"),
      ]);
      if (!timelineRes.ok) throw new Error("Failed to fetch forecasts");
      const timeline = await timelineRes.json();
      const raw = rawRes.ok ? await rawRes.json() : { projects: [] };
      return { projects: timeline.projects, rawProjects: raw.projects };
    },
    enabled: showForecasts,
    refetchInterval: 5 * 60 * 1000,
  });

  /* ---- overlay date range (visible span + 1mo buffer each side) ---- */
  const overlayDateRange = useMemo(() => {
    const now = new Date();
    let anchor: Date;
    if (currentView === "week") {
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      anchor = new Date(now);
      anchor.setDate(now.getDate() + mondayOffset + weekOffset * 7);
    } else if (currentView === "gantt") {
      // Gantt always shows 10 business days from THIS Monday, ignores currentMonth
      anchor = new Date(now);
    } else {
      anchor = new Date(currentYear, currentMonth, 1);
    }
    const from = new Date(anchor);
    from.setMonth(from.getMonth() - 1);
    from.setDate(1);
    const to = new Date(anchor);
    to.setMonth(to.getMonth() + 2);
    to.setDate(0);
    return { from_date: toDateStr(from), to_date: toDateStr(to) };
  }, [currentView, currentYear, currentMonth, weekOffset]);

  const serviceJobsQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: ["zuper-service-overlay", overlayDateRange.from_date, overlayDateRange.to_date],
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: SERVICE_CATEGORY_UIDS,
        from_date: overlayDateRange.from_date,
        to_date: overlayDateRange.to_date,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    enabled: showService,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const dnrJobsQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: ["zuper-dnr-overlay", overlayDateRange.from_date, overlayDateRange.to_date],
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: DNR_CATEGORY_UIDS,
        from_date: overlayDateRange.from_date,
        to_date: overlayDateRange.to_date,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    enabled: showDnr,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const overlayEvents = useMemo((): OverlayEvent[] => {
    const service = showService && serviceJobsQuery.data?.jobs
      ? mapZuperJobsToOverlays(serviceJobsQuery.data.jobs, "service")
      : [];
    const dnr = showDnr && dnrJobsQuery.data?.jobs
      ? mapZuperJobsToOverlays(dnrJobsQuery.data.jobs, "dnr")
      : [];
    let combined = [...service, ...dnr];
    if (calendarLocations.length > 0) {
      combined = combined.filter(e => calendarLocations.includes(e.location));
    }
    return combined;
  }, [showService, showDnr, serviceJobsQuery.data, dnrJobsQuery.data, calendarLocations]);

  const fetchProjects = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["scheduler", "main-projects"] });
    queryClient.invalidateQueries({ queryKey: ["scheduler", "forecasts"] });
  }, [queryClient]);

  // Check Zuper configuration status
  useEffect(() => {
    async function checkZuper() {
      try {
        const response = await fetch("/api/zuper/status");
        const data = await response.json();
        setZuperConfigured(data.configured === true);
        if (data.webBaseUrl) {
          setZuperWebBaseUrl(data.webBaseUrl);
        }
      } catch {
        setZuperConfigured(false);
      }
    }
    checkZuper();
  }, []);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("master-scheduler", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  /* ---- Fetch availability slots when schedule modal opens for survey/inspection ---- */
  useEffect(() => {
    if (!scheduleModal) { setAvailableSlots([]); setAvailCache(null); return; }
    const { project, date } = scheduleModal;
    const isSurveyOrInsp = project.stage === "survey" || project.stage === "inspection";
    if (!isSurveyOrInsp || !zuperConfigured) { setAvailableSlots([]); return; }

    const schedType = project.stage === "survey" ? "survey" : "inspection";

    // If we already have a cache for this date+location+type, just re-filter by selected user
    if (availCache && availCache.date === date && availCache.location === project.location && availCache.type === schedType) {
      const userSlots = availCache.slots[crewSelectInput] || [];
      setAvailableSlots(userSlots);
      setSelectedSlotIdx(0);
      return;
    }

    // Fetch availability for this date
    let cancelled = false;
    setLoadingSlots(true);
    (async () => {
      try {
        const params = new URLSearchParams({
          from_date: date,
          to_date: date,
          type: schedType,
          location: project.location,
        });
        const resp = await fetch(`/api/zuper/availability?${params}`);
        if (cancelled) return;
        if (!resp.ok) { setAvailableSlots([]); setLoadingSlots(false); return; }
        const data = await resp.json();
        const dayData = data.availabilityByDate?.[date];
        if (!dayData?.availableSlots) { setAvailableSlots([]); setLoadingSlots(false); return; }

        // Group all slots by user_name for easy switching
        const grouped: Record<string, AvailSlot[]> = {};
        for (const s of dayData.availableSlots) {
          const name = s.user_name || "Unknown";
          if (!grouped[name]) grouped[name] = [];
          grouped[name].push({
            startTime: s.start_time,
            endTime: s.end_time,
            displayTime: s.display_time || `${s.start_time}-${s.end_time}`,
            userName: name,
            userUid: s.user_uid,
            teamUid: s.team_uid,
            timezone: s.timezone,
          });
        }

        if (cancelled) return;
        setAvailCache({ date, location: project.location, type: schedType, slots: grouped });
        const userSlots = grouped[crewSelectInput] || [];
        setAvailableSlots(userSlots);
        setSelectedSlotIdx(0);
      } catch {
        if (!cancelled) setAvailableSlots([]);
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleModal?.date, scheduleModal?.project?.id, scheduleModal?.project?.stage, crewSelectInput, zuperConfigured]);

  /* ================================================================ */
  /*  Toast                                                            */
  /* ================================================================ */

  const showToast = useCallback((message: string, type: "success" | "error" | "warning" | "info" = "success") => {
    addToast({ title: message, type });
  }, [addToast]);

  /* ---- Crew booking helpers ---- */

  const resolveCrewName = useCallback(
    (crewValue: string): string | null => {
      if (ALL_CREW_NAMES.has(crewValue)) return crewValue;
      return null;
    },
    []
  );

  const getEffectiveConstructionDays = useCallback((project: SchedulerProject): number | undefined => {
    if (project.zuperJobCategory !== "construction") return undefined;
    return getConstructionSpanDaysFromZuper({
      startIso: project.zuperScheduledStart,
      endIso: project.zuperScheduledEnd,
      scheduledDays: project.zuperScheduledDays,
      timezone: LOCATION_TIMEZONES[project.location || ""] || "America/Denver",
    });
  }, []);

  /** Build a list of existing crew bookings from Zuper jobs, manual schedules,
   *  and HubSpot construction dates so the optimizer avoids double-booking. */
  const buildExistingBookings = useCallback(
    (excludeProjectId?: string): ExistingBooking[] => {
      const bookings: ExistingBooking[] = [];

      for (const p of projects) {
        if (excludeProjectId && p.id === excludeProjectId) continue;
        const loc = normalizeLocation(p.location);

        // Zuper-scheduled construction jobs — counts as 1 job at this location
        if (p.zuperJobCategory === "construction" && p.zuperScheduledStart) {
          const { startDate } = normalizeZuperBoundaryDates(
            p.zuperScheduledStart,
            p.zuperScheduledEnd,
            p.location
          );
          const startStr = startDate || p.zuperScheduledStart.split("T")[0];
          const days = getEffectiveConstructionDays(p) || p.daysInstall || 1;
          bookings.push({ location: loc, startDate: startStr, days });
        }

        // Manual/tentative schedules — counts as 1 job at this location
        const ms = manualSchedules[p.id];
        if (ms && ms.scheduleType === "installation") {
          bookings.push({ location: loc, startDate: ms.startDate, days: ms.days });
        }

        // HubSpot construction schedule date (not yet in Zuper) — counts as 1 job
        if (p.constructionScheduleDate && !p.zuperScheduledStart) {
          const days = p.daysInstall || 1;
          bookings.push({ location: loc, startDate: p.constructionScheduleDate, days });
        }
      }

      return bookings;
    },
    [projects, manualSchedules, getEffectiveConstructionDays]
  );

  /** Check if a location has remaining capacity on the chosen date for scheduling modal. */
  const locationHasCapacity = useMemo(() => {
    if (!scheduleModal) return true;
    const isConstruction = scheduleModal.project.stage !== "survey" && scheduleModal.project.stage !== "inspection";
    if (!isConstruction) return true;

    const loc = normalizeLocation(scheduleModal.project.location);
    const eb = buildExistingBookings(scheduleModal.project.id);
    const days = Math.max(1, Math.ceil(installDaysInput || scheduleModal.project.daysInstall || 1));
    const cap = DEFAULT_LOCATION_CAPACITY[loc] ?? 1;

    // Count existing jobs per day in the span
    const dayCounts: Record<string, number> = {};
    for (const booking of eb) {
      if (normalizeLocation(booking.location) !== loc) continue;
      const dates = getBusinessDatesInSpan(booking.startDate, booking.days);
      for (const d of dates) {
        dayCounts[d] = (dayCounts[d] || 0) + 1;
      }
    }

    // Check if any day in the proposed span is at capacity
    const spanDates = getBusinessDatesInSpan(scheduleModal.date, days);
    return spanDates.every((d) => (dayCounts[d] || 0) < cap);
  }, [scheduleModal, installDaysInput, buildExistingBookings]);

  /** Get available construction assignees for the schedule modal. */
  const availableConstructionAssignees = useMemo(() => {
    if (!scheduleModal) return [] as ZuperAssignee[];
    const isConstruction = scheduleModal.project.stage !== "survey" && scheduleModal.project.stage !== "inspection";
    if (!isConstruction) return [] as ZuperAssignee[];

    const location = scheduleModal.project.location;
    const hasLiveForLocation = Object.prototype.hasOwnProperty.call(
      liveConstructionAssigneesByLocation,
      location
    );
    if (hasLiveForLocation) return liveConstructionAssigneesByLocation[location] || [];
    return ZUPER_CONSTRUCTION_USERS[location] || [];
  }, [scheduleModal, liveConstructionAssigneesByLocation]);

  // Pull fresh assignees from the location's Zuper team for construction scheduling.
  useEffect(() => {
    if (!scheduleModal) return;
    const isConstruction = scheduleModal.project.stage !== "survey" && scheduleModal.project.stage !== "inspection";
    if (!isConstruction) return;

    const location = scheduleModal.project.location;
    const director = ZUPER_CONSTRUCTION_DIRECTORS[location];
    const teamUid = director?.teamUid;
    if (!teamUid) return;

    // Skip if we already have live members for this location in the current session.
    if (Object.prototype.hasOwnProperty.call(liveConstructionAssigneesByLocation, location)) return;

    let cancelled = false;
    setLoadingConstructionAssignees(true);

    fetch(`/api/zuper/teams/${encodeURIComponent(teamUid)}/users`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch team users (${res.status})`);
        return res.json() as Promise<{
          users?: Array<{
            userUid?: string;
            firstName?: string;
            lastName?: string;
            email?: string | null;
          }>;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        const teamUsers = (data.users || [])
          .map((user) => {
            const userUid = String(user.userUid || "").trim();
            const name = `${String(user.firstName || "").trim()} ${String(user.lastName || "").trim()}`.trim();
            if (!userUid || !name) return null;
            return { name, userUid, teamUid };
          })
          .filter((user): user is ZuperAssignee => !!user);

        setLiveConstructionAssigneesByLocation((prev) => ({
          ...prev,
          [location]: dedupeAssignees(teamUsers),
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn(`[Scheduler] Failed to load live construction assignees for ${location}:`, error);
        // Mark as loaded with an empty list to avoid leaking hardcoded fallback users.
        setLiveConstructionAssigneesByLocation((prev) => ({ ...prev, [location]: [] }));
      })
      .finally(() => {
        if (!cancelled) setLoadingConstructionAssignees(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scheduleModal, liveConstructionAssigneesByLocation]);

  // Clear assignee selection when it is no longer available for this location
  useEffect(() => {
    if (!scheduleModal) return;
    const isConstruction = scheduleModal.project.stage !== "survey" && scheduleModal.project.stage !== "inspection";
    if (!isConstruction) return;

    const availableNames = new Set(availableConstructionAssignees.map((assignee) => assignee.name));
    const filtered = constructionAssigneeNames.filter((name) => availableNames.has(name));
    if (filtered.length !== constructionAssigneeNames.length) {
      setConstructionAssigneeNames(filtered);
    }
  }, [scheduleModal, constructionAssigneeNames, availableConstructionAssignees]);

  /* ================================================================ */
  /*  Derived data                                                     */
  /* ================================================================ */

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((p) => {
      // Exclude completed-past-stage projects from sidebar (they only exist for calendar events)
      if (p.isCompletedPastStage) return false;
      if (selectedLocations.length > 0 && !selectedLocations.includes(p.location))
        return false;
      if (selectedStages.length > 0 && !selectedStages.includes(p.stage)) return false;
      if (
        searchText &&
        !p.name.toLowerCase().includes(searchText.toLowerCase()) &&
        !p.address.toLowerCase().includes(searchText.toLowerCase())
      )
        return false;
      if (typeFilters.length > 0) {
        const t = (p.type || "").toLowerCase();
        const hasSolar = t.includes("solar");
        const hasBattery = t.includes("battery");
        const hasEV = t.includes("ev");
        const matchesAny = typeFilters.some(f => {
          if (f === "Solar Only") return hasSolar && !hasBattery;
          if (f === "Battery Only") return hasBattery && !hasSolar;
          if (f === "Solar + Battery") return hasSolar && hasBattery;
          if (f === "EV") return hasEV;
          return false;
        });
        if (!matchesAny) return false;
      }
      return true;
    });
    if (sortBy === "amount") filtered.sort((a, b) => b.amount - a.amount);
    else if (sortBy === "date")
      filtered.sort((a, b) =>
        (a.scheduleDate || "z").localeCompare(b.scheduleDate || "z")
      );
    else if (sortBy === "days")
      filtered.sort((a, b) => (a.daysInstall || 1) - (b.daysInstall || 1));
    else if (sortBy === "location")
      filtered.sort((a, b) => (a.location || "").localeCompare(b.location || ""));
    else if (sortBy === "type")
      filtered.sort((a, b) => (a.type || "").localeCompare(b.type || ""));
    return filtered;
  }, [projects, selectedLocations, selectedStages, searchText, typeFilters, sortBy]);

  const scheduledEvents = useMemo((): ScheduledEvent[] => {
    const events: ScheduledEvent[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const seenKeys = new Set<string>();

    // Overdue logic:
    // - Construction: overdue the day after the scheduled end date
    //   (e.g. 3-day install starting Mon → end Wed → overdue on Thu)
    // - Surveys/Inspections: overdue the day after the scheduled date
    //   (e.g. inspection on Mon → overdue on Tue)
    const isOverdueCheck = (schedDate: Date, days: number, done: boolean, isConstruction: boolean) => {
      if (done) return false;
      // Normalize to midnight for clean day comparison
      const schedMidnight = new Date(schedDate);
      schedMidnight.setHours(0, 0, 0, 0);
      if (isConstruction) {
        // End date = start + ceil(days), overdue the next day
        const endDate = new Date(schedMidnight);
        endDate.setDate(schedMidnight.getDate() + Math.ceil(days));
        return endDate < today;
      }
      // Surveys/inspections: overdue if scheduled date is before today
      return schedMidnight < today;
    };

    projects.forEach((p) => {
      // Generate separate events per milestone. Completed milestones get their own
      // event type so they render distinctly (no confusion between active vs done).

      // -- Construction --
      // Only use Zuper dates for construction if the matched Zuper job is actually
      // a construction job (not a survey/inspection job that happened to match).
      const zuperIsConstruction = p.zuperJobCategory === "construction";
      const normalizedZuperDates = normalizeZuperBoundaryDates(
        p.zuperScheduledStart,
        p.zuperScheduledEnd,
        p.location
      );
      const constructionDate = (zuperIsConstruction
        ? normalizedZuperDates.startDate
        : null) || p.constructionScheduleDate;
      if (constructionDate) {
        const schedDate = new Date(constructionDate + "T12:00:00");
        const done = !!p.constructionCompleted;
        const days = (zuperIsConstruction ? getEffectiveConstructionDays(p) : null) || p.daysInstall || 1;
        const key = `${p.id}-construction`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          events.push({
            ...p,
            date: constructionDate,
            eventType: done ? "construction-complete" : "construction",
            days,
            isCompleted: done,
            isOverdue: isOverdueCheck(schedDate, days, done, true),
          });
        }
      }

      // -- Inspection --
      if (p.inspectionScheduleDate) {
        const schedDate = new Date(p.inspectionScheduleDate + "T12:00:00");
        const done = !!p.inspectionCompleted;
        const failed = !!(p.inspectionStatus && p.inspectionStatus.toLowerCase().includes("fail"));
        const key = `${p.id}-inspection`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          events.push({
            ...p,
            date: p.inspectionScheduleDate,
            eventType: done ? (failed ? "inspection-fail" : "inspection-pass") : "inspection",
            days: 1,
            isCompleted: done,
            isOverdue: isOverdueCheck(schedDate, 1, done, false),
            isInspectionFailed: failed,
          });
        }
      }

      // -- Survey --
      if (p.surveyScheduleDate) {
        const schedDate = new Date(p.surveyScheduleDate + "T12:00:00");
        const done = !!p.surveyCompleted;
        const key = `${p.id}-survey`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          events.push({
            ...p,
            date: p.surveyScheduleDate,
            eventType: done ? "survey-complete" : "survey",
            days: 1,
            isCompleted: done,
            isOverdue: isOverdueCheck(schedDate, 1, done, false),
          });
        }
      }

      // -- Fallback for RTB/Blocked projects with scheduleDate but no constructionScheduleDate --
      if (p.scheduleDate && (p.stage === "rtb" || p.stage === "blocked") && !seenKeys.has(`${p.id}-construction`)) {
        const schedDate = new Date(p.scheduleDate + "T12:00:00");
        const done = !!p.constructionCompleted;
        const days = (zuperIsConstruction ? getEffectiveConstructionDays(p) : null) || p.daysInstall || 1;
        const key = `${p.id}-construction`;
        seenKeys.add(key);
        events.push({
          ...p,
          date: p.scheduleDate,
          eventType: done ? "construction-complete" : p.stage,
          days,
          isCompleted: done,
          isOverdue: isOverdueCheck(schedDate, days, done, true),
        });
      }
    });
    Object.entries(manualSchedules).forEach(([id, data]) => {
      const project = projects.find((p) => p.id === id);
      if (project) {
        const existingIdx = events.findIndex((e) => e.id === id);
        if (existingIdx > -1) events.splice(existingIdx, 1);
        // Use the project's actual stage as eventType so tentative events
        // still appear under the correct filter (Construction, Survey, etc.)
        const tentativeEventType = data.scheduleType === "survey" ? "survey"
          : data.scheduleType === "inspection" ? "inspection"
          : project.stage === "survey" ? "survey"
          : project.stage === "inspection" ? "inspection"
          : "construction";
        events.push({
          ...project,
          date: data.startDate,
          eventType: data.isTentative ? tentativeEventType : "scheduled",
          days: data.days,
          crew: data.crew,
          isTentative: data.isTentative,
          tentativeRecordId: data.recordId,
        });
      }
    });
    return events;
  }, [projects, manualSchedules, getEffectiveConstructionDays]);

  // Apply calendar multi-select filters for all views (month, week, Gantt)
  // Map base stage types to include their completed variants so the stage
  // toggle buttons also show completed/failed events for that stage.
  const filteredScheduledEvents = useMemo(() => {
    const typeVariants: Record<string, string[]> = {
      survey: ["survey", "survey-complete"],
      construction: ["construction", "construction-complete"],
      inspection: ["inspection", "inspection-pass", "inspection-fail"],
      scheduled: ["scheduled"],
    };
    // Expand selected base types into all their variants
    const expandedTypes = calendarScheduleTypes.length > 0
      ? calendarScheduleTypes.flatMap(t => typeVariants[t] || [t])
      : [];

    return scheduledEvents.filter((e) => {
      if (calendarLocations.length > 0 && !calendarLocations.includes(e.location)) return false;
      if (expandedTypes.length > 0 && !expandedTypes.includes(e.eventType)) return false;
      if (!showCompleted && e.isCompleted) return false;
      if (!showIncomplete && e.isOverdue && !e.isCompleted) return false;
      if (!showScheduled && !e.isCompleted && !e.isOverdue) return false;
      return true;
    });
  }, [scheduledEvents, calendarLocations, calendarScheduleTypes, showScheduled, showCompleted, showIncomplete]);

  // ---- Forecast ghost events ----
  const forecastGhostEvents = useMemo((): ScheduledEvent[] => {
    if (!showForecasts || !forecastQuery.data?.projects) return [];

    const timelineProjects = forecastQuery.data.projects;
    const rawProjects = forecastQuery.data.rawProjects || [];
    const ghosts: ScheduledEvent[] = [];
    const preConstructionStages = new Set(["survey", "rtb", "blocked", "design", "permitting"]);

    const mapRawStage = (stageRaw: string): string => {
      const s = (stageRaw || "").toLowerCase();
      if (s.includes("design") || s.includes("d&e") || s.includes("engineering")) return "design";
      if (s.includes("permit") || s.includes("interconnection") || s.includes("p&i")) return "permitting";
      return mapStage(stageRaw);
    };

    const typeVariants: Record<string, string[]> = {
      survey: ["survey", "survey-complete"],
      construction: ["construction", "construction-complete"],
      inspection: ["inspection", "inspection-pass", "inspection-fail"],
      scheduled: ["scheduled"],
    };

    for (const tp of timelineProjects) {
      const project = projects.find((p) => String(p.id) === tp.dealId);
      const raw = !project ? rawProjects.find((r: RawProject) => String(r.id) === tp.dealId) : null;
      if (!project && !raw) continue;

      const id = project ? project.id : String(raw!.id);
      const stage = project ? project.stage : mapRawStage(raw!.stage);

      // ── Eligibility filter ──
      if (!preConstructionStages.has(stage)) continue;
      if (project?.constructionScheduleDate || raw?.constructionScheduleDate) continue;
      if (manualSchedules[id]?.scheduleType === "installation") continue;
      if (project?.zuperJobCategory === "construction") continue;

      const installMilestone = tp.milestones.find(
        (m) => m.key === "install" && m.basis !== "actual" && m.basis !== "insufficient"
      );
      if (!installMilestone?.liveForecast) continue;

      const hasRealConstructionEvent = scheduledEvents.some(
        (e) => e.id === id && (e.eventType === "construction" || e.eventType === "construction-complete")
      );
      if (hasRealConstructionEvent) continue;

      // ── Build ghost event ──
      let ghost: ScheduledEvent;
      if (project) {
        ghost = {
          ...project,
          date: installMilestone.liveForecast,
          eventType: "construction",
          days: project.daysInstall || 3,
          isForecast: true,
        };
      } else {
        // Build from raw project data (D&E / P&I projects not in scheduler projects)
        const r = raw!;
        ghost = {
          id: String(r.id),
          name: r.name,
          address: r.address || "",
          location: normalizeLocation(r.pbLocation || r.city),
          amount: r.amount || 0,
          type: r.projectType || "Solar",
          stage,
          systemSize: r.equipment?.systemSizeKwdc || 0,
          moduleCount: r.equipment?.modules?.count || 0,
          inverterCount: r.equipment?.inverter?.count || 0,
          batteries: r.equipment?.battery?.count || 0,
          batteryExpansion: r.equipment?.battery?.expansionCount || 0,
          batteryModel: null,
          evCount: r.equipment?.evCount || 0,
          moduleBrand: r.equipment?.modules?.brand || "",
          moduleModel: r.equipment?.modules?.model || "",
          moduleWattage: r.equipment?.modules?.wattage || 0,
          inverterBrand: r.equipment?.inverter?.brand || "",
          inverterModel: r.equipment?.inverter?.model || "",
          inverterSizeKwac: r.equipment?.inverter?.sizeKwac || 0,
          batterySizeKwh: r.equipment?.battery?.sizeKwh || 0,
          ahj: r.ahj || "",
          utility: r.utility || "",
          crew: null,
          daysInstall: r.expectedDaysForInstall || r.daysToInstall || 3,
          daysElec: r.daysForElectricians || 0,
          totalDays: (r.expectedDaysForInstall || r.daysToInstall || 3) + (r.daysForElectricians || 0),
          roofersCount: r.roofersCount || 0,
          electriciansCount: r.electriciansCount || 0,
          difficulty: r.installDifficulty || 3,
          installNotes: r.installNotes || "",
          roofType: null,
          scheduleDate: null,
          constructionScheduleDate: null,
          inspectionScheduleDate: null,
          surveyScheduleDate: r.siteSurveyScheduleDate || null,
          surveyCompleted: r.siteSurveyCompletionDate || null,
          constructionCompleted: null,
          inspectionCompleted: null,
          inspectionStatus: null,
          hubspotUrl: r.url || `https://app.hubspot.com/contacts/21710069/record/0-3/${r.id}`,
          isPE: r.isParticipateEnergy || false,
          daysToInstall: r.daysToInstall ?? null,
          isCompletedPastStage: false,
          date: installMilestone.liveForecast,
          eventType: "construction",
          days: r.expectedDaysForInstall || r.daysToInstall || 3,
          isForecast: true,
        };
      }

      // ── Apply same calendar filters as filteredScheduledEvents ──
      if (calendarLocations.length > 0 && !calendarLocations.includes(ghost.location)) continue;
      if (calendarScheduleTypes.length > 0) {
        const expandedTypes = calendarScheduleTypes.flatMap((t) => typeVariants[t] || [t]);
        if (!expandedTypes.includes(ghost.eventType)) continue;
      }
      if (!showScheduled) continue;

      ghosts.push(ghost);
    }

    return ghosts;
  }, [
    showForecasts, forecastQuery.data, projects, manualSchedules,
    scheduledEvents, calendarLocations, calendarScheduleTypes, showScheduled,
  ]);

  // ---- Merged display events: real filtered events + ghost forecast events + overlays ----
  const displayEvents = useMemo((): DisplayEvent[] => {
    const base: DisplayEvent[] = forecastGhostEvents.length === 0
      ? filteredScheduledEvents
      : [...filteredScheduledEvents, ...forecastGhostEvents];
    if (overlayEvents.length === 0) return base;
    return [...base, ...overlayEvents];
  }, [filteredScheduledEvents, forecastGhostEvents, overlayEvents]);

  const queueRevenue = useMemo(
    () => formatRevenueCompact(filteredProjects.reduce((s, p) => s + p.amount, 0)),
    [filteredProjects]
  );

  /* Weekly revenue sidebar — construction scheduled vs completed vs overdue, week by week */
  type RevenueBucket = { count: number; revenue: number };
  type WeekData = {
    weekStart: Date;
    weekLabel: string;
    isPast: boolean;
    isFuture: boolean;
    isCurrent: boolean;
    scheduled: RevenueBucket;
    tentative: RevenueBucket;
    completed: RevenueBucket;
    overdue: RevenueBucket;
    forecasted: RevenueBucket;
  };
  type MonthData = {
    monthLabel: string;
    isPast: boolean;
    isCurrent: boolean;
    scheduled: RevenueBucket;
    tentative: RevenueBucket;
    completed: RevenueBucket;
    overdue: RevenueBucket;
    forecasted: RevenueBucket;
  };

  const computeRevenueBuckets = useCallback((events: DisplayEvent[]) => {
    const scheduledEvts = events.filter((e) =>
      (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && !e.isOverdue && !e.isTentative && !e.isForecast
    );
    const tentativeEvts = events.filter((e) => e.isTentative && !e.isForecast);
    const completedEvts = events.filter((e) => e.eventType === "construction-complete" && !e.isForecast);
    const overdueEvts = events.filter((e) =>
      (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && e.isOverdue && !e.isTentative && !e.isForecast
    );
    const forecastedEvts = events.filter((e) => e.isForecast);
    const dedupeRevenue = (evts: DisplayEvent[]) => {
      const ids = new Set(evts.map((e) => e.id));
      return {
        count: ids.size,
        revenue: [...ids].reduce((sum, id) => sum + (evts.find((e) => e.id === id)?.amount || 0), 0),
      };
    };
    return { scheduled: dedupeRevenue(scheduledEvts), tentative: dedupeRevenue(tentativeEvts), completed: dedupeRevenue(completedEvts), overdue: dedupeRevenue(overdueEvts), forecasted: dedupeRevenue(forecastedEvts) };
  }, []);

  const weeklyRevenueSummary = useMemo((): WeekData[] => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + mondayOffset);
    thisMonday.setHours(0, 0, 0, 0);

    const weeks: WeekData[] = [];

    // Extend forward range to cover forecast ghost events, capped to avoid
    // runaway bucket counts from far-future outlier forecasts.
    const MAX_WEEKS_FORWARD = 26; // ~6 months
    let weeksForward = 6;
    if (forecastGhostEvents.length > 0) {
      const maxDate = forecastGhostEvents.reduce((max, e) => {
        const d = new Date(e.date + "T12:00:00");
        return d > max ? d : max;
      }, new Date(0));
      const diffWeeks = Math.ceil((maxDate.getTime() - thisMonday.getTime()) / (7 * 86400000));
      if (diffWeeks + 1 > weeksForward) weeksForward = Math.min(diffWeeks + 1, MAX_WEEKS_FORWARD);
    }

    // 6 weeks back + current week + forward weeks
    for (let w = -6; w < weeksForward; w++) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(thisMonday.getDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 5); // Mon-Fri

      const isPast = w < 0;
      const isFuture = w > 0;
      const isCurrent = w === 0;
      const label = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      const weekEvents = displayEvents.filter((e) => {
        const d = new Date(e.date + "T12:00:00");
        return d >= weekStart && d < weekEnd;
      });

      const buckets = computeRevenueBuckets(weekEvents);
      weeks.push({ weekStart, weekLabel: label, isPast, isFuture, isCurrent, ...buckets });
    }
    return weeks;
  }, [displayEvents, forecastGhostEvents, computeRevenueBuckets]);

  const monthlyRevenueSummary = useMemo((): MonthData[] => {
    const today = new Date();
    const thisMonth = today.getMonth();
    const thisYear = today.getFullYear();
    const months: MonthData[] = [];

    // Show all months of the current year (Jan–Dec)
    for (let mo = 0; mo < 12; mo++) {
      const monthStart = new Date(thisYear, mo, 1);
      const monthEnd = new Date(thisYear, mo + 1, 1);
      const isPast = mo < thisMonth;
      const isCurrent = mo === thisMonth;
      const label = monthStart.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

      const monthEvents = displayEvents.filter((e) => {
        const ed = new Date(e.date + "T12:00:00");
        return ed >= monthStart && ed < monthEnd;
      });

      const buckets = computeRevenueBuckets(monthEvents);
      months.push({ monthLabel: label, isPast, isCurrent, ...buckets });
    }
    return months;
  }, [displayEvents, forecastGhostEvents, computeRevenueBuckets]);

  /* ================================================================ */
  /*  Calendar logic                                                   */
  /* ================================================================ */

  const calendarData = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    // Convert to weekday-only grid index: how many empty cells before the 1st weekday
    // Grid columns: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4
    const jsDay = firstDay.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    // Sun/Sat: first weekday is Monday → 0 padding
    // Mon=0, Tue=1, Wed=2, Thu=3, Fri=4
    const startDay = jsDay === 0 || jsDay === 6 ? 0 : jsDay - 1;
    const daysInMonth = lastDay.getDate();
    const today = new Date();

    // Build list of weekday-only dates for this month
    const weekdays: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(currentYear, currentMonth, d);
      const dow = date.getDay();
      if (dow !== 0 && dow !== 6) weekdays.push(d);
    }

    const eventsByDate: Record<number, (DisplayEvent & { dayNum: number; totalCalDays: number })[]> = {};
    displayEvents.forEach((e) => {
      const startDate = new Date(e.date + "T12:00:00");
      const businessDays = Math.ceil(e.days || 1);
      let dayCount = 0;
      let calendarOffset = 0;
      // Iterate through calendar days but only count business days
      while (dayCount < businessDays) {
        const eventDate = new Date(startDate);
        eventDate.setDate(eventDate.getDate() + calendarOffset);
        const dayOfWeek = eventDate.getDay();
        // Skip weekends
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          if (
            eventDate.getMonth() === currentMonth &&
            eventDate.getFullYear() === currentYear
          ) {
            const day = eventDate.getDate();
            if (!eventsByDate[day]) eventsByDate[day] = [];
            eventsByDate[day].push({
              ...e,
              dayNum: dayCount + 1,
              totalCalDays: businessDays,
            });
          }
          dayCount++;
        }
        calendarOffset++;
      }
    });

    // Sort events within each day: construction → inspection → survey → other
    const STAGE_ORDER: Record<string, number> = {
      construction: 0, "construction-complete": 0,
      inspection: 1, "inspection-pass": 1, "inspection-fail": 1,
      survey: 2, "survey-complete": 2,
      dnr: 3, service: 4,
    };
    for (const day of Object.keys(eventsByDate)) {
      eventsByDate[Number(day)].sort((a, b) => {
        const stageDiff = (STAGE_ORDER[a.eventType] ?? 9) - (STAGE_ORDER[b.eventType] ?? 9);
        if (stageDiff !== 0) return stageDiff;
        return (a.isForecast ? 1 : 0) - (b.isForecast ? 1 : 0);
      });
    }

    return { startDay, daysInMonth, today, eventsByDate, weekdays };
  }, [currentYear, currentMonth, displayEvents]);

  /* ================================================================ */
  /*  Week view logic                                                  */
  /* ================================================================ */

  const weekDates = useMemo(() => {
    const today = new Date();
    // Find the Monday of the current week
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Sunday is 0, so go back 6 days
    const start = new Date(today);
    start.setDate(today.getDate() + mondayOffset + weekOffset * 7);
    const dates: Date[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [weekOffset]);

  /* ================================================================ */
  /*  Gantt view logic                                                 */
  /* ================================================================ */

  const ganttDates = useMemo(() => {
    const today = new Date();
    // Find the Monday of the current week
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const start = new Date(today);
    start.setDate(today.getDate() + mondayOffset);
    const dates: Date[] = [];
    const current = new Date(start);
    while (dates.length < 10) {
      if (current.getDay() !== 0 && current.getDay() !== 6) {
        dates.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }, []);

  /* ================================================================ */
  /*  Handlers                                                         */
  /* ================================================================ */

  const handleSelectProject = useCallback(
    (id: string) => {
      const proj = projects.find((p) => p.id === id) || null;
      setSelectedProject(proj);
    },
    [projects]
  );

  const handleDayClick = useCallback(
    (dateStr: string) => {
      if (!selectedProject) return;
      if (isWeekend(dateStr)) {
        showToast("Cannot schedule on weekends", "error");
        return;
      }
      openScheduleModal(selectedProject, dateStr);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedProject, showToast]
  );

  const openScheduleModal = useCallback(
    (project: SchedulerProject, dateStr: string) => {
      // Always use the date the user clicked/selected, not the Zuper date
      const adjustedDate = getNextWorkday(dateStr);
      const isSurveyOrInspection =
        project.stage === "survey" || project.stage === "inspection";
      setInstallDaysInput(isSurveyOrInspection ? 1 : getEffectiveConstructionDays(project) || project.daysInstall || 2);
      // Pre-select defaults based on schedule type
      if (project.stage === "survey") {
        const surveyUsers = ZUPER_SURVEY_USERS[project.location] || [];
        setCrewSelectInput(surveyUsers[0]?.name || "");
        setConstructionAssigneeNames([]);
        setInstallerNotesInput("");
      } else if (project.stage === "inspection") {
        const inspUsers = ZUPER_INSPECTION_USERS[project.location] || [];
        setCrewSelectInput(inspUsers[0]?.name || "");
        setConstructionAssigneeNames([]);
        setInstallerNotesInput("");
      } else {
        const hasLiveForLocation = Object.prototype.hasOwnProperty.call(
          liveConstructionAssigneesByLocation,
          project.location
        );
        const constructionUsers = hasLiveForLocation
          ? (liveConstructionAssigneesByLocation[project.location] || [])
          : (ZUPER_CONSTRUCTION_USERS[project.location] || []);
        const existingNames = (project.crew || "")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
        const validExisting = existingNames.filter((name) => constructionUsers.some((u) => u.name === name));
        const selectedNames = validExisting.length > 0
          ? validExisting
          : (constructionUsers[0]?.name ? [constructionUsers[0].name] : []);
        setConstructionAssigneeNames(selectedNames);
        setCrewSelectInput("");
        setInstallerNotesInput("");
      }
      trackFeature("schedule-modal-open", "Opened master schedule modal", {
        scheduler: "master",
        projectId: project.id,
        projectName: project.name,
        date: adjustedDate,
        stage: project.stage,
      });
      setScheduleModal({ project, date: adjustedDate });
    },
    [trackFeature, getEffectiveConstructionDays, liveConstructionAssigneesByLocation]
  );

  const confirmSchedule = useCallback(async () => {
    if (!scheduleModal) return;
    const { project, date } = scheduleModal;
    const isSurveyOrInsp = project.stage === "survey" || project.stage === "inspection";
    const selectedSlot = isSurveyOrInsp ? availableSlots[selectedSlotIdx] : null;
    const days = isSurveyOrInsp ? 1 : (installDaysInput || 2);
    const selectedConstructionAssignees = availableConstructionAssignees.filter((assignee) =>
      constructionAssigneeNames.includes(assignee.name)
    );
    const selectedConstructionAssigneeNames = selectedConstructionAssignees.map((assignee) => assignee.name);
    const selectedAssigneeName = isSurveyOrInsp
      ? (crewSelectInput || project.crew || "")
      : selectedConstructionAssigneeNames.join(", ");
    const selectedConstructionCrewUids = selectedConstructionAssignees
      .map((assignee) => assignee.userUid)
      .filter(Boolean)
      .join(",");
    const selectedConstructionUserUid = selectedConstructionAssignees.find((assignee) => assignee.userUid)?.userUid;
    const selectedConstructionTeamUids = [...new Set(
      selectedConstructionAssignees
        .map((assignee) => assignee.teamUid)
        .filter(Boolean)
    )];
    const selectedConstructionTeamUid = ZUPER_CONSTRUCTION_DIRECTORS[project.location]?.teamUid || selectedConstructionTeamUids[0] || "";
    const installerNotes = isSurveyOrInsp ? "" : installerNotesInput.trim();

    // Require assignee selection for construction installs
    if (!isSurveyOrInsp && selectedConstructionAssignees.length === 0) {
      showToast("Please select an assignee before scheduling", "warning");
      return;
    }
    // For survey/inspection, derive times from selected slot; for construction, use defaults
    const slotStartTime = selectedSlot?.startTime || "08:00";
    const slotEndTime = selectedSlot?.endTime || (isSurveyOrInsp ? "09:00" : "16:00");
    const slotTimezone = selectedSlot?.timezone || LOCATION_TIMEZONES[project.location] || "America/Denver";

    const scheduleType = project.stage === "survey" ? "survey"
      : project.stage === "inspection" ? "inspection"
      : "installation";
    trackFeature(`${scheduleType}-scheduled`, `${scheduleType} scheduled via master`, {
      scheduler: "master",
      projectId: project.id,
      projectName: project.name,
      date,
      stage: project.stage,
      days,
      crew: selectedAssigneeName,
      syncToZuper,
      isReschedule: !!project.zuperJobUid,
    });

    const resolvedScheduleType = project.stage === "survey" ? "survey"
      : project.stage === "inspection" ? "inspection"
      : "installation";

    setManualSchedules((prev) => ({
      ...prev,
      [project.id]: {
        startDate: date,
        days,
        crew: selectedAssigneeName,
        isTentative: !syncToZuper,
        scheduleType: resolvedScheduleType,
        // Store notes blob for tentative installs so prefill works before refetch
        ...(!syncToZuper && resolvedScheduleType === "installation" && installerNotes
          ? { tentativeNotes: `[TENTATIVE] Tentatively scheduled via Master Scheduler — ${selectedAssigneeName}\n\nInstaller Notes: ${installerNotes}` }
          : {}),
      },
    }));

    // Resolve Zuper assignee based on schedule type, location, and selected crew/user
    const resolveZuperAssignee = (type: string, location: string, selectedName: string) => {
      if (type === "survey") {
        const users = ZUPER_SURVEY_USERS[location] || [];
        return users.find(u => u.name === selectedName) || users[0];
      }
      if (type === "inspection") {
        const users = ZUPER_INSPECTION_USERS[location] || [];
        return users.find(u => u.name === selectedName) || users[0];
      }
      return selectedConstructionAssignees[0];
    };

    // Sync to Zuper if enabled
    if (syncToZuper) {
      if (!zuperConfigured) {
        showToast(
          `${getCustomerName(project.name)} scheduled locally (Zuper not configured)`,
          "error"
        );
      } else {
      setSyncingToZuper(true);
      try {
        const scheduleType = project.stage === "survey" ? "survey"
          : project.stage === "inspection" ? "inspection"
          : "installation";
        const assignee = resolveZuperAssignee(scheduleType, project.location, selectedAssigneeName);
        const assigneeLabel = selectedSlot?.userName || (isSurveyOrInsp ? assignee?.name : selectedAssigneeName);
        const scheduleNotes = [
          `Scheduled via Master Schedule${assigneeLabel ? ` — ${assigneeLabel}` : ""}`,
          installerNotes ? `Installer Notes: ${installerNotes}` : "",
        ].filter(Boolean).join("\n\n");

        const response = await fetch("/api/zuper/jobs/schedule", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: {
              id: project.id,
              name: project.name,
              address: project.address,
              city: "",
              state: "",
              systemSizeKw: project.systemSize,
              batteryCount: project.batteries,
              projectType: project.type,
              zuperJobUid: project.zuperJobUid,
            },
            schedule: {
              type: scheduleType,
              date: date,
              days: days,
              startTime: slotStartTime,
              endTime: slotEndTime,
              crew: selectedSlot?.userUid || (isSurveyOrInsp ? assignee?.userUid : selectedConstructionCrewUids),
              teamUid: selectedSlot?.teamUid || (isSurveyOrInsp ? assignee?.teamUid : selectedConstructionTeamUid),
              assignedUser: assigneeLabel,
              timezone: slotTimezone,
              notes: scheduleNotes,
              installerNotes: installerNotes || undefined,
            },
            rescheduleOnly: true,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.action === "no_job_found") {
            showToast(
              `${getCustomerName(project.name)} — no existing Zuper job found to reschedule`,
              "error"
            );
          } else {
            showToast(
              `${getCustomerName(project.name)} scheduled - Zuper job updated (customer notified)`
            );
          }
        } else {
          const errData = await response.json().catch(() => ({}));
          console.error("[Master Schedule] Zuper sync failed:", errData);
          showToast(
            `${getCustomerName(project.name)} scheduled locally (Zuper sync failed: ${errData.error || response.status})`,
            "error"
          );
        }
      } catch (err) {
        console.error("[Master Schedule] Zuper error:", err);
        showToast(
          `${getCustomerName(project.name)} scheduled locally (Zuper sync failed)`,
          "error"
        );
      } finally {
        setSyncingToZuper(false);
      }
      }
    } else {
      try {
        const scheduleType = project.stage === "survey" ? "survey"
          : project.stage === "inspection" ? "inspection"
          : "installation";
        const assignee = resolveZuperAssignee(scheduleType, project.location, selectedAssigneeName);
        const assigneeLabel = selectedSlot?.userName || (isSurveyOrInsp ? assignee?.name : selectedAssigneeName);
        const tentativeNotes = [
          `Tentatively scheduled via Master Scheduler${assigneeLabel ? ` — ${assigneeLabel}` : ""}`,
          installerNotes ? `Installer Notes: ${installerNotes}` : "",
        ].filter(Boolean).join("\n\n");

        const response = await fetch("/api/zuper/jobs/schedule/tentative", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: {
              id: project.id,
              name: project.name,
              address: project.address,
              city: "",
              state: "",
            },
            schedule: {
              type: scheduleType,
              date,
              days,
              startTime: slotStartTime,
              endTime: slotEndTime,
              crew: selectedSlot?.userUid || (isSurveyOrInsp ? assignee?.userUid : selectedConstructionCrewUids),
              userUid: selectedSlot?.userUid || (isSurveyOrInsp ? assignee?.userUid : selectedConstructionUserUid),
              teamUid: selectedSlot?.teamUid || (isSurveyOrInsp ? assignee?.teamUid : selectedConstructionTeamUid),
              assignedUser: assigneeLabel,
              timezone: slotTimezone,
              notes: tentativeNotes,
            },
          }),
        });

        if (response.ok) {
          const tentData = await response.json();
          // Store the record ID so we can confirm/cancel later
          if (tentData.record?.id) {
            // The API prepends [TENTATIVE] to the notes — store the full blob
            const storedNotes = `[TENTATIVE] ${tentativeNotes}`;
            setManualSchedules((prev) => ({
              ...prev,
              [project.id]: { ...prev[project.id], recordId: tentData.record.id, tentativeNotes: storedNotes },
            }));
          }
          showToast(`${getCustomerName(project.name)} tentatively scheduled for ${formatDateShort(date)}`);
        } else {
          showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "error");
        }
      } catch {
        showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "error");
      }
    }

    setScheduleModal(null);
    setSelectedProject(null);
  }, [scheduleModal, installDaysInput, crewSelectInput, constructionAssigneeNames, installerNotesInput, availableConstructionAssignees, availableSlots, selectedSlotIdx, showToast, zuperConfigured, syncToZuper, trackFeature]);

  const handleDragStart = useCallback(
    (e: React.DragEvent, projectId: string) => {
      setDraggedProjectId(projectId);
      e.dataTransfer.setData("text/plain", projectId);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDraggedProjectId(null);
  }, []);

  /* ---- Tentative: Confirm & Cancel handlers ---- */
  const [confirmingTentative, setConfirmingTentative] = useState(false);
  const [cancellingTentative, setCancellingTentative] = useState(false);

  const resolveMasterTentativeRecordId = useCallback(async (projectId: string): Promise<string | null> => {
    const localRecordId = manualSchedules[projectId]?.recordId;
    if (localRecordId) return localRecordId;

    const type = manualSchedules[projectId]?.scheduleType;
    const params = new URLSearchParams({
      projectIds: projectId,
      status: "tentative",
    });
    if (type) params.set("type", type);

    const res = await fetch(`/api/zuper/schedule-records?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const record = data?.records?.[projectId];
    return record?.id || null;
  }, [manualSchedules]);

  const handleConfirmTentative = useCallback(async (projectId: string, additionalNotes?: string) => {
    setConfirmingTentative(true);
    try {
      const recordId = await resolveMasterTentativeRecordId(projectId);
      const hintedZuperJobUid =
        (detailModal && detailModal.id === projectId ? detailModal.zuperJobUid : undefined) ||
        projects.find((p) => p.id === projectId)?.zuperJobUid;
      if (!recordId) {
        showToast("No tentative record found to confirm", "error");
        return;
      }

      const res = await fetch("/api/zuper/jobs/schedule/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleRecordId: recordId,
          zuperJobUid: hintedZuperJobUid || undefined,
          ...(additionalNotes ? { additionalNotes } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // Move from tentative to confirmed in local state
        setManualSchedules((prev) => ({
          ...prev,
          [projectId]: { ...prev[projectId], isTentative: false, recordId: undefined },
        }));
        showToast(
          data.zuperSynced
            ? `Confirmed & synced to Zuper!`
            : `Confirmed (Zuper sync issue: ${data.zuperError})`
        );
        setDetailModal(null);
        setDetailModalEvent(null);
      } else {
        showToast(data.error || "Failed to confirm", "error");
      }
    } catch {
      showToast("Failed to confirm tentative schedule", "error");
    } finally {
      setConfirmingTentative(false);
    }
  }, [detailModal, projects, resolveMasterTentativeRecordId, showToast]);

  const handleSaveTentativeNotes = useCallback(async (projectId: string, notes: string) => {
    const recordId = manualSchedules[projectId]?.recordId;
    // Update local state immediately so reopen works without refetch
    setManualSchedules((prev) => {
      const existing = prev[projectId];
      if (!existing) return prev;
      const updatedBlob = notes.trim()
        ? (existing.tentativeNotes || "").replace(/Installer Notes:[\s\S]*$/i, "").trimEnd() +
          (notes.trim() ? `\n\nInstaller Notes: ${notes.trim()}` : "")
        : (existing.tentativeNotes || "").replace(/\n*Installer Notes:[\s\S]*$/i, "").trimEnd();
      return { ...prev, [projectId]: { ...existing, tentativeNotes: updatedBlob } };
    });
    // Skip PATCH for local-only tentatives (no DB record)
    if (!recordId) return;
    try {
      await fetch("/api/zuper/schedule-records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, installerNotes: notes.trim() }),
      });
    } catch {
      // Silent failure — notes are saved locally and will be sent on confirm
    }
  }, [manualSchedules]);

  const handleCancelTentative = useCallback(async (projectId: string) => {
    const hasLocalOnlyTentative = !!manualSchedules[projectId]?.isTentative && !manualSchedules[projectId]?.recordId;
    if (hasLocalOnlyTentative) {
      // No DB record — just remove from local state
      setManualSchedules((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      showToast("Tentative schedule removed");
      setDetailModal(null);
      setDetailModalEvent(null);
      return;
    }
    setCancellingTentative(true);
    try {
      const recordId = await resolveMasterTentativeRecordId(projectId);
      if (!recordId) {
        showToast("No tentative record found to cancel", "error");
        return;
      }

      const res = await fetch("/api/zuper/schedule-records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId }),
      });
      if (res.ok) {
        setManualSchedules((prev) => {
          const next = { ...prev };
          delete next[projectId];
          return next;
        });
        showToast("Tentative schedule cancelled");
        setDetailModal(null);
        setDetailModalEvent(null);
      } else {
        const data = await res.json();
        showToast(data.error || "Failed to cancel", "error");
      }
    } catch {
      showToast("Failed to cancel tentative schedule", "error");
    } finally {
      setCancellingTentative(false);
    }
  }, [manualSchedules, resolveMasterTentativeRecordId, showToast]);

  /* ---- One-click reschedule for confirmed installs ---- */
  const handleOneClickReschedule = useCallback(async (project: SchedulerProject, newDate: string, daysOverride?: number) => {
    const adjustedDate = getNextWorkday(newDate);
    const isSurveyOrInsp = project.stage === "survey" || project.stage === "inspection";
    const scheduleType: ScheduleType = project.stage === "survey" ? "survey"
      : project.stage === "inspection" ? "inspection"
      : "installation";

    // Resolve existing crew/assignees from the project
    const location = project.location || "";
    const existingCrew = project.crew || "";
    const existingAssignedTo = project.zuperAssignedTo || [];
    // For surveys/inspections, always 1 day regardless of daysOverride
    const days = isSurveyOrInsp ? 1 : (daysOverride || getEffectiveConstructionDays(project) || project.daysInstall || 2);
    const timezone = LOCATION_TIMEZONES[location] || "America/Denver";

    // For construction, resolve assignee UIDs from existing crew names
    const constructionUsers = liveConstructionAssigneesByLocation[location] || ZUPER_CONSTRUCTION_USERS[location] || [];
    const crewNames = existingCrew.split(",").map((n: string) => n.trim()).filter(Boolean);
    const matchedAssignees = constructionUsers.filter((u: ZuperAssignee) => crewNames.includes(u.name) || existingAssignedTo.includes(u.name));
    const assignees = matchedAssignees.length > 0 ? matchedAssignees : (constructionUsers[0] ? [constructionUsers[0]] : []);

    // For survey/inspection reschedule, preserve existing appointment times from Zuper.
    // Extract hours/minutes in the PROJECT's timezone (not the viewer's local TZ).
    let existingStartTime: string | undefined;
    let existingEndTime: string | undefined;
    if (isSurveyOrInsp && project.zuperScheduledStart) {
      try {
        const extractTimeInTz = (isoStr: string, tz: string): string => {
          const dt = new Date(isoStr);
          const parts = new Intl.DateTimeFormat("en-US", {
            hour: "numeric", minute: "numeric", hour12: false, timeZone: tz,
          }).formatToParts(dt);
          const h = parts.find(p => p.type === "hour")?.value || "08";
          const m = parts.find(p => p.type === "minute")?.value || "00";
          return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
        };
        existingStartTime = extractTimeInTz(project.zuperScheduledStart, timezone);
        if (project.zuperScheduledEnd) {
          existingEndTime = extractTimeInTz(project.zuperScheduledEnd, timezone);
        }
      } catch { /* fall through to defaults */ }
    }

    let assigneeName: string;
    let crewUids: string;
    let teamUid: string;

    if (isSurveyOrInsp) {
      const users = project.stage === "survey"
        ? (ZUPER_SURVEY_USERS[location] || [])
        : (ZUPER_INSPECTION_USERS[location] || []);
      const matched = users.find((u: ZuperAssignee) => existingAssignedTo.includes(u.name) || u.name === existingCrew);
      const assignee = matched || users[0];
      assigneeName = assignee?.name || existingCrew || "Unassigned";
      crewUids = assignee?.userUid || "";
      teamUid = assignee?.teamUid || "";
    } else {
      assigneeName = assignees.map((a: ZuperAssignee) => a.name).join(", ") || existingCrew || "Unassigned";
      crewUids = assignees.map((a: ZuperAssignee) => a.userUid).filter(Boolean).join(",");
      teamUid = ZUPER_CONSTRUCTION_DIRECTORS[location]?.teamUid || assignees[0]?.teamUid || "";
    }

    trackFeature(`${scheduleType}-rescheduled`, `${scheduleType} rescheduled via one-click`, {
      scheduler: "master",
      projectId: project.id,
      projectName: project.name,
      date: adjustedDate,
      stage: project.stage,
      days,
      crew: assigneeName,
      syncToZuper: true,
      isReschedule: true,
    });

    // Save previous state for rollback on failure
    let previousSchedule: typeof manualSchedules[string] | undefined;
    setManualSchedules((prev) => {
      previousSchedule = prev[project.id];
      return {
        ...prev,
        [project.id]: {
          startDate: adjustedDate,
          days,
          crew: assigneeName,
          isTentative: false,
          scheduleType,
        },
      };
    });

    // Sync to Zuper + HubSpot + Google Calendar + email
    setReschedulingProjectId(project.id);
    try {
      const response = await fetch("/api/zuper/jobs/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: {
            id: project.id,
            name: project.name,
            address: project.address,
            city: "",
            state: "",
            systemSizeKw: project.systemSize,
            batteryCount: project.batteries,
            projectType: project.type,
            zuperJobUid: project.zuperJobUid,
          },
          schedule: {
            type: scheduleType,
            date: adjustedDate,
            days,
            startTime: existingStartTime || "08:00",
            endTime: existingEndTime || (isSurveyOrInsp ? "09:00" : "16:00"),
            crew: crewUids,
            teamUid,
            assignedUser: assigneeName,
            timezone,
            notes: `Rescheduled via Master Schedule — ${assigneeName}`,
          },
          rescheduleOnly: true,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.action === "no_job_found") {
          // Roll back — no Zuper job exists to reschedule
          setManualSchedules((prev) => {
            if (previousSchedule) return { ...prev, [project.id]: previousSchedule };
            const next = { ...prev };
            delete next[project.id];
            return next;
          });
          showToast(
            `${getCustomerName(project.name)} — no Zuper job found. Use full schedule modal.`,
            "error"
          );
        } else {
          showToast(
            `${getCustomerName(project.name)} rescheduled to ${formatDateShort(adjustedDate)} — Zuper, calendar & crew notified`
          );
        }
      } else {
        // Roll back on API failure
        setManualSchedules((prev) => {
          if (previousSchedule) return { ...prev, [project.id]: previousSchedule };
          const next = { ...prev };
          delete next[project.id];
          return next;
        });
        const errData = await response.json().catch(() => ({}));
        console.error("[One-click Reschedule] Zuper sync failed:", errData);
        showToast(
          `${getCustomerName(project.name)} reschedule failed — reverted (${errData.error || response.status})`,
          "error"
        );
      }
    } catch (err) {
      // Roll back on network error
      setManualSchedules((prev) => {
        if (previousSchedule) return { ...prev, [project.id]: previousSchedule };
        const next = { ...prev };
        delete next[project.id];
        return next;
      });
      console.error("[One-click Reschedule] error:", err);
      showToast(
        `${getCustomerName(project.name)} reschedule failed — reverted`,
        "error"
      );
    } finally {
      setReschedulingProjectId(null);
      setDetailModal(null);
      setDetailModalEvent(null);
    }
  }, [trackFeature, getEffectiveConstructionDays, liveConstructionAssigneesByLocation, showToast]);

  type ScheduleType = "survey" | "installation" | "inspection";

  /* ---- Optimizer handlers ---- */

  const handleOptimizeGenerate = useCallback(() => {
    const selectedLocationSet = new Set(
      optimizeLocations.map((loc) => normalizeLocation(loc))
    );

    const eligible = projects.filter((p) => {
      const projectLocation = normalizeLocation(p.location);
      if (p.stage !== "rtb") return false;
      if (p.constructionScheduleDate) return false;
      if (p.zuperJobCategory === "construction" && p.zuperScheduledStart) return false;
      if (p.scheduleDate) return false;
      const ms = manualSchedules[p.id];
      if (ms && ms.scheduleType === "installation") return false;
      if (selectedLocationSet.size > 0 && !selectedLocationSet.has(projectLocation)) return false;
      return true;
    });

    const mapped: OptimizableProject[] = eligible.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      location: normalizeLocation(p.location),
      amount: p.amount,
      stage: p.stage,
      isPE: p.isPE,
      daysInstall: p.daysInstall,
      daysToInstall: p.daysToInstall,
    }));

    const existingBookings = buildExistingBookings();

    const result = generateOptimizedSchedule(
      mapped,
      CREWS,
      ZUPER_CONSTRUCTION_DIRECTORS,
      LOCATION_TIMEZONES,
      {
        preset: optimizePreset,
        existingBookings,
        ...(optimizeStartDate ? { startDate: optimizeStartDate } : {}),
      }
    );

    setOptimizeResult(result);
    if (result.entries.length === 0) showToast("No eligible RTB projects to optimize", "error");
    if (result.skipped.length > 0)
      showToast(`${result.skipped.length} skipped (unmapped location)`, "error");
  }, [projects, manualSchedules, optimizePreset, optimizeLocations, optimizeStartDate, buildExistingBookings, showToast]);

  const handleOptimizeApply = useCallback(async () => {
    if (!optimizeResult?.entries.length) return;
    setOptimizeApplying(true);
    setOptimizeProgress({ current: 0, total: optimizeResult.entries.length, failed: 0 });

    let success = 0;
    let failed = 0;
    for (let i = 0; i < optimizeResult.entries.length; i++) {
      const entry = optimizeResult.entries[i];
      setOptimizeProgress({ current: i + 1, total: optimizeResult.entries.length, failed });

      try {
        const res = await fetch("/api/zuper/jobs/schedule/tentative", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: {
              id: entry.project.id,
              name: entry.project.name,
              address: entry.project.address,
            },
            schedule: {
              type: "installation",
              date: entry.startDate,
              days: entry.days,
              crew: entry.assigneeUserUid || "",
              userUid: entry.assigneeUserUid,
              teamUid: entry.assigneeTeamUid,
              assignedUser: entry.assigneeName || entry.crew,
              timezone: entry.timezone,
              notes: `[AUTO_OPTIMIZED] (${optimizePreset}) — ${entry.crew}`,
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setManualSchedules((prev) => ({
            ...prev,
            [entry.project.id]: {
              startDate: entry.startDate,
              days: entry.days,
              crew: entry.crew,
              isTentative: true,
              recordId: data.record?.id,
              scheduleType: "installation",
              fromOptimizer: true,
            },
          }));
          success++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    showToast(`${success}/${optimizeResult.entries.length} projects tentatively scheduled`);
    setOptimizeResult(null);
    setOptimizeOpen(false);
    setOptimizeApplying(false);
  }, [optimizeResult, optimizePreset, showToast]);

  const handleClearOptimization = useCallback(async () => {
    // Step 1: Identify optimizer entries present in local state
    const localOptimizerEntries = Object.entries(manualSchedules).filter(
      ([, v]) => v.isTentative && v.fromOptimizer
    );
    const localOnlyProjectIds = localOptimizerEntries
      .filter(([, v]) => !v.recordId)
      .map(([projectId]) => projectId);

    // Step 2: Fetch ALL installation tentative records from DB to find hidden ones
    const projectIds = projects.map((p) => p.id).join(",");
    let dbRecords: Array<{ id: string; projectId: string; notes?: string }> = [];
    try {
      const res = await fetch(
        `/api/zuper/schedule-records?projectIds=${encodeURIComponent(projectIds)}&status=tentative&type=installation`
      );
      if (res.ok) {
        const data = await res.json();
        dbRecords = Object.values(
          data.records as Record<string, { id: string; projectId: string; notes?: string }>
        ).filter((r) => r.notes?.includes("[AUTO_OPTIMIZED]"));
      }
    } catch {
      /* proceed with local-only */
    }

    // Build unique delete targets from both DB query and local DB-backed entries.
    // This keeps clear-all working if DB lookup fails but local tentative records exist.
    const deleteTargets = new Map<string, { id: string; projectId: string }>();
    for (const rec of dbRecords) {
      deleteTargets.set(rec.id, { id: rec.id, projectId: rec.projectId });
    }
    for (const [projectId, entry] of localOptimizerEntries) {
      if (entry.recordId && !deleteTargets.has(entry.recordId)) {
        deleteTargets.set(entry.recordId, { id: entry.recordId, projectId });
      }
    }

    if (localOnlyProjectIds.length === 0 && deleteTargets.size === 0) {
      showToast("No optimizer tentative entries to clear", "error");
      return;
    }

    let cleared = localOnlyProjectIds.length; // local-only entries will always be removed

    // Cancel DB records (includes hidden ones not in manualSchedules)
    const cancelledProjectIds = new Set<string>();
    for (const rec of deleteTargets.values()) {
      try {
        const res = await fetch("/api/zuper/schedule-records", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: rec.id }),
        });
        if (res.ok) {
          cancelledProjectIds.add(rec.projectId);
          cleared++;
        }
      } catch {
        /* continue */
      }
    }

    // Remove from manualSchedules
    setManualSchedules((prev) => {
      const next = { ...prev };
      // Remove local-only optimizer entries
      for (const projectId of localOnlyProjectIds) {
        delete next[projectId];
      }
      // Remove entries whose DB record was successfully cancelled
      for (const pid of cancelledProjectIds) {
        if (next[pid]?.isTentative && next[pid]?.fromOptimizer) {
          delete next[pid];
        }
      }
      return next;
    });

    showToast(`Cleared ${cleared} tentative schedules`);
  }, [projects, manualSchedules, showToast]);

  const handleRemoveScheduled = useCallback(async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      showToast("Project not found", "error");
      return;
    }

    const scheduleType = project.stage === "survey"
      ? "survey"
      : project.stage === "inspection"
        ? "inspection"
        : "installation";

    setManualSchedules((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });

    try {
      const res = await fetch("/api/zuper/jobs/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName: project.name,
          zuperJobUid: project.zuperJobUid || null,
          scheduleType,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(data?.message || data?.error || "Failed to remove from schedule", "error");
        fetchProjects();
        return;
      }

      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, scheduleDate: null }
            : p
        )
      );
      showToast("Removed from schedule");
      setDetailModal(null);
      setDetailModalEvent(null);
      setTimeout(() => fetchProjects(), 900);
    } catch {
      showToast("Failed to remove from schedule", "error");
      fetchProjects();
    }
  }, [fetchProjects, projects, showToast]);

  const handleDrop = useCallback(
    (e: React.DragEvent, dateStr: string, crewName?: string) => {
      e.preventDefault();
      if (isWeekend(dateStr)) {
        showToast("Cannot schedule on weekends", "error");
        return;
      }
      const projectId = e.dataTransfer.getData("text/plain");
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        const isAlreadyScheduled = !!(project.scheduleDate || manualSchedules[project.id]?.startDate);
        const hasZuperJob = !!project.zuperJobUid;
        const isTentative = !!manualSchedules[project.id]?.isTentative;

        if (isAlreadyScheduled && hasZuperJob && !isTentative) {
          // Show quick confirmation dialog for one-click reschedule
          const isSurveyOrInsp = project.stage === "survey" || project.stage === "inspection";
          const days = isSurveyOrInsp ? 1 : (getEffectiveConstructionDays(project) || project.daysInstall || 2);
          const fromDate = manualSchedules[project.id]?.startDate || project.scheduleDate || "";
          setRescheduleConfirm({
            project: crewName ? { ...project, crew: crewName } : project,
            fromDate,
            toDate: getNextWorkday(dateStr),
            days,
          });
        } else {
          // Unscheduled or tentative — open full schedule modal
          const proj = crewName ? { ...project, crew: crewName } : project;
          openScheduleModal(proj, dateStr);
        }
      }
      setDraggedProjectId(null);
    },
    [projects, manualSchedules, showToast, openScheduleModal, getEffectiveConstructionDays]
  );

  const handleWeekCellClick = useCallback(
    (dateStr: string, crewName: string) => {
      if (!selectedProject) return;
      if (isWeekend(dateStr)) {
        showToast("Cannot schedule on weekends", "error");
        return;
      }
      const proj = { ...selectedProject, crew: crewName };
      setSelectedProject(proj);
      openScheduleModal(proj, dateStr);
    },
    [selectedProject, showToast, openScheduleModal]
  );

  /* ---- Export functions ---- */
  const exportCSV = useCallback(() => {
    const headers = [
      "Project ID",
      "Customer",
      "Address",
      "Location",
      "Amount",
      "Type",
      "Stage",
      "Schedule Date",
      "Days",
      "Crew",
      "Event Type",
    ];
    let csv = headers.join(",") + "\n";
    const eventsToExport = showForecasts ? [...scheduledEvents, ...forecastGhostEvents] : scheduledEvents;
    eventsToExport.forEach((e) => {
      csv +=
        [
          getProjectId(e.name),
          `"${getCustomerName(e.name)}"`,
          `"${e.address}"`,
          e.location,
          e.amount,
          `"${e.type || ""}"`,
          e.stage,
          e.date,
          e.days || e.daysInstall || 2,
          e.crew || "",
          e.isForecast ? "forecast" : e.eventType,
        ].join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pb-schedule-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported");
  }, [scheduledEvents, displayEvents, showForecasts, showToast]);

  const exportICal = useCallback(() => {
    let ical =
      "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//PB Scheduler//EN\n";
    scheduledEvents.filter((e) => !e.isForecast).forEach((e) => {
      const start = e.date.replace(/-/g, "");
      const end = addDays(e.date, Math.ceil(e.days || 1)).replace(/-/g, "");
      ical += `BEGIN:VEVENT\nDTSTART;VALUE=DATE:${start}\nDTEND;VALUE=DATE:${end}\nSUMMARY:${getCustomerName(e.name)} - ${e.crew || "Unassigned"}\nDESCRIPTION:${e.address}\\n$${e.amount.toLocaleString()}\nEND:VEVENT\n`;
    });
    ical += "END:VCALENDAR";
    const blob = new Blob([ical], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pb-schedule.ics";
    a.click();
    URL.revokeObjectURL(url);
    showToast("iCal exported");
  }, [scheduledEvents, showToast]);

  const copySchedule = useCallback(() => {
    let text = "PB Install Schedule\n==================\n\n";
    scheduledEvents.forEach((e) => {
      text += `${formatDateShort(e.date)} - ${getCustomerName(e.name)}\n`;
      text += `  ${e.address}\n`;
      text += `  Assignee(s): ${e.crew || "Unassigned"} | ${e.days || e.daysInstall || 2} days | $${e.amount.toLocaleString()}\n\n`;
    });
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard");
  }, [scheduledEvents, showToast]);

  /* ---- Navigation ---- */
  const prevMonth = useCallback(() => {
    setCurrentMonth((m) => {
      if (m <= 0) {
        setCurrentYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setCurrentMonth((m) => {
      if (m >= 11) {
        setCurrentYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const goToToday = useCallback(() => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  }, []);

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA"
      )
        return;

      if (e.key === "Escape") {
        if (scheduleModal) setScheduleModal(null);
        else if (detailModal) { setDetailModal(null); setDetailModalEvent(null); }
        else if (overlayDetail) { setOverlayDetail(null); }
        else if (selectedProject) setSelectedProject(null);
        return;
      }
      if (e.key === "1" && !e.ctrlKey && !e.metaKey) setCurrentView("calendar");
      if (e.key === "2" && !e.ctrlKey && !e.metaKey) setCurrentView("week");
      if (e.key === "3" && !e.ctrlKey && !e.metaKey) setCurrentView("gantt");
      if (e.key === "ArrowLeft" && e.altKey) {
        if (currentView === "calendar") prevMonth();
        if (currentView === "week") setWeekOffset((w) => w - 1);
      }
      if (e.key === "ArrowRight" && e.altKey) {
        if (currentView === "calendar") nextMonth();
        if (currentView === "week") setWeekOffset((w) => w + 1);
      }
      if (e.key === "e" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        exportCSV();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    scheduleModal,
    detailModal,
    overlayDetail,
    selectedProject,
    currentView,
    prevMonth,
    nextMonth,
    exportCSV,
  ]);

  /* ================================================================ */
  /*  Sub-components rendered inline                                   */
  /* ================================================================ */

  const canDrop = selectedProject || draggedProjectId;

  /* -- Stage tab helper -- */
  const stageTabs = [
    { key: "survey", label: "Survey" },
    { key: "blocked", label: "Blocked" },
    { key: "rtb", label: "RTB" },
    { key: "construction", label: "Construction" },
    { key: "inspection", label: "Inspection" },
  ];

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  // Prevent hydration mismatch: server renders a shell, client takes over after mount
  if (!mounted) {
    return (
      <div className="h-screen overflow-hidden bg-background text-foreground/90 font-sans flex items-center justify-center">
        <div className="text-muted text-sm animate-pulse">Loading scheduler…</div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground/90 font-sans max-[900px]:h-auto max-[900px]:min-h-screen max-[900px]:overflow-auto">
      {/* Grid layout: project queue | calendar | optional revenue sidebar */}
      <div className={`grid h-full max-[900px]:h-auto max-[900px]:grid-cols-[1fr] ${
        sidebarCollapsed
          ? (revenueSidebarOpen
              ? "grid-cols-[0px_1fr_200px] max-[1400px]:grid-cols-[0px_1fr_180px] max-[1100px]:grid-cols-[0px_1fr]"
              : "grid-cols-[0px_1fr_32px] max-[1100px]:grid-cols-[0px_1fr] max-[900px]:grid-cols-[1fr]")
          : (revenueSidebarOpen
              ? "grid-cols-[360px_1fr_200px] max-[1400px]:grid-cols-[320px_1fr_180px] max-[1100px]:grid-cols-[300px_1fr]"
              : "grid-cols-[360px_1fr_32px] max-[1100px]:grid-cols-[320px_1fr] max-[900px]:grid-cols-[1fr]")
      }`}>
        {/* ============================================================ */}
        {/* LEFT SIDEBAR - Pipeline Queue                                */}
        {/* ============================================================ */}
        <aside className={`bg-surface border-r border-t-border flex flex-col overflow-hidden max-[900px]:max-h-[50vh] max-[900px]:border-r-0 max-[900px]:border-b transition-all duration-200 ${
          sidebarCollapsed ? "w-0 min-w-0 border-r-0 opacity-0 pointer-events-none" : ""
        }`}>
          {/* Header */}
          <header className="p-4 border-b border-t-border bg-gradient-to-br from-[#12121a] to-[#1a1a28]">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-transparent">
                  PB Master Schedule
                </h1>
                <div className="text-[0.65rem] text-muted mt-0.5">
                  RTB + Construction &bull; Live HubSpot Data
                </div>
              </div>
              <div className="flex gap-1.5 items-center">
                <ThemeToggle />
                <button
                  onClick={toggleSidebar}
                  className="px-1.5 py-1.5 text-[0.7rem] rounded-md bg-background border border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-400 transition-colors"
                  title="Collapse sidebar"
                >
                  ◀
                </button>
                <Link
                  href="/"
                  className="px-2.5 py-1.5 text-[0.7rem] rounded-md bg-background border border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-400 transition-colors"
                >
                  &larr; Back
                </Link>
                <button
                  onClick={exportCSV}
                  className="px-2.5 py-1.5 text-[0.7rem] rounded-md bg-background border border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-400 transition-colors"
                  title="Export CSV"
                >
                  CSV
                </button>
                <button
                  onClick={exportICal}
                  className="px-2.5 py-1.5 text-[0.7rem] rounded-md bg-background border border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-400 transition-colors"
                  title="Export iCal"
                >
                  iCal
                </button>
                <button
                  onClick={copySchedule}
                  className="px-2.5 py-1.5 text-[0.7rem] rounded-md bg-background border border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-400 transition-colors"
                  title="Copy schedule to clipboard"
                >
                  Copy
                </button>
              </div>
            </div>
          </header>

          {/* Queue header with filters */}
          <div className="p-3 border-b border-t-border">
            <h2 className="text-[0.8rem] font-semibold mb-2 flex items-center gap-1.5 justify-between">
              <span>Install Pipeline</span>
              <button
                onClick={() => setOptimizeOpen(!optimizeOpen)}
                className="px-2 py-1 text-[0.6rem] rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
              >
                {optimizeOpen ? "Close" : "Optimize"}
              </button>
            </h2>
            {optimizeOpen && (
              <div className="mb-3 p-2.5 rounded-lg bg-surface-2 border border-t-border space-y-2">
                {/* Preset selector */}
                <div className="flex flex-wrap gap-1">
                  {(Object.entries(PRESET_DESCRIPTIONS) as [ScoringPreset, { label: string; desc: string }][])
                    .map(([key, { label }]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setOptimizePreset(key);
                        setOptimizeResult(null);
                      }}
                      className={`px-2 py-0.5 text-[0.55rem] rounded-full border transition-colors ${
                        optimizePreset === key
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-background border-t-border text-muted hover:border-emerald-500"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[0.55rem] text-muted leading-tight">
                  {PRESET_DESCRIPTIONS[optimizePreset].desc}
                </p>

                {/* Location filter */}
                <div className="flex flex-wrap gap-1">
                  {LOCATIONS.filter((l) => l !== "All").map((loc) => (
                    <button
                      key={loc}
                      onClick={() => {
                        setOptimizeLocations((prev) =>
                          prev.includes(loc)
                            ? prev.filter((l) => l !== loc)
                            : [...prev, loc]
                        );
                        setOptimizeResult(null);
                      }}
                      className={`px-2 py-0.5 text-[0.55rem] rounded-full border transition-colors ${
                        optimizeLocations.length === 0 || optimizeLocations.includes(loc)
                          ? "bg-emerald-600/80 text-white border-emerald-600"
                          : "bg-background border-t-border text-muted hover:border-emerald-500"
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
                {optimizeLocations.length > 0 && (
                  <button
                    onClick={() => {
                      setOptimizeLocations([]);
                      setOptimizeResult(null);
                    }}
                    className="text-[0.5rem] text-muted hover:text-foreground transition-colors"
                  >
                    Reset to all locations
                  </button>
                )}

                {/* Start date filter */}
                <div className="flex items-center gap-2">
                  <label className="text-[0.55rem] text-muted whitespace-nowrap">Schedule after:</label>
                  <input
                    type="date"
                    value={optimizeStartDate}
                    onChange={(e) => {
                      setOptimizeStartDate(e.target.value);
                      setOptimizeResult(null);
                    }}
                    className="flex-1 px-2 py-0.5 text-[0.55rem] rounded-md bg-background border border-t-border text-foreground"
                  />
                  {optimizeStartDate && (
                    <button
                      onClick={() => {
                        setOptimizeStartDate("");
                        setOptimizeResult(null);
                      }}
                      className="text-[0.5rem] text-muted hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Generate button */}
                <button
                  onClick={handleOptimizeGenerate}
                  disabled={optimizeApplying}
                  className="w-full px-2 py-1.5 text-[0.6rem] rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Generate Schedule
                </button>

                {/* Preview results */}
                {optimizeResult && optimizeResult.entries.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[0.6rem] text-muted">
                      {optimizeResult.entries.length} projects · $
                      {(optimizeResult.entries.reduce((s, e) => s + e.project.amount, 0) / 1000).toFixed(0)}k revenue
                      {optimizeResult.skipped.length > 0 && (
                        <span className="text-amber-400"> · {optimizeResult.skipped.length} skipped</span>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {optimizeResult.entries.map((entry) => (
                        <div
                          key={entry.project.id}
                          className="flex items-center gap-1.5 text-[0.55rem] p-1 rounded bg-background"
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: entry.crewColor }}
                          />
                          <span className="truncate flex-1 text-foreground">{entry.project.name}</span>
                          <span className="text-muted shrink-0">{entry.crew.split(" ").pop()}</span>
                          <span className="text-muted shrink-0">{entry.startDate.slice(5)}</span>
                          <span className="text-muted shrink-0">{entry.days}d</span>
                        </div>
                      ))}
                    </div>

                    {/* Apply button with progress */}
                    {optimizeApplying ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[0.55rem] text-muted">
                          <span>Applying...</span>
                          <span>
                            {optimizeProgress.current}/{optimizeProgress.total}
                            {optimizeProgress.failed > 0 && (
                              <span className="text-red-400"> ({optimizeProgress.failed} failed)</span>
                            )}
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-background overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all"
                            style={{
                              width: `${optimizeProgress.total > 0 ? (optimizeProgress.current / optimizeProgress.total) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={handleOptimizeApply}
                        className="w-full px-2 py-1.5 text-[0.6rem] rounded-md bg-amber-600 text-white hover:bg-amber-500 transition-colors"
                      >
                        Apply as Tentative
                      </button>
                    )}
                  </div>
                )}

                {/* Clear Optimization button — always available when panel is open */}
                <button
                  onClick={handleClearOptimization}
                  disabled={optimizeApplying}
                  className="w-full px-2 py-1.5 text-[0.6rem] rounded-md bg-red-600/80 text-white hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear Optimization
                </button>
              </div>
            )}
            {/* Stage tabs */}
            <div className="flex flex-wrap gap-1 mb-2">
              {stageTabs.map((st) => (
                <button
                  key={st.key}
                  onClick={() => {
                    if (selectedStages.includes(st.key)) {
                      setSelectedStages(selectedStages.filter(s => s !== st.key));
                    } else {
                      setSelectedStages([...selectedStages, st.key]);
                    }
                    setSelectedProject(null);
                  }}
                  className={`px-2 py-1 text-[0.6rem] rounded border transition-colors ${
                    selectedStages.includes(st.key)
                      ? STAGE_TAB_ACTIVE[st.key]
                      : "bg-background border-t-border text-muted hover:border-muted"
                  }`}
                >
                  {st.label}
                </button>
              ))}
              {selectedStages.length > 0 && (
                <button
                  onClick={() => { setSelectedStages([]); setSelectedProject(null); }}
                  className="px-1.5 py-0.5 text-[0.6rem] text-muted hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
            {/* Filters */}
            <div className="flex flex-col gap-1">
              <input
                type="text"
                placeholder="Search projects..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded-md text-[0.7rem] focus:outline-none focus:border-orange-500 placeholder:text-muted/70"
              />
              {/* Job type toggle buttons */}
              <div className="flex flex-wrap gap-1">
                {["Solar Only", "Battery Only", "Solar + Battery", "EV"].map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      if (typeFilters.includes(type)) {
                        setTypeFilters(typeFilters.filter(t => t !== type));
                      } else {
                        setTypeFilters([...typeFilters, type]);
                      }
                    }}
                    className={`px-2 py-1 text-[0.6rem] rounded border transition-colors ${
                      typeFilters.includes(type)
                        ? "bg-orange-500 border-orange-400 text-black"
                        : "bg-background border-t-border text-muted hover:border-muted"
                    }`}
                  >
                    {type === "EV" ? "EV Charger" : type}
                  </button>
                ))}
                {/* Sort dropdown */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="px-1.5 py-1 text-[0.6rem] rounded border bg-background border-t-border text-muted hover:border-muted focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  <option value="amount">Sort: Revenue</option>
                  <option value="location">Sort: Location</option>
                  <option value="type">Sort: Job Category</option>
                  <option value="date">Sort: Date</option>
                  <option value="days">Sort: Days</option>
                </select>
              </div>
              {/* Multi-select Location Filter */}
              <div className="flex flex-wrap gap-1 mt-1">
                {LOCATIONS.filter(l => l !== "All").map((loc) => (
                  <button
                    key={loc}
                    onClick={() => {
                      if (selectedLocations.includes(loc)) {
                        setSelectedLocations(selectedLocations.filter(l => l !== loc));
                      } else {
                        setSelectedLocations([...selectedLocations, loc]);
                      }
                    }}
                    className={`px-1.5 py-0.5 text-[0.6rem] rounded border transition-colors ${
                      selectedLocations.includes(loc)
                        ? "bg-orange-500 border-orange-400 text-black"
                        : "bg-background border-t-border text-muted hover:border-muted"
                    }`}
                  >
                    {loc.replace("Colorado Springs", "CO Spgs").replace("San Luis Obispo", "SLO")}
                  </button>
                ))}
                {selectedLocations.length > 0 && (
                  <button
                    onClick={() => setSelectedLocations([])}
                    className="px-1.5 py-0.5 text-[0.6rem] text-muted hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Queue count */}
          <div className="text-[0.65rem] text-muted px-3 py-2 border-b border-t-border bg-background flex justify-between">
            <span>{filteredProjects.length} projects</span>
            <span>${queueRevenue}</span>
          </div>
          {/* Scheduled vs Needs Scheduling breakdown for survey/inspection */}
          {(() => {
            const showBreakdown = selectedStages.length > 0
              ? selectedStages.every(s => s === "survey" || s === "inspection")
              : filteredProjects.length > 0 && filteredProjects.every(p => p.stage === "survey" || p.stage === "inspection");
            if (!showBreakdown) return null;
            const surveyOrInspect = filteredProjects.filter(p => p.stage === "survey" || p.stage === "inspection");
            if (surveyOrInspect.length === 0) return null;
            const scheduled = surveyOrInspect.filter(p => !!manualSchedules[p.id] || !!p.scheduleDate).length;
            const unscheduled = surveyOrInspect.length - scheduled;
            if (scheduled === 0 && unscheduled === 0) return null;
            return (
              <div className="text-[0.6rem] text-muted px-3 py-1.5 border-b border-t-border bg-surface flex gap-3">
                {unscheduled > 0 && <span className="text-amber-400">{unscheduled} needs scheduling</span>}
                {scheduled > 0 && <span className="text-blue-400">{scheduled} scheduled</span>}
              </div>
            );
          })()}

          {/* Queue list */}
          <div className="flex-1 overflow-y-auto p-2">
            {loading && (
              <div className="p-8 text-center text-muted">
                Loading projects from HubSpot...
              </div>
            )}
            {error && (
              <div className="p-8 text-center text-red-400">
                <div>Error loading data</div>
                <div className="text-[0.7rem] mt-2">{error}</div>
                <button
                  onClick={fetchProjects}
                  className="mt-4 px-3 py-1.5 bg-orange-500 text-black rounded-md text-sm cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}
            {!loading &&
              !error &&
              (() => {
                // Only show survey/inspection grouping when exclusively viewing those stages
                const showSIGrouping = selectedStages.length > 0
                  ? selectedStages.every(s => s === "survey" || s === "inspection")
                  : filteredProjects.length > 0 && filteredProjects.every(p => p.stage === "survey" || p.stage === "inspection");
                // Sort survey/inspection: unscheduled first for visibility (only when grouping)
                const sorted = showSIGrouping
                  ? [...filteredProjects].sort((a, b) => {
                      const aIsSI = a.stage === "survey" || a.stage === "inspection";
                      const bIsSI = b.stage === "survey" || b.stage === "inspection";
                      if (!aIsSI || !bIsSI) return 0;
                      const aSched = !!(manualSchedules[a.id] || a.scheduleDate);
                      const bSched = !!(manualSchedules[b.id] || b.scheduleDate);
                      if (aSched === bSched) return 0;
                      return aSched ? 1 : -1; // unscheduled first
                    })
                  : filteredProjects;
                return sorted.map((p, _idx, arr) => {
                const customerName = getCustomerName(p.name);
                const types = (p.type || "")
                  .split(";")
                  .filter((t) => t.trim());
                const isScheduled = !!manualSchedules[p.id] || !!p.scheduleDate;
                const schedDate =
                  manualSchedules[p.id]?.startDate || p.scheduleDate;
                const isSurveyOrInspection =
                  p.stage === "survey" || p.stage === "inspection";
                // Determine if we need a sub-group header for survey/inspection grouping
                const siGroupKey = isSurveyOrInspection ? `${p.stage}-${isScheduled ? "sched" : "unsched"}` : "";
                const prevProject = _idx > 0 ? arr[_idx - 1] : null;
                const prevIsSI = prevProject ? (prevProject.stage === "survey" || prevProject.stage === "inspection") : false;
                const prevScheduled = prevProject ? !!(manualSchedules[prevProject.id] || prevProject.scheduleDate) : false;
                const prevGroupKey = prevIsSI ? `${prevProject!.stage}-${prevScheduled ? "sched" : "unsched"}` : "";
                const showGroupHeader = showSIGrouping && isSurveyOrInspection && siGroupKey !== prevGroupKey;

                return (
                  <React.Fragment key={p.id}>
                    {showGroupHeader && (
                      <div className="flex items-center gap-2 px-1 pt-2 pb-1">
                        <div className={`text-[0.6rem] font-semibold uppercase tracking-wider ${
                          isScheduled ? "text-blue-400" : "text-amber-400"
                        }`}>
                          {isScheduled ? "✓ Scheduled" : "⚠ Needs Scheduling"}
                        </div>
                        <div className="flex-1 border-t border-t-border" />
                      </div>
                    )}
                    <div
                      draggable
                      onDragStart={(e) => handleDragStart(e, p.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => handleSelectProject(p.id)}
                      className={`bg-background border rounded-lg p-2.5 mb-1.5 cursor-grab transition-all hover:border-orange-500 hover:translate-x-0.5 border-l-[3px] ${
                        STAGE_BORDER_COLORS[p.stage] || "border-l-zinc-600"
                      } ${
                        selectedProject?.id === p.id
                          ? "border-orange-500 bg-orange-500/10 shadow-[0_0_0_1px] shadow-orange-500"
                          : "border-t-border"
                      } ${
                        draggedProjectId === p.id ? "opacity-60" : ""
                      }`}
                  >
                    <div className="flex justify-between items-start mb-0.5">
                      <div
                        className="text-[0.7rem] font-semibold truncate max-w-[180px]"
                        title={p.name}
                      >
                        {customerName}
                      </div>
                      <div className="font-mono text-[0.65rem] text-orange-400 font-semibold">
                        {formatCurrency(p.amount)}
                      </div>
                    </div>
                    <div
                      className="text-[0.6rem] text-muted mb-1 truncate"
                      title={p.address}
                    >
                      {p.address}
                    </div>
                    <div className="flex gap-1 flex-wrap items-center">
                      <span
                        className={`text-[0.5rem] px-1 py-0.5 rounded ${
                          p.stage === "rtb"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : p.stage === "blocked"
                              ? "bg-yellow-500/20 text-yellow-400"
                              : p.stage === "construction"
                                ? "bg-blue-500/20 text-blue-400"
                                : p.stage === "survey"
                                  ? "bg-cyan-500/20 text-cyan-400"
                                  : p.stage === "inspection"
                                    ? "bg-violet-500/20 text-violet-400"
                                    : "bg-surface-2 text-muted"
                        }`}
                      >
                        {STAGE_ICONS[p.stage] || p.stage}
                      </span>
                      {p.isPE && (
                        <span className="text-[0.5rem] px-1 py-0.5 rounded bg-green-500/20 text-green-400 font-semibold">
                          PE
                        </span>
                      )}
                      {isScheduled && (
                        <span className="text-[0.5rem] px-1 py-0.5 rounded bg-blue-500/30 text-blue-400 font-semibold">
                          {formatShortDate(schedDate)}
                        </span>
                      )}
                      {!isScheduled && isSurveyOrInspection && (
                        <span className="text-[0.5rem] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">
                          Unsched
                        </span>
                      )}
                      {p.zuperJobUid && (
                        <a
                          href={`${zuperWebBaseUrl}/jobs/${p.zuperJobUid}/details`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[0.5rem] px-1 py-0.5 rounded bg-cyan-500/30 text-cyan-400 font-semibold hover:bg-cyan-500/50"
                          title="Open in Zuper"
                        >
                          Zuper
                        </a>
                      )}
                      <a
                        href={p.hubspotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[0.5rem] px-1 py-0.5 rounded bg-orange-500/30 text-orange-400 font-semibold hover:bg-orange-500/50"
                        title="Open in HubSpot"
                      >
                        HubSpot
                      </a>
                      {types.slice(0, 2).map((t, i) => (
                        <span
                          key={i}
                          className={`text-[0.5rem] px-1 py-0.5 rounded ${
                            t.toLowerCase().includes("solar")
                              ? "bg-cyan-500/20 text-cyan-400"
                              : t.toLowerCase().includes("battery")
                                ? "bg-purple-500/20 text-purple-400"
                                : "bg-surface-2 text-muted"
                          }`}
                        >
                          {t.trim()}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      {p.systemSize > 0 && (
                        <span className="text-[0.55rem] text-muted">
                          <strong className="text-foreground/80">
                            {p.systemSize.toFixed(1)}
                          </strong>{" "}
                          kW
                        </span>
                      )}
                      {p.moduleCount > 0 && (
                        <span className="text-[0.55rem] text-muted">
                          <strong className="text-foreground/80">
                            {p.moduleCount}
                          </strong>{" "}
                          mod
                        </span>
                      )}
                      {p.inverterCount > 0 && (
                        <span className="text-[0.55rem] text-muted">
                          <strong className="text-foreground/80">
                            {p.inverterCount}
                          </strong>{" "}
                          inv
                        </span>
                      )}
                      {p.batteries > 0 && (
                        <span className="text-[0.55rem] text-muted">
                          <strong className="text-foreground/80">
                            {p.batteries}
                          </strong>{" "}
                          batt
                        </span>
                      )}
                      {p.batteryExpansion > 0 && (
                        <span className="text-[0.55rem] text-muted">
                          <strong className="text-foreground/80">
                            +{p.batteryExpansion}
                          </strong>{" "}
                          exp
                        </span>
                      )}
                      {p.evCount > 0 && (
                        <span className="text-[0.55rem] text-muted">
                          <strong className="text-foreground/80">{p.evCount}</strong>{" "}
                          EV
                        </span>
                      )}
                    </div>
                    {isSurveyOrInspection ? (
                      <div className="flex gap-1.5 mt-0.5 flex-wrap">
                        {p.ahj && (
                          <span className="text-[0.55rem] text-muted">
                            AHJ: {p.ahj}
                          </span>
                        )}
                        {p.utility && (
                          <span className="text-[0.55rem] text-muted">
                            Util: {p.utility}
                          </span>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-1.5 mt-0.5 flex-wrap">
                          {p.daysInstall > 0 && (
                            <span className="text-[0.55rem] text-muted">
                              <strong className="text-foreground/80">
                                {p.daysInstall}
                              </strong>
                              d inst
                            </span>
                          )}
                          {p.daysElec > 0 && (
                            <span className="text-[0.55rem] text-muted">
                              <strong className="text-foreground/80">
                                {p.daysElec}
                              </strong>
                              d elec
                            </span>
                          )}
                          {!p.daysInstall && !p.daysElec && p.totalDays > 0 && (
                            <span className="text-[0.55rem] text-muted">
                              <strong className="text-foreground/80">
                                {p.totalDays}
                              </strong>
                              d
                            </span>
                          )}
                          {p.roofersCount > 0 && (
                            <span className="text-[0.55rem] text-muted">
                              Inst:{p.roofersCount}
                            </span>
                          )}
                          {p.electriciansCount > 0 && (
                            <span className="text-[0.55rem] text-muted">
                              Elec:{p.electriciansCount}
                            </span>
                          )}
                          {p.difficulty > 0 && (
                            <span className="text-[0.55rem] text-muted">
                              D{p.difficulty}
                            </span>
                          )}
                        </div>
                        {p.installNotes && (
                          <div
                            className="text-[0.55rem] text-muted mt-1 italic truncate"
                            title={p.installNotes}
                          >
                            {p.installNotes}
                          </div>
                        )}
                      </>
                    )}
                    </div>
                  </React.Fragment>
                );
              });
              })()}
          </div>
        </aside>

        {/* ============================================================ */}
        {/* MAIN AREA - Calendar/Week/Gantt                              */}
        {/* ============================================================ */}
        <main className="flex flex-col overflow-hidden max-[900px]:min-h-[60vh]">
          {/* View tabs */}
          <div className="flex gap-0.5 p-2 bg-background border-b border-t-border">
            {sidebarCollapsed && (
              <button
                onClick={toggleSidebar}
                className="px-1.5 py-1 text-[0.65rem] rounded border border-t-border text-muted hover:text-foreground hover:border-orange-500 transition-colors mr-1"
                title="Show project sidebar"
              >
                ▶ Queue
              </button>
            )}
            {(
              [
                { key: "calendar", label: "Month" },
                { key: "week", label: "Week" },
                { key: "gantt", label: "Gantt" },
              ] as const
            ).map((v) => (
              <button
                key={v.key}
                onClick={() => setCurrentView(v.key)}
                className={`flex-1 py-2 text-[0.7rem] font-semibold rounded-md border transition-colors text-center ${
                  currentView === v.key
                    ? "border-orange-500 text-orange-400 bg-orange-500/10"
                    : "bg-surface border-t-border text-muted hover:border-muted"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Calendar Filters — Inline Toggle Boxes */}
          <div className="flex flex-wrap items-center gap-1.5 p-2 bg-background border-b border-t-border">
            <span className="text-[0.6rem] text-muted uppercase tracking-wide mr-0.5">Loc</span>
            {[
              { value: "Westminster", label: "Westy" },
              { value: "Centennial", label: "DTC" },
              { value: "Colorado Springs", label: "CO Spgs" },
              { value: "San Luis Obispo", label: "SLO" },
              { value: "Camarillo", label: "Cam" },
            ].map((loc) => (
              <button
                key={loc.value}
                onClick={() => {
                  if (calendarLocations.includes(loc.value)) {
                    setCalendarLocations(calendarLocations.filter(l => l !== loc.value));
                  } else {
                    setCalendarLocations([...calendarLocations, loc.value]);
                  }
                }}
                className={`px-1.5 py-0.5 text-[0.6rem] rounded border transition-colors ${
                  calendarLocations.includes(loc.value)
                    ? "bg-orange-500 border-orange-400 text-black font-semibold"
                    : "bg-surface border-t-border text-muted hover:border-muted"
                }`}
              >
                {loc.label}
              </button>
            ))}
            <span className="text-[0.6rem] text-muted uppercase tracking-wide ml-2 mr-0.5">Stage</span>
            {([
              { value: "survey", label: "Survey", active: "bg-cyan-500 border-cyan-400 text-black font-semibold" },
              { value: "construction", label: "Construction", active: "bg-blue-500 border-blue-400 text-white font-semibold" },
              { value: "inspection", label: "Inspection", active: "bg-violet-500 border-violet-400 text-white font-semibold" },
            ] as const).map((st) => (
              <button
                key={st.value}
                onClick={() => {
                  if (calendarScheduleTypes.includes(st.value)) {
                    setCalendarScheduleTypes(calendarScheduleTypes.filter(s => s !== st.value));
                  } else {
                    setCalendarScheduleTypes([...calendarScheduleTypes, st.value]);
                  }
                }}
                className={`px-1.5 py-0.5 text-[0.6rem] rounded border transition-colors ${
                  calendarScheduleTypes.includes(st.value)
                    ? st.active
                    : "bg-surface border-t-border text-muted hover:border-muted"
                }`}
              >
                {st.label}
              </button>
            ))}
            {(calendarLocations.length > 0 || calendarScheduleTypes.length > 0) && (
              <button
                onClick={() => { setCalendarLocations([]); setCalendarScheduleTypes([]); }}
                className="px-1.5 py-0.5 text-[0.6rem] text-muted hover:text-foreground transition-colors"
              >
                ✕ Clear
              </button>
            )}
            <div className="ml-auto flex items-center gap-1">
              {([
                { key: "scheduled", label: "Scheduled", color: "bg-blue-500 border-blue-500", active: showScheduled, toggle: () => setShowScheduled(!showScheduled) },
                { key: "incomplete", label: "Incomplete", color: "bg-red-500 border-red-500", active: showIncomplete, toggle: () => setShowIncomplete(!showIncomplete) },
                { key: "completed", label: "Completed", color: "bg-emerald-500 border-emerald-500", active: showCompleted, toggle: () => setShowCompleted(!showCompleted) },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  onClick={t.toggle}
                  className={`flex items-center gap-0.5 px-1.5 py-1 text-[0.6rem] font-medium rounded border transition-colors ${
                    t.active ? "border-t-border text-foreground/80 bg-surface-2" : "border-t-border text-muted opacity-60"
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-sm border flex items-center justify-center shrink-0 ${t.active ? t.color : "border-t-border"}`}>
                    {t.active && <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </span>
                  {t.label}
                </button>
              ))}
              <button
                onClick={toggleForecasts}
                className={`flex items-center gap-1 px-1.5 py-1 text-[0.6rem] font-medium rounded border transition-colors ml-1 ${
                  showForecasts
                    ? "border-blue-400 text-blue-400 bg-blue-500/10"
                    : "border-t-border text-muted opacity-60 hover:border-muted"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full border border-dashed flex items-center justify-center shrink-0 ${
                  showForecasts ? "border-blue-400" : "border-t-border"
                }`}>
                  {showForecasts && <span className="w-1 h-1 rounded-full bg-blue-400" />}
                </span>
                Forecasts
              </button>
              {showForecasts && forecastGhostEvents.length > 0 && (
                <span className="text-[0.55rem] text-blue-400/70 ml-0.5">
                  {forecastGhostEvents.length} forecasted install{forecastGhostEvents.length !== 1 ? "s" : ""}
                </span>
              )}
              <button
                onClick={toggleService}
                className={`flex items-center gap-1 px-1.5 py-1 text-[0.6rem] font-medium rounded border transition-colors ${
                  showService
                    ? "border-purple-400 text-purple-400 bg-purple-500/10"
                    : "border-t-border text-muted opacity-60 hover:border-muted"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full border border-dashed flex items-center justify-center shrink-0 ${
                  showService ? "border-purple-400" : "border-t-border"
                }`}>
                  {showService && <span className="w-1 h-1 rounded-full bg-purple-400" />}
                </span>
                Service
              </button>
              {showService && overlayEvents.filter(e => e.eventType === "service").length > 0 && (
                <span className="text-[0.55rem] text-purple-400/70 ml-0.5">
                  {overlayEvents.filter(e => e.eventType === "service").length} service job{overlayEvents.filter(e => e.eventType === "service").length !== 1 ? "s" : ""}
                </span>
              )}
              <button
                onClick={toggleDnr}
                className={`flex items-center gap-1 px-1.5 py-1 text-[0.6rem] font-medium rounded border transition-colors ${
                  showDnr
                    ? "border-amber-400 text-amber-400 bg-amber-500/10"
                    : "border-t-border text-muted opacity-60 hover:border-muted"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full border border-dashed flex items-center justify-center shrink-0 ${
                  showDnr ? "border-amber-400" : "border-t-border"
                }`}>
                  {showDnr && <span className="w-1 h-1 rounded-full bg-amber-400" />}
                </span>
                D&R
              </button>
              {showDnr && overlayEvents.filter(e => e.eventType === "dnr").length > 0 && (
                <span className="text-[0.55rem] text-amber-400/70 ml-0.5">
                  {overlayEvents.filter(e => e.eventType === "dnr").length} D&R job{overlayEvents.filter(e => e.eventType === "dnr").length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          {/* Calendar container */}
          <div className="flex-1 p-3 overflow-y-auto">
            {/* Instruction banner */}
            {selectedProject && (
              <div className="bg-orange-500/10 border border-orange-500 rounded-lg px-3 py-2 mb-2">
                <span className="text-[0.75rem] text-orange-400">
                  <strong>{getCustomerName(selectedProject.name)}</strong>{" "}
                  selected -- click a day to schedule or drag to calendar
                </span>
              </div>
            )}

            {/* ===== MONTH CALENDAR VIEW ===== */}
            {currentView === "calendar" && (
              <>
                <div className="flex items-center justify-between mb-2 px-2">
                  <button
                    onClick={prevMonth}
                    className="bg-surface border border-t-border text-foreground/80 px-3 py-1.5 rounded-md text-[0.7rem] hover:bg-surface-2 transition-colors"
                  >
                    &larr; Prev
                  </button>
                  <div className="text-base font-semibold">
                    {MONTH_NAMES[currentMonth]} {currentYear}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={nextMonth}
                      className="bg-surface border border-t-border text-foreground/80 px-3 py-1.5 rounded-md text-[0.7rem] hover:bg-surface-2 transition-colors"
                    >
                      Next &rarr;
                    </button>
                    <button
                      onClick={goToToday}
                      className="bg-surface border border-t-border text-foreground/80 px-2 py-1 rounded-md text-[0.65rem] hover:bg-surface-2 transition-colors"
                    >
                      Today
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-0.5 bg-surface-2 rounded-lg overflow-hidden p-0.5">
                  {/* Day headers — weekdays only */}
                  {DAY_NAMES.map((d) => (
                    <div
                      key={d}
                      className="bg-surface py-2 text-center font-semibold text-[0.65rem] text-muted"
                    >
                      {d}
                    </div>
                  ))}

                  {/* Previous month padding (weekdays only) */}
                  {Array.from({ length: calendarData.startDay }).map((_, i) => (
                    <div
                      key={`prev-${i}`}
                      className="bg-surface min-h-[90px] p-1 opacity-40"
                    >
                      <div className="text-[0.7rem] font-semibold text-muted" />
                    </div>
                  ))}

                  {/* Current month weekdays only */}
                  {calendarData.weekdays.map(
                    (day) => {
                      const isToday =
                        calendarData.today.getDate() === day &&
                        calendarData.today.getMonth() === currentMonth &&
                        calendarData.today.getFullYear() === currentYear;
                      const dayEvents = calendarData.eventsByDate[day] || [];
                      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

                      return (
                        <div
                          key={day}
                          className={`bg-surface min-h-[110px] max-h-[180px] overflow-y-auto p-1 relative transition-colors ${
                            isToday
                              ? "ring-2 ring-inset ring-orange-500"
                              : ""
                          } ${
                            canDrop
                              ? "hover:bg-orange-500/10 hover:ring-2 hover:ring-inset hover:ring-orange-500"
                              : ""
                          } cursor-pointer hover:bg-surface-elevated`}
                          onClick={() => handleDayClick(dateStr)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDrop(e, dateStr)}
                        >
                          <div
                            className={`text-[0.7rem] font-semibold mb-0.5 ${
                              isToday ? "text-orange-400" : "text-muted"
                            }`}
                          >
                            {day}
                          </div>
                          {dayEvents.map((ev, ei) => {
                            const shortName = getCustomerName(ev.name).substring(
                              0,
                              10
                            );
                            const dayLabel =
                              ev.totalCalDays > 1 ? `D${ev.dayNum} ` : "";
                            const showRevenue = (ev.eventType === "construction" || ev.eventType === "construction-complete") && ev.amount > 0;
                            const isCompletedType = ev.eventType === "construction-complete" || ev.eventType === "inspection-pass" || ev.eventType === "survey-complete";
                            const isFailedType = ev.eventType === "inspection-fail";
                            const isActiveType = !isCompletedType && !isFailedType;
                            const isDraggable = isActiveType && !ev.isOverdue && !ev.isForecast && !isOverlayEvent(ev);

                            // Completed events use same base color at low opacity
                            const completedColorClass =
                              ev.eventType === "construction-complete" ? "bg-blue-500/30 text-blue-300/70" :
                              ev.eventType === "inspection-pass" ? "bg-violet-500/30 text-violet-300/70" :
                              ev.eventType === "survey-complete" ? "bg-cyan-500/30 text-cyan-300/70" :
                              "bg-zinc-600/30 text-zinc-300/70";

                            // Incomplete events keep their base color but dimmed, with a red ring
                            const overdueColorClass =
                              ev.eventType === "construction" ? "bg-blue-500/60 text-white ring-2 ring-red-500" :
                              ev.eventType === "survey" ? "bg-cyan-500/60 text-white ring-2 ring-red-500" :
                              ev.eventType === "inspection" ? "bg-violet-500/60 text-white ring-2 ring-red-500" :
                              ev.eventType === "rtb" ? "bg-emerald-500/60 text-black ring-2 ring-red-500" :
                              ev.eventType === "blocked" ? "bg-yellow-500/60 text-black ring-2 ring-red-500" :
                              "bg-zinc-600/60 text-white ring-2 ring-red-500";

                            const overlayColor = getOverlayColorClass(ev);
                            const eventColorClass = overlayColor ? overlayColor :
                              isFailedType ? "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through" :
                              isCompletedType ? completedColorClass :
                              ev.isOverdue ? overdueColorClass :
                              ev.isForecast ? "bg-blue-500/40 text-blue-200 border border-dashed border-blue-400 opacity-60" :
                              ev.isTentative ? "bg-amber-500/70 text-black border border-dashed border-amber-300" :
                              ev.eventType === "rtb" ? "bg-emerald-500 text-black" :
                              ev.eventType === "blocked" ? "bg-yellow-500 text-black" :
                              ev.eventType === "construction" ? "bg-blue-500 text-white" :
                              ev.eventType === "survey" ? "bg-cyan-500 text-white" :
                              ev.eventType === "inspection" ? "bg-violet-500 text-white" :
                              ev.eventType === "scheduled" ? "bg-cyan-500 text-white" :
                              "bg-zinc-600 text-white";

                            return (
                              <div
                                key={ei}
                                draggable={isDraggable}
                                onDragStart={(e) => {
                                  if (!isDraggable) { e.preventDefault(); return; }
                                  e.stopPropagation();
                                  handleDragStart(e, ev.id);
                                }}
                                onDragEnd={handleDragEnd}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isOverlayEvent(ev)) { setOverlayDetail(ev); return; }
                                  const proj = projects.find((pr) => pr.id === ev.id) || null;
                                  setDetailModal(proj);
                                  setDetailModalEvent(ev as ScheduledEvent);
                                }}
                                title={isOverlayEvent(ev) ? `${ev.name} — ${ev.eventSubtype}${ev.crew ? ` — ${ev.crew}` : ""}` : ev.isForecast ? "Forecasted install — not yet scheduled" : `${ev.name} - ${ev.crew || "No crew"}${showRevenue ? ` - $${formatRevenueCompact(ev.amount)}` : ""}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : ev.isOverdue ? " ⚠ Incomplete" : " (drag to reschedule)"}`}
                                className={`text-[0.55rem] px-1 py-0.5 rounded mb-0.5 transition-transform hover:scale-[1.02] hover:shadow-lg hover:z-10 relative overflow-hidden truncate ${
                                  isDraggable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
                                } ${eventColorClass} ${draggedProjectId === ev.id ? "opacity-60" : ""}`}
                              >
                                {ev.isForecast && <span className="mr-0.5 text-[0.45rem] font-bold opacity-80">FORECAST</span>}
                                {ev.isTentative && <span className="mr-0.5 text-[0.45rem] font-bold opacity-80">TENT {ev.days > 0 ? `${ev.days}d` : ""}</span>}
                                {isFailedType && <span className="mr-0.5">✗</span>}
                                {isCompletedType && <span className="mr-0.5">✓</span>}
                                {ev.isOverdue && isActiveType && <span className="mr-0.5 text-red-200">!</span>}
                                {isOverlayEvent(ev) && <span className="mr-0.5 text-[0.45rem] font-bold opacity-80">{getOverlayBadge(ev)}</span>}
                                {dayLabel}
                                <span className={isCompletedType ? "line-through" : ""}>{shortName}</span>
                                {ev.isOverdue && isActiveType && (
                                  <span className="ml-0.5 text-[0.45rem] opacity-70">
                                    {ev.eventType === "construction" ? "🔨" : ev.eventType === "survey" ? "📋" : ev.eventType === "inspection" ? "🔍" : ""}
                                  </span>
                                )}
                                {showRevenue && <span className="ml-0.5 opacity-80">${formatRevenueCompact(ev.amount)}</span>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                  )}

                  {/* Next month padding — fill remaining row */}
                  {(() => {
                    const total =
                      calendarData.startDay + calendarData.weekdays.length;
                    const rem = 5 - (total % 5);
                    if (rem < 5) {
                      return Array.from({ length: rem }).map((_, i) => (
                        <div
                          key={`next-${i}`}
                          className="bg-surface min-h-[90px] p-1 opacity-40"
                        >
                          <div className="text-[0.7rem] font-semibold text-muted" />
                        </div>
                      ));
                    }
                    return null;
                  })()}
                </div>
              </>
            )}

            {/* ===== WEEK VIEW ===== */}
            {currentView === "week" && (
              <>
                <div className="flex items-center justify-between mb-3 px-2">
                  <button
                    onClick={() => setWeekOffset((w) => w - 1)}
                    className="bg-surface border border-t-border text-foreground/80 px-3 py-1.5 rounded-md text-[0.7rem] hover:bg-surface-2 transition-colors"
                  >
                    &larr; Prev Week
                  </button>
                  <div className="text-[0.9rem] font-semibold">
                    Week of{" "}
                    {weekDates[0].toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    -{" "}
                    {weekDates[4].toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  <button
                    onClick={() => setWeekOffset((w) => w + 1)}
                    className="bg-surface border border-t-border text-foreground/80 px-3 py-1.5 rounded-md text-[0.7rem] hover:bg-surface-2 transition-colors"
                  >
                    Next Week &rarr;
                  </button>
                </div>

                <div className="grid gap-px bg-surface-2 rounded-lg overflow-hidden" style={{ gridTemplateColumns: "100px repeat(5, 1fr)" }}>
                  {/* Header row */}
                  <div className="bg-background p-2" />
                  {weekDates.map((d, i) => {
                    const isToday =
                      d.toDateString() === todayStr.current;
                    return (
                      <div
                        key={i}
                        className={`p-2.5 text-center text-[0.7rem] font-semibold ${
                          isToday
                            ? "text-orange-400 bg-orange-500/10"
                            : "text-muted bg-surface"
                        }`}
                      >
                        {d.toLocaleDateString("en-US", { weekday: "short" })}
                        <span className="text-base font-bold block mt-0.5 text-foreground/90">
                          {d.getDate()}
                        </span>
                      </div>
                    );
                  })}

                  {/* Location rows */}
                  {(() => {
                    const viewLocations =
                      calendarLocations.length > 0
                        ? calendarLocations
                        : LOCATIONS.filter(l => l !== "All");
                    return viewLocations.map((loc) => (
                      <React.Fragment key={loc}>
                        <div
                          className="bg-background p-2.5 text-[0.7rem] font-semibold flex flex-col gap-1"
                          style={{ borderRight: `3px solid ${LOCATION_COLORS[loc] || "#6b7280"}` }}
                        >
                          <span className="text-foreground/90">{loc.replace("Colorado Springs", "CO Springs").replace("San Luis Obispo", "SLO")}</span>
                        </div>
                        {weekDates.map((d, di) => {
                          const dateStr = toDateStr(d);
                          // Find events that span this date using business days (skip weekends)
                          const dayEvents: { event: DisplayEvent; dayNum: number }[] = [];
                          displayEvents.forEach((e) => {
                            if (e.location !== loc) return;
                            const businessDays = Math.ceil(e.days || 1);
                            const eventStart = new Date(e.date + "T12:00:00");
                            let bDayCount = 0;
                            let calOffset = 0;
                            while (bDayCount < businessDays) {
                              const checkDate = new Date(eventStart);
                              checkDate.setDate(checkDate.getDate() + calOffset);
                              const dow = checkDate.getDay();
                              if (dow !== 0 && dow !== 6) { // Skip weekends
                                if (toDateStr(checkDate) === dateStr) {
                                  dayEvents.push({ event: e, dayNum: bDayCount + 1 });
                                  return; // Found match, done
                                }
                                bDayCount++;
                              }
                              calOffset++;
                            }
                          });
                          // Sort: construction → inspection → survey → other
                          const WEEK_STAGE_ORDER: Record<string, number> = {
                            construction: 0, "construction-complete": 0,
                            inspection: 1, "inspection-pass": 1, "inspection-fail": 1,
                            survey: 2, "survey-complete": 2,
                            dnr: 3, service: 4,
                          };
                          dayEvents.sort((a, b) => {
                            const stageDiff = (WEEK_STAGE_ORDER[a.event.eventType] ?? 9) - (WEEK_STAGE_ORDER[b.event.eventType] ?? 9);
                            if (stageDiff !== 0) return stageDiff;
                            return (a.event.isForecast ? 1 : 0) - (b.event.isForecast ? 1 : 0);
                          });
                          return (
                            <div
                              key={di}
                              className={`bg-surface min-h-[70px] p-1 cursor-pointer transition-colors hover:bg-surface-elevated ${
                                canDrop
                                  ? "hover:bg-orange-500/10 hover:ring-2 hover:ring-inset hover:ring-orange-500"
                                  : ""
                              }`}
                              onClick={() =>
                                handleWeekCellClick(dateStr, loc)
                              }
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) =>
                                handleDrop(e, dateStr, loc)
                              }
                            >
                              {dayEvents.map(({ event: ev, dayNum }, ei) => {
                                const shortName = getCustomerName(
                                  ev.name
                                ).substring(0, 10);
                                const isCompletedType = ev.eventType === "construction-complete" || ev.eventType === "inspection-pass" || ev.eventType === "survey-complete";
                                const isFailedType = ev.eventType === "inspection-fail";
                                const isActiveType = !isCompletedType && !isFailedType;

                                const completedColorClassW =
                                  ev.eventType === "construction-complete" ? "bg-blue-500/30 text-blue-300/70" :
                                  ev.eventType === "inspection-pass" ? "bg-violet-500/30 text-violet-300/70" :
                                  ev.eventType === "survey-complete" ? "bg-cyan-500/30 text-cyan-300/70" :
                                  "bg-zinc-600/30 text-zinc-300/70";

                                const overdueColorClassW =
                                  ev.eventType === "construction" ? "bg-blue-500/60 text-white ring-2 ring-red-500" :
                                  ev.eventType === "survey" ? "bg-cyan-500/60 text-white ring-2 ring-red-500" :
                                  ev.eventType === "inspection" ? "bg-violet-500/60 text-white ring-2 ring-red-500" :
                                  "bg-zinc-600/60 text-white ring-2 ring-red-500";

                                const overlayColorW = getOverlayColorClass(ev);
                                const eventColorClass = overlayColorW ? overlayColorW :
                                  isFailedType ? "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through" :
                                  isCompletedType ? completedColorClassW :
                                  ev.isOverdue ? overdueColorClassW :
                                  ev.isForecast ? "bg-blue-500/40 text-blue-200 border border-dashed border-blue-400 opacity-60" :
                                  ev.isTentative ? "bg-amber-500/70 text-black border border-dashed border-amber-300" :
                                  ev.eventType === "construction" ? "bg-blue-500 text-white" :
                                  ev.eventType === "survey" ? "bg-cyan-500 text-white" :
                                  ev.eventType === "inspection" ? "bg-violet-500 text-white" :
                                  ev.eventType === "scheduled" ? "bg-cyan-500 text-white" :
                                  "bg-zinc-600 text-white";

                                return (
                                  <div
                                    key={ei}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isOverlayEvent(ev)) { setOverlayDetail(ev); return; }
                                      const proj = projects.find((pr) => pr.id === ev.id) || null;
                                      setDetailModal(proj);
                                      setDetailModalEvent(ev as ScheduledEvent);
                                    }}
                                    title={ev.isForecast ? "Forecasted install — not yet scheduled" : `${ev.name}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : ev.isOverdue ? " ⚠ Incomplete" : ""}`}
                                    className={`text-[0.6rem] px-1.5 py-1 rounded mb-1 cursor-pointer transition-transform hover:scale-[1.02] hover:shadow-lg ${eventColorClass}`}
                                  >
                                    {ev.isForecast && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">FORECAST</span>}
                                    {ev.isTentative && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">TENT {ev.days > 0 ? `${ev.days}d` : ""}</span>}
                                    {isFailedType && <span className="mr-0.5">✗</span>}
                                    {isCompletedType && <span className="mr-0.5">✓</span>}
                                    {ev.isOverdue && isActiveType && <span className="mr-0.5 text-red-200">!</span>}
                                    {isOverlayEvent(ev) && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">{getOverlayBadge(ev)}</span>}
                                    {ev.days > 1 ? `D${dayNum} ` : ""}
                                    <span className={isCompletedType ? "line-through" : ""}>{shortName}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ));
                  })()}
                </div>
              </>
            )}

            {/* ===== GANTT VIEW ===== */}
            {currentView === "gantt" && (
              <div className="px-2">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[0.9rem] font-semibold">
                    2-Week Project Timeline
                  </div>
                  <div className="flex gap-3 text-[0.6rem]">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded bg-blue-500" />
                      In Construction
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded bg-cyan-500" />
                      Scheduled
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded bg-emerald-500" />
                      RTB
                    </div>
                  </div>
                </div>

                <div className="bg-surface-2 rounded-lg overflow-hidden">
                  {/* Header timeline */}
                  <div
                    className="grid gap-px"
                    style={{
                      gridTemplateColumns: `140px repeat(${ganttDates.length}, 1fr)`,
                    }}
                  >
                    <div className="bg-background p-1.5 text-[0.7rem] font-semibold">
                      Crew
                    </div>
                    {ganttDates.map((d, i) => {
                      const isToday =
                        d.toDateString() === todayStr.current;
                      return (
                        <div
                          key={i}
                          className={`p-1.5 text-center text-[0.55rem] ${
                            isToday
                              ? "bg-orange-500/10 text-orange-400"
                              : "bg-surface text-muted"
                          }`}
                        >
                          <span className="font-semibold">
                            {d.toLocaleDateString("en-US", {
                              weekday: "short",
                            })}
                          </span>
                          <span className="text-[0.7rem] text-foreground/90 block">
                            {d.getDate()}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Location rows */}
                  {(() => {
                    const viewLocations =
                      calendarLocations.length > 0
                        ? calendarLocations
                        : LOCATIONS.filter(l => l !== "All");
                    return viewLocations.map((loc) => (
                      <div
                        key={loc}
                        className="grid gap-px min-h-[50px]"
                        style={{
                          gridTemplateColumns: `140px repeat(${ganttDates.length}, 1fr)`,
                        }}
                      >
                        <div
                          className="bg-background p-2 text-[0.7rem] font-semibold"
                          style={{ borderLeft: `3px solid ${LOCATION_COLORS[loc] || "#6b7280"}` }}
                        >
                          {loc.replace("Colorado Springs", "CO Springs").replace("San Luis Obispo", "SLO")}
                        </div>
                        {ganttDates.map((d, idx) => (
                          <div
                            key={idx}
                            className="bg-surface relative"
                          >
                            {displayEvents
                              .filter((e) => {
                                if (e.location !== loc) return false;
                                const eventStart = new Date(e.date + "T12:00:00");
                                return (
                                  eventStart.toDateString() ===
                                  d.toDateString()
                                );
                              })
                              .sort((a, b) => {
                                const order: Record<string, number> = {
                                  construction: 0, "construction-complete": 0,
                                  inspection: 1, "inspection-pass": 1, "inspection-fail": 1,
                                  survey: 2, "survey-complete": 2,
                                  dnr: 3, service: 4,
                                };
                                const stageDiff = (order[a.eventType] ?? 9) - (order[b.eventType] ?? 9);
                                if (stageDiff !== 0) return stageDiff;
                                return (a.isForecast ? 1 : 0) - (b.isForecast ? 1 : 0);
                              })
                              .map((e, ei) => {
                                const days = e.days || 1;
                                const calendarDays = Math.ceil(days);
                                const shortName = getCustomerName(
                                  e.name
                                ).substring(0, 12);
                                const amount = formatCurrency(e.amount);
                                const daysLabel =
                                  days < 1
                                    ? `${days * 4}/4d`
                                    : `${days}d`;
                                const isCompletedType = e.eventType === "construction-complete" || e.eventType === "inspection-pass" || e.eventType === "survey-complete";
                                const isFailedType = e.eventType === "inspection-fail";
                                const isActiveType = !isCompletedType && !isFailedType;

                                const completedColorClassG =
                                  e.eventType === "construction-complete" ? "bg-blue-500/30 text-blue-300/70" :
                                  e.eventType === "inspection-pass" ? "bg-violet-500/30 text-violet-300/70" :
                                  e.eventType === "survey-complete" ? "bg-cyan-500/30 text-cyan-300/70" :
                                  "bg-zinc-600/30 text-zinc-300/70";

                                const overdueColorClassG =
                                  e.eventType === "construction" ? "bg-blue-500/60 text-white ring-2 ring-red-500" :
                                  e.eventType === "survey" ? "bg-cyan-500/60 text-white ring-2 ring-red-500" :
                                  e.eventType === "inspection" ? "bg-violet-500/60 text-white ring-2 ring-red-500" :
                                  e.eventType === "rtb" ? "bg-emerald-500/60 text-black ring-2 ring-red-500" :
                                  e.eventType === "blocked" ? "bg-yellow-500/60 text-black ring-2 ring-red-500" :
                                  "bg-zinc-600/60 text-white ring-2 ring-red-500";

                                const overlayColorG = getOverlayColorClass(e);
                                const eventColorClass = overlayColorG ? overlayColorG :
                                  isFailedType ? "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through" :
                                  isCompletedType ? completedColorClassG :
                                  e.isOverdue ? overdueColorClassG :
                                  e.isForecast ? "bg-blue-500/40 text-blue-200 border border-dashed border-blue-400 opacity-60" :
                                  e.isTentative ? "bg-amber-500/70 text-black border border-dashed border-amber-300" :
                                  e.eventType === "construction" ? "bg-blue-500 text-white" :
                                  e.eventType === "rtb" ? "bg-emerald-500 text-black" :
                                  e.eventType === "scheduled" ? "bg-cyan-500 text-white" :
                                  e.eventType === "blocked" ? "bg-yellow-500 text-black" :
                                  e.eventType === "survey" ? "bg-cyan-500 text-white" :
                                  e.eventType === "inspection" ? "bg-violet-500 text-white" :
                                  "bg-zinc-500 text-white";

                                return (
                                  <div
                                    key={ei}
                                    onClick={() => {
                                      if (isOverlayEvent(e)) { setOverlayDetail(e); return; }
                                      const proj = projects.find((pr) => pr.id === e.id) || null;
                                      setDetailModal(proj);
                                      setDetailModalEvent(e as ScheduledEvent);
                                    }}
                                    title={e.isForecast ? "Forecasted install — not yet scheduled" : `${e.name} - ${daysLabel} - ${amount}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : e.isOverdue ? " ⚠ Incomplete" : ""}`}
                                    className={`absolute top-2 bottom-2 rounded flex items-center px-1.5 text-[0.55rem] font-medium cursor-pointer transition-transform hover:scale-y-110 hover:shadow-lg hover:z-10 overflow-hidden truncate ${eventColorClass}`}
                                    style={{
                                      left: 0,
                                      width: `calc(${calendarDays * 100}% + ${calendarDays - 1}px)`,
                                      zIndex: 1,
                                    }}
                                  >
                                    {e.isForecast && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">FORECAST</span>}
                                    {e.isTentative && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">TENT</span>}
                                    {isFailedType && <span className="mr-0.5">✗</span>}
                                    {isCompletedType && <span className="mr-0.5">✓</span>}
                                    {e.isOverdue && isActiveType && <span className="mr-0.5 text-red-200">!</span>}
                                    {isOverlayEvent(e) && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">{getOverlayBadge(e)}</span>}
                                    <span className={isCompletedType ? "line-through" : ""}>{shortName}</span> ({daysLabel})
                                  </div>
                                );
                              })}
                          </div>
                        ))}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ============================================================ */}
        {/* RIGHT SIDEBAR - Weekly Revenue (collapsible)                  */}
        {/* ============================================================ */}
        {revenueSidebarOpen && (
        <aside className="bg-surface border-l border-t-border flex flex-col overflow-y-auto max-[1100px]:hidden">
          <div className="p-2.5 border-b border-t-border flex items-center justify-between">
            <div>
              <h2 className="text-[0.65rem] font-bold text-foreground/90 uppercase tracking-wide">
                Construction Revenue
              </h2>
              {/* Tab toggle */}
              <div className="flex gap-1 mt-1">
                <button
                  onClick={() => setRevenueSidebarTab("weekly")}
                  className={`text-[0.5rem] px-1.5 py-0.5 rounded transition-colors ${revenueSidebarTab === "weekly" ? "bg-orange-500/20 text-orange-400 font-semibold" : "text-muted hover:text-foreground"}`}
                >Weekly</button>
                <button
                  onClick={() => setRevenueSidebarTab("monthly")}
                  className={`text-[0.5rem] px-1.5 py-0.5 rounded transition-colors ${revenueSidebarTab === "monthly" ? "bg-orange-500/20 text-orange-400 font-semibold" : "text-muted hover:text-foreground"}`}
                >Monthly</button>
              </div>
            </div>
            <button
              onClick={() => setRevenueSidebarOpen(false)}
              className="p-1 text-muted hover:text-foreground rounded hover:bg-surface-2 transition-colors"
              title="Close sidebar"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
            </button>
          </div>

          {/* Weekly view */}
          {revenueSidebarTab === "weekly" && (
          <>
          <div className="flex-1 p-2 space-y-0.5">
            {weeklyRevenueSummary.filter((week) => {
              const hasAnyData = week.scheduled.count > 0 || week.completed.count > 0 || week.overdue.count > 0 || week.tentative.count > 0 || week.forecasted.count > 0;
              return hasAnyData || week.isCurrent;
            }).map((week, i) => {
              const hasSched = week.scheduled.count > 0;
              const hasComp = week.completed.count > 0;
              const hasIncomplete = week.overdue.count > 0;
              const hasAny = hasSched || hasComp || hasIncomplete || week.tentative.count > 0 || week.forecasted.count > 0;
              // Only show overdue for past + current week (not future)
              const showIncompleteRow = !week.isFuture;
              return (
                <div
                  key={i}
                  className={`rounded-lg p-2 transition-colors ${
                    week.isCurrent
                      ? "bg-orange-500/10 border border-orange-500/30"
                      : "bg-background border border-t-border/50 hover:border-t-border"
                  }`}
                >
                  <div className={`text-[0.6rem] font-semibold ${hasAny ? "mb-1" : ""} ${week.isCurrent ? "text-orange-400" : "text-muted"}`}>
                    {week.isCurrent ? "▸ " : ""}{week.weekLabel}
                  </div>

                  {/* Scheduled — hidden for past weeks, only if data present */}
                  {!week.isPast && hasSched && (
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-blue-500" />
                        <span className="text-[0.55rem] text-muted">Scheduled</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-blue-400">
                        {week.scheduled.count} · ${formatRevenueCompact(week.scheduled.revenue)}
                      </span>
                    </div>
                  )}

                  {/* Tentative — only show if data present */}
                  {week.tentative.count > 0 && (
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-amber-500" />
                        <span className="text-[0.55rem] text-muted">Tentative</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-amber-400">
                        {week.tentative.count} · ${formatRevenueCompact(week.tentative.revenue)}
                      </span>
                    </div>
                  )}

                  {/* Completed — only show if data present */}
                  {hasComp && (
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-emerald-500" />
                        <span className="text-[0.55rem] text-muted">Complete</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-emerald-400">
                        {week.completed.count} · ${formatRevenueCompact(week.completed.revenue)}
                      </span>
                    </div>
                  )}

                  {/* Incomplete — only for past + current week, only if data present */}
                  {showIncompleteRow && hasIncomplete && (
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-red-500" />
                        <span className="text-[0.55rem] text-muted">Incomplete</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-red-400">
                        {week.overdue.count} · ${formatRevenueCompact(week.overdue.revenue)}
                      </span>
                    </div>
                  )}

                  {/* Forecasted — only show if data present */}
                  {week.forecasted.count > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm border border-dashed border-blue-400 bg-blue-500/40" />
                        <span className="text-[0.55rem] text-muted">Forecasted</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-blue-300 opacity-80">
                        {week.forecasted.count} · ${formatRevenueCompact(week.forecasted.revenue)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Weekly Totals */}
          <div className="p-3 border-t border-t-border bg-surface-2">
            <div className="text-[0.55rem] font-semibold text-muted uppercase tracking-wide mb-1.5">Totals</div>
            {weeklyRevenueSummary.some(w => w.scheduled.count > 0) && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-blue-500" />
                <span className="text-[0.6rem] text-foreground/80">Scheduled</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-blue-400">
                ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.scheduled.revenue, 0))}
              </span>
            </div>
            )}
            {weeklyRevenueSummary.some(w => w.tentative.count > 0) && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-amber-500" />
                <span className="text-[0.6rem] text-foreground/80">Tentative</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-amber-400">
                ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.tentative.revenue, 0))}
              </span>
            </div>
            )}
            {weeklyRevenueSummary.some(w => w.completed.count > 0) && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-emerald-500" />
                <span className="text-[0.6rem] text-foreground/80">Completed</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-emerald-400">
                ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.completed.revenue, 0))}
              </span>
            </div>
            )}
            {weeklyRevenueSummary.some(w => w.overdue.count > 0) && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-red-500" />
                <span className="text-[0.6rem] text-foreground/80">Incomplete</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-red-400">
                ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.overdue.revenue, 0))}
              </span>
            </div>
            )}
            {weeklyRevenueSummary.some(w => w.forecasted.count > 0) && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm border border-dashed border-blue-400 bg-blue-500/40" />
                <span className="text-[0.6rem] text-foreground/80">Forecasted</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-blue-300 opacity-80">
                ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.forecasted.revenue, 0))}
              </span>
            </div>
            )}
          </div>
          </>
          )}

          {/* Monthly view */}
          {revenueSidebarTab === "monthly" && (
          <>
          <div className="flex-1 p-2 space-y-0.5">
            {monthlyRevenueSummary.filter((month) => {
              const hasAnyData = month.scheduled.count > 0 || month.completed.count > 0 || month.overdue.count > 0 || month.tentative.count > 0 || month.forecasted.count > 0;
              return hasAnyData || month.isCurrent;
            }).map((month, i) => {
              const hasSched = month.scheduled.count > 0;
              const hasComp = month.completed.count > 0;
              const hasIncomplete = month.overdue.count > 0;
              const hasAny = hasSched || hasComp || hasIncomplete || month.tentative.count > 0 || month.forecasted.count > 0;
              const showIncompleteRow = month.isPast || month.isCurrent;
              return (
                <div
                  key={i}
                  className={`rounded-lg p-2 transition-colors ${
                    month.isCurrent
                      ? "bg-orange-500/10 border border-orange-500/30"
                      : "bg-background border border-t-border/50 hover:border-t-border"
                  }`}
                >
                  <div className={`text-[0.6rem] font-semibold ${hasAny ? "mb-1" : ""} ${month.isCurrent ? "text-orange-400" : "text-muted"}`}>
                    {month.isCurrent ? "▸ " : ""}{month.monthLabel}
                  </div>

                  {/* Scheduled — hidden for past months, only if data present */}
                  {!month.isPast && hasSched && (
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-blue-500" />
                        <span className="text-[0.55rem] text-muted">Scheduled</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-blue-400">
                        {month.scheduled.count} · ${formatRevenueCompact(month.scheduled.revenue)}
                      </span>
                    </div>
                  )}

                  {/* Tentative — only show if data present */}
                  {month.tentative.count > 0 && (
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-amber-500" />
                        <span className="text-[0.55rem] text-muted">Tentative</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-amber-400">
                        {month.tentative.count} · ${formatRevenueCompact(month.tentative.revenue)}
                      </span>
                    </div>
                  )}

                  {/* Completed — only show if data present */}
                  {hasComp && (
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-emerald-500" />
                        <span className="text-[0.55rem] text-muted">Complete</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-emerald-400">
                        {month.completed.count} · ${formatRevenueCompact(month.completed.revenue)}
                      </span>
                    </div>
                  )}

                  {/* Incomplete — only for past + current month, only if data present */}
                  {showIncompleteRow && hasIncomplete && (
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-red-500" />
                        <span className="text-[0.55rem] text-muted">Incomplete</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-red-400">
                        {month.overdue.count} · ${formatRevenueCompact(month.overdue.revenue)}
                      </span>
                    </div>
                  )}

                  {/* Forecasted — only show if data present */}
                  {month.forecasted.count > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm border border-dashed border-blue-400 bg-blue-500/40" />
                        <span className="text-[0.55rem] text-muted">Forecasted</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-blue-300 opacity-80">
                        {month.forecasted.count} · ${formatRevenueCompact(month.forecasted.revenue)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Monthly Totals */}
          <div className="p-3 border-t border-t-border bg-surface-2">
            <div className="text-[0.55rem] font-semibold text-muted uppercase tracking-wide mb-1.5">Totals</div>
            {monthlyRevenueSummary.some(m => m.scheduled.count > 0) && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-blue-500" />
                <span className="text-[0.6rem] text-foreground/80">Scheduled</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-blue-400">
                ${formatRevenueCompact(monthlyRevenueSummary.reduce((s, m) => s + m.scheduled.revenue, 0))}
              </span>
            </div>
            )}
            {monthlyRevenueSummary.some(m => m.tentative.count > 0) && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-amber-500" />
                <span className="text-[0.6rem] text-foreground/80">Tentative</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-amber-400">
                ${formatRevenueCompact(monthlyRevenueSummary.reduce((s, m) => s + m.tentative.revenue, 0))}
              </span>
            </div>
            )}
            {monthlyRevenueSummary.some(m => m.completed.count > 0) && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-emerald-500" />
                <span className="text-[0.6rem] text-foreground/80">Completed</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-emerald-400">
                ${formatRevenueCompact(monthlyRevenueSummary.reduce((s, m) => s + m.completed.revenue, 0))}
              </span>
            </div>
            )}
            {monthlyRevenueSummary.some(m => m.overdue.count > 0) && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-red-500" />
                <span className="text-[0.6rem] text-foreground/80">Incomplete</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-red-400">
                ${formatRevenueCompact(monthlyRevenueSummary.reduce((s, m) => s + m.overdue.revenue, 0))}
              </span>
            </div>
            )}
            {monthlyRevenueSummary.some(m => m.forecasted.count > 0) && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm border border-dashed border-blue-400 bg-blue-500/40" />
                <span className="text-[0.6rem] text-foreground/80">Forecasted</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-blue-300 opacity-80">
                ${formatRevenueCompact(monthlyRevenueSummary.reduce((s, m) => s + m.forecasted.revenue, 0))}
              </span>
            </div>
            )}
          </div>
          </>
          )}
        </aside>
        )}
        {/* Collapsed sidebar toggle — thin strip to reopen */}
        {!revenueSidebarOpen && (
          <button
            onClick={() => setRevenueSidebarOpen(true)}
            className="bg-surface border-l border-t-border flex flex-col items-center justify-center gap-1.5 py-4 max-[1100px]:hidden cursor-pointer hover:bg-surface-2 transition-colors group"
            style={{ width: "32px" }}
            title="Show construction revenue sidebar"
          >
            <svg className="w-4 h-4 text-muted group-hover:text-orange-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            <span className="text-[0.5rem] text-muted group-hover:text-foreground/80 font-medium tracking-wide [writing-mode:vertical-lr] transition-colors">Construction Revenue</span>
          </button>
        )}
      </div>

      {/* ============================================================ */}
      {/* SCHEDULE MODAL                                                */}
      {/* ============================================================ */}
      {scheduleModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setScheduleModal(null);
          }}
        >
          <div className="bg-surface border border-t-border rounded-xl p-5 max-w-[500px] w-[90%] max-h-[85vh] overflow-y-auto">
            <h3 className="text-base mb-3 flex items-center gap-2">
              {scheduleModal.project.stage === "survey"
                ? "Schedule Survey"
                : scheduleModal.project.stage === "inspection"
                  ? "Schedule Inspection"
                  : "Schedule Install"}
            </h3>
            <div className="mb-4 space-y-3">
              {/* Project Info */}
              <ModalSection title="Project">
                <ModalRow label="Customer" value={getCustomerName(scheduleModal.project.name)} />
                <ModalRow label="Address" value={scheduleModal.project.address} />
                <ModalRow label="Location" value={scheduleModal.project.location} />
                <ModalRow
                  label="Type"
                  value={(scheduleModal.project.type || "Service")
                    .split(";")
                    .filter((t) => t.trim())
                    .join(", ")}
                />
                <ModalRow
                  label="Amount"
                  value={`$${scheduleModal.project.amount.toLocaleString()}`}
                  valueClass="text-orange-400 font-semibold"
                />
                <ModalRow
                  label="Status"
                  value={
                    scheduleModal.project.stage === "rtb"
                      ? "RTB Ready"
                      : scheduleModal.project.stage === "survey"
                        ? "Site Survey"
                        : scheduleModal.project.stage === "inspection"
                          ? "Inspection"
                          : "Blocked"
                  }
                  valueClass={STAGE_TEXT_COLORS[scheduleModal.project.stage]}
                />
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[0.7rem] text-muted w-20">Links</span>
                  <div className="flex items-center gap-2">
                    <a
                      href={scheduleModal.project.hubspotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[0.7rem] text-orange-400 hover:text-orange-300"
                    >
                      HubSpot
                    </a>
                    {scheduleModal.project.zuperJobUid && (
                      <>
                        <span className="text-muted/70">|</span>
                        <a
                          href={`${zuperWebBaseUrl}/jobs/${scheduleModal.project.zuperJobUid}/details`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.7rem] text-cyan-400 hover:text-cyan-300"
                        >
                          Zuper
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </ModalSection>

              {/* Jurisdiction (survey/inspection only) */}
              {(scheduleModal.project.stage === "survey" ||
                scheduleModal.project.stage === "inspection") && (
                <ModalSection title="Jurisdiction">
                  <ModalRow
                    label="AHJ"
                    value={scheduleModal.project.ahj || "Not set"}
                    valueClass={!scheduleModal.project.ahj ? "text-muted" : ""}
                  />
                  <ModalRow
                    label="Utility"
                    value={scheduleModal.project.utility || "Not set"}
                    valueClass={!scheduleModal.project.utility ? "text-muted" : ""}
                  />
                </ModalSection>
              )}

              {/* Equipment */}
              <ModalSection title="Equipment">
                {scheduleModal.project.systemSize > 0 && (
                  <ModalRow
                    label="System Size"
                    value={`${scheduleModal.project.systemSize.toFixed(1)} kW`}
                  />
                )}
                {scheduleModal.project.moduleCount > 0 && (
                  <ModalRow
                    label="Modules"
                    value={
                      scheduleModal.project.moduleBrand
                        ? `${scheduleModal.project.moduleCount}x ${scheduleModal.project.moduleBrand} ${scheduleModal.project.moduleModel}${scheduleModal.project.moduleWattage > 0 ? ` (${scheduleModal.project.moduleWattage}W)` : ""}`
                        : `${scheduleModal.project.moduleCount} panels`
                    }
                  />
                )}
                {scheduleModal.project.inverterCount > 0 && (
                  <ModalRow
                    label="Inverters"
                    value={
                      scheduleModal.project.inverterBrand
                        ? `${scheduleModal.project.inverterCount}x ${scheduleModal.project.inverterBrand} ${scheduleModal.project.inverterModel}${scheduleModal.project.inverterSizeKwac > 0 ? ` (${scheduleModal.project.inverterSizeKwac} kWac)` : ""}`
                        : `${scheduleModal.project.inverterCount}`
                    }
                  />
                )}
                {scheduleModal.project.batteries > 0 && (
                  <ModalRow
                    label="Batteries"
                    value={`${scheduleModal.project.batteries}x ${scheduleModal.project.batteryModel || "Tesla"}${scheduleModal.project.batterySizeKwh > 0 ? ` ${scheduleModal.project.batterySizeKwh} kWh` : ""}${scheduleModal.project.batteryExpansion ? ` + ${scheduleModal.project.batteryExpansion} expansion` : ""}`}
                  />
                )}
                {scheduleModal.project.evCount > 0 && (
                  <ModalRow
                    label="EV Chargers"
                    value={`${scheduleModal.project.evCount}`}
                  />
                )}
              </ModalSection>

              {/* Install Requirements (non-survey/inspection) */}
              {scheduleModal.project.stage !== "survey" &&
                scheduleModal.project.stage !== "inspection" && (
                  <ModalSection title="Install Requirements">
                    {scheduleModal.project.daysInstall > 0 && (
                      <ModalRow
                        label="Installer Days"
                        value={`${scheduleModal.project.daysInstall}d`}
                      />
                    )}
                    {scheduleModal.project.daysElec > 0 && (
                      <ModalRow
                        label="Electrician Days"
                        value={`${scheduleModal.project.daysElec}d`}
                      />
                    )}
                    {!scheduleModal.project.daysInstall &&
                      !scheduleModal.project.daysElec &&
                      scheduleModal.project.totalDays > 0 && (
                        <ModalRow
                          label="Total Days"
                          value={`${scheduleModal.project.totalDays}d`}
                        />
                      )}
                    {scheduleModal.project.roofersCount > 0 && (
                      <ModalRow
                        label="Installers Needed"
                        value={`${scheduleModal.project.roofersCount}`}
                      />
                    )}
                    {scheduleModal.project.electriciansCount > 0 && (
                      <ModalRow
                        label="Electricians Needed"
                        value={`${scheduleModal.project.electriciansCount}`}
                      />
                    )}
                    {scheduleModal.project.difficulty > 0 && (
                      <ModalRow
                        label="Difficulty"
                        value={`${"*".repeat(scheduleModal.project.difficulty)} (${scheduleModal.project.difficulty}/5)`}
                      />
                    )}
                    {scheduleModal.project.installNotes && (
                      <ModalRow
                        label="Notes"
                        value={scheduleModal.project.installNotes}
                      />
                    )}
                  </ModalSection>
                )}

              {/* Schedule Date & Inputs */}
              <ModalSection title="Schedule">
                <div className="flex gap-2.5 flex-wrap items-center">
                  <label className="text-[0.7rem] text-muted w-20">Start Date</label>
                  <input
                    type="date"
                    value={scheduleModal.date}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) setScheduleModal(prev => prev ? { ...prev, date: val } : prev);
                    }}
                    className="bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded font-mono text-[0.75rem] focus:outline-none focus:border-orange-500"
                  />
                </div>
                {scheduleModal.project.zuperScheduledStart && (() => {
                  const { startDate, endDate } = normalizeZuperBoundaryDates(
                    scheduleModal.project.zuperScheduledStart,
                    scheduleModal.project.zuperScheduledEnd,
                    scheduleModal.project.location
                  );
                  if (!startDate) return null;
                  const effectiveDays = getEffectiveConstructionDays(scheduleModal.project);
                  return (
                    <div className="text-[0.6rem] text-cyan-400/80 mt-1">
                      Zuper: {formatShortDate(startDate)}
                      {endDate && endDate !== startDate && (
                        <> → {formatShortDate(endDate)}</>
                      )}
                      {effectiveDays && (
                        <> ({effectiveDays}d)</>
                      )}
                    </div>
                  );
                })()}
                {/* Survey/Inspection: Surveyor + Time slot */}
                {(scheduleModal.project.stage === "survey" || scheduleModal.project.stage === "inspection") ? (
                  <>
                    <div className="flex gap-2.5 mt-2 flex-wrap items-center">
                      <label className="text-[0.7rem] text-muted">
                        {scheduleModal.project.stage === "survey" ? "Surveyor:" : "Inspector:"}
                      </label>
                      <select
                        value={crewSelectInput}
                        onChange={(e) => setCrewSelectInput(e.target.value)}
                        className="bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded font-mono text-[0.75rem] focus:outline-none focus:border-orange-500"
                      >
                        {scheduleModal.project.stage === "survey" ? (
                          (ZUPER_SURVEY_USERS[scheduleModal.project.location] || []).map((u) => (
                            <option key={u.name} value={u.name}>{u.name}</option>
                          ))
                        ) : (
                          (ZUPER_INSPECTION_USERS[scheduleModal.project.location] || []).map((u) => (
                            <option key={u.name} value={u.name}>{u.name}</option>
                          ))
                        )}
                      </select>
                      <label className="text-[0.7rem] text-muted">Time:</label>
                      <select
                        value={selectedSlotIdx}
                        onChange={(e) => setSelectedSlotIdx(parseInt(e.target.value) || 0)}
                        className="bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded font-mono text-[0.75rem] focus:outline-none focus:border-orange-500"
                      >
                        {loadingSlots && <option>Loading...</option>}
                        {!loadingSlots && availableSlots.length === 0 && (
                          <option>No availability</option>
                        )}
                        {!loadingSlots && availableSlots.map((slot, idx) => (
                          <option key={`${slot.startTime}-${slot.endTime}`} value={idx}>
                            {slot.displayTime}
                          </option>
                        ))}
                      </select>
                    </div>
                    {!loadingSlots && availableSlots.length === 0 && (
                      <div className="text-[0.6rem] text-amber-400/80 mt-1">
                        No open slots for {crewSelectInput} on this date
                      </div>
                    )}
                  </>
                ) : (
                  /* Construction: Days + Assignee */
                  <>
                    <div className="flex gap-2.5 mt-2 flex-wrap items-center">
                      <label className="text-[0.7rem] text-muted">Days:</label>
                      <input
                        type="number"
                        value={installDaysInput}
                        onChange={(e) =>
                          setInstallDaysInput(parseInt(e.target.value, 10) || 1)
                        }
                        min={1}
                        max={10}
                        step={1}
                        className="bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded font-mono text-[0.75rem] w-[60px] text-center focus:outline-none focus:border-orange-500"
                      />
                      <label className="text-[0.7rem] text-muted">Assignees:</label>
                      <div className="w-full border border-t-border rounded bg-background/70 p-2 max-h-28 overflow-y-auto">
                        {loadingConstructionAssignees && (
                          <div className="text-[0.65rem] text-muted mb-1">Loading team assignees from Zuper...</div>
                        )}
                        {availableConstructionAssignees.length === 0 ? (
                          <div className="text-[0.7rem] text-muted">No assignees configured for this location</div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {availableConstructionAssignees.map((assignee) => {
                              const isChecked = constructionAssigneeNames.includes(assignee.name);
                              return (
                                <label key={`${assignee.teamUid}-${assignee.userUid || assignee.name}`} className="flex items-center gap-2 text-[0.72rem] text-foreground/90 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setConstructionAssigneeNames((prev) => {
                                        if (checked) {
                                          if (prev.includes(assignee.name)) return prev;
                                          return [...prev, assignee.name];
                                        }
                                        return prev.filter((name) => name !== assignee.name);
                                      });
                                    }}
                                    className="w-3.5 h-3.5 accent-orange-500"
                                  />
                                  <span>{assignee.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="w-full text-[0.62rem] text-muted">
                        Selected: {constructionAssigneeNames.length > 0 ? constructionAssigneeNames.join(", ") : "None"}
                      </div>
                      <label className="text-[0.7rem] text-muted w-full">Installer Notes:</label>
                      <textarea
                        value={installerNotesInput}
                        onChange={(e) => setInstallerNotesInput(e.target.value)}
                        placeholder="Optional notes to append to the Zuper job"
                        rows={3}
                        className="w-full bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded font-mono text-[0.72rem] focus:outline-none focus:border-orange-500 resize-y"
                      />
                    </div>
                    {!locationHasCapacity && (
                      <div className="text-[0.6rem] text-amber-400/80 mt-1">
                        Capacity warning: calendar data suggests this date is full, but scheduling is still allowed.
                      </div>
                    )}
                  </>
                )}
              </ModalSection>

              {/* Zuper Integration */}
              {zuperConfigured && (
                <ModalSection title="Zuper Integration">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="syncZuper"
                      checked={syncToZuper}
                      onChange={(e) => setSyncToZuper(e.target.checked)}
                      className="w-4 h-4 accent-orange-500"
                    />
                    <label htmlFor="syncZuper" className="text-[0.7rem] text-foreground/80 cursor-pointer">
                      Sync schedule to Zuper
                    </label>
                  </div>
                  <div className={`text-[0.6rem] mt-1 ${syncToZuper ? "text-cyan-400" : "text-amber-400"}`}>
                    {syncToZuper
                      ? "Mode: live sync (writes to Zuper now)."
                      : "Mode: tentative only (does not sync until confirmed)."}
                  </div>
                  <div className="text-[0.6rem] text-muted mt-1">
                    Updates the existing {scheduleModal.project.stage === "survey" ? "Site Survey" : scheduleModal.project.stage === "inspection" ? "Inspection" : "Installation"} job in Zuper (or creates one if none exists)
                  </div>
                  {syncToZuper && (
                    <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[0.6rem] text-amber-400">
                      ⚠️ <strong>Customer will receive EMAIL + SMS notification</strong> with their scheduled appointment
                    </div>
                  )}
                </ModalSection>
              )}
            </div>

            <div className="flex gap-2 justify-end flex-wrap">
              <button
                onClick={() => setScheduleModal(null)}
                disabled={syncingToZuper}
                className="px-3.5 py-2 rounded-md bg-background border border-t-border text-foreground/80 text-[0.75rem] cursor-pointer hover:bg-surface-2 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmSchedule}
                disabled={syncingToZuper}
                className="px-3.5 py-2 rounded-md bg-orange-500 border border-orange-500 text-black text-[0.75rem] font-semibold cursor-pointer hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                {syncingToZuper ? "Syncing..." : "Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* DETAIL MODAL                                                  */}
      {/* ============================================================ */}
      {detailModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]"
          onClick={(e) => {
            if (e.target === e.currentTarget) { setDetailModal(null); setDetailModalEvent(null); }
          }}
        >
          <div className="bg-surface border border-t-border rounded-xl p-5 max-w-[500px] w-[90%] max-h-[85vh] overflow-y-auto">
            <h3 className="text-base mb-3">Project Details</h3>
            <div className="mb-4 space-y-3">
              {/* Project Info */}
              <ModalSection title="Project">
                <ModalRow label="ID" value={getProjectId(detailModal.name)} />
                <ModalRow
                  label="Customer"
                  value={getCustomerName(detailModal.name)}
                />
                <ModalRow label="Address" value={detailModal.address} />
                <ModalRow label="Location" value={detailModal.location} />
                <ModalRow
                  label="Type"
                  value={(detailModal.type || "Service")
                    .split(";")
                    .filter((t) => t.trim())
                    .join(", ")}
                />
                <ModalRow
                  label="Amount"
                  value={`$${detailModal.amount.toLocaleString()}`}
                  valueClass="text-orange-400 font-semibold"
                />
                <ModalRow
                  label="Status"
                  value={
                    detailModal.stage === "rtb"
                      ? "RTB Ready"
                      : detailModal.stage === "survey"
                        ? "Site Survey"
                        : detailModal.stage === "inspection"
                          ? "Inspection"
                          : detailModal.stage === "construction"
                            ? "Construction"
                            : "Blocked"
                  }
                  valueClass={STAGE_TEXT_COLORS[detailModal.stage]}
                />
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[0.7rem] text-muted w-20">Links</span>
                  <div className="flex items-center gap-2">
                    <a
                      href={detailModal.hubspotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[0.7rem] text-orange-400 hover:text-orange-300"
                    >
                      HubSpot
                    </a>
                    {detailModal.zuperJobUid && !detailModalEvent?.isForecast && (
                      <>
                        <span className="text-muted/70">|</span>
                        <a
                          href={`${zuperWebBaseUrl}/jobs/${detailModal.zuperJobUid}/details`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.7rem] text-cyan-400 hover:text-cyan-300"
                        >
                          Zuper
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </ModalSection>

              {/* Jurisdiction (survey/inspection) */}
              {(detailModal.stage === "survey" ||
                detailModal.stage === "inspection") && (
                <ModalSection title="Jurisdiction">
                  <ModalRow
                    label="AHJ"
                    value={detailModal.ahj || "Not set"}
                    valueClass={!detailModal.ahj ? "text-muted" : ""}
                  />
                  <ModalRow
                    label="Utility"
                    value={detailModal.utility || "Not set"}
                    valueClass={!detailModal.utility ? "text-muted" : ""}
                  />
                </ModalSection>
              )}

              {/* Equipment */}
              <ModalSection title="Equipment">
                {detailModal.systemSize > 0 && (
                  <ModalRow
                    label="System Size"
                    value={`${detailModal.systemSize.toFixed(1)} kW`}
                  />
                )}
                {detailModal.moduleCount > 0 && (
                  <ModalRow
                    label="Modules"
                    value={
                      detailModal.moduleBrand
                        ? `${detailModal.moduleCount}x ${detailModal.moduleBrand} ${detailModal.moduleModel}${detailModal.moduleWattage > 0 ? ` (${detailModal.moduleWattage}W)` : ""}`
                        : `${detailModal.moduleCount} panels`
                    }
                  />
                )}
                {detailModal.inverterCount > 0 && (
                  <ModalRow
                    label="Inverters"
                    value={
                      detailModal.inverterBrand
                        ? `${detailModal.inverterCount}x ${detailModal.inverterBrand} ${detailModal.inverterModel}${detailModal.inverterSizeKwac > 0 ? ` (${detailModal.inverterSizeKwac} kWac)` : ""}`
                        : `${detailModal.inverterCount}`
                    }
                  />
                )}
                {detailModal.batteries > 0 && (
                  <ModalRow
                    label="Batteries"
                    value={`${detailModal.batteries}x ${detailModal.batteryModel || "Tesla"}${detailModal.batterySizeKwh > 0 ? ` ${detailModal.batterySizeKwh} kWh` : ""}${detailModal.batteryExpansion ? ` + ${detailModal.batteryExpansion} expansion` : ""}`}
                  />
                )}
                {detailModal.evCount > 0 && (
                  <ModalRow
                    label="EV Chargers"
                    value={`${detailModal.evCount}`}
                  />
                )}
              </ModalSection>

              {/* Install Requirements (non-survey/inspection) */}
              {detailModal.stage !== "survey" &&
                detailModal.stage !== "inspection" && (
                  <ModalSection title="Install Requirements">
                    {detailModal.daysInstall > 0 && (
                      <ModalRow
                        label="Installer Days"
                        value={`${detailModal.daysInstall}d`}
                      />
                    )}
                    {detailModal.daysElec > 0 && (
                      <ModalRow
                        label="Electrician Days"
                        value={`${detailModal.daysElec}d`}
                      />
                    )}
                    {!detailModal.daysInstall &&
                      !detailModal.daysElec &&
                      detailModal.totalDays > 0 && (
                        <ModalRow
                          label="Total Days"
                          value={`${detailModal.totalDays}d`}
                        />
                      )}
                    {detailModal.roofersCount > 0 && (
                      <ModalRow
                        label="Installers"
                        value={`${detailModal.roofersCount}`}
                      />
                    )}
                    {detailModal.electriciansCount > 0 && (
                      <ModalRow
                        label="Electricians"
                        value={`${detailModal.electriciansCount}`}
                      />
                    )}
                    {detailModal.difficulty > 0 && (
                      <ModalRow
                        label="Difficulty"
                        value={`${"*".repeat(detailModal.difficulty)} (${detailModal.difficulty}/5)`}
                      />
                    )}
                    {detailModal.installNotes && (
                      <ModalRow
                        label="Notes"
                        value={detailModal.installNotes}
                      />
                    )}
                  </ModalSection>
                )}

              {/* Forecast Info (when viewing a ghost event) */}
              {detailModalEvent?.isForecast && (() => {
                const tp = forecastQuery.data?.projects.find((p) => p.dealId === String(detailModal.id));
                const installMs = tp?.milestones.find((m) => m.key === "install");
                return (
                  <ModalSection title="Forecast">
                    <ModalRow
                      label="Predicted Install"
                      value={formatDateShort(detailModalEvent.date)}
                      valueClass="text-blue-400 font-semibold"
                    />
                    <ModalRow
                      label="Duration"
                      value={`${detailModalEvent.days} ${detailModalEvent.days === 1 ? "day" : "days"}`}
                    />
                    {installMs?.basis && (
                      <ModalRow
                        label="Forecast Basis"
                        value={installMs.basis.replace(/_/g, " ")}
                      />
                    )}
                    {installMs?.varianceDays != null && (
                      <ModalRow
                        label="Variance"
                        value={`${installMs.varianceDays > 0 ? "+" : ""}${installMs.varianceDays} days`}
                        valueClass={installMs.varianceDays > 14 ? "text-red-400" : installMs.varianceDays > 7 ? "text-amber-400" : "text-emerald-400"}
                      />
                    )}
                    <div className="text-[0.65rem] text-muted mt-1 p-2 rounded bg-blue-500/5 border border-dashed border-blue-400/30">
                      Forecasted install — not yet scheduled. This date is a prediction based on project milestone data.
                    </div>
                  </ModalSection>
                );
              })()}

              {/* Schedule */}
              {!detailModalEvent?.isForecast && <ModalSection title="Schedule">
                {(() => {
                  const scheduleInfo =
                    manualSchedules[detailModal.id] ||
                    (detailModal.scheduleDate
                      ? {
                          startDate: detailModal.scheduleDate,
                          days: detailModal.daysInstall,
                          crew: detailModal.crew,
                        }
                      : null);
                  const isSurveyOrInspection =
                    detailModal.stage === "survey" ||
                    detailModal.stage === "inspection";
                  const normalizedZuperDates = normalizeZuperBoundaryDates(
                    detailModal.zuperScheduledStart,
                    detailModal.zuperScheduledEnd,
                    detailModal.location
                  );
                  const effectiveZuperDays = getEffectiveConstructionDays(detailModal);
                  const displayDays =
                    effectiveZuperDays ||
                    detailModal.zuperScheduledDays ||
                    scheduleInfo?.days ||
                    detailModal.daysInstall ||
                    (isSurveyOrInspection ? 1 : 2);
                  // Prefer Zuper start date if available
                  const displayDate = normalizedZuperDates.startDate || scheduleInfo?.startDate || null;
                  return (
                    <>
                      <ModalRow
                        label="Date"
                        value={
                          displayDate
                            ? formatDateShort(displayDate)
                            : "Not scheduled"
                        }
                        valueClass="text-blue-400 font-semibold"
                      />
                      <ModalRow
                        label="Duration"
                        value={`${displayDays} ${displayDays === 1 ? "day" : "days"}`}
                      />
                      <ModalRow
                        label="Crew"
                        value={
                          scheduleInfo?.crew ||
                          detailModal.crew ||
                          "Unassigned"
                        }
                      />
                      {detailModal.zuperAssignedTo && detailModal.zuperAssignedTo.length > 0 && (
                        <ModalRow
                          label="Assigned To"
                          value={detailModal.zuperAssignedTo.join(", ")}
                          valueClass="text-cyan-400"
                        />
                      )}
                      {detailModal.zuperScheduledStart && (
                        <div className="text-[0.6rem] text-cyan-400/70 mt-1">
                          Zuper: {formatShortDate(normalizedZuperDates.startDate || detailModal.zuperScheduledStart.split("T")[0])}
                          {normalizedZuperDates.endDate && normalizedZuperDates.endDate !== (normalizedZuperDates.startDate || "") && (
                            <> → {formatShortDate(normalizedZuperDates.endDate)}</>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </ModalSection>}
            </div>

            {/* Tentative action banner */}
            {manualSchedules[detailModal.id]?.isTentative && !detailModalEvent?.isForecast && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-dashed border-amber-400/50">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-amber-400 text-[0.7rem] font-bold uppercase tracking-wide">⏳ Tentative</span>
                  <span className="text-[0.65rem] text-muted">Not yet synced to Zuper</span>
                </div>
                {/* Install notes textarea — only for installation/construction schedules */}
                {(() => {
                  const st = manualSchedules[detailModal.id]?.scheduleType || "";
                  return (st === "installation" || st === "construction") ? (
                    <div className="mb-3">
                      <label className="text-[0.7rem] text-muted w-full">
                        Install Notes
                        <span className="text-[0.6rem] text-muted/60 ml-1">(will be added to Zuper job on confirmation)</span>
                      </label>
                      <textarea
                        value={tentativeConfirmNotes}
                        onChange={(e) => setTentativeConfirmNotes(e.target.value)}
                        onBlur={() => handleSaveTentativeNotes(detailModal.id, tentativeConfirmNotes)}
                        placeholder="Optional notes for the install crew (e.g., arrival time, gate code)"
                        rows={3}
                        className="w-full mt-1 bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded font-mono text-[0.72rem] focus:outline-none focus:border-orange-500 resize-y"
                      />
                    </div>
                  ) : null;
                })()}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirmTentative(detailModal.id, tentativeConfirmNotes.trim() || undefined)}
                    disabled={confirmingTentative}
                    className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-[0.7rem] font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {confirmingTentative ? "Confirming..." : "✓ Confirm & Sync to Zuper"}
                  </button>
                  <button
                    onClick={() => handleCancelTentative(detailModal.id)}
                    disabled={cancellingTentative}
                    className="px-3 py-1.5 rounded-md bg-red-600/80 text-white text-[0.7rem] font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {cancellingTentative ? "Cancelling..." : "✗ Cancel"}
                  </button>
                </div>
              </div>
            )}

            {/* Reschedule section — for confirmed (non-tentative) scheduled items */}
            {(!detailModalEvent?.isForecast && !manualSchedules[detailModal.id]?.isTentative && (detailModal.scheduleDate || manualSchedules[detailModal.id]?.startDate)) ? (
              <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-400/30">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-blue-400 text-[0.7rem] font-bold uppercase tracking-wide">Reschedule</span>
                  <span className="text-[0.65rem] text-muted">
                    {detailModal.zuperJobUid
                      ? "Zuper, calendar & crew updated automatically"
                      : "Move to a new date"}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="date"
                    defaultValue=""
                    min={new Date().toISOString().split("T")[0]}
                    className="bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded text-[0.75rem] focus:outline-none focus:border-blue-500"
                    id="reschedule-date-picker"
                  />
                  {detailModal.stage !== "survey" && detailModal.stage !== "inspection" && (
                    <div className="flex items-center gap-1">
                      <label className="text-[0.65rem] text-muted">Days</label>
                      <input
                        type="number"
                        defaultValue={
                          (getEffectiveConstructionDays(detailModal) || detailModal.daysInstall || 2)
                        }
                        min={1}
                        max={30}
                        id="reschedule-days-input"
                        className="w-12 bg-background border border-t-border text-foreground/90 px-1.5 py-1.5 rounded text-[0.75rem] text-center focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  )}
                  <button
                    disabled={reschedulingProjectId === detailModal.id}
                    onClick={() => {
                      const isSurveyOrInsp = detailModal.stage === "survey" || detailModal.stage === "inspection";
                      const fallbackDays = isSurveyOrInsp ? 1 : (getEffectiveConstructionDays(detailModal) || detailModal.daysInstall || 2);
                      const input = document.getElementById("reschedule-date-picker") as HTMLInputElement;
                      const daysInput = document.getElementById("reschedule-days-input") as HTMLInputElement;
                      const newDate = input?.value;
                      if (!newDate) {
                        showToast("Please select a new date", "warning");
                        return;
                      }
                      const days = daysInput ? Math.max(1, Math.min(30, parseInt(daysInput.value) || fallbackDays)) : fallbackDays;
                      if (detailModal.zuperJobUid) {
                        handleOneClickReschedule(detailModal, newDate, days);
                      } else {
                        const project = detailModal;
                        setDetailModal(null);
                        setDetailModalEvent(null);
                        openScheduleModal(project, newDate);
                      }
                    }}
                    className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-[0.7rem] font-semibold hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    {reschedulingProjectId === detailModal.id ? "Rescheduling..." : "Reschedule"}
                  </button>
                </div>
                {detailModal.zuperJobUid && (
                  <div className="mt-2 flex items-center gap-1.5 text-[0.6rem] text-cyan-400/70">
                    <span>Keeps same crew: {detailModal.zuperAssignedTo?.join(", ") || detailModal.crew || "current"}</span>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex gap-2 justify-end flex-wrap">
              {!manualSchedules[detailModal.id]?.isTentative && !detailModalEvent?.isForecast && (
                <button
                  onClick={() => handleRemoveScheduled(detailModal.id)}
                  className="px-3.5 py-2 rounded-md bg-red-700/80 border border-red-700/80 text-white text-[0.75rem] font-semibold no-underline hover:bg-red-700 transition-colors cursor-pointer"
                >
                  Remove from Schedule
                </button>
              )}
              <a
                href={detailModal.hubspotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 rounded-md bg-[#ff7a59] border border-[#ff7a59] text-white text-[0.75rem] font-semibold no-underline hover:bg-[#e66a4a] transition-colors"
              >
                Open in HubSpot
              </a>
              {detailModal.zuperJobUid && !detailModalEvent?.isForecast && (
                <a
                  href={`${zuperWebBaseUrl}/jobs/${detailModal.zuperJobUid}/details`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 rounded-md bg-cyan-600 border border-cyan-600 text-white text-[0.75rem] font-semibold no-underline hover:bg-cyan-700 transition-colors"
                >
                  Open in Zuper
                </a>
              )}
              <button
                onClick={() => { setDetailModal(null); setDetailModalEvent(null); }}
                className="px-3.5 py-2 rounded-md bg-background border border-t-border text-foreground/80 text-[0.75rem] cursor-pointer hover:bg-surface-2 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY DETAIL POPOVER */}
      {overlayDetail && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]"
          onClick={(e) => { if (e.target === e.currentTarget) setOverlayDetail(null); }}
        >
          <div className={`bg-surface border rounded-xl p-5 max-w-[400px] w-[90%] ${
            overlayDetail.eventType === "service" ? "border-purple-500/50" : "border-amber-500/50"
          }`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">
                {overlayDetail.eventType === "service" ? "Service Job" : "D&R Job"}
              </h3>
              <span className={`text-[0.65rem] px-2 py-0.5 rounded-full font-medium ${
                overlayDetail.eventType === "service"
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}>
                {overlayDetail.eventSubtype}
              </span>
            </div>
            <div className="space-y-2 text-[0.75rem]">
              <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Job</span><span className="text-foreground">{overlayDetail.name}</span></div>
              <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Address</span><span className="text-foreground">{overlayDetail.address || "—"}</span></div>
              <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Location</span><span className="text-foreground">{overlayDetail.location}</span></div>
              <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Assigned</span><span className="text-foreground">{overlayDetail.crew || "Unassigned"}</span></div>
              <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Status</span><span className={`font-medium ${overlayDetail.eventType === "service" ? "text-purple-400" : "text-amber-400"}`}>{overlayDetail.status || "—"}</span></div>
              <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Date</span><span className="text-foreground">{formatDateShort(overlayDetail.date)}{overlayDetail.days > 1 ? ` (${overlayDetail.days} days)` : ""}</span></div>
              {overlayDetail.scheduledTime && (
                <div className="flex gap-2"><span className="text-muted w-20 shrink-0">Time</span><span className="text-foreground">{overlayDetail.scheduledTime}</span></div>
              )}
            </div>
            <button onClick={() => setOverlayDetail(null)} className="mt-4 w-full py-1.5 text-[0.7rem] rounded-md bg-background border border-t-border text-muted hover:text-foreground transition-colors">Close</button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* DRAG RESCHEDULE CONFIRMATION DIALOG                           */}
      {/* ============================================================ */}
      {rescheduleConfirm && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1001]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRescheduleConfirm(null);
          }}
        >
          <div className="bg-surface border border-t-border rounded-xl p-5 max-w-[420px] w-[90%]">
            <h3 className="text-base mb-1">Reschedule</h3>
            <p className="text-[0.75rem] text-muted mb-4">
              Move <span className="text-foreground font-semibold">{getCustomerName(rescheduleConfirm.project.name)}</span> from{" "}
              <span className="text-blue-400">{formatDateShort(rescheduleConfirm.fromDate)}</span> to{" "}
              <span className="text-blue-400">{formatDateShort(rescheduleConfirm.toDate)}</span>?
            </p>

            {/* Days control — only for construction, not surveys/inspections (always 1 day) */}
            {rescheduleConfirm.project.stage !== "survey" && rescheduleConfirm.project.stage !== "inspection" && (
              <div className="mb-3 flex items-center gap-3">
                <label className="text-[0.7rem] text-muted">Days</label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setRescheduleConfirm((prev) => prev ? { ...prev, days: Math.max(1, prev.days - 1) } : null)}
                    className="w-6 h-6 rounded bg-background border border-t-border text-foreground/80 text-[0.75rem] flex items-center justify-center cursor-pointer hover:bg-surface-2"
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-[0.8rem] font-semibold">{rescheduleConfirm.days}</span>
                  <button
                    onClick={() => setRescheduleConfirm((prev) => prev ? { ...prev, days: Math.min(30, prev.days + 1) } : null)}
                    className="w-6 h-6 rounded bg-background border border-t-border text-foreground/80 text-[0.75rem] flex items-center justify-center cursor-pointer hover:bg-surface-2"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            <div className="text-[0.6rem] text-cyan-400/70 mb-4">
              Zuper, Google Calendar & crew email will be updated automatically.
              <br />
              Crew: {rescheduleConfirm.project.zuperAssignedTo?.join(", ") || rescheduleConfirm.project.crew || "current"}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRescheduleConfirm(null)}
                className="px-3.5 py-2 rounded-md bg-background border border-t-border text-foreground/80 text-[0.75rem] cursor-pointer hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={reschedulingProjectId === rescheduleConfirm.project.id}
                onClick={() => {
                  const { project, toDate, days } = rescheduleConfirm;
                  setRescheduleConfirm(null);
                  handleOneClickReschedule(project, toDate, days);
                }}
                className="px-3.5 py-2 rounded-md bg-blue-600 text-white text-[0.75rem] font-semibold cursor-pointer hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {reschedulingProjectId === rescheduleConfirm.project.id ? "Rescheduling..." : "Confirm Reschedule"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small helper components for modals                                  */
/* ------------------------------------------------------------------ */

function ModalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[0.65rem] text-muted uppercase mb-1 font-semibold">
        {title}
      </div>
      {children}
    </div>
  );
}

function ModalRow({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between py-1 border-b border-t-border last:border-b-0 text-[0.75rem]">
      <span className="text-muted">{label}</span>
      <span className={valueClass || "text-foreground/90"}>{value}</span>
    </div>
  );
}
