"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { BaselineTable } from "@/lib/forecasting";

interface BaselineResponse {
  baselines: BaselineTable;
  summary: {
    segmentCount: number;
    totalCompletedProjects: number;
  };
  cached: boolean;
  stale: boolean;
  lastUpdated: string | null;
}

/**
 * Fetches the forecast baseline table from the API.
 * Cached client-side for 10 minutes (server-side cache handles freshness).
 * Returns null while loading — callers should pass null to transformProject
 * to trigger the legacy fallback until baselines arrive.
 */
export function useBaselineTable() {
  const query = useQuery<BaselineResponse>({
    queryKey: queryKeys.forecasting.baselines(),
    queryFn: async () => {
      const res = await fetch("/api/forecasting/baselines");
      if (!res.ok) throw new Error("Failed to fetch forecast baselines");
      return res.json();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: 2,
  });

  return {
    baselineTable: query.data?.baselines ?? null,
    summary: query.data?.summary ?? null,
    isLoading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
  };
}
