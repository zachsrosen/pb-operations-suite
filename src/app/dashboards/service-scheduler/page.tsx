"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { toDateStr } from "@/lib/scheduling-utils";
import { getInternalDealUrl } from "@/lib/external-links";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ZuperJob {
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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_UIDS = [
  "cff6f839-c043-46ee-a09f-8d0e9f363437", // Service Visit
  "8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de", // Service Revisit
];

const CATEGORY_COLORS: Record<string, string> = {
  "Service Visit": "bg-emerald-500",
  "Service Revisit": "bg-amber-500",
};

const CATEGORY_TEXT_COLORS: Record<string, string> = {
  "Service Visit": "text-emerald-400",
  "Service Revisit": "text-amber-400",
};

/* ------------------------------------------------------------------ */
/*  Status colors (per ticket #359 — consistent across categories)    */
/* ------------------------------------------------------------------ */
/* Single source of truth: status drives FILL color.                   */
/* Category is conveyed via the left border stripe on each tile.       */

interface StatusColorTokens {
  bg: string;
  border: string;
  text: string;
}

const STATUS_COLORS: Record<string, StatusColorTokens> = {
  // Pre-work
  "new":         { bg: "bg-blue-500/20",    border: "border-blue-500/30",    text: "text-blue-300" },
  "unscheduled": { bg: "bg-slate-500/20",   border: "border-slate-500/30",   text: "text-slate-300" },
  // Dispatch
  "scheduled":   { bg: "bg-cyan-500/20",    border: "border-cyan-500/30",    text: "text-cyan-300" },
  "dispatched":  { bg: "bg-cyan-500/20",    border: "border-cyan-500/30",    text: "text-cyan-300" },
  // Active
  "started":     { bg: "bg-purple-500/20",  border: "border-purple-500/30",  text: "text-purple-300" },
  "in progress": { bg: "bg-purple-500/20",  border: "border-purple-500/30",  text: "text-purple-300" },
  "in_progress": { bg: "bg-purple-500/20",  border: "border-purple-500/30",  text: "text-purple-300" },
  "on the way":  { bg: "bg-fuchsia-500/20", border: "border-fuchsia-500/30", text: "text-fuchsia-300" },
  "enroute":     { bg: "bg-fuchsia-500/20", border: "border-fuchsia-500/30", text: "text-fuchsia-300" },
  // Paused / blocked
  "on hold":     { bg: "bg-amber-500/20",   border: "border-amber-500/30",   text: "text-amber-300" },
  "hold":        { bg: "bg-amber-500/20",   border: "border-amber-500/30",   text: "text-amber-300" },
  "incomplete":  { bg: "bg-orange-500/20",  border: "border-orange-500/30",  text: "text-orange-300" },
  "return visit required": { bg: "bg-amber-500/20", border: "border-amber-500/30", text: "text-amber-300" },
  // Done
  "completed":   { bg: "bg-emerald-500/20", border: "border-emerald-500/30", text: "text-emerald-300" },
  "complete":    { bg: "bg-emerald-500/20", border: "border-emerald-500/30", text: "text-emerald-300" },
  "closed":      { bg: "bg-emerald-500/20", border: "border-emerald-500/30", text: "text-emerald-300" },
  // Killed
  "cancelled":   { bg: "bg-zinc-500/20",    border: "border-zinc-500/30",    text: "text-zinc-300" },
  "canceled":    { bg: "bg-zinc-500/20",    border: "border-zinc-500/30",    text: "text-zinc-300" },
};

const DEFAULT_STATUS_COLOR: StatusColorTokens = {
  bg: "bg-surface-2",
  border: "border-t-border",
  text: "text-foreground/80",
};

const OVERDUE_STATUS_COLOR: StatusColorTokens = {
  bg: "bg-red-500/20",
  border: "border-red-500/40",
  text: "text-red-300",
};

function getStatusColor(statusName: string | null | undefined): StatusColorTokens {
  const key = (statusName || "").toLowerCase().trim();
  return STATUS_COLORS[key] ?? DEFAULT_STATUS_COLOR;
}

/** Left-edge stripe color identifying the job category. */
const CATEGORY_STRIPE: Record<string, string> = {
  "Service Visit": "border-l-emerald-500",
  "Service Revisit": "border-l-amber-500",
};

function getCategoryStripe(categoryName: string): string {
  return CATEGORY_STRIPE[categoryName] ?? "border-l-slate-500";
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(isoStr: string | null): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatScheduledDateTime(isoStr: string | null): string {
  if (!isoStr) return "Not scheduled";
  const d = new Date(isoStr);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

function getCustomerName(title: string): string {
  // "PROJ-1234 | LastName, FirstName | 123 Main St..." → "LastName, FirstName"
  const parts = title.split(" | ");
  return parts[1] || parts[0] || title;
}

function getAssignees(j: { assignedUsers?: string[]; assignedUser?: string }): string[] {
  if (Array.isArray(j.assignedUsers) && j.assignedUsers.length > 0) return j.assignedUsers;
  return j.assignedUser ? [j.assignedUser] : [];
}

// ── Job state classification ────────────────────────────────────────────────
// Matches the master scheduler's mutually-exclusive scheme: a job is in exactly
// one of {scheduled, overdue, completed} — used by the three calendar toggles.

type JobState = "scheduled" | "overdue" | "completed";

// Heuristic: Zuper doesn't expose a single "is terminal" flag for service-job
// status workflows, so match on name. Covers "Completed", "Closed",
// "Cancelled/Canceled", "Job Complete", "Done", "Invoiced". Errs toward
// "completed" only when the status name clearly says so.
function isJobCompleted(j: { statusName?: string | null }): boolean {
  const name = (j.statusName || "").toLowerCase();
  if (!name) return false;
  return /(complete|closed|cancel|invoiced|\bdone\b)/.test(name);
}

// Overdue: scheduled time (or due date, for unscheduled jobs) is strictly
// before the start of today AND the job is not already completed. Matches the
// master scheduler's survey/inspection rule ("overdue the day after the
// scheduled date").
function isJobOverdue(j: ZuperJob, now: Date): boolean {
  if (isJobCompleted(j)) return false;
  const ref = j.scheduledEnd || j.scheduledStart || j.dueDate;
  if (!ref) return false;
  const refDate = new Date(ref);
  if (Number.isNaN(refDate.getTime())) return false;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return refDate < startOfToday;
}

function getJobState(j: ZuperJob, now: Date): JobState {
  if (isJobCompleted(j)) return "completed";
  if (isJobOverdue(j, now)) return "overdue";
  return "scheduled";
}

const ZUPER_WEB_BASE = "https://web.zuperpro.com";

function TypeBadge({
  type,
  size = "md",
  objectId,
  portalId,
}: {
  type: "deal" | "ticket" | null | undefined;
  size?: "sm" | "md";
  objectId?: string;
  portalId?: string;
}) {
  if (!type) return null;
  const sizeClass = size === "sm" ? "text-[0.45rem] px-1 py-0" : "text-[0.5rem] px-1 py-0.5";
  const isDeal = type === "deal";
  const colorClass = isDeal
    ? "bg-purple-500/25 text-purple-300 border border-purple-500/40 hover:bg-purple-500/40 hover:text-purple-100"
    : "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/40 hover:text-cyan-100";
  const label = isDeal ? "Deal" : "Ticket";
  const baseClass = `${sizeClass} rounded font-semibold uppercase tracking-wider ${colorClass}`;

  // If we have enough info to link directly to the HubSpot record, render an
  // anchor so users can open the deal/ticket from the calendar tile without
  // having to open the job modal first.
  if (objectId && portalId) {
    const href = isDeal
      ? `https://app.hubspot.com/contacts/${portalId}/record/0-3/${objectId}`
      : `https://app.hubspot.com/contacts/${portalId}/ticket/${objectId}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${baseClass} transition-colors`}
        title={`Open HubSpot ${label}`}
      >
        {label}
      </a>
    );
  }
  return <span className={baseClass}>{label}</span>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ServiceSchedulerPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // Data
  const [jobs, setJobs] = useState<ZuperJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Calendar state
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [viewMode, setViewMode] = useState<"month" | "week" | "day">("month");
  // Anchor date used by week and day views (YYYY-MM-DD)
  const [anchorDate, setAnchorDate] = useState<string>(toDateStr(today));

  // Filters
  const [searchText, setSearchText] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  // Three-way job-state toggles (match master scheduler): scheduled / overdue / completed.
  // Default: scheduled + overdue on, completed off — otherwise old jobs crowd the calendar.
  const [showScheduled, setShowScheduled] = useState(true);
  const [showOverdue, setShowOverdue] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ZuperJob | null>(null);
  const [primaryContactId, setPrimaryContactId] = useState<string | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const contactCacheRef = useRef<Record<string, string | null>>({});
  // HubSpot object-type resolution (deal vs ticket) for the id stored on each job
  const [objectTypes, setObjectTypes] = useState<Record<string, "deal" | "ticket" | null>>({});
  const typeCacheRef = useRef<Record<string, "deal" | "ticket" | null>>({});
  const hubspotPortalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "";

  // Fetch data
  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch 3 months of data around current month
      const fromDate = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`;
      const endMonth = new Date(currentYear, currentMonth + 2, 0);
      const toDate = toDateStr(endMonth);
      const res = await fetch(
        `/api/zuper/jobs/by-category?categories=${CATEGORY_UIDS.join(",")}&from_date=${fromDate}&to_date=${toDate}&limit=500`
      );
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [currentMonth, currentYear]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("service-scheduler", { projectCount: jobs.length });
    }
  }, [loading, jobs.length, trackDashboardView]);

  // Bulk-resolve HubSpot object types (deal vs ticket) for every job that carries an id.
  // The Zuper external_id.hubspot_deal field stores EITHER a deal id OR a ticket id.
  useEffect(() => {
    if (jobs.length === 0) return;
    const ids = Array.from(new Set(
      jobs.map((j) => j.hubspotDealId).filter((id) => id && /^\d+$/.test(id))
    ));
    const uncached = ids.filter((id) => !(id in typeCacheRef.current));
    if (uncached.length === 0) {
      // Still publish cached values to state so UI has them
      setObjectTypes({ ...typeCacheRef.current });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/hubspot/object-resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: uncached }),
        });
        if (!res.ok) return;
        const data = await res.json() as { types: Record<string, "deal" | "ticket" | null> };
        for (const id of uncached) {
          typeCacheRef.current[id] = data.types?.[id] ?? null;
        }
        if (!cancelled) setObjectTypes({ ...typeCacheRef.current });
      } catch (err) {
        console.warn("[service-scheduler] object-resolve failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [jobs]);

  // Lazy-fetch primary contact id when a job modal opens (type-aware)
  const selectedObjectType = selectedJob ? objectTypes[selectedJob.hubspotDealId] ?? null : null;
  useEffect(() => {
    const objectId = selectedJob?.hubspotDealId;
    if (!objectId) {
      setPrimaryContactId(null);
      return;
    }
    // Wait for type resolution before fetching contact; unresolved type = no contact path.
    const type = objectTypes[objectId];
    if (!type) {
      setPrimaryContactId(null);
      return;
    }
    const cacheKey = `${type}:${objectId}`;
    if (cacheKey in contactCacheRef.current) {
      setPrimaryContactId(contactCacheRef.current[cacheKey]);
      return;
    }
    let cancelled = false;
    setContactLoading(true);
    setPrimaryContactId(null);
    (async () => {
      try {
        const res = await fetch(`/api/deals/${objectId}/primary-contact?type=${type}`);
        const data = res.ok ? await res.json() : { contactId: null };
        const id = (data?.contactId ?? null) as string | null;
        contactCacheRef.current[cacheKey] = id;
        if (!cancelled) setPrimaryContactId(id);
      } catch {
        if (!cancelled) setPrimaryContactId(null);
      } finally {
        if (!cancelled) setContactLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedJob, objectTypes]);

  // Derived data
  const uniqueStatuses = useMemo(() => {
    const s = new Set(jobs.map(j => j.statusName).filter(Boolean));
    return Array.from(s).sort();
  }, [jobs]);

  const uniqueAssignees = useMemo(() => {
    const s = new Set<string>();
    for (const j of jobs) {
      for (const a of getAssignees(j)) s.add(a);
    }
    return Array.from(s).sort();
  }, [jobs]);

  // "Now" reference for overdue computation. Recomputed on every render but
  // stable within a single pass — good enough; the scheduler doesn't need
  // second-level precision.
  const nowRef = useMemo(() => new Date(), []);

  // Classify each job once up-front so the state is reused by filter + counts
  // + tile styling without re-running the regex per render path.
  const jobsWithState = useMemo(() => {
    return jobs.map((j) => ({ job: j, state: getJobState(j, nowRef) }));
  }, [jobs, nowRef]);

  const filteredJobs = useMemo(() => {
    return jobsWithState
      .filter(({ job: j, state }) => {
        // State toggles (applied first so overdue-only / completed-only views
        // don't have to pass the other filters to get counted).
        if (state === "scheduled" && !showScheduled) return false;
        if (state === "overdue" && !showOverdue) return false;
        if (state === "completed" && !showCompleted) return false;

        const assignees = getAssignees(j);
        if (searchText) {
          const q = searchText.toLowerCase();
          const matchesAssignee = assignees.some(a => a.toLowerCase().includes(q));
          if (!j.title.toLowerCase().includes(q) &&
              !j.customerName.toLowerCase().includes(q) &&
              !j.address.toLowerCase().includes(q) &&
              !matchesAssignee) return false;
        }
        if (selectedCategories.length > 0 && !selectedCategories.includes(j.categoryName)) return false;
        if (selectedLocations.length > 0 && !selectedLocations.includes(j.teamName)) return false;
        if (selectedStatuses.length > 0 && !selectedStatuses.includes(j.statusName)) return false;
        if (selectedAssignees.length > 0) {
          if (selectedAssignees.includes("__unassigned__")) {
            if (assignees.length > 0 && !assignees.some(a => selectedAssignees.includes(a))) return false;
          } else {
            if (!assignees.some(a => selectedAssignees.includes(a))) return false;
          }
        }
        return true;
      })
      .map(({ job }) => job);
  }, [
    jobsWithState,
    searchText,
    selectedCategories,
    selectedLocations,
    selectedStatuses,
    selectedAssignees,
    showScheduled,
    showOverdue,
    showCompleted,
  ]);

  // Quick lookup of state by job uid (for tile styling without re-running regex).
  const jobStateByUid = useMemo(() => {
    const map: Record<string, JobState> = {};
    for (const { job, state } of jobsWithState) map[job.jobUid] = state;
    return map;
  }, [jobsWithState]);

  // Counts for toggle badges. Based on the filter-eligible pool MINUS the
  // state filter itself (so toggling one state doesn't zero its own count).
  const stateCounts = useMemo(() => {
    const base = jobsWithState.filter(({ job: j }) => {
      const assignees = getAssignees(j);
      if (searchText) {
        const q = searchText.toLowerCase();
        const matchesAssignee = assignees.some(a => a.toLowerCase().includes(q));
        if (!j.title.toLowerCase().includes(q) &&
            !j.customerName.toLowerCase().includes(q) &&
            !j.address.toLowerCase().includes(q) &&
            !matchesAssignee) return false;
      }
      if (selectedCategories.length > 0 && !selectedCategories.includes(j.categoryName)) return false;
      if (selectedLocations.length > 0 && !selectedLocations.includes(j.teamName)) return false;
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(j.statusName)) return false;
      if (selectedAssignees.length > 0) {
        if (selectedAssignees.includes("__unassigned__")) {
          if (assignees.length > 0 && !assignees.some(a => selectedAssignees.includes(a))) return false;
        } else {
          if (!assignees.some(a => selectedAssignees.includes(a))) return false;
        }
      }
      return true;
    });
    return {
      scheduled: base.filter((e) => e.state === "scheduled").length,
      overdue: base.filter((e) => e.state === "overdue").length,
      completed: base.filter((e) => e.state === "completed").length,
    };
  }, [
    jobsWithState,
    searchText,
    selectedCategories,
    selectedLocations,
    selectedStatuses,
    selectedAssignees,
  ]);

  // Calendar data
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
      const last = new Date(days[days.length - 1] + "T12:00:00");
      last.setDate(last.getDate() + 1);
      days.push(toDateStr(last));
    }
    return days;
  }, [currentYear, currentMonth]);

  const jobsByDate = useMemo(() => {
    const map: Record<string, ZuperJob[]> = {};
    filteredJobs.forEach(j => {
      if (!j.scheduledStart) return;
      const dateStr = j.scheduledStart.substring(0, 10);
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(j);
    });
    for (const date of Object.keys(map)) {
      map[date].sort((a, b) =>
        (a.scheduledStart || "").localeCompare(b.scheduledStart || "")
      );
    }
    return map;
  }, [filteredJobs]);

  // Stats
  const stats = useMemo(() => {
    const total = filteredJobs.length;
    const scheduled = filteredJobs.filter(j => j.scheduledStart).length;
    const unscheduled = total - scheduled;
    const byCategory: Record<string, number> = {};
    filteredJobs.forEach(j => {
      byCategory[j.categoryName] = (byCategory[j.categoryName] || 0) + 1;
    });
    return { total, scheduled, unscheduled, byCategory };
  }, [filteredJobs]);

  // Navigation
  const todayStr = toDateStr(today);

  const shiftAnchor = (days: number) => {
    const [y, m, d] = anchorDate.split("-").map(Number);
    const next = new Date(y, m - 1, d);
    next.setDate(next.getDate() + days);
    const str = toDateStr(next);
    setAnchorDate(str);
    setCurrentMonth(next.getMonth());
    setCurrentYear(next.getFullYear());
  };

  const goPrev = () => {
    if (viewMode === "month") {
      if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); }
      else setCurrentMonth(currentMonth - 1);
    } else if (viewMode === "week") {
      shiftAnchor(-7);
    } else {
      shiftAnchor(-1);
    }
  };
  const goNext = () => {
    if (viewMode === "month") {
      if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); }
      else setCurrentMonth(currentMonth + 1);
    } else if (viewMode === "week") {
      shiftAnchor(7);
    } else {
      shiftAnchor(1);
    }
  };
  const goToToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
    setAnchorDate(todayStr);
  };

  // Derived ranges for week/day views
  const weekDays = useMemo(() => {
    const [y, m, d] = anchorDate.split("-").map(Number);
    const anchor = new Date(y, m - 1, d);
    // Monday-start week (matches DAY_NAMES)
    const dow = anchor.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(y, m - 1, d + mondayOffset);
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(monday);
      dt.setDate(monday.getDate() + i);
      days.push(toDateStr(dt));
    }
    return days;
  }, [anchorDate]);

  const formatDateLabel = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
  };

  // Title shown in the calendar header
  const headerTitle = useMemo(() => {
    if (viewMode === "month") return `${MONTH_NAMES[currentMonth]} ${currentYear}`;
    if (viewMode === "week") {
      const first = weekDays[0];
      const last = weekDays[6];
      const [, fm, fd] = first.split("-").map(Number);
      const [ly, lm, ld] = last.split("-").map(Number);
      return `${MONTH_NAMES[fm - 1].slice(0, 3)} ${fd} – ${MONTH_NAMES[lm - 1].slice(0, 3)} ${ld}, ${ly}`;
    }
    return formatDateLabel(anchorDate);
  }, [viewMode, currentMonth, currentYear, weekDays, anchorDate]);

  const toggleFilter = (arr: string[], val: string, setter: (v: string[]) => void) => {
    setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-t-border bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/suites/service"
            className="text-muted hover:text-foreground text-sm transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-base font-bold">Service Schedule</h1>
          <span className="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded-full">
            {stats.total} jobs
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchJobs}
            disabled={loading}
            className="text-xs text-muted hover:text-foreground px-2 py-1 rounded border border-t-border hover:border-muted transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[280px] shrink-0 border-r border-t-border flex flex-col overflow-hidden max-[900px]:hidden">
          <div className="p-3 space-y-2 border-b border-t-border">
            {/* Search */}
            <input
              type="text"
              placeholder="Search jobs..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full bg-background border border-t-border text-foreground/90 px-2 py-1.5 rounded-md text-[0.7rem] focus:outline-none focus:border-emerald-500 placeholder:text-muted/70"
            />
            {/* Category filters */}
            <div className="flex flex-wrap gap-1">
              {["Service Visit", "Service Revisit"].map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleFilter(selectedCategories, cat, setSelectedCategories)}
                  className={`px-2 py-1 text-[0.6rem] rounded border transition-colors ${
                    selectedCategories.includes(cat)
                      ? `${CATEGORY_COLORS[cat]} border-transparent text-black`
                      : "bg-background border-t-border text-muted hover:border-muted"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {/* Location filters */}
            <div className="flex flex-wrap gap-1">
              {LOCATIONS.map(loc => (
                <button
                  key={loc}
                  onClick={() => toggleFilter(selectedLocations, loc, setSelectedLocations)}
                  className={`px-1.5 py-0.5 text-[0.6rem] rounded border transition-colors ${
                    selectedLocations.includes(loc)
                      ? "bg-emerald-500 border-emerald-400 text-black"
                      : "bg-background border-t-border text-muted hover:border-muted"
                  }`}
                >
                  {loc.replace("Colorado Springs", "CO Spgs").replace("San Luis Obispo", "SLO")}
                </button>
              ))}
              {selectedLocations.length > 0 && (
                <button onClick={() => setSelectedLocations([])} className="px-1.5 py-0.5 text-[0.6rem] text-muted hover:text-foreground">
                  Clear
                </button>
              )}
            </div>
            {/* Status filters */}
            {uniqueStatuses.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {uniqueStatuses.map(status => (
                  <button
                    key={status}
                    onClick={() => toggleFilter(selectedStatuses, status, setSelectedStatuses)}
                    className={`px-1.5 py-0.5 text-[0.6rem] rounded border transition-colors ${
                      selectedStatuses.includes(status)
                        ? "bg-surface-2 border-muted text-foreground"
                        : "bg-background border-t-border text-muted hover:border-muted"
                    }`}
                  >
                    {status}
                  </button>
                ))}
                {selectedStatuses.length > 0 && (
                  <button onClick={() => setSelectedStatuses([])} className="px-1.5 py-0.5 text-[0.6rem] text-muted hover:text-foreground">
                    Clear
                  </button>
                )}
              </div>
            )}
            {/* Assignee filters */}
            {uniqueAssignees.length > 0 && (
              <div>
                <div className="text-[0.55rem] uppercase tracking-wider text-muted mb-1">Assignees</div>
                <div className="flex flex-wrap gap-1 max-h-[132px] overflow-y-auto">
                  <button
                    onClick={() => toggleFilter(selectedAssignees, "__unassigned__", setSelectedAssignees)}
                    className={`px-1.5 py-0.5 text-[0.6rem] rounded border transition-colors ${
                      selectedAssignees.includes("__unassigned__")
                        ? "bg-surface-2 border-muted text-foreground"
                        : "bg-background border-t-border text-muted hover:border-muted"
                    }`}
                  >
                    Unassigned
                  </button>
                  {uniqueAssignees.map(a => (
                    <button
                      key={a}
                      onClick={() => toggleFilter(selectedAssignees, a, setSelectedAssignees)}
                      className={`px-1.5 py-0.5 text-[0.6rem] rounded border transition-colors ${
                        selectedAssignees.includes(a)
                          ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-300"
                          : "bg-background border-t-border text-muted hover:border-muted"
                      }`}
                      title={a}
                    >
                      {a.split(" ")[0]}
                    </button>
                  ))}
                  {selectedAssignees.length > 0 && (
                    <button onClick={() => setSelectedAssignees([])} className="px-1.5 py-0.5 text-[0.6rem] text-muted hover:text-foreground">
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Stats bar */}
          <div className="text-[0.65rem] text-muted px-3 py-2 border-b border-t-border bg-background flex justify-between items-center flex-wrap gap-x-2 gap-y-1">
            <span>{stats.scheduled} scheduled</span>
            <span>{stats.unscheduled} unscheduled</span>
            {stateCounts.overdue > 0 && (
              <span className="text-red-400 font-medium">{stateCounts.overdue} overdue</span>
            )}
          </div>

          {/* Category breakdown */}
          <div className="px-3 py-2 border-b border-t-border bg-surface space-y-1">
            {Object.entries(stats.byCategory).map(([cat, count]) => (
              <div key={cat} className="flex justify-between text-[0.6rem]">
                <span className={CATEGORY_TEXT_COLORS[cat] || "text-muted"}>{cat}</span>
                <span className="text-muted">{count}</span>
              </div>
            ))}
          </div>

          {/* Unscheduled jobs list */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted mb-2 px-1">
              Unscheduled Jobs
            </div>
            {filteredJobs.filter(j => !j.scheduledStart).length === 0 ? (
              <div className="text-[0.65rem] text-muted text-center py-4">No unscheduled jobs</div>
            ) : (
              filteredJobs.filter(j => !j.scheduledStart).map(j => {
                const state = jobStateByUid[j.jobUid];
                const isOverdue = state === "overdue";
                const isCompleted = state === "completed";
                return (
                <div
                  key={j.jobUid}
                  onClick={() => setSelectedJob(j)}
                  className={`bg-background border rounded-lg p-2.5 mb-1.5 cursor-pointer transition-all hover:translate-x-0.5 border-l-[3px] ${
                    isOverdue
                      ? "border-l-red-500"
                      : (CATEGORY_COLORS[j.categoryName]?.replace("bg-", "border-l-") || "border-l-zinc-600")
                  } ${
                    selectedJob?.jobUid === j.jobUid
                      ? "border-emerald-500 bg-emerald-500/10 shadow-[0_0_0_1px] shadow-emerald-500"
                      : isOverdue
                        ? "border-red-500/40 hover:border-red-500"
                        : "border-t-border hover:border-emerald-500"
                  } ${isCompleted ? "opacity-60" : ""}`}
                >
                  <div className="flex justify-between items-start mb-0.5">
                    <div className={`text-[0.7rem] font-semibold truncate max-w-[180px] ${isCompleted ? "line-through" : ""}`} title={j.title}>
                      {getCustomerName(j.title)}
                    </div>
                  </div>
                  <div className="text-[0.6rem] text-muted mb-1 truncate" title={j.address}>
                    {j.address}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <TypeBadge type={objectTypes[j.hubspotDealId]} objectId={j.hubspotDealId} portalId={hubspotPortalId} />
                    {isOverdue && (
                      <span className="text-[0.5rem] px-1 py-0.5 rounded bg-red-500/25 text-red-300 border border-red-500/40 font-semibold uppercase tracking-wider">
                        Overdue
                      </span>
                    )}
                    <span className={`text-[0.5rem] px-1 py-0.5 rounded ${
                      CATEGORY_COLORS[j.categoryName]?.replace("bg-", "bg-") + "/20 " + (CATEGORY_TEXT_COLORS[j.categoryName] || "text-muted")
                    }`}>
                      {j.categoryName}
                    </span>
                    <span className={`text-[0.5rem] px-1 py-0.5 rounded ${getStatusColor(j.statusName).bg} ${getStatusColor(j.statusName).text}`}>
                      {j.statusName}
                    </span>
                    {j.teamName && (
                      <span className="text-[0.5rem] px-1 py-0.5 rounded bg-surface-2 text-muted">
                        {j.teamName}
                      </span>
                    )}
                  </div>
                  {getAssignees(j).length > 0 && (
                    <div className="text-[0.55rem] text-muted mt-1 truncate" title={getAssignees(j).join(", ")}>
                      Assigned: {getAssignees(j).join(", ")}
                    </div>
                  )}
                </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Main calendar area */}
        <main className="flex flex-col flex-1 overflow-hidden">
          {/* Calendar header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-t-border bg-surface shrink-0">
            <div className="flex items-center gap-2">
              <button onClick={goPrev} className="p-1 text-muted hover:text-foreground transition-colors">&larr;</button>
              <h2 className="text-sm font-bold min-w-[220px] text-center">
                {headerTitle}
              </h2>
              <button onClick={goNext} className="p-1 text-muted hover:text-foreground transition-colors">&rarr;</button>
              <button
                onClick={goToToday}
                className="bg-surface border border-t-border text-foreground/80 px-2 py-1 rounded-md text-[0.65rem] hover:bg-surface-2 transition-colors"
              >
                Today
              </button>
            </div>
            <div className="flex items-center gap-2">
              {/* Job-state toggles — match master scheduler */}
              <div className="flex items-center gap-1">
                {([
                  { key: "scheduled", label: "Scheduled", color: "bg-blue-500 border-blue-500", active: showScheduled, toggle: () => setShowScheduled(!showScheduled), count: stateCounts.scheduled },
                  { key: "overdue", label: "Overdue", color: "bg-red-500 border-red-500", active: showOverdue, toggle: () => setShowOverdue(!showOverdue), count: stateCounts.overdue },
                  { key: "completed", label: "Completed", color: "bg-emerald-500 border-emerald-500", active: showCompleted, toggle: () => setShowCompleted(!showCompleted), count: stateCounts.completed },
                ] as const).map((t) => (
                  <button
                    key={t.key}
                    onClick={t.toggle}
                    className={`flex items-center gap-1 px-1.5 py-1 text-[0.6rem] font-medium rounded border transition-colors ${
                      t.active ? "border-t-border text-foreground/80 bg-surface-2" : "border-t-border text-muted opacity-60"
                    }`}
                    aria-pressed={t.active}
                    title={`${t.active ? "Hide" : "Show"} ${t.label.toLowerCase()} jobs`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-sm border flex items-center justify-center shrink-0 ${t.active ? t.color : "border-t-border"}`}>
                      {t.active && (
                        <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </span>
                    {t.label}
                    <span className="opacity-70">({t.count})</span>
                  </button>
                ))}
              </div>

              {/* View-mode toggle */}
              <div className="flex items-center gap-1 bg-background border border-t-border rounded-md p-0.5">
                {(["month", "week", "day"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={`px-2.5 py-1 text-[0.65rem] rounded transition-colors capitalize ${
                      viewMode === v
                        ? "bg-emerald-500 text-black font-semibold"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Loading / Error */}
          {loading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-muted text-sm">Loading Zuper jobs...</div>
            </div>
          )}
          {error && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-red-400 text-sm">{error}</div>
                <button onClick={fetchJobs} className="mt-2 px-3 py-1.5 bg-emerald-500 text-black rounded-md text-sm cursor-pointer">
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Calendar grid */}
          {!loading && !error && viewMode === "month" && (
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-7 border-b border-t-border">
                {DAY_NAMES.map(d => (
                  <div key={d} className="text-center text-[0.65rem] text-muted font-semibold py-2 border-r border-t-border last:border-r-0 bg-surface">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((dateStr) => {
                  const [, m] = dateStr.split("-").map(Number);
                  const isCurrentMonth = m === currentMonth + 1;
                  const isToday = dateStr === todayStr;
                  const weekend = isWeekend(dateStr);
                  const dayJobs = jobsByDate[dateStr] || [];

                  return (
                    <div
                      key={dateStr}
                      onClick={() => { setAnchorDate(dateStr); setViewMode("day"); }}
                      className={`min-h-[110px] max-h-[180px] overflow-y-auto p-1 border-b border-r border-t-border transition-colors cursor-pointer ${
                        !isCurrentMonth ? "opacity-40" : ""
                      } ${weekend ? "bg-surface/30" : ""} ${
                        isToday ? "bg-emerald-900/20 ring-2 ring-inset ring-emerald-500" : ""
                      }`}
                    >
                      <div className={`text-xs font-medium mb-0.5 ${
                        isToday ? "text-emerald-400" : "text-muted"
                      }`}>
                        {parseInt(dateStr.split("-")[2])}
                      </div>
                      <div className="space-y-0.5">
                        {dayJobs.map(j => {
                          const state = jobStateByUid[j.jobUid];
                          const isOverdue = state === "overdue";
                          const isCompleted = state === "completed";
                          const colors = isOverdue ? OVERDUE_STATUS_COLOR : getStatusColor(j.statusName);
                          const stripe = getCategoryStripe(j.categoryName);
                          return (
                          <div
                            key={j.jobUid}
                            onClick={(e) => { e.stopPropagation(); setSelectedJob(j); }}
                            className={`text-[0.6rem] p-1 rounded border-l-4 ${stripe} ${colors.bg} ${colors.text} cursor-pointer transition hover:brightness-125 ${selectedJob?.jobUid === j.jobUid ? "ring-2 ring-foreground/40" : ""} ${isCompleted ? "opacity-60" : ""}`}
                            title={`${j.title}\n${j.statusName}\n${getAssignees(j).join(", ") || "Unassigned"}${j.scheduledStart ? "\n" + formatTime(j.scheduledStart) : ""}${isOverdue ? "\n⚠ Overdue" : ""}`}
                          >
                            <div className="flex items-center gap-1">
                              <TypeBadge type={objectTypes[j.hubspotDealId]} size="sm" objectId={j.hubspotDealId} portalId={hubspotPortalId} />
                              <div className={`truncate font-medium flex-1 min-w-0 ${isCompleted ? "line-through" : ""}`}>{getCustomerName(j.title)}</div>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {j.scheduledStart && (
                                <span className="text-[0.5rem] opacity-70">{formatTime(j.scheduledStart)}</span>
                              )}
                              {getAssignees(j).length > 0 && (
                                <span className="text-[0.5rem] opacity-60 truncate">
                                  {getAssignees(j).map(a => a.split(" ")[0]).join(", ")}
                                </span>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Week view */}
          {!loading && !error && viewMode === "week" && (
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-7 border-b border-t-border sticky top-0 bg-surface z-10">
                {weekDays.map((dateStr) => {
                  const [y, m, d] = dateStr.split("-").map(Number);
                  const dt = new Date(y, m - 1, d);
                  const isToday = dateStr === todayStr;
                  return (
                    <div
                      key={dateStr}
                      onClick={() => { setAnchorDate(dateStr); setViewMode("day"); }}
                      className={`text-center py-2 border-r border-t-border last:border-r-0 cursor-pointer hover:bg-surface-2 ${
                        isToday ? "bg-emerald-900/20" : ""
                      }`}
                    >
                      <div className="text-[0.6rem] text-muted uppercase">
                        {dt.toLocaleDateString("en-US", { weekday: "short" })}
                      </div>
                      <div className={`text-sm font-semibold ${isToday ? "text-emerald-400" : "text-foreground"}`}>
                        {d}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-7 min-h-full">
                {weekDays.map((dateStr) => {
                  const weekend = isWeekend(dateStr);
                  const isToday = dateStr === todayStr;
                  const dayJobs = jobsByDate[dateStr] || [];
                  return (
                    <div
                      key={dateStr}
                      className={`p-1.5 border-r border-t-border last:border-r-0 min-h-[400px] ${
                        weekend ? "bg-surface/30" : ""
                      } ${isToday ? "bg-emerald-900/10" : ""}`}
                    >
                      <div className="space-y-1">
                        {dayJobs.length === 0 ? (
                          <div className="text-[0.55rem] text-muted/60 text-center py-4">—</div>
                        ) : (
                          dayJobs.map(j => {
                            const state = jobStateByUid[j.jobUid];
                            const isOverdue = state === "overdue";
                            const isCompleted = state === "completed";
                            const colors = isOverdue ? OVERDUE_STATUS_COLOR : getStatusColor(j.statusName);
                            const stripe = getCategoryStripe(j.categoryName);
                            return (
                            <div
                              key={j.jobUid}
                              onClick={() => setSelectedJob(j)}
                              className={`text-[0.65rem] p-1.5 rounded border-l-4 ${stripe} ${colors.bg} ${colors.text} cursor-pointer transition hover:brightness-125 ${selectedJob?.jobUid === j.jobUid ? "ring-2 ring-foreground/40" : ""} ${isCompleted ? "opacity-60" : ""}`}
                              title={`${j.title}\n${j.statusName}\n${getAssignees(j).join(", ") || "Unassigned"}${isOverdue ? "\n⚠ Overdue" : ""}`}
                            >
                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                {j.scheduledStart ? (
                                  <span className="text-[0.55rem] opacity-80">{formatTime(j.scheduledStart)}</span>
                                ) : <span />}
                                <TypeBadge type={objectTypes[j.hubspotDealId]} size="sm" objectId={j.hubspotDealId} portalId={hubspotPortalId} />
                              </div>
                              <div className={`font-medium truncate ${isCompleted ? "line-through" : ""}`}>{getCustomerName(j.title)}</div>
                              <div className="text-[0.55rem] opacity-70 truncate">{j.statusName}</div>
                              {getAssignees(j).length > 0 && (
                                <div className="text-[0.55rem] opacity-60 truncate" title={getAssignees(j).join(", ")}>
                                  {getAssignees(j).join(", ")}
                                </div>
                              )}
                            </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Day view */}
          {!loading && !error && viewMode === "day" && (
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const dayJobs = jobsByDate[anchorDate] || [];
                // Timeline 7am–8pm with a header "all-day / unknown time" row
                const hours = Array.from({ length: 14 }, (_, i) => i + 7);
                const untimed = dayJobs.filter((j) => {
                  if (!j.scheduledStart) return true;
                  const h = new Date(j.scheduledStart).getHours();
                  return h < 7 || h >= 21;
                });
                const byHour: Record<number, ZuperJob[]> = {};
                for (const j of dayJobs) {
                  if (!j.scheduledStart) continue;
                  const h = new Date(j.scheduledStart).getHours();
                  if (h < 7 || h >= 21) continue;
                  if (!byHour[h]) byHour[h] = [];
                  byHour[h].push(j);
                }
                return (
                  <div className="max-w-3xl mx-auto py-2">
                    {untimed.length > 0 && (
                      <div className="mb-3 mx-2 p-2 border border-dashed border-t-border rounded">
                        <div className="text-[0.6rem] uppercase text-muted mb-1">No scheduled time</div>
                        <div className="space-y-1">
                          {untimed.map((j) => {
                            const state = jobStateByUid[j.jobUid];
                            const isOverdue = state === "overdue";
                            const isCompleted = state === "completed";
                            const colors = isOverdue ? OVERDUE_STATUS_COLOR : getStatusColor(j.statusName);
                            const stripe = getCategoryStripe(j.categoryName);
                            return (
                            <div
                              key={j.jobUid}
                              onClick={() => setSelectedJob(j)}
                              className={`text-[0.7rem] p-2 rounded border-l-4 ${stripe} ${colors.bg} ${colors.text} cursor-pointer transition hover:brightness-125 ${selectedJob?.jobUid === j.jobUid ? "ring-2 ring-foreground/40" : ""} ${isCompleted ? "opacity-60" : ""}`}
                            >
                              <div className="flex items-center gap-1">
                                <TypeBadge type={objectTypes[j.hubspotDealId]} size="sm" objectId={j.hubspotDealId} portalId={hubspotPortalId} />
                                <div className={`font-medium ${isCompleted ? "line-through" : ""}`}>{getCustomerName(j.title)}</div>
                                {isOverdue && (
                                  <span className="text-[0.55rem] px-1 py-0.5 rounded bg-red-500/30 text-red-200 border border-red-500/50 font-semibold uppercase tracking-wider">
                                    Overdue
                                  </span>
                                )}
                              </div>
                              <div className="text-[0.6rem] opacity-70">{j.statusName} · {getAssignees(j).join(", ") || "Unassigned"}</div>
                            </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {dayJobs.length === 0 && untimed.length === 0 && (
                      <div className="text-center text-muted text-sm py-12">No jobs scheduled for this day.</div>
                    )}
                    <div className="divide-y divide-t-border">
                      {hours.map((h) => {
                        const hourJobs = byHour[h] || [];
                        const label = new Date(2000, 0, 1, h).toLocaleTimeString("en-US", {
                          hour: "numeric", hour12: true,
                        });
                        return (
                          <div key={h} className="flex gap-3 px-3 py-2 min-h-[52px]">
                            <div className="w-14 text-[0.65rem] text-muted shrink-0 pt-0.5">{label}</div>
                            <div className="flex-1 space-y-1">
                              {hourJobs.map((j) => {
                                const state = jobStateByUid[j.jobUid];
                                const isOverdue = state === "overdue";
                                const isCompleted = state === "completed";
                                const colors = isOverdue ? OVERDUE_STATUS_COLOR : getStatusColor(j.statusName);
                                const stripe = getCategoryStripe(j.categoryName);
                                return (
                                <div
                                  key={j.jobUid}
                                  onClick={() => setSelectedJob(j)}
                                  className={`text-[0.7rem] p-2 rounded border-l-4 ${stripe} ${colors.bg} ${colors.text} cursor-pointer transition hover:brightness-125 ${selectedJob?.jobUid === j.jobUid ? "ring-2 ring-foreground/40" : ""} ${isCompleted ? "opacity-60" : ""}`}
                                >
                                  <div className="flex justify-between gap-2">
                                    <div className="flex items-center gap-1 min-w-0">
                                      <TypeBadge type={objectTypes[j.hubspotDealId]} size="sm" objectId={j.hubspotDealId} portalId={hubspotPortalId} />
                                      <div className={`font-medium truncate ${isCompleted ? "line-through" : ""}`}>{getCustomerName(j.title)}</div>
                                      {isOverdue && (
                                        <span className="text-[0.55rem] px-1 py-0.5 rounded bg-red-500/30 text-red-200 border border-red-500/50 font-semibold uppercase tracking-wider shrink-0">
                                          Overdue
                                        </span>
                                      )}
                                    </div>
                                    {j.scheduledStart && (
                                      <span className="text-[0.6rem] opacity-80 shrink-0">{formatTime(j.scheduledStart)}</span>
                                    )}
                                  </div>
                                  <div className="text-[0.6rem] opacity-70 truncate">
                                    {j.statusName} · {getAssignees(j).join(", ") || "Unassigned"}{j.teamName ? ` · ${j.teamName}` : ""}
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </main>
      </div>

      {/* Job detail modal */}
      {selectedJob && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setSelectedJob(null)}
        >
          <div
            className="bg-surface border border-t-border rounded-xl shadow-card-lg w-[480px] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-t-border">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-bold">{getCustomerName(selectedJob.title)}</div>
                    {selectedObjectType === "deal" && (
                      <span className="text-[0.55rem] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold uppercase tracking-wider">
                        Deal
                      </span>
                    )}
                    {selectedObjectType === "ticket" && (
                      <span className="text-[0.55rem] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold uppercase tracking-wider">
                        Ticket
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-0.5">{selectedJob.title.split(" | ")[0]}</div>
                </div>
                <button onClick={() => setSelectedJob(null)} className="text-muted hover:text-foreground text-lg leading-none">&times;</button>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-[0.7rem]">
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">Category</div>
                  <span className={`px-2 py-0.5 rounded text-[0.65rem] font-medium ${
                    CATEGORY_COLORS[selectedJob.categoryName] || "bg-surface-2"
                  } text-black`}>
                    {selectedJob.categoryName}
                  </span>
                </div>
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">Status</div>
                  <span className={`px-2 py-0.5 rounded text-[0.65rem] font-medium ${getStatusColor(selectedJob.statusName).bg} ${getStatusColor(selectedJob.statusName).text}`}>
                    {selectedJob.statusName}
                  </span>
                </div>
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">Location / Team</div>
                  <span className="text-foreground">{selectedJob.teamName || "—"}</span>
                </div>
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">
                    Assigned To{getAssignees(selectedJob).length > 1 ? ` (${getAssignees(selectedJob).length})` : ""}
                  </div>
                  <span className="text-foreground">
                    {getAssignees(selectedJob).join(", ") || "Unassigned"}
                  </span>
                </div>
                <div className="col-span-2">
                  <div className="text-muted text-[0.6rem] mb-0.5">Scheduled Date</div>
                  <span className="text-foreground">{formatScheduledDateTime(selectedJob.scheduledStart)}</span>
                </div>
                <div className="col-span-2">
                  <div className="text-muted text-[0.6rem] mb-0.5">Address</div>
                  <span className="text-foreground">{selectedJob.address}</span>
                </div>
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">Work Order</div>
                  <span className="text-foreground">#{selectedJob.workOrderNumber || "—"}</span>
                </div>
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">Customer</div>
                  <span className="text-foreground">{selectedJob.customerName}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-t-border">
                <a
                  href={`${ZUPER_WEB_BASE}/jobs/${selectedJob.jobUid}/details`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-[120px] text-center text-xs py-2 rounded-md bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-colors"
                >
                  Open in Zuper
                </a>
                {selectedJob.hubspotDealId && selectedObjectType === "deal" && (
                  <>
                    <Link
                      href={getInternalDealUrl(selectedJob.hubspotDealId, "service")}
                      className="flex-1 min-w-[120px] text-center text-xs py-2 rounded-md bg-purple-500 text-white font-semibold hover:bg-purple-400 transition-colors"
                    >
                      Open Deal
                    </Link>
                    <a
                      href={`https://app.hubspot.com/contacts/${hubspotPortalId || "22460157"}/record/0-3/${selectedJob.hubspotDealId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-[120px] text-center text-xs py-2 rounded-md bg-orange-500 text-black font-semibold hover:bg-orange-400 transition-colors"
                    >
                      HubSpot Deal
                    </a>
                  </>
                )}
                {selectedJob.hubspotDealId && selectedObjectType === "ticket" && (
                  <a
                    href={`https://app.hubspot.com/contacts/${hubspotPortalId || "22460157"}/ticket/${selectedJob.hubspotDealId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-w-[120px] text-center text-xs py-2 rounded-md bg-cyan-500 text-black font-semibold hover:bg-cyan-400 transition-colors"
                  >
                    HubSpot Ticket
                  </a>
                )}
                {selectedJob.hubspotDealId && selectedObjectType === null && (
                  <span className="flex-1 min-w-[120px] text-center text-xs py-2 rounded-md bg-surface-2 text-muted">
                    Resolving HubSpot link…
                  </span>
                )}
                {selectedJob.hubspotDealId && selectedObjectType && (
                  primaryContactId ? (
                    <a
                      href={`https://app.hubspot.com/contacts/${hubspotPortalId || "22460157"}/record/0-1/${primaryContactId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-[120px] text-center text-xs py-2 rounded-md bg-orange-400 text-black font-semibold hover:bg-orange-300 transition-colors"
                    >
                      HubSpot Contact
                    </a>
                  ) : (
                    <span className="flex-1 min-w-[120px] text-center text-xs py-2 rounded-md bg-surface-2 text-muted">
                      {contactLoading ? "Loading contact..." : "No contact linked"}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
