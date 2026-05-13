"use client";

import { useMemo } from "react";
import { EVENT_COLORS, LEGEND_ITEMS, type DayPill } from "@/lib/calendar-events";
import { useCalendarData } from "./useCalendarData";

interface CalendarDaySectionProps {
  location: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

function DayEventCard({ pill }: { pill: DayPill }) {
  const baseType = pill.eventType.replace(/-complete$/, "").replace(/-pass$/, "").replace(/-fail$/, "");
  const colors = EVENT_COLORS[pill.eventType] || EVENT_COLORS[baseType] || EVENT_COLORS.survey;

  const dayLabel = pill.totalDays > 1
    ? ` — Day ${pill.dayIndex} of ${pill.totalDays}`
    : "";

  return (
    <div
      className={`
        rounded-lg border-l-4 px-5 py-3
        ${colors.border} ${colors.bg}
        ${pill.isCompleted ? "opacity-30" : ""}
        ${pill.isOverdue ? "ring-2 ring-red-500/60" : ""}
        ${pill.isFailed ? "ring-2 ring-amber-500/60" : ""}
      `}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className={`text-xl font-bold truncate ${colors.text} ${pill.isCompleted ? "opacity-70" : ""} ${pill.isFailed ? "line-through" : ""}`}>
            {pill.isFirstDay ? pill.name : `(cont.) ${pill.name}`}
          </div>
          {pill.assignee && pill.isFirstDay && (
            <div className="text-base text-slate-400 mt-1">
              Assigned: {pill.assignee}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-lg font-semibold ${colors.text}`}>
            {formatEventLabel(pill.eventType)}
          </span>
          {dayLabel && (
            <span className="text-sm text-slate-500">{dayLabel}</span>
          )}
          {pill.isOverdue && (
            <span className="text-sm font-semibold text-red-400">OVERDUE</span>
          )}
          {pill.isCompleted && (
            <span className="text-sm font-semibold text-green-400">COMPLETED</span>
          )}
          {pill.isFailed && (
            <span className="text-sm font-semibold text-amber-400">FAILED</span>
          )}
        </div>
      </div>
    </div>
  );
}

function EventTypeGroup({ eventType, pills }: { eventType: string; pills: DayPill[] }) {
  const baseType = eventType.replace(/-complete$/, "").replace(/-pass$/, "").replace(/-fail$/, "");
  const colors = EVENT_COLORS[eventType] || EVENT_COLORS[baseType] || EVENT_COLORS.survey;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${colors.border.replace("border-", "bg-")}`} />
        <span className="text-sm font-semibold text-slate-400 tracking-wider uppercase">
          {formatEventLabel(eventType)} ({pills.length})
        </span>
      </div>
      {pills.map((pill, i) => (
        <DayEventCard key={`${pill.id}-${pill.dayIndex}-${i}`} pill={pill} />
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

export default function CalendarDaySection({ location }: CalendarDaySectionProps) {
  const { allPills, isLoading } = useCalendarData(location);

  const today = useMemo(() => {
    const now = new Date();
    return {
      dateStr: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      dayName: DAY_NAMES[now.getDay()],
      monthName: MONTH_NAMES[now.getMonth() + 1],
      dayNum: now.getDate(),
      year: now.getFullYear(),
    };
  }, []);

  const todayPills = allPills.get(today.dateStr) || [];

  // Group pills by event type for organized display
  const groupedPills = useMemo(() => {
    const groups = new Map<string, DayPill[]>();
    // Define display order
    const order = ["survey", "construction", "inspection", "service", "dnr", "roofing", "rtb", "blocked", "other"];
    for (const pill of todayPills) {
      const base = pill.eventType.replace(/-complete$/, "").replace(/-pass$/, "").replace(/-fail$/, "");
      const existing = groups.get(base);
      if (existing) {
        existing.push(pill);
      } else {
        groups.set(base, [pill]);
      }
    }
    // Sort by defined order
    const sorted: { eventType: string; pills: DayPill[] }[] = [];
    for (const type of order) {
      const pills = groups.get(type);
      if (pills) sorted.push({ eventType: type, pills });
    }
    // Add any remaining types not in the order
    for (const [type, pills] of groups) {
      if (!order.includes(type)) sorted.push({ eventType: type, pills });
    }
    return sorted;
  }, [todayPills]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-slate-400 text-sm">Loading today&apos;s schedule...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col px-8 py-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">
          {today.dayName}
          <span className="text-lg text-slate-400 font-normal ml-3">
            {today.monthName} {today.dayNum}, {today.year}
          </span>
        </h2>
        <div className="flex items-center gap-6">
          <span className="text-lg text-slate-300 font-semibold">
            {todayPills.length} event{todayPills.length !== 1 ? "s" : ""} today
          </span>
          <Legend />
        </div>
      </div>

      {/* Events */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {todayPills.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-6xl mb-4">📭</div>
              <div className="text-2xl text-slate-400 font-medium">No events scheduled today</div>
              <div className="text-base text-slate-500 mt-2">Enjoy the quiet day!</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {groupedPills.map(({ eventType, pills }) => (
              <EventTypeGroup key={eventType} eventType={eventType} pills={pills} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
