'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import type { PipelineSection as PipelineSectionData, ShopHealthGoals } from '@/lib/shop-health-types';

function formatDollars(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    // Use 2 decimals when the tenths place would round misleadingly (e.g. 1.25M not 1.3M)
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(2).replace(/0$/, '')}M`;
  }
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}

export function PipelineSectionContent({
  data,
  goals,
}: {
  data: PipelineSectionData;
  goals: ShopHealthGoals;
}) {
  return (
    <div className="space-y-4">
      {/* Revenue row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Monthly Revenue Target"
          value={formatDollars(goals.monthlyRevenueTarget)}
          sub={`${formatDollars(goals.weeklyRevenueTarget)}/wk`}
        />
        <MetricCard
          label="Avg Deal Size"
          value={formatDollars(goals.avgDealSize)}
          sub="Active pipeline avg"
        />
        <MetricCard
          label="Monthly Install Target"
          value={goals.monthlyInstalls}
          sub={`${goals.weeklyInstalls}/wk to hit revenue`}
        />
        <MetricCard
          label="Monthly Inspection Target"
          value={goals.monthlyInspections}
          sub={`${goals.weeklyInspections}/wk`}
        />
      </div>
      {/* Pipeline metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard
          label="Contracts Signed"
          value={data.contractsSigned}
          sub={formatDollars(data.contractsSignedValue)}
        />
        <MetricCard
          label="Backlog Jobs"
          value={data.totalBacklogCount}
          sub={formatDollars(data.totalBacklogValue)}
        />
        <MetricCard
          label="Backlog Weeks"
          value={data.backlogInWeeks % 1 !== 0 ? data.backlogInWeeks.toFixed(1) : data.backlogInWeeks}
          sub="Target: 4-8 weeks"
        />
        <MetricCard
          label="Cancellations"
          value={data.cancellationCount}
          sub={`${data.cancellationRate.toFixed(1)}% rate`}
        />
        <MetricCard
          label="Avg Margin at Sale"
          value="—"
          sub="Coming soon"
          subColor="text-muted"
        />
      </div>
    </div>
  );
}
