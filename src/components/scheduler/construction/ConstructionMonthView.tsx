"use client";

import React, { useCallback, useMemo } from "react";
import { toDateStr } from "@/lib/scheduling-utils";
import type {
  ConstructionDayAvailability,
  ConstructionSchedulerProject,
} from "./types";

interface ConstructionMonthViewProps<T extends ConstructionSchedulerProject> {
  currentYear: number;
  currentMonth: number;
  monthNames: string[];
  dayNames: string[];
  todayStr: string;
  projects: T[];
  manualSchedules: Record<string, string>;
  tentativeRecordIds: Record<string, string>;
  selectedProject: T | null;
  availabilityByDate: Record<string, ConstructionDayAvailability>;
  showAvailability: boolean;
  zuperConfigured: boolean;
  loadingSlots: boolean;
  getEffectiveInstallStartDate: (project: T) => string | null;
  getEffectiveInstallDays: (project: T) => number;
  isInstallOverdue: (project: T, manualScheduleDate?: string) => boolean;
  getCustomerName: (name: string) => string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (dateStr: string) => void;
  onDateClick: (dateStr: string) => void;
  onEventDragStart: (projectId: string, e: React.DragEvent) => void;
  onEventClick: (project: T, dateStr: string, e: React.MouseEvent) => void;
}

function isWeekend(dateStr: string): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.getDay() === 0 || d.getDay() === 6;
}

export function ConstructionMonthView<T extends ConstructionSchedulerProject>({
  currentYear,
  currentMonth,
  monthNames,
  dayNames,
  todayStr,
  projects,
  manualSchedules,
  tentativeRecordIds,
  selectedProject,
  availabilityByDate,
  showAvailability,
  zuperConfigured,
  loadingSlots,
  getEffectiveInstallStartDate,
  getEffectiveInstallDays,
  isInstallOverdue,
  getCustomerName,
  onPrev,
  onNext,
  onToday,
  onDragOver,
  onDrop,
  onDateClick,
  onEventDragStart,
  onEventClick,
}: ConstructionMonthViewProps<T>) {
  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startDow = ((firstDay.getDay() + 6) % 7) + 1;
    const days: string[] = [];

    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth, -i);
      days.push(toDateStr(d));
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(`${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`);
    }

    while (days.length % 7 !== 0) {
      const lastDate = new Date(days[days.length - 1] + "T12:00:00");
      lastDate.setDate(lastDate.getDate() + 1);
      days.push(toDateStr(lastDate));
    }

    return days;
  }, [currentYear, currentMonth]);

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
          <span className="text-lg font-semibold min-w-[180px] text-center">
            {monthNames[currentMonth]} {currentYear}
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
        {showAvailability && zuperConfigured && (
          <div className="flex items-center gap-3 text-xs text-muted">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-emerald-500 rounded-full" />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-yellow-500/60 rounded-full" />
              <span>Limited</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-red-500/60 rounded-full" />
              <span>Booked</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-7 border-b border-t-border">
        {dayNames.map((day) => (
          <div key={day} className="p-2 text-center text-xs font-medium text-muted">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {calendarDays.map((dateStr) => {
          const [year, month] = dateStr.split("-").map(Number);
          const isCurrentMonth = month - 1 === currentMonth && year === currentYear;
          const isToday = dateStr === todayStr;
          const weekend = isWeekend(dateStr);
          const events = eventsForDate(dateStr);
          const dayAvailability = availabilityByDate[dateStr];
          const hasAvailability = dayAvailability?.hasAvailability && !dayAvailability?.isFullyBooked;
          const isFullyBooked = dayAvailability?.isFullyBooked;
          const slotCount = dayAvailability?.availableSlots?.length || 0;

          return (
            <div
              key={dateStr}
              onDragOver={onDragOver}
              onDrop={() => onDrop(dateStr)}
              onClick={() => onDateClick(dateStr)}
              className={`min-h-[110px] max-h-[180px] overflow-y-auto p-1.5 border-b border-r border-t-border cursor-pointer transition-colors ${
                isCurrentMonth ? "" : "opacity-40"
              } ${weekend ? "bg-surface/30" : ""} ${isToday ? "bg-emerald-900/20" : ""} ${
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
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${isToday ? "text-emerald-400" : "text-muted"}`}>
                  {parseInt(dateStr.split("-")[2])}
                </span>
                {showAvailability && zuperConfigured && isCurrentMonth && !weekend && (
                  <div className="flex items-center gap-0.5">
                    {loadingSlots ? (
                      <div className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" />
                    ) : hasAvailability ? (
                      <div className="flex items-center gap-0.5" title={`${slotCount} slot${slotCount !== 1 ? "s" : ""} available`}>
                        <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                        {slotCount > 1 && <span className="text-[0.55rem] text-emerald-400">{slotCount}</span>}
                      </div>
                    ) : isFullyBooked ? (
                      <div className="w-2 h-2 bg-red-500/60 rounded-full" title="Fully booked" />
                    ) : dayAvailability ? (
                      <div className="w-2 h-2 bg-yellow-500/60 rounded-full" title="Limited availability" />
                    ) : null}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                {events.map((ev) => {
                  const overdue = isInstallOverdue(ev, manualSchedules[ev.id]);
                  const isTentative =
                    !!tentativeRecordIds[ev.id] || ev.installStatus.toLowerCase().includes("tentative");
                  return (
                    <div
                      key={`${ev.id}-d${ev.dayNum}`}
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
                      title={
                        overdue
                          ? "Overdue - install not completed. Drag to reschedule"
                          : `${getCustomerName(ev.name)} - Day ${ev.dayNum}/${ev.totalDays}. Drag to reschedule`
                      }
                    >
                      {overdue && <span className="text-red-400 mr-0.5">⚠</span>}
                      {!overdue && isTentative && <span className="text-amber-300 mr-0.5">TENT</span>}
                      {ev.totalDays > 1 && <span className="font-semibold mr-0.5">D{ev.dayNum}</span>}
                      {getCustomerName(ev.name)}
                    </div>
                  );
                })}
                {showAvailability && selectedProject && hasAvailability &&
                  (dayAvailability?.availableSlots || [])
                    .filter((slot) => {
                      const projectLocation = selectedProject.location;
                      if (!projectLocation) return true;
                      if (!slot.location) return true;
                      if (slot.location === projectLocation) return true;
                      if (
                        (slot.location === "DTC" || slot.location === "Centennial") &&
                        (projectLocation === "DTC" || projectLocation === "Centennial")
                      ) {
                        return true;
                      }
                      return false;
                    })
                    .slice(0, 2)
                    .map(
                      (slot, i) =>
                        slot.user_name && (
                          <div key={i} className="text-[0.55rem] text-emerald-400/70 truncate">
                            {slot.user_name} {slot.display_time && <span className="text-emerald-500/50">{slot.display_time}</span>}
                          </div>
                        )
                    )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
