"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import { RevenueGoalRings } from "./RevenueGoalRings";
import { RevenueGoalBars } from "./RevenueGoalBars";
import { RevenueGoalMonthlyChart } from "./RevenueGoalMonthlyChart";
import { RevenueGoalFireworks } from "./RevenueGoalFireworks";
import type { RevenueGoalResponse } from "@/lib/revenue-groups-config";

type Variant = "rings" | "bars";

export function RevenueGoalTracker() {
  const [variant, setVariant] = useState<Variant>("bars");
  const year = new Date().getFullYear();

  const { data, isLoading, error } = useQuery<RevenueGoalResponse>({
    queryKey: queryKeys.revenueGoals.byYear(year),
    queryFn: async () => {
      const res = await fetch(`/api/revenue-goals?year=${year}`);
      if (!res.ok) throw new Error("Failed to fetch revenue goals");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  // SSE auto-invalidates via cacheKeyToQueryKeys mapping — no manual refetch needed
  useSSE(null, { cacheKeyFilter: "revenue-goals" });

  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-red-500/30 p-4 text-sm text-red-400">
        Revenue tracker failed to load: {error.message}
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="bg-surface rounded-xl border border-t-border p-6 animate-pulse">
        <div className="h-8 w-48 bg-surface-2 rounded mb-4" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-24 bg-surface-2 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // Find groups with currentMonthOnTarget for fireworks
  const fireworkGroups = data.groups.filter((g) =>
    g.months.some((m) => m.currentMonthOnTarget)
  );

  return (
    <div className="bg-surface rounded-xl border border-t-border p-6 relative overflow-hidden">
      {/* Fireworks layer */}
      {fireworkGroups.length > 0 && (
        <RevenueGoalFireworks groups={fireworkGroups} year={year} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            {year} Revenue Goals
          </h2>
          <p className="text-sm text-muted">
            ${(data.companyTotal.ytdActual / 1_000_000).toFixed(1)}M of $
            {(data.companyTotal.annualTarget / 1_000_000).toFixed(1)}M
          </p>
        </div>

        {/* Variant toggle */}
        <div className="flex items-center gap-2 bg-surface-2 rounded-lg p-1">
          <button
            onClick={() => setVariant("rings")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              variant === "rings"
                ? "bg-surface-elevated text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Rings
          </button>
          <button
            onClick={() => setVariant("bars")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              variant === "bars"
                ? "bg-surface-elevated text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Bars
          </button>
        </div>
      </div>

      {/* Hero section */}
      {variant === "rings" ? (
        <RevenueGoalRings groups={data.groups} />
      ) : (
        <RevenueGoalBars
          groups={data.groups}
          companyTotal={data.companyTotal}
        />
      )}

      {/* Monthly chart */}
      <RevenueGoalMonthlyChart groups={data.groups} />
    </div>
  );
}
