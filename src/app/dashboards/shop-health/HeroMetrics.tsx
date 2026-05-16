'use client';

import type { ShopHealthHeroes, HeroMetric } from '@/lib/shop-health-types';

const HEALTH_BORDER: Record<string, string> = {
  green: 'border-emerald-500/30',
  yellow: 'border-yellow-500/30',
  red: 'border-red-500/30',
};
const HEALTH_BG: Record<string, string> = {
  green: 'bg-emerald-500/5',
  yellow: 'bg-yellow-500/5',
  red: 'bg-red-500/5',
};

function HeroCard({
  label,
  metric,
  deferred,
}: {
  label: string;
  metric: HeroMetric | null;
  deferred?: boolean;
}) {
  if (deferred || !metric) {
    return (
      <div className="bg-surface rounded-xl border border-border p-4 flex flex-col items-center justify-center min-h-[120px] opacity-50">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-xs text-muted mt-1">Coming soon</span>
      </div>
    );
  }
  return (
    <div
      className={`rounded-xl border-2 ${HEALTH_BORDER[metric.health] || ''} ${HEALTH_BG[metric.health] || ''} p-4 flex flex-col items-center justify-center min-h-[120px]`}
    >
      <span className="text-sm text-muted mb-1">{label}</span>
      <span className="text-3xl font-bold text-foreground">
        {metric.value % 1 !== 0 ? metric.value.toFixed(1) : metric.value}
      </span>
      {metric.delta !== null && (
        <span
          className={`text-xs mt-1 ${
            metric.delta > 0
              ? 'text-emerald-500'
              : metric.delta < 0
                ? 'text-red-500'
                : 'text-muted'
          }`}
        >
          {metric.delta > 0 ? '▲' : metric.delta < 0 ? '▼' : '–'}{' '}
          {Math.abs(metric.delta)} vs last week
        </span>
      )}
      {metric.target !== null && (
        <span className="text-xs text-muted">target: {metric.target}</span>
      )}
    </div>
  );
}

export function HeroMetrics({ heroes }: { heroes: ShopHealthHeroes }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <HeroCard label="Leads" metric={null} deferred />
      <HeroCard label="Backlog (weeks)" metric={heroes.backlogWeeks} />
      <HeroCard label="Ready to Build" metric={heroes.readyToBuild} />
      <HeroCard label="Scheduled (2-4 wk)" metric={heroes.scheduledInstalls} />
      <HeroCard label="Installs Completed" metric={heroes.installsCompleted} />
      <HeroCard label="PTOs Received" metric={heroes.ptosReceived} />
    </div>
  );
}
