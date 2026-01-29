"use client";

import { useDeals } from "@/hooks/useProjects";
import { Header, StatCard } from "@/components/ui";

export default function SalesPage() {
  const { deals, stats, loading, error, refresh } = useDeals({
    pipeline: "sales",
    activeOnly: true,
  });

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Sales Pipeline"
        subtitle="Active deals, funnel visualization, and proposal tracking"
        loading={loading}
        error={error}
        showBackLink
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Active Deals"
            value={stats?.total || 0}
            color="green"
            loading={loading}
          />
          <StatCard
            label="Pipeline Value"
            value={`$${((stats?.totalValue || 0) / 1000000).toFixed(2)}M`}
            color="orange"
            loading={loading}
          />
          <StatCard
            label="Avg Deal Size"
            value={`$${((stats?.totalValue || 0) / (stats?.total || 1) / 1000).toFixed(0)}k`}
            loading={loading}
          />
          <StatCard
            label="Stages"
            value={Object.keys(stats?.byStage || {}).length}
            loading={loading}
          />
        </div>

        {/* Stage Breakdown */}
        {stats?.byStage && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">Deals by Stage</h2>
            <div className="space-y-3">
              {Object.entries(stats.byStage)
                .sort((a, b) => b[1].value - a[1].value)
                .map(([stage, data]) => (
                  <div key={stage} className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-white">{stage}</div>
                      <div className="text-xs text-zinc-500">{data.count} deals</div>
                    </div>
                    <div className="text-sm font-bold stat-number text-green-400">
                      ${(data.value / 1000000).toFixed(2)}M
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Deals List */}
        <h2 className="text-lg font-semibold mb-4">Recent Deals ({deals.length})</h2>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-zinc-500">Loading deals...</div>
            ) : deals.length === 0 ? (
              <div className="p-8 text-center text-zinc-500">No deals found</div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {deals.slice(0, 50).map((deal) => (
                  <div key={deal.id} className="flex items-center justify-between p-4 hover:bg-zinc-800/50">
                    <div>
                      <div className="text-sm font-medium text-white">{deal.name}</div>
                      <div className="text-xs text-zinc-500">
                        {deal.stage} - {deal.location || "Unknown"}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-bold stat-number text-green-400">
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
