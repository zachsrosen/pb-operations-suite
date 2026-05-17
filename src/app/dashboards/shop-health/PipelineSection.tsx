'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import type { PipelineSection as PipelineSectionData } from '@/lib/shop-health-types';

function formatDollars(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

export function PipelineSectionContent({ data }: { data: PipelineSectionData }) {
  return (
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
  );
}
