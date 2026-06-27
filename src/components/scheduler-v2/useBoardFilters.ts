"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { mapStage } from "@/lib/scheduler-v2/normalize";
import type { BoardData, Resource, WorkItem } from "@/lib/scheduler-v2/types";

/**
 * Filter state for the Scheduler v2 dispatch board + attention queue.
 *
 * One filter set scopes BOTH the board and the unscheduled queue: the parent
 * (`SchedulerV2Shell`) reads these values, derives a filtered `BoardData`, and
 * passes the same scoped data to both surfaces.
 *
 * All state is persisted in the URL query string so a filtered view is
 * shareable / bookmarkable and survives a refresh. Multi-value filters are
 * comma-joined under a single param; `search` is a plain string.
 */
export interface BoardFilters {
  locations: string[];
  crews: string[];
  workTypes: string[];
  stages: string[];
  search: string;
}

export const EMPTY_FILTERS: BoardFilters = {
  locations: [],
  crews: [],
  workTypes: [],
  stages: [],
  search: "",
};

/** Param keys used in the URL. Kept short + stable for bookmarkability. */
const PARAM = {
  locations: "loc",
  crews: "crew",
  workTypes: "wt",
  stages: "stage",
  search: "q",
} as const;

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface UseBoardFiltersResult {
  filters: BoardFilters;
  /** Patch one or more filter fields; merges into current state. */
  setFilters: (patch: Partial<BoardFilters>) => void;
  /** Clear every filter (removes the params from the URL). */
  resetFilters: () => void;
  /** True when any filter is active. */
  hasActiveFilters: boolean;
}

/**
 * URL-persisted filter state. Reads on mount (and on any external URL change)
 * via `useSearchParams`; writes via `router.replace` so filter changes do not
 * pollute browser history with one entry per keystroke.
 */
export function useBoardFilters(): UseBoardFiltersResult {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo<BoardFilters>(
    () => ({
      locations: parseList(searchParams.get(PARAM.locations)),
      crews: parseList(searchParams.get(PARAM.crews)),
      workTypes: parseList(searchParams.get(PARAM.workTypes)),
      stages: parseList(searchParams.get(PARAM.stages)),
      search: searchParams.get(PARAM.search) ?? "",
    }),
    [searchParams]
  );

  const writeParams = useCallback(
    (next: BoardFilters) => {
      const params = new URLSearchParams(searchParams.toString());

      const setList = (key: string, vals: string[]) => {
        if (vals.length > 0) params.set(key, vals.join(","));
        else params.delete(key);
      };

      setList(PARAM.locations, next.locations);
      setList(PARAM.crews, next.crews);
      setList(PARAM.workTypes, next.workTypes);
      setList(PARAM.stages, next.stages);
      if (next.search) params.set(PARAM.search, next.search);
      else params.delete(PARAM.search);

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const setFilters = useCallback(
    (patch: Partial<BoardFilters>) => {
      writeParams({ ...filters, ...patch });
    },
    [filters, writeParams]
  );

  const resetFilters = useCallback(() => {
    writeParams(EMPTY_FILTERS);
  }, [writeParams]);

  const hasActiveFilters =
    filters.locations.length > 0 ||
    filters.crews.length > 0 ||
    filters.workTypes.length > 0 ||
    filters.stages.length > 0 ||
    filters.search.trim().length > 0;

  return { filters, setFilters, resetFilters, hasActiveFilters };
}

/* ------------------------------------------------------------------ */
/*  Shared filtering logic (board + queue use the same predicate)      */
/* ------------------------------------------------------------------ */

/**
 * Returns the set of resource names whose primaryLocation is in `locations`
 * and/or whose id/name is selected in `crews`. Used to scope assignments.
 */
function resourceMatches(
  resource: Resource,
  locations: string[],
  crews: string[]
): boolean {
  if (locations.length > 0 && !locations.includes(resource.primaryLocation)) {
    return false;
  }
  if (crews.length > 0 && !crews.includes(resource.id)) return false;
  return true;
}

/** Does a single work item pass the location/workType/stage/search filters? */
export function workItemMatches(item: WorkItem, filters: BoardFilters): boolean {
  if (filters.locations.length > 0 && !filters.locations.includes(item.location)) {
    return false;
  }
  if (
    filters.workTypes.length > 0 &&
    !filters.workTypes.includes(item.workType)
  ) {
    return false;
  }
  if (filters.stages.length > 0) {
    // We don't carry a raw stage on WorkItem; approximate via status → stage
    // is not 1:1, so stage filtering keys off the derived stage of the item's
    // status when meaningful, else off workType. We treat "stage" loosely as
    // the normalized scheduling stage slug.
    const stage = deriveStage(item);
    if (!filters.stages.includes(stage)) return false;
  }
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    const hay = [
      item.customer,
      item.projectNumber,
      item.address,
      item.location,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/**
 * Derive a normalized scheduling stage slug for a work item.
 * WorkItem has no raw HubSpot stage field, so we infer it from status/workType:
 *   - unscheduled status → "unscheduled"
 *   - install/roofing/dnr work that is scheduled → "construction"
 *   - survey → "survey", inspection → "inspection", service → "service"
 * Falls back through mapStage for any future raw stage carriage.
 */
export function deriveStage(item: WorkItem): string {
  if (item.status === "unscheduled") return "unscheduled";
  switch (item.workType) {
    case "survey":
      return "survey";
    case "inspection":
      return "inspection";
    case "service":
      return "service";
    case "install":
    case "roofing":
    case "dnr":
      return "construction";
    default:
      return mapStage(item.workType);
  }
}

/**
 * Apply a filter set to a `BoardData`, returning a new scoped `BoardData`.
 *
 * - workItems: kept if they pass `workItemMatches`.
 * - resources: kept if they match location/crew filters (so the board only
 *   shows relevant rows; queue ignores resources).
 * - assignments: kept only when both their work item AND resource survive.
 * - capacity: kept for surviving resources.
 */
export function applyBoardFilters(
  data: BoardData,
  filters: BoardFilters
): BoardData {
  const keptItems = data.workItems.filter((wi) => workItemMatches(wi, filters));
  const keptItemIds = new Set(keptItems.map((wi) => wi.id));

  const keptResources = data.resources.filter((r) =>
    resourceMatches(r, filters.locations, filters.crews)
  );
  const keptResourceNames = new Set(keptResources.map((r) => r.name));
  const keptResourceIds = new Set(keptResources.map((r) => r.id));

  const keptAssignments = data.assignments.filter(
    (a) =>
      keptItemIds.has(a.workItemId) && keptResourceNames.has(a.resourceName)
  );

  const keptCapacity = data.capacity.filter(
    (c) => !c.resourceId || keptResourceIds.has(c.resourceId)
  );

  return {
    ...data,
    workItems: keptItems,
    resources: keptResources,
    assignments: keptAssignments,
    capacity: keptCapacity,
  };
}
