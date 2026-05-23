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
        label="Awaiting Inspection"
        value={data.jobsAwaitingInspection}
        sub="install complete, not yet passed"
        deals={drilldown.awaitingInspection}
        dateLabel="Install Date"
      />
      <DrilldownMetricCard
        label="Inspections Passed"
        value={data.inspectionsPassed}
        sub="passed this week"
        deals={drilldown.inspectionsPassed}
        dateLabel="Passed"
      />
      <MetricCard
        label="Avg Install → Inspection"
        value={data.avgDaysInstallToInspection !== null ? `${data.avgDaysInstallToInspection}d` : '—'}
        sub="days from CC to pass"
      />
      <DrilldownMetricCard
        label="PTOs Received"
        value={data.ptosReceived}
        sub="granted this week"
        deals={drilldown.ptosReceived}
        dateLabel="PTO Date"
      />
    </div>
  );
}
