"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface UseProjectDataOptions {
  /** API endpoint path (default: "/api/projects") */
  endpoint?: string;
  /** Query parameters to append */
  params?: Record<string, string>;
  /** Polling interval in ms (default: 5 minutes) */
  pollInterval?: number;
  /** Transform function applied to the response */
  transform?: (data: unknown) => unknown;
  /** Whether to start fetching immediately (default: true) */
  enabled?: boolean;
}

interface UseProjectDataReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  refetch: () => Promise<void>;
  isStale: boolean;
}

/**
 * Shared data-fetching hook with polling support.
 * Wraps React Query's useQuery — keeps the same return type for backward compatibility.
 */
export function useProjectData<T = unknown>(
  options: UseProjectDataOptions = {}
): UseProjectDataReturn<T> {
  const {
    endpoint = "/api/projects",
    params = {},
    pollInterval = 5 * 60 * 1000,
    transform,
    enabled = true,
  } = options;

  // Stable params key for React Query
  const paramsKey = JSON.stringify(params);
  const stableParams = useMemo(() => params, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useQuery({
    queryKey: queryKeys.projects.list({ endpoint, ...stableParams }),
    queryFn: async () => {
      const queryString = new URLSearchParams(stableParams).toString();
      const url = queryString ? `${endpoint}?${queryString}` : endpoint;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch data");
      return response.json();
    },
    enabled,
    refetchInterval: pollInterval,
    select: transform ? (data: unknown) => transform(data) as T : undefined,
  });

  return {
    data: (query.data as T) ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    lastUpdated: query.dataUpdatedAt
      ? new Date(query.dataUpdatedAt).toLocaleTimeString()
      : null,
    refetch: async () => {
      await query.refetch();
    },
    isStale: query.isStale,
  };
}
