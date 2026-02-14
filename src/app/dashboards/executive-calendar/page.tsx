"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { formatMoney } from "@/lib/format";
import { useActivityTracking } from "@/hooks/useActivityTracking";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DailyBreakdown {
  totalValue: number;
  construction: { count: number; value: number };
  detach: { count: number; value: number };
  reset: { count: number; value: number };
  service: { count: number; value: number };
}

interface Job {
  jobUid: string;
  title: string;
  category: string;
  categoryKey: string;
  date: string;
  endDate: string | null;
  statusName: string;
  assignedUser: string;
  teamName: string;
  dealId: string | null;
  dealName: string | null;
  dealValue: number;
  projectNumber: string | null;
}

interface MonthTotals {
  totalValue: number;
  totalJobs: number;
  byCategory: {
    construction: { count: number; value: number };
    detach: { count: number; value: number };
    reset: { count: number; value: number };
    service: { count: number; value: number };
  };
}

interface CalendarData {
  dailyTotals: Record<string, DailyBreakdown>;
  jobs: Job[];
  monthTotals: MonthTotals;
  filters: { teams: string[] };
  month: { year: number; month: number; startDate: string; endDate: string };
  lastUpdated: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_KEYS = ["construction", "detach", "reset", "service"] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];

const CATEGORY_CONFIG: Record<
  CategoryKey,
  { label: string; dotColor: string; badgeBg: string; badgeText: string; statColor: string }
> = {
  construction: {
    label: "Construction",
    dotColor: "bg-blue-500",
    badgeBg: "bg-blue-500/20",
    badgeText: "text-blue-400",
    statColor: "text-blue-400",
  },
  detach: {
    label: "Detach",
    dotColor: "bg-purple-500",
    badgeBg: "bg-purple-500/20",
    badgeText: "text-purple-400",
    statColor: "text-purple-400",
  },
  reset: {
    label: "Reset",
    dotColor: "bg-orange-500",
    badgeBg: "bg-orange-500/20",
    badgeText: "text-orange-400",
    statColor: "text-orange-400",
  },
  service: {
    label: "Service",
    dotColor: "bg-emerald-500",
    badgeBg: "bg-emerald-500/20",
    badgeText: "text-emerald-400",
    statColor: "text-emerald-400",
  },
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  if (n > 0) return `$${n}`;
  return "";
}

function getToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatFullDate(dateStr: string): string {
  const parts = dateStr.split("-");
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ExecutiveCalendarPage() {
  useActivityTracking();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-indexed
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [enabledCategories, setEnabledCategories] = useState<Set<CategoryKey>>(
    new Set(CATEGORY_KEYS)
  );
  const [filterTeams, setFilterTeams] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  /* ---- Data fetching ---- */

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
      });
      if (filterTeams.length > 0) {
        params.set("team", filterTeams.join(","));
      }
      const res = await fetch(`/api/zuper/revenue-calendar?${params}`);
      if (!res.ok) throw new Error("Failed to fetch revenue calendar data");
      const json: CalendarData = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      console.error("Revenue calendar fetch error:", err);
      setError("Failed to load revenue calendar. Please try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [year, month, filterTeams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Clear selected date when month changes
  useEffect(() => {
    setSelectedDate(null);
  }, [year, month]);

  /* ---- Month navigation ---- */

  const goToPrevMonth = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const goToToday = () => {
    const today = new Date();
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
  };

  /* ---- Category toggle ---- */

  const toggleCategory = (key: CategoryKey) => {
    setEnabledCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  /* ---- Filtered totals (respect enabled categories) ---- */

  const filteredMonthTotals = useMemo(() => {
    if (!data) return { totalValue: 0, totalJobs: 0 };
    let totalValue = 0;
    let totalJobs = 0;
    const cats = data.monthTotals.byCategory;
    for (const key of CATEGORY_KEYS) {
      if (enabledCategories.has(key)) {
        totalValue += cats[key].value;
        totalJobs += cats[key].count;
      }
    }
    return { totalValue, totalJobs };
  }, [data, enabledCategories]);

  const filteredCategoryTotals = useMemo(() => {
    if (!data) return { construction: 0, detach: 0, reset: 0, service: 0, dnr: 0 };
    const cats = data.monthTotals.byCategory;
    return {
      construction: enabledCategories.has("construction") ? cats.construction.value : 0,
      detach: enabledCategories.has("detach") ? cats.detach.value : 0,
      reset: enabledCategories.has("reset") ? cats.reset.value : 0,
      service: enabledCategories.has("service") ? cats.service.value : 0,
      dnr:
        (enabledCategories.has("detach") ? cats.detach.value : 0) +
        (enabledCategories.has("reset") ? cats.reset.value : 0),
    };
  }, [data, enabledCategories]);

  /* ---- Calendar grid computation ---- */

  const calendarDays = useMemo(() => {
    // First day of the month (0=Sun, 1=Mon, ...)
    const firstDay = new Date(year, month - 1, 1).getDay();
    // Total days in this month
    const daysInMonth = new Date(year, month, 0).getDate();
    // Total days in previous month (for leading padding)
    const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

    const days: {
      date: string;
      day: number;
      isCurrentMonth: boolean;
      isToday: boolean;
    }[] = [];

    const todayStr = getToday();

    // Leading days from previous month
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const dateStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date: dateStr, day: d, isCurrentMonth: false, isToday: dateStr === todayStr });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date: dateStr, day: d, isCurrentMonth: true, isToday: dateStr === todayStr });
    }

    // Trailing days to fill the last row
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        const dateStr = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        days.push({ date: dateStr, day: d, isCurrentMonth: false, isToday: dateStr === todayStr });
      }
    }

    return days;
  }, [year, month]);

  /* ---- Filtered daily totals ---- */

  const getFilteredDayTotal = useCallback(
    (dateStr: string): { value: number; jobCount: number; activeCategories: CategoryKey[] } => {
      if (!data?.dailyTotals[dateStr]) return { value: 0, jobCount: 0, activeCategories: [] };
      const day = data.dailyTotals[dateStr];
      let value = 0;
      let jobCount = 0;
      const activeCategories: CategoryKey[] = [];

      for (const key of CATEGORY_KEYS) {
        if (enabledCategories.has(key) && day[key].count > 0) {
          value += day[key].value;
          jobCount += day[key].count;
          activeCategories.push(key);
        }
      }

      return { value, jobCount, activeCategories };
    },
    [data, enabledCategories]
  );

  /* ---- Jobs for selected date ---- */

  const selectedDayJobs = useMemo(() => {
    if (!data || !selectedDate) return [];
    return data.jobs.filter(
      (j) => j.date === selectedDate && enabledCategories.has(j.categoryKey as CategoryKey)
    );
  }, [data, selectedDate, enabledCategories]);

  /* ---- Team filter options ---- */

  const teamOptions = useMemo(() => {
    if (!data?.filters?.teams) return [];
    return data.filters.teams
      .filter(Boolean)
      .sort()
      .map((t) => ({ value: t, label: t }));
  }, [data]);

  /* ---- Export data ---- */

  const exportRows = useMemo(() => {
    if (!data) return [];
    return data.jobs
      .filter((j) => enabledCategories.has(j.categoryKey as CategoryKey))
      .map((j) => ({
        "Project Number": j.projectNumber || "",
        Title: j.title,
        Category: j.category,
        Date: j.date,
        "Deal Value": j.dealValue,
        Crew: j.assignedUser,
        Team: j.teamName,
        Status: j.statusName,
      }));
  }, [data, enabledCategories]);

  /* ---- Render ---- */

  if (loading && !data) {
    return (
      <DashboardShell title="Revenue Calendar" accentColor="green">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400" />
        </div>
      </DashboardShell>
    );
  }

  if (error && !data) {
    return (
      <DashboardShell title="Revenue Calendar" accentColor="green">
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => {
              setError(null);
              fetchData();
            }}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  const subtitleTotal = formatMoney(filteredMonthTotals.totalValue);
  const subtitleText = `${MONTH_NAMES[month - 1]} ${year} \u2014 ${subtitleTotal} scheduled`;

  return (
    <DashboardShell
      title="Revenue Calendar"
      subtitle={subtitleText}
      accentColor="green"
      lastUpdated={data?.lastUpdated}
      exportData={{
        data: exportRows,
        filename: `revenue-calendar-${year}-${String(month).padStart(2, "0")}`,
      }}
      fullWidth={true}
    >
      {/* Month Navigation */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <div className="flex items-center gap-2 bg-surface/50 rounded-lg px-3 py-2">
          <button
            onClick={goToPrevMonth}
            className="p-1 rounded hover:bg-surface-2 text-muted hover:text-foreground transition-colors"
            aria-label="Previous month"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-foreground font-semibold text-sm min-w-[150px] text-center">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button
            onClick={goToNextMonth}
            className="p-1 rounded hover:bg-surface-2 text-muted hover:text-foreground transition-colors"
            aria-label="Next month"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={goToToday}
            className="ml-2 px-3 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded-md transition-colors font-medium"
          >
            Today
          </button>
        </div>
      </div>

      {/* Category Toggles + Team Filter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          {CATEGORY_KEYS.map((key) => {
            const cfg = CATEGORY_CONFIG[key];
            const isActive = enabledCategories.has(key);
            return (
              <button
                key={key}
                onClick={() => toggleCategory(key)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  isActive
                    ? `${cfg.badgeBg} ${cfg.badgeText} border-transparent`
                    : "bg-surface-2 text-muted border-t-border opacity-50"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isActive ? cfg.dotColor : "bg-muted"}`} />
                {cfg.label}
              </button>
            );
          })}
        </div>
        {teamOptions.length > 0 && (
          <MultiSelectFilter
            label="Team"
            options={teamOptions}
            selected={filterTeams}
            onChange={setFilterTeams}
            placeholder="All Teams"
            accentColor="green"
          />
        )}
        {loading && (
          <div className="ml-auto">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-400" />
          </div>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="bg-surface/50 border border-t-border rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-green-400" key={String(filteredMonthTotals.totalValue)}>
            {formatMoney(filteredMonthTotals.totalValue)}
          </div>
          <div className="text-xs text-muted mt-0.5">Total Revenue</div>
        </div>
        <div className="bg-surface/50 border border-t-border rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-blue-400" key={String(filteredCategoryTotals.construction)}>
            {formatMoney(filteredCategoryTotals.construction)}
          </div>
          <div className="text-xs text-muted mt-0.5">Construction</div>
        </div>
        <div className="bg-surface/50 border border-t-border rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-purple-400" key={String(filteredCategoryTotals.dnr)}>
            {formatMoney(filteredCategoryTotals.dnr)}
          </div>
          <div className="text-xs text-muted mt-0.5">D&R</div>
        </div>
        <div className="bg-surface/50 border border-t-border rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-emerald-400" key={String(filteredCategoryTotals.service)}>
            {formatMoney(filteredCategoryTotals.service)}
          </div>
          <div className="text-xs text-muted mt-0.5">Service</div>
        </div>
        <div className="bg-surface/50 border border-t-border rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-muted" key={String(filteredMonthTotals.totalJobs)}>
            {filteredMonthTotals.totalJobs}
          </div>
          <div className="text-xs text-muted mt-0.5">Total Jobs</div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-surface/50 border border-t-border rounded-xl p-3 sm:p-4">
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_NAMES.map((d) => (
            <div key={d} className="text-xs text-muted font-medium text-center py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((cell) => {
            const dayData = getFilteredDayTotal(cell.date);
            const isSelected = selectedDate === cell.date;

            return (
              <button
                key={cell.date}
                onClick={() =>
                  setSelectedDate(selectedDate === cell.date ? null : cell.date)
                }
                className={`relative min-h-[100px] p-2 rounded-lg text-left transition-colors flex flex-col ${
                  cell.isCurrentMonth ? "" : "opacity-30"
                } ${
                  cell.isToday
                    ? "border-2 border-green-500 bg-surface/50"
                    : "border border-t-border bg-surface/50"
                } ${
                  isSelected
                    ? "ring-2 ring-green-400/60 bg-surface-2/50"
                    : "hover:bg-surface-2/50"
                } cursor-pointer`}
              >
                {/* Day number */}
                <span
                  className={`text-xs font-medium ${
                    cell.isToday ? "text-green-400" : "text-muted"
                  }`}
                >
                  {cell.day}
                </span>

                {/* Revenue amount */}
                {dayData.value > 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center">
                    <span className="text-sm sm:text-base font-bold text-foreground">
                      {formatCompact(dayData.value)}
                    </span>

                    {/* Category dots */}
                    <div className="flex items-center gap-1 mt-1">
                      {dayData.activeCategories.map((catKey) => (
                        <span
                          key={catKey}
                          className={`w-2 h-2 rounded-full ${CATEGORY_CONFIG[catKey].dotColor}`}
                        />
                      ))}
                    </div>

                    {/* Job count */}
                    <span className="text-xs text-muted mt-0.5">
                      {dayData.jobCount} job{dayData.jobCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Day Detail Panel */}
      {selectedDate && (
        <div className="bg-surface/50 border border-t-border rounded-xl p-4 mt-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">
              {formatFullDate(selectedDate)}
            </h3>
            <button
              onClick={() => setSelectedDate(null)}
              className="text-muted hover:text-foreground transition-colors p-1 rounded hover:bg-surface-2"
              aria-label="Close detail panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {selectedDayJobs.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">
              No scheduled jobs for this day
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted text-left border-b border-t-border">
                    <th className="pb-2 pr-4">Project</th>
                    <th className="pb-2 pr-4">Category</th>
                    <th className="pb-2 pr-4 text-right">Deal Value</th>
                    <th className="pb-2 pr-4">Crew</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 text-right">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDayJobs.map((job) => {
                    const catCfg = CATEGORY_CONFIG[job.categoryKey as CategoryKey];
                    return (
                      <tr
                        key={job.jobUid}
                        className="border-b border-t-border/50 hover:bg-surface-2/30"
                      >
                        <td className="py-2 pr-4">
                          <div className="font-medium text-foreground/90">
                            {job.dealName || job.title}
                          </div>
                          {job.projectNumber && (
                            <div className="text-xs text-muted">{job.projectNumber}</div>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              catCfg?.badgeBg || "bg-surface-2"
                            } ${catCfg?.badgeText || "text-muted"}`}
                          >
                            {job.category}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right font-medium text-foreground/80">
                          {formatMoney(job.dealValue)}
                        </td>
                        <td className="py-2 pr-4 text-muted">{job.assignedUser || "\u2014"}</td>
                        <td className="py-2 pr-4 text-muted">{job.statusName}</td>
                        <td className="py-2 text-right">
                          <a
                            href={`https://us-west-1c.zuperpro.com/app/job/${job.jobUid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-400 hover:text-green-300 transition-colors inline-flex items-center"
                            title="Open in Zuper"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
