'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import type { SchedulingSection as SchedulingSectionData } from '@/lib/shop-health-types';

export function SchedulingSectionContent({ data }: { data: SchedulingSectionData }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard
        label="Scheduled Next 2 Weeks"
        value={data.scheduledNext2Weeks}
      />
      <MetricCard
        label="Scheduled Next 4 Weeks"
        value={data.scheduledNext4Weeks}
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
