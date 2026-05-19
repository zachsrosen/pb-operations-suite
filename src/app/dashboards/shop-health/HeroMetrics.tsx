'use client';

import type { ShopHealthHeroes, HeroMetric, HealthStatus } from '@/lib/shop-health-types';

const HEALTH_GRADIENT: Record<HealthStatus, string> = {
  green: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/40',
  yellow: 'from-amber-500/20 to-amber-500/5 border-amber-500/40',
  red: 'from-red-500/20 to-red-500/5 border-red-500/40',
};

const HEALTH_GLOW: Record<HealthStatus, string> = {
  green: 'shadow-emerald-500/10',
  yellow: 'shadow-amber-500/10',
  red: 'shadow-red-500/10',
};

const HEALTH_LABEL: Record<HealthStatus, string> = {
  green: 'text-emerald-400',
  yellow: 'text-amber-400',
  red: 'text-red-400',
};

/** Format a number as compact dollars: $291K, $1.3M, etc. */
function formatCompactDollars(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function HeroCard({
  label,
  metric,
  icon,
  currency,
}: {
  label: string;
  metric: HeroMetric;
  icon: string;
  /** When true, format value/target/delta as compact dollars */
  currency?: boolean;
}) {
  const formatVal = (v: number) =>
    currency ? formatCompactDollars(v) : (v % 1 !== 0 ? v.toFixed(1) : String(v));

  return (
    <div
      className={`bg-gradient-to-br ${HEALTH_GRADIENT[metric.health]} border-2 rounded-xl p-5 flex flex-col items-center justify-center min-h-[140px] shadow-lg ${HEALTH_GLOW[metric.health]} transition-all hover:scale-[1.02]`}
    >
      <span className="text-lg mb-0.5">{icon}</span>
      <span className={`text-xs font-semibold uppercase tracking-wider mb-2 ${HEALTH_LABEL[metric.health]}`}>
        {label}
      </span>
      <span className={`font-bold text-foreground tabular-nums tracking-tight ${currency ? 'text-2xl' : 'text-4xl'}`}>
        {formatVal(metric.value)}
      </span>
      {metric.target !== null && (
        <div className="flex items-center gap-1 mt-1.5">
          <div className="h-1 w-16 bg-surface-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                metric.health === 'green' ? 'bg-emerald-500' :
                metric.health === 'yellow' ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min((metric.value / metric.target) * 100, 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted tabular-nums">/ {formatVal(metric.target)}</span>
        </div>
      )}
      {metric.delta !== null && (
        <span
          className={`text-xs mt-1.5 font-medium ${
            metric.delta > 0
              ? 'text-emerald-400'
              : metric.delta < 0
                ? 'text-red-400'
                : 'text-muted'
          }`}
        >
          {metric.delta > 0 ? '▲ ' : metric.delta < 0 ? '▼ ' : ''}
          {metric.delta !== 0
            ? (currency ? formatCompactDollars(Math.abs(metric.delta)) : (Math.abs(metric.delta) % 1 !== 0 ? Math.abs(metric.delta).toFixed(1) : String(Math.abs(metric.delta))))
            : '–'} vs prior wk
        </span>
      )}
    </div>
  );
}

export function HeroMetrics({ heroes }: { heroes: ShopHealthHeroes }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <HeroCard label="Revenue" metric={heroes.weeklyRevenue} icon="💰" currency />
      <HeroCard label="Backlog" metric={heroes.backlogWeeks} icon="📋" />
      <HeroCard label="Ready to Build" metric={heroes.readyToBuild} icon="🔧" />
      <HeroCard label="Scheduled" metric={heroes.scheduledInstalls} icon="📅" />
      <HeroCard label="Installs" metric={heroes.installsCompleted} icon="⚡" />
      <HeroCard label="PTOs" metric={heroes.ptosReceived} icon="✅" />
    </div>
  );
}
