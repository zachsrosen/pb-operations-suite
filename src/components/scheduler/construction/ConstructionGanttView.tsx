"use client";

import React, { useMemo } from "react";
import { getBusinessDatesInSpan } from "@/lib/scheduling-utils";
import type { ConstructionSchedulerProject } from "./types";

interface ConstructionGanttViewProps<T extends ConstructionSchedulerProject> {
  ganttStartDate: string;
  projects: T[];
  manualSchedules: Record<string, string>;
  getEffectiveInstallStartDate: (project: T) => string | null;
  getEffectiveInstallDays: (project: T) => number;
  getCustomerName: (name: string) => string;
  formatShortDate: (dateStr: string | null | undefined) => string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSelectProject: (project: T) => void;
  onOpenSchedule: (project: T, date: string) => void;
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

function getNextWeekdays(dateStr: string, count: number): string[] {
  const days: string[] = [];
  let cursor = dateStr;
  while (days.length < count) {
    if (!isWeekend(cursor)) days.push(cursor);
    cursor = addCalendarDaysYmd(cursor, 1);
  }
  return days;
}

export function ConstructionGanttView<T extends ConstructionSchedulerProject>({
  ganttStartDate,
  projects,
  manualSchedules,
  getEffectiveInstallStartDate,
  getEffectiveInstallDays,
  getCustomerName,
  formatShortDate,
  onPrev,
  onNext,
  onToday,
  onSelectProject,
  onOpenSchedule,
}: ConstructionGanttViewProps<T>) {
  const ganttDays = useMemo(() => {
    return getNextWeekdays(ganttStartDate, 20);
  }, [ganttStartDate]);

  const ganttRows = useMemo(() => {
    return projects
      .map((project) => {
        const startDate = manualSchedules[project.id] || getEffectiveInstallStartDate(project);
        if (!startDate) return null;
        const span = getBusinessDatesInSpan(startDate, getEffectiveInstallDays(project));
        const endDate = span[span.length - 1] || startDate;
        const startIndex = ganttDays.indexOf(startDate);
        const endIndex = ganttDays.indexOf(endDate);
        const visibleStart = startIndex >= 0 ? startIndex : ganttDays.findIndex((d) => d > startDate);
        const visibleEnd = endIndex >= 0
          ? endIndex
          : (() => {
              const idx = ganttDays.findIndex((d) => d > endDate);
              return idx === -1 ? ganttDays.length - 1 : idx - 1;
            })();
        if (visibleStart === -1 || visibleStart >= ganttDays.length || visibleEnd < 0) return null;
        return {
          project,
          startDate,
          endDate,
          visibleStart,
          visibleEnd,
        };
      })
      .filter(
        (row): row is {
          project: T;
          startDate: string;
          endDate: string;
          visibleStart: number;
          visibleEnd: number;
        } => !!row
      )
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [projects, manualSchedules, ganttDays, getEffectiveInstallStartDate, getEffectiveInstallDays]);

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
            Gantt {formatShortDate(ganttDays[0])} - {formatShortDate(ganttDays[ganttDays.length - 1])}
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

      {ganttRows.length === 0 ? (
        <div className="p-6 text-sm text-muted text-center">No scheduled projects in this timeline window.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1100px]">
            <div className="flex border-b border-t-border bg-surface/50">
              <div className="w-56 p-2 text-xs font-semibold text-muted uppercase tracking-wide border-r border-t-border">
                Project
              </div>
              <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${ganttDays.length}, minmax(42px, 1fr))` }}>
                {ganttDays.map((day) => (
                  <div key={`gantt-h-${day}`} className="p-1 text-[0.65rem] text-center text-muted border-r border-t-border last:border-r-0">
                    {formatShortDate(day)}
                  </div>
                ))}
              </div>
            </div>
            {ganttRows.map((row) => (
              <div key={`gantt-r-${row.project.id}`} className="flex border-b border-t-border hover:bg-surface/40">
                <div className="w-56 p-2 border-r border-t-border">
                  <button onClick={() => onSelectProject(row.project)} className="text-left w-full">
                    <div className="text-sm text-foreground truncate hover:text-emerald-300">
                      {getCustomerName(row.project.name)}
                    </div>
                    <div className="text-[0.68rem] text-muted truncate">
                      {formatShortDate(row.startDate)} - {formatShortDate(row.endDate)}
                    </div>
                  </button>
                </div>
                <div className="flex-1 grid relative" style={{ gridTemplateColumns: `repeat(${ganttDays.length}, minmax(42px, 1fr))` }}>
                  {ganttDays.map((day) => (
                    <div key={`gantt-c-${row.project.id}-${day}`} className="h-12 border-r border-t-border/60 last:border-r-0" />
                  ))}
                  <button
                    onClick={() => onOpenSchedule(row.project, row.startDate)}
                    className="z-10 mx-0.5 my-2 rounded bg-emerald-500/30 border border-emerald-500/40 hover:bg-emerald-500/45 text-[0.68rem] text-emerald-200 truncate px-1"
                    style={{ gridColumn: `${row.visibleStart + 1} / ${row.visibleEnd + 2}` }}
                    title={`${getCustomerName(row.project.name)} | ${formatShortDate(row.startDate)} - ${formatShortDate(row.endDate)}`}
                  >
                    {getCustomerName(row.project.name)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
