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
  siteSurveyStatus?: string;
  siteSurveyCompletionDate?: string;
  closeDate?: string;
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
}

interface PendingSchedule {
  project: SurveyProject;
  date: string;
}

interface AssistedSlot {
  date: string;
  start_time: string;
  end_time: string;
  user_uid?: string;
  user_name?: string;
  team_uid?: string;
  team_name?: string;
  available: boolean;
}

interface DayAvailability {
  date: string;
  availableSlots: Array<{
    start_time: string;
    end_time: string;
    user_uid?: string;
    user_name?: string;
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

const SURVEY_STATUSES = [
  "Ready to Schedule",
  "Awaiting Reply",
  "Scheduled",
  "On Our Way",
  "Started",
  "In Progress",
  "Needs Revisit",
  "Completed",
  "Scheduling On-Hold",
];

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
  };
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function SiteSurveySchedulerPage() {
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
  const [selectedStatus, setSelectedStatus] = useState("all");
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
  const [syncToZuper, setSyncToZuper] = useState(true);
  const [syncingToZuper, setSyncingToZuper] = useState(false);

  /* ---- Assisted scheduling ---- */
  const [availableSlots, setAvailableSlots] = useState<AssistedSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AssistedSlot | null>(null);
  const [availabilityByDate, setAvailabilityByDate] = useState<Record<string, DayAvailability>>({});
  const [showAvailability, setShowAvailability] = useState(true);

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
      const response = await fetch("/api/projects?context=scheduling");
      if (!response.ok) throw new Error("Failed to fetch projects");
      const data = await response.json();
      const transformed = data.projects
        .map((p: RawProject) => transformProject(p))
        .filter((p: SurveyProject | null): p is SurveyProject => p !== null);
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
      } catch {
        setZuperConfigured(false);
      }
    }
    checkZuper();
  }, []);

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

  const filteredProjects = useMemo(() => {
    let filtered = projects.filter((p) => {
      // Multi-select location filter - if any selected, filter by them
      if (selectedLocations.length > 0 && !selectedLocations.includes(p.location)) return false;
      if (selectedStatus !== "all" && p.surveyStatus !== selectedStatus) return false;
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
  }, [projects, selectedLocations, selectedStatus, searchText, sortBy, manualSchedules]);

  const unscheduledProjects = useMemo(() => {
    return filteredProjects.filter(p =>
      !p.scheduleDate &&
      !manualSchedules[p.id] &&
      !p.completionDate &&
      p.surveyStatus !== "Completed"
    );
  }, [filteredProjects, manualSchedules]);

  const scheduledProjects = useMemo(() => {
    return filteredProjects.filter(p =>
      p.scheduleDate || manualSchedules[p.id]
    );
  }, [filteredProjects, manualSchedules]);

  const stats = useMemo(() => {
    const total = projects.length;
    const needsScheduling = projects.filter(p =>
      !p.scheduleDate && !manualSchedules[p.id] && !p.completionDate
    ).length;
    const scheduled = projects.filter(p =>
      (p.scheduleDate || manualSchedules[p.id]) && !p.completionDate
    ).length;
    const completed = projects.filter(p => p.completionDate).length;
    const totalValue = projects.reduce((sum, p) => sum + p.amount, 0);

    return { total, needsScheduling, scheduled, completed, totalValue };
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

  const handleDrop = useCallback((date: string) => {
    if (!draggedProjectId) return;
    const project = projects.find(p => p.id === draggedProjectId);
    if (project) {
      setScheduleModal({ project, date });
    }
    setDraggedProjectId(null);
  }, [draggedProjectId, projects]);

  const handleDateClick = useCallback((date: string, project?: SurveyProject) => {
    if (project) {
      setScheduleModal({ project, date });
    } else if (selectedProject) {
      setScheduleModal({ project: selectedProject, date });
      setSelectedProject(null);
    }
  }, [selectedProject]);

  const confirmSchedule = useCallback(async () => {
    if (!scheduleModal) return;
    const { project, date } = scheduleModal;

    setManualSchedules((prev) => ({
      ...prev,
      [project.id]: date,
    }));

    // Sync to Zuper if enabled
    if (zuperConfigured && syncToZuper) {
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
            },
            schedule: {
              type: "survey",
              date: date,
              days: 0.25, // Site surveys are typically ~2 hours
              notes: "Scheduled via Site Survey Scheduler",
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
    } else {
      showToast(`${getCustomerName(project.name)} scheduled for ${formatDate(date)}`);
    }

    setScheduleModal(null);
  }, [scheduleModal, zuperConfigured, syncToZuper, showToast]);

  const cancelSchedule = useCallback((projectId: string) => {
    setManualSchedules((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    showToast("Schedule removed");
  }, [showToast]);

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
    return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  };

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mx-auto mb-4" />
          <p className="text-zinc-400">Loading Site Surveys...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-2">Error loading data</p>
          <p className="text-zinc-500 text-sm mb-4">{error}</p>
          <button onClick={fetchProjects} className="px-4 py-2 bg-cyan-600 rounded-lg hover:bg-cyan-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const todayStr = getTodayStr();

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[9999] px-4 py-3 rounded-lg shadow-lg ${
          toast.type === "warning" ? "bg-yellow-600" : "bg-green-600"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0a0a0f]/95 backdrop-blur border-b border-zinc-800">
        <div className="max-w-[1800px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboards" className="text-zinc-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-cyan-400">Site Survey Scheduler</h1>
              <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
                {stats.total} surveys
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* View Toggle */}
              <div className="flex bg-zinc-900 rounded-lg p-0.5">
                <button
                  onClick={() => setCurrentView("calendar")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "calendar" ? "bg-cyan-600 text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Calendar
                </button>
                <button
                  onClick={() => setCurrentView("list")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    currentView === "list" ? "bg-cyan-600 text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  List
                </button>
              </div>

              <button onClick={fetchProjects} className="p-2 hover:bg-zinc-800 rounded-lg">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex items-center gap-6 mt-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Ready:</span>
              <span className="text-cyan-400 font-semibold">{stats.needsScheduling}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Scheduled:</span>
              <span className="text-blue-400 font-semibold">{stats.scheduled}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Completed:</span>
              <span className="text-green-400 font-semibold">{stats.completed}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Value:</span>
              <span className="text-orange-400 font-semibold">{formatCurrency(stats.totalValue)}</span>
            </div>
          </div>

          {/* Filters Row */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <input
              type="text"
              placeholder="Search projects..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-cyan-500 w-48"
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
                      ? "bg-cyan-600 border-cyan-500 text-white"
                      : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  {loc.replace("Colorado Springs", "CO Spgs").replace("San Luis Obispo", "SLO")}
                </button>
              ))}
              {selectedLocations.length > 0 && (
                <button
                  onClick={() => setSelectedLocations([])}
                  className="px-2 py-1 text-xs text-zinc-500 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Statuses</option>
              {SURVEY_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-cyan-500"
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
                    : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-600"
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
            <div className="sticky top-[180px] bg-[#12121a] border border-zinc-800 rounded-xl overflow-hidden">
              <div className="p-3 border-b border-zinc-800 bg-zinc-900/50">
                <h2 className="text-sm font-semibold text-cyan-400">
                  Ready to Schedule ({unscheduledProjects.length})
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Drag to calendar or click to select
                </p>
              </div>
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                {unscheduledProjects.length === 0 ? (
                  <div className="p-4 text-center text-zinc-500 text-sm">
                    No projects need scheduling
                  </div>
                ) : (
                  unscheduledProjects.map((project) => (
                    <div
                      key={project.id}
                      draggable
                      onDragStart={() => handleDragStart(project.id)}
                      onClick={() => setSelectedProject(selectedProject?.id === project.id ? null : project)}
                      className={`p-3 border-b border-zinc-800 cursor-pointer hover:bg-zinc-800/50 transition-colors ${
                        selectedProject?.id === project.id ? "bg-cyan-900/20 border-l-2 border-l-cyan-500" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">
                            {getCustomerName(project.name)}
                          </p>
                          <p className="text-xs text-zinc-500 truncate">
                            {getProjectId(project.name)}
                          </p>
                          <p className="text-xs text-zinc-500 truncate mt-0.5">
                            {project.location}
                          </p>
                        </div>
                        <span className="text-xs font-mono text-orange-400 ml-2">
                          {formatCurrency(project.amount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${getStatusColor(project.surveyStatus)}`}>
                          {project.surveyStatus}
                        </span>
                        {project.systemSize > 0 && (
                          <span className="text-xs text-zinc-500">
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
              <div className="bg-[#12121a] border border-zinc-800 rounded-xl overflow-hidden">
                {/* Calendar Header */}
                <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button onClick={goToPrevMonth} className="p-1.5 hover:bg-zinc-800 rounded">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="text-lg font-semibold min-w-[180px] text-center">
                      {MONTH_NAMES[currentMonth]} {currentYear}
                    </span>
                    <button onClick={goToNextMonth} className="p-1.5 hover:bg-zinc-800 rounded">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  <button onClick={goToToday} className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded">
                    Today
                  </button>
                  {/* Availability Legend */}
                  {showAvailability && zuperConfigured && (
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full" />
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
                <div className="grid grid-cols-7 border-b border-zinc-800">
                  {DAY_NAMES.map((day) => (
                    <div key={day} className="p-2 text-center text-xs font-medium text-zinc-500">
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
                        className={`min-h-[100px] p-1.5 border-b border-r border-zinc-800 cursor-pointer transition-colors ${
                          isCurrentMonth ? "" : "opacity-40"
                        } ${weekend ? "bg-zinc-900/30" : ""} ${
                          isToday ? "bg-cyan-900/20" : ""
                        } ${selectedProject ? "hover:bg-cyan-900/10" : "hover:bg-zinc-800/50"} ${
                          showAvailability && hasAvailability && selectedProject
                            ? "ring-2 ring-inset ring-emerald-500/30 bg-emerald-900/10"
                            : ""
                        } ${
                          showAvailability && isFullyBooked && selectedProject && !weekend
                            ? "ring-2 ring-inset ring-red-500/20 bg-red-900/5"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-medium ${
                            isToday ? "text-cyan-400" : "text-zinc-500"
                          }`}>
                            {parseInt(dateStr.split("-")[2])}
                          </span>
                          {/* Availability indicator */}
                          {showAvailability && zuperConfigured && isCurrentMonth && !weekend && (
                            <div className="flex items-center gap-0.5">
                              {loadingSlots ? (
                                <div className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" />
                              ) : hasAvailability ? (
                                <div className="flex items-center gap-0.5" title={`${slotCount} slot${slotCount !== 1 ? "s" : ""} available`}>
                                  <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                                  {slotCount > 1 && (
                                    <span className="text-[0.55rem] text-emerald-400">{slotCount}</span>
                                  )}
                                </div>
                              ) : isFullyBooked ? (
                                <div className="w-2 h-2 bg-red-500/60 rounded-full" title="Fully booked" />
                              ) : dayAvailability ? (
                                <div className="w-2 h-2 bg-yellow-500/60 rounded-full" title="Limited availability" />
                              ) : null}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          {events.slice(0, 3).map((ev) => (
                            <div
                              key={ev.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setScheduleModal({ project: ev, date: dateStr });
                              }}
                              className="text-xs p-1 rounded bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 truncate cursor-pointer hover:bg-cyan-500/30"
                            >
                              {getCustomerName(ev.name)}
                            </div>
                          ))}
                          {events.length > 3 && (
                            <div className="text-xs text-zinc-500 pl-1">
                              +{events.length - 3} more
                            </div>
                          )}
                          {/* Show available user names when project selected */}
                          {showAvailability && selectedProject && hasAvailability && dayAvailability?.availableSlots?.slice(0, 2).map((slot, i) => (
                            slot.user_name && (
                              <div key={i} className="text-[0.55rem] text-emerald-400/70 truncate">
                                {slot.user_name}
                              </div>
                            )
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* List View */
              <div className="bg-[#12121a] border border-zinc-800 rounded-xl overflow-hidden">
                <div className="p-3 border-b border-zinc-800">
                  <h2 className="text-sm font-semibold">All Site Surveys ({filteredProjects.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-zinc-900">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Project</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Location</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Scheduled</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-zinc-400 uppercase">Amount</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-zinc-400 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {filteredProjects.map((project) => {
                        const schedDate = manualSchedules[project.id] || project.scheduleDate;
                        return (
                          <tr key={project.id} className="hover:bg-zinc-900/50">
                            <td className="px-4 py-3">
                              <a href={project.hubspotUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-white hover:text-cyan-400">
                                {getCustomerName(project.name)}
                              </a>
                              <div className="text-xs text-zinc-500">{getProjectId(project.name)}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-zinc-400">{project.location}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(project.surveyStatus)}`}>
                                {project.surveyStatus}
                              </span>
                            </td>
                            <td className={`px-4 py-3 text-sm ${schedDate ? "text-cyan-400" : "text-zinc-500"}`}>
                              {schedDate ? formatShortDate(schedDate) : "—"}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-sm text-orange-400">
                              {formatCurrency(project.amount)}
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

      {/* Schedule Modal */}
      {scheduleModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setScheduleModal(null);
          }}
        >
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5 max-w-md w-[90%]">
            <h3 className="text-lg font-semibold mb-4">Schedule Site Survey</h3>

            <div className="space-y-3 mb-4">
              <div>
                <span className="text-xs text-zinc-500">Project</span>
                <p className="text-sm font-medium">{getCustomerName(scheduleModal.project.name)}</p>
                <p className="text-xs text-zinc-500">{getProjectId(scheduleModal.project.name)}</p>
              </div>

              <div>
                <span className="text-xs text-zinc-500">Location</span>
                <p className="text-sm">{scheduleModal.project.location}</p>
              </div>

              <div>
                <span className="text-xs text-zinc-500">Date</span>
                <p className="text-sm font-medium text-cyan-400">{formatDate(scheduleModal.date)}</p>
              </div>

              <div>
                <span className="text-xs text-zinc-500">Amount</span>
                <p className="text-sm font-mono text-orange-400">{formatCurrency(scheduleModal.project.amount)}</p>
              </div>
            </div>

            {/* Zuper Sync Option */}
            {zuperConfigured && (
              <div className="mb-4 p-3 bg-zinc-900 rounded-lg border border-zinc-800">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncToZuper}
                    onChange={(e) => setSyncToZuper(e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-cyan-500"
                  />
                  <span className="text-sm">Sync to Zuper FSM</span>
                </label>
                {syncToZuper && (
                  <p className="text-xs text-yellow-500 mt-2">
                    Customer will receive SMS/Email notification
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setScheduleModal(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={confirmSchedule}
                disabled={syncingToZuper}
                className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-700 rounded-lg font-medium disabled:opacity-50"
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
