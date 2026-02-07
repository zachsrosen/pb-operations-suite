"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCurrency } from "@/lib/format";
import { SERVICE_STAGES } from "@/lib/constants";
import { useProgressiveDeals } from "@/hooks/useProgressiveDeals";

// --- Types ---

interface Deal {
  id: number;
  name: string;
  amount: number;
  stage: string;
  stageId: string;
  pipeline: string;
  pbLocation: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  projectType: string;
  closeDate: string | null;
  createDate: string | null;
  lastModified: string | null;
  url: string;
  isActive: boolean;
  daysSinceCreate: number;
}

// --- Constants ---

const STAGES = [
  "Project Preparation",
  "Site Visit Scheduling",
  "Work In Progress",
  "Inspection",
  "Invoicing",
  "Completed",
  "Cancelled",
] as const;

type StageName = (typeof STAGES)[number];

const STAGE_COLORS: Record<StageName, string> = {
  "Project Preparation": "bg-blue-500",
  "Site Visit Scheduling": "bg-purple-500",
  "Work In Progress": "bg-yellow-500",
  Inspection: "bg-orange-500",
  Invoicing: "bg-pink-500",
  Completed: "bg-green-500",
  Cancelled: "bg-red-500",
};

const PIPELINE_STAGES = STAGES.filter(
  (s) => s !== "Completed" && s !== "Cancelled"
);

// --- Component ---

export default function ServicePipelinePage() {
  const {
    deals: allDeals,
    loading,
    loadingMore,
    progress,
    error,
    lastUpdated,
    refetch: fetchData,
  } = useProgressiveDeals<Deal>({
    params: { pipeline: "service", active: "false" },
  });

  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStage, setFilterStage] = useState("all");

  // Activity tracking
  const { trackDashboardView, trackFilter } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // Track dashboard view
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("service", { projectCount: allDeals.length });
    }
  }, [loading, allDeals.length, trackDashboardView]);

  // Track filter changes
  useEffect(() => {
    if (!loading && hasTrackedView.current) {
      trackFilter("service", { location: filterLocation, stage: filterStage });
    }
  }, [filterLocation, filterStage, loading, trackFilter]);

  // Unique locations for filter dropdown
  const locations = useMemo(
    () =>
      [...new Set(allDeals.map((d) => d.pbLocation))]
        .filter((l) => l !== "Unknown")
        .sort(),
    [allDeals]
  );

  // Filtered deals
  const filteredDeals = useMemo(
    () =>
      allDeals.filter((d) => {
        if (filterLocation !== "all" && d.pbLocation !== filterLocation)
          return false;
        if (filterStage !== "all" && d.stage !== filterStage) return false;
        return true;
      }),
    [allDeals, filterLocation, filterStage]
  );

  // Active deals from filtered set
  const activeDeals = useMemo(
    () => filteredDeals.filter((d) => d.isActive),
    [filteredDeals]
  );

  // Stats
  const totalValue = useMemo(
    () => activeDeals.reduce((sum, d) => sum + d.amount, 0),
    [activeDeals]
  );

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    STAGES.forEach((s) => (counts[s] = 0));
    activeDeals.forEach((d) => {
      if (counts[d.stage] !== undefined) counts[d.stage]++;
    });
    return counts;
  }, [activeDeals]);

  // --- Loading state ---
  if (loading && allDeals.length === 0) {
    return (
      <DashboardShell title="Service Pipeline" accentColor="blue">
        <LoadingSpinner color="blue" message="Loading Service Pipeline..." />
      </DashboardShell>
    );
  }

  // --- Error state ---
  if (error && allDeals.length === 0) {
    return (
      <DashboardShell title="Service Pipeline" accentColor="blue">
        <ErrorState message={error} onRetry={fetchData} color="blue" />
      </DashboardShell>
    );
  }

  // --- Header controls ---
  const headerRight = (
    <div className="flex items-center gap-3">
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

      <select
        value={filterStage}
        onChange={(e) => setFilterStage(e.target.value)}
        className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
      >
        <option value="all">All Stages</option>
        {STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {stage}
          </option>
        ))}
      </select>

      <button
        onClick={fetchData}
        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium text-white"
      >
        Refresh
      </button>
    </div>
  );

  return (
    <DashboardShell
      title="Service Pipeline"
      subtitle={loadingMore && progress ? `Loading ${progress.loaded}${progress.total ? `/${progress.total}` : ""} deals...` : undefined}
      accentColor="blue"
      lastUpdated={lastUpdated}
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "Service Pipeline" }]}
      headerRight={headerRight}
    >
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-blue-400">
            {activeDeals.length}
          </div>
          <div className="text-sm text-zinc-400">Active Jobs</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-green-400">
            {formatCurrency(totalValue)}
          </div>
          <div className="text-sm text-zinc-400">Pipeline Value</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-yellow-400">
            {stageCounts["Work In Progress"]}
          </div>
          <div className="text-sm text-zinc-400">In Progress</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-orange-400">
            {stageCounts["Inspection"]}
          </div>
          <div className="text-sm text-zinc-400">Inspection</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-pink-400">
            {stageCounts["Invoicing"]}
          </div>
          <div className="text-sm text-zinc-400">Invoicing</div>
        </div>
      </div>

      {/* Pipeline Stages Visualization */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">Pipeline Stages</h2>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {PIPELINE_STAGES.map((stage) => (
            <div key={stage} className="flex-1 min-w-[140px]">
              <div className="text-center mb-2">
                <span className="text-xs text-zinc-400">{stage}</span>
                <div className="text-lg font-bold">{stageCounts[stage] || 0}</div>
              </div>
              <div
                className={`h-2 ${STAGE_COLORS[stage]} rounded-full opacity-60`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Service Jobs Table */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              Service Jobs ({filteredDeals.length})
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
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
                />
              ) : (
                <div className="h-full w-1/3 bg-blue-500 rounded-full animate-pulse" />
              )}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">
                  Job
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
                  Created
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
                    No jobs found
                  </td>
                </tr>
              ) : (
                filteredDeals.map((deal) => (
                  <tr
                    key={deal.id}
                    className={`hover:bg-zinc-900/50 ${
                      !deal.isActive ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{deal.name}</div>
                      <div className="text-xs text-zinc-500">
                        {deal.address || "No address"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300">
                      {deal.pbLocation}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          STAGE_COLORS[deal.stage as StageName] || "bg-zinc-600"
                        } bg-opacity-20 text-white`}
                      >
                        {deal.stage}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-sm ${
                        deal.amount > 0 ? "text-green-400" : "text-zinc-500"
                      }`}
                    >
                      {formatCurrency(deal.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {deal.createDate || "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <a
                        href={deal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-sm"
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
