"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
 * Extracts the fetch + poll + error + loading pattern used across 7+ pages.
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

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const isFirstLoad = useRef(true);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    try {
      // Only show loading spinner on first load
      if (isFirstLoad.current) {
        setLoading(true);
      }

      const queryString = new URLSearchParams(params).toString();
      const url = queryString ? `${endpoint}?${queryString}` : endpoint;
      const response = await fetch(url);

      if (!response.ok) throw new Error("Failed to fetch data");

      const responseData = await response.json();
      const transformedData = transform
        ? (transform(responseData) as T)
        : (responseData as T);

      setData(transformedData);
      setLastUpdated(new Date().toLocaleTimeString());
      setIsStale(responseData.stale || false);
      setError(null);
      isFirstLoad.current = false;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [endpoint, JSON.stringify(params), transform, enabled]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, pollInterval);
    return () => clearInterval(interval);
  }, [fetchData, pollInterval]);

  return { data, loading, error, lastUpdated, refetch: fetchData, isStale };
}
