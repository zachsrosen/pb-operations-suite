"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { BoardData } from "@/lib/scheduler-v2/types";

export interface UseBoardDataParams {
  from: string;
  to: string;
  /** Optional filters reserved for later chunks (location, workType, etc.). */
  filters?: Record<string, unknown>;
}

export interface UseBoardDataResult {
  data: BoardData | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * React Query hook for the Scheduler v2 dispatch board.
 *
 * Refresh model: polls every 60s (`refetchInterval`). There is intentionally no
 * SSE subscription here — the write path does not broadcast, so React Query
 * invalidation (in a later chunk) plus this poll keep the board fresh.
 */
export function useBoardData({ from, to, filters }: UseBoardDataParams): UseBoardDataResult {
  const query = useQuery<BoardData, Error>({
    queryKey: queryKeys.schedulerV2.board(from, to, filters),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/scheduler-v2/board?${params.toString()}`, {
        signal,
      });
      if (!res.ok) {
        let message = `Failed to load board (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body; keep default message
        }
        throw new Error(message);
      }
      return (await res.json()) as BoardData;
    },
    enabled: Boolean(from && to),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}
