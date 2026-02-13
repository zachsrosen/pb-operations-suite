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
}

interface ScheduledEvent extends SchedulerProject {
  date: string;
  eventType: string;
  days: number;
  isCompleted?: boolean;
  isOverdue?: boolean;
  isInspectionFailed?: boolean;
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
  inspection: "Inspect",
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
  const [showCompleted, setShowCompleted] = useState(true); // Toggle completed events on calendar
  const [showOverdue, setShowOverdue] = useState(true); // Toggle overdue events on calendar
  const [selectedStage, setSelectedStage] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState("amount");

  /* ---- selection / scheduling ---- */
  const [selectedProject, setSelectedProject] = useState<SchedulerProject | null>(null);
  const [manualSchedules, setManualSchedules] = useState<Record<string, ManualSchedule>>({});
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);

  /* ---- modals ---- */
  const [scheduleModal, setScheduleModal] = useState<PendingSchedule | null>(null);
  const [detailModal, setDetailModal] = useState<SchedulerProject | null>(null);
  const [installDaysInput, setInstallDaysInput] = useState(2);
  const [crewSelectInput, setCrewSelectInput] = useState("");

  /* ---- Zuper integration ---- */
  const [zuperConfigured, setZuperConfigured] = useState(false);
  const [zuperWebBaseUrl, setZuperWebBaseUrl] = useState("https://us-west-1c.zuperpro.com");
  const [syncToZuper, setSyncToZuper] = useState(true);
  const [syncingToZuper, setSyncingToZuper] = useState(false);

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
      if (transformed.length > 0) {
        try {
          const projectIds = transformed.map((p: SchedulerProject) => p.id).join(",");
          const projectNames = transformed.map((p: SchedulerProject) => encodeURIComponent(p.name)).join("|||");

          // Look up jobs for each category (survey, construction, inspection)
          const categories = ["survey", "construction", "inspection"];
          const lookupPromises = categories.map(category =>
            fetch(`/api/zuper/jobs/lookup?projectIds=${projectIds}&projectNames=${projectNames}&category=${category}`)
              .then(res => res.ok ? res.json() : null)
              .catch(() => null)
          );

          const results = await Promise.all(lookupPromises);

          // Merge Zuper job UIDs into projects (prefer matching stage category)
          for (const project of transformed) {
            // Map project stage to category
            const stageToCategory: Record<string, string> = {
              survey: "survey",
              rtb: "construction",
              blocked: "construction",
              construction: "construction",
              inspection: "inspection",
            };
            const preferredCategory = stageToCategory[project.stage] || "construction";
            const preferredIndex = categories.indexOf(preferredCategory);

            // Check preferred category first, then others
            const checkOrder = [preferredIndex, ...categories.map((_, i) => i).filter(i => i !== preferredIndex)];
            for (const idx of checkOrder) {
              const zuperData = results[idx];
              if (zuperData?.jobs?.[project.id]) {
                project.zuperJobUid = zuperData.jobs[project.id].jobUid;
                project.zuperJobStatus = zuperData.jobs[project.id].status;
                break;
              }
            }
          }
        } catch (zuperErr) {
          console.warn("Failed to lookup Zuper jobs:", zuperErr);
          // Don't fail the whole load if Zuper lookup fails
        }
      }

      setProjects(transformed);
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

  /* ================================================================ */
  /*  Toast                                                            */
  /* ================================================================ */

  const showToast = useCallback((message: string, type = "success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  /* ================================================================ */
  /*  Derived data                                                     */
  /* ================================================================ */

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((p) => {
      if (selectedLocations.length > 0 && !selectedLocations.includes(p.location))
        return false;
      if (selectedStage !== "all" && p.stage !== selectedStage) return false;
      if (
        searchText &&
        !p.name.toLowerCase().includes(searchText.toLowerCase()) &&
        !p.address.toLowerCase().includes(searchText.toLowerCase())
      )
        return false;
      if (typeFilter && (!p.type || !p.type.includes(typeFilter))) return false;
      return true;
    });
    if (sortBy === "amount") filtered.sort((a, b) => b.amount - a.amount);
    else if (sortBy === "date")
      filtered.sort((a, b) =>
        (a.scheduleDate || "z").localeCompare(b.scheduleDate || "z")
      );
    else if (sortBy === "days")
      filtered.sort((a, b) => (a.daysInstall || 1) - (b.daysInstall || 1));
    return filtered;
  }, [projects, selectedLocations, selectedStage, searchText, typeFilter, sortBy]);

  const scheduledEvents = useMemo((): ScheduledEvent[] => {
    const events: ScheduledEvent[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const seenKeys = new Set<string>();

    projects.forEach((p) => {
      // Generate separate events per milestone. Completed milestones get their own
      // event type so they render distinctly (no confusion between active vs done).

      // -- Construction --
      if (p.constructionScheduleDate) {
        const schedDate = new Date(p.constructionScheduleDate + "T12:00:00");
        const done = !!p.constructionCompleted;
        const key = `${p.id}-construction`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          events.push({
            ...p,
            date: p.constructionScheduleDate,
            eventType: done ? "construction-complete" : "construction",
            days: p.daysInstall || 1,
            isCompleted: done,
            isOverdue: !done && schedDate < today,
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
            isOverdue: !done && schedDate < today,
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
            isOverdue: !done && schedDate < today,
          });
        }
      }

      // -- Fallback for RTB/Blocked projects with scheduleDate but no constructionScheduleDate --
      if (p.scheduleDate && (p.stage === "rtb" || p.stage === "blocked") && !seenKeys.has(`${p.id}-construction`)) {
        const schedDate = new Date(p.scheduleDate + "T12:00:00");
        const done = !!p.constructionCompleted;
        const key = `${p.id}-construction`;
        seenKeys.add(key);
        events.push({
          ...p,
          date: p.scheduleDate,
          eventType: done ? "construction-complete" : p.stage,
          days: p.daysInstall || 1,
          isCompleted: done,
          isOverdue: !done && schedDate < today,
        });
      }
    });
    Object.entries(manualSchedules).forEach(([id, data]) => {
      const project = projects.find((p) => p.id === id);
      if (project) {
        const existingIdx = events.findIndex((e) => e.id === id);
        if (existingIdx > -1) events.splice(existingIdx, 1);
        events.push({
          ...project,
          date: data.startDate,
          eventType: "scheduled",
          days: data.days,
          crew: data.crew,
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
      rtb: ["rtb"],
      blocked: ["blocked"],
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
      if (!showOverdue && e.isOverdue && !e.isCompleted) return false;
      return true;
    });
  }, [scheduledEvents, calendarLocations, calendarScheduleTypes, showCompleted, showOverdue]);

  const stats = useMemo(() => {
    // Use calendar filters for stats
    let fp = calendarLocations.length > 0
      ? projects.filter((p) => calendarLocations.includes(p.location))
      : projects;
    if (calendarScheduleTypes.length > 0) {
      fp = fp.filter((p) => calendarScheduleTypes.includes(p.stage));
    }
    const rtbProjects = fp.filter((p) => p.stage === "rtb");
    const constructionProjects = fp.filter((p) => p.stage === "construction");
    const inspectionProjects = fp.filter((p) => p.stage === "inspection");
    const surveyProjects = fp.filter((p) => p.stage === "survey");
    const scheduledProjects = fp.filter((p) => p.scheduleDate);
    const unscheduledRtb = rtbProjects.filter((p) => !p.scheduleDate);
    return {
      survey: surveyProjects.length,
      rtb: rtbProjects.length,
      construction: constructionProjects.length,
      inspection: inspectionProjects.length,
      totalRevenue: formatRevenueCompact(fp.reduce((s, p) => s + p.amount, 0)),
      rtbRevenue: formatRevenueCompact(rtbProjects.reduce((s, p) => s + p.amount, 0)),
      constructionRevenue: formatRevenueCompact(constructionProjects.reduce((s, p) => s + p.amount, 0)),
      scheduledRevenue: formatRevenueCompact(scheduledProjects.reduce((s, p) => s + p.amount, 0)),
      scheduledCount: scheduledProjects.length,
      unscheduledRtbRevenue: formatRevenueCompact(unscheduledRtb.reduce((s, p) => s + p.amount, 0)),
      unscheduledRtbCount: unscheduledRtb.length,
      avgDealSize: fp.length > 0 ? formatRevenueCompact(fp.reduce((s, p) => s + p.amount, 0) / fp.length) : "0",
    };
  }, [projects, calendarLocations, calendarScheduleTypes]);

  const queueRevenue = useMemo(
    () => formatRevenueCompact(filteredProjects.reduce((s, p) => s + p.amount, 0)),
    [filteredProjects]
  );

  /* Weekly revenue summary — 6 weeks starting from the current week's Monday */
  const weeklyRevenueSummary = useMemo(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + mondayOffset);
    thisMonday.setHours(0, 0, 0, 0);

    const weeks: { weekStart: Date; weekLabel: string; construction: { count: number; revenue: number }; survey: { count: number; revenue: number }; inspection: { count: number; revenue: number }; total: { count: number; revenue: number } }[] = [];

    for (let w = 0; w < 6; w++) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(thisMonday.getDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 5); // Mon-Fri

      const label = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

      const weekEvents = filteredScheduledEvents.filter((e) => {
        const d = new Date(e.date + "T12:00:00");
        return d >= weekStart && d < weekEnd;
      });

      const constructionEvents = weekEvents.filter((e) =>
        e.eventType === "construction" || e.eventType === "rtb" || e.eventType === "blocked" || e.eventType === "scheduled"
      );
      const surveyEvents = weekEvents.filter((e) => e.eventType === "survey");
      const inspectionEvents = weekEvents.filter((e) => e.eventType === "inspection");
      // Count unique projects per category (avoid double-counting multi-day events)
      const constructionIds = new Set(constructionEvents.map((e) => e.id));
      const surveyIds = new Set(surveyEvents.map((e) => e.id));
      const inspectionIds = new Set(inspectionEvents.map((e) => e.id));
      const constructionRevenue = [...constructionIds].reduce((sum, id) => {
        const ev = constructionEvents.find((e) => e.id === id);
        return sum + (ev?.amount || 0);
      }, 0);
      const surveyRevenue = [...surveyIds].reduce((sum, id) => {
        const ev = surveyEvents.find((e) => e.id === id);
        return sum + (ev?.amount || 0);
      }, 0);
      const inspectionRevenue = [...inspectionIds].reduce((sum, id) => {
        const ev = inspectionEvents.find((e) => e.id === id);
        return sum + (ev?.amount || 0);
      }, 0);
      const totalRevenue = constructionRevenue + surveyRevenue + inspectionRevenue;
      const totalCount = constructionIds.size + surveyIds.size + inspectionIds.size;

      weeks.push({
        weekStart,
        weekLabel: label,
        construction: { count: constructionIds.size, revenue: constructionRevenue },
        survey: { count: surveyIds.size, revenue: surveyRevenue },
        inspection: { count: inspectionIds.size, revenue: inspectionRevenue },
        total: { count: totalCount, revenue: totalRevenue },
      });
    }
    return weeks;
  }, [filteredScheduledEvents]);

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
      const adjustedDate = getNextWorkday(dateStr);
      const isSurveyOrInspection =
        project.stage === "survey" || project.stage === "inspection";
      setInstallDaysInput(isSurveyOrInspection ? 0.25 : project.daysInstall || 2);
      const locationCrews = CREWS[project.location] || [];
      setCrewSelectInput(
        project.crew || locationCrews[0]?.name || ""
      );
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
    const days = installDaysInput || 2;
    const crew = crewSelectInput || project.crew || "";

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
      [project.id]: { startDate: date, days, crew },
    }));

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
              crew: crew,
              notes: `Scheduled via Master Schedule`,
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
              crew,
              assignedUser: crew,
              notes: "Tentatively scheduled via Master Scheduler",
            },
          }),
        });

        if (response.ok) {
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
  }, [scheduleModal, installDaysInput, crewSelectInput, showToast, zuperConfigured, syncToZuper, trackFeature]);

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
    { key: "all", label: "All" },
    { key: "survey", label: "Survey" },
    { key: "blocked", label: "Blocked" },
    { key: "rtb", label: "RTB" },
    { key: "construction", label: "Construction" },
    { key: "inspection", label: "Inspect" },
  ];

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground/90 font-sans max-[900px]:h-auto max-[900px]:min-h-screen max-[900px]:overflow-auto">
      {/* 3-column grid layout */}
      <div className="grid h-full max-[900px]:h-auto grid-cols-[360px_1fr] max-[1400px]:grid-cols-[320px_1fr] max-[900px]:grid-cols-[1fr]">
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
                >
                  CSV
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
                    setSelectedStage(st.key);
                    setSelectedProject(null);
                  }}
                  className={`px-2 py-1 text-[0.6rem] rounded border transition-colors ${
                    selectedStage === st.key
                      ? STAGE_TAB_ACTIVE[st.key]
                      : "bg-background border-t-border text-muted hover:border-muted"
                  }`}
                >
                  {st.label}
                </button>
              ))}
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
                {["Solar", "Battery", "EV"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setTypeFilter(typeFilter === type ? "" : type)}
                    className={`px-2 py-1 text-[0.6rem] rounded border transition-colors ${
                      typeFilter === type
                        ? "bg-orange-500 border-orange-400 text-black"
                        : "bg-background border-t-border text-muted hover:border-muted"
                    }`}
                  >
                    {type === "EV" ? "EV Charger" : type}
                  </button>
                ))}
                {/* Sort toggle */}
                {["amount", "date", "days"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`px-2 py-1 text-[0.6rem] rounded border transition-colors ${
                      sortBy === s
                        ? "bg-surface-2 border-muted text-foreground"
                        : "bg-background border-t-border text-muted hover:border-muted"
                    }`}
                  >
                    {s === "amount" ? "$ Rev" : s === "date" ? "Date" : "Days"}
                  </button>
                ))}
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
              filteredProjects.map((p) => {
                const customerName = getCustomerName(p.name);
                const types = (p.type || "")
                  .split(";")
                  .filter((t) => t.trim());
                const isScheduled = !!manualSchedules[p.id] || !!p.scheduleDate;
                const schedDate =
                  manualSchedules[p.id]?.startDate || p.scheduleDate;
                const isSurveyOrInspection =
                  p.stage === "survey" || p.stage === "inspection";

                return (
                  <div
                    key={p.id}
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
                );
              })}
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
              { value: "rtb", label: "RTB", active: "bg-emerald-500 border-emerald-400 text-black font-semibold" },
              { value: "blocked", label: "Blocked", active: "bg-yellow-500 border-yellow-400 text-black font-semibold" },
              { value: "construction", label: "Build", active: "bg-blue-500 border-blue-400 text-white font-semibold" },
              { value: "inspection", label: "Inspect", active: "bg-violet-500 border-violet-400 text-white font-semibold" },
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
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setShowOverdue(!showOverdue)}
                className={`flex items-center gap-1 px-2 py-1.5 text-[0.65rem] font-medium rounded-md border transition-colors ${
                  showOverdue
                    ? "border-t-border text-foreground/80 bg-surface-2"
                    : "border-t-border text-muted"
                }`}
              >
                <span className={`w-3 h-3 rounded border flex items-center justify-center ${
                  showOverdue ? "bg-red-500 border-red-500" : "border-t-border"
                }`}>
                  {showOverdue && <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                </span>
                Overdue
              </button>
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className={`flex items-center gap-1 px-2 py-1.5 text-[0.65rem] font-medium rounded-md border transition-colors ${
                  showCompleted
                    ? "border-t-border text-foreground/80 bg-surface-2"
                    : "border-t-border text-muted"
                }`}
              >
                <span className={`w-3 h-3 rounded border flex items-center justify-center ${
                  showCompleted ? "bg-emerald-500 border-emerald-500" : "border-t-border"
                }`}>
                  {showCompleted && <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                </span>
                Completed
              </button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex gap-1.5 p-2 bg-background border-b border-t-border flex-wrap">
            {[
              { color: "bg-cyan-500", value: stats.survey, label: "Survey" },
              { color: "bg-emerald-500", value: stats.rtb, label: "RTB" },
              { color: "bg-blue-500", value: stats.construction, label: "Construction" },
              { color: "bg-violet-500", value: stats.inspection, label: "Inspect" },
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-1 px-2 py-1 bg-surface rounded-md border border-t-border">
                <div className={`w-2 h-2 rounded-sm ${s.color}`} />
                <span className="font-mono font-semibold text-[0.8rem]">{s.value}</span>
                <span className="text-[0.55rem] text-muted uppercase">{s.label}</span>
              </div>
            ))}
            <div className="h-5 w-px bg-t-border self-center mx-0.5" />
            {[
              { color: "bg-orange-500", value: `$${stats.totalRevenue}`, label: "Pipeline" },
              { color: "bg-emerald-500", value: `$${stats.rtbRevenue}`, label: "RTB Rev" },
              { color: "bg-blue-500", value: `$${stats.constructionRevenue}`, label: "Constr Rev" },
              { color: "bg-amber-500", value: `$${stats.scheduledRevenue}`, label: `Sched (${stats.scheduledCount})` },
            ].map((s, i) => (
              <div key={`r${i}`} className="flex items-center gap-1 px-2 py-1 bg-surface rounded-md border border-t-border">
                <div className={`w-2 h-2 rounded-sm ${s.color}`} />
                <span className="font-mono font-semibold text-[0.8rem]">{s.value}</span>
                <span className="text-[0.55rem] text-muted uppercase">{s.label}</span>
              </div>
            ))}
            {stats.unscheduledRtbCount > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded-md border border-red-500/30">
                <div className="w-2 h-2 rounded-sm bg-red-500" />
                <span className="font-mono font-semibold text-[0.8rem] text-red-400">${stats.unscheduledRtbRevenue}</span>
                <span className="text-[0.55rem] text-red-400/70 uppercase">Unsched RTB ({stats.unscheduledRtbCount})</span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button onClick={exportCSV} className="px-2 py-1 text-[0.6rem] text-muted hover:text-foreground rounded border border-t-border hover:border-orange-500/50 transition-colors" title="Export CSV">CSV</button>
              <button onClick={exportICal} className="px-2 py-1 text-[0.6rem] text-muted hover:text-foreground rounded border border-t-border hover:border-orange-500/50 transition-colors" title="Export iCal">iCal</button>
              <button onClick={copySchedule} className="px-2 py-1 text-[0.6rem] text-muted hover:text-foreground rounded border border-t-border hover:border-orange-500/50 transition-colors" title="Copy to clipboard">Copy</button>
            </div>
          </div>

          {/* Weekly Revenue Summary — collapsible table for ownership */}
          <details className="bg-background border-b border-t-border">
            <summary className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[0.65rem] font-semibold text-muted uppercase tracking-wide hover:text-foreground transition-colors select-none">
              <svg className="w-3 h-3 transition-transform [details[open]>&]:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              Weekly Revenue Outlook (6 Weeks)
            </summary>
            <div className="px-3 pb-2 overflow-x-auto">
              <table className="w-full text-[0.6rem] border-collapse">
                <thead>
                  <tr className="text-muted uppercase tracking-wider">
                    <th className="text-left py-1 px-1.5 font-semibold">Week</th>
                    <th className="text-right py-1 px-1.5 font-semibold">
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" /> Construction</span>
                    </th>
                    <th className="text-right py-1 px-1.5 font-semibold">
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-cyan-500 inline-block" /> Survey</span>
                    </th>
                    <th className="text-right py-1 px-1.5 font-semibold">
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500 inline-block" /> Inspection</span>
                    </th>
                    <th className="text-right py-1 px-1.5 font-semibold text-orange-400">Week Total</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyRevenueSummary.map((week, i) => {
                    const isThisWeek = i === 0;
                    return (
                      <tr key={i} className={`border-t border-t-border/50 ${isThisWeek ? "bg-orange-500/5" : "hover:bg-surface-2"}`}>
                        <td className={`py-1.5 px-1.5 font-medium ${isThisWeek ? "text-orange-400" : "text-foreground/80"}`}>
                          {isThisWeek ? "▸ " : ""}{week.weekLabel}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono">
                          {week.construction.count > 0 ? (
                            <span className="text-blue-400">
                              <span className="font-semibold">{week.construction.count}</span>
                              <span className="text-muted mx-0.5">·</span>
                              ${formatRevenueCompact(week.construction.revenue)}
                            </span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono">
                          {week.survey.count > 0 ? (
                            <span className="text-cyan-400">
                              <span className="font-semibold">{week.survey.count}</span>
                              <span className="text-muted mx-0.5">·</span>
                              ${formatRevenueCompact(week.survey.revenue)}
                            </span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td className="py-1.5 px-1.5 text-right font-mono">
                          {week.inspection.count > 0 ? (
                            <span className="text-violet-400">
                              <span className="font-semibold">{week.inspection.count}</span>
                              <span className="text-muted mx-0.5">·</span>
                              ${formatRevenueCompact(week.inspection.revenue)}
                            </span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td className={`py-1.5 px-1.5 text-right font-mono font-semibold ${isThisWeek ? "text-orange-400" : "text-foreground/90"}`}>
                          {week.total.count > 0 ? (
                            <><span>{week.total.count}</span> <span className="text-muted mx-0.5">·</span> ${formatRevenueCompact(week.total.revenue)}</>
                          ) : <span className="text-muted">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {/* 6-week totals row */}
                  <tr className="border-t-2 border-orange-500/30 bg-surface-2">
                    <td className="py-1.5 px-1.5 font-bold text-foreground/90">6-Week Total</td>
                    <td className="py-1.5 px-1.5 text-right font-mono font-bold text-blue-400">
                      {weeklyRevenueSummary.reduce((s, w) => s + w.construction.count, 0)} · ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.construction.revenue, 0))}
                    </td>
                    <td className="py-1.5 px-1.5 text-right font-mono font-bold text-cyan-400">
                      {weeklyRevenueSummary.reduce((s, w) => s + w.survey.count, 0)} · ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.survey.revenue, 0))}
                    </td>
                    <td className="py-1.5 px-1.5 text-right font-mono font-bold text-violet-400">
                      {weeklyRevenueSummary.reduce((s, w) => s + w.inspection.count, 0)} · ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.inspection.revenue, 0))}
                    </td>
                    <td className="py-1.5 px-1.5 text-right font-mono font-bold text-orange-400">
                      {weeklyRevenueSummary.reduce((s, w) => s + w.total.count, 0)} · ${formatRevenueCompact(weeklyRevenueSummary.reduce((s, w) => s + w.total.revenue, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>

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

                            // Color mapping by event type (distinct for each type)
                            const eventColorClass =
                              isFailedType ? "bg-red-800/70 text-red-200 ring-1 ring-red-500 opacity-70" :
                              isCompletedType ? "bg-green-900/60 text-green-300 opacity-50" :
                              ev.isOverdue ? "ring-1 ring-red-500 bg-red-900/70 text-red-200 animate-pulse" :
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
                                title={`${ev.name} - ${ev.crew || "No crew"}${showRevenue ? ` - $${formatRevenueCompact(ev.amount)}` : ""}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : ev.isOverdue ? " ⚠ Overdue" : " (drag to reschedule)"}`}
                                className={`text-[0.55rem] px-1 py-0.5 rounded mb-0.5 transition-transform hover:scale-[1.02] hover:shadow-lg hover:z-10 relative overflow-hidden truncate ${
                                  isDraggable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
                                } ${eventColorClass}`}
                              >
                                {isFailedType && <span className="mr-0.5">✗</span>}
                                {isCompletedType && <span className="mr-0.5">✓</span>}
                                {ev.isOverdue && isActiveType && <span className="mr-0.5 text-red-200">!</span>}
                                {dayLabel}
                                <span className={isCompletedType ? "line-through" : ""}>{shortName}</span>
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

                  {/* Crew rows */}
                  {(() => {
                    // Use calendar multi-select locations for crew filtering
                    const locationCrews =
                      calendarLocations.length > 0
                        ? calendarLocations.flatMap(loc => CREWS[loc] || [])
                        : Object.values(CREWS).flat();
                    return locationCrews.map((crew) => (
                      <React.Fragment key={crew.name}>
                        <div
                          className="bg-background p-2.5 text-[0.7rem] font-semibold flex flex-col gap-1"
                          style={{ borderRight: `3px solid ${crew.color}` }}
                        >
                          <span className="text-foreground/90">{crew.name}</span>
                          <span className="text-[0.55rem] text-muted font-normal">
                            Inst:{crew.roofers} | Elec:{crew.electricians}
                          </span>
                        </div>
                        {weekDates.map((d, di) => {
                          const dateStr = toDateStr(d);
                          // Find events that span this date using business days (skip weekends)
                          const dayEvents: { event: ScheduledEvent; dayNum: number }[] = [];
                          filteredScheduledEvents.forEach((e) => {
                            if (e.crew !== crew.name) return;
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
                                handleWeekCellClick(dateStr, crew.name)
                              }
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) =>
                                handleDrop(e, dateStr, crew.name)
                              }
                            >
                              {dayEvents.map(({ event: ev, dayNum }, ei) => {
                                const shortName = getCustomerName(
                                  ev.name
                                ).substring(0, 10);
                                const isCompletedType = ev.eventType === "construction-complete" || ev.eventType === "inspection-pass" || ev.eventType === "survey-complete";
                                const isFailedType = ev.eventType === "inspection-fail";
                                const isActiveType = !isCompletedType && !isFailedType;

                                const eventColorClass =
                                  isFailedType ? "bg-red-800/70 text-red-200 ring-1 ring-red-500 opacity-70" :
                                  isCompletedType ? "bg-green-900/60 text-green-300 opacity-50" :
                                  ev.isOverdue ? "ring-1 ring-red-500 bg-red-900/70 text-red-200" :
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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDetailModal(
                                        projects.find(
                                          (pr) => pr.id === ev.id
                                        ) || null
                                      );
                                    }}
                                    title={`${ev.name}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : ev.isOverdue ? " ⚠ Overdue" : ""}`}
                                    className={`text-[0.6rem] px-1.5 py-1 rounded mb-1 cursor-pointer transition-transform hover:scale-[1.02] hover:shadow-lg ${eventColorClass}`}
                                  >
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

                  {/* Crew rows */}
                  {(() => {
                    // Use calendar multi-select locations for crew filtering
                    const allCrews =
                      calendarLocations.length > 0
                        ? calendarLocations.flatMap(loc => CREWS[loc] || [])
                        : Object.values(CREWS).flat();
                    return allCrews.map((crew) => (
                      <div
                        key={crew.name}
                        className="grid gap-px min-h-[50px]"
                        style={{
                          gridTemplateColumns: `140px repeat(${ganttDates.length}, 1fr)`,
                        }}
                      >
                        <div
                          className="bg-background p-2 text-[0.7rem] font-semibold"
                          style={{ borderLeft: `3px solid ${crew.color}` }}
                        >
                          {crew.name}
                        </div>
                        {ganttDates.map((d, idx) => (
                          <div
                            key={idx}
                            className="bg-surface relative"
                          >
                            {filteredScheduledEvents
                              .filter((e) => {
                                if (e.crew !== crew.name) return false;
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

                                const eventColorClass =
                                  isFailedType ? "bg-red-800/70 text-red-200 ring-1 ring-red-500 opacity-70" :
                                  isCompletedType ? "bg-green-900/60 text-green-300 opacity-50" :
                                  e.isOverdue ? "ring-1 ring-red-500 bg-red-900/70 text-red-200" :
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
                                    title={`${e.name} - ${daysLabel} - ${amount}${isFailedType ? " ✗ Inspection Failed" : isCompletedType ? " ✓ Completed" : e.isOverdue ? " ⚠ Overdue" : ""}`}
                                    className={`absolute top-2 bottom-2 rounded flex items-center px-1.5 text-[0.55rem] font-medium cursor-pointer transition-transform hover:scale-y-110 hover:shadow-lg hover:z-10 overflow-hidden truncate ${eventColorClass}`}
                                    style={{
                                      left: 0,
                                      width: `calc(${calendarDays * 100}% + ${calendarDays - 1}px)`,
                                      zIndex: 1,
                                    }}
                                  >
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

        {/* Right panel removed — Optimize & Conflicts moved to testing dashboard */}
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
                {scheduleModal.date !== getNextWorkday(scheduleModal.date) ? null : null}
                <ModalRow
                  label="Start Date"
                  value={formatDate(scheduleModal.date)}
                  valueClass="font-bold"
                />
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
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                    {(!CREWS[scheduleModal.project.location] ||
                      CREWS[scheduleModal.project.location].length === 0) && (
                      <option>No crews</option>
                    )}
                  </select>
                </div>
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
                    scheduleInfo?.days ||
                    detailModal.daysInstall ||
                    (isSurveyOrInspection ? 0.25 : 2);
                  return (
                    <>
                      <ModalRow
                        label="Date"
                        value={
                          scheduleInfo
                            ? formatDate(scheduleInfo.startDate)
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
                    </>
                  );
                })()}
              </ModalSection>
            </div>

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
