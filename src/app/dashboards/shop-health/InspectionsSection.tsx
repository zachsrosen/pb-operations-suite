'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import { DrilldownMetricCard } from '@/components/ui/DrilldownMetricCard';
import type {
  InspectionsSection as InspectionsSectionData,
  ShopHealthDrilldown,
} from '@/lib/shop-health-types';

export function InspectionsSectionContent({
  data,
  drilldown,
}: {
  data: InspectionsSectionData;
  drilldown: ShopHealthDrilldown;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <DrilldownMetricCard
        label="Jobs Awaiting Inspection"
        value={data.jobsAwaitingInspection}
        deals={drilldown.awaitingInspection}
        dateLabel="Install Date"
      />
      <DrilldownMetricCard
        label="Inspections Passed"
        value={data.inspectionsPassed}
        deals={drilldown.inspectionsPassed}
        dateLabel="Passed"
      />
      <MetricCard
        label="Avg Days Install to Inspection"
        value={data.avgDaysInstallToInspection ?? '—'}
      />
      <DrilldownMetricCard
        label="PTOs Received"
        value={data.ptosReceived}
        deals={drilldown.ptosReceived}
        dateLabel="PTO Date"
      />
    </div>
  );
}
