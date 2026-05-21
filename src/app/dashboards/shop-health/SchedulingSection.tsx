'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import { DrilldownMetricCard } from '@/components/ui/DrilldownMetricCard';
import type {
  SchedulingSection as SchedulingSectionData,
  ShopHealthDrilldown,
} from '@/lib/shop-health-types';

export function SchedulingSectionContent({
  data,
  drilldown,
}: {
  data: SchedulingSectionData;
  drilldown: ShopHealthDrilldown;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <DrilldownMetricCard
        label="Scheduled Next 2 Weeks"
        value={data.scheduledNext2Weeks}
        deals={drilldown.scheduledNext2Weeks}
        dateLabel="Install Date"
      />
      <DrilldownMetricCard
        label="Scheduled Next 4 Weeks"
        value={data.scheduledNext4Weeks}
        deals={drilldown.scheduledNext4Weeks}
        dateLabel="Install Date"
      />
      <MetricCard
        label="Schedule Accuracy"
        value={data.scheduleAccuracy !== null ? `${data.scheduleAccuracy}%` : '—'}
      />
      <MetricCard
        label="Crew Capacity Filled %"
        value={`${data.crewCapacityFilledPct}%`}
        valueColor={
          data.crewCapacityFilledPct >= 100
            ? 'text-emerald-500'
            : data.crewCapacityFilledPct >= 75
              ? 'text-yellow-500'
              : 'text-red-400'
        }
      />
    </div>
  );
}
