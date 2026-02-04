"use client";

import { useState, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCurrency } from "@/lib/format";
import { DNR_STAGES } from "@/lib/constants";
import { useProgressiveDeals } from "@/hooks/useProgressiveDeals";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Deal {
  name: string;
  stage: string;
  amount: number;
  pbLocation: string;
  city?: string;
  state?: string;
  isActive: boolean;
  daysSinceCreate: number;
  url: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGES: string[] = [
  "Kickoff",
  "Site Survey",
  "Design",
  "Permit",
  "Ready for Detach",
  "Detach",
  "Detach Complete - Roofing In Progress",
  "Reset Blocked - Waiting on Payment",
  "Ready for Reset",
  "Reset",
  "Inspection",
  "Closeout",
  "Complete",
  "On-hold",
  "Cancelled",
];

const STAGE_COLORS: Record<string, string> = {
  Kickoff: "bg-blue-500",
  "Site Survey": "bg-indigo-500",
  Design: "bg-purple-500",
  Permit: "bg-violet-500",
  "Ready for Detach": "bg-yellow-500",
  Detach: "bg-orange-500",
  "Detach Complete - Roofing In Progress": "bg-amber-500",
  "Reset Blocked - Waiting on Payment": "bg-red-500",
  "Ready for Reset": "bg-lime-500",
  Reset: "bg-emerald-500",
  Inspection: "bg-teal-500",
  Closeout: "bg-cyan-500",
  Complete: "bg-green-500",
  "On-hold": "bg-zinc-500",
  Cancelled: "bg-red-700",
};

const STAGE_GROUPS: Record<string, string[]> = {
  "Pre-Work": ["Kickoff", "Site Survey", "Design", "Permit"],
  "Detach Phase": [
    "Ready for Detach",
    "Detach",
    "Detach Complete - Roofing In Progress",
  ],
  "Reset Phase": [
    "Reset Blocked - Waiting on Payment",
    "Ready for Reset",
    "Reset",
  ],
  Completion: ["Inspection", "Closeout"],
};

/** Short display labels for long stage names */
const STAGE_SHORT_LABELS: Record<string, string> = {
  "Detach Complete - Roofing In Progress": "Roofing IP",
  "Reset Blocked - Waiting on Payment": "Blocked",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateStage(stage: string, max = 25): string {
  return stage.length > max ? stage.substring(0, max - 3) + "..." : stage;
}

function ageColorClass(days: number): string {
  if (days > 60) return "text-red-400";
  if (days > 30) return "text-yellow-400";
  return "text-zinc-400";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DNRPipelinePage() {
  const {
    deals: allDeals,
    loading,
    loadingMore,
    progress,
    error,
    lastUpdated,
    refetch: fetchData,
  } = useProgressiveDeals<Deal>({
    params: { pipeline: "dnr", active: "false" },
  });

  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStage, setFilterStage] = useState("all");

  // ---- Derived data --------------------------------------------------------

  const locations = useMemo(
    () =>
      [...new Set(allDeals.map((d) => d.pbLocation))]
        .filter((l) => l !== "Unknown")
        .sort(),
    [allDeals],
  );

  const filteredDeals = useMemo(
    () =>
      allDeals.filter((d) => {
        if (filterLocation !== "all" && d.pbLocation !== filterLocation)
          return false;
        if (filterStage !== "all" && d.stage !== filterStage) return false;
        return true;
      }),
    [allDeals, filterLocation, filterStage],
  );

  const activeDeals = useMemo(
    () => filteredDeals.filter((d) => d.isActive),
    [filteredDeals],
  );

  const totalValue = useMemo(
    () => activeDeals.reduce((sum, d) => sum + d.amount, 0),
    [activeDeals],
  );

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    STAGES.forEach((s) => (counts[s] = 0));
    activeDeals.forEach((d) => {
      if (counts[d.stage] !== undefined) counts[d.stage]++;
    });
    return counts;
  }, [activeDeals]);

  const blockedCount = useMemo(
    () =>
      activeDeals.filter(
        (d) =>
          d.stage === "Reset Blocked - Waiting on Payment" ||
          d.stage === "On-hold",
      ).length,
    [activeDeals],
  );

  // ---- Loading state -------------------------------------------------------

  if (loading && allDeals.length === 0) {
    return (
      <DashboardShell title="D&R Pipeline" subtitle="Detach & Reset Projects" accentColor="purple">
        <LoadingSpinner color="purple" message="Loading D&R Pipeline..." />
      </DashboardShell>
    );
  }

  // ---- Error state ---------------------------------------------------------

  if (error && allDeals.length === 0) {
    return (
      <DashboardShell title="D&R Pipeline" subtitle="Detach & Reset Projects" accentColor="purple">
        <ErrorState message={error} onRetry={fetchData} color="purple" />
      </DashboardShell>
    );
  }

  // ---- Main render ---------------------------------------------------------

  return (
    <DashboardShell
      title="D&R Pipeline"
      subtitle={`Detach & Reset Projects${loadingMore && progress ? ` \u2022 Loading ${progress.loaded}${progress.total ? `/${progress.total}` : ""} deals...` : lastUpdated ? ` \u2022 Last updated: ${lastUpdated}` : ""}`}
      accentColor="purple"
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "D&R Pipeline" }]}
      headerRight={
        <div className="flex items-center gap-3">
          {/* Location filter */}
          <select
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="all">All Locations</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>

          {/* Stage filter */}
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="all">All Stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Refresh */}
          <button
            onClick={fetchData}
            className="bg-violet-600 hover:bg-violet-700 px-4 py-2 rounded-lg text-sm font-medium text-white"
          >
            Refresh
          </button>
        </div>
      }
    >
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Active Projects" value={activeDeals.length} color="text-violet-400" />
        <StatCard label="Pipeline Value" value={formatCurrency(totalValue)} color="text-green-400" />
        <StatCard
          label="Detach Phase"
          value={stageCounts["Detach"] + stageCounts["Ready for Detach"]}
          color="text-orange-400"
        />
        <StatCard
          label="Reset Phase"
          value={stageCounts["Reset"] + stageCounts["Ready for Reset"]}
          color="text-emerald-400"
        />
        <StatCard label="Blocked/On-Hold" value={blockedCount} color="text-red-400" />
      </div>

      {/* Stage groups */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {Object.entries(STAGE_GROUPS).map(([group, stages]) => (
          <div
            key={group}
            className="bg-[#12121a] rounded-xl border border-zinc-800 p-4"
          >
            <h3 className="text-sm font-semibold text-zinc-400 mb-3">
              {group}
            </h3>
            <div className="space-y-2">
              {stages.map((stage) => (
                <div key={stage} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300 truncate">
                    {STAGE_SHORT_LABELS[stage] ?? stage}
                  </span>
                  <span
                    className={`text-sm font-bold ${
                      stageCounts[stage] > 0 ? "text-white" : "text-zinc-600"
                    }`}
                  >
                    {stageCounts[stage] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Deals table */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              D&R Projects ({filteredDeals.length})
              {filteredDeals.length !== activeDeals.length && (
                <span className="text-sm font-normal text-zinc-500 ml-2">
                  {activeDeals.length} active
                </span>
              )}
            </h2>
            {loadingMore && progress && (
              <span className="text-xs text-zinc-500">
                Loading {progress.loaded}{progress.total ? ` of ${progress.total}` : ""} deals...
              </span>
            )}
          </div>
          {loadingMore && (
            <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
              {progress?.total ? (
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
                />
              ) : (
                <div className="h-full w-1/3 bg-violet-500 rounded-full animate-pulse" />
              )}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">
                  Project
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">
                  Location
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">
                  Stage
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-400 uppercase">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">
                  Age
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-zinc-400 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredDeals.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    No projects found
                  </td>
                </tr>
              ) : (
                filteredDeals.map((deal, idx) => (
                  <tr
                    key={`${deal.name}-${idx}`}
                    className={`hover:bg-zinc-900/50 ${
                      !deal.isActive ? "opacity-50" : ""
                    } ${deal.stage.includes("Blocked") ? "bg-red-900/10" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{deal.name}</div>
                      <div className="text-xs text-zinc-500">
                        {deal.city || ""} {deal.state || ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300">
                      {deal.pbLocation}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          STAGE_COLORS[deal.stage] || "bg-zinc-600"
                        } bg-opacity-20 text-white`}
                      >
                        {truncateStage(deal.stage)}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-sm ${
                        deal.amount > 0 ? "text-green-400" : "text-zinc-500"
                      }`}
                    >
                      {formatCurrency(deal.amount)}
                    </td>
                    <td
                      className={`px-4 py-3 text-sm ${ageColorClass(deal.daysSinceCreate)}`}
                    >
                      {deal.daysSinceCreate}d
                    </td>
                    <td className="px-4 py-3 text-center">
                      <a
                        href={deal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet-400 hover:text-violet-300 text-sm"
                      >
                        Open &rarr;
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-zinc-400">{label}</div>
    </div>
  );
}
