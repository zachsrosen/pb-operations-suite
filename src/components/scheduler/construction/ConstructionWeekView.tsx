"use client";

import React, { useCallback, useMemo } from "react";
import type {
  ConstructionDayAvailability,
  ConstructionSchedulerProject,
} from "./types";

interface ConstructionWeekViewProps<T extends ConstructionSchedulerProject> {
  weekStartDate: string;
  dayNames: string[];
  todayStr: string;
  projects: T[];
  manualSchedules: Record<string, string>;
  tentativeRecordIds: Record<string, string>;
  selectedProject: T | null;
  availabilityByDate: Record<string, ConstructionDayAvailability>;
  showAvailability: boolean;
  getEffectiveInstallStartDate: (project: T) => string | null;
  getEffectiveInstallDays: (project: T) => number;
  isInstallOverdue: (project: T, manualScheduleDate?: string) => boolean;
  getCustomerName: (name: string) => string;
  formatShortDate: (dateStr: string | null | undefined) => string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (dateStr: string) => void;
  onDateClick: (dateStr: string) => void;
  onEventDragStart: (projectId: string, e: React.DragEvent) => void;
  onEventClick: (project: T, dateStr: string, e: React.MouseEvent) => void;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addCalendarDaysYmd(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function isWeekend(dateStr: string): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.getDay() === 0 || d.getDay() === 6;
}

export function ConstructionWeekView<T extends ConstructionSchedulerProject>({
  weekStartDate,
  dayNames,
  todayStr,
  projects,
  manualSchedules,
  tentativeRecordIds,
  selectedProject,
  availabilityByDate,
  showAvailability,
  getEffectiveInstallStartDate,
  getEffectiveInstallDays,
  isInstallOverdue,
  getCustomerName,
  formatShortDate,
  onPrev,
  onNext,
  onToday,
  onDragOver,
  onDrop,
  onDateClick,
  onEventDragStart,
  onEventClick,
}: ConstructionWeekViewProps<T>) {
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, idx) => addCalendarDaysYmd(weekStartDate, idx));
  }, [weekStartDate]);

  const eventsForDate = useCallback(
    (dateStr: string): Array<T & { dayNum: number; totalDays: number }> => {
      const results: Array<T & { dayNum: number; totalDays: number }> = [];
      projects.forEach((project) => {
        const schedDate = manualSchedules[project.id] || getEffectiveInstallStartDate(project);
        if (!schedDate) return;
        const businessDays = getEffectiveInstallDays(project);
        const startDate = new Date(schedDate + "T12:00:00");
        let bDayCount = 0;
        let calOffset = 0;
        while (bDayCount < businessDays) {
          const checkDate = new Date(startDate);
          checkDate.setDate(checkDate.getDate() + calOffset);
          const dow = checkDate.getDay();
          if (dow !== 0 && dow !== 6) {
            if (toDateStr(checkDate) === dateStr) {
              results.push({ ...project, dayNum: bDayCount + 1, totalDays: businessDays });
              return;
            }
            bDayCount++;
          }
          calOffset++;
        }
      });
      return results;
    },
    [projects, manualSchedules, getEffectiveInstallStartDate, getEffectiveInstallDays]
  );

  return (
    <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
      <div className="p-3 border-b border-t-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onPrev} className="p-1.5 hover:bg-surface-2 rounded">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-lg font-semibold min-w-[260px] text-center">
            Week of {formatShortDate(weekStartDate)} - {formatShortDate(addCalendarDaysYmd(weekStartDate, 6))}
          </span>
          <button onClick={onNext} className="p-1.5 hover:bg-surface-2 rounded">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <button onClick={onToday} className="px-3 py-1 text-xs bg-surface-2 hover:bg-surface-2 rounded">
          Today
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-t-border">
        {weekDays.map((dateStr, idx) => (
          <div key={dateStr} className="p-2 text-center border-r border-t-border last:border-r-0">
            <div className="text-xs font-medium text-muted">{dayNames[idx]}</div>
            <div className={`text-xs mt-0.5 ${dateStr === todayStr ? "text-emerald-400 font-semibold" : "text-foreground/80"}`}>
              {formatShortDate(dateStr)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {weekDays.map((dateStr) => {
          const weekend = isWeekend(dateStr);
          const isToday = dateStr === todayStr;
          const events = eventsForDate(dateStr);
          const dayAvailability = availabilityByDate[dateStr];
          const hasAvailability = dayAvailability?.hasAvailability && !dayAvailability?.isFullyBooked;
          const isFullyBooked = dayAvailability?.isFullyBooked;
          return (
            <div
              key={dateStr}
              onDragOver={onDragOver}
              onDrop={() => onDrop(dateStr)}
              onClick={() => onDateClick(dateStr)}
              className={`min-h-[360px] p-2 border-r border-b border-t-border last:border-r-0 cursor-pointer transition-colors ${
                weekend ? "bg-surface/30" : ""
              } ${isToday ? "bg-emerald-900/20" : ""} ${
                selectedProject ? "hover:bg-emerald-900/10" : "hover:bg-skeleton"
              } ${
                showAvailability && hasAvailability && selectedProject
                  ? "ring-2 ring-inset ring-emerald-500/30 bg-emerald-900/10"
                  : ""
              } ${
                showAvailability && isFullyBooked && selectedProject && !weekend
                  ? "ring-2 ring-inset ring-red-500/20 bg-red-900/5"
                  : ""
              }`}
            >
              <div className="space-y-1">
                {events.map((ev) => {
                  const overdue = isInstallOverdue(ev, manualSchedules[ev.id]);
                  const isTentative =
                    !!tentativeRecordIds[ev.id] || ev.installStatus.toLowerCase().includes("tentative");
                  return (
                    <div
                      key={`${ev.id}-w${dateStr}-d${ev.dayNum}`}
                      draggable
                      onDragStart={(e) => onEventDragStart(ev.id, e)}
                      onClick={(e) => onEventClick(ev, dateStr, e)}
                      className={`text-xs p-1 rounded truncate cursor-grab active:cursor-grabbing ${
                        overdue
                          ? "bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30"
                          : isTentative
                            ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
                            : "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30"
                      }`}
                    >
                      {overdue && <span className="text-red-400 mr-0.5">⚠</span>}
                      {!overdue && isTentative && <span className="text-amber-300 mr-0.5">TENT</span>}
                      {ev.totalDays > 1 && <span className="font-semibold mr-0.5">D{ev.dayNum}</span>}
                      {getCustomerName(ev.name)}
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
}
