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

function HeroCard({
  label,
  metric,
  deferred,
  icon,
}: {
  label: string;
  metric: HeroMetric | null;
  deferred?: boolean;
  icon: string;
}) {
  if (deferred || !metric) {
    return (
      <div className="bg-surface rounded-xl border border-border p-5 flex flex-col items-center justify-center min-h-[140px] opacity-40">
        <span className="text-lg mb-1">{icon}</span>
        <span className="text-sm text-muted font-medium">{label}</span>
        <span className="text-xs text-muted mt-1 italic">Coming soon</span>
      </div>
    );
  }

  return (
    <div
      className={`bg-gradient-to-br ${HEALTH_GRADIENT[metric.health]} border-2 rounded-xl p-5 flex flex-col items-center justify-center min-h-[140px] shadow-lg ${HEALTH_GLOW[metric.health]} transition-all hover:scale-[1.02]`}
    >
      <span className="text-lg mb-0.5">{icon}</span>
      <span className={`text-xs font-semibold uppercase tracking-wider mb-2 ${HEALTH_LABEL[metric.health]}`}>
        {label}
      </span>
      <span className="text-4xl font-bold text-foreground tabular-nums tracking-tight">
        {metric.value % 1 !== 0 ? metric.value.toFixed(1) : metric.value}
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
          <span className="text-xs text-muted tabular-nums">/ {metric.target}</span>
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
            ? (Math.abs(metric.delta) % 1 !== 0 ? Math.abs(metric.delta).toFixed(1) : Math.abs(metric.delta))
            : '–'} vs prior wk
        </span>
      )}
    </div>
  );
}

export function HeroMetrics({ heroes }: { heroes: ShopHealthHeroes }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <HeroCard label="Leads" metric={null} deferred icon="📊" />
      <HeroCard label="Backlog" metric={heroes.backlogWeeks} icon="📋" />
      <HeroCard label="Ready to Build" metric={heroes.readyToBuild} icon="🔧" />
      <HeroCard label="Scheduled" metric={heroes.scheduledInstalls} icon="📅" />
      <HeroCard label="Installs" metric={heroes.installsCompleted} icon="⚡" />
      <HeroCard label="PTOs" metric={heroes.ptosReceived} icon="✅" />
    </div>
  );
}
