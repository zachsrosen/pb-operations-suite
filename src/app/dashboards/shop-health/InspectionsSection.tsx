'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import type { InspectionsSection as InspectionsSectionData } from '@/lib/shop-health-types';

export function InspectionsSectionContent({ data }: { data: InspectionsSectionData }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard
        label="Jobs Awaiting Inspection"
        value={data.jobsAwaitingInspection}
      />
      <MetricCard
        label="Inspections Passed"
        value={data.inspectionsPassed}
      />
      <MetricCard
        label="Avg Days Install to Inspection"
        value={data.avgDaysInstallToInspection ?? '—'}
      />
      <MetricCard
        label="PTOs Received"
        value={data.ptosReceived}
      />
    </div>
  );
}
