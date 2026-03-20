"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/contexts/ToastContext";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { ConstructionProjectDetailPanel } from "@/components/scheduler/ConstructionProjectDetailPanel";
import { ConstructionMonthView } from "@/components/scheduler/construction/ConstructionMonthView";
import { ConstructionWeekView } from "@/components/scheduler/construction/ConstructionWeekView";
import { ConstructionGanttView } from "@/components/scheduler/construction/ConstructionGanttView";
import { LOCATION_TIMEZONES } from "@/lib/constants";
import { formatCurrency, formatDateShort, formatShortDate } from "@/lib/format";
import {
  DEFAULT_LOCATION_CAPACITY,
  generateOptimizedSchedule,
  type ExistingBooking,
  type OptimizableProject,
  type ScoringPreset,
} from "@/lib/schedule-optimizer";
import {
  getBusinessDatesInSpan,
  getConstructionSpanDaysFromZuper,
  getTodayStr,
  isPastDate,
  normalizeZuperBoundaryDates,
  toDateStr,
} from "@/lib/scheduling-utils";

/* ------------------------------------------------------------------ */
/*  Construction Director Assignments                                   */
/* ------------------------------------------------------------------ */

const CONSTRUCTION_DIRECTORS: Record<string, { name: string; userUid: string; teamUid: string }> = {
  Westminster: { name: "Joe Lynch", userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
  Centennial: { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  DTC: { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  "Colorado Springs": { name: "Rolando", userUid: "a89ed2f5-222b-4b09-8bb0-14dc45c2a51b", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
  "San Luis Obispo": { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  Camarillo: { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "0168d963-84af-4214-ad81-d6c43cee8e65" },
};

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
  constructionScheduleDate?: string;
  constructionStatus?: string;
  constructionCompleteDate?: string;
  closeDate?: string;
  daysForInstallers?: number;
  expectedDaysForInstall?: number;
  equipment?: {
    systemSizeKwdc?: number;
    modules?: { count?: number };
    inverter?: { count?: number };
    battery?: { count?: number; expansionCount?: number; brand?: string };
    evCount?: number;
  };
}

interface ConstructionProject {
  id: string;
  name: string;
  address: string;
  location: string;
  amount: number;
  type: string;
  systemSize: number;
  batteries: number;
  evCount: number;
  installDays: number;
  scheduleDate: string | null;
  installStatus: string;
  completionDate: string | null;
  closeDate: string | null;
  hubspotUrl: string;
  zuperJobUid?: string;
  zuperJobStatus?: string;
  zuperScheduledDays?: number;
  zuperScheduledStart?: string;
  zuperScheduledEnd?: string;
  zuperAssignedTo?: string[];
  tentativeRecordId?: string;
}

interface ZuperAssignee {
  name: string;
  userUid: string;
  teamUid: string;
}

interface PendingSchedule {
  project: ConstructionProject;
  date: string;
}

interface DayAvailability {
  date: string;
  availableSlots: Array<{
    start_time: string;
    end_time: string;
    display_time?: string;
    user_uid?: string;
    user_name?: string;
    location?: string;
  }>;
  timeOffs: Array<{
    user_name?: string;
    all_day?: boolean;
    start_time?: string;
    end_time?: string;
  }>;
  scheduledJobs: Array<{
    job_title: string;
    start_time?: string;
    end_time?: string;
  }>;
  hasAvailability: boolean;
  isFullyBooked: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PROJECTS_QUERY_KEY = ["scheduler", "construction-projects"] as const;
const DEFAULT_CONSTRUCTION_ASSIGNEES: Record<string, ZuperAssignee[]> = Object.fromEntries(
  Object.entries(CONSTRUCTION_DIRECTORS).map(([location, director]) => [location, [{ ...director }]])
) as Record<string, ZuperAssignee[]>;
const OPTIMIZER_CREWS: Record<string, Array<{ name: string; roofers: number; electricians: number; color: string }>> = {
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
    { name: "SLO Electrical", roofers: 0, electricians: 2, color: "#a855f7" },
  ],
  Camarillo: [
    { name: "CAM Crew", roofers: 2, electricians: 1, color: "#f43f5e" },
  ],
};
const PRESET_DESCRIPTIONS: Record<ScoringPreset, { label: string; desc: string }> = {
  balanced: {
    label: "Balanced",
    desc: "Mixes revenue, urgency, and fairness for an even schedule.",
  },
  "revenue-first": {
    label: "Revenue First",
    desc: "Prioritizes the highest-value installs first.",
  },
  "pe-priority": {
    label: "PE Priority",
    desc: "Boosts PE projects while keeping urgency in play.",
  },
  "urgency-first": {
    label: "Urgency First",
    desc: "Pushes deadline-sensitive installs to the front.",
  },
};

// Status values discovered dynamically from actual project data

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                    */
/* ------------------------------------------------------------------ */

function getCustomerName(fullName: string): string {
  return fullName.split(" | ")[1] || fullName;
}

function getProjectId(fullName: string): string {
  return fullName.split(" | ")[0];
}

function normalizeLocation(location?: string | null): string {
  const value = (location || "").trim();
  if (!value) return "Unknown";
  if (value === "DTC") return "Centennial";
  return value;
}

function dedupeAssignees(assignees: ZuperAssignee[]): ZuperAssignee[] {
  const seen = new Set<string>();
  return assignees.filter((assignee) => {
    const key = assignee.userUid.trim();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getNextWorkdayFromToday(): string {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return toDateStr(d);
}

function addCalendarDaysYmd(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function getWeekStartDateYmd(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const mondayBasedDow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayBasedDow);
  return toDateStr(d);
}

function getDaysUntilDate(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T12:00:00`);
  if (!Number.isFinite(target.getTime())) return null;
  const today = new Date(`${getTodayStr()}T12:00:00`);
  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function isPELikeProject(project: ConstructionProject): boolean {
  const haystack = `${project.type} ${project.name}`.toLowerCase();
  return haystack.includes("participate energy") || /\bpe\b/.test(haystack);
}

// Check if an install is overdue: scheduled in the past but not completed
function isInstallOverdue(project: ConstructionProject, manualScheduleDate?: string): boolean {
  const schedDate = manualScheduleDate || getEffectiveInstallStartDate(project);
  if (!schedDate) return false;
  if (project.completionDate) return false;
  if (project.installStatus.toLowerCase().includes("complete")) return false;
  return isPastDate(schedDate);
}

function getEffectiveInstallDays(project: ConstructionProject): number {
  const fromZuper = getConstructionSpanDaysFromZuper({
    startIso: project.zuperScheduledStart,
    endIso: project.zuperScheduledEnd,
    scheduledDays: project.zuperScheduledDays,
    timezone: LOCATION_TIMEZONES[project.location || ""] || "America/Denver",
  });
  if (typeof fromZuper === "number") return fromZuper;
  return Math.max(1, Math.ceil(project.installDays || 2));
}

function getEffectiveInstallStartDate(project: ConstructionProject): string | null {
  if (project.zuperScheduledStart) {
    const boundaries = normalizeZuperBoundaryDates({
      startIso: project.zuperScheduledStart,
      endIso: project.zuperScheduledEnd,
      timezone: LOCATION_TIMEZONES[project.location || ""] || "America/Denver",
    });
    if (boundaries.startDate) return boundaries.startDate;
    const isoDate = project.zuperScheduledStart.split("T")[0];
    if (isoDate) return isoDate;
  }
  return project.scheduleDate || null;
}

/* ------------------------------------------------------------------ */
/*  Transform API data                                                 */
/* ------------------------------------------------------------------ */

function transformProject(p: RawProject): ConstructionProject | null {
  // Include projects in Construction or Ready To Build stages
  if (p.stage !== "Construction" && p.stage !== "Ready To Build") return null;

  return {
    id: String(p.id),
    name: p.name || `Project ${p.id}`,
    address: [p.address, p.city, p.state].filter(Boolean).join(", ") || "Address TBD",
    location: p.pbLocation || "Unknown",
    amount: p.amount || 0,
    type: p.projectType || "Solar",
    systemSize: p.equipment?.systemSizeKwdc || 0,
    batteries: p.equipment?.battery?.count || 0,
    evCount: p.equipment?.evCount || 0,
    installDays: p.daysForInstallers || p.expectedDaysForInstall || 2,
    scheduleDate: p.constructionScheduleDate || null,
    installStatus: p.constructionStatus || (p.stage === "Ready To Build" ? "Ready to Build" : "Ready to Schedule"),
    completionDate: p.constructionCompleteDate || null,
    closeDate: p.closeDate || null,
    hubspotUrl: p.url || `https://app.hubspot.com/contacts/21710069/record/0-3/${p.id}`,
  };
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function ConstructionSchedulerPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView, trackFeature } = useActivityTracking();
  const hasTrackedView = useRef(false);

  /* ---- core data ---- */
  const [projects, setProjects] = useState<ConstructionProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  /* ---- view / nav ---- */
  const [currentView, setCurrentView] = useState<"calendar" | "week" | "gantt" | "list">("calendar");
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [weekStartDate, setWeekStartDate] = useState(() => getWeekStartDateYmd(getTodayStr()));
  const [ganttStartDate, setGanttStartDate] = useState(() => getWeekStartDateYmd(getTodayStr()));

  /* ---- filters ---- */
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState("amount");
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizePreset, setOptimizePreset] = useState<ScoringPreset>("balanced");
  const [optimizeLocations, setOptimizeLocations] = useState<string[]>([]);
  const [optimizeStartDate, setOptimizeStartDate] = useState<string>("");
  const [optimizeResult, setOptimizeResult] = useState<ReturnType<typeof generateOptimizedSchedule> | null>(null);
  const [optimizeApplying, setOptimizeApplying] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState({ current: 0, total: 0, failed: 0 });
  const [optimizeProjectIds, setOptimizeProjectIds] = useState<Record<string, true>>({});

  /* ---- selection / scheduling ---- */
  const [selectedProject, setSelectedProject] = useState<ConstructionProject | null>(null);
  const [manualSchedules, setManualSchedules] = useState<Record<string, string>>({});
  const [tentativeRecordIds, setTentativeRecordIds] = useState<Record<string, string>>({});
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [confirmingTentative, setConfirmingTentative] = useState(false);
  const [cancellingTentative, setCancellingTentative] = useState(false);
  const getTentativeRecordId = useCallback(
    (projectId: string) =>
      tentativeRecordIds[projectId] ||
      projects.find((p) => p.id === projectId)?.tentativeRecordId,
    [tentativeRecordIds, projects]
  );

  /* ---- modals ---- */
  const [scheduleModal, setScheduleModal] = useState<PendingSchedule | null>(null);
  const [selectedAssigneeNames, setSelectedAssigneeNames] = useState<string[]>([]);

  /* ---- Zuper integration ---- */
  const [zuperConfigured, setZuperConfigured] = useState(false);
  const [zuperWebBaseUrl, setZuperWebBaseUrl] = useState("https://web.zuperpro.com");
  const [syncToZuper, setSyncToZuper] = useState(true);
  const [syncingToZuper, setSyncingToZuper] = useState(false);
  const [liveConstructionAssigneesByLocation, setLiveConstructionAssigneesByLocation] = useState<
    Record<string, ZuperAssignee[]>
  >({});
  const [loadingConstructionAssignees, setLoadingConstructionAssignees] = useState(false);

  /* ---- Availability ---- */
  const [availabilityByDate, setAvailabilityByDate] = useState<Record<string, DayAvailability>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [showAvailability, setShowAvailability] = useState(true);

  /* ---- toast (via ToastContext) ---- */
  const { addToast } = useToast();

  /* ================================================================ */
  /*  Data fetching                                                    */
  /* ================================================================ */

  const queryClient = useQueryClient();

  const fetchProjectsData = useCallback(async (forceRefresh = false) => {
    const projectsUrl = `/api/projects?context=scheduling&fields=id,name,address,city,state,pbLocation,amount,projectType,stage,url,constructionScheduleDate,constructionStatus,constructionCompleteDate,closeDate,equipment,installCrew,projectNumber,daysForInstallers,expectedDaysForInstall${forceRefresh ? "&refresh=true" : ""}`;
    const response = await fetch(projectsUrl, forceRefresh ? { cache: "no-store" } : undefined);
    if (!response.ok) throw new Error("Failed to fetch projects");
    const data = await response.json();
    const transformed = data.projects
      .map((p: RawProject) => transformProject(p))
      .filter((p: ConstructionProject | null): p is ConstructionProject => p !== null);
    const restoredSchedules: Record<string, string> = {};
    const restoredTentatives: Record<string, string> = {};

    // Look up Zuper job UIDs for these projects
    if (transformed.length > 0) {
      try {
        const projectIds = transformed.map((p: ConstructionProject) => p.id).join(",");
        const projectNames = transformed.map((p: ConstructionProject) => encodeURIComponent(p.name)).join("|||");
        const zuperResponse = await fetch(`/api/zuper/jobs/lookup?projectIds=${projectIds}&projectNames=${projectNames}&category=construction`);
        if (zuperResponse.ok) {
          const zuperData = await zuperResponse.json();
          if (zuperData.jobs) {
            for (const project of transformed) {
              const zuperJob = zuperData.jobs[project.id];
              if (zuperJob) {
                project.zuperJobUid = zuperJob.jobUid;
                project.zuperJobStatus = zuperJob.status;
                if (zuperJob.scheduledDate) project.zuperScheduledStart = zuperJob.scheduledDate;
                if (zuperJob.scheduledEnd) project.zuperScheduledEnd = zuperJob.scheduledEnd;
                const scheduledDays = Number(zuperJob.scheduledDays);
                if (Number.isFinite(scheduledDays) && scheduledDays > 0) {
                  project.zuperScheduledDays = scheduledDays;
                }
                if (Array.isArray(zuperJob.assignedTo)) {
                  project.zuperAssignedTo = zuperJob.assignedTo;
                }
              }
            }
          }
        }
      } catch (zuperErr) {
        console.warn("Failed to lookup Zuper jobs:", zuperErr);
      }

      // Rehydrate tentative schedules so they survive refresh on this page.
      try {
        const projectIds = transformed.map((p: ConstructionProject) => p.id).join(",");
        const tentRes = await fetch(`/api/zuper/schedule-records?projectIds=${encodeURIComponent(projectIds)}&type=installation&status=tentative`);
        if (tentRes.ok) {
          const tentData = await tentRes.json();
          const records = tentData.records as Record<string, { id: string; scheduledDate: string }>;
          for (const [projectId, rec] of Object.entries(records || {})) {
            const project = transformed.find((p: ConstructionProject) => p.id === projectId);
            if (project?.zuperJobStatus && project.scheduleDate) continue;
            restoredSchedules[projectId] = rec.scheduledDate;
            restoredTentatives[projectId] = rec.id;
            if (project) {
              project.tentativeRecordId = rec.id;
              project.installStatus = "Tentative";
            }
          }
        }
      } catch (tentErr) {
        console.warn("Failed to rehydrate tentative construction schedules:", tentErr);
      }
    }

    return { transformed, restoredSchedules, restoredTentatives };
  }, []);

  const fetchProjectsQueryFn = useCallback(() => fetchProjectsData(false), [fetchProjectsData]);

  const projectsQuery = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: fetchProjectsQueryFn,
    refetchInterval: 5 * 60 * 1000,
  });

  // Sync query results to component state (projects + tentative side-effects)
  useEffect(() => {
    if (projectsQuery.data) {
      const { transformed, restoredSchedules, restoredTentatives } = projectsQuery.data;
      setProjects(transformed);
      setTentativeRecordIds(restoredTentatives);
      if (Object.keys(restoredSchedules).length > 0) {
        setManualSchedules((prev) => ({ ...restoredSchedules, ...prev }));
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

  const fetchProjects = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
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
      trackDashboardView("construction-scheduler", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  // Fetch availability when a project is selected or month changes
  const fetchAvailability = useCallback(async (location?: string) => {
    if (!zuperConfigured) return;

    setLoadingSlots(true);
    try {
      const firstDay = new Date(currentYear, currentMonth, 1);
      const lastDay = new Date(currentYear, currentMonth + 1, 0);
      const fromDate = firstDay.toISOString().split("T")[0];
      const toDate = lastDay.toISOString().split("T")[0];

      const params = new URLSearchParams({
        from_date: fromDate,
        to_date: toDate,
        type: "construction",
      });
      if (location) {
        params.append("location", location);
      }

      const response = await fetch(`/api/zuper/availability?${params.toString()}`);
      const data = await response.json();

      if (data.availabilityByDate) {
        setAvailabilityByDate(data.availabilityByDate);
      }
    } catch (err) {
      console.error("Failed to fetch availability:", err);
    } finally {
      setLoadingSlots(false);
    }
  }, [zuperConfigured, currentYear, currentMonth]);

  useEffect(() => {
    if (selectedProject && zuperConfigured) {
      fetchAvailability(selectedProject.location);
    } else if (zuperConfigured && showAvailability) {
      fetchAvailability();
    }
  }, [selectedProject, zuperConfigured, currentMonth, currentYear, fetchAvailability, showAvailability]);

  const availableConstructionAssignees = useMemo(() => {
    if (!scheduleModal) return [] as ZuperAssignee[];
    const location = scheduleModal.project.location;
    const live = liveConstructionAssigneesByLocation[location];
    if (live && live.length > 0) return live;
    return DEFAULT_CONSTRUCTION_ASSIGNEES[location] || [];
  }, [scheduleModal, liveConstructionAssigneesByLocation]);

  const defaultSelectedAssigneeNames = useMemo(() => {
    if (!scheduleModal) return [] as string[];
    const availableNames = new Set(availableConstructionAssignees.map((assignee) => assignee.name));
    if (availableNames.size === 0) return [] as string[];

    const projectAssigned = (scheduleModal.project.zuperAssignedTo || []).filter((name) => availableNames.has(name));
    if (projectAssigned.length > 0) return projectAssigned;

    const defaultDirectorName = CONSTRUCTION_DIRECTORS[scheduleModal.project.location]?.name;
    if (defaultDirectorName && availableNames.has(defaultDirectorName)) return [defaultDirectorName];

    const fallbackFirst = availableConstructionAssignees[0]?.name;
    return fallbackFirst ? [fallbackFirst] : [];
  }, [scheduleModal, availableConstructionAssignees]);

  useEffect(() => {
    if (!scheduleModal) {
      setLoadingConstructionAssignees(false);
      return;
    }
    const location = scheduleModal.project.location;
    const director = CONSTRUCTION_DIRECTORS[location];
    const teamUid = director?.teamUid;
    if (!teamUid) return;
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

        const fallback = DEFAULT_CONSTRUCTION_ASSIGNEES[location] || [];
        const next = teamUsers.length > 0 ? teamUsers : fallback;
        setLiveConstructionAssigneesByLocation((prev) => ({
          ...prev,
          [location]: dedupeAssignees(next),
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn(`[Construction Scheduler] Failed to load live assignees for ${location}:`, error);
        setLiveConstructionAssigneesByLocation((prev) => ({
          ...prev,
          [location]: DEFAULT_CONSTRUCTION_ASSIGNEES[location] || [],
        }));
      })
      .finally(() => {
        if (!cancelled) setLoadingConstructionAssignees(false);
      });

    return () => {
      cancelled = true;
      setLoadingConstructionAssignees(false);
    };
  }, [scheduleModal, liveConstructionAssigneesByLocation]);

  useEffect(() => {
    if (!scheduleModal) {
      setSelectedAssigneeNames((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const availableNames = new Set(availableConstructionAssignees.map((assignee) => assignee.name));
    if (availableNames.size === 0) {
      setSelectedAssigneeNames((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    setSelectedAssigneeNames((prev) => {
      const retained = prev.filter((name) => availableNames.has(name));
      const next = retained.length > 0 ? retained : defaultSelectedAssigneeNames;
      return arraysEqual(prev, next) ? prev : next;
    });
  }, [scheduleModal, availableConstructionAssignees, defaultSelectedAssigneeNames]);

  /* ================================================================ */
  /*  Toast                                                            */
  /* ================================================================ */

  const showToast = useCallback((message: string, type: "success" | "error" | "warning" | "info" = "success") => {
    addToast({ title: message, type });
  }, [addToast]);

  const handleManualRefresh = useCallback(async () => {
    if (manualRefreshing) return;
    setManualRefreshing(true);
    try {
      await queryClient.fetchQuery({
        queryKey: PROJECTS_QUERY_KEY,
        queryFn: () => fetchProjectsData(true),
        staleTime: 0,
      });
      showToast("Refreshed latest schedule data");
    } catch (refreshErr) {
      console.error("Failed to force refresh construction schedule:", refreshErr);
      showToast("Refresh failed", "warning");
    } finally {
      setManualRefreshing(false);
    }
  }, [manualRefreshing, queryClient, showToast, fetchProjectsData]);

  /* ================================================================ */
  /*  Derived data                                                     */
  /* ================================================================ */

  // Dynamic status options from actual project data
  const statusOptions = useMemo(
    () =>
      [...new Set(projects.map((p) => p.installStatus))]
        .filter(Boolean)
        .sort()
        .map((s) => ({ value: s, label: s })),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((p) => {
      if (selectedLocations.length > 0 && !selectedLocations.includes(p.location)) return false;
      if (filterStatuses.length > 0 && !filterStatuses.includes(p.installStatus)) return false;
      if (searchText &&
          !p.name.toLowerCase().includes(searchText.toLowerCase()) &&
          !p.address.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });

    if (sortBy === "amount") filtered.sort((a, b) => b.amount - a.amount);
    else if (sortBy === "date") {
      filtered.sort((a, b) => {
        const dateA = manualSchedules[a.id] || getEffectiveInstallStartDate(a) || "z";
        const dateB = manualSchedules[b.id] || getEffectiveInstallStartDate(b) || "z";
        return dateA.localeCompare(dateB);
      });
    } else if (sortBy === "status") {
      filtered.sort((a, b) => a.installStatus.localeCompare(b.installStatus));
    }
    return filtered;
  }, [projects, selectedLocations, filterStatuses, searchText, sortBy, manualSchedules]);

  const unscheduledProjects = useMemo(() => {
    return filteredProjects.filter(p =>
      !getEffectiveInstallStartDate(p) &&
      !manualSchedules[p.id] &&
      !p.completionDate &&
      p.installStatus !== "Completed"
    );
  }, [filteredProjects, manualSchedules]);

  const stats = useMemo(() => {
    const total = filteredProjects.length;
    const isTentative = (p: ConstructionProject) =>
      !!(tentativeRecordIds[p.id] || p.tentativeRecordId);
    const readyProjects = filteredProjects.filter(p =>
      !getEffectiveInstallStartDate(p) && !manualSchedules[p.id] && !p.completionDate
    );
    const tentativeProjects = filteredProjects.filter(p =>
      (manualSchedules[p.id] || getEffectiveInstallStartDate(p)) && !p.completionDate && isTentative(p)
    );
    const scheduledProjects = filteredProjects.filter(p =>
      (manualSchedules[p.id] || getEffectiveInstallStartDate(p)) && !p.completionDate && !isTentative(p)
    );
    const completedProjects = filteredProjects.filter(p => p.completionDate);
    const overdueProjects = filteredProjects.filter(p => isInstallOverdue(p, manualSchedules[p.id]));

    return {
      total,
      needsScheduling: readyProjects.length,
      scheduled: scheduledProjects.length,
      tentative: tentativeProjects.length,
      completed: completedProjects.length,
      overdue: overdueProjects.length,
      totalValue: filteredProjects.reduce((sum, p) => sum + p.amount, 0),
      readyValue: readyProjects.reduce((sum, p) => sum + p.amount, 0),
      scheduledValue: scheduledProjects.reduce((sum, p) => sum + p.amount, 0),
      tentativeValue: tentativeProjects.reduce((sum, p) => sum + p.amount, 0),
      completedValue: completedProjects.reduce((sum, p) => sum + p.amount, 0),
    };
  }, [filteredProjects, manualSchedules, tentativeRecordIds]);

  const buildExistingBookings = useCallback(
    (excludeProjectId?: string): ExistingBooking[] => {
      const bookings: ExistingBooking[] = [];
      for (const project of projects) {
        if (excludeProjectId && project.id === excludeProjectId) continue;
        const startDate = manualSchedules[project.id] || getEffectiveInstallStartDate(project);
        if (!startDate) continue;
        bookings.push({
          location: normalizeLocation(project.location),
          startDate,
          days: getEffectiveInstallDays(project),
        });
      }
      return bookings;
    },
    [projects, manualSchedules]
  );

  const capacityConflictDates = useMemo(() => {
    if (!scheduleModal) return [] as string[];
    const location = normalizeLocation(scheduleModal.project.location);
    const capacity = DEFAULT_LOCATION_CAPACITY[location] ?? 1;
    const dayCounts: Record<string, number> = {};
    for (const booking of buildExistingBookings(scheduleModal.project.id)) {
      if (normalizeLocation(booking.location) !== location) continue;
      const span = getBusinessDatesInSpan(booking.startDate, booking.days);
      for (const day of span) {
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      }
    }

    const proposedSpan = getBusinessDatesInSpan(scheduleModal.date, getEffectiveInstallDays(scheduleModal.project));
    return proposedSpan.filter((day) => (dayCounts[day] || 0) >= capacity);
  }, [scheduleModal, buildExistingBookings]);

  const locationHasCapacity = capacityConflictDates.length === 0;

  /* ================================================================ */
  /*  Scheduling actions                                               */
  /* ================================================================ */

  const handleDragStart = useCallback((projectId: string) => {
    setDraggedProjectId(projectId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((date: string) => {
    if (!draggedProjectId) return;
    const project = projects.find(p => p.id === draggedProjectId);
    if (project) {
      trackFeature("schedule-modal-open", "Opened install schedule modal via drag", { scheduler: "construction", projectId: project.id, projectName: project.name, date, method: "drag" });
      setScheduleModal({ project, date });
    }
    setDraggedProjectId(null);
  }, [draggedProjectId, projects, trackFeature]);

  const handleDateClick = useCallback((date: string, project?: ConstructionProject) => {
    if (project) {
      trackFeature("schedule-modal-open", "Opened install schedule modal via click", { scheduler: "construction", projectId: project.id, projectName: project.name, date, method: "click" });
      setScheduleModal({ project, date });
    } else if (selectedProject) {
      trackFeature("schedule-modal-open", "Opened install schedule modal via click", { scheduler: "construction", projectId: selectedProject.id, projectName: selectedProject.name, date, method: "click" });
      setScheduleModal({ project: selectedProject, date });
      setSelectedProject(null);
    }
  }, [selectedProject, trackFeature]);

  const confirmSchedule = useCallback(async () => {
    if (!scheduleModal) return;
    const { project, date } = scheduleModal;
    if (!locationHasCapacity) {
      showToast("Location is at capacity for one or more days in this install span", "warning");
      return;
    }

    const selectedAssignees = availableConstructionAssignees.filter((assignee) =>
      selectedAssigneeNames.includes(assignee.name)
    );
    if (selectedAssignees.length === 0) {
      showToast("Select at least one construction assignee", "warning");
      return;
    }
    const selectedAssigneeNamesCsv = selectedAssignees.map((a) => a.name).join(", ");
    const selectedAssigneeUidCsv = selectedAssignees.map((a) => a.userUid).join(",");
    const selectedTeamUid = selectedAssignees[0]?.teamUid;

    trackFeature("install-scheduled", "Installation scheduled", {
      scheduler: "construction",
      projectId: project.id,
      projectName: project.name,
      date,
      installDays: getEffectiveInstallDays(project),
      syncToZuper,
      isReschedule: !!project.zuperJobUid,
    });

    setManualSchedules((prev) => ({
      ...prev,
      [project.id]: date,
    }));
    const scheduleTimezone = LOCATION_TIMEZONES[project.location] || "America/Denver";
    const director = CONSTRUCTION_DIRECTORS[project.location];
    const assigneeSummary = selectedAssigneeNamesCsv || director?.name || "Unassigned";

    if (syncToZuper) {
      if (!zuperConfigured) {
        showToast(
          `${getCustomerName(project.name)} scheduled locally (Zuper not configured)`,
          "warning"
        );
      } else {
      setSyncingToZuper(true);
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
              type: "installation",
              date: date,
              days: getEffectiveInstallDays(project),
              crew: selectedAssigneeUidCsv || director?.userUid,
              userUid: selectedAssigneeUidCsv || director?.userUid,
              assignedUser: selectedAssigneeNamesCsv || director?.name,
              teamUid: selectedTeamUid || director?.teamUid,
              timezone: scheduleTimezone,
              notes: `Scheduled via Construction Schedule — Assignees: ${assigneeSummary}`,
            },
            rescheduleOnly: true,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.action === "no_job_found") {
            showToast(
              `${getCustomerName(project.name)} — no existing Zuper job found to reschedule`,
              "warning"
            );
          } else {
            showToast(
              `${getCustomerName(project.name)} scheduled - Zuper job updated (customer notified)`
            );
          }
        } else {
          const errData = await response.json().catch(() => ({}));
          console.error("[Construction Schedule] Zuper sync failed:", errData);
          showToast(
            `${getCustomerName(project.name)} scheduled locally (Zuper sync failed: ${errData.error || response.status})`,
            "warning"
          );
        }
      } catch (err) {
        console.error("[Construction Schedule] Zuper error:", err);
        showToast(
          `${getCustomerName(project.name)} scheduled locally (Zuper error)`,
          "warning"
        );
      } finally {
        setSyncingToZuper(false);
      }
      }
    } else {
      try {
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
              type: "installation",
              date,
              days: getEffectiveInstallDays(project),
              crew: selectedAssigneeUidCsv || director?.userUid,
              userUid: selectedAssigneeUidCsv || director?.userUid,
              teamUid: selectedTeamUid || director?.teamUid,
              assignedUser: selectedAssigneeNamesCsv || director?.name,
              timezone: scheduleTimezone,
              notes: `Tentatively scheduled via Construction Scheduler — Assignees: ${assigneeSummary}`,
            },
          }),
        });

        if (response.ok) {
          const data = await response.json().catch(() => null);
          const recordId = data?.record?.id as string | undefined;
          if (recordId) {
            setTentativeRecordIds((prev) => ({ ...prev, [project.id]: recordId }));
            setProjects((prev) => prev.map((p) =>
              p.id === project.id ? { ...p, tentativeRecordId: recordId, installStatus: "Tentative" } : p
            ));
          }
          showToast(`${getCustomerName(project.name)} tentatively scheduled for ${formatDateShort(date)}`);
        } else {
          showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "warning");
        }
      } catch {
        showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "warning");
      }
    }

    setScheduleModal(null);
  }, [scheduleModal, locationHasCapacity, availableConstructionAssignees, selectedAssigneeNames, zuperConfigured, syncToZuper, showToast, trackFeature]);

  const handleConfirmTentative = useCallback(async (projectId: string) => {
    const recordId = getTentativeRecordId(projectId);
    const hintedZuperJobUid = projects.find((p) => p.id === projectId)?.zuperJobUid;
    if (!recordId) {
      showToast("No tentative record found to confirm", "warning");
      return;
    }
    setConfirmingTentative(true);
    try {
      const res = await fetch("/api/zuper/jobs/schedule/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleRecordId: recordId,
          zuperJobUid: hintedZuperJobUid || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        showToast(data?.error || "Failed to confirm tentative schedule", "warning");
        return;
      }

      setTentativeRecordIds((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setProjects((prev) => prev.map((p) =>
        p.id === projectId ? { ...p, tentativeRecordId: undefined, installStatus: "Scheduled" } : p
      ));
      showToast(data?.zuperSynced ? "Confirmed & synced to Zuper" : `Confirmed (Zuper sync issue: ${data?.zuperError || "Unknown"})`, data?.zuperSynced ? "success" : "warning");
      setScheduleModal(null);
      setTimeout(() => fetchProjects(), 700);
    } catch {
      showToast("Failed to confirm tentative schedule", "warning");
    } finally {
      setConfirmingTentative(false);
    }
  }, [fetchProjects, getTentativeRecordId, projects, showToast]);

  const handleCancelTentative = useCallback(async (projectId: string) => {
    const recordId = getTentativeRecordId(projectId);
    if (!recordId) {
      setManualSchedules((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      showToast("Tentative schedule removed");
      setScheduleModal(null);
      return;
    }
    setCancellingTentative(true);
    try {
      const res = await fetch("/api/zuper/schedule-records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(data?.error || "Failed to cancel tentative schedule", "warning");
        return;
      }

      setTentativeRecordIds((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setManualSchedules((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      setProjects((prev) => prev.map((p) =>
        p.id === projectId ? { ...p, scheduleDate: null, tentativeRecordId: undefined, installStatus: "Ready to Schedule" } : p
      ));
      showToast("Tentative schedule cancelled");
      setScheduleModal(null);
    } catch {
      showToast("Failed to cancel tentative schedule", "warning");
    } finally {
      setCancellingTentative(false);
    }
  }, [getTentativeRecordId, showToast]);

  const cancelSchedule = useCallback(async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (getTentativeRecordId(projectId)) {
      await handleCancelTentative(projectId);
      return;
    }

    trackFeature("install-cancelled", "Installation schedule removed", {
      scheduler: "construction",
      projectId,
      projectName: project?.name || projectId,
    });
    setManualSchedules((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, scheduleDate: null }
          : p
      )
    );

    try {
      const response = await fetch("/api/zuper/jobs/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName: project?.name || projectId,
          zuperJobUid: project?.zuperJobUid || null,
          scheduleType: "installation",
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        showToast(errorData?.message || errorData?.error || "Failed to remove from schedule", "warning");
        fetchProjects();
        return;
      }
    } catch {
      showToast("Failed to sync remove from schedule", "warning");
      fetchProjects();
      return;
    }

    showToast("Removed from schedule");
    setTimeout(() => fetchProjects(), 1000);
  }, [fetchProjects, getTentativeRecordId, handleCancelTentative, projects, showToast, trackFeature]);

  const selectedProjectManualDate = selectedProject ? manualSchedules[selectedProject.id] : undefined;

  const selectedProjectDetail = useMemo(() => {
    if (!selectedProject) return null;
    const manualDate = selectedProjectManualDate || null;
    const scheduledDate = manualDate || getEffectiveInstallStartDate(selectedProject);
    const scheduleSourceLabel = manualDate
      ? "Manual override"
      : selectedProject.zuperScheduledStart
        ? "Zuper"
        : selectedProject.scheduleDate
          ? "HubSpot"
          : "Not scheduled";
    const normalizedZuperDates = normalizeZuperBoundaryDates({
      startIso: selectedProject.zuperScheduledStart,
      endIso: selectedProject.zuperScheduledEnd,
      timezone: LOCATION_TIMEZONES[selectedProject.location || ""] || "America/Denver",
    });
    const isTentative = Boolean(
      getTentativeRecordId(selectedProject.id) ||
      selectedProject.installStatus.toLowerCase().includes("tentative")
    );

    return {
      scheduledDate,
      scheduleSourceLabel,
      isTentative,
      isOverdue: isInstallOverdue(selectedProject, manualDate || undefined),
      scheduleDurationDays: getEffectiveInstallDays(selectedProject),
      zuperRangeStart: normalizedZuperDates.startDate,
      zuperRangeEnd: normalizedZuperDates.endDate,
    };
  }, [selectedProject, selectedProjectManualDate, getTentativeRecordId]);

  const openSelectedProjectScheduleModal = useCallback(() => {
    if (!selectedProject) return;
    const date =
      manualSchedules[selectedProject.id] ||
      getEffectiveInstallStartDate(selectedProject) ||
      getNextWorkdayFromToday();
    trackFeature("schedule-modal-open", "Opened install schedule modal via detail panel", {
      scheduler: "construction",
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      date,
      method: "detail-panel",
    });
    setScheduleModal({ project: selectedProject, date });
  }, [selectedProject, manualSchedules, trackFeature]);

  const handleUnscheduleSelectedProject = useCallback(() => {
    if (!selectedProject) return;
    cancelSchedule(selectedProject.id);
  }, [selectedProject, cancelSchedule]);

  const handleConfirmSelectedTentative = useCallback(() => {
    if (!selectedProject) return;
    handleConfirmTentative(selectedProject.id);
  }, [selectedProject, handleConfirmTentative]);

  const handleCancelSelectedTentative = useCallback(() => {
    if (!selectedProject) return;
    handleCancelTentative(selectedProject.id);
  }, [selectedProject, handleCancelTentative]);

  /* ================================================================ */
  /*  Optimizer                                                        */
  /* ================================================================ */

  const handleOptimizeGenerate = useCallback(() => {
    const selectedLocationSet = new Set(optimizeLocations.map((loc) => normalizeLocation(loc)));

    const directorsByLocation: Record<string, { name: string; userUid: string; teamUid: string }> = {};
    for (const [location, director] of Object.entries(CONSTRUCTION_DIRECTORS)) {
      const normalized = normalizeLocation(location);
      if (!directorsByLocation[normalized]) {
        directorsByLocation[normalized] = director;
      }
    }

    const eligibleProjects = projects.filter((project) => {
      const location = normalizeLocation(project.location);
      if (project.completionDate) return false;
      if (manualSchedules[project.id]) return false;
      if (getEffectiveInstallStartDate(project)) return false;
      if (selectedLocationSet.size > 0 && !selectedLocationSet.has(location)) return false;
      return true;
    });

    const optimizableProjects: OptimizableProject[] = eligibleProjects.map((project) => ({
      id: project.id,
      name: project.name,
      address: project.address,
      location: normalizeLocation(project.location),
      amount: project.amount,
      stage: "rtb",
      isPE: isPELikeProject(project),
      daysInstall: getEffectiveInstallDays(project),
      daysToInstall: getDaysUntilDate(project.closeDate),
    }));

    const result = generateOptimizedSchedule(
      optimizableProjects,
      OPTIMIZER_CREWS,
      directorsByLocation,
      LOCATION_TIMEZONES,
      {
        preset: optimizePreset,
        existingBookings: buildExistingBookings(),
        ...(optimizeStartDate ? { startDate: optimizeStartDate } : {}),
      }
    );

    setOptimizeResult(result);
    if (result.entries.length === 0) {
      showToast("No eligible unscheduled installs for optimizer", "warning");
    }
    if (result.skipped.length > 0) {
      showToast(`${result.skipped.length} projects skipped (missing crew/director mapping)`, "warning");
    }
  }, [projects, manualSchedules, optimizeLocations, optimizePreset, optimizeStartDate, buildExistingBookings, showToast]);

  const handleOptimizeApply = useCallback(async () => {
    if (!optimizeResult?.entries.length) return;
    setOptimizeApplying(true);
    setOptimizeProgress({ current: 0, total: optimizeResult.entries.length, failed: 0 });

    let failed = 0;
    let success = 0;
    for (let i = 0; i < optimizeResult.entries.length; i++) {
      const entry = optimizeResult.entries[i];
      setOptimizeProgress({ current: i + 1, total: optimizeResult.entries.length, failed });

      try {
        const response = await fetch("/api/zuper/jobs/schedule/tentative", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: {
              id: entry.project.id,
              name: entry.project.name,
              address: entry.project.address,
              city: "",
              state: "",
            },
            schedule: {
              type: "installation",
              date: entry.startDate,
              days: entry.days,
              crew: entry.assigneeUserUid,
              userUid: entry.assigneeUserUid,
              teamUid: entry.assigneeTeamUid,
              assignedUser: entry.assigneeName || entry.crew,
              timezone: entry.timezone,
              notes: `[AUTO_OPTIMIZED] (${optimizePreset}) - ${entry.crew}`,
            },
          }),
        });

        if (!response.ok) {
          failed += 1;
          continue;
        }

        const data = await response.json().catch(() => null);
        const recordId = data?.record?.id as string | undefined;

        setManualSchedules((prev) => ({ ...prev, [entry.project.id]: entry.startDate }));
        if (recordId) {
          setTentativeRecordIds((prev) => ({ ...prev, [entry.project.id]: recordId }));
        }
        setProjects((prev) =>
          prev.map((project) =>
            project.id === entry.project.id
              ? {
                  ...project,
                  tentativeRecordId: recordId || project.tentativeRecordId,
                  installStatus: "Tentative",
                }
              : project
          )
        );
        setOptimizeProjectIds((prev) => ({ ...prev, [entry.project.id]: true }));
        success += 1;
      } catch {
        failed += 1;
      }
    }

    showToast(`${success}/${optimizeResult.entries.length} optimizer entries tentatively scheduled`, failed > 0 ? "warning" : "success");
    setOptimizeApplying(false);
    setOptimizeResult(null);
    setOptimizeOpen(false);
  }, [optimizeResult, optimizePreset, showToast]);

  const handleClearOptimization = useCallback(async () => {
    if (optimizeApplying) return;
    const localOptimizerProjectIds = Object.keys(optimizeProjectIds);

    const dbOptimizerRecords: Array<{ id: string; projectId: string }> = [];
    try {
      const projectIds = projects.map((p) => p.id).join(",");
      if (projectIds) {
        const response = await fetch(
          `/api/zuper/schedule-records?projectIds=${encodeURIComponent(projectIds)}&status=tentative&type=installation`
        );
        if (response.ok) {
          const data = await response.json();
          const records = Object.values(
            (data.records || {}) as Record<string, { id: string; projectId: string; notes?: string }>
          );
          for (const record of records) {
            if (record?.id && record?.projectId && (record.notes || "").includes("[AUTO_OPTIMIZED]")) {
              dbOptimizerRecords.push({ id: record.id, projectId: record.projectId });
            }
          }
        }
      }
    } catch {
      // Continue and clear local optimizer state even if DB lookup fails.
    }

    if (localOptimizerProjectIds.length === 0 && dbOptimizerRecords.length === 0) {
      showToast("No optimizer tentative entries to clear", "warning");
      return;
    }

    const cancelledProjectIds = new Set<string>();
    for (const record of dbOptimizerRecords) {
      try {
        const response = await fetch("/api/zuper/schedule-records", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: record.id }),
        });
        if (response.ok) {
          cancelledProjectIds.add(record.projectId);
        }
      } catch {
        // Continue to clear what we can.
      }
    }

    const allClearedProjectIds = new Set<string>([...localOptimizerProjectIds, ...Array.from(cancelledProjectIds)]);
    setManualSchedules((prev) => {
      const next = { ...prev };
      for (const projectId of allClearedProjectIds) {
        delete next[projectId];
      }
      return next;
    });
    setTentativeRecordIds((prev) => {
      const next = { ...prev };
      for (const projectId of allClearedProjectIds) {
        delete next[projectId];
      }
      return next;
    });
    setProjects((prev) =>
      prev.map((project) => {
        if (!allClearedProjectIds.has(project.id)) return project;
        return {
          ...project,
          tentativeRecordId: undefined,
          installStatus: project.installStatus.toLowerCase().includes("tentative")
            ? "Ready to Schedule"
            : project.installStatus,
        };
      })
    );
    setOptimizeProjectIds((prev) => {
      const next = { ...prev };
      for (const projectId of allClearedProjectIds) {
        delete next[projectId];
      }
      return next;
    });
    setOptimizeResult(null);
    showToast(`Cleared ${allClearedProjectIds.size} optimizer tentative entries`);
  }, [optimizeApplying, optimizeProjectIds, projects, showToast]);

  /* ================================================================ */
  /*  Navigation                                                       */
  /* ================================================================ */

  const goToPrevMonth = () => {
    if (currentView === "week") {
      setWeekStartDate((prev) => {
        const next = addCalendarDaysYmd(prev, -7);
        const d = new Date(next + "T12:00:00");
        setCurrentYear(d.getFullYear());
        setCurrentMonth(d.getMonth());
        return next;
      });
      return;
    }
    if (currentView === "gantt") {
      setGanttStartDate((prev) => {
        const next = addCalendarDaysYmd(prev, -14);
        const d = new Date(next + "T12:00:00");
        setCurrentYear(d.getFullYear());
        setCurrentMonth(d.getMonth());
        return next;
      });
      return;
    }
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentView === "week") {
      setWeekStartDate((prev) => {
        const next = addCalendarDaysYmd(prev, 7);
        const d = new Date(next + "T12:00:00");
        setCurrentYear(d.getFullYear());
        setCurrentMonth(d.getMonth());
        return next;
      });
      return;
    }
    if (currentView === "gantt") {
      setGanttStartDate((prev) => {
        const next = addCalendarDaysYmd(prev, 14);
        const d = new Date(next + "T12:00:00");
        setCurrentYear(d.getFullYear());
        setCurrentMonth(d.getMonth());
        return next;
      });
      return;
    }
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const goToToday = () => {
    const now = new Date();
    const todayYmd = toDateStr(now);
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setWeekStartDate(getWeekStartDateYmd(todayYmd));
    setGanttStartDate(getWeekStartDateYmd(todayYmd));
  };

  /* ================================================================ */
  /*  Render helpers                                                   */
  /* ================================================================ */

  const getStatusColor = (status: string): string => {
    const s = status.toLowerCase();
    if (s.includes("tentative")) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    if (s.includes("complete")) return "bg-green-500/20 text-green-400 border-green-500/30";
    if (s.includes("scheduled")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (s.includes("progress")) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    if (s.includes("ready")) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (s.includes("hold")) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    return "bg-zinc-500/20 text-muted border-muted/30";
  };

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500 mx-auto mb-4" />
          <p className="text-muted">Loading Construction Projects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-2">Error loading data</p>
          <p className="text-muted text-sm mb-4">{error}</p>
          <button onClick={fetchProjects} className="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const todayStr = getTodayStr();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-t-border">
        <div className="max-w-[1800px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-muted hover:text-foreground">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-emerald-400">Construction Schedule</h1>
              <span className="text-xs text-muted bg-surface-2 px-2 py-1 rounded">
                {stats.total} installs
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* View Toggle */}
              <div className="flex bg-surface rounded-lg p-0.5">
                <button
                  onClick={() => setCurrentView("calendar")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "calendar" ? "bg-emerald-600 text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  Month
                </button>
                <button
                  onClick={() => setCurrentView("week")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "week" ? "bg-emerald-600 text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  Week
                </button>
                <button
                  onClick={() => setCurrentView("gantt")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "gantt" ? "bg-emerald-600 text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  Gantt
                </button>
                <button
                  onClick={() => setCurrentView("list")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "list" ? "bg-emerald-600 text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  List
                </button>
              </div>

              <ThemeToggle />

              <button
                aria-label="Refresh"
                title={manualRefreshing ? "Refreshing..." : "Refresh data"}
                onClick={handleManualRefresh}
                disabled={manualRefreshing}
                className="p-2 hover:bg-surface-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <svg className={`w-4 h-4 ${manualRefreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Stats Cards Row */}
          <div className="flex items-stretch gap-3 mt-3 flex-wrap">
            <div className="px-3 py-2 bg-emerald-400/[0.08] border border-emerald-400/20 rounded-lg text-center min-w-[90px]">
              <div className="text-muted text-[11px]">Ready</div>
              <div key={String(stats.needsScheduling)} className="text-emerald-400 font-bold text-lg animate-value-flash">{stats.needsScheduling}</div>
              <div key={`rv-${stats.readyValue}`} className="text-emerald-400/80 text-xs animate-value-flash">{formatCurrency(stats.readyValue)}</div>
            </div>
            <div className="px-3 py-2 bg-blue-400/[0.08] border border-blue-400/20 rounded-lg text-center min-w-[90px]">
              <div className="text-muted text-[11px]">Scheduled</div>
              <div key={String(stats.scheduled)} className="text-blue-400 font-bold text-lg animate-value-flash">{stats.scheduled}</div>
              <div key={`sv-${stats.scheduledValue}`} className="text-blue-400/80 text-xs animate-value-flash">{formatCurrency(stats.scheduledValue)}</div>
            </div>
            <div className="px-3 py-2 bg-violet-400/[0.08] border border-violet-400/20 rounded-lg text-center min-w-[90px]">
              <div className="text-muted text-[11px]">Tentative</div>
              <div key={String(stats.tentative)} className="text-violet-400 font-bold text-lg animate-value-flash">{stats.tentative}</div>
              <div key={`tv-${stats.tentativeValue}`} className="text-violet-400/80 text-xs animate-value-flash">{formatCurrency(stats.tentativeValue)}</div>
            </div>
            <div className="px-3 py-2 bg-green-400/[0.08] border border-green-400/20 rounded-lg text-center min-w-[90px]">
              <div className="text-muted text-[11px]">Completed</div>
              <div key={String(stats.completed)} className="text-green-400 font-bold text-lg animate-value-flash">{stats.completed}</div>
              <div key={`cv-${stats.completedValue}`} className="text-green-400/80 text-xs animate-value-flash">{formatCurrency(stats.completedValue)}</div>
            </div>
            {stats.overdue > 0 && (
              <div className="px-3 py-2 bg-red-400/[0.08] border border-red-400/20 rounded-lg text-center min-w-[90px]">
                <div className="text-muted text-[11px]">⚠ Overdue</div>
                <div key={String(stats.overdue)} className="text-red-400 font-bold text-lg animate-value-flash">{stats.overdue}</div>
              </div>
            )}
            <div className="px-3 py-2 bg-orange-400/[0.08] border border-orange-400/20 rounded-lg text-center min-w-[90px] ml-auto">
              <div className="text-muted text-[11px]">Total Value</div>
              <div key={String(stats.totalValue)} className="text-orange-400 font-bold text-lg animate-value-flash">{formatCurrency(stats.totalValue)}</div>
              <div className="text-orange-400/80 text-xs">{stats.total} projects</div>
            </div>
          </div>

          {/* Filters Row */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <input
              type="text"
              placeholder="Search projects..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="px-3 py-1.5 bg-surface border border-t-border rounded-lg text-sm focus:outline-none focus:border-emerald-500 w-48"
            />

            {/* Multi-select Location Filter */}
            <div className="flex items-center gap-1">
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
                  className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                    selectedLocations.includes(loc)
                      ? "bg-emerald-600 border-emerald-500 text-white"
                      : "bg-surface border-t-border text-muted hover:border-muted"
                  }`}
                >
                  {loc.replace("Colorado Springs", "CO Spgs").replace("San Luis Obispo", "SLO")}
                </button>
              ))}
              {selectedLocations.length > 0 && (
                <button
                  onClick={() => setSelectedLocations([])}
                  className="px-2 py-1 text-xs text-muted hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>

            <MultiSelectFilter
              label="Status"
              options={statusOptions}
              selected={filterStatuses}
              onChange={setFilterStatuses}
              placeholder="All Statuses"
              accentColor="green"
            />

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-1.5 bg-surface border border-t-border rounded-lg text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="amount">Sort: Amount</option>
              <option value="date">Sort: Date</option>
              <option value="status">Sort: Status</option>
            </select>

            {/* Availability Toggle */}
            {zuperConfigured && (
              <button
                onClick={() => setShowAvailability(!showAvailability)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  showAvailability
                    ? "bg-emerald-600/20 border-emerald-500 text-emerald-400"
                    : "bg-surface border-t-border text-muted hover:border-muted"
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${showAvailability ? "bg-emerald-500" : "bg-zinc-600"}`} />
                Availability
                {loadingSlots && <div className="w-3 h-3 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto px-4 py-4">
        <div className="flex gap-4">
          {/* Left Sidebar - Unscheduled Projects */}
          <div className="w-80 flex-shrink-0">
            <div className="sticky top-[180px] bg-surface border border-t-border rounded-xl overflow-hidden">
              <div className="p-3 border-b border-t-border bg-surface/50">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-emerald-400">
                    Ready to Schedule ({unscheduledProjects.length})
                  </h2>
                  <button
                    onClick={() => setOptimizeOpen((prev) => !prev)}
                    className="px-2 py-1 text-[0.65rem] rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                  >
                    {optimizeOpen ? "Close" : "Optimize"}
                  </button>
                </div>
                <p className="text-xs text-muted mt-1">
                  Drag to calendar or click to select
                </p>
              </div>
              {optimizeOpen && (
                <div className="p-3 border-b border-t-border bg-surface/40 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {(Object.entries(PRESET_DESCRIPTIONS) as Array<[ScoringPreset, { label: string; desc: string }]>).map(
                      ([key, preset]) => (
                        <button
                          key={key}
                          onClick={() => {
                            setOptimizePreset(key);
                            setOptimizeResult(null);
                          }}
                          className={`px-2 py-0.5 text-[0.55rem] rounded-full border transition-colors ${
                            optimizePreset === key
                              ? "bg-emerald-600 border-emerald-600 text-white"
                              : "bg-background border-t-border text-muted hover:border-emerald-500"
                          }`}
                        >
                          {preset.label}
                        </button>
                      )
                    )}
                  </div>
                  <p className="text-[0.6rem] text-muted leading-tight">
                    {PRESET_DESCRIPTIONS[optimizePreset].desc}
                  </p>

                  <div className="flex flex-wrap gap-1">
                    {LOCATIONS.filter((loc) => loc !== "All").map((loc) => (
                      <button
                        key={loc}
                        onClick={() => {
                          setOptimizeLocations((prev) =>
                            prev.includes(loc) ? prev.filter((value) => value !== loc) : [...prev, loc]
                          );
                          setOptimizeResult(null);
                        }}
                        className={`px-2 py-0.5 text-[0.55rem] rounded-full border transition-colors ${
                          optimizeLocations.length === 0 || optimizeLocations.includes(loc)
                            ? "bg-emerald-600/80 border-emerald-600 text-white"
                            : "bg-background border-t-border text-muted hover:border-emerald-500"
                        }`}
                      >
                        {loc.replace("Colorado Springs", "CO Spgs").replace("San Luis Obispo", "SLO")}
                      </button>
                    ))}
                  </div>
                  {optimizeLocations.length > 0 && (
                    <button
                      onClick={() => {
                        setOptimizeLocations([]);
                        setOptimizeResult(null);
                      }}
                      className="text-[0.55rem] text-muted hover:text-foreground transition-colors"
                    >
                      Reset locations
                    </button>
                  )}

                  <div className="flex items-center gap-2">
                    <label className="text-[0.55rem] text-muted whitespace-nowrap">Start date:</label>
                    <input
                      type="date"
                      value={optimizeStartDate}
                      onChange={(e) => {
                        setOptimizeStartDate(e.target.value);
                        setOptimizeResult(null);
                      }}
                      className="flex-1 px-2 py-0.5 text-[0.6rem] rounded-md bg-background border border-t-border text-foreground"
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

                  <button
                    onClick={handleOptimizeGenerate}
                    disabled={optimizeApplying}
                    className="w-full px-2 py-1.5 text-[0.65rem] rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Generate Schedule
                  </button>

                  {optimizeResult && optimizeResult.entries.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[0.6rem] text-muted">
                        {optimizeResult.entries.length} projects · $
                        {(optimizeResult.entries.reduce((sum, entry) => sum + entry.project.amount, 0) / 1000).toFixed(0)}k revenue
                        {optimizeResult.skipped.length > 0 && (
                          <span className="text-amber-400"> · {optimizeResult.skipped.length} skipped</span>
                        )}
                      </div>
                      <div className="max-h-44 overflow-y-auto space-y-1">
                        {optimizeResult.entries.map((entry) => (
                          <div key={entry.project.id} className="flex items-center gap-1.5 text-[0.58rem] p-1 rounded bg-background">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.crewColor }} />
                            <span className="truncate flex-1 text-foreground">{getCustomerName(entry.project.name)}</span>
                            <span className="text-muted shrink-0">{entry.startDate.slice(5)}</span>
                            <span className="text-muted shrink-0">{entry.days}d</span>
                          </div>
                        ))}
                      </div>

                      {optimizeApplying ? (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[0.55rem] text-muted">
                            <span>Applying...</span>
                            <span>
                              {optimizeProgress.current}/{optimizeProgress.total}
                              {optimizeProgress.failed > 0 && <span className="text-red-400"> ({optimizeProgress.failed} failed)</span>}
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
                          className="w-full px-2 py-1.5 text-[0.65rem] rounded-md bg-amber-600 text-white hover:bg-amber-500 transition-colors"
                        >
                          Apply as Tentative
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handleClearOptimization}
                    disabled={optimizeApplying}
                    className="w-full px-2 py-1.5 text-[0.65rem] rounded-md bg-red-600/80 text-white hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Clear Optimizer Tentatives
                  </button>
                </div>
              )}
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                {unscheduledProjects.length === 0 ? (
                  <div className="p-4 text-center text-muted text-sm">
                    No projects need scheduling
                  </div>
                ) : (
                  unscheduledProjects.map((project) => (
                    <div
                      key={project.id}
                      draggable
                      onDragStart={() => handleDragStart(project.id)}
                      onClick={() => setSelectedProject(selectedProject?.id === project.id ? null : project)}
                      className={`p-3 border-b border-t-border cursor-pointer hover:bg-skeleton transition-colors ${
                        selectedProject?.id === project.id ? "bg-emerald-900/20 border-l-2 border-l-emerald-500" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {getCustomerName(project.name)}
                          </p>
                          <p className="text-xs text-muted truncate">
                            {getProjectId(project.name)}
                          </p>
                          <p className="text-xs text-muted truncate mt-0.5">
                            {project.location}
                          </p>
                        </div>
                        <span className="text-xs font-mono text-orange-400 ml-2">
                          {formatCurrency(project.amount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {isInstallOverdue(project, manualSchedules[project.id]) && (
                          <span className="text-xs px-1.5 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/30 font-medium">
                            ⚠ Overdue
                          </span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${getStatusColor(project.installStatus)}`}>
                          {project.installStatus}
                        </span>
                        {project.systemSize > 0 && (
                          <span className="text-xs text-muted">
                            {project.systemSize.toFixed(1)}kW
                          </span>
                        )}
                        {project.installDays > 0 && (
                          <span className="text-xs text-blue-400">
                            {project.installDays}d
                          </span>
                        )}
                        {project.batteries > 0 && (
                          <span className="text-xs text-purple-400">
                            {project.batteries} batt
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {selectedProject && selectedProjectDetail && (
              <ConstructionProjectDetailPanel
                project={selectedProject}
                scheduledDate={selectedProjectDetail.scheduledDate}
                scheduleDurationDays={selectedProjectDetail.scheduleDurationDays}
                scheduleSourceLabel={selectedProjectDetail.scheduleSourceLabel}
                isOverdue={selectedProjectDetail.isOverdue}
                isTentative={selectedProjectDetail.isTentative}
                confirmingTentative={confirmingTentative}
                cancellingTentative={cancellingTentative}
                zuperWebBaseUrl={zuperWebBaseUrl}
                zuperRangeStart={selectedProjectDetail.zuperRangeStart}
                zuperRangeEnd={selectedProjectDetail.zuperRangeEnd}
                onOpenSchedule={openSelectedProjectScheduleModal}
                onClearSelection={() => setSelectedProject(null)}
                onUnschedule={handleUnscheduleSelectedProject}
                onConfirmTentative={handleConfirmSelectedTentative}
                onCancelTentative={handleCancelSelectedTentative}
              />
            )}
          </div>

          {/* Main Area - Calendar or List */}
          <div className="flex-1">
            {currentView === "calendar" ? (
              <ConstructionMonthView
                currentYear={currentYear}
                currentMonth={currentMonth}
                monthNames={MONTH_NAMES}
                dayNames={DAY_NAMES}
                todayStr={todayStr}
                projects={filteredProjects}
                manualSchedules={manualSchedules}
                tentativeRecordIds={tentativeRecordIds}
                selectedProject={selectedProject}
                availabilityByDate={availabilityByDate}
                showAvailability={showAvailability}
                zuperConfigured={zuperConfigured}
                loadingSlots={loadingSlots}
                getEffectiveInstallStartDate={getEffectiveInstallStartDate}
                getEffectiveInstallDays={getEffectiveInstallDays}
                isInstallOverdue={isInstallOverdue}
                getCustomerName={getCustomerName}
                onPrev={goToPrevMonth}
                onNext={goToNextMonth}
                onToday={goToToday}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDateClick={handleDateClick}
                onEventDragStart={(projectId, e) => {
                  e.stopPropagation();
                  handleDragStart(projectId);
                }}
                onEventClick={(project, dateStr, e) => {
                  e.stopPropagation();
                  setScheduleModal({
                    project,
                    date: manualSchedules[project.id] || getEffectiveInstallStartDate(project) || dateStr,
                  });
                }}
              />
            ) : currentView === "week" ? (
              <ConstructionWeekView
                weekStartDate={weekStartDate}
                dayNames={DAY_NAMES}
                todayStr={todayStr}
                projects={filteredProjects}
                manualSchedules={manualSchedules}
                tentativeRecordIds={tentativeRecordIds}
                selectedProject={selectedProject}
                availabilityByDate={availabilityByDate}
                showAvailability={showAvailability}
                getEffectiveInstallStartDate={getEffectiveInstallStartDate}
                getEffectiveInstallDays={getEffectiveInstallDays}
                isInstallOverdue={isInstallOverdue}
                getCustomerName={getCustomerName}
                formatShortDate={formatShortDate}
                onPrev={goToPrevMonth}
                onNext={goToNextMonth}
                onToday={goToToday}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDateClick={handleDateClick}
                onEventDragStart={(projectId, e) => {
                  e.stopPropagation();
                  handleDragStart(projectId);
                }}
                onEventClick={(project, dateStr, e) => {
                  e.stopPropagation();
                  setScheduleModal({
                    project,
                    date: manualSchedules[project.id] || getEffectiveInstallStartDate(project) || dateStr,
                  });
                }}
              />
            ) : currentView === "gantt" ? (
              <ConstructionGanttView
                ganttStartDate={ganttStartDate}
                projects={filteredProjects}
                manualSchedules={manualSchedules}
                getEffectiveInstallStartDate={getEffectiveInstallStartDate}
                getEffectiveInstallDays={getEffectiveInstallDays}
                getCustomerName={getCustomerName}
                formatShortDate={formatShortDate}
                onPrev={goToPrevMonth}
                onNext={goToNextMonth}
                onToday={goToToday}
                onSelectProject={(project) => setSelectedProject(project)}
                onOpenSchedule={(project, date) => {
                  setSelectedProject(project);
                  setScheduleModal({ project, date });
                }}
              />
            ) : (
              /* List View */
              <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
                <div className="p-3 border-b border-t-border">
                  <h2 className="text-sm font-semibold">All Construction Projects ({filteredProjects.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-surface">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Project</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Location</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Install Date</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-muted uppercase">Days</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">Amount</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-muted uppercase">Links</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-muted uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-t-border">
                      {filteredProjects.map((project) => {
                        const schedDate = manualSchedules[project.id] || getEffectiveInstallStartDate(project);
                        const overdue = isInstallOverdue(project, manualSchedules[project.id]);
                        return (
                          <tr key={project.id} className={`hover:bg-surface/50 ${overdue ? "bg-red-500/5" : ""}`}>
                            <td className="px-4 py-3">
                              <a href={project.hubspotUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-emerald-400">
                                {overdue && <span className="text-red-400 mr-1">⚠</span>}
                                {getCustomerName(project.name)}
                              </a>
                              <div className="text-xs text-muted">{getProjectId(project.name)}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-muted">{project.location}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(project.installStatus)}`}>
                                  {project.installStatus}
                                </span>
                                {overdue && (
                                  <span className="text-xs px-1.5 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/30 font-medium">
                                    Overdue
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-sm ${overdue ? "text-red-400" : schedDate ? "text-emerald-400" : "text-muted"}`}>
                              {schedDate ? formatShortDate(schedDate) : "—"}
                            </td>
                            <td className="px-4 py-3 text-center text-sm text-muted">
                              {getEffectiveInstallDays(project)}d
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-sm text-orange-400">
                              {formatCurrency(project.amount)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <a
                                  href={project.hubspotUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1 hover:bg-surface-2 rounded transition-colors"
                                  title="Open in HubSpot"
                                >
                                  <svg className="w-4 h-4 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.984 2.21 2.21 0 00-4.42 0c0 .873.507 1.626 1.238 1.984V7.93a6.506 6.506 0 00-3.427 1.758l-7.27-5.66a2.56 2.56 0 00.076-.608 2.574 2.574 0 10-.988 2.03l7.128 5.548a6.543 6.543 0 00-.167 1.46c0 .5.057.986.165 1.453l-7.126 5.549a2.574 2.574 0 10.988 2.03c0-.211-.027-.416-.076-.613l7.27-5.658a6.506 6.506 0 003.427 1.758v2.844a2.198 2.198 0 00-1.238 1.985 2.21 2.21 0 004.42 0c0-.872-.505-1.627-1.237-1.985v-2.844a6.508 6.508 0 003.426-1.758 6.539 6.539 0 000-9.229 6.506 6.506 0 00-3.456-1.764zm-.154 9.076a4.016 4.016 0 01-2.854 1.182 4.016 4.016 0 01-2.854-1.182 4.05 4.05 0 01-1.182-2.863c0-1.082.42-2.1 1.182-2.864a4.016 4.016 0 012.854-1.182c1.08 0 2.095.42 2.854 1.182a4.05 4.05 0 011.182 2.864c0 1.081-.419 2.099-1.182 2.863z"/>
                                  </svg>
                                </a>
                                {project.zuperJobUid && (
                                  <a
                                    href={`${zuperWebBaseUrl}/jobs/${project.zuperJobUid}/details`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1 hover:bg-surface-2 rounded transition-colors"
                                    title="Open in Zuper"
                                  >
                                    <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                    </svg>
                                  </a>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {schedDate ? (
                                <button
                                  onClick={() => cancelSchedule(project.id)}
                                  className="text-xs text-red-400 hover:text-red-300"
                                >
                                  Remove
                                </button>
                              ) : (
                                <button
                                  onClick={() => setSelectedProject(project)}
                                  className="text-xs text-emerald-400 hover:text-emerald-300"
                                >
                                  Schedule
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Schedule Modal */}
      {scheduleModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setScheduleModal(null);
          }}
        >
          <div className="bg-surface border border-t-border rounded-xl p-5 max-w-md w-[90%]">
            <h3 className="text-lg font-semibold mb-4">Schedule Construction</h3>
            {(tentativeRecordIds[scheduleModal.project.id] || scheduleModal.project.tentativeRecordId) && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-dashed border-amber-400/50">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-amber-400 text-[0.7rem] font-bold uppercase tracking-wide">Tentative</span>
                  <span className="text-[0.65rem] text-muted">Not yet synced to Zuper</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirmTentative(scheduleModal.project.id)}
                    disabled={confirmingTentative}
                    className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-[0.72rem] font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    {confirmingTentative ? "Confirming..." : "Confirm & Sync"}
                  </button>
                  <button
                    onClick={() => handleCancelTentative(scheduleModal.project.id)}
                    disabled={cancellingTentative}
                    className="px-3 py-1.5 rounded-md bg-red-600/80 text-white text-[0.72rem] font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {cancellingTentative ? "Cancelling..." : "Cancel Tentative"}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3 mb-4">
              <div>
                <span className="text-xs text-muted">Project</span>
                <p className="text-sm font-medium">{getCustomerName(scheduleModal.project.name)}</p>
                <p className="text-xs text-muted">{getProjectId(scheduleModal.project.name)}</p>
              </div>

              <div>
                <span className="text-xs text-muted">Location</span>
                <p className="text-sm">{scheduleModal.project.location}</p>
              </div>

              <div>
                <span className="text-xs text-muted">Install Date</span>
                <p className="text-sm font-medium text-emerald-400">{formatDateShort(scheduleModal.date)}</p>
              </div>

              <div className="flex gap-6">
                <div>
                  <span className="text-xs text-muted">System Size</span>
                  <p className="text-sm">{scheduleModal.project.systemSize.toFixed(1)} kW {scheduleModal.project.batteries > 0 && `+ ${scheduleModal.project.batteries} batteries`}</p>
                </div>
                <div>
                  <span className="text-xs text-muted">Install Days</span>
                  <p className="text-sm font-medium">{getEffectiveInstallDays(scheduleModal.project)}d</p>
                </div>
              </div>

              <div>
                <span className="text-xs text-muted">Assignees</span>
                <div className="mt-1 rounded-lg border border-t-border bg-surface-2 p-2 max-h-28 overflow-y-auto space-y-1">
                  {loadingConstructionAssignees && (
                    <p className="text-[0.72rem] text-muted">Loading team members...</p>
                  )}
                  {availableConstructionAssignees.map((assignee) => {
                    const checked = selectedAssigneeNames.includes(assignee.name);
                    return (
                      <label key={assignee.userUid} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedAssigneeNames((prev) => {
                              if (!e.target.checked) return prev.filter((name) => name !== assignee.name);
                              if (prev.includes(assignee.name)) return prev;
                              return [...prev, assignee.name];
                            });
                          }}
                          className="w-3.5 h-3.5 rounded border-t-border bg-surface text-emerald-500 focus:ring-emerald-500"
                        />
                        <span className={checked ? "text-foreground" : "text-muted"}>{assignee.name}</span>
                      </label>
                    );
                  })}
                  {!loadingConstructionAssignees && availableConstructionAssignees.length === 0 && (
                    <p className="text-[0.72rem] text-amber-400">No assignees available for this location</p>
                  )}
                </div>
                <p className="text-[0.72rem] text-muted mt-1">
                  Selected: {selectedAssigneeNames.length > 0 ? selectedAssigneeNames.join(", ") : "None"}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted">Amount</span>
                <p className="text-sm font-mono text-orange-400">{formatCurrency(scheduleModal.project.amount)}</p>
              </div>

              {/* External Links */}
              <div>
                <span className="text-xs text-muted">Links</span>
                <div className="flex items-center gap-3 mt-1">
                  <a
                    href={scheduleModal.project.hubspotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.984 2.21 2.21 0 00-4.42 0c0 .873.507 1.626 1.238 1.984V7.93a6.506 6.506 0 00-3.427 1.758l-7.27-5.66a2.56 2.56 0 00.076-.608 2.574 2.574 0 10-.988 2.03l7.128 5.548a6.543 6.543 0 00-.167 1.46c0 .5.057.986.165 1.453l-7.126 5.549a2.574 2.574 0 10.988 2.03c0-.211-.027-.416-.076-.613l7.27-5.658a6.506 6.506 0 003.427 1.758v2.844a2.198 2.198 0 00-1.238 1.985 2.21 2.21 0 004.42 0c0-.872-.505-1.627-1.237-1.985v-2.844a6.508 6.508 0 003.426-1.758 6.539 6.539 0 000-9.229 6.506 6.506 0 00-3.456-1.764zm-.154 9.076a4.016 4.016 0 01-2.854 1.182 4.016 4.016 0 01-2.854-1.182 4.05 4.05 0 01-1.182-2.863c0-1.082.42-2.1 1.182-2.864a4.016 4.016 0 012.854-1.182c1.08 0 2.095.42 2.854 1.182a4.05 4.05 0 011.182 2.864c0 1.081-.419 2.099-1.182 2.863z"/>
                    </svg>
                    HubSpot
                  </a>
                  {scheduleModal.project.zuperJobUid && (
                    <a
                      href={`${zuperWebBaseUrl}/jobs/${scheduleModal.project.zuperJobUid}/details`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Zuper Job
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Zuper Sync Option */}
            {zuperConfigured && (
              <div className="mb-4 p-3 bg-surface rounded-lg border border-t-border">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncToZuper}
                    onChange={(e) => setSyncToZuper(e.target.checked)}
                    className="w-4 h-4 rounded border-t-border bg-surface-2 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-sm">Sync to Zuper FSM</span>
                </label>
                <p className={`text-xs mt-2 ${syncToZuper ? "text-emerald-400" : "text-amber-400"}`}>
                  {syncToZuper
                    ? "Mode: live sync (writes to Zuper now)."
                    : "Mode: tentative only (does not sync until confirmed)."}
                </p>
                {syncToZuper && (
                  <p className="text-xs text-yellow-500 mt-2">
                    Customer will receive SMS/Email notification
                  </p>
                )}
              </div>
            )}

            {!locationHasCapacity && (
              <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-500/10">
                <p className="text-sm text-red-300 font-medium">Capacity conflict</p>
                <p className="text-xs text-red-200/80 mt-1">
                  This schedule overlaps days that are already at location capacity.
                </p>
                {capacityConflictDates.length > 0 && (
                  <p className="text-xs text-red-200/80 mt-1">
                    Blocked days: {capacityConflictDates.slice(0, 3).map((d) => formatShortDate(d)).join(", ")}
                    {capacityConflictDates.length > 3 ? "..." : ""}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              {(getEffectiveInstallStartDate(scheduleModal.project) || manualSchedules[scheduleModal.project.id]) && !(tentativeRecordIds[scheduleModal.project.id] || scheduleModal.project.tentativeRecordId) && (
                <button
                  onClick={() => {
                    const projectId = scheduleModal.project.id;
                    setScheduleModal(null);
                    cancelSchedule(projectId);
                  }}
                  className="px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg font-medium"
                >
                  Remove from Schedule
                </button>
              )}
              <button
                onClick={() => setScheduleModal(null)}
                className="px-4 py-2 text-sm text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={confirmSchedule}
                disabled={syncingToZuper || !locationHasCapacity || selectedAssigneeNames.length === 0}
                className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium disabled:opacity-50"
              >
                {syncingToZuper ? "Syncing..." : "Confirm Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
