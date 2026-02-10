"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

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
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Memoize params to avoid recreating fetchData on every render.
  // We serialize to a string for comparison since the object reference changes each render.
  const paramsKey = JSON.stringify(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableParams = useMemo(() => params, [paramsKey]);
  // Keep transform ref stable to avoid re-creating fetchData when parent re-renders
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    // Abort any previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Increment request ID to track which request this is
    const currentRequestId = ++requestIdRef.current;

    try {
      // Only show loading spinner on first load
      if (isFirstLoad.current) {
        setLoading(true);
      }

      const queryString = new URLSearchParams(stableParams).toString();
      const url = queryString ? `${endpoint}?${queryString}` : endpoint;
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) throw new Error("Failed to fetch data");

      const responseData = await response.json();

      // Only set state if this is still the current request
      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      const transformedData = transformRef.current
        ? (transformRef.current(responseData) as T)
        : (responseData as T);

      setData(transformedData);
      setLastUpdated(new Date().toLocaleTimeString());
      setIsStale(responseData.stale || false);
      setError(null);
      isFirstLoad.current = false;
    } catch (err: unknown) {
      // Only set error state if this is still the current request and not aborted
      if (
        currentRequestId === requestIdRef.current &&
        !(err instanceof DOMException && err.name === "AbortError")
      ) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      // Only clear loading state if this is still the current request
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [endpoint, stableParams, enabled]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, pollInterval);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchData, pollInterval]);

  return { data, loading, error, lastUpdated, refetch: fetchData, isStale };
}
