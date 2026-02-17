"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

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
 *
 * Uses React Query for caching while preserving:
 * 1. Bind to RQ signal for abort on unmount/refetch
 * 2. requestIdRef guard to prevent mixed batches from concurrent streams
 * 3. abort check in read loop after each chunk
 */
export function useProgressiveDeals<T = Record<string, unknown>>(
  options: UseProgressiveDealsOptions = {}
): UseProgressiveDealsReturn<T> {
  const {
    params = {},
    pollInterval = 5 * 60 * 1000,
  } = options;

  // Streaming-specific state (not cacheable — ephemeral UI feedback)
  const [loadingMore, setLoadingMore] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);

  const requestIdRef = useRef(0);
  const queryClient = useQueryClient();

  const paramsKey = JSON.stringify(params);
  const stableParams = useMemo(() => params, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildUrl = useCallback(() => {
    const qs = new URLSearchParams(stableParams).toString();
    return `/api/deals/stream${qs ? `?${qs}` : ""}`;
  }, [stableParams]);

  const pipeline = stableParams.pipeline;

  const query = useQuery<T[]>({
    queryKey: queryKeys.deals.stream(pipeline),
    queryFn: async ({ signal }) => {
      const currentRequestId = ++requestIdRef.current;

      setLoadingMore(false);
      setProgress(null);

      const res = await fetch(buildUrl(), { signal });
      if (!res.ok) throw new Error("Failed to fetch deals");
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated: T[] = [];
      let gotFirstBatch = false;
      let finalDeals: T[] | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (signal.aborted) return accumulated;
          if (currentRequestId !== requestIdRef.current) return accumulated;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

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
              continue;
            }

            if (msg.type === "full") {
              finalDeals = msg.deals ?? [];
              setLoadingMore(false);
              setProgress(null);
              return finalDeals;
            }

            if (msg.type === "batch") {
              if (currentRequestId === requestIdRef.current) {
                const batchDeals = msg.deals ?? [];
                accumulated = [...accumulated, ...batchDeals];
                setProgress({
                  loaded: msg.loaded ?? accumulated.length,
                  total: msg.total ?? null,
                });

                if (!gotFirstBatch) {
                  gotFirstBatch = true;
                  setLoadingMore(true);
                }

                // Update query data with intermediate results for progressive rendering
                queryClient.setQueryData(
                  queryKeys.deals.stream(pipeline),
                  accumulated
                );
              }
            }

            if (msg.type === "done") {
              finalDeals = msg.deals ?? accumulated;
              setLoadingMore(false);
              setProgress(null);
              return finalDeals;
            }

            if (msg.type === "error") {
              throw new Error(msg.error || "Stream error");
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return finalDeals ?? accumulated;
    },
    refetchInterval: pollInterval,
  });

  return {
    deals: query.data ?? [],
    loading: query.isLoading,
    loadingMore,
    progress,
    error: query.error ? (query.error as Error).message : null,
    lastUpdated: query.dataUpdatedAt
      ? new Date(query.dataUpdatedAt).toLocaleTimeString()
      : null,
    refetch: () => {
      query.refetch();
    },
  };
}
