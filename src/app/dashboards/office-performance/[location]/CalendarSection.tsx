"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import {
  EVENT_COLORS,
  LEGEND_ITEMS,
  type DayPill,
} from "@/lib/calendar-events";
import { useCalendarData } from "./useCalendarData";

interface CalendarSectionProps {
  location: string; // Dashboard group label (e.g. "California", "Westminster")
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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
    case "roofing": return "Roofing";
    case "other": return "Other";
    default: return eventType;
  }
}

function EventPill({ pill, compact }: { pill: DayPill; compact?: boolean }) {
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
          ${compact ? "h-5" : "h-6"} rounded-sm border-l-2 flex items-center ${compact ? "px-1" : "px-1.5"}
          ${colors.border} ${colors.bg}
          ${isCompleted ? "opacity-30" : ""}
        `}
      >
        <span className={`${compact ? "text-xs" : "text-sm"} font-medium ${colors.text} ${isCompleted ? "opacity-70" : ""}`}>
          D{pill.dayIndex}/{pill.totalDays}
        </span>
      </div>
    );
  }

  // Day label for multi-day first day
  const dayLabel = pill.totalDays > 1 ? ` D1/${pill.totalDays}` : "";

  if (compact) {
    return (
      <div
        className={`
          rounded-sm border-l-2 px-1
          ${colors.border} ${colors.bg}
          ${isCompleted ? "opacity-30" : ""}
          ${isOverdue ? "ring-1 ring-red-500" : ""}
          ${isFailed ? "ring-1 ring-amber-500" : ""}
        `}
      >
        <div className={`text-xs font-medium leading-snug truncate ${colors.text} ${isCompleted ? "opacity-70" : ""} ${isFailed ? "line-through" : ""}`}>
          {pill.name} — {formatEventLabel(pill.eventType)}{dayLabel}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`
        rounded-sm border-l-2 px-1.5 py-0.5
        ${colors.border} ${colors.bg}
        ${isCompleted ? "opacity-30" : ""}
        ${isOverdue ? "opacity-60 ring-2 ring-red-500" : ""}
        ${isFailed ? "ring-1 ring-amber-500" : ""}
      `}
    >
      <div className={`text-sm font-medium leading-snug truncate ${colors.text} ${isCompleted ? "opacity-70" : ""} ${isFailed ? "line-through" : ""}`}>
        {pill.name} — {formatEventLabel(pill.eventType)}{dayLabel}
      </div>
      {pill.assignee && (
        <div className="text-xs text-slate-400 leading-snug truncate">
          {pill.assignee}
        </div>
      )}
    </div>
  );
}

/** Height thresholds: switch to compact pills when >N pills in a cell */
const COMPACT_THRESHOLD = 3;

function DayCell({
  dateStr: _dateStr,
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
  const cellRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(pills.length);

  // Use compact pills when there are many events
  const compact = pills.length > COMPACT_THRESHOLD;

  // Measure how many pills actually fit within the cell
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
      const cellBottom = cell.getBoundingClientRect().bottom - 4;
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
      className={`p-1 rounded border border-white/5 overflow-hidden h-full ${isToday ? "bg-orange-500/10 ring-1 ring-orange-500/50" : "bg-white/[0.02]"}`}
    >
      <div className={`text-sm font-semibold mb-0.5 ${isToday ? "text-orange-400" : isWeekend ? "text-slate-600" : "text-slate-400"}`}>
        {dayNum}
      </div>
      <div ref={pillsRef} className={`flex flex-col ${compact ? "gap-px" : "gap-0.5"}`}>
        {pills.slice(0, visibleCount).map((pill, i) => (
          <EventPill key={`${pill.id}-${pill.dayIndex}-${i}`} pill={pill} compact={compact} />
        ))}
        {overflow > 0 && (
          <div data-overflow="true" className="text-xs text-slate-400 font-medium pl-1">
            +{overflow} more
          </div>
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
          <span className={`w-2.5 h-2.5 rounded-full ${item.dotColor}`} />
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
        <span key={item.label} className="flex items-center gap-1.5 text-sm text-slate-400">
          <span className={`w-2.5 h-2.5 rounded-full ${item.dotColor}`} />
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
  const { allPills, isLoading, year, month } = useCalendarData(location);

  // Build the month grid (weekdays only — Mon–Fri)
  const grid = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
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

    // Find the weekday column (0=Mon .. 4=Fri) for the 1st of the month
    const firstDow = firstDay.getDay(); // 0=Sun .. 6=Sat
    const firstWeekdayCol = firstDow === 0 ? 0 : firstDow === 6 ? 0 : firstDow - 1;

    // Leading empty cells for weekdays before the 1st
    // If the 1st is Sat/Sun, no leading empties needed (first weekday starts Mon)
    const leadingEmpties = (firstDow === 0 || firstDow === 6) ? 0 : firstWeekdayCol;
    for (let i = 0; i < leadingEmpties; i++) {
      cells.push({ dateStr: "", dayNum: 0, isToday: false, isWeekend: false, isOutsideMonth: true });
    }

    // Actual month days — skip weekends
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekends
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ dateStr, dayNum: d, isToday: dateStr === todayStr, isWeekend: false, isOutsideMonth: false });
    }

    // Trailing empty cells to complete the last week row
    const trailing = (5 - (cells.length % 5)) % 5;
    for (let i = 0; i < trailing; i++) {
      cells.push({ dateStr: "", dayNum: 0, isToday: false, isWeekend: false, isOutsideMonth: true });
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
      <div className="grid grid-cols-5 gap-1">
        {DAY_HEADERS.map((day) => (
          <div key={day} className="text-center text-sm font-semibold text-slate-500 uppercase tracking-wider py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Month grid — equal row heights fill the viewport */}
      <div
        className="grid grid-cols-5 gap-1 flex-1 min-h-0"
        style={{ gridTemplateRows: `repeat(${Math.ceil(grid.length / 5)}, 1fr)` }}
      >
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
