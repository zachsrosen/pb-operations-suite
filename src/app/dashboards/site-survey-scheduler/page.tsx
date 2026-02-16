"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import MyAvailability from "./my-availability";

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
  siteSurveyStatus?: string;
  siteSurveyCompletionDate?: string;
  closeDate?: string;
  dealOwner?: string;
  siteSurveyor?: string;
  equipment?: {
    systemSizeKwdc?: number;
    modules?: { count?: number };
    inverter?: { count?: number };
    battery?: { count?: number; expansionCount?: number; brand?: string };
    evCount?: number;
  };
}

interface SurveyProject {
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
  surveyStatus: string;
  completionDate: string | null;
  closeDate: string | null;
  hubspotUrl: string;
  zuperJobUid?: string;
  zuperJobStatus?: string;
  zuperScheduledTime?: string; // Local time from Zuper (e.g., "1pm") for display when booked slot not found
  dealOwner: string;
  assignedSurveyor?: string; // Surveyor name from Zuper/localStorage/HubSpot
  // Assigned slot info (if already scheduled)
  assignedSlot?: {
    userName: string;
    startTime: string;
    endTime: string;
    displayTime: string;
  };
}

interface PendingSchedule {
  project: SurveyProject;
  date: string;
  slot?: {
    userName: string;
    userUid?: string;
    teamUid?: string; // Zuper team UID (required for assignment API)
    startTime: string;
    endTime: string;
    location: string;
    timezone?: string; // IANA timezone if not Mountain Time (e.g. "America/Los_Angeles")
  };
  isRescheduling?: boolean; // True if user wants to change existing schedule
  currentSlot?: {  // The existing booked slot for this project
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
    display_time?: string;
    user_uid?: string;
    team_uid?: string; // Zuper team UID (required for assignment API)
    user_name?: string;
    location?: string;
    timezone?: string; // IANA timezone for non-Mountain Time slots (e.g. "America/Los_Angeles")
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

// Format 24-hour time (e.g., "13:00") to 12-hour format (e.g., "1pm")
function formatTime12h(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "pm" : "am";
  const hour12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return minutes === 0 ? `${hour12}${suffix}` : `${hour12}:${minutes.toString().padStart(2, "0")}${suffix}`;
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

// Check if a date is in the past (before today)
function isPastDate(dateStr: string): boolean {
  return dateStr < getTodayStr();
}

// Check if a date is tomorrow (next day after today)
function isTomorrow(dateStr: string): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return dateStr === toDateStr(tomorrow);
}

// Check if a survey is overdue: scheduled in the past but not completed
function isSurveyOverdue(project: SurveyProject, manualScheduleDate?: string): boolean {
  const schedDate = manualScheduleDate || project.scheduleDate;
  if (!schedDate) return false;
  if (isReadyToScheduleStatus(project.surveyStatus)) return false;
  if (project.completionDate) return false;
  if (project.surveyStatus.toLowerCase().includes("complete")) return false;
  return isPastDate(schedDate);
}

function isReadyToScheduleStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return s.includes("ready to schedule") || s === "ready";
}

function hasActiveSchedule(project: SurveyProject, manualScheduleDate?: string): boolean {
  const schedDate = manualScheduleDate || project.scheduleDate;
  if (!schedDate) return false;
  if (project.completionDate) return false;
  if (isReadyToScheduleStatus(project.surveyStatus)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Transform API data                                                 */
/* ------------------------------------------------------------------ */

function transformProject(p: RawProject): SurveyProject | null {
  // Only include projects in Site Survey stage
  if (p.stage !== "Site Survey") return null;

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
    scheduleDate: p.siteSurveyScheduleDate || null,
    surveyStatus: p.siteSurveyStatus || "Ready to Schedule",
    completionDate: p.siteSurveyCompletionDate || null,
    closeDate: p.closeDate || null,
    hubspotUrl: p.url || `https://app.hubspot.com/contacts/21710069/record/0-3/${p.id}`,
    dealOwner: p.dealOwner || "",
    // Pre-populate from HubSpot if resolved to a name (skip raw numeric enum IDs)
    assignedSurveyor: (p.siteSurveyor && !/^\d+$/.test(p.siteSurveyor)) ? p.siteSurveyor : undefined,
  };
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function SiteSurveySchedulerPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView, trackFeature } = useActivityTracking();
  const hasTrackedView = useRef(false);

  /* ---- core data ---- */
  const [projects, setProjects] = useState<SurveyProject[]>([]);
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
  const [selectedProject, setSelectedProject] = useState<SurveyProject | null>(null);
  const [manualSchedules, setManualSchedules] = useState<Record<string, string>>({});
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);

  /* ---- modals ---- */
  const [scheduleModal, setScheduleModal] = useState<PendingSchedule | null>(null);

  /* ---- Zuper integration ---- */
  const [zuperConfigured, setZuperConfigured] = useState(false);
  const [zuperWebBaseUrl, setZuperWebBaseUrl] = useState("https://us-west-1c.zuperpro.com");
  const [syncToZuper, setSyncToZuper] = useState(true);
  const [syncingToZuper, setSyncingToZuper] = useState(false);
  const [useTestSlot, setUseTestSlot] = useState(false);

  /* ---- Assisted scheduling ---- */
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availabilityByDate, setAvailabilityByDate] = useState<Record<string, DayAvailability>>({});
  const [showAvailability, setShowAvailability] = useState(true);

  /* ---- user role ---- */
  const [userRole, setUserRole] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

  /* ---- self-service availability ---- */
  const [isLinkedSurveyor, setIsLinkedSurveyor] = useState(false);
  const [showMyAvailability, setShowMyAvailability] = useState(false);

  /* ---- surveyor assignments (stored locally) ---- */
  const [, setSurveyorAssignments] = useState<Record<string, string>>({});

  // Load surveyor assignments from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("surveyorAssignments");
      if (stored) {
        setSurveyorAssignments(JSON.parse(stored));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save surveyor assignments to localStorage when they change
  const saveSurveyorAssignment = useCallback((projectId: string, surveyorName: string) => {
    setSurveyorAssignments((prev) => {
      const next = { ...prev, [projectId]: surveyorName };
      try {
        localStorage.setItem("surveyorAssignments", JSON.stringify(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }, []);

  const clearSurveyorAssignment = useCallback((projectId: string) => {
    setSurveyorAssignments((prev) => {
      const next = { ...prev };
      delete next[projectId];
      try {
        localStorage.setItem("surveyorAssignments", JSON.stringify(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }, []);

  /* ---- toast ---- */
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("site-survey-scheduler", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  /* ================================================================ */
  /*  Data fetching                                                    */
  /* ================================================================ */

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/projects?context=scheduling&fields=id,name,address,city,state,pbLocation,amount,projectType,stage,url,siteSurveyScheduleDate,siteSurveyStatus,siteSurveyCompletionDate,closeDate,equipment,projectNumber,dealOwner,siteSurveyor");
      if (!response.ok) throw new Error("Failed to fetch projects");
      const data = await response.json();
      const transformed = data.projects
        .map((p: RawProject) => transformProject(p))
        .filter((p: SurveyProject | null): p is SurveyProject => p !== null);

      // Look up Zuper job UIDs for these projects
      if (transformed.length > 0) {
        try {
          const projectIds = transformed.map((p: SurveyProject) => p.id).join(",");
          const projectNames = transformed.map((p: SurveyProject) => encodeURIComponent(p.name)).join("|||");
          const zuperResponse = await fetch(`/api/zuper/jobs/lookup?projectIds=${projectIds}&projectNames=${projectNames}&category=site-survey`);
          if (zuperResponse.ok) {
            const zuperData = await zuperResponse.json();
            if (zuperData.jobs) {
              // Merge Zuper job UIDs and assigned users into projects
              for (const project of transformed) {
                const zuperJob = zuperData.jobs[project.id];
                if (zuperJob) {
                  project.zuperJobUid = zuperJob.jobUid;
                  project.zuperJobStatus = zuperJob.status;
                  // Use Zuper's assigned user as the primary source of truth
                  if (zuperJob.assignedTo) {
                    project.assignedSurveyor = zuperJob.assignedTo;
                  }
                  // Use Zuper's scheduled date and time as source of truth — when a job is
                  // rescheduled in Zuper, the HubSpot date may be stale. Convert
                  // the UTC timestamp to local date/time in the appropriate timezone.
                  if (zuperJob.scheduledDate) {
                    try {
                      const utcDate = new Date(zuperJob.scheduledDate);
                      // Determine timezone from project location
                      const loc = (project.location || "").toLowerCase();
                      const tz = (loc.includes("san luis") || loc.includes("slo") || loc.includes("camarillo"))
                        ? "America/Los_Angeles" : "America/Denver";
                      const localDate = utcDate.toLocaleDateString("en-CA", { timeZone: tz });
                      // Extract local time for display (e.g., "1pm", "12pm")
                      const localTimeStr = utcDate.toLocaleTimeString("en-US", {
                        timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
                      }).replace(":00 ", "").replace(" ", "").toLowerCase();
                      project.zuperScheduledTime = localTimeStr;

                      if (localDate && localDate !== project.scheduleDate) {
                        project.scheduleDate = localDate;
                      }
                    } catch {
                      // Ignore date parsing errors
                    }
                  }
                }
              }
            }
          }
        } catch (zuperErr) {
          console.warn("Failed to lookup Zuper jobs:", zuperErr);
          // Don't fail the whole load if Zuper lookup fails
        }
      }

      // Merge locally-stored surveyor assignments into projects (only if not already set by Zuper)
      try {
        const stored = localStorage.getItem("surveyorAssignments");
        if (stored) {
          const assignments = JSON.parse(stored) as Record<string, string>;
          for (const project of transformed) {
            if (!project.assignedSurveyor && assignments[project.id]) {
              project.assignedSurveyor = assignments[project.id];
            }
          }
        }
      } catch {
        // Ignore localStorage errors
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

  // Fetch user role + check if linked crew member
  useEffect(() => {
    fetch("/api/auth/sync")
      .then(res => res.json())
      .then(data => {
        if (data.role) setUserRole(data.role);
        if (data?.user?.name) setCurrentUserName(data.user.name);
      })
      .catch(() => {});
    fetch("/api/zuper/my-availability")
      .then(res => { if (res.ok) setIsLinkedSurveyor(true); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!scheduleModal) {
      setUseTestSlot(false);
    }
  }, [scheduleModal]);

  // Fetch availability when a project is selected or month changes
  const fetchAvailability = useCallback(async (location?: string) => {
    if (!zuperConfigured) return;

    setLoadingSlots(true);
    try {
      // Get date range for current month view
      const firstDay = new Date(currentYear, currentMonth, 1);
      const lastDay = new Date(currentYear, currentMonth + 1, 0);
      const fromDate = firstDay.toISOString().split("T")[0];
      const toDate = lastDay.toISOString().split("T")[0];

      const params = new URLSearchParams({
        from_date: fromDate,
        to_date: toDate,
        type: "survey",
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

  // Fetch availability when project is selected or month changes
  useEffect(() => {
    if (selectedProject && zuperConfigured) {
      fetchAvailability(selectedProject.location);
    } else if (zuperConfigured && showAvailability) {
      // Fetch general availability when no project selected but overlay is on
      fetchAvailability();
    }
  }, [selectedProject, zuperConfigured, currentMonth, currentYear, fetchAvailability, showAvailability]);

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
      [...new Set(projects.map((p) => p.surveyStatus))]
        .filter(Boolean)
        .sort()
        .map((s) => ({ value: s, label: s })),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((p) => {
      // Multi-select location filter - if any selected, filter by them
      if (selectedLocations.length > 0 && !selectedLocations.includes(p.location)) return false;
      if (filterStatuses.length > 0 && !filterStatuses.includes(p.surveyStatus)) return false;
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
      filtered.sort((a, b) => a.surveyStatus.localeCompare(b.surveyStatus));
    }
    return filtered;
  }, [projects, selectedLocations, filterStatuses, searchText, sortBy, manualSchedules]);

  const unscheduledProjects = useMemo(() => {
    return filteredProjects.filter(p =>
      !hasActiveSchedule(p, manualSchedules[p.id]) &&
      !p.surveyStatus.toLowerCase().includes("complete")
    );
  }, [filteredProjects, manualSchedules]);

  const stats = useMemo(() => {
    const total = projects.length;
    const needsScheduling = projects.filter(p =>
      !hasActiveSchedule(p, manualSchedules[p.id]) && !p.completionDate
    ).length;
    const scheduled = projects.filter(p =>
      hasActiveSchedule(p, manualSchedules[p.id]) && !p.completionDate
    ).length;
    const completed = projects.filter(p => p.completionDate).length;
    const overdue = projects.filter(p => isSurveyOverdue(p, manualSchedules[p.id])).length;
    const totalValue = projects.reduce((sum, p) => sum + p.amount, 0);

    return { total, needsScheduling, scheduled, completed, overdue, totalValue };
  }, [projects, manualSchedules]);

  /* ================================================================ */
  /*  Calendar data                                                    */
  /* ================================================================ */

  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const days: string[] = [];

    // Adjust for Monday start (0 = Sun, 1 = Mon, etc.)
    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1; // Convert to Monday = 0

    // Add days from previous month
    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth, -i);
      days.push(toDateStr(d));
    }

    // Add days of current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(`${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`);
    }

    // Pad to complete weeks
    while (days.length % 7 !== 0) {
      const lastDate = new Date(days[days.length - 1] + "T12:00:00");
      lastDate.setDate(lastDate.getDate() + 1);
      days.push(toDateStr(lastDate));
    }

    return days;
  }, [currentYear, currentMonth]);

  const eventsForDate = useCallback((dateStr: string) => {
    return filteredProjects
      .filter(p => {
        if (!hasActiveSchedule(p, manualSchedules[p.id])) return false;
        const schedDate = manualSchedules[p.id] || p.scheduleDate;
        return schedDate === dateStr;
      })
      .sort((a, b) => {
        // Sort by time: use assigned slot start time, then Zuper scheduled time, then unscheduled last
        const timeA = a.assignedSlot?.startTime || a.zuperScheduledTime || "zzz";
        const timeB = b.assignedSlot?.startTime || b.zuperScheduledTime || "zzz";
        return timeA.localeCompare(timeB);
      });
  }, [filteredProjects, manualSchedules]);

  /* ================================================================ */
  /*  Scheduling actions                                               */
  /* ================================================================ */

  // Find the current booked slot for a project (if already scheduled)
  // HubSpot projectName format: "PROJ-9031 | Czajkowski, Thomas"
  // Zuper bookedSlot.projectName formats:
  //   - "Barstad, Ed | 6611 S Yarrow St, Littleton, CO 80123" (created in Zuper)
  //   - "Site Survey - PROJ-9031 | Czajkowski, Thomas" (created via app)
  const findCurrentSlotForProject = useCallback((projectId: string, date: string, projectName?: string, zuperJobUid?: string) => {
    const dayAvail = availabilityByDate[date];
    if (!dayAvail?.bookedSlots) return undefined;

    // Extract the PROJ ID from the project name (e.g., "PROJ-9031")
    const projId = projectName?.split(" | ")[0] || "";

    // Extract customer last name from HubSpot project name (e.g., "Czajkowski" from "PROJ-9031 | Czajkowski, Thomas")
    const customerPart = projectName?.split(" | ")[1] || "";
    const customerLastName = customerPart.split(",")[0]?.trim().toLowerCase() || "";

    // Look for a booked slot that matches this project
    const bookedSlot = dayAvail.bookedSlots.find(slot => {
      const slotNameLower = (slot.projectName || "").toLowerCase();

      // Match by HubSpot project ID (direct match)
      if (slot.projectId === projectId) return true;

      // Match by Zuper job UID (most reliable for Zuper-sourced bookings)
      if (zuperJobUid && slot.zuperJobUid && slot.zuperJobUid === zuperJobUid) return true;

      // Match by PROJ number anywhere in slot name
      // Handles both "PROJ-9031 | Name" and "Site Survey - PROJ-9031 | Name"
      if (projId && slotNameLower.includes(projId.toLowerCase())) return true;

      // Match by customer last name (for jobs created directly in Zuper)
      // Zuper job titles are often "LastName, FirstName | Address"
      if (customerLastName && customerLastName.length > 2) {
        // Check if Zuper job title starts with or contains the customer's last name
        if (slotNameLower.startsWith(customerLastName + ",") ||
            slotNameLower.startsWith(customerLastName + " ")) {
          return true;
        }
        // Also check after " - " prefix (e.g. "Site Survey - PROJ-9031 | Morse, Todd")
        const afterDash = slotNameLower.split(" - ").slice(1).join(" - ");
        if (afterDash && afterDash.includes("| " + customerLastName + ",")) {
          return true;
        }
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

  const handleDragStart = useCallback((projectId: string) => {
    setDraggedProjectId(projectId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((date: string) => {
    if (!draggedProjectId) return;
    if (isPastDate(date)) {
      showToast("Cannot schedule on past dates");
      setDraggedProjectId(null);
      return;
    }
    if (userRole === "SALES" && isTomorrow(date)) {
      showToast("Cannot schedule for tomorrow — surveys need at least 2 days lead time");
      setDraggedProjectId(null);
      return;
    }
    const project = projects.find(p => p.id === draggedProjectId);
    if (project) {
      const currentSlot = findCurrentSlotForProject(project.id, date, project.name, project.zuperJobUid);
      trackFeature("schedule-modal-open", "Opened survey schedule modal via drag", { scheduler: "site-survey", projectId: project.id, projectName: project.name, date, method: "drag" });
      setScheduleModal({ project, date, currentSlot });
    }
    setDraggedProjectId(null);
  }, [draggedProjectId, projects, findCurrentSlotForProject, showToast, userRole, trackFeature]);

  const handleDateClick = useCallback((date: string, project?: SurveyProject) => {
    if (isPastDate(date)) {
      showToast("Cannot schedule on past dates");
      return;
    }
    if (userRole === "SALES" && isTomorrow(date)) {
      showToast("Cannot schedule for tomorrow — surveys need at least 2 days lead time");
      return;
    }
    if (project) {
      const currentSlot = findCurrentSlotForProject(project.id, date, project.name, project.zuperJobUid);
      trackFeature("schedule-modal-open", "Opened survey schedule modal via click", { scheduler: "site-survey", projectId: project.id, projectName: project.name, date, method: "click" });
      setScheduleModal({ project, date, currentSlot });
    } else if (selectedProject) {
      const currentSlot = findCurrentSlotForProject(selectedProject.id, date, selectedProject.name, selectedProject.zuperJobUid);
      trackFeature("schedule-modal-open", "Opened survey schedule modal via click", { scheduler: "site-survey", projectId: selectedProject.id, projectName: selectedProject.name, date, method: "click" });
      setScheduleModal({ project: selectedProject, date, currentSlot });
      setSelectedProject(null);
    }
  }, [selectedProject, findCurrentSlotForProject, showToast, userRole, trackFeature]);

  const confirmSchedule = useCallback(async () => {
    if (!scheduleModal) return;
    const { project, date, slot } = scheduleModal;
    const effectiveAssignee = useTestSlot
      ? (currentUserName || slot?.userName || "Test Slot")
      : (slot?.userName || "");
    const effectiveCrewUid = useTestSlot ? undefined : slot?.userUid;
    const effectiveTeamUid = useTestSlot ? undefined : slot?.teamUid;

    // Safety net: prevent SALES from confirming a tomorrow schedule
    if (userRole === "SALES" && isTomorrow(date)) {
      showToast("Cannot schedule for tomorrow — surveys need at least 2 days lead time");
      setScheduleModal(null);
      return;
    }

    trackFeature("survey-scheduled", "Survey scheduled", {
      scheduler: "site-survey",
      projectId: project.id,
      projectName: project.name,
      date,
      surveyor: effectiveAssignee || null,
      slot: slot ? `${slot.startTime}-${slot.endTime}` : null,
      syncToZuper,
      testMode: useTestSlot,
      isReschedule: !!project.zuperJobUid,
    });

    setManualSchedules((prev) => ({
      ...prev,
      [project.id]: date,
    }));

    // Store surveyor assignment locally so we can display it
    if (effectiveAssignee) {
      saveSurveyorAssignment(project.id, effectiveAssignee);
      // Also update the project in state immediately
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id ? { ...p, assignedSurveyor: effectiveAssignee } : p
        )
      );
    }

    // Track the Zuper job UID from scheduling response
    let scheduledZuperJobUid: string | undefined = project.zuperJobUid;

    // Sync to Zuper FIRST if enabled (so we get the job UID for local booking)
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
              zuperJobUid: project.zuperJobUid, // Pass existing Zuper job UID if known
            },
            schedule: {
              type: "survey",
              date: date,
              days: 0.25, // Site surveys are typically ~1 hour
              startTime: slot?.startTime, // e.g. "12:00"
              endTime: slot?.endTime, // e.g. "13:00"
              crew: effectiveCrewUid, // Zuper user UID for assignment
              teamUid: effectiveTeamUid, // Zuper team UID (required for assignment API)
              assignedUser: effectiveAssignee,
              timezone: slot?.timezone, // Slot's local timezone (e.g. "America/Los_Angeles" for CA)
              notes: useTestSlot
                ? `TEST SLOT - ${effectiveAssignee} at ${slot?.startTime || "N/A"}`
                : (slot ? `Surveyor: ${slot.userName} at ${slot.startTime}` : "Scheduled via Site Survey Schedule"),
              testMode: useTestSlot,
            },
            rescheduleOnly: true,
          }),
        });

        if (response.ok) {
          const data = await response.json();

          // No existing Zuper job found — warn user
          if (data.action === "no_job_found") {
            console.warn(`[Survey Schedule] No Zuper job found for "${project.name}"`);
            showToast(
              `${getCustomerName(project.name)} scheduled locally — no matching Zuper job found. Create the job in Zuper first.`,
              "warning"
            );
          } else {
            // Capture the Zuper job UID from the response
            scheduledZuperJobUid = data.job?.job_uid || data.existingJobId || project.zuperJobUid;
            const slotInfo = slot ? ` (${effectiveAssignee} ${slot.startTime})` : "";

            // Check if assignment failed
            if (data.assignmentFailed) {
              showToast(
                `${getCustomerName(project.name)} scheduled${slotInfo} - please assign ${effectiveAssignee || "user"} in Zuper`,
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
          console.error(`[Survey Schedule] Zuper sync error for "${project.name}":`, errorMsg);
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
              type: "survey",
              date,
              startTime: slot?.startTime,
              endTime: slot?.endTime,
              crew: effectiveCrewUid,
              assignedUser: effectiveAssignee,
              userUid: effectiveCrewUid,
              teamUid: effectiveTeamUid,
              notes: slot
                ? (useTestSlot
                  ? `TEST SLOT - Tentative ${effectiveAssignee} at ${slot.startTime}`
                  : `Tentative surveyor: ${slot.userName} at ${slot.startTime}`)
                : "Tentatively scheduled via Site Survey Scheduler",
            },
          }),
        });

        const slotInfo = slot ? ` (${effectiveAssignee} ${slot.startTime.replace(/^0/, "")})` : "";
        if (response.ok) {
          showToast(`${getCustomerName(project.name)} tentatively scheduled${slotInfo}`);
        } else {
          showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "warning");
        }
      } catch {
        showToast(`${getCustomerName(project.name)} scheduled locally (tentative save failed)`, "warning");
      }
    }

    // Book the time slot locally AFTER Zuper sync (so we have the job UID)
    // This tracks the assignment since Zuper API doesn't support updating assignments
    if (slot) {
      try {
        const bookResponse = await fetch("/api/zuper/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            userName: effectiveAssignee,
            userUid: effectiveCrewUid, // Track the Zuper user UID for assignment
            location: slot.location,
            projectId: project.id,
            projectName: project.name,
            zuperJobUid: scheduledZuperJobUid, // Link to the Zuper job
          }),
        });
        if (!bookResponse.ok) {
          console.warn("Failed to book slot:", await bookResponse.text());
        } else {
          console.log(`[Scheduler] Booked slot for ${effectiveAssignee} (${effectiveCrewUid}) - Zuper job: ${scheduledZuperJobUid}`);
        }
      } catch (err) {
        console.error("Error booking slot:", err);
      }

      // Optimistically update client-side availability state immediately
      // This ensures the slot shows as booked even if the server-side in-memory
      // store is on a different serverless instance
      setAvailabilityByDate(prev => {
        const dayData = prev[date];
        if (!dayData) return prev;

        const updatedDay = { ...dayData };

        // Remove from available slots
        updatedDay.availableSlots = (updatedDay.availableSlots || []).filter(
          s => !(s.start_time === slot.startTime && s.user_name === effectiveAssignee)
        );

        // Add to booked slots
        const existingBooked = updatedDay.bookedSlots || [];
        updatedDay.bookedSlots = [
          ...existingBooked,
          {
            start_time: slot.startTime,
            end_time: slot.endTime,
            display_time: `${slot.startTime}-${slot.endTime}`,
            user_name: effectiveAssignee,
            location: slot.location,
            projectId: project.id,
            projectName: project.name,
          },
        ];

        updatedDay.hasAvailability = updatedDay.availableSlots.length > 0;

        return { ...prev, [date]: updatedDay };
      });
    }

    // Also refresh from server to get the full Zuper-synced state
    // (may take a moment for Zuper to reflect the new job)
    if (slot) {
      // Delay refresh slightly to let Zuper sync complete
      setTimeout(() => fetchAvailability(project.location), 2000);
    }

    setScheduleModal(null);
  }, [scheduleModal, useTestSlot, currentUserName, zuperConfigured, syncToZuper, showToast, fetchAvailability, saveSurveyorAssignment, userRole, trackFeature]);

  const cancelSchedule = useCallback(async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    trackFeature("survey-cancelled", "Survey removed from schedule", {
      scheduler: "site-survey",
      projectId,
      projectName: project?.name || projectId,
    });

    // Remove from local state immediately for responsive UI
    setManualSchedules((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    clearSurveyorAssignment(projectId);
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, scheduleDate: null, assignedSurveyor: undefined, assignedSlot: undefined, zuperScheduledTime: undefined }
          : p
      )
    );

    // Sync to Zuper & HubSpot in background
    try {
      const response = await fetch("/api/zuper/jobs/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName: project?.name || projectId,
          zuperJobUid: project?.zuperJobUid || null,
          scheduleType: "survey",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const message = errorData?.message || errorData?.error || "Failed to remove from schedule in Zuper";
        showToast(message, "warning");
        // Re-sync local state when backend clear fails.
        fetchProjects();
        return;
      }
    } catch (err) {
      console.error("Failed to sync unschedule to Zuper:", err);
      showToast("Failed to sync remove from schedule to Zuper", "warning");
      fetchProjects();
      return;
    }

    showToast("Removed from schedule");
    // Background refresh to reconcile server state without jarring immediate repaint.
    setTimeout(() => {
      fetchProjects();
      if (project?.location) {
        fetchAvailability(project.location);
      }
    }, 1200);
  }, [showToast, projects, trackFeature, fetchProjects, fetchAvailability, clearSurveyorAssignment]);

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
    if (s.includes("complete")) return "bg-green-500/20 text-green-400 border-green-500/30";
    if (s.includes("scheduled")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (s.includes("progress") || s.includes("started") || s.includes("on our way")) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    if (s.includes("ready")) return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
    if (s.includes("awaiting") || s.includes("pending")) return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    if (s.includes("hold") || s.includes("revisit")) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    return "bg-zinc-500/20 text-muted border-muted/30";
  };

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mx-auto mb-4" />
          <p className="text-muted">Loading Site Surveys...</p>
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
          <button onClick={fetchProjects} className="px-4 py-2 bg-cyan-600 rounded-lg hover:bg-cyan-700">
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
              <h1 className="text-base sm:text-xl font-bold text-cyan-400 truncate">Site Survey Schedule</h1>
              <span className="text-xs text-muted bg-surface-2 px-2 py-1 rounded hidden sm:inline-block">
                {stats.total} surveys
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {/* View Toggle */}
              <div className="flex bg-surface rounded-lg p-0.5">
                <button
                  onClick={() => setCurrentView("calendar")}
                  className={`px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "calendar" ? "bg-cyan-600 text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  Calendar
                </button>
                <button
                  onClick={() => setCurrentView("list")}
                  className={`px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "list" ? "bg-cyan-600 text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  List
                </button>
              </div>

              {isLinkedSurveyor && (
                <button
                  onClick={() => setShowMyAvailability(true)}
                  className="px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md bg-surface-2 text-foreground/80 hover:bg-surface-2 transition-colors hidden sm:inline-flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  My Availability
                </button>
              )}

              {(userRole === "ADMIN" || userRole === "OPERATIONS_MANAGER" || userRole === "OPERATIONS") && (
                <Link
                  href="/admin/crew-availability"
                  className="px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md bg-surface-2 text-foreground/80 hover:bg-surface-2 transition-colors hidden sm:inline-flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Manage Availability
                </Link>
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
              <span className="text-cyan-400 font-semibold">{stats.needsScheduling}</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <span className="text-muted">Scheduled:</span>
              <span className="text-blue-400 font-semibold">{stats.scheduled}</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <span className="text-muted">Completed:</span>
              <span className="text-green-400 font-semibold">{stats.completed}</span>
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
              className="px-3 py-1.5 bg-surface border border-t-border rounded-lg text-sm focus:outline-none focus:border-cyan-500 w-32 sm:w-48"
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
                      ? "bg-cyan-600 border-cyan-500 text-white"
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
              accentColor="cyan"
            />

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-1.5 bg-surface border border-t-border rounded-lg text-sm focus:outline-none focus:border-cyan-500"
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
      <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-3 sm:py-4">
        <div className="flex flex-col lg:flex-row gap-3 sm:gap-4">
          {/* Left Sidebar - Unscheduled Projects */}
          <div className="w-full lg:w-80 lg:flex-shrink-0">
            <div className="lg:sticky lg:top-[180px] bg-surface border border-t-border rounded-xl overflow-hidden">
              <div className="p-3 border-b border-t-border bg-surface/50">
                <h2 className="text-sm font-semibold text-cyan-400">
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
                      onClick={() => setSelectedProject(selectedProject?.id === project.id ? null : project)}
                      className={`p-3 border-b border-t-border cursor-pointer hover:bg-skeleton transition-colors ${
                        selectedProject?.id === project.id ? "bg-cyan-900/20 border-l-2 border-l-cyan-500" : ""
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
                        {isSurveyOverdue(project, manualSchedules[project.id]) && (
                          <span className="text-xs px-1.5 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/30 font-medium">
                            ⚠ Overdue
                          </span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${getStatusColor(project.surveyStatus)}`}>
                          {project.surveyStatus}
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
                        <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                        <span>Available</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-orange-500/70">⊘</span>
                        <span>Scheduled</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-red-500/60 rounded-full" />
                        <span>Full</span>
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
                        onDragOver={!isPast ? handleDragOver : undefined}
                        onDrop={() => handleDrop(dateStr)}
                        onClick={() => handleDateClick(dateStr)}
                        className={`min-h-[70px] sm:min-h-[120px] max-h-[120px] sm:max-h-[200px] overflow-y-auto p-1 sm:p-1.5 border-b border-r border-t-border transition-colors ${
                          isPast ? "opacity-50 cursor-not-allowed bg-surface/40" : "cursor-pointer"
                        } ${
                          isCurrentMonth && !isPast ? "" : !isPast ? "opacity-40" : ""
                        } ${weekend && !isPast ? "bg-surface/30" : ""} ${
                          isToday ? "bg-cyan-900/20" : ""
                        } ${!isPast && selectedProject ? "hover:bg-cyan-900/10" : !isPast ? "hover:bg-skeleton" : ""} ${
                          showAvailability && hasAvailability && selectedProject && !isPast
                            ? "ring-2 ring-inset ring-emerald-500/30 bg-emerald-900/10"
                            : ""
                        } ${
                          showAvailability && isFullyBooked && selectedProject && !weekend && !isPast
                            ? "ring-2 ring-inset ring-red-500/20 bg-red-900/5"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-medium ${
                            isToday ? "text-cyan-400" : "text-muted"
                          }`}>
                            {parseInt(dateStr.split("-")[2])}
                          </span>
                          {/* Availability indicator badge */}
                          {showAvailability && zuperConfigured && isCurrentMonth && !weekend && (
                            <div className="flex items-center">
                              {loadingSlots ? (
                                <div className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" />
                              ) : hasAvailability ? (
                                <div
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30"
                                  title={`${slotCount} surveyor slot${slotCount !== 1 ? "s" : ""} available`}
                                >
                                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                  <span className="text-[0.6rem] font-medium text-emerald-400">{slotCount}</span>
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
                            // Find the booked slot for this event
                            const evSlot = findCurrentSlotForProject(ev.id, dateStr, ev.name, ev.zuperJobUid);
                            const overdue = isSurveyOverdue(ev, manualSchedules[ev.id]);
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
                                  setScheduleModal({ project: ev, date: dateStr, currentSlot: evSlot });
                                }}
                                className={`text-xs p-1 rounded cursor-grab active:cursor-grabbing ${
                                  overdue
                                    ? "bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30"
                                    : "bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/30"
                                }`}
                                title={overdue
                                  ? `⚠ OVERDUE - Survey not completed\n${evSlot ? `${evSlot.userName} @ ${evSlot.displayTime}\n` : ev.assignedSurveyor ? `${ev.assignedSurveyor}${ev.zuperScheduledTime ? ` @ ${ev.zuperScheduledTime}` : ""}\n` : ""}${ev.address || "No address"} - Click to reschedule`
                                  : evSlot ? `${evSlot.userName} @ ${evSlot.displayTime}\n${ev.address || "No address"} - Click to view` : `${ev.assignedSurveyor ? `Surveyor: ${ev.assignedSurveyor}${ev.zuperScheduledTime ? ` @ ${ev.zuperScheduledTime}` : ""}\n` : ""}${ev.address || "No address"} - Drag to reschedule`}
                              >
                                <div className="truncate">
                                  {overdue && <span className="text-red-400 mr-0.5">⚠</span>}
                                  {getCustomerName(ev.name)}
                                </div>
                                {ev.address && <div className={`text-[0.6rem] truncate ${overdue ? "text-red-400/50" : "text-cyan-400/50"}`}>{ev.address}</div>}
                                {evSlot ? (
                                  <div className="text-[0.6rem] text-cyan-400/60 truncate">{evSlot.userName} @ {evSlot.displayTime}</div>
                                ) : ev.assignedSurveyor ? (
                                  <div className="text-[0.6rem] text-emerald-400/70 truncate">
                                    {ev.assignedSurveyor}{ev.zuperScheduledTime ? ` @ ${ev.zuperScheduledTime}` : ""}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                                                    {/* Show available surveyors with time slots - scrollable list */}
                          {showAvailability && hasAvailability && (() => {
                            // Filter slots by project location if a project is selected
                            const projectLocation = selectedProject?.location;
                            const matchingSlots = dayAvailability?.availableSlots?.filter(slot => {
                              // If no project selected, show all slots
                              if (!projectLocation) return true;
                              // Match by location - handle DTC/Centennial equivalence
                              if (!slot.location) return true;
                              if (slot.location === projectLocation) return true;
                              if ((slot.location === "DTC" || slot.location === "Centennial") &&
                                  (projectLocation === "DTC" || projectLocation === "Centennial")) return true;
                              return false;
                            }) || [];

                            // Group slots by surveyor for cleaner display
                            const slotsBySurveyor: Record<string, typeof matchingSlots> = {};
                            matchingSlots.forEach(slot => {
                              const name = slot.user_name || "Unknown";
                              if (!slotsBySurveyor[name]) slotsBySurveyor[name] = [];
                              slotsBySurveyor[name].push(slot);
                            });

                            return Object.entries(slotsBySurveyor).map(([surveyorName, slots]) => (
                              <div key={surveyorName} className="mb-1">
                                <span className="text-emerald-400 font-medium text-[0.6rem]">{surveyorName}</span>
                                <div className="flex flex-wrap gap-0.5 mt-0.5">
                                  {slots.map((slot, slotIndex) => (
                                    <button
                                      key={`${surveyorName}-${slotIndex}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (selectedProject && !isPast) {
                                          setScheduleModal({
                                            project: selectedProject,
                                            date: dateStr,
                                            slot: {
                                              userName: surveyorName,
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
                                      disabled={!selectedProject || isPast}
                                      className={`text-[0.55rem] px-1 py-0.5 rounded ${
                                        selectedProject && !isPast
                                          ? "bg-emerald-500/10 hover:bg-emerald-500/30 text-emerald-400 cursor-pointer border border-emerald-500/20 hover:border-emerald-500/40"
                                          : "text-emerald-500/50"
                                      }`}
                                      title={selectedProject ? `Book ${surveyorName} at ${slot.display_time || `${slot.start_time}-${slot.end_time}`}` : "Select a project first"}
                                    >
                                      {slot.display_time || formatTime12h(slot.start_time)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ));
                          })()}
                          {/* Show booked slots so users can see what's already scheduled */}
                          {showAvailability && dayAvailability?.bookedSlots && dayAvailability.bookedSlots.length > 0 && (() => {
                            const projectLocation = selectedProject?.location;
                            const matchingBooked = dayAvailability.bookedSlots.filter(slot => {
                              if (!projectLocation) return true;
                              if (!slot.location) return true;
                              if (slot.location === projectLocation) return true;
                              if ((slot.location === "DTC" || slot.location === "Centennial") &&
                                  (projectLocation === "DTC" || projectLocation === "Centennial")) return true;
                              return false;
                            });

                            // Group booked slots by surveyor
                            const bookedBySurveyor: Record<string, typeof matchingBooked> = {};
                            matchingBooked.forEach(slot => {
                              const name = slot.user_name || "Unknown";
                              if (!bookedBySurveyor[name]) bookedBySurveyor[name] = [];
                              bookedBySurveyor[name].push(slot);
                            });

                            return Object.entries(bookedBySurveyor).map(([surveyorName, slots]) => (
                              <div
                                key={`booked-${surveyorName}`}
                                className="text-[0.6rem] leading-tight text-orange-400/60 break-words"
                                title={`Booked: ${surveyorName} - ${slots.map(s => `${s.display_time || s.start_time} (${s.projectName || "Unknown"})`).join(", ")}`}
                              >
                                <span className="text-orange-500/40">⊘</span> <span className="font-medium">{surveyorName}</span>
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
                  <h2 className="text-sm font-semibold">All Site Surveys ({filteredProjects.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-surface">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Project</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Location</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Surveyor</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Scheduled</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">Amount</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-muted uppercase">Links</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-muted uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-t-border">
                      {filteredProjects.map((project) => {
                        const isScheduled = hasActiveSchedule(project, manualSchedules[project.id]);
                        const schedDate = isScheduled ? (manualSchedules[project.id] || project.scheduleDate) : null;
                        const overdue = isSurveyOverdue(project, manualSchedules[project.id]);
                        return (
                          <tr key={project.id} className={`hover:bg-surface/50 ${overdue ? "bg-red-500/5" : ""}`}>
                            <td className="px-4 py-3">
                              <a href={project.hubspotUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-cyan-400">
                                {overdue && <span className="text-red-400 mr-1">⚠</span>}
                                {getCustomerName(project.name)}
                              </a>
                              <div className="text-xs text-muted">{getProjectId(project.name)}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-muted">{project.location}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(project.surveyStatus)}`}>
                                  {project.surveyStatus}
                                </span>
                                {overdue && (
                                  <span className="text-xs px-1.5 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/30 font-medium">
                                    Overdue
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-emerald-400">
                              {project.assignedSurveyor ? (
                                <span>{project.assignedSurveyor}{project.zuperScheduledTime ? <span className="text-muted ml-1">@ {project.zuperScheduledTime}</span> : null}</span>
                              ) : <span className="text-muted/70">—</span>}
                            </td>
                            <td className={`px-4 py-3 text-sm ${overdue ? "text-red-400" : isScheduled ? "text-cyan-400" : "text-muted"}`}>
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
                              {isScheduled ? (
                                <button
                                  onClick={() => cancelSchedule(project.id)}
                                  className="text-xs text-red-400 hover:text-red-300"
                                >
                                  Remove
                                </button>
                              ) : (
                                <button
                                  onClick={() => setSelectedProject(project)}
                                  className="text-xs text-cyan-400 hover:text-cyan-300"
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

      {/* My Availability Modal */}
      {showMyAvailability && (
        <MyAvailability onClose={() => { setShowMyAvailability(false); fetchAvailability(); }} />
      )}

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
                ? "Site Survey Details"
                : scheduleModal.isRescheduling
                  ? "Reschedule Site Survey"
                  : "Schedule Site Survey"}
            </h3>

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

              {scheduleModal.project.address && (
                <div>
                  <span className="text-xs text-muted">Address</span>
                  <p className="text-sm">{scheduleModal.project.address}</p>
                </div>
              )}

              <div>
                <span className="text-xs text-muted">Date</span>
                <p className="text-sm font-medium text-cyan-400">{formatDate(scheduleModal.date)}</p>
              </div>

              {/* Time Slot Display / Selection */}
              {scheduleModal.currentSlot && !scheduleModal.isRescheduling ? (
                /* Show current assignment for already-scheduled surveys */
                <div className="p-3 bg-cyan-900/30 border border-cyan-500/30 rounded-lg">
                  <span className="text-xs text-cyan-400 font-medium">Currently Scheduled</span>
                  <p className="text-sm text-white mt-1">
                    <span className="font-medium">{scheduleModal.currentSlot.userName}</span>
                    <span className="text-muted mx-2">&bull;</span>
                    <span>{scheduleModal.currentSlot.displayTime}</span>
                  </p>
                  <button
                    onClick={() => setScheduleModal({ ...scheduleModal, isRescheduling: true })}
                    className="text-xs text-orange-400 hover:text-orange-300 mt-2"
                  >
                    Reschedule to different time/surveyor
                  </button>
                </div>
              ) : scheduleModal.slot ? (
                /* User has selected a new time slot */
                <div className="p-2 bg-emerald-900/30 border border-emerald-500/30 rounded-lg">
                  <span className="text-xs text-emerald-400 font-medium">
                    {scheduleModal.currentSlot ? "New Time Slot" : "Selected Time Slot"}
                  </span>
                  <p className="text-sm text-white mt-1">
                    {scheduleModal.slot.userName} &bull; {formatTime12h(scheduleModal.slot.startTime)} - {formatTime12h(scheduleModal.slot.endTime)}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    This 1-hour slot will be reserved
                  </p>
                  <button
                    onClick={() => setScheduleModal({ ...scheduleModal, slot: undefined })}
                    className="text-xs text-muted hover:text-foreground mt-1"
                  >
                    Change time slot
                  </button>
                  {scheduleModal.currentSlot && (
                    <button
                      onClick={() => setScheduleModal({ ...scheduleModal, isRescheduling: false, slot: undefined })}
                      className="text-xs text-muted hover:text-foreground mt-1 ml-3"
                    >
                      Cancel reschedule
                    </button>
                  )}
                </div>
              ) : (
                /* Time slot picker for new scheduling or rescheduling */
                <div>
                  <span className="text-xs text-muted">
                    {scheduleModal.isRescheduling ? "Select New Time Slot" : "Select Time Slot"}
                  </span>
                  <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                    {(() => {
                      const dayAvail = availabilityByDate[scheduleModal.date];
                      const projectLocation = scheduleModal.project.location;
                      const availableSlots = dayAvail?.availableSlots?.filter(slot => {
                        if (!projectLocation) return true;
                        if (!slot.location) return true;
                        if (slot.location === projectLocation) return true;
                        if ((slot.location === "DTC" || slot.location === "Centennial") &&
                            (projectLocation === "DTC" || projectLocation === "Centennial")) return true;
                        return false;
                      }) || [];

                      if (availableSlots.length === 0) {
                        return (
                          <p className="text-xs text-muted italic">No available slots for this location on this date</p>
                        );
                      }

                      return availableSlots.map((slot, i) => (
                        <button
                          key={i}
                          onClick={() => setScheduleModal({
                            ...scheduleModal,
                            slot: {
                              userName: slot.user_name || "",
                              userUid: slot.user_uid,
                              teamUid: slot.team_uid, // Include team UID for assignment API
                              startTime: slot.start_time,
                              endTime: slot.end_time,
                              location: slot.location || "",
                              timezone: slot.timezone, // IANA timezone for CA slots
                            }
                          })}
                          className="w-full text-left px-2 py-1.5 text-sm rounded bg-surface-2 hover:bg-emerald-900/30 hover:border-emerald-500/30 border border-transparent transition-colors"
                        >
                          <span className="text-emerald-400">{slot.user_name}</span>
                          <span className="text-muted ml-2">{slot.display_time}</span>
                        </button>
                      ));
                    })()}
                  </div>
                  {scheduleModal.isRescheduling && scheduleModal.currentSlot && (
                    <button
                      onClick={() => setScheduleModal({ ...scheduleModal, isRescheduling: false })}
                      className="text-xs text-muted hover:text-foreground mt-2"
                    >
                      Cancel reschedule
                    </button>
                  )}
                </div>
              )}

              {/* Show locally stored surveyor assignment */}
              {scheduleModal.project.assignedSurveyor && !scheduleModal.currentSlot && !scheduleModal.slot && (
                <div className="p-2 bg-emerald-900/20 border border-emerald-500/20 rounded-lg">
                  <span className="text-xs text-emerald-400 font-medium">Assigned Surveyor</span>
                  <p className="text-sm text-white mt-0.5">{scheduleModal.project.assignedSurveyor}</p>
                </div>
              )}

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

            {/* Zuper Sync Option - only show when scheduling/rescheduling */}
            {zuperConfigured && (scheduleModal.slot || scheduleModal.isRescheduling) && (
              <div className="mb-4 p-3 bg-surface rounded-lg border border-t-border">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncToZuper}
                    onChange={(e) => setSyncToZuper(e.target.checked)}
                    className="w-4 h-4 rounded border-t-border bg-surface-2 text-cyan-500 focus:ring-cyan-500"
                  />
                  <span className="text-sm">Sync to Zuper FSM</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={useTestSlot}
                    onChange={(e) => setUseTestSlot(e.target.checked)}
                    className="w-4 h-4 rounded border-t-border bg-surface-2 text-amber-500 focus:ring-amber-500"
                  />
                  <span className="text-sm">Test slot (assign to me)</span>
                </label>
                {syncToZuper && (
                  <p className="text-xs text-yellow-500 mt-2">
                    {useTestSlot
                      ? "Test mode: assigned to your user, crew notification emails are suppressed."
                      : "Customer will receive SMS/Email notification"}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              {scheduleModal.currentSlot && !scheduleModal.isRescheduling && !scheduleModal.slot ? (
                /* Viewing mode - show Close and Remove buttons */
                <>
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
                  <button
                    onClick={() => setScheduleModal(null)}
                    className="px-4 py-2 text-sm bg-surface-2 hover:bg-zinc-600 rounded-lg font-medium"
                  >
                    Close
                  </button>
                </>
              ) : (
                /* Scheduling or rescheduling mode */
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
                    className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-700 rounded-lg font-medium disabled:opacity-50"
                  >
                    {syncingToZuper ? "Syncing..." : scheduleModal.isRescheduling ? "Confirm Reschedule" : "Confirm Schedule"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
