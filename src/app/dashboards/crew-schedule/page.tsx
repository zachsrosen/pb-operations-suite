"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { queryKeys } from "@/lib/query-keys";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CrewMember {
  id: string;
  name: string;
  role: string;
  locations: string[];
  teamName: string | null;
}

interface Assignment {
  id: string;
  source: string;
  crewMemberName: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  jobType: string;
  pbLocation: string | null;
  projectId: string;
  projectName: string;
  dealValue: number | null;
  status: string;
  schedulerPath: string;
}

interface CrewScheduleResponse {
  crew: CrewMember[];
  assignments: Assignment[];
  dateRange: { start: string; end: string };
}

type Period = "week" | "2weeks" | "month";
type ViewMode = "grid" | "cards";
type GroupBy = "location" | "jobType";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const JOB_TYPE_BORDER_CLASSES: Record<string, string> = {
  survey: "border-l-blue-500",
  construction: "border-l-orange-500",
  installation: "border-l-orange-500",
  inspection: "border-l-green-500",
  service: "border-l-purple-500",
  dnr: "border-l-rose-500",
  roofing: "border-l-rose-500",
};

const JOB_TYPE_BADGE_CLASSES: Record<string, string> = {
  survey: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  construction: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  installation: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  inspection: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  service: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  dnr: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  roofing: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

const DEFAULT_BADGE_CLASS = "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";

/* ------------------------------------------------------------------ */
/*  Formatting Helpers                                                 */
/* ------------------------------------------------------------------ */

function formatDealValue(amount: number | null | undefined): string {
  if (amount == null) return "—";
  if (amount < 1000) return `$${Math.round(amount)}`;
  return `$${Math.round(amount / 1000)}k`;
}

function formatTimeShort(time: string | null | undefined): string {
  if (!time) return "";
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || "0", 10);
  const suffix = h >= 12 ? "p" : "a";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m > 0 ? `${h12}:${mStr}${suffix}` : `${h12}${suffix}`;
}

function formatTimeWindow(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  if (start && end) return `${formatTimeShort(start)}–${formatTimeShort(end)}`;
  if (start) return formatTimeShort(start);
  return formatTimeShort(end);
}

function getBusinessDays(start: string, end: string): string[] {
  const days: string[] = [];
  const d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (d <= endD) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) {
      days.push(d.toISOString().slice(0, 10));
    }
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateStr(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatDateShortLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/*  localStorage helpers (safe for SSR)                                */
/* ------------------------------------------------------------------ */

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded — ignore */
  }
}

/* ------------------------------------------------------------------ */
/*  Date Range Computation                                             */
/* ------------------------------------------------------------------ */

function computeDateRange(
  baseDate: Date,
  period: Period,
  selectedDay: string | null
): { start: string; end: string } {
  if (selectedDay) return { start: selectedDay, end: selectedDay };

  const monday = getMondayOfWeek(baseDate);

  if (period === "week") {
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    return {
      start: monday.toISOString().slice(0, 10),
      end: friday.toISOString().slice(0, 10),
    };
  }

  if (period === "2weeks") {
    const end = new Date(monday);
    end.setDate(monday.getDate() + 11); // Mon + 11 = second Friday
    return {
      start: monday.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }

  // month
  const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const last = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
  };
}

function shiftBase(base: Date, period: Period, direction: -1 | 1): Date {
  const d = new Date(base);
  if (period === "week") d.setDate(d.getDate() + direction * 7);
  else if (period === "2weeks") d.setDate(d.getDate() + direction * 14);
  else d.setMonth(d.getMonth() + direction);
  return d;
}

/* ------------------------------------------------------------------ */
/*  Grouping Logic                                                     */
/* ------------------------------------------------------------------ */

interface GroupedSection {
  label: string;
  crew: CrewMember[];
}

function groupCrew(
  crew: CrewMember[],
  groupBy: GroupBy
): GroupedSection[] {
  if (groupBy === "location") {
    const map = new Map<string, CrewMember[]>();
    for (const c of crew) {
      const loc = c.locations[0] || "Other";
      if (!map.has(loc)) map.set(loc, []);
      map.get(loc)!.push(c);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, members]) => ({ label, crew: members }));
  }

  // groupBy === "jobType"
  const map = new Map<string, CrewMember[]>();
  for (const c of crew) {
    const jt = capitalize(c.role || "other");
    if (!map.has(jt)) map.set(jt, []);
    map.get(jt)!.push(c);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, members]) => ({ label, crew: members }));
}

function groupAssignmentsByJobType(
  assignments: Assignment[]
): Map<string, Assignment[]> {
  const map = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const key = capitalize(a.jobType || "other");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Grid Skeleton                                                      */
/* ------------------------------------------------------------------ */

function GridSkeleton({ cols }: { cols: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, r) => (
        <div key={r} className="flex gap-1">
          <div className="w-36 h-10 animate-pulse bg-surface-2 rounded" />
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="flex-1 h-10 animate-pulse bg-surface-2 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Grid Cell                                                          */
/* ------------------------------------------------------------------ */

function GridCell({
  assignments,
  isDrillDown,
}: {
  assignments: Assignment[];
  isDrillDown: boolean;
}) {
  if (assignments.length === 0) {
    return <span className="text-muted text-xs">&mdash;</span>;
  }

  return (
    <div className="space-y-1">
      {assignments.map((a) => (
        <Link
          key={a.id}
          href={a.schedulerPath}
          title={`${a.projectName} | ${a.jobType} | ${formatDealValue(a.dealValue)} | ${formatTimeWindow(a.startTime, a.endTime) || "No time"}`}
          className="block group"
        >
          <div className="text-xs leading-tight">
            <span className="text-foreground group-hover:underline">
              {isDrillDown ? a.projectName : truncate(a.projectName, 20)}
            </span>
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              <span
                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
                  JOB_TYPE_BADGE_CLASSES[a.jobType.toLowerCase()] || DEFAULT_BADGE_CLASS
                }`}
              >
                {capitalize(a.jobType)}
              </span>
              <span className="text-muted text-[10px]">
                {formatDealValue(a.dealValue)}
              </span>
            </div>
            {(a.startTime || a.endTime) && (
              <span className="text-muted text-[10px]">
                {formatTimeWindow(a.startTime, a.endTime)}
              </span>
            )}
            {isDrillDown && a.pbLocation && (
              <span className="text-muted text-[10px] block">{a.pbLocation}</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Grid View                                                          */
/* ------------------------------------------------------------------ */

function GridView({
  sections,
  dates,
  assignmentMap,
  isDrillDown,
}: {
  sections: GroupedSection[];
  dates: string[];
  assignmentMap: Map<string, Assignment[]>;
  isDrillDown: boolean;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full border-collapse min-w-[600px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface text-left text-xs font-semibold text-muted px-2 py-2 w-36 min-w-[144px]">
              Crew
            </th>
            {dates.map((d) => (
              <th
                key={d}
                className={`text-center text-xs font-semibold px-1 py-2 ${
                  d === todayStr
                    ? "bg-blue-50 dark:bg-blue-950/20"
                    : "text-muted"
                }`}
              >
                <div>{formatDayOfWeek(d)}</div>
                <div className="font-normal">{formatDateShortLabel(d)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <React.Fragment key={section.label}>
              {/* Section header */}
              <tr>
                <td
                  colSpan={dates.length + 1}
                  className="bg-surface-2 px-2 py-1.5 text-xs font-bold text-foreground tracking-wide uppercase"
                >
                  {section.label}
                </td>
              </tr>
              {/* Crew rows */}
              {section.crew.map((member) => (
                <tr
                  key={member.id}
                  className="border-t border-t-border hover:bg-surface-2/50 transition-colors"
                >
                  <td className="sticky left-0 z-10 bg-surface px-2 py-2 text-sm font-medium text-foreground whitespace-nowrap">
                    {member.name}
                  </td>
                  {dates.map((d) => {
                    const key = `${member.name}::${d}`;
                    const cellAssignments = assignmentMap.get(key) || [];
                    return (
                      <td
                        key={d}
                        className={`px-1 py-1.5 align-top ${
                          d === todayStr
                            ? "bg-blue-50 dark:bg-blue-950/20"
                            : ""
                        }`}
                      >
                        <GridCell
                          assignments={cellAssignments}
                          isDrillDown={isDrillDown}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Card Component                                                     */
/* ------------------------------------------------------------------ */

function AssignmentCard({
  assignment,
  isDrillDown,
}: {
  assignment: Assignment;
  isDrillDown: boolean;
}) {
  const borderClass =
    JOB_TYPE_BORDER_CLASSES[assignment.jobType.toLowerCase()] || "border-l-gray-400";
  const badgeClass =
    JOB_TYPE_BADGE_CLASSES[assignment.jobType.toLowerCase()] || DEFAULT_BADGE_CLASS;

  return (
    <div
      className={`bg-surface rounded-lg shadow-card border border-t-border border-l-4 ${borderClass} p-2.5 space-y-1`}
    >
      <div className="font-medium text-sm text-foreground">
        {assignment.crewMemberName}
      </div>
      <div className="text-sm text-muted truncate" title={assignment.projectName}>
        {isDrillDown ? assignment.projectName : truncate(assignment.projectName, 30)}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${badgeClass}`}
        >
          {capitalize(assignment.jobType)}
        </span>
        <span className="text-xs text-muted">{formatDealValue(assignment.dealValue)}</span>
      </div>
      {(assignment.startTime || assignment.endTime) && (
        <div className="text-xs text-muted">
          {formatTimeWindow(assignment.startTime, assignment.endTime)}
        </div>
      )}
      {assignment.pbLocation && (
        <div className="text-xs text-muted">{assignment.pbLocation}</div>
      )}
      <Link
        href={assignment.schedulerPath}
        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
      >
        View <span aria-hidden="true">&rarr;</span>
      </Link>
    </div>
  );
}

function AvailableCard({ name }: { name: string }) {
  return (
    <div className="bg-surface-2 rounded-lg border border-t-border p-2.5 opacity-60">
      <div className="font-medium text-sm text-foreground">{name}</div>
      <div className="text-xs text-muted italic">Available</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cards View                                                         */
/* ------------------------------------------------------------------ */

function CardsView({
  sections,
  dates,
  assignmentMap,
  allAssignments,
  groupBy,
  isDrillDown,
}: {
  sections: GroupedSection[];
  dates: string[];
  assignmentMap: Map<string, Assignment[]>;
  allAssignments: Assignment[];
  groupBy: GroupBy;
  isDrillDown: boolean;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);

  if (groupBy === "location") {
    return (
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-3 min-w-[600px]">
          {dates.map((d) => (
            <div
              key={d}
              className={`flex-1 min-w-[180px] rounded-lg p-2 ${
                d === todayStr ? "bg-blue-50/50 dark:bg-blue-950/10" : ""
              }`}
            >
              {/* Day header */}
              <div className="text-center mb-3">
                <div className="text-xs font-semibold text-muted">{formatDayOfWeek(d)}</div>
                <div className="text-sm font-semibold text-foreground">{formatDateShortLabel(d)}</div>
              </div>
              {/* Sections */}
              {sections.map((section) => {
                const sectionCards: React.ReactNode[] = [];
                for (const member of section.crew) {
                  const key = `${member.name}::${d}`;
                  const assigns = assignmentMap.get(key) || [];
                  if (assigns.length > 0) {
                    for (const a of assigns) {
                      sectionCards.push(
                        <AssignmentCard key={a.id} assignment={a} isDrillDown={isDrillDown} />
                      );
                    }
                  } else {
                    sectionCards.push(
                      <AvailableCard key={`avail-${member.id}-${d}`} name={member.name} />
                    );
                  }
                }
                if (sectionCards.length === 0) return null;
                return (
                  <div key={section.label} className="mb-3">
                    <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 px-0.5">
                      {section.label}
                    </div>
                    <div className="space-y-2">{sectionCards}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // groupBy === "jobType" — group assignments per day by jobType
  const allCrewNames = new Set(sections.flatMap((s) => s.crew.map((c) => c.name)));

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="flex gap-3 min-w-[600px]">
        {dates.map((d) => {
          const dayAssignments = allAssignments.filter((a) => a.date === d);
          const jtGroups = groupAssignmentsByJobType(dayAssignments);
          const assignedNames = new Set(dayAssignments.map((a) => a.crewMemberName));
          const unassigned = Array.from(allCrewNames).filter((n) => !assignedNames.has(n));

          return (
            <div
              key={d}
              className={`flex-1 min-w-[180px] rounded-lg p-2 ${
                d === todayStr ? "bg-blue-50/50 dark:bg-blue-950/10" : ""
              }`}
            >
              <div className="text-center mb-3">
                <div className="text-xs font-semibold text-muted">{formatDayOfWeek(d)}</div>
                <div className="text-sm font-semibold text-foreground">{formatDateShortLabel(d)}</div>
              </div>
              {Array.from(jtGroups.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([jtLabel, assigns]) => (
                  <div key={jtLabel} className="mb-3">
                    <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 px-0.5">
                      {jtLabel}
                    </div>
                    <div className="space-y-2">
                      {assigns.map((a) => (
                        <AssignmentCard key={a.id} assignment={a} isDrillDown={isDrillDown} />
                      ))}
                    </div>
                  </div>
                ))}
              {unassigned.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 px-0.5">
                    Available
                  </div>
                  <div className="space-y-2">
                    {unassigned.map((name) => (
                      <AvailableCard key={`avail-${name}-${d}`} name={name} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SVG Icons (inline, lightweight)                                    */
/* ------------------------------------------------------------------ */

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function CardsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="14" height="4" rx="1" />
      <rect x="1" y="7" width="14" height="4" rx="1" />
      <rect x="1" y="13" width="14" height="2" rx="1" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 12L6 8L10 4" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4L10 8L6 12" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function CrewSchedulePage() {
  const { trackDashboardView } = useActivityTracking();

  // -- Persisted state --
  const [viewMode, setViewMode] = useState<ViewMode>(() => readLocal("crew-schedule-view", "grid"));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => readLocal("crew-schedule-group", "location"));

  // -- Ephemeral state --
  const [period, setPeriod] = useState<Period>("week");
  const [baseDate, setBaseDate] = useState<Date>(() => getMondayOfWeek(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<string[]>([]);

  // Persist view mode and group-by
  useEffect(() => { writeLocal("crew-schedule-view", viewMode); }, [viewMode]);
  useEffect(() => { writeLocal("crew-schedule-group", groupBy); }, [groupBy]);

  // -- Computed date range --
  const dateRange = useMemo(
    () => computeDateRange(baseDate, period, selectedDay),
    [baseDate, period, selectedDay]
  );
  const businessDays = useMemo(
    () => getBusinessDays(dateRange.start, dateRange.end),
    [dateRange]
  );

  // -- Data fetch --
  const { data, isLoading, error } = useQuery<CrewScheduleResponse>({
    queryKey: queryKeys.crewSchedule.list(dateRange.start, dateRange.end),
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.start,
        endDate: dateRange.end,
      });
      const res = await fetch(`/api/crew-schedule?${params}`);
      if (!res.ok) throw new Error(`Failed to load crew schedule: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  // -- Activity tracking --
  useEffect(() => {
    if (!isLoading && data) {
      trackDashboardView("crew-schedule", {
        projectCount: data.assignments.length,
      });
    }
  }, [isLoading, data, trackDashboardView]);

  // -- Filter crew by location --
  const filteredCrew = useMemo(() => {
    if (!data) return [];
    if (locationFilter.length === 0) return data.crew;
    return data.crew.filter((c) =>
      c.locations.some((loc) => locationFilter.includes(loc))
    );
  }, [data, locationFilter]);

  const filteredCrewNames = useMemo(
    () => new Set(filteredCrew.map((c) => c.name)),
    [filteredCrew]
  );

  const filteredAssignments = useMemo(() => {
    if (!data) return [];
    return data.assignments.filter((a) => filteredCrewNames.has(a.crewMemberName));
  }, [data, filteredCrewNames]);

  // -- Build assignment lookup map: "crewName::YYYY-MM-DD" → Assignment[] --
  const assignmentMap = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of filteredAssignments) {
      const key = `${a.crewMemberName}::${a.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [filteredAssignments]);

  // -- Grouping --
  const sections = useMemo(
    () => groupCrew(filteredCrew, groupBy),
    [filteredCrew, groupBy]
  );

  // -- Location filter options --
  const locationOptions = useMemo<FilterOption[]>(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const c of data.crew) {
      for (const loc of c.locations) set.add(loc);
    }
    return Array.from(set)
      .sort()
      .map((loc) => ({ value: loc, label: loc }));
  }, [data]);

  // -- Date range label --
  const dateRangeLabel = useMemo(() => {
    if (selectedDay) return formatDateStr(selectedDay);
    if (businessDays.length === 0) return "";
    const first = businessDays[0];
    const last = businessDays[businessDays.length - 1];
    return `${formatDateShortLabel(first)} – ${formatDateShortLabel(last)}`;
  }, [selectedDay, businessDays]);

  // -- Nav handlers --
  const goToday = useCallback(() => {
    setBaseDate(getMondayOfWeek(new Date()));
    setSelectedDay(null);
  }, []);

  const goPrev = useCallback(() => {
    setBaseDate((d) => shiftBase(d, period, -1));
    setSelectedDay(null);
  }, [period]);

  const goNext = useCallback(() => {
    setBaseDate((d) => shiftBase(d, period, 1));
    setSelectedDay(null);
  }, [period]);

  const handleDayClick = useCallback((dateStr: string) => {
    setSelectedDay(dateStr);
  }, []);

  const isDrillDown = selectedDay !== null;

  // -- Summary stats --
  const stats = useMemo(() => {
    const totalCrew = filteredCrew.length;
    const totalAssignments = filteredAssignments.length;
    const uniqueDays = new Set(filteredAssignments.map((a) => a.date)).size;
    const totalValue = filteredAssignments.reduce(
      (sum, a) => sum + (a.dealValue || 0),
      0
    );
    return { totalCrew, totalAssignments, uniqueDays, totalValue };
  }, [filteredCrew, filteredAssignments]);

  return (
    <DashboardShell title="Crew Schedule" accentColor="blue" fullWidth>
      {/* ---- Summary Stats ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-surface rounded-lg border border-t-border shadow-card px-3 py-2">
          <div className="text-xs text-muted">Crew Members</div>
          <div className="text-lg font-bold text-foreground">{stats.totalCrew}</div>
        </div>
        <div className="bg-surface rounded-lg border border-t-border shadow-card px-3 py-2">
          <div className="text-xs text-muted">Assignments</div>
          <div className="text-lg font-bold text-foreground">{stats.totalAssignments}</div>
        </div>
        <div className="bg-surface rounded-lg border border-t-border shadow-card px-3 py-2">
          <div className="text-xs text-muted">Active Days</div>
          <div className="text-lg font-bold text-foreground">{stats.uniqueDays}</div>
        </div>
        <div className="bg-surface rounded-lg border border-t-border shadow-card px-3 py-2">
          <div className="text-xs text-muted">Total Value</div>
          <div className="text-lg font-bold text-foreground">{formatDealValue(stats.totalValue)}</div>
        </div>
      </div>

      {/* ---- Controls ---- */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Left: Navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={goPrev}
            className="p-1.5 rounded-md bg-surface border border-t-border hover:bg-surface-2 transition-colors text-foreground"
            aria-label="Previous period"
          >
            <ChevronLeft />
          </button>
          <button
            onClick={goToday}
            className="px-2.5 py-1 rounded-md bg-surface border border-t-border hover:bg-surface-2 transition-colors text-xs font-medium text-foreground"
          >
            Today
          </button>
          <button
            onClick={goNext}
            className="p-1.5 rounded-md bg-surface border border-t-border hover:bg-surface-2 transition-colors text-foreground"
            aria-label="Next period"
          >
            <ChevronRight />
          </button>
          <span className="ml-2 text-sm font-medium text-foreground hidden sm:inline">
            {dateRangeLabel}
          </span>
        </div>

        {/* Center: Period pills */}
        <div className="flex items-center gap-0.5 bg-surface-2 rounded-lg p-0.5 mx-auto sm:mx-0">
          {(["week", "2weeks", "month"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => { setPeriod(p); setSelectedDay(null); }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                period === p
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {p === "week" ? "Week" : p === "2weeks" ? "2 Weeks" : "Month"}
            </button>
          ))}
        </div>

        {/* Right: View + Group toggles + Location filter */}
        <div className="flex items-center gap-2 ml-auto">
          {/* View toggle */}
          <div className="flex items-center gap-0.5 bg-surface-2 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === "grid"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
              aria-label="Grid view"
              title="Grid view"
            >
              <GridIcon />
            </button>
            <button
              onClick={() => setViewMode("cards")}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === "cards"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
              aria-label="Cards view"
              title="Cards view"
            >
              <CardsIcon />
            </button>
          </div>

          {/* Group toggle */}
          <div className="flex items-center gap-0.5 bg-surface-2 rounded-lg p-0.5">
            <button
              onClick={() => setGroupBy("location")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                groupBy === "location"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              By Location
            </button>
            <button
              onClick={() => setGroupBy("jobType")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                groupBy === "jobType"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              By Job Type
            </button>
          </div>

          {/* Location filter */}
          {locationOptions.length > 0 && (
            <MultiSelectFilter
              label="Location"
              options={locationOptions}
              selected={locationFilter}
              onChange={setLocationFilter}
              accentColor="blue"
            />
          )}
        </div>
      </div>

      {/* ---- Day Drill-Down Back Button ---- */}
      {isDrillDown && (
        <button
          onClick={() => setSelectedDay(null)}
          className="mb-3 px-3 py-1.5 rounded-md bg-surface border border-t-border hover:bg-surface-2 transition-colors text-xs font-medium text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft />
          Back to {period === "week" ? "Week" : period === "2weeks" ? "2 Weeks" : "Month"}
        </button>
      )}

      {/* ---- Loading State ---- */}
      {isLoading && <GridSkeleton cols={businessDays.length || 5} />}

      {/* ---- Error State ---- */}
      {error && !isLoading && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-400">
          Failed to load crew schedule. Please try again.
        </div>
      )}

      {/* ---- Empty State ---- */}
      {!isLoading && !error && data && filteredCrew.length === 0 && (
        <div className="bg-surface rounded-lg border border-t-border shadow-card p-8 text-center">
          <p className="text-muted">No active crew members found</p>
        </div>
      )}

      {/* ---- Clickable Column Headers (non-drill-down) ---- */}
      {!isLoading && !error && data && filteredCrew.length > 0 && !isDrillDown && viewMode === "grid" && (
        <div className="overflow-x-auto -mx-4 px-4 mb-1">
          <div className="flex min-w-[600px]">
            <div className="w-36 min-w-[144px]" />
            {businessDays.map((d) => (
              <button
                key={d}
                onClick={() => handleDayClick(d)}
                className={`flex-1 text-center py-1 text-xs rounded transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/30 ${
                  isToday(d) ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-muted"
                }`}
                title={`Drill down to ${formatDateStr(d)}`}
              >
                Click to expand
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- Grid View ---- */}
      {!isLoading && !error && data && filteredCrew.length > 0 && viewMode === "grid" && (
        <GridView
          sections={sections}
          dates={businessDays}
          assignmentMap={assignmentMap}
          isDrillDown={isDrillDown}
        />
      )}

      {/* ---- Cards View ---- */}
      {!isLoading && !error && data && filteredCrew.length > 0 && viewMode === "cards" && (
        <>
          {/* Clickable day headers for drill-down */}
          {!isDrillDown && (
            <div className="overflow-x-auto -mx-4 px-4 mb-1">
              <div className="flex gap-3 min-w-[600px]">
                {businessDays.map((d) => (
                  <button
                    key={d}
                    onClick={() => handleDayClick(d)}
                    className={`flex-1 min-w-[180px] text-center py-1 text-xs rounded transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/30 ${
                      isToday(d) ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-muted"
                    }`}
                    title={`Drill down to ${formatDateStr(d)}`}
                  >
                    Click to expand
                  </button>
                ))}
              </div>
            </div>
          )}
          <CardsView
            sections={sections}
            dates={businessDays}
            assignmentMap={assignmentMap}
            allAssignments={filteredAssignments}
            groupBy={groupBy}
            isDrillDown={isDrillDown}
          />
        </>
      )}

      {/* ---- No Assignments Message ---- */}
      {!isLoading && !error && data && filteredCrew.length > 0 && filteredAssignments.length === 0 && (
        <div className="mt-4 bg-surface rounded-lg border border-t-border shadow-card p-6 text-center">
          <p className="text-muted">
            No assignments found for this {selectedDay ? "day" : "period"}.
            All crew members are available.
          </p>
        </div>
      )}
    </DashboardShell>
  );
}
