"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawProject {
  id: string;
  name: string;
  pbLocation?: string;
  ahj?: string;
  utility?: string;
  projectType?: string;
  stage?: string;
  amount?: number;
  url?: string;
  closeDate?: string;
  ptoGrantedDate?: string;
  constructionScheduleDate?: string;
  forecastedInstallDate?: string;
  forecastedInspectionDate?: string;
  forecastedPtoDate?: string;
}

interface TransformedProject {
  id: string;
  name: string;
  pb_location: string;
  ahj: string;
  utility: string;
  project_type: string;
  stage: string;
  amount: number;
  url?: string;
  close_date?: string;
  pto_granted?: string;
  forecast_install: string | null;
  forecast_inspection: string | null;
  forecast_pto: string | null;
  days_to_install: number | null;
  days_to_inspection: number | null;
  days_to_pto: number | null;
  days_since_close: number;
}

interface LocationStat {
  name: string;
  count: number;
  totalValue: number;
  avgDaysToInstall: number[];
  avgDaysToInspection: number[];
  avgDaysToPTO: number[];
  overdue: number;
  thisMonth: number;
  nextMonth: number;
  stages: Record<string, number>;
  projects: TransformedProject[];
  avgInstall: number | null;
  avgInspection: number | null;
  avgPTO: number | null;
}

type MetricKey = "count" | "value" | "avgPTO" | "overdue";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCATION_COLORS: Record<string, { bg: string; tw: string }> = {
  Westminster: { bg: "#3B82F6", tw: "bg-blue-500" },
  Centennial: { bg: "#10B981", tw: "bg-emerald-500" },
  "Colorado Springs": { bg: "#F59E0B", tw: "bg-amber-500" },
  "San Luis Obispo": { bg: "#8B5CF6", tw: "bg-violet-500" },
  Camarillo: { bg: "#EC4899", tw: "bg-pink-500" },
  Unknown: { bg: "#6B7280", tw: "bg-zinc-500" },
};

const METRIC_LABELS: Record<MetricKey, string> = {
  count: "Count",
  value: "Value",
  avgPTO: "Avg PTO",
  overdue: "Overdue",
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function transformProject(p: RawProject): TransformedProject {
  const now = new Date();
  const closeDate = p.closeDate ? new Date(p.closeDate) : null;
  const daysSinceClose = closeDate
    ? Math.floor((now.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const forecastInstall =
    p.forecastedInstallDate ||
    p.constructionScheduleDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 75 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]
      : null);

  const forecastInspection =
    p.forecastedInspectionDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 114 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]
      : null);

  const forecastPto =
    p.forecastedPtoDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 139 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]
      : null);

  const daysToInstall = forecastInstall
    ? Math.floor(
        (new Date(forecastInstall).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  const daysToInspection = forecastInspection
    ? Math.floor(
        (new Date(forecastInspection).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  const daysToPto = forecastPto
    ? Math.floor(
        (new Date(forecastPto).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  return {
    id: p.id,
    name: p.name,
    pb_location: p.pbLocation || "Unknown",
    ahj: p.ahj || "Unknown",
    utility: p.utility || "Unknown",
    project_type: p.projectType || "Unknown",
    stage: p.stage || "Unknown",
    amount: p.amount || 0,
    url: p.url,
    close_date: p.closeDate,
    pto_granted: p.ptoGrantedDate,
    forecast_install: forecastInstall,
    forecast_inspection: forecastInspection,
    forecast_pto: forecastPto,
    days_to_install: daysToInstall,
    days_to_inspection: daysToInspection,
    days_to_pto: daysToPto,
    days_since_close: daysSinceClose,
  };
}

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color?: string;
}) {
  return (
    <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
      <div className={`text-3xl font-bold ${color || "text-white"}`}>
        {value}
      </div>
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}

function HorizontalBarChart({
  locationStats,
  metric,
  onBarClick,
}: {
  locationStats: LocationStat[];
  metric: MetricKey;
  onBarClick: (name: string) => void;
}) {
  const data = useMemo(() => {
    return locationStats.map((loc) => {
      let value: number;
      let displayValue: string;

      switch (metric) {
        case "count":
          value = loc.count;
          displayValue = String(loc.count);
          break;
        case "value":
          value = loc.totalValue / 1000;
          displayValue = `$${(loc.totalValue / 1000).toFixed(0)}k`;
          break;
        case "avgPTO":
          value = loc.avgPTO || 0;
          displayValue = loc.avgPTO ? `${loc.avgPTO}d` : "0d";
          break;
        case "overdue":
          value = loc.overdue;
          displayValue = String(loc.overdue);
          break;
        default:
          value = 0;
          displayValue = "0";
      }

      return {
        name: loc.name,
        value,
        displayValue,
        color: LOCATION_COLORS[loc.name]?.bg || "#6B7280",
      };
    });
  }, [locationStats, metric]);

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-3">
      {data.map((bar) => (
        <button
          key={bar.name}
          onClick={() => onBarClick(bar.name)}
          className="w-full text-left group"
        >
          <div className="flex items-center gap-3">
            <div className="w-36 text-sm text-zinc-400 group-hover:text-white transition-colors truncate">
              {bar.name}
            </div>
            <div className="flex-1 relative h-8 bg-zinc-800/50 rounded overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded transition-all duration-500 group-hover:brightness-125"
                style={{
                  width: `${Math.max((bar.value / maxValue) * 100, 2)}%`,
                  backgroundColor: bar.color,
                }}
              />
              <span className="absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-white drop-shadow-sm">
                {bar.displayValue}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function LocationCard({
  loc,
  isSelected,
  onClick,
}: {
  loc: LocationStat;
  isSelected: boolean;
  onClick: () => void;
}) {
  const color = LOCATION_COLORS[loc.name]?.bg || "#6B7280";

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg p-4 cursor-pointer transition-all border-l-4 ${
        isSelected
          ? "bg-[#1a1a2e] border border-blue-500/50 shadow-lg shadow-blue-500/10"
          : "bg-[#12121a] border border-zinc-800 hover:border-zinc-700"
      }`}
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-lg text-white">{loc.name}</h3>
        <span className="text-2xl font-bold" style={{ color }}>
          {loc.count}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-zinc-500">Pipeline Value</div>
          <div className="font-medium text-zinc-300">
            ${(loc.totalValue / 1000).toFixed(0)}k
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Overdue</div>
          <div
            className={`font-medium ${loc.overdue > 0 ? "text-red-400" : "text-emerald-400"}`}
          >
            {loc.overdue}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Avg to PTO</div>
          <div className="font-medium text-zinc-300">
            {loc.avgPTO ? `${loc.avgPTO}d` : "-"}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">PTO This Mo</div>
          <div className="font-medium text-zinc-300">{loc.thisMonth}</div>
        </div>
      </div>
    </button>
  );
}

function DetailPanel({
  stats,
  onClose,
}: {
  stats: LocationStat;
  onClose: () => void;
}) {
  const color = LOCATION_COLORS[stats.name]?.bg || "#6B7280";

  const sortedStages = Object.entries(stats.stages).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold" style={{ color }}>
          {stats.name} Details
        </h2>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Close
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#0a0a0f] rounded p-3">
          <div className="text-2xl font-bold text-white">{stats.count}</div>
          <div className="text-sm text-zinc-500">Projects</div>
        </div>
        <div className="bg-[#0a0a0f] rounded p-3">
          <div className="text-2xl font-bold text-emerald-400">
            ${(stats.totalValue / 1000).toFixed(0)}k
          </div>
          <div className="text-sm text-zinc-500">Value</div>
        </div>
        <div className="bg-[#0a0a0f] rounded p-3">
          <div className="text-2xl font-bold text-white">
            {stats.avgInstall !== null ? `${stats.avgInstall}d` : "-"}
          </div>
          <div className="text-sm text-zinc-500">Avg to Install</div>
        </div>
        <div className="bg-[#0a0a0f] rounded p-3">
          <div className="text-2xl font-bold text-white">
            {stats.avgPTO !== null ? `${stats.avgPTO}d` : "-"}
          </div>
          <div className="text-sm text-zinc-500">Avg to PTO</div>
        </div>
      </div>

      {/* Stage breakdown */}
      <div className="mb-6">
        <h3 className="font-medium text-zinc-300 mb-2">Stage Breakdown</h3>
        <div className="flex flex-wrap gap-2">
          {sortedStages.map(([stage, count]) => (
            <span
              key={stage}
              className="px-3 py-1 bg-zinc-800 text-zinc-300 rounded-full text-sm"
            >
              {stage}: <strong className="text-white">{count}</strong>
            </span>
          ))}
        </div>
      </div>

      {/* Project table */}
      <div>
        <h3 className="font-medium text-zinc-300 mb-2">
          Projects ({stats.projects.length})
        </h3>
        <div className="max-h-64 overflow-y-auto border border-zinc-800 rounded">
          <table className="w-full text-sm">
            <thead className="bg-[#0a0a0f] sticky top-0 z-10">
              <tr>
                <th className="text-left p-2 text-zinc-400 font-medium">
                  Project
                </th>
                <th className="text-left p-2 text-zinc-400 font-medium">
                  Stage
                </th>
                <th className="text-right p-2 text-zinc-400 font-medium">
                  Value
                </th>
                <th className="text-right p-2 text-zinc-400 font-medium">
                  Days to PTO
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.projects.slice(0, 20).map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-zinc-800 hover:bg-zinc-800/50"
                >
                  <td className="p-2">
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        {p.name.split("|")[0].trim()}
                      </a>
                    ) : (
                      <span className="text-zinc-300">
                        {p.name.split("|")[0].trim()}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-zinc-500">{p.stage}</td>
                  <td className="p-2 text-right text-zinc-300">
                    ${((p.amount || 0) / 1000).toFixed(0)}k
                  </td>
                  <td className="p-2 text-right">
                    <span
                      className={
                        p.days_to_pto !== null && p.days_to_pto < 0
                          ? "text-red-400"
                          : p.days_to_pto !== null && p.days_to_pto <= 30
                            ? "text-amber-400"
                            : "text-emerald-400"
                      }
                    >
                      {p.days_to_pto !== null ? `${p.days_to_pto}d` : "-"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stats.projects.length > 20 && (
            <div className="text-center text-zinc-500 text-sm py-2">
              Showing 20 of {stats.projects.length} projects
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function LocationComparisonPage() {
  const [projects, setProjects] = useState<TransformedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>("count");

  // Fetch data ---------------------------------------------------------------
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/projects?context=executive");
      if (!response.ok) throw new Error("Failed to fetch data");
      const data = await response.json();
      setProjects(
        (data.projects as RawProject[]).map(transformProject),
      );
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Derived data -------------------------------------------------------------
  const today = useMemo(() => new Date(), []);

  const locationStats = useMemo<LocationStat[]>(() => {
    const stats: Record<string, LocationStat> = {};

    projects.forEach((p) => {
      const loc = p.pb_location || "Unknown";
      if (!stats[loc]) {
        stats[loc] = {
          name: loc,
          count: 0,
          totalValue: 0,
          avgDaysToInstall: [],
          avgDaysToInspection: [],
          avgDaysToPTO: [],
          overdue: 0,
          thisMonth: 0,
          nextMonth: 0,
          stages: {},
          projects: [],
          avgInstall: null,
          avgInspection: null,
          avgPTO: null,
        };
      }

      const s = stats[loc];
      s.count++;
      s.totalValue += p.amount || 0;
      s.projects.push(p);

      if (p.days_to_install !== null) s.avgDaysToInstall.push(p.days_to_install);
      if (p.days_to_inspection !== null)
        s.avgDaysToInspection.push(p.days_to_inspection);
      if (p.days_to_pto !== null) s.avgDaysToPTO.push(p.days_to_pto);

      // Overdue: PTO not granted and forecast PTO is past
      if (!p.pto_granted && p.forecast_pto && new Date(p.forecast_pto) < today) {
        s.overdue++;
      }

      // PTO timing
      if (p.forecast_pto) {
        const ptoDate = new Date(p.forecast_pto);
        if (
          ptoDate.getMonth() === today.getMonth() &&
          ptoDate.getFullYear() === today.getFullYear()
        ) {
          s.thisMonth++;
        }
        const nextMonth = new Date(today);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        if (
          ptoDate.getMonth() === nextMonth.getMonth() &&
          ptoDate.getFullYear() === nextMonth.getFullYear()
        ) {
          s.nextMonth++;
        }
      }

      // Stage counts
      const stage = p.stage || "Unknown";
      s.stages[stage] = (s.stages[stage] || 0) + 1;
    });

    // Compute averages
    Object.values(stats).forEach((s) => {
      s.avgInstall = avg(s.avgDaysToInstall);
      s.avgInspection = avg(s.avgDaysToInspection);
      s.avgPTO = avg(s.avgDaysToPTO);
    });

    return Object.values(stats)
      .filter((s) => s.name !== "Unknown")
      .sort((a, b) => b.count - a.count);
  }, [projects, today]);

  const totals = useMemo(() => {
    return {
      count: locationStats.reduce((sum, l) => sum + l.count, 0),
      value: locationStats.reduce((sum, l) => sum + l.totalValue, 0),
      overdue: locationStats.reduce((sum, l) => sum + l.overdue, 0),
      thisMonth: locationStats.reduce((sum, l) => sum + l.thisMonth, 0),
    };
  }, [locationStats]);

  const selectedStats = selectedLocation
    ? locationStats.find((l) => l.name === selectedLocation) || null
    : null;

  // Handlers -----------------------------------------------------------------
  const handleBarClick = useCallback((name: string) => {
    setSelectedLocation(name);
  }, []);

  const toggleLocation = useCallback(
    (name: string) => {
      setSelectedLocation(selectedLocation === name ? null : name);
    },
    [selectedLocation],
  );

  // Loading state ------------------------------------------------------------
  if (loading && projects.length === 0) {
    return (
      <DashboardShell
        title="Location Comparison"
        subtitle="Pipeline performance across PB locations"
        accentColor="blue"
      >
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
            <p className="text-zinc-500">Loading location data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  // Error state --------------------------------------------------------------
  if (error && projects.length === 0) {
    return (
      <DashboardShell
        title="Location Comparison"
        subtitle="Pipeline performance across PB locations"
        accentColor="blue"
      >
        <div className="flex items-center justify-center py-32">
          <div className="text-center bg-[#12121a] border border-zinc-800 rounded-xl p-8">
            <div className="text-red-400 text-4xl mb-4">!</div>
            <h2 className="text-xl font-bold text-white mb-2">
              Failed to Load Data
            </h2>
            <p className="text-zinc-400 mb-4">{error}</p>
            <button
              onClick={() => fetchData()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  // Live indicator for header ------------------------------------------------
  const liveIndicator = (
    <div className="inline-flex items-center px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-sm">
      <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2 animate-pulse" />
      Live Data
    </div>
  );

  // Render -------------------------------------------------------------------
  return (
    <DashboardShell
      title="Location Comparison"
      subtitle="Pipeline performance across PB locations"
      accentColor="blue"
      lastUpdated={lastUpdated}
      headerRight={liveIndicator}
    >
      {/* Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          value={String(totals.count)}
          label="Total Projects"
        />
        <SummaryCard
          value={`$${(totals.value / 1_000_000).toFixed(1)}M`}
          label="Pipeline Value"
          color="text-emerald-400"
        />
        <SummaryCard
          value={String(totals.overdue)}
          label="Overdue"
          color="text-red-400"
        />
        <SummaryCard
          value={String(totals.thisMonth)}
          label="PTO This Month"
          color="text-blue-400"
        />
      </div>

      {/* Chart Section */}
      <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            Location Comparison
          </h2>
          <div className="flex gap-2">
            {(Object.keys(METRIC_LABELS) as MetricKey[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  metric === m
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                }`}
              >
                {METRIC_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <HorizontalBarChart
          locationStats={locationStats}
          metric={metric}
          onBarClick={handleBarClick}
        />
        <div className="text-center text-xs text-zinc-600 mt-3">
          Click a bar to see location details
        </div>
      </div>

      {/* Location Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {locationStats.map((loc) => (
          <LocationCard
            key={loc.name}
            loc={loc}
            isSelected={selectedLocation === loc.name}
            onClick={() => toggleLocation(loc.name)}
          />
        ))}
      </div>

      {/* Detail Panel */}
      {selectedStats && (
        <DetailPanel
          stats={selectedStats}
          onClose={() => setSelectedLocation(null)}
        />
      )}

      <div className="mt-8 text-center text-sm text-zinc-600">
        Data synced from HubSpot &middot; Auto-refreshes every 5 minutes
      </div>
    </DashboardShell>
  );
}
