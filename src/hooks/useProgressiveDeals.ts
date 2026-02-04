"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface UseProgressiveDealsOptions {
  /** Query parameters appended to /api/deals/stream (e.g. pipeline, active) */
  params?: Record<string, string>;
  /** Polling interval for full refresh in ms (default: 5 minutes) */
  pollInterval?: number;
}

interface UseProgressiveDealsReturn<T> {
  deals: T[];
  loading: boolean;
  loadingMore: boolean;
  progress: { loaded: number; total: number | null } | null;
  error: string | null;
  lastUpdated: string | null;
  refetch: () => void;
}

/**
 * Streams deals from /api/deals/stream (NDJSON).
 *
 * - Warm cache: the server sends one "full" message instantly → UI renders all at once.
 * - Cold cache: the server streams "batch" messages as each HubSpot page arrives,
 *   so the user sees deals appear within seconds rather than waiting minutes.
 * - Final "done" message carries the complete sorted/filtered dataset which replaces
 *   the accumulated batches (ensuring correct sort order across all data).
 *
 * Generic over `T` so each pipeline page can use its own Deal shape.
 */
export function useProgressiveDeals<T = Record<string, unknown>>(
  options: UseProgressiveDealsOptions = {}
): UseProgressiveDealsReturn<T> {
  const {
    params = {},
    pollInterval = 5 * 60 * 1000,
  } = options;

  const [deals, setDeals] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const isFirstLoad = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const buildUrl = useCallback(() => {
    const qs = new URLSearchParams(params).toString();
    return `/api/deals/stream${qs ? `?${qs}` : ""}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);

  const fetchData = useCallback(async () => {
    // Abort any in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const isInitial = isFirstLoad.current;

    try {
      if (isInitial) setLoading(true);
      setError(null);

      const res = await fetch(buildUrl(), { signal: controller.signal });
      if (!res.ok) throw new Error("Failed to fetch deals");
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated: T[] = [];
      let gotFirstBatch = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) return;

        buffer += decoder.decode(value, { stream: true });

        // Process complete NDJSON lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          let msg: {
            type: string;
            deals?: T[];
            loaded?: number;
            total?: number | null;
            cached?: boolean;
            stale?: boolean;
            lastUpdated?: string;
            error?: string;
          };
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // skip malformed lines
          }

          if (msg.type === "full") {
            // Warm cache hit — everything at once
            setDeals(msg.deals ?? []);
            setLoading(false);
            setLoadingMore(false);
            setProgress(null);
            setLastUpdated(
              msg.lastUpdated
                ? new Date(msg.lastUpdated).toLocaleTimeString()
                : new Date().toLocaleTimeString()
            );
            isFirstLoad.current = false;
            return;
          }

          if (msg.type === "batch") {
            // Streaming chunk — append and render
            const batchDeals = msg.deals ?? [];
            accumulated = [...accumulated, ...batchDeals];
            setDeals(accumulated);
            setProgress({
              loaded: msg.loaded ?? accumulated.length,
              total: msg.total ?? null,
            });

            if (!gotFirstBatch) {
              gotFirstBatch = true;
              setLoading(false);
              setLoadingMore(true);
              isFirstLoad.current = false;
            }
          }

          if (msg.type === "done") {
            // Final complete dataset — replace accumulated (correct sort order)
            setDeals(msg.deals ?? accumulated);
            setLoadingMore(false);
            setProgress(null);
            setLastUpdated(
              msg.lastUpdated
                ? new Date(msg.lastUpdated).toLocaleTimeString()
                : new Date().toLocaleTimeString()
            );
          }

          if (msg.type === "error") {
            throw new Error(msg.error || "Stream error");
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      setError(message);
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildUrl]);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Initial load + polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, pollInterval);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchData, pollInterval]);

  return { deals, loading, loadingMore, progress, error, lastUpdated, refetch };
}
