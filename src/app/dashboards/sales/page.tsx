"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCurrency } from "@/lib/format";
import { SALES_STAGES, ACTIVE_SALES_STAGES } from "@/lib/constants";
import { useProgressiveDeals } from "@/hooks/useProgressiveDeals";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Deal {
  name: string;
  pbLocation: string;
  stage: string;
  amount: number;
  closeDate?: string;
  city?: string;
  state?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGES = SALES_STAGES;
const ACTIVE_STAGES = ACTIVE_SALES_STAGES;

const STAGE_BG: Record<string, string> = {
  "Qualified to buy": "bg-blue-500",
  "Proposal Submitted": "bg-indigo-500",
  "Proposal Accepted": "bg-purple-500",
  "Finalizing Deal": "bg-violet-500",
  "Sales Follow Up": "bg-yellow-500",
  Nurture: "bg-orange-500",
  "Closed won": "bg-green-500",
  "Closed lost": "bg-red-500",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SalesPipelinePage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // State ------------------------------------------------------------------
  const {
    deals: allDeals,
    loading,
    loadingMore,
    progress,
    error,
    lastUpdated,
    refetch: fetchData,
  } = useProgressiveDeals<Deal>({
    params: { pipeline: "sales", active: "false" },
  });

  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [showActiveOnly, setShowActiveOnly] = useState(true);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("sales", {});
    }
  }, [loading, trackDashboardView]);

  // Derived data -----------------------------------------------------------
  const locations = useMemo(
    () =>
      [...new Set(allDeals.map((d) => d.pbLocation))]
        .filter((l) => l !== "Unknown")
        .sort(),
    [allDeals]
  );

  const activeDeals = useMemo(
    () => allDeals.filter((d) => ACTIVE_STAGES.includes(d.stage)),
    [allDeals]
  );

  const filteredDeals = useMemo(() => {
    return allDeals.filter((d) => {
      if (showActiveOnly && !ACTIVE_STAGES.includes(d.stage)) return false;
      if (filterLocation !== "all" && d.pbLocation !== filterLocation)
        return false;
      if (filterStage !== "all" && d.stage !== filterStage) return false;
      return true;
    });
  }, [allDeals, showActiveOnly, filterLocation, filterStage]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    STAGES.forEach((s) => (counts[s] = 0));
    activeDeals.forEach((d) => {
      if (counts[d.stage] !== undefined) counts[d.stage]++;
    });
    return counts;
  }, [activeDeals]);

  const totalValue = useMemo(
    () => activeDeals.reduce((sum, d) => sum + d.amount, 0),
    [activeDeals]
  );

  const proposalValue = useMemo(
    () =>
      activeDeals
        .filter(
          (d) =>
            d.stage === "Proposal Submitted" || d.stage === "Proposal Accepted"
        )
        .reduce((sum, d) => sum + d.amount, 0),
    [activeDeals]
  );

  const winRate = useMemo(() => {
    const closed = allDeals.filter(
      (d) => d.stage === "Closed won" || d.stage === "Closed lost"
    );
    const won = allDeals.filter((d) => d.stage === "Closed won");
    return closed.length > 0
      ? ((won.length / closed.length) * 100).toFixed(0)
      : "0";
  }, [allDeals]);

  const maxFunnelCount = useMemo(
    () => Math.max(...ACTIVE_STAGES.map((s) => stageCounts[s] || 0), 1),
    [stageCounts]
  );

  // Loading state ----------------------------------------------------------
  if (loading && allDeals.length === 0) {
    return (
      <DashboardShell title="Sales Pipeline" subtitle="Active Deals" accentColor="green">
        <LoadingSpinner color="green" message="Loading Sales Pipeline..." />
      </DashboardShell>
    );
  }

  // Error state ------------------------------------------------------------
  if (error && allDeals.length === 0) {
    return (
      <DashboardShell title="Sales Pipeline" subtitle="Active Deals" accentColor="green">
        <ErrorState message={error} onRetry={fetchData} color="green" />
      </DashboardShell>
    );
  }

  // Render -----------------------------------------------------------------
  return (
    <DashboardShell
      title="Sales Pipeline"
      subtitle={`Active Deals${loadingMore && progress ? ` \u2022 Loading ${progress.loaded}${progress.total ? `/${progress.total}` : ""} deals...` : lastUpdated ? ` \u2022 Last updated: ${lastUpdated}` : ""}`}
      accentColor="green"
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "Sales Pipeline" }]}
      headerRight={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showActiveOnly}
              onChange={() => setShowActiveOnly((prev) => !prev)}
              className="rounded bg-zinc-800 border-zinc-600"
            />
            Active only
          </label>

          <select
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="all">All Locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

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

          <button
            onClick={fetchData}
            className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-medium text-white"
          >
            Refresh
          </button>
        </div>
      }
    >
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-green-400">
            {activeDeals.length}
          </div>
          <div className="text-sm text-zinc-400">Active Deals</div>
        </div>

        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-emerald-400">
            {formatCurrency(totalValue)}
          </div>
          <div className="text-sm text-zinc-400">Pipeline Value</div>
        </div>

        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-purple-400">
            {formatCurrency(proposalValue)}
          </div>
          <div className="text-sm text-zinc-400">Proposal Value</div>
        </div>

        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-violet-400">
            {stageCounts["Finalizing Deal"]}
          </div>
          <div className="text-sm text-zinc-400">Finalizing</div>
        </div>

        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div
            className={`text-2xl font-bold ${Number(winRate) >= 50 ? "text-green-400" : "text-yellow-400"}`}
          >
            {winRate}%
          </div>
          <div className="text-sm text-zinc-400">Win Rate</div>
        </div>
      </div>

      {/* Sales Funnel */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">Sales Funnel</h2>
        <div className="space-y-2">
          {ACTIVE_STAGES.map((stage) => {
            const count = stageCounts[stage] || 0;
            const value = activeDeals
              .filter((d) => d.stage === stage)
              .reduce((sum, d) => sum + d.amount, 0);
            const widthPct =
              maxFunnelCount > 0 ? (count / maxFunnelCount) * 100 : 0;
            const barWidth = Math.max(widthPct, count > 0 ? 15 : 0);

            return (
              <div key={stage} className="flex items-center gap-4">
                <div className="w-36 text-sm text-zinc-300 truncate">
                  {stage}
                </div>
                <div className="flex-1 bg-zinc-800 rounded-full h-8 overflow-hidden">
                  <div
                    className={`${STAGE_BG[stage]} h-full rounded-full flex items-center justify-end pr-3 transition-all`}
                    style={{ width: `${barWidth}%` }}
                  >
                    <span className="text-xs font-bold text-white">
                      {count}
                    </span>
                  </div>
                </div>
                <div
                  className={`w-28 text-right text-sm font-mono ${value > 0 ? "text-green-400" : "text-zinc-600"}`}
                >
                  {formatCurrency(value)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Deals Table */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              Deals ({filteredDeals.length})
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
                  className="h-full bg-green-500 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
                />
              ) : (
                <div className="h-full w-1/3 bg-green-500 rounded-full animate-pulse" />
              )}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">
                  Deal
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
                  Close Date
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
                    No deals found
                  </td>
                </tr>
              ) : (
                filteredDeals.map((deal, idx) => {
                  const rowClass =
                    deal.stage === "Closed lost"
                      ? "opacity-40"
                      : deal.stage === "Closed won"
                        ? "bg-green-900/10"
                        : "";

                  return (
                    <tr
                      key={`${deal.name}-${idx}`}
                      className={`hover:bg-zinc-900/50 ${rowClass}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">
                          {deal.name}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {deal.city || ""} {deal.state || ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-300">
                        {deal.pbLocation}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${STAGE_BG[deal.stage] || "bg-zinc-600"} bg-opacity-20 text-white`}
                        >
                          {deal.stage}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono text-sm ${deal.amount > 0 ? "text-green-400" : "text-zinc-500"}`}
                      >
                        {formatCurrency(deal.amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">
                        {deal.closeDate || "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {deal.url ? (
                          <a
                            href={deal.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-400 hover:text-green-300 text-sm"
                          >
                            Open &rarr;
                          </a>
                        ) : (
                          <span className="text-zinc-600 text-sm">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
