'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import { DrilldownMetricCard } from '@/components/ui/DrilldownMetricCard';
import type { PreconstructionSection, ShopHealthDrilldown } from '@/lib/shop-health-types';

function formatDays(value: number | null): string {
  if (value === null) return '—';
  return `${value}d`;
}

function daysColor(value: number | null, warnAt: number, badAt: number): string | undefined {
  if (value === null) return undefined;
  if (value <= warnAt) return 'text-emerald-400';
  if (value <= badAt) return 'text-amber-400';
  return 'text-red-400';
}

export function PreconSectionContent({
  data,
  drilldown,
}: {
  data: PreconstructionSection;
  drilldown: ShopHealthDrilldown;
}) {
  return (
    <div className="space-y-6">
      {/* Row 1: Pipeline Snapshot */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">Pipeline Snapshot</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <DrilldownMetricCard
            label="Jobs in Design"
            value={data.jobsInDesign}
            deals={drilldown.inDesign}
            dateLabel="Design Start"
          />
          <DrilldownMetricCard
            label="In Permitting"
            value={data.jobsSubmittedForPermit}
            deals={drilldown.inPermitting}
            dateLabel="Submitted"
          />
          <DrilldownMetricCard
            label="Ready to Build"
            value={data.totalReadyJobs}
            deals={drilldown.readyToBuild}
            dateLabel="RTB Date"
          />
          <DrilldownMetricCard
            label="Aging >2 Weeks"
            value={data.jobsAgingOver2Weeks}
            valueColor={data.jobsAgingOver2Weeks > 0 ? 'text-red-400' : undefined}
            deals={drilldown.agingOver2Weeks}
          />
        </div>
      </div>

      {/* Row 2: Weekly Throughput */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">Weekly Throughput</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <DrilldownMetricCard
            label="Surveys Completed"
            value={data.surveysCompletedThisWeek}
            deals={drilldown.surveysCompleted}
            dateLabel="Completed"
          />
          <DrilldownMetricCard
            label="DAs Approved"
            value={data.dasApprovedThisWeek}
            deals={drilldown.dasApproved}
            dateLabel="Approved"
          />
          <DrilldownMetricCard
            label="Permits Issued"
            value={data.permitsIssuedThisWeek}
            deals={drilldown.permitsIssued}
            dateLabel="Issued"
          />
          <DrilldownMetricCard
            label="IC Approved"
            value={data.icApprovedThisWeek}
            deals={drilldown.icApproved}
            dateLabel="Approved"
          />
        </div>
      </div>

      {/* Row 3: Cycle Times */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">Cycle Times</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricCard
            label="Avg Sale → Permit"
            value={formatDays(data.avgDaysSaleToPermit)}
            valueColor={daysColor(data.avgDaysSaleToPermit, 30, 60)}
          />
          <MetricCard
            label="Avg Design Turnaround"
            value={formatDays(data.avgDesignTurnaroundDays)}
            valueColor={daysColor(data.avgDesignTurnaroundDays, 7, 14)}
          />
          <MetricCard
            label="Avg Permit Turnaround"
            value={formatDays(data.avgPermitTurnaroundDays)}
            valueColor={daysColor(data.avgPermitTurnaroundDays, 14, 30)}
          />
        </div>
      </div>
    </div>
  );
}
