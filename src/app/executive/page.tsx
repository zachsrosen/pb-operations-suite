"use client";

import { useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { Header, StatCard, StageBreakdown, LocationGrid } from "@/components/ui";
import { LOCATIONS } from "@/lib/config";

export default function ExecutivePage() {
  const { projects, stats, loading, error, lastUpdated } = useProjects({
    context: "executive",
    includeStats: true,
  });

  const executiveMetrics = useMemo(() => {
    // Monthly revenue forecast
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

    const thisMonthRevenue = projects
      .filter((p) => p.forecastedInstallDate?.startsWith(thisMonth))
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    const nextMonthRevenue = projects
      .filter((p) => p.forecastedInstallDate?.startsWith(nextMonthStr))
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    // Stage velocity (avg days in each stage)
    const stageVelocity = projects.reduce((acc, p) => {
      if (!acc[p.stage]) acc[p.stage] = { total: 0, count: 0 };
      acc[p.stage].total += p.daysSinceStageMovement || 0;
      acc[p.stage].count++;
      return acc;
    }, {} as Record<string, { total: number; count: number }>);

    // Top 10 highest value projects
    const topProjects = [...projects].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 10);

    // PE metrics
    const peProjects = projects.filter((p) => p.isParticipateEnergy);
    const peValue = peProjects.reduce((sum, p) => sum + (p.amount || 0), 0);

    return {
      thisMonthRevenue,
      nextMonthRevenue,
      stageVelocity,
      topProjects,
      peCount: peProjects.length,
      peValue,
      avgDealSize: (stats?.totalValue || 0) / (stats?.totalProjects || 1),
    };
  }, [projects, stats]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Executive Summary"
        subtitle="High-level KPIs, charts, and trends for leadership review"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
        showBackLink
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Top-Level KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Pipeline Value"
            value={`$${((stats?.totalValue || 0) / 1000000).toFixed(2)}M`}
            color="orange"
            loading={loading}
          />
          <StatCard
            label="Active Projects"
            value={stats?.totalProjects || 0}
            loading={loading}
          />
          <StatCard
            label="Avg Deal Size"
            value={`$${(executiveMetrics.avgDealSize / 1000).toFixed(0)}k`}
            loading={loading}
          />
          <StatCard
            label="Total System kW"
            value={`${((stats?.totalSystemSizeKw || 0) / 1000).toFixed(1)}MW`}
            color="green"
            loading={loading}
          />
        </div>

        {/* Revenue Forecast */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4 text-orange-400">Revenue Forecast</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-zinc-800/50 rounded-lg">
                <div>
                  <div className="text-sm text-zinc-400">This Month</div>
                  <div className="text-xs text-zinc-500">Based on forecasted install dates</div>
                </div>
                <div className="text-2xl font-bold stat-number text-orange-400">
                  ${(executiveMetrics.thisMonthRevenue / 1000000).toFixed(2)}M
                </div>
              </div>
              <div className="flex justify-between items-center p-4 bg-zinc-800/50 rounded-lg">
                <div>
                  <div className="text-sm text-zinc-400">Next Month</div>
                  <div className="text-xs text-zinc-500">Projected revenue</div>
                </div>
                <div className="text-2xl font-bold stat-number text-green-400">
                  ${(executiveMetrics.nextMonthRevenue / 1000000).toFixed(2)}M
                </div>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-emerald-500/50 rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4 text-emerald-400">Participate Energy</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 bg-zinc-800/50 rounded-lg">
                <div className="text-3xl font-bold stat-number text-emerald-400">
                  {executiveMetrics.peCount}
                </div>
                <div className="text-sm text-zinc-400">PE Projects</div>
              </div>
              <div className="text-center p-4 bg-zinc-800/50 rounded-lg">
                <div className="text-3xl font-bold stat-number text-emerald-400">
                  ${(executiveMetrics.peValue / 1000000).toFixed(2)}M
                </div>
                <div className="text-sm text-zinc-400">PE Value</div>
              </div>
            </div>
            <div className="mt-4 text-center">
              <div className="text-xs text-zinc-500">
                {((executiveMetrics.peCount / (stats?.totalProjects || 1)) * 100).toFixed(1)}% of total pipeline
              </div>
            </div>
          </div>
        </div>

        {/* Stage Breakdown */}
        {stats?.stageCounts && (
          <StageBreakdown stageCounts={stats.stageCounts} totalProjects={stats.totalProjects} />
        )}

        {/* Location Distribution */}
        {stats?.locationCounts && <LocationGrid locationCounts={stats.locationCounts} />}

        {/* Top Projects */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Top 10 Highest Value Projects</h3>
          <div className="space-y-2">
            {executiveMetrics.topProjects.map((project, index) => (
              <div
                key={project.id}
                className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <span className="text-xs text-zinc-500 w-6">{index + 1}.</span>
                  <div>
                    <div className="text-sm font-medium text-white">{project.name}</div>
                    <div className="text-xs text-zinc-500">
                      {project.pbLocation} - {project.stage}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {project.isParticipateEnergy && (
                    <span className="badge badge-pe">PE</span>
                  )}
                  <span className="text-lg font-bold stat-number text-orange-400">
                    ${((project.amount || 0) / 1000).toFixed(0)}k
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
