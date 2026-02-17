import { QueryClient } from "@tanstack/react-query";

/**
 * Create a new QueryClient with project-wide defaults.
 *
 * Key decisions:
 * - staleTime: 2min — data is fresh for 2 minutes before background refetch
 * - gcTime: 10min — unused query data garbage collected after 10 minutes
 * - retry: 2 — two retries before reporting failure
 * - refetchOnWindowFocus: false — disabled globally to prevent stacking with SSE
 * - refetchOnReconnect: false — disabled globally; SSE handles reconnection
 * - No global refetchInterval — set per-query only where polling is needed
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60 * 1000, // 2 minutes
        gcTime: 10 * 60 * 1000, // 10 minutes
        retry: 2,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}
