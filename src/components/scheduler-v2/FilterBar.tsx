"use client";

import { useMemo } from "react";
import {
  MultiSelectFilter,
  ProjectSearchBar,
  type FilterOption,
} from "@/components/ui/MultiSelectFilter";
import { LOCATIONS } from "@/lib/scheduler-v2/constants";
import type { BoardData, WorkType } from "@/lib/scheduler-v2/types";
import { useBoardFilters } from "./useBoardFilters";

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  install: "Install",
  survey: "Survey",
  inspection: "Inspection",
  service: "Service",
  roofing: "Roofing",
  dnr: "D&R",
};

const STAGE_OPTIONS: FilterOption[] = [
  { value: "unscheduled", label: "Unscheduled" },
  { value: "construction", label: "Construction" },
  { value: "survey", label: "Survey" },
  { value: "inspection", label: "Inspection" },
  { value: "service", label: "Service" },
];

export interface FilterBarProps {
  /** Unfiltered board data — used to build the option lists. */
  data: BoardData | undefined;
}

/**
 * Location / crew / work-type / stage multi-selects + a free-text search,
 * all bound to the URL-persisted `useBoardFilters` hook. The same filter set
 * scopes both the board and the unscheduled queue (the parent applies it).
 */
export function FilterBar({ data }: FilterBarProps) {
  const { filters, setFilters, resetFilters, hasActiveFilters } =
    useBoardFilters();

  // Location options: canonical LOCATIONS first, then any extras seen in data.
  const locationOptions = useMemo<FilterOption[]>(() => {
    const seen = new Set<string>();
    for (const r of data?.resources ?? []) {
      if (r.primaryLocation) seen.add(r.primaryLocation);
    }
    for (const wi of data?.workItems ?? []) {
      if (wi.location) seen.add(wi.location);
    }
    const ordered: string[] = [];
    for (const loc of LOCATIONS) {
      if (seen.has(loc)) {
        ordered.push(loc);
        seen.delete(loc);
      }
    }
    for (const loc of [...seen].sort()) ordered.push(loc);
    return ordered.map((loc) => ({ value: loc, label: loc }));
  }, [data?.resources, data?.workItems]);

  // Crew options keyed by resource id (so filtering survives name collisions).
  const crewOptions = useMemo<FilterOption[]>(
    () =>
      (data?.resources ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => ({
          value: r.id,
          label: r.primaryLocation ? `${r.name} (${r.primaryLocation})` : r.name,
        })),
    [data?.resources]
  );

  // Work-type options: only those present in the data.
  const workTypeOptions = useMemo<FilterOption[]>(() => {
    const seen = new Set<WorkType>();
    for (const wi of data?.workItems ?? []) seen.add(wi.workType);
    const order: WorkType[] = [
      "install",
      "survey",
      "inspection",
      "service",
      "roofing",
      "dnr",
    ];
    return order
      .filter((wt) => seen.has(wt))
      .map((wt) => ({ value: wt, label: WORK_TYPE_LABELS[wt] }));
  }, [data?.workItems]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelectFilter
        label="Location"
        options={locationOptions}
        selected={filters.locations}
        onChange={(locations) => setFilters({ locations })}
        placeholder="All Locations"
        accentColor="blue"
      />
      <MultiSelectFilter
        label="Crew"
        options={crewOptions}
        selected={filters.crews}
        onChange={(crews) => setFilters({ crews })}
        placeholder="All Crews"
        accentColor="cyan"
      />
      <MultiSelectFilter
        label="Work Type"
        options={workTypeOptions}
        selected={filters.workTypes}
        onChange={(workTypes) => setFilters({ workTypes })}
        placeholder="All Types"
        accentColor="purple"
      />
      <MultiSelectFilter
        label="Stage"
        options={STAGE_OPTIONS}
        selected={filters.stages}
        onChange={(stages) => setFilters({ stages })}
        placeholder="All Stages"
        accentColor="green"
      />

      <ProjectSearchBar
        onSearch={(search) => setFilters({ search })}
        placeholder="Search customer, PROJ #, address…"
      />

      {hasActiveFilters && (
        <button
          onClick={resetFilters}
          className="rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-xs text-muted transition-colors hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
