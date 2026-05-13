"use client";

import { useMemo } from "react";
import { EVENT_COLORS, LEGEND_ITEMS, type DayPill } from "@/lib/calendar-events";
import { useCalendarData } from "./useCalendarData";

interface CalendarWeekSectionProps {
  location: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

function WeekEventPill({ pill }: { pill: DayPill }) {
  const baseType = pill.eventType.replace(/-complete$/, "").replace(/-pass$/, "").replace(/-fail$/, "");
  const colors = EVENT_COLORS[pill.eventType] || EVENT_COLORS[baseType] || EVENT_COLORS.survey;

  const dayLabel = pill.totalDays > 1
    ? ` D${pill.dayIndex}/${pill.totalDays}`
    : "";

  return (
    <div
      className={`
        rounded border-l-3 px-3 py-1.5
        ${colors.border} ${colors.bg}
        ${pill.isCompleted ? "opacity-30" : ""}
        ${pill.isOverdue ? "ring-2 ring-red-500" : ""}
        ${pill.isFailed ? "ring-1 ring-amber-500" : ""}
      `}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={`text-base font-semibold truncate ${colors.text} ${pill.isCompleted ? "opacity-70" : ""} ${pill.isFailed ? "line-through" : ""}`}>
          {pill.isFirstDay ? pill.name : `(cont.) ${pill.name}`}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-sm font-medium ${colors.text} opacity-80`}>
            {formatEventLabel(pill.eventType)}{dayLabel}
          </span>
          {pill.isOverdue && <span className="text-red-400 text-sm">Overdue</span>}
        </div>
      </div>
      {pill.assignee && pill.isFirstDay && (
        <div className="text-sm text-slate-400 mt-0.5 truncate">
          {pill.assignee}
        </div>
      )}
    </div>
  );
}

function WeekDayColumn({
  dateStr,
  dayName,
  dayNum,
  monthName,
  isToday,
  pills,
}: {
  dateStr: string;
  dayName: string;
  dayNum: number;
  monthName: string;
  isToday: boolean;
  pills: DayPill[];
}) {
  return (
    <div
      className={`flex flex-col rounded-lg border overflow-hidden h-full ${
        isToday
          ? "bg-orange-500/10 border-orange-500/40"
          : "bg-white/[0.02] border-white/5"
      }`}
    >
      {/* Day header */}
      <div
        className={`px-4 py-2 border-b ${
          isToday ? "border-orange-500/30 bg-orange-500/5" : "border-white/5"
        }`}
      >
        <div className={`text-lg font-bold ${isToday ? "text-orange-400" : "text-slate-300"}`}>
          {dayName}
        </div>
        <div className={`text-sm ${isToday ? "text-orange-400/70" : "text-slate-500"}`}>
          {monthName} {dayNum}
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {pills.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-600 text-sm italic">
            No events
          </div>
        ) : (
          pills.map((pill, i) => (
            <WeekEventPill key={`${pill.id}-${pill.dayIndex}-${i}`} pill={pill} />
          ))
        )}
      </div>

      {/* Event count badge */}
      {pills.length > 0 && (
        <div className={`px-4 py-1.5 border-t text-sm font-medium ${
          isToday ? "border-orange-500/30 text-orange-400/80" : "border-white/5 text-slate-500"
        }`}>
          {pills.length} event{pills.length !== 1 ? "s" : ""}
        </div>
      )}
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

/**
 * Returns the Mon–Fri dates for the current work week.
 */
function getCurrentWorkWeek(): { dateStr: string; dayName: string; dayNum: number; monthName: string; isToday: boolean }[] {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Find Monday of the current week
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day === 0 ? 7 : day) - 1));

  const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const days: { dateStr: string; dayName: string; dayNum: number; monthName: string; isToday: boolean }[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({
      dateStr,
      dayName: DAY_NAMES[d.getDay()],
      dayNum: d.getDate(),
      monthName: MONTH_SHORT[d.getMonth() + 1],
      isToday: dateStr === todayStr,
    });
  }
  return days;
}

export default function CalendarWeekSection({ location }: CalendarWeekSectionProps) {
  const { allPills, isLoading } = useCalendarData(location);

  const weekDays = useMemo(() => getCurrentWorkWeek(), []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-slate-400 text-sm">Loading week view...</div>
        </div>
      </div>
    );
  }

  // Count total events this week
  const totalEvents = weekDays.reduce((sum, d) => sum + (allPills.get(d.dateStr)?.length || 0), 0);

  return (
    <div className="h-full flex flex-col px-6 py-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">
          This Week
          <span className="text-lg text-slate-400 font-normal ml-3">
            {weekDays[0].monthName} {weekDays[0].dayNum} – {weekDays[4].monthName} {weekDays[4].dayNum}
          </span>
        </h2>
        <div className="flex items-center gap-6">
          <span className="text-lg text-slate-300 font-semibold">
            {totalEvents} event{totalEvents !== 1 ? "s" : ""}
          </span>
          <Legend />
        </div>
      </div>

      {/* 5-column week grid */}
      <div className="grid grid-cols-5 gap-2 flex-1 min-h-0">
        {weekDays.map((day) => (
          <WeekDayColumn
            key={day.dateStr}
            dateStr={day.dateStr}
            dayName={day.dayName}
            dayNum={day.dayNum}
            monthName={day.monthName}
            isToday={day.isToday}
            pills={allPills.get(day.dateStr) || []}
          />
        ))}
      </div>
    </div>
  );
}
