"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { formatTime12h, formatTimeRange12h } from "@/lib/format";
import MyAvailability from "../site-survey-scheduler/my-availability";
import { LOCATION_TIMEZONES } from "@/lib/constants";

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
  inspectionScheduleDate?: string;
  finalInspectionStatus?: string;
  inspectionPassDate?: string;
  closeDate?: string;
  equipment?: {
    systemSizeKwdc?: number;
    modules?: { count?: number };
    inverter?: { count?: number };
    battery?: { count?: number; expansionCount?: number; brand?: string };
    evCount?: number;
  };
}

interface InspectionProject {
  id: string;
  name: string;
  address: string;
  location: string;
  amount: number;
  type: string;
  systemSize: number;
  batteries: number;
  evCount: number;
  scheduleDate: string | null;
  inspectionStatus: string;
  completionDate: string | null;
  closeDate: string | null;
  hubspotUrl: string;
  zuperJobUid?: string;
  zuperJobStatus?: string;
  assignedInspector?: string;
  zuperScheduledTime?: string;
  tentativeRecordId?: string;
}

interface PendingSchedule {
  project: InspectionProject;
  date: string;
  slot?: {
    userName: string;
    userUid?: string;
    teamUid?: string;
    startTime: string;
    endTime: string;
    location: string;
    timezone?: string;
  };
  isRescheduling?: boolean;
  currentSlot?: {
    userName: string;
    startTime: string;
    endTime: string;
    displayTime: string;
  };
}

interface DayAvailability {
  date: string;
  availableSlots: Array<{
    start_time: string;
    end_time: string;
    user_uid?: string;
    team_uid?: string;
    user_name?: string;
    display_time?: string;
    location?: string;
    timezone?: string;
  }>;
  bookedSlots?: Array<{
    start_time: string;
    end_time: string;
    display_time?: string;
    user_name?: string;
    location?: string;
    projectId?: string;
    projectName?: string;
    zuperJobUid?: string;
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

// Status values discovered dynamically from actual project data

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

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getTodayStr(): string {
  return toDateStr(new Date());
}

function isPastDate(dateStr: string): boolean {
  return dateStr < getTodayStr();
}

// Extract the base project number, stripping " New Inspection" or similar suffixes
// e.g. "PROJ-1234 New Inspection | Smith, John" → "PROJ-1234"
function getBaseProjectNumber(name: string): string {
  const projPart = name.split(" | ")[0] || "";
  return projPart.replace(/\s+new\s+inspection.*$/i, "").trim();
}

// Check if an inspection is overdue: scheduled in the past but not completed/passed.
// A failed inspection is NOT overdue if a sibling "New Inspection" project for the
// same base project number has passed (meaning the re-inspection succeeded).
function isInspectionOverdue(
  project: InspectionProject,
  manualScheduleDate?: string,
  passedReinspections?: Set<string>,
): boolean {
  const schedDate = manualScheduleDate || project.scheduleDate;
  if (!schedDate) return false;
  if (project.completionDate) return false;
  if (project.inspectionStatus.toLowerCase().includes("pass")) return false;
  if (!isPastDate(schedDate)) return false;

  // If a "New Inspection" sibling for this project has passed, not overdue
  if (passedReinspections) {
    const baseNum = getBaseProjectNumber(project.name);
    if (baseNum && passedReinspections.has(baseNum)) return false;
  }

  return true;
}

/* ------------------------------------------------------------------ */
/*  Transform API data                                                 */
/* ------------------------------------------------------------------ */

function transformProject(p: RawProject): InspectionProject | null {
  // Only include projects in Inspection stage
  if (p.stage !== "Inspection") return null;

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
    scheduleDate: p.inspectionScheduleDate || null,
    inspectionStatus: p.finalInspectionStatus || "Ready For Inspection",
    completionDate: p.inspectionPassDate || null,
    closeDate: p.closeDate || null,
    hubspotUrl: p.url || `https://app.hubspot.com/contacts/21710069/record/0-3/${p.id}`,
  };
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function InspectionSchedulerPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView, trackProjectView, trackSearch, trackFilter, trackFeature } = useActivityTracking();
  const hasTrackedView = useRef(false);
  const hasTrackedFilters = useRef(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- core data ---- */
  const [projects, setProjects] = useState<InspectionProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- view / nav ---- */
  const [currentView, setCurrentView] = useState<"calendar" | "list">("calendar");
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());

  /* ---- filters ---- */
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState("amount");

  /* ---- selection / scheduling ---- */
  const [selectedProject, setSelectedProject] = useState<InspectionProject | null>(null);
  const [manualSchedules, setManualSchedules] = useState<Record<string, string>>({});
  const [tentativeRecordIds, setTentativeRecordIds] = useState<Record<string, string>>({});
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [confirmingTentative, setConfirmingTentative] = useState(false);
  const [cancellingTentative, setCancellingTentative] = useState(false);

  /* ---- modals ---- */
  const [scheduleModal, setScheduleModal] = useState<PendingSchedule | null>(null);

  /* ---- Zuper integration ---- */
  const [zuperConfigured, setZuperConfigured] = useState(false);
  const [zuperWebBaseUrl, setZuperWebBaseUrl] = useState("https://us-west-1c.zuperpro.com");
  const [syncToZuper, setSyncToZuper] = useState(true);
  const [syncingToZuper, setSyncingToZuper] = useState(false);

  /* ---- Availability ---- */
  const [availabilityByDate, setAvailabilityByDate] = useState<Record<string, DayAvailability>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [showAvailability, setShowAvailability] = useState(true);

  /* ---- user role ---- */
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isLinkedInspector, setIsLinkedInspector] = useState(false);
  const [showMyAvailability, setShowMyAvailability] = useState(false);

  /* ---- inspector assignments (stored locally) ---- */
  const [, setInspectorAssignments] = useState<Record<string, string>>({});

  // Load inspector assignments from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("inspectorAssignments");
      if (stored) {
        setInspectorAssignments(JSON.parse(stored));
      }
    } catch { /* ignore */ }
  }, []);

  const saveInspectorAssignment = useCallback((projectId: string, inspectorName: string) => {
    setInspectorAssignments((prev) => {
      const next = { ...prev, [projectId]: inspectorName };
      try {
        localStorage.setItem("inspectorAssignments", JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  /* ---- toast ---- */
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ================================================================ */
  /*  Data fetching                                                    */
  /* ================================================================ */

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/projects?context=scheduling&fields=id,name,address,city,state,pbLocation,amount,projectType,stage,url,inspectionScheduleDate,finalInspectionStatus,inspectionPassDate,closeDate,equipment,projectNumber");
      if (!response.ok) throw new Error("Failed to fetch projects");
      const data = await response.json();
      const transformed = data.projects
        .map((p: RawProject) => transformProject(p))
        .filter((p: InspectionProject | null): p is InspectionProject => p !== null);
      const restoredSchedules: Record<string, string> = {};
      const restoredTentatives: Record<string, string> = {};

      // Look up Zuper job UIDs for these projects
      if (transformed.length > 0) {
        try {
          const projectIds = transformed.map((p: InspectionProject) => p.id).join(",");
          const projectNames = transformed.map((p: InspectionProject) => encodeURIComponent(p.name)).join("|||");
          const zuperResponse = await fetch(`/api/zuper/jobs/lookup?projectIds=${projectIds}&projectNames=${projectNames}&category=inspection`);
          if (zuperResponse.ok) {
            const zuperData = await zuperResponse.json();
            if (zuperData.jobs) {
              for (const project of transformed) {
                const zuperJob = zuperData.jobs[project.id];
                if (zuperJob) {
                  project.zuperJobUid = zuperJob.jobUid;
                  project.zuperJobStatus = zuperJob.status;
                  // Use Zuper's assigned user as primary source of truth
                  if (zuperJob.assignedTo) {
                    project.assignedInspector = zuperJob.assignedTo;
                  }
                  // Use Zuper's scheduled date/time as source of truth
                  if (zuperJob.scheduledDate) {
                    try {
                      const utcDate = new Date(zuperJob.scheduledDate);
                      const loc = (project.location || "").toLowerCase();
                      const tz = (loc.includes("san luis") || loc.includes("slo") || loc.includes("camarillo"))
                        ? "America/Los_Angeles" : "America/Denver";
                      const localDate = utcDate.toLocaleDateString("en-CA", { timeZone: tz });
                      const localTimeStr = utcDate.toLocaleTimeString("en-US", {
                        timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
                      }).replace(":00 ", "").replace(" ", "").toLowerCase();
                      project.zuperScheduledTime = localTimeStr;
                      if (localDate && localDate !== project.scheduleDate) {
                        project.scheduleDate = localDate;
                      }
                    } catch { /* ignore */ }
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
          const projectIds = transformed.map((p: InspectionProject) => p.id).join(",");
          const tentRes = await fetch(`/api/zuper/schedule-records?projectIds=${encodeURIComponent(projectIds)}&type=inspection&status=tentative`);
          if (tentRes.ok) {
            const tentData = await tentRes.json();
            const records = tentData.records as Record<string, { id: string; scheduledDate: string; assignedUser?: string }>;
            for (const [projectId, rec] of Object.entries(records || {})) {
              restoredSchedules[projectId] = rec.scheduledDate;
              restoredTentatives[projectId] = rec.id;
              const project = transformed.find((p: InspectionProject) => p.id === projectId);
              if (project) {
                project.tentativeRecordId = rec.id;
                project.inspectionStatus = "Tentative";
                if (rec.assignedUser && !project.assignedInspector) {
                  project.assignedInspector = rec.assignedUser;
                }
              }
            }
          }
        } catch (tentErr) {
          console.warn("Failed to rehydrate tentative inspection schedules:", tentErr);
        }
      }

      // Merge locally-stored inspector assignments (only if not already set by Zuper)
      try {
        const stored = localStorage.getItem("inspectorAssignments");
        if (stored) {
          const assignments = JSON.parse(stored) as Record<string, string>;
          for (const project of transformed) {
            if (!project.assignedInspector && assignments[project.id]) {
              project.assignedInspector = assignments[project.id];
            }
          }
        }
      } catch { /* ignore */ }

      setProjects(transformed);
      setTentativeRecordIds(restoredTentatives);
      if (Object.keys(restoredSchedules).length > 0) {
        setManualSchedules((prev) => ({ ...restoredSchedules, ...prev }));
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

  // Fetch user role and check if linked inspector
  useEffect(() => {
    async function fetchUserInfo() {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          setUserRole(data.user?.role || null);
        }
      } catch { /* ignore */ }
      try {
        const res = await fetch("/api/zuper/my-availability");
        if (res.ok) setIsLinkedInspector(true);
      } catch { /* ignore */ }
    }
    fetchUserInfo();
  }, []);

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
        type: "inspection",
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

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("inspection-scheduler", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  useEffect(() => {
    if (loading) return;
    if (!hasTrackedFilters.current) {
      hasTrackedFilters.current = true;
      return;
    }
    trackFilter("inspection-scheduler", {
      selectedLocations,
      filterStatuses,
      sortBy,
      view: currentView,
      showAvailability,
    });
  }, [loading, selectedLocations, filterStatuses, sortBy, currentView, showAvailability, trackFilter]);

  const selectProjectWithTracking = useCallback((project: InspectionProject, source: string) => {
    const shouldDeselect = selectedProject?.id === project.id;
    if (!shouldDeselect) {
      trackProjectView(project.id, project.name, source);
    }
    setSelectedProject(shouldDeselect ? null : project);
  }, [selectedProject, trackProjectView]);

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

  // Dynamic status options from actual project data
  const statusOptions = useMemo(
    () =>
      [...new Set(projects.map((p) => p.inspectionStatus))]
        .filter(Boolean)
        .sort()
        .map((s) => ({ value: s, label: s })),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((p) => {
      if (selectedLocations.length > 0 && !selectedLocations.includes(p.location)) return false;
      if (filterStatuses.length > 0 && !filterStatuses.includes(p.inspectionStatus)) return false;
      if (searchText &&
          !p.name.toLowerCase().includes(searchText.toLowerCase()) &&
          !p.address.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });

    if (sortBy === "amount") filtered.sort((a, b) => b.amount - a.amount);
    else if (sortBy === "date") {
      filtered.sort((a, b) => {
        const dateA = a.scheduleDate || manualSchedules[a.id] || "z";
        const dateB = b.scheduleDate || manualSchedules[b.id] || "z";
        return dateA.localeCompare(dateB);
      });
    } else if (sortBy === "status") {
      filtered.sort((a, b) => a.inspectionStatus.localeCompare(b.inspectionStatus));
    }
    return filtered;
  }, [projects, selectedLocations, filterStatuses, searchText, sortBy, manualSchedules]);

  useEffect(() => {
    if (loading) return;
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    const query = searchText.trim();
    if (query.length < 2) return;

    searchDebounceRef.current = setTimeout(() => {
      trackSearch(query, filteredProjects.length, "inspection-scheduler");
    }, 500);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [loading, searchText, filteredProjects.length, trackSearch]);

  const unscheduledProjects = useMemo(() => {
    return filteredProjects.filter(p =>
      !p.scheduleDate &&
      !manualSchedules[p.id] &&
      !p.completionDate &&
      p.inspectionStatus !== "Passed"
    );
  }, [filteredProjects, manualSchedules]);

  // Build a set of base project numbers whose "New Inspection" sibling has passed.
  // If PROJ-1234 failed but "PROJ-1234 New Inspection" passed, the original is no
  // longer overdue.
  const passedReinspections = useMemo(() => {
    const passed = new Set<string>();
    for (const p of projects) {
      const nameLower = p.name.toLowerCase();
      if (!nameLower.includes("new inspection")) continue;
      const hasPassed = p.completionDate || p.inspectionStatus.toLowerCase().includes("pass");
      if (hasPassed) {
        passed.add(getBaseProjectNumber(p.name));
      }
    }
    return passed;
  }, [projects]);

  const stats = useMemo(() => {
    const total = projects.length;
    const needsScheduling = projects.filter(p =>
      !p.scheduleDate && !manualSchedules[p.id] && !p.completionDate
    ).length;
    const scheduled = projects.filter(p =>
      (p.scheduleDate || manualSchedules[p.id]) && !p.completionDate
    ).length;
    const passed = projects.filter(p => p.completionDate || p.inspectionStatus === "Passed").length;
    const overdue = projects.filter(p => isInspectionOverdue(p, manualSchedules[p.id], passedReinspections)).length;
    const totalValue = projects.reduce((sum, p) => sum + p.amount, 0);

    return { total, needsScheduling, scheduled, passed, overdue, totalValue };
  }, [projects, manualSchedules, passedReinspections]);

  /* ================================================================ */
  /*  Calendar data                                                    */
  /* ================================================================ */

  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const days: string[] = [];

    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;

    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth, -i);
      days.push(toDateStr(d));
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(`${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`);
    }

    while (days.length % 7 !== 0) {
      const lastDate = new Date(days[days.length - 1] + "T12:00:00");
      lastDate.setDate(lastDate.getDate() + 1);
      days.push(toDateStr(lastDate));
    }

    return days;
  }, [currentYear, currentMonth]);

  const eventsForDate = useCallback((dateStr: string) => {
    return filteredProjects.filter(p => {
      const schedDate = manualSchedules[p.id] || p.scheduleDate;
      return schedDate === dateStr;
    });
  }, [filteredProjects, manualSchedules]);

  /* ================================================================ */
  /*  Scheduling actions                                               */
  /* ================================================================ */

  const handleDragStart = useCallback((projectId: string) => {
    setDraggedProjectId(projectId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const findCurrentSlotForProject = useCallback((projectId: string, date: string, projectName?: string, zuperJobUid?: string) => {
    const dayAvail = availabilityByDate[date];
    if (!dayAvail?.bookedSlots) return undefined;

    const projId = projectName?.split(" | ")[0] || "";
    const customerPart = projectName?.split(" | ")[1] || "";
    const customerLastName = customerPart.split(",")[0]?.trim().toLowerCase() || "";

    const bookedSlot = dayAvail.bookedSlots.find(slot => {
      const slotNameLower = (slot.projectName || "").toLowerCase();
      if (slot.projectId === projectId) return true;
      if (zuperJobUid && slot.zuperJobUid && slot.zuperJobUid === zuperJobUid) return true;
      if (projId && slotNameLower.includes(projId.toLowerCase())) return true;
      if (customerLastName && customerLastName.length > 2) {
        if (slotNameLower.startsWith(customerLastName + ",") ||
            slotNameLower.startsWith(customerLastName + " ")) return true;
      }
      return false;
    });

    if (bookedSlot) {
      return {
        userName: bookedSlot.user_name || "",
        startTime: bookedSlot.start_time,
        endTime: bookedSlot.end_time,
        displayTime: bookedSlot.display_time || `${bookedSlot.start_time}-${bookedSlot.end_time}`,
      };
    }
    return undefined;
  }, [availabilityByDate]);

  const handleDrop = useCallback((date: string) => {
    if (!draggedProjectId) return;
    if (isPastDate(date)) {
      showToast("Cannot schedule on past dates", "warning");
      setDraggedProjectId(null);
      return;
    }
    const project = projects.find(p => p.id === draggedProjectId);
    if (project) {
      const currentSlot = findCurrentSlotForProject(project.id, date, project.name, project.zuperJobUid);
      trackFeature("schedule-modal-open", "Opened inspection schedule modal via drag", { scheduler: "inspection", projectId: project.id, projectName: project.name, date, method: "drag" });
      setScheduleModal({ project, date, currentSlot });
    }
    setDraggedProjectId(null);
  }, [draggedProjectId, projects, showToast, findCurrentSlotForProject, trackFeature]);

  const handleDateClick = useCallback((date: string, project?: InspectionProject) => {
    if (isPastDate(date)) {
      showToast("Cannot schedule on past dates", "warning");
      return;
    }
    if (project) {
      trackProjectView(project.id, project.name, "inspection-scheduler:date-click");
      const currentSlot = findCurrentSlotForProject(project.id, date, project.name, project.zuperJobUid);
      setScheduleModal({ project, date, currentSlot });
    } else if (selectedProject) {
      const currentSlot = findCurrentSlotForProject(selectedProject.id, date, selectedProject.name, selectedProject.zuperJobUid);
      setScheduleModal({ project: selectedProject, date, currentSlot });
      setSelectedProject(null);
    }
  }, [selectedProject, showToast, findCurrentSlotForProject, trackProjectView]);

  const confirmSchedule = useCallback(async () => {
    if (!scheduleModal) return;
    const { project, date, slot } = scheduleModal;
    let scheduledZuperJobUid: string | undefined = project.zuperJobUid;

    setManualSchedules((prev) => ({
      ...prev,
      [project.id]: date,
    }));

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
              type: "inspection",
              date: date,
              days: 0.25,
              startTime: slot?.startTime,
              endTime: slot?.endTime,
              crew: slot?.userUid,
              teamUid: slot?.teamUid,
              assignedUser: slot?.userName,
              timezone: slot?.timezone || LOCATION_TIMEZONES[project.location] || "America/Denver",
              notes: slot
                ? `Inspector: ${slot.userName} at ${slot.startTime}`
                : "Scheduled via Inspection Schedule",
              isReschedule: !!scheduleModal.isRescheduling,
            },
            rescheduleOnly: true,
          }),
        });

        if (response.ok) {
          const data = await response.json();

          // No existing Zuper job found — warn user
          if (data.action === "no_job_found") {
            console.warn(`[Inspection Schedule] No Zuper job found for "${project.name}"`);
            showToast(
              `${getCustomerName(project.name)} scheduled locally — no matching Zuper job found. Create the job in Zuper first.`,
              "warning"
            );
          } else {
            scheduledZuperJobUid = data.job?.job_uid || data.existingJobId || project.zuperJobUid;
            const slotInfo = slot ? ` (${slot.userName} ${formatTime12h(slot.startTime)})` : "";
            if (data.assignmentFailed) {
              showToast(
                `${getCustomerName(project.name)} scheduled${slotInfo} - please assign ${slot?.userName || "inspector"} in Zuper`,
                "warning"
              );
            } else {
              showToast(
                `${getCustomerName(project.name)} scheduled${slotInfo} - ${data.action === "rescheduled" ? "Zuper job updated" : "Zuper job created"}`
              );
            }
          }
        } else {
          const errorData = await response.json().catch(() => null);
          const errorMsg = errorData?.error || "Zuper sync failed";
          console.error(`[Inspection Schedule] Zuper sync error for "${project.name}":`, errorMsg);
          showToast(
            `${getCustomerName(project.name)} scheduled locally (${errorMsg})`,
            "warning"
          );
        }
      } catch {
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
              type: "inspection",
              date,
              startTime: slot?.startTime,
              endTime: slot?.endTime,
              crew: slot?.userUid,
              assignedUser: slot?.userName,
              userUid: slot?.userUid,
              teamUid: slot?.teamUid,
              timezone: slot?.timezone || LOCATION_TIMEZONES[project.location] || "America/Denver",
              notes: slot
                ? `Tentative inspector: ${slot.userName} at ${slot.startTime}`
                : "Tentatively scheduled via Inspection Scheduler",
            },
          }),
        });

        const slotInfo = slot ? ` (${slot.userName} ${formatTime12h(slot.startTime)})` : "";
        if (response.ok) {
          const data = await response.json().catch(() => null);
          const recordId = data?.record?.id as string | undefined;
          if (recordId) {
            setTentativeRecordIds((prev) => ({ ...prev, [project.id]: recordId }));
            setProjects((prev) => prev.map((p) =>
              p.id === project.id
                ? { ...p, tentativeRecordId: recordId, inspectionStatus: "Tentative" }
                : p
            ));
          }
          showToast(`${getCustomerName(project.name)} tentatively scheduled${slotInfo}`);
        } else {
          showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "warning");
        }
      } catch {
        showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "warning");
      }
    }

    trackFeature(
      scheduleModal.currentSlot ? "inspection_rescheduled" : "inspection_scheduled",
      `Inspection ${scheduleModal.currentSlot ? "rescheduled" : "scheduled"} for ${project.name}`,
      {
        projectId: project.id,
        date,
        syncToZuper,
        assignedInspector: slot?.userName,
        startTime: slot?.startTime,
        endTime: slot?.endTime,
      }
    );

    // Store inspector assignment locally
    if (slot?.userName) {
      saveInspectorAssignment(project.id, slot.userName);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id ? { ...p, assignedInspector: slot.userName } : p
        )
      );
    }

    // Book the time slot in availability if a slot was selected
    if (slot) {
      try {
        await fetch("/api/zuper/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            userName: slot.userName,
            userUid: slot.userUid,
            location: slot.location,
            projectId: project.id,
            projectName: project.name,
            zuperJobUid: scheduledZuperJobUid,
          }),
        });
      } catch { /* best effort */ }

      // Optimistically update availability
      setAvailabilityByDate(prev => {
        const dayAvail = prev[date];
        if (!dayAvail) return prev;
        const updatedSlots = dayAvail.availableSlots.filter(s =>
          !(s.start_time === slot.startTime && s.user_name === slot.userName)
        );
        const existingBooked = dayAvail.bookedSlots || [];
        return {
          ...prev,
          [date]: {
            ...dayAvail,
            availableSlots: updatedSlots,
            bookedSlots: [
              ...existingBooked,
              {
                start_time: slot.startTime,
                end_time: slot.endTime,
                display_time: `${slot.startTime}-${slot.endTime}`,
                user_name: slot.userName,
                location: slot.location,
                projectId: project.id,
                projectName: project.name,
                zuperJobUid: scheduledZuperJobUid,
              },
            ],
            isFullyBooked: updatedSlots.length === 0,
            hasAvailability: updatedSlots.length > 0,
          },
        };
      });

      // Refresh availability after a delay
      setTimeout(() => fetchAvailability(), 2000);
    }

    setScheduleModal(null);
  }, [scheduleModal, zuperConfigured, syncToZuper, showToast, fetchAvailability, saveInspectorAssignment, trackFeature]);

  const handleConfirmTentative = useCallback(async (projectId: string) => {
    const recordId = tentativeRecordIds[projectId];
    if (!recordId) {
      showToast("No tentative record found to confirm", "warning");
      return;
    }
    setConfirmingTentative(true);
    try {
      const res = await fetch("/api/zuper/jobs/schedule/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleRecordId: recordId }),
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
        p.id === projectId ? { ...p, tentativeRecordId: undefined, inspectionStatus: "Scheduled" } : p
      ));
      showToast(data?.zuperSynced ? "Confirmed & synced to Zuper" : `Confirmed (Zuper sync issue: ${data?.zuperError || "Unknown"})`, data?.zuperSynced ? "success" : "warning");
      setScheduleModal(null);
      setTimeout(() => fetchProjects(), 700);
    } catch {
      showToast("Failed to confirm tentative schedule", "warning");
    } finally {
      setConfirmingTentative(false);
    }
  }, [fetchProjects, showToast, tentativeRecordIds]);

  const handleCancelTentative = useCallback(async (projectId: string) => {
    const recordId = tentativeRecordIds[projectId];
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
        p.id === projectId
          ? {
              ...p,
              scheduleDate: null,
              tentativeRecordId: undefined,
              inspectionStatus: "Ready For Inspection",
              assignedInspector: undefined,
              zuperScheduledTime: undefined,
            }
          : p
      ));
      showToast("Tentative schedule cancelled");
      setScheduleModal(null);
    } catch {
      showToast("Failed to cancel tentative schedule", "warning");
    } finally {
      setCancellingTentative(false);
    }
  }, [showToast, tentativeRecordIds]);

  const cancelSchedule = useCallback(async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (tentativeRecordIds[projectId]) {
      await handleCancelTentative(projectId);
      return;
    }

    trackFeature("inspection-cancelled", "Inspection schedule removed", {
      scheduler: "inspection",
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
          ? { ...p, scheduleDate: null, assignedInspector: undefined, zuperScheduledTime: undefined }
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
          scheduleType: "inspection",
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

    showToast("Schedule removed");
    setTimeout(() => fetchProjects(), 1000);
  }, [fetchProjects, handleCancelTentative, projects, showToast, tentativeRecordIds, trackFeature]);

  /* ================================================================ */
  /*  Navigation                                                       */
  /* ================================================================ */

  const goToPrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
  };

  /* ================================================================ */
  /*  Render helpers                                                   */
  /* ================================================================ */

  const getStatusColor = (status: string): string => {
    const s = status.toLowerCase();
    if (s.includes("passed")) return "bg-green-500/20 text-green-400 border-green-500/30";
    if (s.includes("scheduled")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (s.includes("pending") || s.includes("review")) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    if (s.includes("ready")) return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    if (s.includes("failed") || s.includes("reschedule")) return "bg-red-500/20 text-red-400 border-red-500/30";
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
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mx-auto mb-4" />
          <p className="text-muted">Loading Inspection Projects...</p>
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
          <button onClick={fetchProjects} className="px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const todayStr = getTodayStr();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[9999] px-4 py-3 rounded-lg shadow-lg ${
          toast.type === "warning" ? "bg-yellow-600" : "bg-green-600"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-t-border">
        <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-2 sm:py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <Link href="/" className="text-muted hover:text-foreground shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-base sm:text-xl font-bold text-purple-400 truncate">Inspection Schedule</h1>
              <span className="text-xs text-muted bg-surface-2 px-2 py-1 rounded hidden sm:inline-block">
                {stats.total} inspections
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {/* View Toggle */}
              <div className="flex bg-surface rounded-lg p-0.5">
                <button
                  onClick={() => setCurrentView("calendar")}
                  className={`px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "calendar" ? "bg-purple-600 text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  Calendar
                </button>
                <button
                  onClick={() => setCurrentView("list")}
                  className={`px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "list" ? "bg-purple-600 text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  List
                </button>
              </div>

              {/* Manage Availability (admin link) */}
              {(userRole === "ADMIN" || userRole === "OPERATIONS_MANAGER" || userRole === "OPERATIONS") && (
                <Link
                  href="/admin/crew-availability"
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-2 hover:bg-surface-2 rounded-lg text-muted hover:text-foreground transition-colors"
                  title="Manage Crew Availability"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Manage
                </Link>
              )}

              {/* My Availability (for linked inspectors) */}
              {isLinkedInspector && (
                <button
                  onClick={() => setShowMyAvailability(true)}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600/20 hover:bg-purple-600/30 rounded-lg text-purple-400 border border-purple-500/30 transition-colors"
                >
                  My Availability
                </button>
              )}

              <ThemeToggle />

              <button onClick={fetchProjects} className="p-2 hover:bg-surface-2 rounded-lg">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex items-center gap-3 sm:gap-6 mt-2 sm:mt-3 text-xs sm:text-sm overflow-x-auto">
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <span className="text-muted">Ready:</span>
              <span className="text-purple-400 font-semibold">{stats.needsScheduling}</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <span className="text-muted">Scheduled:</span>
              <span className="text-blue-400 font-semibold">{stats.scheduled}</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <span className="text-muted">Passed:</span>
              <span className="text-green-400 font-semibold">{stats.passed}</span>
            </div>
            {stats.overdue > 0 && (
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                <span className="text-red-400">⚠ Overdue:</span>
                <span className="text-red-400 font-semibold">{stats.overdue}</span>
              </div>
            )}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <span className="text-muted">Value:</span>
              <span className="text-orange-400 font-semibold">{formatCurrency(stats.totalValue)}</span>
            </div>
          </div>

          {/* Filters Row */}
          <div className="flex items-center gap-2 sm:gap-3 mt-2 sm:mt-3 flex-wrap">
            <input
              type="text"
              placeholder="Search..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="px-3 py-1.5 bg-surface border border-t-border rounded-lg text-sm focus:outline-none focus:border-purple-500 w-32 sm:w-48"
            />

            {/* Multi-select Location Filter */}
            <div className="flex items-center gap-1 overflow-x-auto max-w-full">
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
                  className={`px-2 py-1 text-xs rounded-md border transition-colors shrink-0 ${
                    selectedLocations.includes(loc)
                      ? "bg-purple-600 border-purple-500 text-white"
                      : "bg-surface border-t-border text-muted hover:border-muted"
                  }`}
                >
                  {loc.replace("Colorado Springs", "CO Spgs").replace("San Luis Obispo", "SLO")}
                </button>
              ))}
              {selectedLocations.length > 0 && (
                <button
                  onClick={() => setSelectedLocations([])}
                  className="px-2 py-1 text-xs text-muted hover:text-foreground shrink-0"
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
              accentColor="purple"
            />

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-1.5 bg-surface border border-t-border rounded-lg text-sm focus:outline-none focus:border-purple-500"
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
                    ? "bg-purple-600/20 border-purple-500 text-purple-400"
                    : "bg-surface border-t-border text-muted hover:border-muted"
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${showAvailability ? "bg-purple-500" : "bg-zinc-600"}`} />
                Availability
                {loadingSlots && <div className="w-3 h-3 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-3 sm:py-4">
        <div className="flex flex-col lg:flex-row gap-3 sm:gap-4">
          {/* Left Sidebar - Unscheduled Projects */}
          <div className="w-full lg:w-80 lg:flex-shrink-0">
            <div className="lg:sticky lg:top-[180px] bg-surface border border-t-border rounded-xl overflow-hidden">
              <div className="p-3 border-b border-t-border bg-surface/50">
                <h2 className="text-sm font-semibold text-purple-400">
                  Ready to Schedule ({unscheduledProjects.length})
                </h2>
                <p className="text-xs text-muted mt-1 hidden sm:block">
                  Drag to calendar or click to select
                </p>
              </div>
              <div className="max-h-[40vh] lg:max-h-[calc(100vh-280px)] overflow-y-auto">
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
                      onClick={() => selectProjectWithTracking(project, "inspection-scheduler:unscheduled-list")}
                      className={`p-3 border-b border-t-border cursor-pointer hover:bg-skeleton transition-colors ${
                        selectedProject?.id === project.id ? "bg-purple-900/20 border-l-2 border-l-purple-500" : ""
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
                        {isInspectionOverdue(project, manualSchedules[project.id], passedReinspections) && (
                          <span className="text-xs px-1.5 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/30 font-medium">
                            ⚠ Overdue
                          </span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${getStatusColor(project.inspectionStatus)}`}>
                          {project.inspectionStatus}
                        </span>
                        {project.systemSize > 0 && (
                          <span className="text-xs text-muted">
                            {project.systemSize.toFixed(1)}kW
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Main Area - Calendar or List */}
          <div className="flex-1">
            {currentView === "calendar" ? (
              <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
                {/* Calendar Header */}
                <div className="p-2 sm:p-3 border-b border-t-border flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <button onClick={goToPrevMonth} className="p-1.5 hover:bg-surface-2 rounded">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="text-sm sm:text-lg font-semibold min-w-[140px] sm:min-w-[180px] text-center">
                      {MONTH_NAMES[currentMonth]} {currentYear}
                    </span>
                    <button onClick={goToNextMonth} className="p-1.5 hover:bg-surface-2 rounded">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  <button onClick={goToToday} className="px-3 py-1 text-xs bg-surface-2 hover:bg-surface-2 rounded">
                    Today
                  </button>
                  {/* Availability Legend */}
                  {showAvailability && zuperConfigured && (
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-purple-500 rounded-full" />
                        <span>Available</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-yellow-500/60 rounded-full" />
                        <span>Limited</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-red-500/60 rounded-full" />
                        <span>Booked</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Day Headers */}
                <div className="grid grid-cols-7 border-b border-t-border">
                  {DAY_NAMES.map((day) => (
                    <div key={day} className="p-1 sm:p-2 text-center text-[0.65rem] sm:text-xs font-medium text-muted">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7">
                  {calendarDays.map((dateStr) => {
                    const [year, month] = dateStr.split("-").map(Number);
                    const isCurrentMonth = month - 1 === currentMonth && year === currentYear;
                    const isToday = dateStr === todayStr;
                    const isPast = isPastDate(dateStr);
                    const weekend = isWeekend(dateStr);
                    const events = eventsForDate(dateStr);
                    const dayAvailability = availabilityByDate[dateStr];
                    const hasAvailability = dayAvailability?.hasAvailability && !dayAvailability?.isFullyBooked;
                    const isFullyBooked = dayAvailability?.isFullyBooked;
                    const slotCount = dayAvailability?.availableSlots?.length || 0;

                    return (
                      <div
                        key={dateStr}
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(dateStr)}
                        onClick={() => handleDateClick(dateStr)}
                        className={`min-h-[70px] sm:min-h-[120px] max-h-[140px] sm:max-h-[220px] overflow-y-auto p-1 sm:p-1.5 border-b border-r border-t-border transition-colors ${
                          isCurrentMonth ? "" : "opacity-40"
                        } ${weekend ? "bg-surface/30" : ""} ${
                          isToday ? "bg-purple-900/20" : ""
                        } ${
                          isPast && !isToday ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                        } ${
                          !isPast && selectedProject ? "hover:bg-purple-900/10" : !isPast ? "hover:bg-skeleton" : ""
                        } ${
                          showAvailability && hasAvailability && selectedProject && !isPast
                            ? "ring-2 ring-inset ring-purple-500/30 bg-purple-900/10"
                            : ""
                        } ${
                          showAvailability && isFullyBooked && selectedProject && !weekend && !isPast
                            ? "ring-2 ring-inset ring-red-500/20 bg-red-900/5"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-medium ${
                            isToday ? "text-purple-400" : isPast ? "text-muted/70" : "text-muted"
                          }`}>
                            {parseInt(dateStr.split("-")[2])}
                          </span>
                          {/* Availability indicator badge */}
                          {showAvailability && zuperConfigured && isCurrentMonth && !weekend && !isPast && (
                            <div className="flex items-center gap-0.5">
                              {loadingSlots ? (
                                <div className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" />
                              ) : hasAvailability ? (
                                <div
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30"
                                  title={`${slotCount} inspector slot${slotCount !== 1 ? "s" : ""} available`}
                                >
                                  <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                                  <span className="text-[0.6rem] font-medium text-purple-400">{slotCount}</span>
                                </div>
                              ) : isFullyBooked ? (
                                <div className="px-1.5 py-0.5 rounded-full bg-red-500/20 border border-red-500/30" title="Fully booked">
                                  <span className="text-[0.6rem] font-medium text-red-400">Full</span>
                                </div>
                              ) : dayAvailability ? (
                                <div className="w-2 h-2 bg-yellow-500/60 rounded-full" title="Limited availability" />
                              ) : null}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          {events.map((ev) => {
                            const overdue = isInspectionOverdue(ev, manualSchedules[ev.id], passedReinspections);
                            const evSlot = findCurrentSlotForProject(ev.id, dateStr, ev.name, ev.zuperJobUid);
                            const inspectorDisplay = evSlot
                              ? `${evSlot.userName} · ${evSlot.displayTime}`
                              : ev.assignedInspector
                                ? `${ev.assignedInspector}${ev.zuperScheduledTime ? ` · ${ev.zuperScheduledTime}` : ""}`
                                : null;
                            return (
                            <div
                              key={ev.id}
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation();
                                handleDragStart(ev.id);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                trackProjectView(ev.id, ev.name, "inspection-scheduler:calendar-event");
                                setScheduleModal({ project: ev, date: dateStr, currentSlot: evSlot });
                              }}
                              className={`text-xs p-1 rounded cursor-grab active:cursor-grabbing ${
                                overdue
                                  ? "bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30"
                                  : "bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:bg-purple-500/30"
                              }`}
                              title={overdue
                                ? `⚠ OVERDUE${inspectorDisplay ? ` - ${inspectorDisplay}` : ""}`
                                : inspectorDisplay || "Click to schedule"}
                            >
                              <div className="truncate">
                                {overdue && <span className="text-red-400 mr-0.5">⚠</span>}
                                {getCustomerName(ev.name)}
                              </div>
                              {ev.address && ev.address !== "Address TBD" && (
                                <div className="text-[0.55rem] text-muted truncate hidden sm:block">
                                  {ev.address.split(",")[0]}
                                </div>
                              )}
                              {inspectorDisplay && (
                                <div className="text-[0.6rem] text-purple-400/60 truncate">
                                  {inspectorDisplay}
                                </div>
                              )}
                            </div>
                            );
                          })}
                          {/* Available slots grouped by inspector */}
                          {showAvailability && selectedProject && hasAvailability && !isPast && (() => {
                            const projectLocation = selectedProject?.location;
                            const matchingSlots = dayAvailability?.availableSlots?.filter(slot => {
                              if (!projectLocation) return true;
                              if (!slot.location) return true;
                              if (slot.location === projectLocation) return true;
                              if ((slot.location === "DTC" || slot.location === "Centennial") &&
                                  (projectLocation === "DTC" || projectLocation === "Centennial")) return true;
                              return false;
                            }) || [];

                            // Group by inspector
                            const slotsByInspector: Record<string, typeof matchingSlots> = {};
                            matchingSlots.forEach(slot => {
                              const name = slot.user_name || "Unknown";
                              if (!slotsByInspector[name]) slotsByInspector[name] = [];
                              slotsByInspector[name].push(slot);
                            });

                            return Object.entries(slotsByInspector).map(([inspectorName, slots]) => (
                              <div key={inspectorName} className="mb-1">
                                <span className="text-purple-400 font-medium text-[0.6rem]">{inspectorName}</span>
                                <div className="flex flex-wrap gap-0.5 mt-0.5">
                                  {slots.map((slot, slotIndex) => (
                                    <button
                                      key={`${inspectorName}-${slotIndex}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (selectedProject) {
                                          setScheduleModal({
                                            project: selectedProject,
                                            date: dateStr,
                                            slot: {
                                              userName: inspectorName,
                                              userUid: slot.user_uid,
                                              teamUid: slot.team_uid,
                                              startTime: slot.start_time,
                                              endTime: slot.end_time,
                                              location: slot.location || "",
                                              timezone: slot.timezone,
                                            }
                                          });
                                        }
                                      }}
                                      className="text-[0.55rem] px-1 py-0.5 rounded bg-purple-500/10 hover:bg-purple-500/30 text-purple-400 cursor-pointer border border-purple-500/20 hover:border-purple-500/40"
                                      title={`Book ${inspectorName} at ${slot.display_time || `${slot.start_time}-${slot.end_time}`}`}
                                    >
                                      {slot.display_time || formatTime12h(slot.start_time)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ));
                          })()}

                          {/* Booked slots grouped by inspector */}
                          {showAvailability && selectedProject && dayAvailability?.bookedSlots && dayAvailability.bookedSlots.length > 0 && (() => {
                            const projectLocation = selectedProject?.location;
                            const matchingBooked = dayAvailability.bookedSlots.filter(slot => {
                              if (!projectLocation) return true;
                              if (!slot.location) return true;
                              if (slot.location === projectLocation) return true;
                              if ((slot.location === "DTC" || slot.location === "Centennial") &&
                                  (projectLocation === "DTC" || projectLocation === "Centennial")) return true;
                              return false;
                            });

                            if (matchingBooked.length === 0) return null;

                            const bookedByInspector: Record<string, typeof matchingBooked> = {};
                            matchingBooked.forEach(slot => {
                              const name = slot.user_name || "Unknown";
                              if (!bookedByInspector[name]) bookedByInspector[name] = [];
                              bookedByInspector[name].push(slot);
                            });

                            return Object.entries(bookedByInspector).map(([inspectorName, slots]) => (
                              <div
                                key={`booked-${inspectorName}`}
                                className="text-[0.6rem] leading-tight text-orange-400/60 break-words"
                                title={`Booked: ${inspectorName} - ${slots.map(s => `${s.display_time || s.start_time} (${s.projectName || "Unknown"})`).join(", ")}`}
                              >
                                <span className="text-orange-500/40">&#8856;</span> <span className="font-medium">{inspectorName}</span>
                                <span className="text-orange-500/30 block">
                                  {slots.map(s => s.display_time || formatTime12h(s.start_time)).join(", ")}
                                </span>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* List View */
              <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
                <div className="p-3 border-b border-t-border">
                  <h2 className="text-sm font-semibold">All Inspection Projects ({filteredProjects.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-surface">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Project</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase hidden lg:table-cell">Address</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Location</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Inspector</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Inspection Date</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">Amount</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-muted uppercase">Links</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-muted uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-t-border">
                      {filteredProjects.map((project) => {
                        const schedDate = manualSchedules[project.id] || project.scheduleDate;
                        const overdue = isInspectionOverdue(project, manualSchedules[project.id], passedReinspections);
                        return (
                          <tr key={project.id} className={`hover:bg-surface/50 ${overdue ? "bg-red-500/5" : ""}`}>
                            <td className="px-4 py-3">
                              <a href={project.hubspotUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-purple-400">
                                {overdue && <span className="text-red-400 mr-1">⚠</span>}
                                {getCustomerName(project.name)}
                              </a>
                              <div className="text-xs text-muted">{getProjectId(project.name)}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-muted max-w-[200px] truncate hidden lg:table-cell" title={project.address}>
                              {project.address !== "Address TBD" ? project.address : "—"}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted">{project.location}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(project.inspectionStatus)}`}>
                                  {project.inspectionStatus}
                                </span>
                                {overdue && (
                                  <span className="text-xs px-1.5 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/30 font-medium">
                                    Overdue
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-purple-400">
                              {project.assignedInspector || "—"}
                            </td>
                            <td className={`px-4 py-3 text-sm ${overdue ? "text-red-400" : schedDate ? "text-purple-400" : "text-muted"}`}>
                              {schedDate ? formatShortDate(schedDate) : "—"}
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
                                  onClick={() => selectProjectWithTracking(project, "inspection-scheduler:list-table")}
                                  className="text-xs text-purple-400 hover:text-purple-300"
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
            <h3 className="text-lg font-semibold mb-4">
              {scheduleModal.currentSlot && !scheduleModal.isRescheduling
                ? "Inspection Details"
                : scheduleModal.isRescheduling
                  ? "Reschedule Inspection"
                  : "Schedule Inspection"}
            </h3>
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

              {scheduleModal.project.address && scheduleModal.project.address !== "Address TBD" && (
                <div>
                  <span className="text-xs text-muted">Address</span>
                  <p className="text-sm text-foreground/80">{scheduleModal.project.address}</p>
                </div>
              )}

              <div>
                <span className="text-xs text-muted">Location</span>
                <p className="text-sm">{scheduleModal.project.location}</p>
              </div>

              <div>
                <span className="text-xs text-muted">Inspection Date</span>
                <p className="text-sm font-medium text-purple-400">{formatDate(scheduleModal.date)}</p>
              </div>

              {/* Time Slot Selection — 3 states */}
              {scheduleModal.currentSlot && !scheduleModal.isRescheduling && !scheduleModal.slot ? (
                /* State A: Viewing existing booking */
                <div className="p-2 bg-purple-900/20 border border-purple-500/20 rounded-lg">
                  <span className="text-xs text-purple-400 font-medium">Currently Scheduled</span>
                  <p className="text-sm text-white mt-1">
                    {scheduleModal.currentSlot.userName} &bull; {scheduleModal.currentSlot.displayTime}
                  </p>
                  <button
                    onClick={() => setScheduleModal({ ...scheduleModal, isRescheduling: true })}
                    className="text-xs text-purple-400 hover:text-purple-300 mt-2 underline"
                  >
                    Reschedule
                  </button>
                </div>
              ) : scheduleModal.slot ? (
                /* State B: Slot selected (new or reschedule) */
                <div className="p-2 bg-purple-900/30 border border-purple-500/30 rounded-lg">
                  <span className="text-xs text-purple-400 font-medium">Selected Time Slot</span>
                  <p className="text-sm text-white mt-1">
                    {scheduleModal.slot.userName} &bull; {formatTimeRange12h(scheduleModal.slot.startTime, scheduleModal.slot.endTime)}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {scheduleModal.slot.location}{scheduleModal.slot.timezone === "America/Los_Angeles" ? " · PT" : " · MT"}
                  </p>
                  <div className="flex gap-3 mt-1">
                    <button
                      onClick={() => setScheduleModal({ ...scheduleModal, slot: undefined })}
                      className="text-xs text-muted hover:text-foreground"
                    >
                      Change time slot
                    </button>
                    {scheduleModal.isRescheduling && (
                      <button
                        onClick={() => setScheduleModal({ ...scheduleModal, slot: undefined, isRescheduling: false })}
                        className="text-xs text-muted hover:text-foreground"
                      >
                        Cancel reschedule
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* State C: Picking a slot (new scheduling or rescheduling) */
                <div>
                  <span className="text-xs text-muted">Select Time Slot</span>
                  <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                    {(() => {
                      const dayAvail = availabilityByDate[scheduleModal.date];
                      const projectLocation = scheduleModal.project.location;
                      const availSlots = dayAvail?.availableSlots?.filter(slot => {
                        if (!projectLocation) return true;
                        if (!slot.location) return true;
                        if (slot.location === projectLocation) return true;
                        if ((slot.location === "DTC" || slot.location === "Centennial") &&
                            (projectLocation === "DTC" || projectLocation === "Centennial")) return true;
                        return false;
                      }) || [];

                      if (availSlots.length === 0) {
                        return (
                          <p className="text-xs text-muted italic">No available slots for this location on this date</p>
                        );
                      }

                      return availSlots.map((slot, i) => (
                        <button
                          key={i}
                          onClick={() => setScheduleModal({
                            ...scheduleModal,
                            slot: {
                              userName: slot.user_name || "",
                              userUid: slot.user_uid,
                              teamUid: slot.team_uid,
                              startTime: slot.start_time,
                              endTime: slot.end_time,
                              location: slot.location || "",
                              timezone: slot.timezone,
                            }
                          })}
                          className="w-full text-left px-2 py-1.5 text-sm rounded bg-surface-2 hover:bg-purple-900/30 hover:border-purple-500/30 border border-transparent transition-colors"
                        >
                          <span className="text-purple-400">{slot.user_name}</span>
                          <span className="text-muted ml-2">{slot.display_time || formatTimeRange12h(slot.start_time, slot.end_time)}</span>
                        </button>
                      ));
                    })()}
                  </div>
                  {scheduleModal.isRescheduling && (
                    <button
                      onClick={() => setScheduleModal({ ...scheduleModal, isRescheduling: false })}
                      className="text-xs text-muted hover:text-foreground mt-2"
                    >
                      Cancel reschedule
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-4">
                <div>
                  <span className="text-xs text-muted">System Size</span>
                  <p className="text-sm">{scheduleModal.project.systemSize.toFixed(1)} kW</p>
                </div>
                <div>
                  <span className="text-xs text-muted">Amount</span>
                  <p className="text-sm font-mono text-orange-400">{formatCurrency(scheduleModal.project.amount)}</p>
                </div>
              </div>

              {/* External Links */}
              <div className="flex items-center gap-3">
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

            {/* Zuper Sync Option — only show when scheduling/rescheduling */}
            {zuperConfigured && (scheduleModal.slot || (scheduleModal.isRescheduling && !scheduleModal.currentSlot)) && (
              <div className="mb-4 p-3 bg-surface rounded-lg border border-t-border">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncToZuper}
                    onChange={(e) => setSyncToZuper(e.target.checked)}
                    className="w-4 h-4 rounded border-t-border bg-surface-2 text-purple-500 focus:ring-purple-500"
                  />
                  <span className="text-sm">Sync to Zuper FSM</span>
                </label>
                <p className={`text-xs mt-2 ${syncToZuper ? "text-purple-400" : "text-amber-400"}`}>
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

            <div className="flex justify-end gap-2">
              {scheduleModal.currentSlot && !scheduleModal.isRescheduling && !scheduleModal.slot ? (
                /* View mode — just Close button */
                <button
                  onClick={() => setScheduleModal(null)}
                  className="px-4 py-2 text-sm bg-surface-2 hover:bg-zinc-600 rounded-lg font-medium"
                >
                  Close
                </button>
              ) : (
                /* Schedule/Reschedule mode */
                <>
                  <button
                    onClick={() => setScheduleModal(null)}
                    className="px-4 py-2 text-sm text-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmSchedule}
                    disabled={syncingToZuper || !scheduleModal.slot}
                    className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 rounded-lg font-medium disabled:opacity-50"
                  >
                    {syncingToZuper ? "Syncing..." : scheduleModal.isRescheduling ? "Confirm Reschedule" : "Confirm Schedule"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* My Availability Modal */}
      {showMyAvailability && (
        <MyAvailability onClose={() => { setShowMyAvailability(false); fetchAvailability(); }} />
      )}
    </div>
  );
}
