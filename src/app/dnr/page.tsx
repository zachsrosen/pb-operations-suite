"use client";

import { useDeals } from "@/hooks/useProjects";
import { Header, StatCard } from "@/components/ui";

export default function DNRPage() {
  const { deals, stats, loading, error } = useDeals({
    pipeline: "dnr",
    activeOnly: true,
  });

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="D&R Pipeline"
        subtitle="Detach & Reset projects with phase tracking"
        loading={loading}
        error={error}
        showBackLink
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Active D&R Projects"
            value={stats?.total || 0}
            color="purple"
            loading={loading}
          />
          <StatCard
            label="Pipeline Value"
            value={`$${((stats?.totalValue || 0) / 1000000).toFixed(2)}M`}
            color="orange"
            loading={loading}
          />
          <StatCard
            label="RTB"
            value={stats?.byStage?.["Ready to Build"]?.count || 0}
            color="green"
            loading={loading}
          />
          <StatCard
            label="In Construction"
            value={stats?.byStage?.["Construction"]?.count || 0}
            color="blue"
            loading={loading}
          />
        </div>

        {/* Stage Breakdown */}
        {stats?.byStage && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">Projects by Stage</h2>
            <div className="space-y-3">
              {Object.entries(stats.byStage)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([stage, data]) => (
                  <div key={stage} className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-purple-500" />
                      <div>
                        <div className="text-sm font-medium text-white">{stage}</div>
                        <div className="text-xs text-zinc-500">{data.count} projects</div>
                      </div>
                    </div>
                    <div className="text-sm font-bold stat-number text-purple-400">
                      ${(data.value / 1000).toFixed(0)}k
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Projects List */}
        <h2 className="text-lg font-semibold mb-4">D&R Projects ({deals.length})</h2>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-zinc-500">Loading projects...</div>
            ) : deals.length === 0 ? (
              <div className="p-8 text-center text-zinc-500">No D&R projects found</div>
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
                      <span className="text-sm font-bold stat-number text-purple-400">
                        ${((deal.amount || 0) / 1000).toFixed(0)}k
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
