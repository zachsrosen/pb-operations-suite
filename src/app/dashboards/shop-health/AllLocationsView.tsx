'use client';

import { useShopHealthOverview } from '@/hooks/useShopHealthData';
import type { HealthStatus, HeroMetric, ShopHealthOverviewRow } from '@/lib/shop-health-types';

const HEALTH_DOT: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
};

function HealthDot({ health }: { health: HealthStatus }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${HEALTH_DOT[health]}`} />;
}

function MetricCell({ metric }: { metric: HeroMetric }) {
  return (
    <td className="py-3 px-4 text-center">
      <div className="flex items-center justify-center gap-2">
        <HealthDot health={metric.health} />
        <span className="text-foreground font-medium tabular-nums">
          {metric.value % 1 !== 0 ? metric.value.toFixed(1) : metric.value}
        </span>
      </div>
      {metric.target !== null && (
        <div className="text-xs text-muted mt-0.5">/ {metric.target}</div>
      )}
    </td>
  );
}

function LocationRow({ row }: { row: ShopHealthOverviewRow }) {
  return (
    <tr className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
      <td className="py-3 px-4 font-medium text-foreground">{row.location}</td>
      <MetricCell metric={row.backlogWeeks} />
      <MetricCell metric={row.readyToBuild} />
      <MetricCell metric={row.scheduledInstalls} />
      <MetricCell metric={row.installsCompleted} />
      <MetricCell metric={row.ptosReceived} />
      <td className="py-3 px-4 text-sm text-muted max-w-[200px] truncate">
        {row.topBottleneck ?? '—'}
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
            <div key={i} className="h-12 bg-surface-2 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-surface rounded-xl border border-border shadow-card p-6 text-center text-muted">
        Failed to load overview data
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50">
              <th className="text-left py-3 px-4 text-muted font-medium">Location</th>
              <th className="text-center py-3 px-4 text-muted font-medium">Backlog (wks)</th>
              <th className="text-center py-3 px-4 text-muted font-medium">Ready to Build</th>
              <th className="text-center py-3 px-4 text-muted font-medium">Scheduled</th>
              <th className="text-center py-3 px-4 text-muted font-medium">Installs</th>
              <th className="text-center py-3 px-4 text-muted font-medium">PTOs</th>
              <th className="text-left py-3 px-4 text-muted font-medium">Top Bottleneck</th>
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
