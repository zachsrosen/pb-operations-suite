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
        label="Scheduled Next 2 Wks"
        value={data.scheduledNext2Weeks}
        sub="install dates within 14 days"
        deals={drilldown.scheduledNext2Weeks}
        dateLabel="Install Date"
      />
      <DrilldownMetricCard
        label="Scheduled Next 4 Wks"
        value={data.scheduledNext4Weeks}
        sub="install dates within 28 days"
        deals={drilldown.scheduledNext4Weeks}
        dateLabel="Install Date"
      />
      <MetricCard
        label="Schedule Accuracy"
        value={data.scheduleAccuracy !== null ? `${data.scheduleAccuracy}%` : '—'}
        sub="planned vs actual"
      />
      <MetricCard
        label="Crew Capacity Filled"
        value={`${data.crewCapacityFilledPct}%`}
        sub="2-wk scheduled / capacity"
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
