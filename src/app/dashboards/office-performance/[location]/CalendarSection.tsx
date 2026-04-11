"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  generateProjectEvents,
  generateZuperEvents,
  expandToDayPills,
  toCalendarProject,
  EVENT_COLORS,
  LEGEND_ITEMS,
  SERVICE_CATEGORY_UIDS,
  DNR_CATEGORY_UIDS,
  type RawApiProject,
  type ZuperCategoryJob,
  type DayPill,
} from "@/lib/calendar-events";
import type { CanonicalLocation } from "@/lib/locations";

interface CalendarSectionProps {
  location: string; // Canonical location name
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Max visible pills per day cell before showing "+N more" */
const MAX_VISIBLE_PILLS = 3;

// ---------------------------------------------------------------------------
// Data fetching hooks
// ---------------------------------------------------------------------------

function useCalendarData(location: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed

  // Buffered date range for Zuper: prev month start → next month end
  const fromDate = new Date(year, month - 2, 1);
  const toDate = new Date(year, month + 1, 0);
  const fromStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}-01`;
  const toStr = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}`;

  const projectsQuery = useQuery<{ projects?: RawApiProject[] }>({
    queryKey: queryKeys.officeCalendar.projects(location, month, year),
    queryFn: async () => {
      const res = await fetch("/api/projects?context=scheduling&refresh=true");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const serviceQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.serviceJobs(location, fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: SERVICE_CATEGORY_UIDS,
        from_date: fromStr,
        to_date: toStr,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const dnrQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.dnrJobs(location, fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: DNR_CATEGORY_UIDS,
        from_date: fromStr,
        to_date: toStr,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  return { projectsQuery, serviceQuery, dnrQuery, year, month };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function formatEventLabel(eventType: string): string {
  switch (eventType) {
    case "survey": case "survey-complete": return "Survey";
    case "construction": case "construction-complete": return "Install";
    case "inspection": case "inspection-pass": return "Inspection";
    case "inspection-fail": return "Insp Fail";
    case "rtb": return "RTB";
    case "blocked": return "Blocked";
    case "service": return "Service";
    case "dnr": return "D&R";
    default: return eventType;
  }
}

function EventPill({ pill }: { pill: DayPill }) {
  const baseType = pill.eventType.replace(/-complete$/, "").replace(/-pass$/, "").replace(/-fail$/, "");
  const colors = EVENT_COLORS[pill.eventType] || EVENT_COLORS[baseType] || EVENT_COLORS.survey;

  const isCompleted = pill.isCompleted;
  const isFailed = pill.isFailed;
  const isOverdue = pill.isOverdue;

  // Continuation pill for multi-day events (day 2+)
  if (!pill.isFirstDay) {
    return (
      <div
        className={`
          h-5 rounded-sm border-l-2 flex items-center px-1.5
          ${colors.border} ${colors.bg}
          ${isCompleted ? "opacity-30" : ""}
        `}
      >
        <span className={`text-[10px] font-medium ${colors.text} ${isCompleted ? "opacity-70" : ""}`}>
          D{pill.dayIndex}/{pill.totalDays}
        </span>
      </div>
    );
  }

  // Day label for multi-day first day
  const dayLabel = pill.totalDays > 1 ? ` D1/${pill.totalDays}` : "";

  return (
    <div
      className={`
        rounded-sm border-l-2 px-1.5 py-0.5 min-h-[28px]
        ${colors.border} ${colors.bg}
        ${isCompleted ? "opacity-30" : ""}
        ${isOverdue ? "opacity-60 ring-1 ring-red-500" : ""}
        ${isFailed ? "ring-1 ring-amber-500" : ""}
      `}
    >
      <div className={`text-[11px] font-medium leading-tight truncate ${colors.text} ${isCompleted ? "opacity-70" : ""} ${isFailed ? "line-through" : ""}`}>
        {pill.name} — {formatEventLabel(pill.eventType)}{dayLabel}
      </div>
      {pill.assignee && (
        <div className="text-[9px] text-slate-400 leading-tight truncate">
          {pill.assignee}
        </div>
      )}
    </div>
  );
}

function DayCell({
  dateStr,
  dayNum,
  isToday,
  isWeekend,
  isOutsideMonth,
  pills,
}: {
  dateStr: string;
  dayNum: number;
  isToday: boolean;
  isWeekend: boolean;
  isOutsideMonth: boolean;
  pills: DayPill[];
}) {
  if (isOutsideMonth) {
    return <div className="min-h-[80px] bg-white/[0.01] rounded" />;
  }

  const visible = pills.slice(0, MAX_VISIBLE_PILLS);
  const overflow = pills.length - MAX_VISIBLE_PILLS;

  return (
    <div className={`min-h-[80px] p-1 rounded border border-white/5 overflow-hidden ${isToday ? "bg-orange-500/10 ring-1 ring-orange-500/50" : "bg-white/[0.02]"}`}>
      <div className={`text-[10px] font-semibold mb-0.5 ${isToday ? "text-orange-400" : isWeekend ? "text-slate-600" : "text-slate-400"}`}>
        {dayNum}
      </div>
      <div className="flex flex-col gap-0.5">
        {visible.map((pill, i) => (
          <EventPill key={`${pill.id}-${pill.dayIndex}-${i}`} pill={pill} />
        ))}
        {overflow > 0 && (
          <div className="text-[9px] text-slate-500 pl-1">+{overflow} more</div>
        )}
      </div>
    </div>
  );
}

function SummaryBar({ pills }: { pills: Map<string, DayPill[]> }) {
  // Count unique events by base type (dedupe by event ID)
  const counts = new Map<string, Set<string>>();
  for (const dayPills of pills.values()) {
    for (const pill of dayPills) {
      if (pill.isFirstDay || pill.totalDays === 1) {
        const base = pill.eventType.replace(/-complete$/, "").replace(/-pass$/, "").replace(/-fail$/, "");
        if (!counts.has(base)) counts.set(base, new Set());
        counts.get(base)!.add(pill.id);
      }
    }
  }

  const items: { label: string; count: number; dotColor: string }[] = [];
  for (const legend of LEGEND_ITEMS) {
    const key = legend.label.toLowerCase().replace("install", "construction").replace("d&r", "dnr");
    const count = counts.get(key)?.size || 0;
    if (count > 0) {
      items.push({ label: legend.label, count, dotColor: legend.dotColor });
    }
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-sm text-slate-300">
          <span className={`w-2 h-2 rounded-full ${item.dotColor}`} />
          {item.count} {item.label}{item.count !== 1 ? "s" : ""}
        </span>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {LEGEND_ITEMS.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className={`w-2 h-2 rounded-full ${item.dotColor}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CalendarSection({ location }: CalendarSectionProps) {
  const { projectsQuery, serviceQuery, dnrQuery, year, month } = useCalendarData(location);

  const isLoading = projectsQuery.isLoading;

  // Generate all events
  const allPills = useMemo(() => {
    const rawProjects = projectsQuery.data?.projects || [];
    const projects = rawProjects.map(toCalendarProject);
    const serviceJobs = serviceQuery.data?.jobs || [];
    const dnrJobs = dnrQuery.data?.jobs || [];

    const loc = location as CanonicalLocation;
    const projectEvents = generateProjectEvents(projects, loc);
    const serviceEvents = generateZuperEvents(serviceJobs, "service", loc);
    const dnrEvents = generateZuperEvents(dnrJobs, "dnr", loc);

    const allEvents = [...projectEvents, ...serviceEvents, ...dnrEvents];
    return expandToDayPills(allEvents, year, month);
  }, [projectsQuery.data, serviceQuery.data, dnrQuery.data, location, year, month]);

  // Build the month grid
  const grid = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const startDow = firstDay.getDay(); // 0=Sun
    const daysInMonth = new Date(year, month, 0).getDate();

    const cells: {
      dateStr: string;
      dayNum: number;
      isToday: boolean;
      isWeekend: boolean;
      isOutsideMonth: boolean;
    }[] = [];

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Leading empty cells for days before the 1st
    for (let i = 0; i < startDow; i++) {
      cells.push({
        dateStr: "",
        dayNum: 0,
        isToday: false,
        isWeekend: i === 0 || i === 6,
        isOutsideMonth: true,
      });
    }

    // Actual month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = (startDow + d - 1) % 7;
      cells.push({
        dateStr,
        dayNum: d,
        isToday: dateStr === todayStr,
        isWeekend: dow === 0 || dow === 6,
        isOutsideMonth: false,
      });
    }

    // Trailing empty cells to complete the last week
    const trailing = (7 - (cells.length % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      const dow = (cells.length) % 7;
      cells.push({
        dateStr: "",
        dayNum: 0,
        isToday: false,
        isWeekend: dow === 0 || dow === 6,
        isOutsideMonth: true,
      });
    }

    return cells;
  }, [year, month]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-slate-400 text-sm">Loading calendar...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col px-6 py-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">
          {MONTH_NAMES[month]} {year}
        </h2>
        <SummaryBar pills={allPills} />
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1">
        {DAY_HEADERS.map((day) => (
          <div key={day} className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-1 flex-1">
        {grid.map((cell, i) => (
          <DayCell
            key={cell.dateStr || `empty-${i}`}
            dateStr={cell.dateStr}
            dayNum={cell.dayNum}
            isToday={cell.isToday}
            isWeekend={cell.isWeekend}
            isOutsideMonth={cell.isOutsideMonth}
            pills={cell.dateStr ? (allPills.get(cell.dateStr) || []) : []}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="pt-1">
        <Legend />
      </div>
    </div>
  );
}
