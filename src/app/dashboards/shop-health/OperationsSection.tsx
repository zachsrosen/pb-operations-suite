'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import type { OperationsSection as OperationsSectionData } from '@/lib/shop-health-types';

export function OperationsSectionContent({ data }: { data: OperationsSectionData }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard
        label="Installs Completed"
        value={data.installsCompleted}
      />
      <MetricCard
        label="Planned vs Actual"
        value={`${data.installsPlanned} / ${data.installsActual}`}
        valueColor={
          data.installsActual >= data.installsPlanned
            ? 'text-emerald-500'
            : 'text-red-400'
        }
      />
      <MetricCard
        label="Crew Utilization %"
        value={`${data.crewUtilizationPct}%`}
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
