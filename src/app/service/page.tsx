"use client";

import { useDeals } from "@/hooks/useProjects";
import { Header, StatCard } from "@/components/ui";

export default function ServicePage() {
  const { deals, stats, loading, error } = useDeals({
    pipeline: "service",
    activeOnly: true,
  });

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Service Pipeline"
        subtitle="Service jobs, scheduling, and work in progress tracking"
        loading={loading}
        error={error}
        showBackLink
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Active Jobs"
            value={stats?.total || 0}
            color="cyan"
            loading={loading}
          />
          <StatCard
            label="Total Value"
            value={`$${((stats?.totalValue || 0) / 1000).toFixed(0)}k`}
            color="orange"
            loading={loading}
          />
          <StatCard
            label="Scheduled"
            value={stats?.byStage?.["Scheduled"]?.count || 0}
            color="blue"
            loading={loading}
          />
          <StatCard
            label="In Progress"
            value={stats?.byStage?.["In Progress"]?.count || 0}
            color="green"
            loading={loading}
          />
        </div>

        {/* Stage Breakdown */}
        {stats?.byStage && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">Jobs by Stage</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(stats.byStage).map(([stage, data]) => (
                <div key={stage} className="bg-zinc-800/50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold stat-number text-cyan-400">{data.count}</div>
                  <div className="text-xs text-zinc-400">{stage}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Jobs List */}
        <h2 className="text-lg font-semibold mb-4">Service Jobs ({deals.length})</h2>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-zinc-500">Loading jobs...</div>
            ) : deals.length === 0 ? (
              <div className="p-8 text-center text-zinc-500">No service jobs found</div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {deals.map((deal) => (
                  <div key={deal.id} className="flex items-center justify-between p-4 hover:bg-zinc-800/50">
                    <div>
                      <div className="text-sm font-medium text-white">{deal.name}</div>
                      <div className="text-xs text-zinc-500">
                        {deal.stage} - {deal.location || "Unknown"}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          deal.stage === "In Progress"
                            ? "bg-green-500/20 text-green-400"
                            : deal.stage === "Scheduled"
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-zinc-700 text-zinc-400"
                        }`}
                      >
                        {deal.stage}
                      </span>
                      <a
                        href={deal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        View
                      </a>
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
