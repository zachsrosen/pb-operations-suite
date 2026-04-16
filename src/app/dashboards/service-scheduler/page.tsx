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

const ZUPER_WEB_BASE = "https://web.zuperpro.com";

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
  const [selectedJob, setSelectedJob] = useState<ZuperJob | null>(null);
  const [primaryContactId, setPrimaryContactId] = useState<string | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const contactCacheRef = useRef<Record<string, string | null>>({});
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

  // Lazy-fetch primary contact id when a job modal opens
  useEffect(() => {
    const dealId = selectedJob?.hubspotDealId;
    if (!dealId) {
      setPrimaryContactId(null);
      return;
    }
    if (dealId in contactCacheRef.current) {
      setPrimaryContactId(contactCacheRef.current[dealId]);
      return;
    }
    let cancelled = false;
    setContactLoading(true);
    setPrimaryContactId(null);
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/primary-contact`);
        const data = res.ok ? await res.json() : { contactId: null };
        const id = (data?.contactId ?? null) as string | null;
        contactCacheRef.current[dealId] = id;
        if (!cancelled) setPrimaryContactId(id);
      } catch {
        if (!cancelled) setPrimaryContactId(null);
      } finally {
        if (!cancelled) setContactLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedJob?.hubspotDealId]);

  // Derived data
  const uniqueStatuses = useMemo(() => {
    const s = new Set(jobs.map(j => j.statusName).filter(Boolean));
    return Array.from(s).sort();
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      if (searchText) {
        const q = searchText.toLowerCase();
        if (!j.title.toLowerCase().includes(q) &&
            !j.customerName.toLowerCase().includes(q) &&
            !j.address.toLowerCase().includes(q) &&
            !j.assignedUser.toLowerCase().includes(q)) return false;
      }
      if (selectedCategories.length > 0 && !selectedCategories.includes(j.categoryName)) return false;
      if (selectedLocations.length > 0 && !selectedLocations.includes(j.teamName)) return false;
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(j.statusName)) return false;
      return true;
    });
  }, [jobs, searchText, selectedCategories, selectedLocations, selectedStatuses]);

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
          </div>

          {/* Stats bar */}
          <div className="text-[0.65rem] text-muted px-3 py-2 border-b border-t-border bg-background flex justify-between">
            <span>{stats.scheduled} scheduled</span>
            <span>{stats.unscheduled} unscheduled</span>
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
              filteredJobs.filter(j => !j.scheduledStart).map(j => (
                <div
                  key={j.jobUid}
                  onClick={() => setSelectedJob(j)}
                  className={`bg-background border rounded-lg p-2.5 mb-1.5 cursor-pointer transition-all hover:border-emerald-500 hover:translate-x-0.5 border-l-[3px] ${
                    CATEGORY_COLORS[j.categoryName]?.replace("bg-", "border-l-") || "border-l-zinc-600"
                  } ${
                    selectedJob?.jobUid === j.jobUid
                      ? "border-emerald-500 bg-emerald-500/10 shadow-[0_0_0_1px] shadow-emerald-500"
                      : "border-t-border"
                  }`}
                >
                  <div className="flex justify-between items-start mb-0.5">
                    <div className="text-[0.7rem] font-semibold truncate max-w-[180px]" title={j.title}>
                      {getCustomerName(j.title)}
                    </div>
                  </div>
                  <div className="text-[0.6rem] text-muted mb-1 truncate" title={j.address}>
                    {j.address}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <span className={`text-[0.5rem] px-1 py-0.5 rounded ${
                      CATEGORY_COLORS[j.categoryName]?.replace("bg-", "bg-") + "/20 " + (CATEGORY_TEXT_COLORS[j.categoryName] || "text-muted")
                    }`}>
                      {j.categoryName}
                    </span>
                    <span className="text-[0.5rem] px-1 py-0.5 rounded bg-surface-2 text-muted">
                      {j.statusName}
                    </span>
                    {j.teamName && (
                      <span className="text-[0.5rem] px-1 py-0.5 rounded bg-surface-2 text-muted">
                        {j.teamName}
                      </span>
                    )}
                  </div>
                  {j.assignedUser && (
                    <div className="text-[0.55rem] text-muted mt-1">
                      Assigned: {j.assignedUser}
                    </div>
                  )}
                </div>
              ))
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
                        {dayJobs.map(j => (
                          <div
                            key={j.jobUid}
                            onClick={(e) => { e.stopPropagation(); setSelectedJob(j); }}
                            className={`text-[0.6rem] p-1 rounded cursor-pointer transition-colors ${
                              j.categoryName === "Service Revisit"
                                ? "bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30"
                                : "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30"
                            } ${selectedJob?.jobUid === j.jobUid ? "ring-2 ring-emerald-400" : ""}`}
                            title={`${j.title}\n${j.statusName}\n${j.assignedUser || "Unassigned"}${j.scheduledStart ? "\n" + formatTime(j.scheduledStart) : ""}`}
                          >
                            <div className="truncate font-medium">{getCustomerName(j.title)}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {j.scheduledStart && (
                                <span className="text-[0.5rem] opacity-70">{formatTime(j.scheduledStart)}</span>
                              )}
                              {j.assignedUser && (
                                <span className="text-[0.5rem] opacity-60 truncate">{j.assignedUser.split(" ")[0]}</span>
                              )}
                            </div>
                          </div>
                        ))}
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
                          dayJobs.map(j => (
                            <div
                              key={j.jobUid}
                              onClick={() => setSelectedJob(j)}
                              className={`text-[0.65rem] p-1.5 rounded cursor-pointer transition-colors ${
                                j.categoryName === "Service Revisit"
                                  ? "bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30"
                                  : "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30"
                              } ${selectedJob?.jobUid === j.jobUid ? "ring-2 ring-emerald-400" : ""}`}
                              title={`${j.title}\n${j.statusName}\n${j.assignedUser || "Unassigned"}`}
                            >
                              {j.scheduledStart && (
                                <div className="text-[0.55rem] opacity-80 mb-0.5">{formatTime(j.scheduledStart)}</div>
                              )}
                              <div className="font-medium truncate">{getCustomerName(j.title)}</div>
                              <div className="text-[0.55rem] opacity-70 truncate">{j.statusName}</div>
                              {j.assignedUser && (
                                <div className="text-[0.55rem] opacity-60 truncate">{j.assignedUser}</div>
                              )}
                            </div>
                          ))
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
                          {untimed.map((j) => (
                            <div
                              key={j.jobUid}
                              onClick={() => setSelectedJob(j)}
                              className={`text-[0.7rem] p-2 rounded cursor-pointer ${
                                j.categoryName === "Service Revisit"
                                  ? "bg-amber-500/20 border border-amber-500/30 text-amber-300"
                                  : "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
                              } ${selectedJob?.jobUid === j.jobUid ? "ring-2 ring-emerald-400" : ""}`}
                            >
                              <div className="font-medium">{getCustomerName(j.title)}</div>
                              <div className="text-[0.6rem] opacity-70">{j.statusName} · {j.assignedUser || "Unassigned"}</div>
                            </div>
                          ))}
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
                              {hourJobs.map((j) => (
                                <div
                                  key={j.jobUid}
                                  onClick={() => setSelectedJob(j)}
                                  className={`text-[0.7rem] p-2 rounded cursor-pointer ${
                                    j.categoryName === "Service Revisit"
                                      ? "bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30"
                                      : "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30"
                                  } ${selectedJob?.jobUid === j.jobUid ? "ring-2 ring-emerald-400" : ""}`}
                                >
                                  <div className="flex justify-between gap-2">
                                    <div className="font-medium truncate">{getCustomerName(j.title)}</div>
                                    {j.scheduledStart && (
                                      <span className="text-[0.6rem] opacity-80 shrink-0">{formatTime(j.scheduledStart)}</span>
                                    )}
                                  </div>
                                  <div className="text-[0.6rem] opacity-70 truncate">
                                    {j.statusName} · {j.assignedUser || "Unassigned"}{j.teamName ? ` · ${j.teamName}` : ""}
                                  </div>
                                </div>
                              ))}
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
                  <div className="text-sm font-bold">{getCustomerName(selectedJob.title)}</div>
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
                  <span className="text-foreground">{selectedJob.statusName}</span>
                </div>
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">Location / Team</div>
                  <span className="text-foreground">{selectedJob.teamName || "—"}</span>
                </div>
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">Assigned To</div>
                  <span className="text-foreground">{selectedJob.assignedUser || "Unassigned"}</span>
                </div>
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">Due Date</div>
                  <span className="text-foreground">{selectedJob.dueDate || "—"}</span>
                </div>
                <div>
                  <div className="text-muted text-[0.6rem] mb-0.5">Scheduled</div>
                  <span className="text-foreground">
                    {selectedJob.scheduledStart ? formatTime(selectedJob.scheduledStart) : "Not scheduled"}
                  </span>
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
                {selectedJob.hubspotDealId && (
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
                    {primaryContactId ? (
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
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
