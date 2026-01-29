"use client";

import { useMemo, useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import { Header, StatCard } from "@/components/ui";
import { CREWS_BY_LOCATION, LOCATIONS, type LocationKey } from "@/lib/config";

export default function OptimizerPage() {
  const { projects, loading, error, lastUpdated, refresh } = useProjects({
    context: "scheduling",
    includeStats: false,
  });

  const [optimizing, setOptimizing] = useState(false);

  // Calculate optimization metrics
  const metrics = useMemo(() => {
    const rtbProjects = projects.filter((p) => p.isRtb);
    const unscheduled = rtbProjects.filter((p) => !p.constructionScheduleDate);
    const scheduled = projects.filter((p) => p.constructionScheduleDate);

    // Capacity utilization by location
    const utilization: Record<string, { scheduled: number; capacity: number }> = {};
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    Object.keys(CREWS_BY_LOCATION).forEach((loc) => {
      const locKey = loc as LocationKey;
      const config = CREWS_BY_LOCATION[locKey];
      const scheduledThisMonth = scheduled.filter(
        (p) => p.pbLocation === loc && p.constructionScheduleDate?.startsWith(thisMonth)
      ).length;

      utilization[loc] = {
        scheduled: scheduledThisMonth,
        capacity: config.monthlyCapacity,
      };
    });

    // Bottlenecks
    const blockedProjects = projects.filter((p) => p.isBlocked);
    const overdueProjects = projects.filter(
      (p) => p.daysToInstall !== null && p.daysToInstall < 0 && !p.constructionCompleteDate
    );

    // Revenue opportunity
    const unscheduledValue = unscheduled.reduce((sum, p) => sum + (p.amount || 0), 0);

    return {
      rtbProjects,
      unscheduled,
      scheduled,
      utilization,
      blockedProjects,
      overdueProjects,
      unscheduledValue,
    };
  }, [projects]);

  const runOptimization = async () => {
    setOptimizing(true);
    // Simulate optimization (in reality this would call an API)
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setOptimizing(false);
    alert("Optimization complete! In a real implementation, this would auto-schedule RTB projects based on capacity and priority.");
  };

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Pipeline Optimizer"
        subtitle="AI-powered scheduling optimization and bottleneck detection"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
        showBackLink
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Optimization Action Panel */}
        <div className="bg-surface-gradient border border-orange-500 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-orange-400">AI Schedule Optimizer</h2>
              <p className="text-sm text-zinc-400">
                Auto-schedule RTB projects based on crew capacity, priority, and revenue
              </p>
            </div>
            <button
              onClick={runOptimization}
              disabled={optimizing || loading}
              className="btn-accent px-6 py-3 rounded-lg disabled:opacity-50"
            >
              {optimizing ? "Optimizing..." : "Run Optimization"}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold stat-number text-white">
                {metrics.unscheduled.length}
              </div>
              <div className="text-xs text-zinc-500">Unscheduled RTB</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold stat-number text-orange-400">
                ${(metrics.unscheduledValue / 1000000).toFixed(2)}M
              </div>
              <div className="text-xs text-zinc-500">Revenue Opportunity</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold stat-number text-yellow-400">
                {metrics.blockedProjects.length}
              </div>
              <div className="text-xs text-zinc-500">Blocked Projects</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold stat-number text-red-400">
                {metrics.overdueProjects.length}
              </div>
              <div className="text-xs text-zinc-500">Overdue</div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total RTB" value={metrics.rtbProjects.length} color="emerald" loading={loading} />
          <StatCard label="Scheduled" value={metrics.scheduled.length} color="blue" loading={loading} />
          <StatCard
            label="Utilization"
            value={`${Math.round(
              (Object.values(metrics.utilization).reduce((sum, u) => sum + u.scheduled, 0) /
                Object.values(metrics.utilization).reduce((sum, u) => sum + u.capacity, 0)) *
                100
            )}%`}
            loading={loading}
          />
          <StatCard
            label="Blocked"
            value={metrics.blockedProjects.length}
            color="orange"
            alert={metrics.blockedProjects.length > 10}
            loading={loading}
          />
        </div>

        {/* Capacity by Location */}
        <h2 className="text-lg font-semibold mb-4">Capacity by Location</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {Object.entries(metrics.utilization).map(([location, data]) => {
            const percent = Math.round((data.scheduled / data.capacity) * 100);
            const status = percent > 100 ? "over" : percent > 80 ? "warning" : "ok";

            return (
              <div key={location} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-white">{location}</h3>
                  <span
                    className={`text-sm font-bold stat-number ${
                      status === "over" ? "text-red-400" : status === "warning" ? "text-yellow-400" : "text-green-400"
                    }`}
                  >
                    {percent}%
                  </span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-3 overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full transition-all ${
                      status === "over" ? "bg-red-500" : status === "warning" ? "bg-yellow-500" : "bg-green-500"
                    }`}
                    style={{ width: `${Math.min(percent, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>{data.scheduled} scheduled</span>
                  <span>{data.capacity} capacity</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Unscheduled RTB Projects */}
        <h2 className="text-lg font-semibold mb-4">Unscheduled RTB Projects ({metrics.unscheduled.length})</h2>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="max-h-96 overflow-y-auto">
            {metrics.unscheduled.length === 0 ? (
              <div className="p-8 text-center text-zinc-500">All RTB projects are scheduled!</div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {metrics.unscheduled
                  .sort((a, b) => b.priorityScore - a.priorityScore)
                  .map((project) => (
                    <div key={project.id} className="flex items-center justify-between p-4 hover:bg-zinc-800/50">
                      <div>
                        <div className="text-sm font-medium text-white">{project.name}</div>
                        <div className="text-xs text-zinc-500">
                          {project.pbLocation} - Priority: {project.priorityScore.toFixed(0)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {project.isParticipateEnergy && <span className="badge badge-pe">PE</span>}
                        <span className="text-sm font-bold stat-number text-orange-400">
                          ${((project.amount || 0) / 1000).toFixed(0)}k
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
