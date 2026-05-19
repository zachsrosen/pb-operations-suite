'use client';

import { useShopHealthOverview } from '@/hooks/useShopHealthData';
import type { HealthStatus, HeroMetric, ShopHealthOverviewRow } from '@/lib/shop-health-types';

const HEALTH_DOT: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
};

const HEALTH_BG: Record<HealthStatus, string> = {
  green: 'bg-emerald-500/5',
  yellow: 'bg-amber-500/5',
  red: 'bg-red-500/5',
};

function MetricCell({ metric }: { metric: HeroMetric }) {
  return (
    <td className={`py-3.5 px-4 text-center ${HEALTH_BG[metric.health]}`}>
      <div className="flex items-center justify-center gap-2">
        <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[metric.health]} shadow-sm`} />
        <span className="text-foreground font-semibold tabular-nums text-base">
          {metric.value % 1 !== 0 ? metric.value.toFixed(1) : metric.value}
        </span>
      </div>
      {metric.target !== null && (
        <div className="text-xs text-muted mt-0.5 tabular-nums">/ {metric.target}</div>
      )}
    </td>
  );
}

function LocationRow({ row }: { row: ShopHealthOverviewRow }) {
  return (
    <tr className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
      <td className="py-3.5 px-4 font-semibold text-foreground">{row.location}</td>
      <MetricCell metric={row.backlogWeeks} />
      <MetricCell metric={row.readyToBuild} />
      <MetricCell metric={row.scheduledInstalls} />
      <MetricCell metric={row.installsCompleted} />
      <MetricCell metric={row.ptosReceived} />
      <td className="py-3.5 px-4 text-sm text-muted max-w-[220px]">
        {row.topBottleneck ? (
          <span className="inline-flex items-center gap-1.5 bg-amber-500/10 text-amber-300 px-2 py-1 rounded-md text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {row.topBottleneck}
          </span>
        ) : (
          <span className="text-muted/50 italic">None set</span>
        )}
      </td>
    </tr>
  );
}

interface AllLocationsViewProps {
  weekStart: string;
}

export function AllLocationsView({ weekStart }: AllLocationsViewProps) {
  const { data, isLoading, error } = useShopHealthOverview(weekStart);

  if (isLoading) {
    return (
      <div className="bg-surface rounded-xl border border-border shadow-card p-6">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 bg-surface-2 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-surface rounded-xl border border-red-500/30 shadow-card p-8 text-center">
        <div className="text-red-400 font-semibold mb-1">Failed to load overview</div>
        <div className="text-sm text-muted">Try refreshing the page</div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50">
              <th className="text-left py-3 px-4 text-muted font-semibold text-xs uppercase tracking-wider">Location</th>
              <th className="text-center py-3 px-4 text-muted font-semibold text-xs uppercase tracking-wider">Backlog</th>
              <th className="text-center py-3 px-4 text-muted font-semibold text-xs uppercase tracking-wider">RTB</th>
              <th className="text-center py-3 px-4 text-muted font-semibold text-xs uppercase tracking-wider">Scheduled</th>
              <th className="text-center py-3 px-4 text-muted font-semibold text-xs uppercase tracking-wider">Installs</th>
              <th className="text-center py-3 px-4 text-muted font-semibold text-xs uppercase tracking-wider">PTOs</th>
              <th className="text-left py-3 px-4 text-muted font-semibold text-xs uppercase tracking-wider">Bottleneck</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <LocationRow key={row.location} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
