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
      {/* Row 1: Pipeline Snapshot — current active jobs at each precon stage */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">Pipeline Snapshot <span className="font-normal opacity-70">· active jobs by stage</span></h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <DrilldownMetricCard
            label="In Design"
            value={data.jobsInDesign}
            sub="active in D&E stage"
            deals={drilldown.inDesign}
            dateLabel="Design Start"
          />
          <DrilldownMetricCard
            label="In Permitting"
            value={data.jobsSubmittedForPermit}
            sub="submitted, awaiting issue"
            deals={drilldown.inPermitting}
            dateLabel="Submitted"
          />
          <DrilldownMetricCard
            label="Ready to Build"
            value={data.totalReadyJobs}
            sub="cleared for scheduling"
            deals={drilldown.readyToBuild}
            dateLabel="RTB Date"
          />
          <DrilldownMetricCard
            label="Aging > 2 Weeks"
            value={data.jobsAgingOver2Weeks}
            sub="stuck in current stage"
            valueColor={data.jobsAgingOver2Weeks > 0 ? 'text-red-400' : undefined}
            deals={drilldown.agingOver2Weeks}
          />
        </div>
      </div>

      {/* Row 2: Weekly Throughput — milestones completed this week */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">Weekly Throughput <span className="font-normal opacity-70">· milestones hit this week</span></h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <DrilldownMetricCard
            label="Surveys Completed"
            value={data.surveysCompletedThisWeek}
            sub="this week"
            deals={drilldown.surveysCompleted}
            dateLabel="Completed"
          />
          <DrilldownMetricCard
            label="DAs Approved"
            value={data.dasApprovedThisWeek}
            sub="customer approved this wk"
            deals={drilldown.dasApproved}
            dateLabel="Approved"
          />
          <DrilldownMetricCard
            label="Permits Issued"
            value={data.permitsIssuedThisWeek}
            sub="issued by AHJ this wk"
            deals={drilldown.permitsIssued}
            dateLabel="Issued"
          />
          <DrilldownMetricCard
            label="ICs Approved"
            value={data.icApprovedThisWeek}
            sub="utility approved this wk"
            deals={drilldown.icApproved}
            dateLabel="Approved"
          />
        </div>
      </div>

      {/* Row 3: Cycle Times — rolling averages across recent completions */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">Cycle Times <span className="font-normal opacity-70">· avg days between milestones</span></h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricCard
            label="Avg Sale → Permit"
            value={formatDays(data.avgDaysSaleToPermit)}
            sub="close to permit issued"
            valueColor={daysColor(data.avgDaysSaleToPermit, 30, 60)}
          />
          <MetricCard
            label="Avg Design Turnaround"
            value={formatDays(data.avgDesignTurnaroundDays)}
            sub="design start to completion"
            valueColor={daysColor(data.avgDesignTurnaroundDays, 7, 14)}
          />
          <MetricCard
            label="Avg Permit Turnaround"
            value={formatDays(data.avgPermitTurnaroundDays)}
            sub="submitted to issued"
            valueColor={daysColor(data.avgPermitTurnaroundDays, 14, 30)}
          />
        </div>
      </div>
    </div>
  );
}
