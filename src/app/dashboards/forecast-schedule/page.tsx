"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import {
  buildForecastGhosts,
  type TimelineProject,
  type RawProjectMinimal,
  type ForecastGhost,
} from "@/lib/forecast-ghosts";

// ── Constants ──────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STAGE_LABELS: Record<string, string> = {
  survey: "Survey",
  rtb: "RTB",
  blocked: "Blocked",
  design: "D&E",
  permitting: "P&I",
};

const STAGE_COLORS: Record<string, string> = {
  survey: "bg-cyan-500",
  rtb: "bg-blue-500",
  blocked: "bg-red-500",
  design: "bg-purple-500",
  permitting: "bg-amber-500",
};

function formatRevenueCompact(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return String(Math.round(amount));
}

function getCustomerName(name: string): string {
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

// ── Page ───────────────────────────────────────────────────────

export default function ForecastSchedulePage() {
  useActivityTracking();
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());

  // Filters
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);

  // Data fetching
  const { data, isLoading, error } = useQuery<{
    timelineProjects: TimelineProject[];
    rawProjects: RawProjectMinimal[];
    lastUpdated: string;
  }>({
    queryKey: ["forecast-schedule"],
    queryFn: async () => {
      const [timelineRes, rawRes] = await Promise.all([
        fetch("/api/forecasting/timeline"),
        fetch("/api/projects"),
      ]);
      if (!timelineRes.ok) throw new Error("Failed to fetch forecasts");
      const timeline = await timelineRes.json();
      const raw = rawRes.ok ? await rawRes.json() : { projects: [] };
      return {
        timelineProjects: timeline.projects,
        rawProjects: raw.projects,
        lastUpdated: new Date().toISOString(),
      };
    },
    refetchInterval: 5 * 60 * 1000,
  });

  // Build all forecast ghosts (including overdue — this page shows everything)
  const allGhosts = useMemo((): ForecastGhost[] => {
    if (!data) return [];
    return buildForecastGhosts({
      timelineProjects: data.timelineProjects,
      rawProjects: data.rawProjects,
      scheduledEventIds: new Set(),
      manualInstallationIds: new Set(),
    });
  }, [data]);

  // Apply filters — affect BOTH calendar and sidebar (single source of truth)
  const filteredGhosts = useMemo(() => {
    return allGhosts.filter((g) => {
      if (selectedLocations.length > 0 && !selectedLocations.includes(g.location)) return false;
      if (selectedStages.length > 0 && !selectedStages.includes(g.stage)) return false;
      return true;
    });
  }, [allGhosts, selectedLocations, selectedStages]);

  // Overdue split (local date, not UTC)
  const todayLocal = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const overdueGhosts = useMemo(() => filteredGhosts.filter((g) => g.date < todayLocal), [filteredGhosts, todayLocal]);

  // Available filter options (from unfiltered ghosts so options don't disappear)
  const allLocations = useMemo(() => [...new Set(allGhosts.map((g) => g.location))].sort(), [allGhosts]);
  const allStages = useMemo(() => [...new Set(allGhosts.map((g) => g.stage))].sort(), [allGhosts]);

  // Pipeline breakdown (from filteredGhosts)
  const stageBreakdown = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const g of filteredGhosts) {
      if (!map[g.stage]) map[g.stage] = { count: 0, revenue: 0 };
      map[g.stage].count++;
      map[g.stage].revenue += g.amount;
    }
    return Object.entries(map).sort(([a], [b]) => {
      const order = ["survey", "rtb", "blocked", "design", "permitting"];
      return order.indexOf(a) - order.indexOf(b);
    });
  }, [filteredGhosts]);

  const locationBreakdown = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const g of filteredGhosts) {
      if (!map[g.location]) map[g.location] = { count: 0, revenue: 0 };
      map[g.location].count++;
      map[g.location].revenue += g.amount;
    }
    return Object.entries(map).sort(([, a], [, b]) => b.revenue - a.revenue);
  }, [filteredGhosts]);

  const totalRevenue = useMemo(() => filteredGhosts.reduce((s, g) => s + g.amount, 0), [filteredGhosts]);
  const overdueRevenue = useMemo(() => overdueGhosts.reduce((s, g) => s + g.amount, 0), [overdueGhosts]);

  // Calendar data (7-day grid)
  const calendarData = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startDay = firstDay.getDay(); // 0=Sun through 6=Sat
    const daysInMonth = lastDay.getDate();
    return { startDay, daysInMonth };
  }, [currentYear, currentMonth]);

  // Events grouped by date string for calendar lookup
  const eventsByDate = useMemo(() => {
    const map: Record<string, ForecastGhost[]> = {};
    for (const g of filteredGhosts) {
      if (!map[g.date]) map[g.date] = [];
      map[g.date].push(g);
    }
    return map;
  }, [filteredGhosts]);

  // Navigation
  const goToPrevMonth = () => {
    if (currentMonth === 0) { setCurrentYear((y) => y - 1); setCurrentMonth(11); }
    else setCurrentMonth((m) => m - 1);
  };
  const goToNextMonth = () => {
    if (currentMonth === 11) { setCurrentYear((y) => y + 1); setCurrentMonth(0); }
    else setCurrentMonth((m) => m + 1);
  };
  const goToToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
  };

  const toggleLocation = (loc: string) => {
    setSelectedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  };
  const toggleStage = (stage: string) => {
    setSelectedStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    );
  };

  return (
    <DashboardShell title="Forecast Schedule" accentColor="blue" lastUpdated={data?.lastUpdated} fullWidth>
      {isLoading ? (
        <div className="flex items-center justify-center h-96"><LoadingSpinner /></div>
      ) : error ? (
        <ErrorState message="Failed to load forecast data" />
      ) : (
        <div className="flex flex-col h-full">
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-t-border bg-surface flex-wrap">
            <span className="text-[0.6rem] font-semibold text-muted uppercase tracking-wide mr-1">Stage</span>
            {allStages.map((stage) => (
              <button
                key={stage}
                onClick={() => toggleStage(stage)}
                className={`px-1.5 py-0.5 text-[0.55rem] rounded border transition-colors ${
                  selectedStages.includes(stage)
                    ? "border-blue-400 text-blue-400 bg-blue-500/10"
                    : "border-t-border text-muted opacity-60 hover:border-muted"
                }`}
              >
                {STAGE_LABELS[stage] || stage}
              </button>
            ))}
            <span className="w-px h-4 bg-t-border mx-1" />
            <span className="text-[0.6rem] font-semibold text-muted uppercase tracking-wide mr-1">Location</span>
            {allLocations.map((loc) => (
              <button
                key={loc}
                onClick={() => toggleLocation(loc)}
                className={`px-1.5 py-0.5 text-[0.55rem] rounded border transition-colors ${
                  selectedLocations.includes(loc)
                    ? "border-blue-400 text-blue-400 bg-blue-500/10"
                    : "border-t-border text-muted opacity-60 hover:border-muted"
                }`}
              >
                {loc}
              </button>
            ))}
            {(selectedLocations.length > 0 || selectedStages.length > 0) && (
              <button
                onClick={() => { setSelectedLocations([]); setSelectedStages([]); }}
                className="px-1.5 py-0.5 text-[0.55rem] text-red-400 hover:text-red-300 transition-colors"
              >
                Clear filters
              </button>
            )}
            <span className="ml-auto text-[0.55rem] text-blue-400/70">
              {filteredGhosts.length} forecasted{overdueGhosts.length > 0 && (
                <span className="text-amber-400/80"> / {overdueGhosts.length} overdue</span>
              )}
            </span>
          </div>

          {/* Main content: calendar + sidebar */}
          <div className="flex flex-1 overflow-hidden">
            {/* Calendar */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Month navigation */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-t-border">
                <div className="flex items-center gap-2">
                  <button
                    onClick={goToPrevMonth}
                    className="p-1 text-muted hover:text-foreground rounded hover:bg-surface-2 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <h2 className="text-sm font-bold text-foreground min-w-[140px] text-center">
                    {MONTH_NAMES[currentMonth]} {currentYear}
                  </h2>
                  <button
                    onClick={goToNextMonth}
                    className="p-1 text-muted hover:text-foreground rounded hover:bg-surface-2 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                  <button
                    onClick={goToToday}
                    className="text-[0.6rem] px-2 py-0.5 rounded border border-t-border text-muted hover:text-foreground hover:border-muted transition-colors"
                  >
                    Today
                  </button>
                </div>
              </div>

              {/* Calendar grid */}
              <div className="flex-1 overflow-y-auto p-2">
                {/* Day headers */}
                <div className="grid grid-cols-7 gap-px mb-px">
                  {DAY_NAMES.map((day, i) => (
                    <div
                      key={day}
                      className={`text-center text-[0.6rem] font-semibold py-1 ${
                        i === 0 || i === 6 ? "text-muted/50" : "text-muted"
                      }`}
                    >
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar cells */}
                <div className="grid grid-cols-7 gap-px bg-t-border/30 border border-t-border rounded">
                  {/* Empty cells before first day */}
                  {Array.from({ length: calendarData.startDay }).map((_, i) => (
                    <div key={`empty-${i}`} className="bg-surface-2/50 min-h-[90px]" />
                  ))}

                  {/* Day cells */}
                  {Array.from({ length: calendarData.daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const date = new Date(currentYear, currentMonth, day);
                    const dow = date.getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const isToday = dateStr === todayLocal;
                    const dayEvents = eventsByDate[dateStr] || [];

                    return (
                      <div
                        key={day}
                        className={`min-h-[90px] max-h-[160px] overflow-y-auto p-1 relative ${
                          isWeekend ? "bg-surface-2/50 opacity-60" : "bg-surface"
                        } ${isToday ? "ring-2 ring-inset ring-blue-500" : ""}`}
                      >
                        <div className={`text-[0.65rem] font-semibold mb-0.5 ${
                          isToday ? "text-blue-400" : isWeekend ? "text-muted/50" : "text-muted"
                        }`}>
                          {day}
                        </div>
                        {dayEvents.map((ev, ei) => {
                          const shortName = getCustomerName(ev.name).substring(0, 12);
                          const isOverdue = ev.date < todayLocal;

                          return (
                            <a
                              key={ei}
                              href={ev.hubspotUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`${ev.name} — ${STAGE_LABELS[ev.stage] || ev.stage} — $${formatRevenueCompact(ev.amount)}${isOverdue ? " (OVERDUE)" : ""}`}
                              className={`block text-[0.5rem] px-1 py-0.5 rounded mb-0.5 truncate transition-transform hover:scale-[1.02] hover:shadow-lg hover:z-10 relative cursor-pointer ${
                                isOverdue
                                  ? "bg-amber-500/30 text-amber-200 border border-dashed border-amber-500 opacity-70"
                                  : "bg-blue-500/40 text-blue-200 border border-dashed border-blue-400 opacity-60"
                              }`}
                            >
                              <span className="mr-0.5 text-[0.4rem] font-bold opacity-80">
                                {isOverdue ? "OVERDUE" : "FORECAST"}
                              </span>
                              {shortName}
                            </a>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Pipeline Sidebar */}
            <aside className="w-[220px] bg-surface border-l border-t-border flex flex-col overflow-y-auto max-[1000px]:hidden">
              {/* Header */}
              <div className="p-2.5 border-b border-t-border">
                <h2 className="text-[0.65rem] font-bold text-foreground/90 uppercase tracking-wide">
                  Pipeline Breakdown
                </h2>
                <p className="text-[0.5rem] text-muted mt-0.5">
                  {filteredGhosts.length} forecasted · ${formatRevenueCompact(totalRevenue)}
                </p>
              </div>

              {/* Overdue callout */}
              {overdueGhosts.length > 0 && (
                <div className="px-2.5 py-2 border-b border-t-border bg-amber-500/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm border border-dashed border-amber-500 bg-amber-500/30" />
                      <span className="text-[0.6rem] font-medium text-amber-400">Overdue</span>
                    </div>
                    <span className="text-[0.65rem] font-mono font-bold text-amber-400 opacity-80">
                      {overdueGhosts.length} · ${formatRevenueCompact(overdueRevenue)}
                    </span>
                  </div>
                  <p className="text-[0.45rem] text-muted mt-0.5 leading-tight">
                    Forecasted installs past predicted date
                  </p>
                </div>
              )}

              {/* By Stage */}
              <div className="p-2.5 border-b border-t-border">
                <div className="text-[0.55rem] font-semibold text-muted uppercase tracking-wide mb-2">By Stage</div>
                <div className="space-y-1.5">
                  {stageBreakdown.map(([stage, { count, revenue }]) => (
                    <div key={stage} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-sm ${STAGE_COLORS[stage] || "bg-zinc-500"}`} />
                        <span className="text-[0.6rem] text-foreground/80">{STAGE_LABELS[stage] || stage}</span>
                      </div>
                      <span className="text-[0.6rem] font-mono font-semibold text-foreground/70">
                        {count} · ${formatRevenueCompact(revenue)}
                      </span>
                    </div>
                  ))}
                  {stageBreakdown.length === 0 && (
                    <p className="text-[0.55rem] text-muted italic">No forecasts match filters</p>
                  )}
                </div>
              </div>

              {/* By Location */}
              <div className="p-2.5 flex-1">
                <div className="text-[0.55rem] font-semibold text-muted uppercase tracking-wide mb-2">By Location</div>
                <div className="space-y-1.5">
                  {locationBreakdown.map(([location, { count, revenue }]) => (
                    <div key={location} className="flex items-center justify-between">
                      <span className="text-[0.6rem] text-foreground/80 truncate mr-2">{location}</span>
                      <span className="text-[0.6rem] font-mono font-semibold text-foreground/70 whitespace-nowrap">
                        {count} · ${formatRevenueCompact(revenue)}
                      </span>
                    </div>
                  ))}
                  {locationBreakdown.length === 0 && (
                    <p className="text-[0.55rem] text-muted italic">No forecasts match filters</p>
                  )}
                </div>
              </div>

              {/* Totals */}
              <div className="p-2.5 border-t border-t-border bg-surface-2">
                <div className="text-[0.55rem] font-semibold text-muted uppercase tracking-wide mb-1">Total</div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-sm border border-dashed border-blue-400 bg-blue-500/40" />
                    <span className="text-[0.6rem] text-foreground/80">Forecasted</span>
                  </div>
                  <span className="text-[0.65rem] font-mono font-bold text-blue-300 opacity-80">
                    {filteredGhosts.length} · ${formatRevenueCompact(totalRevenue)}
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
