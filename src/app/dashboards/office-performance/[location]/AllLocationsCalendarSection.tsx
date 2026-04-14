// src/app/dashboards/office-performance/[location]/AllLocationsCalendarSection.tsx

/**
 * All-locations calendar slide — shows events across all 5 offices.
 * Events are rendered without location filtering so the viewer sees
 * the full company schedule at a glance.
 */

"use client";

import { useMemo, useRef, useState, useEffect } from "react";
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
  ROOFING_CATEGORY_UIDS,
  EXCLUDE_OTHER_CATEGORY_UIDS,
  type RawApiProject,
  type ZuperCategoryJob,
  type DayPill,
  type CalendarEvent,
} from "@/lib/calendar-events";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import type { CanonicalLocation } from "@/lib/locations";

/** Short location abbreviations for pill labels */
const LOC_ABBR: Record<string, string> = {
  Westminster: "WM",
  Centennial: "DTC",
  "Colorado Springs": "COS",
  "San Luis Obispo": "SLO",
  Camarillo: "CAM",
};

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Show all pills — TV displays have no scroll/hover, so truncating hides events */

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

function useAllLocationsCalendarData() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Buffered date range: prev month start → next month end
  const fromDate = new Date(year, month - 2, 1);
  const toDate = new Date(year, month + 1, 0);
  const fromStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}-01`;
  const toStr = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}`;

  const projectsQuery = useQuery<{ projects?: RawApiProject[] }>({
    queryKey: queryKeys.officeCalendar.projects("all", month, year),
    queryFn: async () => {
      const res = await fetch("/api/projects?context=scheduling&refresh=true");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const serviceQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.serviceJobs("all", fromStr, toStr),
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
    queryKey: queryKeys.officeCalendar.dnrJobs("all", fromStr, toStr),
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

  const roofingQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.roofingJobs("all", fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: ROOFING_CATEGORY_UIDS,
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

  const otherQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.otherJobs("all", fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        exclude: EXCLUDE_OTHER_CATEGORY_UIDS,
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

  return { projectsQuery, serviceQuery, dnrQuery, roofingQuery, otherQuery, year, month };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function formatEventLabel(eventType: string): string {
  switch (eventType) {
    case "survey": case "survey-complete": return "Surv";
    case "construction": case "construction-complete": return "Inst";
    case "inspection": case "inspection-pass": return "Insp";
    case "inspection-fail": return "Fail";
    case "rtb": return "RTB";
    case "blocked": return "Blk";
    case "service": return "Svc";
    case "dnr": return "D&R";
    case "roofing": return "Roof";
    case "other": return "Other";
    default: return eventType;
  }
}

function EventPill({ pill, compact }: { pill: DayPill; compact?: boolean }) {
  const baseType = pill.eventType.replace(/-complete$/, "").replace(/-pass$/, "").replace(/-fail$/, "");
  const colors = EVENT_COLORS[pill.eventType] || EVENT_COLORS[baseType] || EVENT_COLORS.survey;
  const isCompleted = pill.isCompleted;
  const isOverdue = pill.isOverdue;
  const locAbbr = pill.location ? (LOC_ABBR[pill.location] || pill.location.slice(0, 3).toUpperCase()) : "";

  // Continuation pill for multi-day events (day 2+)
  if (!pill.isFirstDay) {
    return (
      <div
        className={`${compact ? "h-3" : "h-4"} rounded-sm border-l-2 flex items-center px-1 ${colors.border} ${colors.bg} ${isCompleted ? "opacity-30" : ""}`}
      >
        <span className={`${compact ? "text-[7px]" : "text-[8px]"} font-medium ${colors.text}`}>
          D{pill.dayIndex}/{pill.totalDays}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`
        rounded-sm border-l-2 px-1 ${compact ? "" : "py-px"}
        ${colors.border} ${colors.bg}
        ${isCompleted ? "opacity-30" : ""}
        ${isOverdue ? "ring-1 ring-red-500" : ""}
      `}
    >
      <div className={`${compact ? "text-[7px]" : "text-[9px]"} font-medium leading-tight truncate ${colors.text}`}>
        {locAbbr && <span className={`${compact ? "text-[6px]" : "text-[8px]"} text-slate-500 mr-0.5`}>{locAbbr}</span>}
        {formatEventLabel(pill.eventType)}
      </div>
    </div>
  );
}

/** Switch to compact pills when >N pills in a cell */
const COMPACT_THRESHOLD = 4;

function DayCell({
  dayNum,
  isToday,
  isWeekend,
  isOutsideMonth,
  pills,
}: {
  dayNum: number;
  isToday: boolean;
  isWeekend: boolean;
  isOutsideMonth: boolean;
  pills: DayPill[];
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(pills.length);

  const compact = pills.length > COMPACT_THRESHOLD;

  // Measure how many pills fit within the cell via ResizeObserver
  useEffect(() => {
    const el = cellRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cell = cellRef.current;
      const container = pillsRef.current;
      if (!cell || !container || pills.length === 0) {
        setVisibleCount(pills.length);
        return;
      }
      const children = container.children;
      const cellBottom = cell.getBoundingClientRect().bottom - 2;
      let count = 0;
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as HTMLElement;
        if (child.dataset.overflow) continue;
        if (child.getBoundingClientRect().bottom <= cellBottom) {
          count++;
        } else {
          break;
        }
      }
      setVisibleCount(count || 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pills.length, compact]);

  if (isOutsideMonth) {
    return <div className="bg-white/[0.01] rounded h-full" />;
  }

  const overflow = pills.length - visibleCount;

  return (
    <div
      ref={cellRef}
      className={`p-0.5 rounded border border-white/5 overflow-hidden h-full ${isToday ? "bg-orange-500/10 ring-1 ring-orange-500/50" : "bg-white/[0.02]"}`}
    >
      <div className={`text-[9px] font-semibold mb-0.5 ${isToday ? "text-orange-400" : isWeekend ? "text-slate-600" : "text-slate-400"}`}>
        {dayNum}
      </div>
      <div ref={pillsRef} className="flex flex-col gap-px">
        {pills.slice(0, visibleCount).map((pill, i) => (
          <EventPill key={`${pill.id}-${pill.dayIndex}-${i}`} pill={pill} compact={compact} />
        ))}
        {overflow > 0 && (
          <div data-overflow="true" className="text-[7px] text-slate-400 font-medium pl-0.5">
            +{overflow} more
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryBar({ pills }: { pills: Map<string, DayPill[]> }) {
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
    <div className="flex items-center gap-3 flex-wrap">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1 text-xs text-slate-300">
          <span className={`w-1.5 h-1.5 rounded-full ${item.dotColor}`} />
          {item.count}
        </span>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {LEGEND_ITEMS.map((item) => (
        <span key={item.label} className="flex items-center gap-1 text-[10px] text-slate-400">
          <span className={`w-1.5 h-1.5 rounded-full ${item.dotColor}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AllLocationsCalendarSection() {
  const { projectsQuery, serviceQuery, dnrQuery, roofingQuery, otherQuery, year, month } = useAllLocationsCalendarData();

  const isLoading = projectsQuery.isLoading;

  // Generate events for ALL locations (union of all)
  const allPills = useMemo(() => {
    const rawProjects = projectsQuery.data?.projects || [];
    const projects = rawProjects.map(toCalendarProject);
    const serviceJobs = serviceQuery.data?.jobs || [];
    const dnrJobs = dnrQuery.data?.jobs || [];
    const roofingJobs = roofingQuery.data?.jobs || [];
    const otherJobs = otherQuery.data?.jobs || [];

    // Generate events for each location and merge
    const allEvents: CalendarEvent[] = [];
    for (const loc of CANONICAL_LOCATIONS) {
      const projectEvents = generateProjectEvents(projects, loc as CanonicalLocation);
      const serviceEvents = generateZuperEvents(serviceJobs, "service", loc as CanonicalLocation);
      const dnrEvents = generateZuperEvents(dnrJobs, "dnr", loc as CanonicalLocation);
      const roofingEvents = generateZuperEvents(roofingJobs, "roofing", loc as CanonicalLocation);
      const otherEvents = generateZuperEvents(otherJobs, "other", loc as CanonicalLocation);
      allEvents.push(...projectEvents, ...serviceEvents, ...dnrEvents, ...roofingEvents, ...otherEvents);
    }

    // Deduplicate by event ID (same event shouldn't appear twice)
    const seen = new Set<string>();
    const unique = allEvents.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    return expandToDayPills(unique, year, month);
  }, [projectsQuery.data, serviceQuery.data, dnrQuery.data, roofingQuery.data, otherQuery.data, year, month]);

  // Build the month grid
  const grid = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const startDow = firstDay.getDay();
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

    for (let i = 0; i < startDow; i++) {
      cells.push({ dateStr: "", dayNum: 0, isToday: false, isWeekend: i === 0 || i === 6, isOutsideMonth: true });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = (startDow + d - 1) % 7;
      cells.push({ dateStr, dayNum: d, isToday: dateStr === todayStr, isWeekend: dow === 0 || dow === 6, isOutsideMonth: false });
    }

    const trailing = (7 - (cells.length % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      const dow = (cells.length) % 7;
      cells.push({ dateStr: "", dayNum: 0, isToday: false, isWeekend: dow === 0 || dow === 6, isOutsideMonth: true });
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
    <div className="h-full flex flex-col px-6 py-3 gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">
          {MONTH_NAMES[month]} {year} — All Locations
        </h2>
        <SummaryBar pills={allPills} />
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-0.5">
        {DAY_HEADERS.map((day) => (
          <div key={day} className="text-center text-[9px] font-semibold text-slate-500 uppercase tracking-wider py-0.5">
            {day}
          </div>
        ))}
      </div>

      {/* Month grid — equal row heights fill the viewport */}
      <div
        className="grid grid-cols-7 gap-0.5 flex-1 min-h-0"
        style={{ gridTemplateRows: `repeat(${Math.ceil(grid.length / 7)}, 1fr)` }}
      >
        {grid.map((cell, i) => (
          <DayCell
            key={cell.dateStr || `empty-${i}`}
            dayNum={cell.dayNum}
            isToday={cell.isToday}
            isWeekend={cell.isWeekend}
            isOutsideMonth={cell.isOutsideMonth}
            pills={cell.dateStr ? (allPills.get(cell.dateStr) || []) : []}
          />
        ))}
      </div>

      {/* Legend */}
      <Legend />
    </div>
  );
}
