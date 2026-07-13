"use client";

import { useQuery } from "@tanstack/react-query";
import type { SyncMeta } from "@/components/DashboardShell";

interface FreshnessResponse {
  lastSyncedAt: string | null;
  ageMinutes: number | null;
  staleness: string | null;
}

/**
 * Deal-mirror freshness for the DashboardShell staleness badge. Any mirror-backed
 * dashboard can add `syncMeta={useDealSyncFreshness()}` to show "deals synced N
 * ago". Returns undefined until loaded (badge simply doesn't render).
 */
export function useDealSyncFreshness(): SyncMeta | undefined {
  const { data } = useQuery({
    queryKey: ["deal-sync-freshness"],
    queryFn: async (): Promise<FreshnessResponse | null> => {
      const res = await fetch("/api/deal-sync/freshness");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  if (!data?.lastSyncedAt) return undefined;
  return {
    source: "HubSpot → deal mirror",
    lastSyncedAt: data.lastSyncedAt,
    staleness: data.staleness ?? "",
  };
}
