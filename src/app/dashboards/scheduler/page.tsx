"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useActivityTracking } from "@/hooks/useActivityTracking";

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
  ahj?: string;
  utility?: string;
  isParticipateEnergy?: boolean;
  equipment?: {
    systemSizeKwdc?: number;
    modules?: { count?: number };
    inverter?: { count?: number };
    battery?: { count?: number; expansionCount?: number; brand?: string };
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
  isCompletedPastStage: boolean; // Project moved past its stage (e.g. Close Out with inspection data) — calendar only, not sidebar
}

interface CrewConfig {
  name: string;
  roofers: number;
  electricians: number;
  color: string;
}

interface ManualSchedule {
  startDate: string;
  days: number;
  crew: string;
  isTentative?: boolean;
  recordId?: string;
  scheduleType?: string;
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

/* ---- Zuper default assignees per location (for auto-assignment when scheduling) ---- */
// Construction: assign to location director (same as construction scheduler)
const ZUPER_CONSTRUCTION_DIRECTORS: Record<string, { name: string; userUid: string; teamUid: string }> = {
  Westminster: { name: "Joe Lynch", userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
  Centennial: { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  DTC: { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  "Colorado Springs": { name: "Rolando", userUid: "a89ed2f5-222b-4b09-8bb0-14dc45c2a51b", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
  "San Luis Obispo": { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  Camarillo: { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "0168d963-84af-4214-ad81-d6c43cee8e65" },
};

// Survey: available surveyors per location (first entry is the default)
// userUid can be empty string — the schedule API will resolve by name at runtime
const ZUPER_SURVEY_USERS: Record<string, { name: string; userUid: string; teamUid: string }[]> = {
  Westminster: [
    { name: "Joe Lynch", userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
    { name: "Ryszard Szymanski", userUid: "e043bf1d-006b-4033-a46e-3b5d06ed3d00", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
    { name: "Derek Pomar", userUid: "f3bb40c0-d548-4355-ab39-6c27532a6d36", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
  ],
  Centennial: [
    { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
    { name: "Derek Pomar", userUid: "f3bb40c0-d548-4355-ab39-6c27532a6d36", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  DTC: [
    { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
    { name: "Derek Pomar", userUid: "f3bb40c0-d548-4355-ab39-6c27532a6d36", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  "Colorado Springs": [
    { name: "Rolando", userUid: "a89ed2f5-222b-4b09-8bb0-14dc45c2a51b", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
  ],
  "San Luis Obispo": [
    { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  ],
  Camarillo: [
    { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "0168d963-84af-4214-ad81-d6c43cee8e65" },
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

// Location → IANA timezone (matches availability route)
const LOCATION_TIMEZONES: Record<string, string> = {
  Westminster: "America/Denver",
  Centennial: "America/Denver",
  DTC: "America/Denver",
  "Colorado Springs": "America/Denver",
  "San Luis Obispo": "America/Los_Angeles",
  Camarillo: "America/Los_Angeles",
};

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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return "$" + (amount / 1_000_000).toFixed(1) + "M";
  if (amount >= 1_000) return "$" + (amount / 1000).toFixed(1) + "K";
  return "$" + amount.toFixed(0);
}

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
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.getDay() === 0 || d.getDay() === 6;
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addBusinessDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  // First, move to a weekday if starting on a weekend
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  let remaining = Math.ceil(days);
  if (remaining <= 0) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      remaining--;
    }
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getNextWorkday(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Transform API data                                                 */
/* ------------------------------------------------------------------ */

function transformProject(p: RawProject): SchedulerProject | null {
  const stage = STAGE_MAP[p.stage] || "other";
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

  const loc = p.pbLocation || "Unknown";
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
    ahj: p.ahj || "",
    utility: p.utility || "",
    crew: CREWS[loc]?.[0]?.name || null,
    daysInstall: isBuildStage
      ? p.daysForInstallers || p.expectedDaysForInstall || 2
      : stage === "survey" || stage === "inspection"
        ? 0.25
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
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth());
  const [weekOffset, setWeekOffset] = useState(0);

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

  /* ---- selection / scheduling ---- */
  const [selectedProject, setSelectedProject] = useState<SchedulerProject | null>(null);
  const [manualSchedules, setManualSchedules] = useState<Record<string, ManualSchedule>>({});
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);

  /* ---- modals ---- */
  const [scheduleModal, setScheduleModal] = useState<PendingSchedule | null>(null);
  const [detailModal, setDetailModal] = useState<SchedulerProject | null>(null);
  const [installDaysInput, setInstallDaysInput] = useState(2);
  const [crewSelectInput, setCrewSelectInput] = useState("");

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
  const [zuperWebBaseUrl, setZuperWebBaseUrl] = useState("https://us-west-1c.zuperpro.com");
  const [syncToZuper, setSyncToZuper] = useState(true);
  const [syncingToZuper, setSyncingToZuper] = useState(false);

  /* ---- revenue sidebar ---- */
  const [revenueSidebarOpen, setRevenueSidebarOpen] = useState(true);
  const [revenueSidebarTab, setRevenueSidebarTab] = useState<"weekly" | "monthly">("weekly");

  /* ---- toast ---- */
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* (right panel removed — optimize/conflicts moved to testing) */

  /* ================================================================ */
  /*  Data fetching                                                    */
  /* ================================================================ */

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/projects?context=scheduling");
      if (!response.ok) throw new Error("Failed to fetch projects");
      const data = await response.json();
      const transformed = data.projects
        .map((p: RawProject) => transformProject(p))
        .filter((p: SchedulerProject | null): p is SchedulerProject => p !== null);

      // Look up Zuper job UIDs for these projects (all job categories)
      // Uses POST to avoid URL length limits with hundreds of projects
      if (transformed.length > 0) {
        try {
          const projectIds = transformed.map((p: SchedulerProject) => p.id);
          const projectNames = transformed.map((p: SchedulerProject) => p.name);

          // Look up jobs for each category (survey, construction, inspection)
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

          // Merge Zuper job UIDs into projects (only match the stage-appropriate category)
          for (const project of transformed) {
            // Map project stage to the Zuper job category it should link to
            const stageToCategory: Record<string, string> = {
              survey: "survey",
              rtb: "construction",
              blocked: "construction",
              construction: "construction",
              inspection: "inspection",
            };
            const matchCategory = stageToCategory[project.stage] || "construction";
            const matchIndex = categories.indexOf(matchCategory);

            // Only link the Zuper job that matches the project's current stage
            // Don't fall back to other categories (e.g. don't link survey job for a construction project)
            const zuperData = results[matchIndex];
            if (zuperData?.jobs?.[project.id]) {
              const zJob = zuperData.jobs[project.id];
              project.zuperJobUid = zJob.jobUid;
              project.zuperJobStatus = zJob.status;
              project.zuperJobCategory = categories[matchIndex];
              if (zJob.scheduledDays) project.zuperScheduledDays = zJob.scheduledDays;
              if (zJob.scheduledDate) project.zuperScheduledStart = zJob.scheduledDate;
              if (zJob.scheduledEnd) project.zuperScheduledEnd = zJob.scheduledEnd;
            }
          }
        } catch (zuperErr) {
          console.warn("Failed to lookup Zuper jobs:", zuperErr);
          // Don't fail the whole load if Zuper lookup fails
        }
      }

      setProjects(transformed);

      // Rehydrate tentative schedules from DB so they survive page refresh
      if (transformed.length > 0) {
        try {
          const ids = transformed.map((p: SchedulerProject) => p.id).join(",");
          const tentRes = await fetch(`/api/zuper/schedule-records?projectIds=${encodeURIComponent(ids)}&status=tentative`);
          if (tentRes.ok) {
            const tentData = await tentRes.json();
            const records = tentData.records as Record<string, {
              id: string; projectId: string; scheduledDate: string; assignedUser?: string;
              scheduleType?: string; scheduledDays?: number; scheduledStart?: string; scheduledEnd?: string;
            }>;
            if (records && Object.keys(records).length > 0) {
              const restored: Record<string, ManualSchedule> = {};
              for (const [projId, rec] of Object.entries(records)) {
                // Use stored days, or fall back to the project's expected install days
                const proj = transformed.find((p: SchedulerProject) => p.id === projId);
                const isSI = proj?.stage === "survey" || proj?.stage === "inspection";
                const fallbackDays = isSI ? 0.25 : (proj?.daysInstall || proj?.totalDays || 2);
                restored[projId] = {
                  startDate: rec.scheduledDate,
                  days: rec.scheduledDays || fallbackDays,
                  crew: rec.assignedUser || "",
                  isTentative: true,
                  recordId: rec.id,
                  scheduleType: rec.scheduleType,
                };
              }
              setManualSchedules(prev => ({ ...restored, ...prev }));
            }
          }
        } catch (tentErr) {
          console.warn("Failed to rehydrate tentative schedules:", tentErr);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

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

  const showToast = useCallback((message: string, type = "success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), type === "error" ? 8000 : 3000);
  }, []);

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
      const constructionDate = (zuperIsConstruction && p.zuperScheduledStart
        ? p.zuperScheduledStart.split("T")[0]
        : null) || p.constructionScheduleDate;
      if (constructionDate) {
        const schedDate = new Date(constructionDate + "T12:00:00");
        const done = !!p.constructionCompleted;
        const days = (zuperIsConstruction ? p.zuperScheduledDays : null) || p.daysInstall || 1;
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
            days: 0.25,
            isCompleted: done,
            isOverdue: isOverdueCheck(schedDate, 0.25, done, false),
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
            days: 0.25,
            isCompleted: done,
            isOverdue: isOverdueCheck(schedDate, 0.25, done, false),
          });
        }
      }

      // -- Fallback for RTB/Blocked projects with scheduleDate but no constructionScheduleDate --
      if (p.scheduleDate && (p.stage === "rtb" || p.stage === "blocked") && !seenKeys.has(`${p.id}-construction`)) {
        const schedDate = new Date(p.scheduleDate + "T12:00:00");
        const done = !!p.constructionCompleted;
        const days = (zuperIsConstruction ? p.zuperScheduledDays : null) || p.daysInstall || 1;
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
  }, [projects, manualSchedules]);

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
  };
  type MonthData = {
    monthLabel: string;
    isPast: boolean;
    isCurrent: boolean;
    scheduled: RevenueBucket;
    tentative: RevenueBucket;
    completed: RevenueBucket;
    overdue: RevenueBucket;
  };

  const computeRevenueBuckets = useCallback((events: typeof filteredScheduledEvents) => {
    const scheduledEvts = events.filter((e) =>
      (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && !e.isOverdue && !e.isTentative
    );
    const tentativeEvts = events.filter((e) => e.isTentative);
    const completedEvts = events.filter((e) => e.eventType === "construction-complete");
    const overdueEvts = events.filter((e) =>
      (e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled") && e.isOverdue && !e.isTentative
    );
    const dedupeRevenue = (evts: typeof events) => {
      const ids = new Set(evts.map((e) => e.id));
      return {
        count: ids.size,
        revenue: [...ids].reduce((sum, id) => sum + (evts.find((e) => e.id === id)?.amount || 0), 0),
      };
    };
    return { scheduled: dedupeRevenue(scheduledEvts), tentative: dedupeRevenue(tentativeEvts), completed: dedupeRevenue(completedEvts), overdue: dedupeRevenue(overdueEvts) };
  }, []);

  const weeklyRevenueSummary = useMemo((): WeekData[] => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + mondayOffset);
    thisMonday.setHours(0, 0, 0, 0);

    const weeks: WeekData[] = [];

    // 6 weeks back + current week + 5 weeks forward = 12 weeks
    for (let w = -6; w < 6; w++) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(thisMonday.getDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 5); // Mon-Fri

      const isPast = w < 0;
      const isFuture = w > 0;
      const isCurrent = w === 0;
      const label = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      const weekEvents = filteredScheduledEvents.filter((e) => {
        const d = new Date(e.date + "T12:00:00");
        return d >= weekStart && d < weekEnd;
      });

      const buckets = computeRevenueBuckets(weekEvents);
      weeks.push({ weekStart, weekLabel: label, isPast, isFuture, isCurrent, ...buckets });
    }
    return weeks;
  }, [filteredScheduledEvents, computeRevenueBuckets]);

  const monthlyRevenueSummary = useMemo((): MonthData[] => {
    const today = new Date();
    const thisMonth = today.getMonth();
    const thisYear = today.getFullYear();
    const months: MonthData[] = [];

    // 6 months back + current month + 3 months forward = 10 months
    for (let m = -6; m <= 3; m++) {
      const d = new Date(thisYear, thisMonth + m, 1);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const isPast = m < 0;
      const isCurrent = m === 0;
      const label = monthStart.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

      const monthEvents = filteredScheduledEvents.filter((e) => {
        const ed = new Date(e.date + "T12:00:00");
        return ed >= monthStart && ed < monthEnd;
      });

      const buckets = computeRevenueBuckets(monthEvents);
      months.push({ monthLabel: label, isPast, isCurrent, ...buckets });
    }
    return months;
  }, [filteredScheduledEvents, computeRevenueBuckets]);

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

    const eventsByDate: Record<number, (ScheduledEvent & { dayNum: number; totalCalDays: number })[]> = {};
    filteredScheduledEvents.forEach((e) => {
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

    return { startDay, daysInMonth, today, eventsByDate, weekdays };
  }, [currentYear, currentMonth, filteredScheduledEvents]);

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
      if (!selectedProject || selectedProject.stage === "construction") return;
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
      setInstallDaysInput(isSurveyOrInspection ? 0.25 : project.zuperScheduledDays || project.daysInstall || 2);
      // Pre-select the default user/crew based on schedule type
      if (project.stage === "survey") {
        const surveyUsers = ZUPER_SURVEY_USERS[project.location] || [];
        setCrewSelectInput(surveyUsers[0]?.name || "");
      } else if (project.stage === "inspection") {
        const inspUsers = ZUPER_INSPECTION_USERS[project.location] || [];
        setCrewSelectInput(inspUsers[0]?.name || "");
      } else {
        const locationCrews = CREWS[project.location] || [];
        setCrewSelectInput(project.crew || locationCrews[0]?.name || "");
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
    [trackFeature]
  );

  const confirmSchedule = useCallback(async () => {
    if (!scheduleModal) return;
    const { project, date } = scheduleModal;
    const isSurveyOrInsp = project.stage === "survey" || project.stage === "inspection";
    const selectedSlot = isSurveyOrInsp ? availableSlots[selectedSlotIdx] : null;
    const days = isSurveyOrInsp ? 0.25 : (installDaysInput || 2);
    const crew = crewSelectInput || project.crew || "";
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
      crew,
      syncToZuper,
      isReschedule: !!project.zuperJobUid,
    });

    setManualSchedules((prev) => ({
      ...prev,
      [project.id]: {
        startDate: date,
        days,
        crew,
        isTentative: !syncToZuper,
        scheduleType: project.stage === "survey" ? "survey"
          : project.stage === "inspection" ? "inspection"
          : "installation",
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
      return ZUPER_CONSTRUCTION_DIRECTORS[location]; // installation/rtb/blocked
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
        const assignee = resolveZuperAssignee(scheduleType, project.location, crew);

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
              crew: selectedSlot?.userUid || assignee?.userUid,
              teamUid: selectedSlot?.teamUid || assignee?.teamUid,
              assignedUser: selectedSlot?.userName || assignee?.name,
              timezone: slotTimezone,
              notes: `Scheduled via Master Schedule${(selectedSlot?.userName || assignee?.name) ? ` — ${selectedSlot?.userName || assignee?.name}` : ""}`,
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
        const assignee = resolveZuperAssignee(scheduleType, project.location, crew);

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
              crew: selectedSlot?.userUid || assignee?.userUid || crew,
              userUid: selectedSlot?.userUid || assignee?.userUid,
              teamUid: selectedSlot?.teamUid || assignee?.teamUid,
              assignedUser: selectedSlot?.userName || assignee?.name || crew,
              timezone: slotTimezone,
              notes: `Tentatively scheduled via Master Scheduler${assignee ? ` — ${assignee.name}` : ""}`,
            },
          }),
        });

        if (response.ok) {
          const tentData = await response.json();
          // Store the record ID so we can confirm/cancel later
          if (tentData.record?.id) {
            setManualSchedules((prev) => ({
              ...prev,
              [project.id]: { ...prev[project.id], recordId: tentData.record.id },
            }));
          }
          showToast(`${getCustomerName(project.name)} tentatively scheduled for ${formatDate(date)}`);
        } else {
          showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "error");
        }
      } catch {
        showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "error");
      }
    }

    setScheduleModal(null);
    setSelectedProject(null);
  }, [scheduleModal, installDaysInput, crewSelectInput, availableSlots, selectedSlotIdx, showToast, zuperConfigured, syncToZuper, trackFeature]);

  const handleDragStart = useCallback(
    (e: React.DragEvent, projectId: string) => {
      setDraggedProjectId(projectId);
      e.dataTransfer.setData("text/plain", projectId);
      (e.target as HTMLElement).style.opacity = "0.5";
    },
    []
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedProjectId(null);
    (e.target as HTMLElement).style.opacity = "1";
  }, []);

  /* ---- Tentative: Confirm & Cancel handlers ---- */
  const [confirmingTentative, setConfirmingTentative] = useState(false);
  const [cancellingTentative, setCancellingTentative] = useState(false);

  const handleConfirmTentative = useCallback(async (projectId: string) => {
    const schedule = manualSchedules[projectId];
    if (!schedule?.recordId) {
      showToast("No tentative record found to confirm", "error");
      return;
    }
    setConfirmingTentative(true);
    try {
      const res = await fetch("/api/zuper/jobs/schedule/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleRecordId: schedule.recordId }),
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
      } else {
        showToast(data.error || "Failed to confirm", "error");
      }
    } catch {
      showToast("Failed to confirm tentative schedule", "error");
    } finally {
      setConfirmingTentative(false);
    }
  }, [manualSchedules, showToast]);

  const handleCancelTentative = useCallback(async (projectId: string) => {
    const schedule = manualSchedules[projectId];
    if (!schedule?.recordId) {
      // No DB record — just remove from local state
      setManualSchedules((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      showToast("Tentative schedule removed");
      setDetailModal(null);
      return;
    }
    setCancellingTentative(true);
    try {
      const res = await fetch("/api/zuper/schedule-records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: schedule.recordId }),
      });
      if (res.ok) {
        setManualSchedules((prev) => {
          const next = { ...prev };
          delete next[projectId];
          return next;
        });
        showToast("Tentative schedule cancelled");
        setDetailModal(null);
      } else {
        const data = await res.json();
        showToast(data.error || "Failed to cancel", "error");
      }
    } catch {
      showToast("Failed to cancel tentative schedule", "error");
    } finally {
      setCancellingTentative(false);
    }
  }, [manualSchedules, showToast]);

  const handleDrop = useCallback(
    (e: React.DragEvent, dateStr: string, crewName?: string) => {
      e.preventDefault();
      if (isWeekend(dateStr)) {
        showToast("Cannot schedule on weekends", "error");
        return;
      }
      const projectId = e.dataTransfer.getData("text/plain");
      const project = projects.find((p) => p.id === projectId);
      if (project && project.stage !== "construction") {
        const proj = crewName ? { ...project, crew: crewName } : project;
        openScheduleModal(proj, dateStr);
      }
    },
    [projects, showToast, openScheduleModal]
  );

  const handleWeekCellClick = useCallback(
    (dateStr: string, crewName: string) => {
      if (!selectedProject || selectedProject.stage === "construction") return;
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
    ];
    let csv = headers.join(",") + "\n";
    scheduledEvents.forEach((e) => {
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
  }, [scheduledEvents, showToast]);

  const exportICal = useCallback(() => {
    let ical =
      "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//PB Scheduler//EN\n";
    scheduledEvents.forEach((e) => {
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
      text += `${formatDate(e.date)} - ${getCustomerName(e.name)}\n`;
      text += `  ${e.address}\n`;
      text += `  Crew: ${e.crew || "Unassigned"} | ${e.days || e.daysInstall || 2} days | $${e.amount.toLocaleString()}\n\n`;
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
        else if (detailModal) setDetailModal(null);
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

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground/90 font-sans max-[900px]:h-auto max-[900px]:min-h-screen max-[900px]:overflow-auto">
      {/* Grid layout: project queue | calendar | optional revenue sidebar */}
      <div className={`grid h-full max-[900px]:h-auto max-[900px]:grid-cols-[1fr] ${
        revenueSidebarOpen
          ? "grid-cols-[360px_1fr_200px] max-[1400px]:grid-cols-[320px_1fr_180px] max-[1100px]:grid-cols-[300px_1fr]"
          : "grid-cols-[360px_1fr_32px] max-[1100px]:grid-cols-[320px_1fr] max-[900px]:grid-cols-[1fr]"
      }`}>
        {/* ============================================================ */}
        {/* LEFT SIDEBAR - Pipeline Queue                                */}
        {/* ============================================================ */}
        <aside className="bg-surface border-r border-t-border flex flex-col overflow-hidden max-[900px]:max-h-[50vh] max-[900px]:border-r-0 max-[900px]:border-b">
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
            <h2 className="text-[0.8rem] font-semibold mb-2 flex items-center gap-1.5">
              Install Pipeline
            </h2>
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
                  <option value="type">Sort: Job Type</option>
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
            </div>
          </div>

          {/* Calendar container */}
          <div className="flex-1 p-3 overflow-y-auto">
            {/* Instruction banner */}
            {selectedProject && selectedProject.stage !== "construction" && (
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
                            const isDraggable = isActiveType && !ev.isOverdue;

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

                            const eventColorClass =
                              isFailedType ? "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through" :
                              isCompletedType ? completedColorClass :
                              ev.isOverdue ? overdueColorClass :
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailModal(
                                    projects.find((pr) => pr.id === ev.id) ||
                                      null
                                  );
                                }}
                                title={`${ev.name} - ${ev.crew || "No crew"}${showRevenue ? ` - $${formatRevenueCompact(ev.amount)}` : ""}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : ev.isOverdue ? " ⚠ Incomplete" : " (drag to reschedule)"}`}
                                className={`text-[0.55rem] px-1 py-0.5 rounded mb-0.5 transition-transform hover:scale-[1.02] hover:shadow-lg hover:z-10 relative overflow-hidden truncate ${
                                  isDraggable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
                                } ${eventColorClass}`}
                              >
                                {ev.isTentative && <span className="mr-0.5 text-[0.45rem] font-bold opacity-80">TENT {ev.days > 0 ? `${ev.days}d` : ""}</span>}
                                {isFailedType && <span className="mr-0.5">✗</span>}
                                {isCompletedType && <span className="mr-0.5">✓</span>}
                                {ev.isOverdue && isActiveType && <span className="mr-0.5 text-red-200">!</span>}
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
                      d.toDateString() === new Date().toDateString();
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
                          const dayEvents: { event: ScheduledEvent; dayNum: number }[] = [];
                          filteredScheduledEvents.forEach((e) => {
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

                                const eventColorClass =
                                  isFailedType ? "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through" :
                                  isCompletedType ? completedColorClassW :
                                  ev.isOverdue ? overdueColorClassW :
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
                                      setDetailModal(
                                        projects.find(
                                          (pr) => pr.id === ev.id
                                        ) || null
                                      );
                                    }}
                                    title={`${ev.name}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : ev.isOverdue ? " ⚠ Incomplete" : ""}`}
                                    className={`text-[0.6rem] px-1.5 py-1 rounded mb-1 cursor-pointer transition-transform hover:scale-[1.02] hover:shadow-lg ${eventColorClass}`}
                                  >
                                    {ev.isTentative && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">TENT {ev.days > 0 ? `${ev.days}d` : ""}</span>}
                                    {isFailedType && <span className="mr-0.5">✗</span>}
                                    {isCompletedType && <span className="mr-0.5">✓</span>}
                                    {ev.isOverdue && isActiveType && <span className="mr-0.5 text-red-200">!</span>}
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
                        d.toDateString() === new Date().toDateString();
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
                            {filteredScheduledEvents
                              .filter((e) => {
                                if (e.location !== loc) return false;
                                const eventStart = new Date(e.date + "T12:00:00");
                                return (
                                  eventStart.toDateString() ===
                                  d.toDateString()
                                );
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

                                const eventColorClass =
                                  isFailedType ? "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through" :
                                  isCompletedType ? completedColorClassG :
                                  e.isOverdue ? overdueColorClassG :
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
                                    onClick={() =>
                                      setDetailModal(
                                        projects.find(
                                          (pr) => pr.id === e.id
                                        ) || null
                                      )
                                    }
                                    title={`${e.name} - ${daysLabel} - ${amount}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : e.isOverdue ? " ⚠ Incomplete" : ""}`}
                                    className={`absolute top-2 bottom-2 rounded flex items-center px-1.5 text-[0.55rem] font-medium cursor-pointer transition-transform hover:scale-y-110 hover:shadow-lg hover:z-10 overflow-hidden truncate ${eventColorClass}`}
                                    style={{
                                      left: 0,
                                      width: `calc(${calendarDays * 100}% + ${calendarDays - 1}px)`,
                                      zIndex: 1,
                                    }}
                                  >
                                    {e.isTentative && <span className="mr-0.5 text-[0.5rem] font-bold opacity-80">TENT</span>}
                                    {isFailedType && <span className="mr-0.5">✗</span>}
                                    {isCompletedType && <span className="mr-0.5">✓</span>}
                                    {e.isOverdue && isActiveType && <span className="mr-0.5 text-red-200">!</span>}
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
            {weeklyRevenueSummary.map((week, i) => {
              const hasSched = week.scheduled.count > 0;
              const hasComp = week.completed.count > 0;
              const hasIncomplete = week.overdue.count > 0;
              const hasAny = hasSched || hasComp || hasIncomplete || week.tentative.count > 0;
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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-red-500" />
                        <span className="text-[0.55rem] text-muted">Incomplete</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-red-400">
                        {week.overdue.count} · ${formatRevenueCompact(week.overdue.revenue)}
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-red-500" />
                <span className="text-[0.6rem] text-foreground/80">Incomplete</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-red-400">
                ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.overdue.revenue, 0))}
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
            {monthlyRevenueSummary.map((month, i) => {
              const hasSched = month.scheduled.count > 0;
              const hasComp = month.completed.count > 0;
              const hasIncomplete = month.overdue.count > 0;
              const hasAny = hasSched || hasComp || hasIncomplete || month.tentative.count > 0;
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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-sm bg-red-500" />
                        <span className="text-[0.55rem] text-muted">Incomplete</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-red-400">
                        {month.overdue.count} · ${formatRevenueCompact(month.overdue.revenue)}
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm bg-red-500" />
                <span className="text-[0.6rem] text-foreground/80">Incomplete</span>
              </div>
              <span className="text-[0.65rem] font-mono font-bold text-red-400">
                ${formatRevenueCompact(monthlyRevenueSummary.reduce((s, m) => s + m.overdue.revenue, 0))}
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
                    value={`${scheduleModal.project.moduleCount} panels`}
                  />
                )}
                {scheduleModal.project.inverterCount > 0 && (
                  <ModalRow
                    label="Inverters"
                    value={`${scheduleModal.project.inverterCount}`}
                  />
                )}
                {scheduleModal.project.batteries > 0 && (
                  <ModalRow
                    label="Batteries"
                    value={`${scheduleModal.project.batteries}x ${scheduleModal.project.batteryModel || "Tesla"}${scheduleModal.project.batteryExpansion ? ` + ${scheduleModal.project.batteryExpansion} expansion` : ""}`}
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
                {scheduleModal.project.zuperScheduledStart && (
                  <div className="text-[0.6rem] text-cyan-400/80 mt-1">
                    Zuper: {formatShortDate(scheduleModal.project.zuperScheduledStart.split("T")[0])}
                    {scheduleModal.project.zuperScheduledEnd && (
                      <> → {formatShortDate(scheduleModal.project.zuperScheduledEnd.split("T")[0])}</>
                    )}
                    {scheduleModal.project.zuperScheduledDays && (
                      <> ({scheduleModal.project.zuperScheduledDays}d)</>
                    )}
                  </div>
                )}
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
                  /* Construction: Days + Crew */
                  <div className="flex gap-2.5 mt-2 flex-wrap items-center">
                    <label className="text-[0.7rem] text-muted">Days:</label>
                    <input
                      type="number"
                      value={installDaysInput}
                      onChange={(e) =>
                        setInstallDaysInput(parseFloat(e.target.value) || 0.25)
                      }
                      min={0.25}
                      max={10}
                      step={0.25}
                      className="bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded font-mono text-[0.75rem] w-[60px] text-center focus:outline-none focus:border-orange-500"
                    />
                    <label className="text-[0.7rem] text-muted">Crew:</label>
                    <select
                      value={crewSelectInput}
                      onChange={(e) => setCrewSelectInput(e.target.value)}
                      className="bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded font-mono text-[0.75rem] focus:outline-none focus:border-orange-500"
                    >
                      {(CREWS[scheduleModal.project.location] || []).map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                      {!(CREWS[scheduleModal.project.location]?.length) && (
                        <option>No crews</option>
                      )}
                    </select>
                  </div>
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
            if (e.target === e.currentTarget) setDetailModal(null);
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
                    {detailModal.zuperJobUid && (
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
                    value={`${detailModal.moduleCount} panels`}
                  />
                )}
                {detailModal.inverterCount > 0 && (
                  <ModalRow
                    label="Inverters"
                    value={`${detailModal.inverterCount}`}
                  />
                )}
                {detailModal.batteries > 0 && (
                  <ModalRow
                    label="Batteries"
                    value={`${detailModal.batteries}x ${detailModal.batteryModel || "Tesla"}${detailModal.batteryExpansion ? ` + ${detailModal.batteryExpansion} expansion` : ""}`}
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

              {/* Schedule */}
              <ModalSection title="Schedule">
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
                  const displayDays =
                    detailModal.zuperScheduledDays ||
                    scheduleInfo?.days ||
                    detailModal.daysInstall ||
                    (isSurveyOrInspection ? 0.25 : 2);
                  // Prefer Zuper start date if available
                  const displayDate = detailModal.zuperScheduledStart
                    ? detailModal.zuperScheduledStart.split("T")[0]
                    : scheduleInfo?.startDate || null;
                  return (
                    <>
                      <ModalRow
                        label="Date"
                        value={
                          displayDate
                            ? formatDate(displayDate)
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
                      {detailModal.zuperScheduledStart && (
                        <div className="text-[0.6rem] text-cyan-400/70 mt-1">
                          Zuper: {formatShortDate(detailModal.zuperScheduledStart.split("T")[0])}
                          {detailModal.zuperScheduledEnd && (
                            <> → {formatShortDate(detailModal.zuperScheduledEnd.split("T")[0])}</>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </ModalSection>
            </div>

            {/* Tentative action banner */}
            {manualSchedules[detailModal.id]?.isTentative && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-dashed border-amber-400/50">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-amber-400 text-[0.7rem] font-bold uppercase tracking-wide">⏳ Tentative</span>
                  <span className="text-[0.65rem] text-muted">Not yet synced to Zuper</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirmTentative(detailModal.id)}
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

            <div className="flex gap-2 justify-end flex-wrap">
              <a
                href={detailModal.hubspotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 rounded-md bg-[#ff7a59] border border-[#ff7a59] text-white text-[0.75rem] font-semibold no-underline hover:bg-[#e66a4a] transition-colors"
              >
                Open in HubSpot
              </a>
              {detailModal.zuperJobUid && (
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
                onClick={() => setDetailModal(null)}
                className="px-3.5 py-2 rounded-md bg-background border border-t-border text-foreground/80 text-[0.75rem] cursor-pointer hover:bg-surface-2 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TOAST                                                         */}
      {/* ============================================================ */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-lg text-[0.8rem] font-medium z-[1001] transition-all duration-300 ${
          toast
            ? "translate-y-0 opacity-100"
            : "translate-y-[100px] opacity-0"
        } ${
          toast?.type === "error"
            ? "bg-red-500 text-white"
            : "bg-green-500 text-black"
        }`}
      >
        {toast?.message || ""}
      </div>
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
