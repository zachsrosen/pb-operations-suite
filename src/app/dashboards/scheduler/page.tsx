"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";

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
  inspectionScheduleDate?: string;
  constructionScheduleDate?: string;
  daysForInstallers?: number;
  daysForElectricians?: number;
  expectedDaysForInstall?: number;
  roofersCount?: number;
  electriciansCount?: number;
  installDifficulty?: number;
  installNotes?: string;
  ahj?: string;
  utility?: string;
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
  hubspotUrl: string;
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
}

interface Conflict {
  crew: string;
  date: string;
  projects: string[];
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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // Week starts on Monday

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
  construction: "Build",
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
  if (!isSchedulable) return null;

  let scheduleDate: string | null = null;
  if (stage === "survey") {
    scheduleDate = p.siteSurveyScheduleDate || null;
  } else if (stage === "inspection") {
    scheduleDate = p.inspectionScheduleDate || null;
  } else {
    scheduleDate = p.constructionScheduleDate || null;
  }

  const loc = p.pbLocation || "Unknown";
  const isBuildStage =
    stage === "rtb" || stage === "blocked" || stage === "construction";

  return {
    id: String(p.id),
    name: p.name || `Project ${p.id}`,
    address: [p.address, p.city, p.state].filter(Boolean).join(", ") || "Address TBD",
    location: loc,
    amount: p.amount || 0,
    type: p.projectType || "Solar",
    stage,
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
    hubspotUrl:
      p.url ||
      `https://app.hubspot.com/contacts/21710069/record/0-3/${p.id}`,
  };
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function SchedulerPage() {
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
  const [selectedLocation, setSelectedLocation] = useState("All"); // For calendar view (single-select)
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

  /* ---- optimize stats ---- */
  const [optimizeStats, setOptimizeStats] = useState<string>(
    "Schedules RTB projects + inspections | Priority: Easiest first, then by revenue"
  );

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

      // Look up Zuper job UIDs for these projects (construction jobs)
      if (transformed.length > 0) {
        try {
          const projectIds = transformed.map((p: SchedulerProject) => p.id).join(",");
          const projectNames = transformed.map((p: SchedulerProject) => encodeURIComponent(p.name)).join(",");
          const zuperResponse = await fetch(`/api/zuper/jobs/lookup?projectIds=${projectIds}&projectNames=${projectNames}&category=construction`);
          if (zuperResponse.ok) {
            const zuperData = await zuperResponse.json();
            if (zuperData.jobs) {
              // Merge Zuper job UIDs into projects
              for (const project of transformed) {
                const zuperJob = zuperData.jobs[project.id];
                if (zuperJob) {
                  project.zuperJobUid = zuperJob.jobUid;
                  project.zuperJobStatus = zuperJob.status;
                }
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
    let filtered = projects.filter((p) => {
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
    projects.forEach((p) => {
      if (p.scheduleDate) {
        events.push({
          ...p,
          date: p.scheduleDate,
          eventType: p.stage,
          days: p.daysInstall || 1,
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

  const conflicts = useMemo((): Conflict[] => {
    const result: Conflict[] = [];
    const crewSchedules: Record<string, { date: string; project: ScheduledEvent }[]> = {};
    scheduledEvents.forEach((e) => {
      if (!e.crew) return;
      if (!crewSchedules[e.crew]) crewSchedules[e.crew] = [];
      const start = new Date(e.date);
      for (let i = 0; i < Math.ceil(e.days || 1); i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        crewSchedules[e.crew].push({ date: toDateStr(d), project: e });
      }
    });
    Object.entries(crewSchedules).forEach(([crew, days]) => {
      const dateMap: Record<string, ScheduledEvent[]> = {};
      days.forEach((d) => {
        if (!dateMap[d.date]) dateMap[d.date] = [];
        dateMap[d.date].push(d.project);
      });
      Object.entries(dateMap).forEach(([date, projs]) => {
        if (projs.length > 1) {
          result.push({
            crew,
            date,
            projects: projs.map((p) => getCustomerName(p.name)),
          });
        }
      });
    });
    return result;
  }, [scheduledEvents]);

  const stats = useMemo(() => {
    // Use selectedLocations for multi-select filtering, fall back to selectedLocation for calendar view
    const fp =
      selectedLocations.length > 0
        ? projects.filter((p) => selectedLocations.includes(p.location))
        : selectedLocation === "All"
          ? projects
          : projects.filter((p) => p.location === selectedLocation);
    return {
      survey: fp.filter((p) => p.stage === "survey").length,
      rtb: fp.filter((p) => p.stage === "rtb").length,
      construction: fp.filter((p) => p.stage === "construction").length,
      inspection: fp.filter((p) => p.stage === "inspection").length,
      totalRevenue: formatRevenueCompact(fp.reduce((s, p) => s + p.amount, 0)),
    };
  }, [projects, selectedLocation, selectedLocations]);

  const queueRevenue = useMemo(
    () => formatRevenueCompact(filteredProjects.reduce((s, p) => s + p.amount, 0)),
    [filteredProjects]
  );

  /* ================================================================ */
  /*  Calendar logic                                                   */
  /* ================================================================ */

  const calendarData = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    // Convert Sunday=0 to Monday-first index (Mon=0, Tue=1, ..., Sun=6)
    const jsDay = firstDay.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const startDay = jsDay === 0 ? 6 : jsDay - 1; // Convert to Mon=0, Sun=6
    const daysInMonth = lastDay.getDate();
    const today = new Date();

    const eventsByDate: Record<number, (ScheduledEvent & { dayNum: number; totalCalDays: number })[]> = {};
    scheduledEvents.forEach((e) => {
      // Filter by multi-select locations if any selected, otherwise use single-select
      if (selectedLocations.length > 0 && !selectedLocations.includes(e.location)) return;
      if (selectedLocations.length === 0 && selectedLocation !== "All" && e.location !== selectedLocation) return;
      const startDate = new Date(e.date);
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

    return { startDay, daysInMonth, today, eventsByDate };
  }, [currentYear, currentMonth, scheduledEvents, selectedLocation, selectedLocations]);

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
      setScheduleModal({ project, date: adjustedDate });
    },
    []
  );

  const confirmSchedule = useCallback(async () => {
    if (!scheduleModal) return;
    const { project, date } = scheduleModal;
    const days = installDaysInput || 2;
    const crew = crewSelectInput || project.crew || "";

    setManualSchedules((prev) => ({
      ...prev,
      [project.id]: { startDate: date, days, crew },
    }));

    // Sync to Zuper if enabled
    if (zuperConfigured && syncToZuper) {
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
            },
            schedule: {
              type: scheduleType,
              date: date,
              days: days,
              crew: crew,
              notes: `Scheduled via Master Scheduler`,
            },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          showToast(
            `${getCustomerName(project.name)} scheduled - ${data.action === "rescheduled" ? "Zuper job updated" : "Zuper job created"} (customer notified)`
          );
        } else {
          showToast(
            `${getCustomerName(project.name)} scheduled locally (Zuper sync failed)`,
            "error"
          );
        }
      } catch {
        showToast(
          `${getCustomerName(project.name)} scheduled locally (Zuper sync failed)`,
          "error"
        );
      } finally {
        setSyncingToZuper(false);
      }
    } else {
      showToast(
        `${getCustomerName(project.name)} scheduled for ${formatDate(date)}`
      );
    }

    setScheduleModal(null);
    setSelectedProject(null);
  }, [scheduleModal, installDaysInput, crewSelectInput, showToast, zuperConfigured, syncToZuper]);

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

  /* ---- Auto optimize ---- */
  const autoOptimize = useCallback(() => {
    // Get RTB projects (for construction) and Inspection projects
    const rtbProjects = projects.filter(
      (p) => p.stage === "rtb" && !manualSchedules[p.id] && !p.scheduleDate
    );
    const inspectionProjects = projects.filter(
      (p) => p.stage === "inspection" && !manualSchedules[p.id] && !p.scheduleDate
    );

    if (rtbProjects.length === 0 && inspectionProjects.length === 0) {
      showToast("No unscheduled RTB or Inspection projects to optimize", "error");
      return;
    }

    // Sort RTB projects by difficulty first (easiest = 1), then by revenue (highest first)
    rtbProjects.sort((a, b) => {
      const diffA = a.difficulty || 3; // Default to medium difficulty (3) if not set
      const diffB = b.difficulty || 3;
      if (diffA !== diffB) {
        return diffA - diffB; // Easier projects first (lower number = easier)
      }
      return b.amount - a.amount; // Then by revenue (highest first)
    });

    // Sort inspection projects by revenue (highest first)
    inspectionProjects.sort((a, b) => b.amount - a.amount);

    const crewNextDate: Record<string, string> = {};
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + 1);
    const baseDateStr = toDateStr(baseDate);

    Object.values(CREWS)
      .flat()
      .forEach((c) => {
        crewNextDate[c.name] = getNextWorkday(baseDateStr);
      });

    scheduledEvents.forEach((e) => {
      if (e.crew && crewNextDate[e.crew]) {
        const endDate = addBusinessDays(e.date, Math.ceil(e.days || 1));
        const nextAvailable = getNextWorkday(endDate);
        if (nextAvailable > crewNextDate[e.crew]) {
          crewNextDate[e.crew] = nextAvailable;
        }
      }
    });

    let scheduledInstalls = 0;
    let scheduledInspections = 0;
    const newSchedules: Record<string, ManualSchedule> = { ...manualSchedules };

    // Schedule RTB projects (construction) AND their inspections
    rtbProjects.forEach((p) => {
      const preferredCrew = p.crew;
      if (preferredCrew && crewNextDate[preferredCrew]) {
        const startDate = getNextWorkday(crewNextDate[preferredCrew]);
        const jobDays = Math.ceil(p.daysInstall || 2);

        newSchedules[p.id] = {
          startDate,
          days: p.daysInstall || 2,
          crew: preferredCrew,
        };

        // Calculate construction end date and schedule inspection 2 business days after
        const constructionEndDate = addBusinessDays(startDate, jobDays);
        const inspectionDate = addBusinessDays(constructionEndDate, 2);

        // Note: Inspection is logged but not stored separately as it would need a separate tracking mechanism
        console.log(`Scheduled ${p.name}: Install ${startDate}, Inspection ${inspectionDate}`);

        crewNextDate[preferredCrew] = getNextWorkday(
          addBusinessDays(startDate, jobDays)
        );
        scheduledInstalls++;
      }
    });

    // Schedule standalone inspection projects (projects already in Inspection stage)
    inspectionProjects.forEach((p) => {
      const preferredCrew = p.crew;
      if (preferredCrew && crewNextDate[preferredCrew]) {
        const startDate = getNextWorkday(crewNextDate[preferredCrew]);
        newSchedules[p.id] = {
          startDate,
          days: 0.25, // Inspections are quick (quarter day)
          crew: preferredCrew,
        };
        // Inspections are quick, so next crew availability is the next workday
        crewNextDate[preferredCrew] = getNextWorkday(startDate);
        scheduledInspections++;
      }
    });

    setManualSchedules(newSchedules);

    // Build summary message
    const totalScheduled = scheduledInstalls + scheduledInspections;
    let msg = "";
    if (scheduledInstalls > 0 && scheduledInspections > 0) {
      msg = `Scheduled ${scheduledInstalls} installs + ${scheduledInspections} inspections`;
    } else if (scheduledInstalls > 0) {
      msg = `Scheduled ${scheduledInstalls} installs (easiest first) + inspections`;
    } else {
      msg = `Scheduled ${scheduledInspections} inspections`;
    }
    showToast(msg);

    const totalRevValue = rtbProjects
        .slice(0, scheduledInstalls)
        .reduce((s, p) => s + p.amount, 0);
    const totalRev = formatRevenueCompact(totalRevValue);
    setOptimizeStats(
      `${scheduledInstalls} installs, ${scheduledInstalls} inspections | $${totalRev} | Sorted: Easiest → Hardest`
    );
  }, [projects, manualSchedules, scheduledEvents, showToast]);

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
      if (e.key === "o" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        autoOptimize();
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
    autoOptimize,
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
    { key: "rtb", label: "RTB" },
    { key: "blocked", label: "Blocked" },
    { key: "construction", label: "Build" },
    { key: "inspection", label: "Inspect" },
  ];

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="h-screen overflow-hidden bg-[#0a0a0f] text-zinc-200 font-sans max-[900px]:h-auto max-[900px]:min-h-screen max-[900px]:overflow-auto">
      {/* 3-column grid layout */}
      <div className="grid grid-cols-[360px_1fr_280px] h-full max-[1400px]:grid-cols-[320px_1fr_240px] max-[1100px]:grid-cols-[320px_1fr] max-[900px]:grid-cols-[1fr] max-[900px]:h-auto">
        {/* ============================================================ */}
        {/* LEFT SIDEBAR - Pipeline Queue                                */}
        {/* ============================================================ */}
        <aside className="bg-[#12121a] border-r border-zinc-800 flex flex-col overflow-hidden max-[900px]:max-h-[50vh] max-[900px]:border-r-0 max-[900px]:border-b">
          {/* Header */}
          <header className="p-4 border-b border-zinc-800 bg-gradient-to-br from-[#12121a] to-[#1a1a28]">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-transparent">
                  PB Master Scheduler
                </h1>
                <div className="text-[0.65rem] text-zinc-500 mt-0.5">
                  RTB + Construction &bull; Live HubSpot Data
                </div>
              </div>
              <div className="flex gap-1.5">
                <Link
                  href="/"
                  className="px-2.5 py-1.5 text-[0.7rem] rounded-md bg-[#0a0a0f] border border-zinc-800 text-zinc-300 hover:border-orange-500 hover:text-orange-400 transition-colors"
                >
                  &larr; Back
                </Link>
                <button
                  onClick={exportCSV}
                  className="px-2.5 py-1.5 text-[0.7rem] rounded-md bg-[#0a0a0f] border border-zinc-800 text-zinc-300 hover:border-orange-500 hover:text-orange-400 transition-colors"
                >
                  CSV
                </button>
              </div>
            </div>
          </header>

          {/* Queue header with filters */}
          <div className="p-3 border-b border-zinc-800">
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
                      : "bg-[#0a0a0f] border-zinc-800 text-zinc-500 hover:border-zinc-600"
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
                className="w-full bg-[#0a0a0f] border border-zinc-800 text-zinc-200 px-2 py-1.5 rounded-md text-[0.7rem] focus:outline-none focus:border-orange-500 placeholder:text-zinc-600"
              />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-zinc-800 text-zinc-200 px-2 py-1.5 rounded-md text-[0.7rem] focus:outline-none focus:border-orange-500"
              >
                <option value="">All Types</option>
                <option value="Solar">Solar</option>
                <option value="Battery">Battery</option>
                <option value="EV">EV Charger</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-zinc-800 text-zinc-200 px-2 py-1.5 rounded-md text-[0.7rem] focus:outline-none focus:border-orange-500"
              >
                <option value="amount">Sort: Revenue</option>
                <option value="date">Sort: Date</option>
                <option value="days">Sort: Install Days</option>
              </select>
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
                        : "bg-[#0a0a0f] border-zinc-700 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {loc.replace("Colorado Springs", "CO Spgs").replace("San Luis Obispo", "SLO")}
                  </button>
                ))}
                {selectedLocations.length > 0 && (
                  <button
                    onClick={() => setSelectedLocations([])}
                    className="px-1.5 py-0.5 text-[0.6rem] text-zinc-500 hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Queue count */}
          <div className="text-[0.65rem] text-zinc-500 px-3 py-2 border-b border-zinc-800 bg-[#0a0a0f] flex justify-between">
            <span>{filteredProjects.length} projects</span>
            <span>${queueRevenue}K</span>
          </div>

          {/* Queue list */}
          <div className="flex-1 overflow-y-auto p-2">
            {loading && (
              <div className="p-8 text-center text-zinc-500">
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
                    className={`bg-[#0a0a0f] border rounded-lg p-2.5 mb-1.5 cursor-grab transition-all hover:border-orange-500 hover:translate-x-0.5 border-l-[3px] ${
                      STAGE_BORDER_COLORS[p.stage] || "border-l-zinc-600"
                    } ${
                      selectedProject?.id === p.id
                        ? "border-orange-500 bg-orange-500/10 shadow-[0_0_0_1px] shadow-orange-500"
                        : "border-zinc-800"
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
                      className="text-[0.6rem] text-zinc-500 mb-1 truncate"
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
                                    : "bg-zinc-700 text-zinc-400"
                        }`}
                      >
                        {STAGE_ICONS[p.stage] || p.stage}
                      </span>
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
                                : "bg-zinc-700 text-zinc-400"
                          }`}
                        >
                          {t.trim()}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      {p.systemSize > 0 && (
                        <span className="text-[0.55rem] text-zinc-500">
                          <strong className="text-zinc-300">
                            {p.systemSize.toFixed(1)}
                          </strong>{" "}
                          kW
                        </span>
                      )}
                      {p.moduleCount > 0 && (
                        <span className="text-[0.55rem] text-zinc-500">
                          <strong className="text-zinc-300">
                            {p.moduleCount}
                          </strong>{" "}
                          mod
                        </span>
                      )}
                      {p.inverterCount > 0 && (
                        <span className="text-[0.55rem] text-zinc-500">
                          <strong className="text-zinc-300">
                            {p.inverterCount}
                          </strong>{" "}
                          inv
                        </span>
                      )}
                      {p.batteries > 0 && (
                        <span className="text-[0.55rem] text-zinc-500">
                          <strong className="text-zinc-300">
                            {p.batteries}
                          </strong>{" "}
                          batt
                        </span>
                      )}
                      {p.batteryExpansion > 0 && (
                        <span className="text-[0.55rem] text-zinc-500">
                          <strong className="text-zinc-300">
                            +{p.batteryExpansion}
                          </strong>{" "}
                          exp
                        </span>
                      )}
                      {p.evCount > 0 && (
                        <span className="text-[0.55rem] text-zinc-500">
                          <strong className="text-zinc-300">{p.evCount}</strong>{" "}
                          EV
                        </span>
                      )}
                    </div>
                    {isSurveyOrInspection ? (
                      <div className="flex gap-1.5 mt-0.5 flex-wrap">
                        {p.ahj && (
                          <span className="text-[0.55rem] text-zinc-500">
                            AHJ: {p.ahj}
                          </span>
                        )}
                        {p.utility && (
                          <span className="text-[0.55rem] text-zinc-500">
                            Util: {p.utility}
                          </span>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-1.5 mt-0.5 flex-wrap">
                          {p.daysInstall > 0 && (
                            <span className="text-[0.55rem] text-zinc-500">
                              <strong className="text-zinc-300">
                                {p.daysInstall}
                              </strong>
                              d inst
                            </span>
                          )}
                          {p.daysElec > 0 && (
                            <span className="text-[0.55rem] text-zinc-500">
                              <strong className="text-zinc-300">
                                {p.daysElec}
                              </strong>
                              d elec
                            </span>
                          )}
                          {!p.daysInstall && !p.daysElec && p.totalDays > 0 && (
                            <span className="text-[0.55rem] text-zinc-500">
                              <strong className="text-zinc-300">
                                {p.totalDays}
                              </strong>
                              d
                            </span>
                          )}
                          {p.roofersCount > 0 && (
                            <span className="text-[0.55rem] text-zinc-500">
                              Inst:{p.roofersCount}
                            </span>
                          )}
                          {p.electriciansCount > 0 && (
                            <span className="text-[0.55rem] text-zinc-500">
                              Elec:{p.electriciansCount}
                            </span>
                          )}
                          {p.difficulty > 0 && (
                            <span className="text-[0.55rem] text-zinc-500">
                              D{p.difficulty}
                            </span>
                          )}
                        </div>
                        {p.installNotes && (
                          <div
                            className="text-[0.55rem] text-zinc-500 mt-1 italic truncate"
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
          <div className="flex gap-0.5 p-2 bg-[#0a0a0f] border-b border-zinc-800">
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
                    : "bg-[#12121a] border-zinc-800 text-zinc-500 hover:border-zinc-600"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Location tabs */}
          <div className="flex gap-0.5 p-2 bg-[#0a0a0f] border-b border-zinc-800 overflow-x-auto">
            {LOCATIONS.map((loc) => {
              const locProjects =
                loc === "All"
                  ? projects
                  : projects.filter((p) => p.location === loc);
              const count = locProjects.length;
              const revenue = formatRevenueCompact(
                locProjects.reduce((s, p) => s + p.amount, 0)
              );
              return (
                <button
                  key={loc}
                  onClick={() => setSelectedLocation(loc)}
                  className={`px-2.5 py-1.5 text-[0.65rem] font-medium rounded-md border transition-colors whitespace-nowrap ${
                    selectedLocation === loc
                      ? "border-orange-500 text-orange-400 bg-orange-500/10"
                      : "bg-[#12121a] border-zinc-800 text-zinc-500 hover:border-zinc-600"
                  }`}
                >
                  {loc === "All" ? "All" : loc}{" "}
                  <span className="font-mono opacity-70">{count}</span>
                  <span className="text-[0.55rem] opacity-60 block">
                    ${revenue}K
                  </span>
                </button>
              );
            })}
          </div>

          {/* Stats bar */}
          <div className="flex gap-1.5 p-2 bg-[#0a0a0f] border-b border-zinc-800 flex-wrap">
            {[
              { color: "bg-cyan-500", value: stats.survey, label: "Survey" },
              { color: "bg-emerald-500", value: stats.rtb, label: "RTB" },
              {
                color: "bg-blue-500",
                value: stats.construction,
                label: "Building",
              },
              {
                color: "bg-violet-500",
                value: stats.inspection,
                label: "Inspect",
              },
              {
                color: "bg-orange-500",
                value: `$${stats.totalRevenue}K`,
                label: "Pipeline",
              },
            ].map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-1 px-2 py-1 bg-[#12121a] rounded-md border border-zinc-800"
              >
                <div className={`w-2 h-2 rounded-sm ${s.color}`} />
                <span className="font-mono font-semibold text-[0.8rem]">
                  {s.value}
                </span>
                <span className="text-[0.55rem] text-zinc-500 uppercase">
                  {s.label}
                </span>
              </div>
            ))}
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
                    className="bg-[#12121a] border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded-md text-[0.7rem] hover:bg-zinc-800 transition-colors"
                  >
                    &larr; Prev
                  </button>
                  <div className="text-base font-semibold">
                    {MONTH_NAMES[currentMonth]} {currentYear}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={nextMonth}
                      className="bg-[#12121a] border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded-md text-[0.7rem] hover:bg-zinc-800 transition-colors"
                    >
                      Next &rarr;
                    </button>
                    <button
                      onClick={goToToday}
                      className="bg-[#12121a] border border-zinc-800 text-zinc-300 px-2 py-1 rounded-md text-[0.65rem] hover:bg-zinc-800 transition-colors"
                    >
                      Today
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-0.5 bg-zinc-800 rounded-lg overflow-hidden p-0.5">
                  {/* Day headers */}
                  {DAY_NAMES.map((d) => (
                    <div
                      key={d}
                      className="bg-[#12121a] py-2 text-center font-semibold text-[0.65rem] text-zinc-500"
                    >
                      {d}
                    </div>
                  ))}

                  {/* Previous month padding */}
                  {Array.from({ length: calendarData.startDay }).map((_, i) => {
                    const prevDays = new Date(
                      currentYear,
                      currentMonth,
                      0
                    ).getDate();
                    return (
                      <div
                        key={`prev-${i}`}
                        className="bg-[#12121a] min-h-[90px] p-1 opacity-40"
                      >
                        <div className="text-[0.7rem] font-semibold text-zinc-500">
                          {prevDays - calendarData.startDay + i + 1}
                        </div>
                      </div>
                    );
                  })}

                  {/* Current month days */}
                  {Array.from({ length: calendarData.daysInMonth }).map(
                    (_, idx) => {
                      const day = idx + 1;
                      const currentDate = new Date(
                        currentYear,
                        currentMonth,
                        day
                      );
                      const isToday =
                        calendarData.today.getDate() === day &&
                        calendarData.today.getMonth() === currentMonth &&
                        calendarData.today.getFullYear() === currentYear;
                      const isWkEnd =
                        currentDate.getDay() === 0 ||
                        currentDate.getDay() === 6;
                      const dayEvents = calendarData.eventsByDate[day] || [];
                      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

                      return (
                        <div
                          key={day}
                          className={`bg-[#12121a] min-h-[90px] p-1 relative transition-colors ${
                            isToday
                              ? "ring-2 ring-inset ring-orange-500"
                              : ""
                          } ${
                            canDrop && !isWkEnd
                              ? "hover:bg-orange-500/10 hover:ring-2 hover:ring-inset hover:ring-orange-500"
                              : ""
                          } ${
                            isWkEnd
                              ? "bg-black/30 opacity-60 cursor-default"
                              : "cursor-pointer hover:bg-[#1a1a24]"
                          }`}
                          onClick={
                            !isWkEnd
                              ? () => handleDayClick(dateStr)
                              : undefined
                          }
                          onDragOver={
                            !isWkEnd
                              ? (e) => e.preventDefault()
                              : undefined
                          }
                          onDrop={
                            !isWkEnd
                              ? (e) => handleDrop(e, dateStr)
                              : undefined
                          }
                        >
                          <div
                            className={`text-[0.7rem] font-semibold mb-0.5 ${
                              isToday ? "text-orange-400" : "text-zinc-500"
                            }`}
                          >
                            {day}
                          </div>
                          {dayEvents.slice(0, 4).map((ev, ei) => {
                            const shortName = getCustomerName(ev.name).substring(
                              0,
                              8
                            );
                            const dayLabel =
                              ev.totalCalDays > 1 ? `D${ev.dayNum} ` : "";
                            return (
                              <div
                                key={ei}
                                draggable
                                onDragStart={(e) => {
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
                                title={`${ev.name} - ${ev.crew || "No crew"} (drag to reschedule)`}
                                className={`text-[0.55rem] px-1 py-0.5 rounded mb-0.5 cursor-grab active:cursor-grabbing transition-transform hover:scale-[1.02] hover:shadow-lg hover:z-10 relative overflow-hidden truncate ${
                                  ev.eventType === "rtb"
                                    ? "bg-emerald-500 text-black"
                                    : ev.eventType === "blocked"
                                      ? "bg-yellow-500 text-black"
                                      : ev.eventType === "construction"
                                        ? "bg-blue-500 text-white"
                                        : ev.eventType === "survey"
                                          ? "bg-cyan-500 text-white"
                                          : ev.eventType === "inspection"
                                            ? "bg-violet-500 text-white"
                                            : ev.eventType === "scheduled"
                                              ? "bg-cyan-500 text-white"
                                              : "bg-zinc-600 text-white"
                                }`}
                              >
                                {dayLabel}
                                {shortName}
                              </div>
                            );
                          })}
                          {dayEvents.length > 4 && (
                            <div className="text-[0.55rem] text-zinc-500 text-center py-0.5 cursor-pointer">
                              +{dayEvents.length - 4}
                            </div>
                          )}
                        </div>
                      );
                    }
                  )}

                  {/* Next month padding */}
                  {(() => {
                    const total =
                      calendarData.startDay + calendarData.daysInMonth;
                    const rem = 7 - (total % 7);
                    if (rem < 7) {
                      return Array.from({ length: rem }).map((_, i) => (
                        <div
                          key={`next-${i}`}
                          className="bg-[#12121a] min-h-[90px] p-1 opacity-40"
                        >
                          <div className="text-[0.7rem] font-semibold text-zinc-500">
                            {i + 1}
                          </div>
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
                    className="bg-[#12121a] border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded-md text-[0.7rem] hover:bg-zinc-800 transition-colors"
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
                    className="bg-[#12121a] border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded-md text-[0.7rem] hover:bg-zinc-800 transition-colors"
                  >
                    Next Week &rarr;
                  </button>
                </div>

                <div className="grid gap-px bg-zinc-800 rounded-lg overflow-hidden" style={{ gridTemplateColumns: "100px repeat(5, 1fr)" }}>
                  {/* Header row */}
                  <div className="bg-[#0a0a0f] p-2" />
                  {weekDates.map((d, i) => {
                    const isToday =
                      d.toDateString() === new Date().toDateString();
                    return (
                      <div
                        key={i}
                        className={`p-2.5 text-center text-[0.7rem] font-semibold ${
                          isToday
                            ? "text-orange-400 bg-orange-500/10"
                            : "text-zinc-500 bg-[#12121a]"
                        }`}
                      >
                        {d.toLocaleDateString("en-US", { weekday: "short" })}
                        <span className="text-base font-bold block mt-0.5 text-zinc-200">
                          {d.getDate()}
                        </span>
                      </div>
                    );
                  })}

                  {/* Crew rows */}
                  {(() => {
                    // Use multi-select locations if any selected, otherwise fall back to single-select
                    const locationCrews =
                      selectedLocations.length > 0
                        ? selectedLocations.flatMap(loc => CREWS[loc] || [])
                        : selectedLocation === "All"
                          ? Object.values(CREWS).flat()
                          : CREWS[selectedLocation] || [];
                    return locationCrews.map((crew) => (
                      <React.Fragment key={crew.name}>
                        <div
                          className="bg-[#0a0a0f] p-2.5 text-[0.7rem] font-semibold flex flex-col gap-1"
                          style={{ borderRight: `3px solid ${crew.color}` }}
                        >
                          <span className="text-zinc-200">{crew.name}</span>
                          <span className="text-[0.55rem] text-zinc-500 font-normal">
                            Inst:{crew.roofers} | Elec:{crew.electricians}
                          </span>
                        </div>
                        {weekDates.map((d, di) => {
                          const dateStr = toDateStr(d);
                          const dayEvents = scheduledEvents.filter((e) => {
                            if (e.crew !== crew.name) return false;
                            const eventStart = new Date(e.date);
                            const eventEnd = new Date(e.date);
                            eventEnd.setDate(
                              eventEnd.getDate() +
                                Math.ceil(e.days || 1) -
                                1
                            );
                            return d >= eventStart && d <= eventEnd;
                          });
                          return (
                            <div
                              key={di}
                              className={`bg-[#12121a] min-h-[70px] p-1 cursor-pointer transition-colors hover:bg-[#1a1a24] ${
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
                              {dayEvents.map((ev, ei) => {
                                const dayNum =
                                  Math.floor(
                                    (d.getTime() -
                                      new Date(ev.date).getTime()) /
                                      (1000 * 60 * 60 * 24)
                                  ) + 1;
                                const shortName = getCustomerName(
                                  ev.name
                                ).substring(0, 10);
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
                                    title={ev.name}
                                    className={`text-[0.6rem] px-1.5 py-1 rounded mb-1 cursor-pointer transition-transform hover:scale-[1.02] hover:shadow-lg ${
                                      ev.eventType === "rtb"
                                        ? "bg-emerald-500 text-black"
                                        : ev.eventType === "blocked"
                                          ? "bg-yellow-500 text-black"
                                          : ev.eventType === "construction"
                                            ? "bg-blue-500 text-white"
                                            : ev.eventType === "survey"
                                              ? "bg-cyan-500 text-white"
                                              : ev.eventType === "inspection"
                                                ? "bg-violet-500 text-white"
                                                : ev.eventType === "scheduled"
                                                  ? "bg-cyan-500 text-white"
                                                  : "bg-zinc-600 text-white"
                                    }`}
                                  >
                                    {ev.days > 1 ? `D${dayNum} ` : ""}
                                    {shortName}
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

                <div className="bg-zinc-800 rounded-lg overflow-hidden">
                  {/* Header timeline */}
                  <div
                    className="grid gap-px"
                    style={{
                      gridTemplateColumns: `140px repeat(${ganttDates.length}, 1fr)`,
                    }}
                  >
                    <div className="bg-[#0a0a0f] p-1.5 text-[0.7rem] font-semibold">
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
                              : "bg-[#12121a] text-zinc-500"
                          }`}
                        >
                          <span className="font-semibold">
                            {d.toLocaleDateString("en-US", {
                              weekday: "short",
                            })}
                          </span>
                          <span className="text-[0.7rem] text-zinc-200 block">
                            {d.getDate()}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Crew rows */}
                  {(() => {
                    // Use multi-select locations if any selected, otherwise fall back to single-select
                    const allCrews =
                      selectedLocations.length > 0
                        ? selectedLocations.flatMap(loc => CREWS[loc] || [])
                        : selectedLocation === "All"
                          ? Object.values(CREWS).flat()
                          : CREWS[selectedLocation] || [];
                    return allCrews.map((crew) => (
                      <div
                        key={crew.name}
                        className="grid gap-px min-h-[50px]"
                        style={{
                          gridTemplateColumns: `140px repeat(${ganttDates.length}, 1fr)`,
                        }}
                      >
                        <div
                          className="bg-[#0a0a0f] p-2 text-[0.7rem] font-semibold"
                          style={{ borderLeft: `3px solid ${crew.color}` }}
                        >
                          {crew.name}
                        </div>
                        {ganttDates.map((d, idx) => (
                          <div
                            key={idx}
                            className="bg-[#12121a] relative"
                          >
                            {scheduledEvents
                              .filter((e) => {
                                if (e.crew !== crew.name) return false;
                                const eventStart = new Date(e.date);
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
                                    title={`${e.name} - ${daysLabel} - ${amount}`}
                                    className={`absolute top-2 bottom-2 rounded flex items-center px-1.5 text-[0.55rem] font-medium cursor-pointer transition-transform hover:scale-y-110 hover:shadow-lg hover:z-10 overflow-hidden truncate ${
                                      e.eventType === "construction"
                                        ? "bg-blue-500 text-white"
                                        : e.eventType === "rtb"
                                          ? "bg-emerald-500 text-black"
                                          : e.eventType === "scheduled"
                                            ? "bg-cyan-500 text-white"
                                            : e.eventType === "blocked"
                                              ? "bg-yellow-500 text-black"
                                              : e.eventType === "survey"
                                                ? "bg-cyan-500 text-white"
                                                : e.eventType === "inspection"
                                                  ? "bg-violet-500 text-white"
                                                  : "bg-zinc-500 text-white"
                                    }`}
                                    style={{
                                      left: 0,
                                      width: `calc(${calendarDays * 100}% + ${calendarDays - 1}px)`,
                                      zIndex: 1,
                                    }}
                                  >
                                    {shortName} ({daysLabel})
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
        {/* RIGHT PANEL - Crew & Optimization                            */}
        {/* ============================================================ */}
        <aside className="bg-[#12121a] border-l border-zinc-800 flex flex-col overflow-hidden max-[1100px]:hidden">
          {/* Auto-optimize */}
          <div className="p-3 border-b border-zinc-800">
            <div className="text-[0.75rem] font-semibold mb-2 flex items-center gap-1.5">
              Auto-Optimize
            </div>
            <button
              onClick={autoOptimize}
              className="w-full py-2.5 text-[0.75rem] rounded-md cursor-pointer bg-gradient-to-r from-orange-500 to-orange-400 border-none text-black font-semibold transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-orange-500/30"
            >
              Optimize Schedule
            </button>
            <div className="mt-2 text-[0.6rem] text-zinc-500">
              {optimizeStats}
            </div>
          </div>

          {/* Crew Capacity */}
          <div className="p-3 border-b border-zinc-800">
            <div className="text-[0.75rem] font-semibold mb-2 flex items-center gap-1.5">
              Crew Capacity
            </div>
            {(() => {
              // Get crews based on multi-select or single-select
              const crewsToShow = selectedLocations.length > 0
                ? selectedLocations.flatMap(loc => CREWS[loc] || [])
                : selectedLocation !== "All" && CREWS[selectedLocation]
                  ? CREWS[selectedLocation]
                  : [];

              if (crewsToShow.length === 0) {
                return (
                  <div className="text-[0.65rem] text-zinc-500">
                    Select location to view crews
                  </div>
                );
              }

              return crewsToShow.map((c) => {
                const crewEvents = scheduledEvents.filter(
                  (e) => e.crew === c.name
                );
                const totalDays = crewEvents.reduce(
                  (sum, e) => sum + (e.days || 1),
                  0
                );
                const utilization = Math.min(
                  100,
                  Math.round((totalDays / 10) * 100)
                );
                return (
                  <div
                    key={c.name}
                    className="bg-[#0a0a0f] border border-zinc-800 rounded-md p-2 mb-1.5"
                  >
                    <div
                      className="text-[0.7rem] font-semibold mb-1"
                      style={{ color: c.color }}
                    >
                      {c.name}
                    </div>
                    <div className="flex gap-2 mb-1.5">
                      {c.roofers > 0 && (
                        <span className="text-[0.6rem] flex items-center gap-1">
                          Inst: {c.roofers}
                        </span>
                      )}
                      {c.electricians > 0 && (
                        <span className="text-[0.6rem] flex items-center gap-1">
                          Elec: {c.electricians}
                        </span>
                      )}
                    </div>
                    <div className="text-[0.6rem] text-zinc-500">
                      <div className="flex items-center gap-2">
                        <div className="h-1 bg-zinc-800 rounded-full flex-1 overflow-hidden w-[100px]">
                          <div
                            className={`h-full transition-all ${
                              utilization > 90
                                ? "bg-red-500"
                                : utilization > 70
                                  ? "bg-yellow-500"
                                  : "bg-emerald-500"
                            }`}
                            style={{ width: `${utilization}%` }}
                          />
                        </div>
                        <span>
                          {utilization}% ({crewEvents.length} jobs)
                        </span>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Conflicts */}
          <div className="p-3 border-b border-zinc-800">
            <div className="text-[0.75rem] font-semibold mb-2 flex items-center gap-1.5">
              Conflicts ({conflicts.length})
            </div>
            {conflicts.length === 0 ? (
              <div className="text-[0.65rem] text-zinc-500">
                No scheduling conflicts
              </div>
            ) : (
              conflicts.map((c, i) => (
                <div
                  key={i}
                  className="bg-red-500/10 border border-red-500 rounded-md p-2 mb-1.5 text-[0.65rem]"
                >
                  <div className="font-semibold text-red-400 mb-1">
                    {c.crew} - {formatShortDate(c.date)}
                  </div>
                  <div className="text-zinc-500">{c.projects.join(", ")}</div>
                </div>
              ))
            )}
          </div>

          {/* Export */}
          <div className="p-3 border-b border-zinc-800">
            <div className="text-[0.75rem] font-semibold mb-2 flex items-center gap-1.5">
              Export
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={exportCSV}
                className="p-2 text-[0.7rem] rounded-md bg-[#0a0a0f] border border-zinc-800 text-zinc-300 text-left hover:border-orange-500 transition-colors"
              >
                Download CSV
              </button>
              <button
                onClick={exportICal}
                className="p-2 text-[0.7rem] rounded-md bg-[#0a0a0f] border border-zinc-800 text-zinc-300 text-left hover:border-orange-500 transition-colors"
              >
                Export iCal
              </button>
              <button
                onClick={copySchedule}
                className="p-2 text-[0.7rem] rounded-md bg-[#0a0a0f] border border-zinc-800 text-zinc-300 text-left hover:border-orange-500 transition-colors"
              >
                Copy to Clipboard
              </button>
            </div>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="p-3">
            <div className="text-[0.75rem] font-semibold mb-2 flex items-center gap-1.5">
              Keyboard Shortcuts
            </div>
            <div className="text-[0.6rem] text-zinc-500 leading-relaxed space-y-1">
              <div>
                <kbd className="bg-[#0a0a0f] px-1 py-0.5 rounded font-mono">
                  1
                </kbd>{" "}
                <kbd className="bg-[#0a0a0f] px-1 py-0.5 rounded font-mono">
                  2
                </kbd>{" "}
                <kbd className="bg-[#0a0a0f] px-1 py-0.5 rounded font-mono">
                  3
                </kbd>{" "}
                Switch views
              </div>
              <div>
                <kbd className="bg-[#0a0a0f] px-1 py-0.5 rounded font-mono">
                  Alt+Arrows
                </kbd>{" "}
                Navigate
              </div>
              <div>
                <kbd className="bg-[#0a0a0f] px-1 py-0.5 rounded font-mono">
                  Ctrl+O
                </kbd>{" "}
                Auto-optimize
              </div>
              <div>
                <kbd className="bg-[#0a0a0f] px-1 py-0.5 rounded font-mono">
                  Ctrl+E
                </kbd>{" "}
                Export CSV
              </div>
              <div>
                <kbd className="bg-[#0a0a0f] px-1 py-0.5 rounded font-mono">
                  Esc
                </kbd>{" "}
                Close / Deselect
              </div>
            </div>
          </div>
        </aside>
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
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5 max-w-[500px] w-[90%] max-h-[85vh] overflow-y-auto">
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
                  <span className="text-[0.7rem] text-zinc-500 w-20">Links</span>
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
                        <span className="text-zinc-600">|</span>
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
                    valueClass={!scheduleModal.project.ahj ? "text-zinc-500" : ""}
                  />
                  <ModalRow
                    label="Utility"
                    value={scheduleModal.project.utility || "Not set"}
                    valueClass={!scheduleModal.project.utility ? "text-zinc-500" : ""}
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
                  <label className="text-[0.7rem] text-zinc-500">Days:</label>
                  <input
                    type="number"
                    value={installDaysInput}
                    onChange={(e) =>
                      setInstallDaysInput(parseFloat(e.target.value) || 0.25)
                    }
                    min={0.25}
                    max={10}
                    step={0.25}
                    className="bg-[#0a0a0f] border border-zinc-800 text-zinc-200 px-2 py-1.5 rounded font-mono text-[0.75rem] w-[60px] text-center focus:outline-none focus:border-orange-500"
                  />
                  <label className="text-[0.7rem] text-zinc-500">Crew:</label>
                  <select
                    value={crewSelectInput}
                    onChange={(e) => setCrewSelectInput(e.target.value)}
                    className="bg-[#0a0a0f] border border-zinc-800 text-zinc-200 px-2 py-1.5 rounded font-mono text-[0.75rem] focus:outline-none focus:border-orange-500"
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
                    <label htmlFor="syncZuper" className="text-[0.7rem] text-zinc-300 cursor-pointer">
                      Sync schedule to Zuper
                    </label>
                  </div>
                  <div className="text-[0.6rem] text-zinc-500 mt-1">
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
                className="px-3.5 py-2 rounded-md bg-[#0a0a0f] border border-zinc-800 text-zinc-300 text-[0.75rem] cursor-pointer hover:bg-zinc-800 transition-colors disabled:opacity-50"
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
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5 max-w-[500px] w-[90%] max-h-[85vh] overflow-y-auto">
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
              </ModalSection>

              {/* Jurisdiction (survey/inspection) */}
              {(detailModal.stage === "survey" ||
                detailModal.stage === "inspection") && (
                <ModalSection title="Jurisdiction">
                  <ModalRow
                    label="AHJ"
                    value={detailModal.ahj || "Not set"}
                    valueClass={!detailModal.ahj ? "text-zinc-500" : ""}
                  />
                  <ModalRow
                    label="Utility"
                    value={detailModal.utility || "Not set"}
                    valueClass={!detailModal.utility ? "text-zinc-500" : ""}
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
                className="px-3.5 py-2 rounded-md bg-[#0a0a0f] border border-zinc-800 text-zinc-300 text-[0.75rem] cursor-pointer hover:bg-zinc-800 transition-colors"
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
      <div className="text-[0.65rem] text-zinc-500 uppercase mb-1 font-semibold">
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
    <div className="flex justify-between py-1 border-b border-zinc-800 last:border-b-0 text-[0.75rem]">
      <span className="text-zinc-500">{label}</span>
      <span className={valueClass || "text-zinc-200"}>{value}</span>
    </div>
  );
}
