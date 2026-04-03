"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { MetricCard } from "@/components/ui/MetricCard";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { queryKeys } from "@/lib/query-keys";
import { formatCurrencyCompact } from "@/lib/format";
import { LOCATION_COLORS, TERRITORY_BOUNDARIES } from "@/lib/constants";

/* ------------------------------------------------------------------ */
/*  AI Analysis component                                              */
/* ------------------------------------------------------------------ */

interface OfficeStat {
  name: string;
  count: number;
  totalRevenue: number;
  pct: number;
}

function TerritoryAIAnalysis({
  officeStats,
  useProposed,
  boundaries,
  totalDeals,
}: {
  officeStats: OfficeStat[];
  useProposed: boolean;
  boundaries: { westminster: number; centennial: number };
  totalDeals: number;
}) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const res = await fetch("/api/territory-map/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officeStats,
          useProposed,
          boundaries,
          totalDeals,
        }),
      });
      if (!res.ok) throw new Error(`Analysis failed: ${res.status}`);
      const data = await res.json();
      setAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [officeStats, useProposed, boundaries, totalDeals]);

  return (
    <div className="mt-6 bg-surface rounded-xl border border-t-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">AI Territory Analysis</span>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Analyzing..." : analysis ? "Re-analyze" : "Run Analysis"}
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-muted py-8 justify-center">
          <LoadingSpinner />
          <span className="text-sm">Analyzing territory distribution and patterns...</span>
        </div>
      )}

      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 rounded-lg p-3">{error}</div>
      )}

      {analysis && !loading && (
        <div className="prose prose-sm prose-invert max-w-none text-foreground/90 leading-relaxed whitespace-pre-wrap">
          {analysis}
        </div>
      )}

      {!analysis && !loading && !error && (
        <p className="text-muted text-sm">
          Click &ldquo;Run Analysis&rdquo; to get AI-powered insights on territory distribution, deal
          balance, revenue patterns, and boundary optimization recommendations.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TerritoryDeal {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  pbLocation: string;
  amount: number;
  stage: string;
  url: string;
}

interface TerritoryResponse {
  deals: TerritoryDeal[];
  activeStages: string[];
  total: number;
  lastUpdated: string;
}

/* ------------------------------------------------------------------ */
/*  Dynamic import — Google Maps requires browser APIs                  */
/* ------------------------------------------------------------------ */

const TerritoryMapView = dynamic(
  () => import("./TerritoryMapView"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center bg-surface rounded-xl border border-t-border" style={{ height: "calc(100vh - 340px)" }}>
        <LoadingSpinner />
      </div>
    ),
  },
);

/* ------------------------------------------------------------------ */
/*  Territory assignment logic                                         */
/* ------------------------------------------------------------------ */

function assignTerritory(
  lat: number,
  boundaries: { westminster: number; centennial: number },
): string {
  if (lat >= boundaries.westminster) return "Westminster";
  if (lat >= boundaries.centennial) return "Centennial";
  return "Colorado Springs";
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function TerritoryMapPage() {
  const [activeOnly, setActiveOnly] = useState(false);
  const [useProposed, setUseProposed] = useState(false);

  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  useEffect(() => {
    if (!hasTrackedView.current) {
      trackDashboardView("Territory Map");
      hasTrackedView.current = true;
    }
  }, [trackDashboardView]);

  /* ---- data fetch ---- */
  const { data, isLoading, error, refetch } = useQuery<TerritoryResponse>({
    queryKey: queryKeys.territoryMap.all(),
    queryFn: async () => {
      const res = await fetch("/api/territory-map");
      if (!res.ok) throw new Error(`Failed to fetch territory data: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  /* ---- boundaries ---- */
  const boundaries = useProposed
    ? TERRITORY_BOUNDARIES.proposed
    : TERRITORY_BOUNDARIES.current;

  /* ---- active stages set (from shared pipeline config via API) ---- */
  const activeStagesSet = useMemo(
    () => new Set(data?.activeStages || []),
    [data?.activeStages],
  );

  /* ---- filtered + computed deals ---- */
  const filteredDeals = useMemo(() => {
    if (!data?.deals) return [];

    let deals = data.deals;

    // Client-side active filter using shared pipeline stage definitions
    if (activeOnly) {
      deals = deals.filter((d) => activeStagesSet.has(d.stage));
    }

    // Compute territory assignment based on current boundary mode
    return deals.map((d) => ({
      ...d,
      computedLocation: useProposed
        ? assignTerritory(d.latitude, boundaries)
        : d.pbLocation,
    }));
  }, [data?.deals, activeOnly, activeStagesSet, useProposed, boundaries]);

  /* ---- per-office stats ---- */
  const officeStats = useMemo(() => {
    const offices = [
      { name: "Westminster" as const, borderClass: "border-l-blue-500" },
      { name: "Centennial" as const, borderClass: "border-l-emerald-500" },
      { name: "Colorado Springs" as const, borderClass: "border-l-amber-500" },
    ];
    const stats = offices.map(({ name, borderClass }) => {
      const deals = filteredDeals.filter((d) => d.computedLocation === name);
      const totalRevenue = deals.reduce((sum, d) => sum + d.amount, 0);
      return { name, borderClass, count: deals.length, totalRevenue };
    });
    const grandTotal = stats.reduce((sum, s) => sum + s.count, 0);
    return stats.map((s) => ({
      ...s,
      pct: grandTotal > 0 ? Math.round((s.count / grandTotal) * 100) : 0,
    }));
  }, [filteredDeals]);

  /* ---- render ---- */
  if (error) {
    return (
      <DashboardShell title="Territory Map" accentColor="blue" fullWidth>
        <ErrorState message="Failed to load territory data" onRetry={() => refetch()} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Territory Map"
      accentColor="blue"
      fullWidth
      lastUpdated={data?.lastUpdated}
    >
      {/* ---- Metric Cards ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {officeStats.map((office) => (
          <MetricCard
            key={office.name}
            label={office.name}
            value={isLoading ? null : office.count.toLocaleString()}
            sub={
              isLoading
                ? undefined
                : `${formatCurrencyCompact(office.totalRevenue)} · ${office.pct}%`
            }
            border={`border-l-4 ${office.borderClass}`}
            valueColor="text-foreground"
            subColor="text-muted"
          />
        ))}
      </div>

      {/* ---- Controls bar ---- */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center bg-surface rounded-lg border border-t-border p-0.5">
          <button
            onClick={() => setActiveOnly(false)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              !activeOnly
                ? "bg-blue-500/20 text-blue-400 font-medium"
                : "text-muted hover:text-foreground"
            }`}
          >
            All Time
          </button>
          <button
            onClick={() => setActiveOnly(true)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeOnly
                ? "bg-blue-500/20 text-blue-400 font-medium"
                : "text-muted hover:text-foreground"
            }`}
          >
            Active Only
          </button>
        </div>

        <div className="flex items-center bg-surface rounded-lg border border-t-border p-0.5">
          <button
            onClick={() => setUseProposed(false)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              !useProposed
                ? "bg-blue-500/20 text-blue-400 font-medium"
                : "text-muted hover:text-foreground"
            }`}
          >
            Current Boundaries
          </button>
          <button
            onClick={() => setUseProposed(true)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              useProposed
                ? "bg-emerald-500/20 text-emerald-400 font-medium"
                : "text-muted hover:text-foreground"
            }`}
          >
            Proposed Boundaries
          </button>
        </div>

        {isLoading && (
          <span className="text-xs text-muted animate-pulse">Loading deals...</span>
        )}
      </div>

      {/* ---- Map ---- */}
      {isLoading ? (
        <div
          className="flex items-center justify-center bg-surface rounded-xl border border-t-border"
          style={{ height: "calc(100vh - 340px)" }}
        >
          <LoadingSpinner />
        </div>
      ) : filteredDeals.length === 0 ? (
        <div
          className="flex items-center justify-center bg-surface rounded-xl border border-t-border text-muted"
          style={{ height: "calc(100vh - 340px)" }}
        >
          No geocoded deals found.
        </div>
      ) : (
        <TerritoryMapView
          deals={filteredDeals}
          boundaries={boundaries}
          locationColors={LOCATION_COLORS}
        />
      )}

      {/* ---- AI Analysis ---- */}
      {!isLoading && filteredDeals.length > 0 && (
        <TerritoryAIAnalysis
          officeStats={officeStats}
          useProposed={useProposed}
          boundaries={boundaries}
          totalDeals={filteredDeals.length}
        />
      )}
    </DashboardShell>
  );
}
