"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";

export interface DealsFilterState {
  pipeline: string;
  stages: string[];
  locations: string[];
  owners: string[];
  search: string;
  sort: string;
  order: "asc" | "desc";
  /** Column-level status filters: key = status field name, value = selected status values */
  statusFilters: Record<string, string[]>;
}

function parseCommaSep(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function toCommaSep(values: string[]): string | null {
  return values.length > 0 ? values.join(",") : null;
}

export function useDealsFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters: DealsFilterState = useMemo(() => {
    const statusFilters: Record<string, string[]> = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith("sf_")) {
        const field = key.slice(3);
        statusFilters[field] = parseCommaSep(value);
      }
    });

    return {
      pipeline: searchParams.get("pipeline") || "project",
      stages: parseCommaSep(searchParams.get("stage")),
      locations: parseCommaSep(searchParams.get("location")),
      owners: parseCommaSep(searchParams.get("owner")),
      search: searchParams.get("search") || "",
      sort: searchParams.get("sort") || "stage",
      order: (searchParams.get("order") as "asc" | "desc") || "asc",
      statusFilters,
    };
  }, [searchParams]);

  const setFilters = useCallback(
    (updates: Partial<DealsFilterState>) => {
      const params = new URLSearchParams(searchParams.toString());

      if (updates.pipeline !== undefined) {
        if (updates.pipeline === "project") {
          params.delete("pipeline");
        } else {
          params.set("pipeline", updates.pipeline);
        }
        // Pipeline change resets stage, owner, sort, and status filters
        params.delete("stage");
        params.delete("owner");
        params.delete("sort");
        params.delete("order");
        [...params.keys()].filter((k) => k.startsWith("sf_")).forEach((k) => params.delete(k));
      }

      if (updates.stages !== undefined) {
        const v = toCommaSep(updates.stages);
        if (v) params.set("stage", v);
        else params.delete("stage");
      }

      if (updates.locations !== undefined) {
        const v = toCommaSep(updates.locations);
        if (v) params.set("location", v);
        else params.delete("location");
      }

      if (updates.owners !== undefined) {
        const v = toCommaSep(updates.owners);
        if (v) params.set("owner", v);
        else params.delete("owner");
      }

      if (updates.search !== undefined) {
        if (updates.search) params.set("search", updates.search);
        else params.delete("search");
      }

      if (updates.sort !== undefined) {
        if (updates.sort === "stage") params.delete("sort");
        else params.set("sort", updates.sort);
      }

      if (updates.order !== undefined) {
        if (updates.order === "asc") params.delete("order");
        else params.set("order", updates.order);
      }

      if (updates.statusFilters !== undefined) {
        [...params.keys()].filter((k) => k.startsWith("sf_")).forEach((k) => params.delete(k));
        for (const [field, values] of Object.entries(updates.statusFilters)) {
          const v = toCommaSep(values);
          if (v) params.set(`sf_${field}`, v);
        }
      }

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const setStatusFilter = useCallback(
    (field: string, values: string[]) => {
      setFilters({
        statusFilters: { ...filters.statusFilters, [field]: values },
      });
    },
    [filters.statusFilters, setFilters]
  );

  return { filters, setFilters, setStatusFilter };
}
