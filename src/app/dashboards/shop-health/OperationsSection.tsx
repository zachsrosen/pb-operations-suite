'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import { DrilldownMetricCard } from '@/components/ui/DrilldownMetricCard';
import type {
  OperationsSection as OperationsSectionData,
  ShopHealthDrilldown,
} from '@/lib/shop-health-types';

export function OperationsSectionContent({
  data,
  drilldown,
}: {
  data: OperationsSectionData;
  drilldown: ShopHealthDrilldown;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <DrilldownMetricCard
        label="Installs Completed"
        value={data.installsCompleted}
        sub="construction complete this wk"
        deals={drilldown.installsCompleted}
        dateLabel="Completed"
      />
      <DrilldownMetricCard
        label="Installs Planned"
        value={data.installsPlanned}
        sub="scheduled for this week"
        deals={drilldown.installsPlanned}
        dateLabel="Scheduled"
      />
      <MetricCard
        label="Crew Utilization"
        value={`${data.crewUtilizationPct}%`}
        sub="completed / weekly target"
        valueColor={
          data.crewUtilizationPct >= 100
            ? 'text-emerald-500'
            : data.crewUtilizationPct >= 80
              ? 'text-yellow-500'
              : 'text-red-400'
        }
      />
      <MetricCard
        label="Cost per Install"
        value="—"
        sub="Coming soon"
        subColor="text-muted"
      />
    </div>
  );
}
