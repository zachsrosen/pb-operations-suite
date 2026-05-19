'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import type { PreconstructionSection } from '@/lib/shop-health-types';

export function PreconSectionContent({ data }: { data: PreconstructionSection }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <MetricCard label="Jobs in Design" value={data.jobsInDesign} />
      <MetricCard label="Submitted for Permit" value={data.jobsSubmittedForPermit} />
      <MetricCard label="Permits Approved" value={data.permitsApprovedThisWeek} />
      <MetricCard
        label="Avg Days Sale to Permit"
        value={data.avgDaysSaleToPermit ?? '—'}
      />
      <MetricCard label="Ready Jobs" value={data.totalReadyJobs} />
      <MetricCard
        label="Aging >2 Weeks"
        value={data.jobsAgingOver2Weeks}
        valueColor={data.jobsAgingOver2Weeks > 0 ? 'text-red-400' : undefined}
      />
    </div>
  );
}
