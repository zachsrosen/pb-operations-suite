'use client';

import { DrilldownMetricCard } from '@/components/ui/DrilldownMetricCard';
import type { DnrRoofingSection as DnrRoofingData, ShopHealthDrilldown } from '@/lib/shop-health-types';

export function DnrRoofingSectionContent({
  data,
  drilldown,
}: {
  data: DnrRoofingData;
  drilldown: ShopHealthDrilldown;
}) {
  return (
    <div className="space-y-6">
      {/* Row 1: Throughput summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DrilldownMetricCard
          label="D&R Active"
          value={data.dnrActive}
          sub="active jobs across all D&R stages"
          deals={drilldown.dnrActive}
          dateLabel=""
        />
        <DrilldownMetricCard
          label="D&R Completed This Wk"
          value={data.dnrCompletedThisWeek}
          sub="moved to Complete this week"
          deals={drilldown.dnrCompleted}
          dateLabel="Close"
        />
        <DrilldownMetricCard
          label="Roof Active"
          value={data.roofingActive}
          sub="active roofing jobs"
          deals={drilldown.roofingActive}
          dateLabel=""
        />
        <DrilldownMetricCard
          label="Roof Completed This Wk"
          value={data.roofingCompletedThisWeek}
          sub="moved to Job Completed this week"
          deals={drilldown.roofingCompleted}
          dateLabel="Close"
        />
      </div>

      {/* Row 2: D&R Stage Breakdown */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">
          D&amp;R workflow <span className="font-normal opacity-70">· active jobs by stage</span>
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <DrilldownMetricCard
            label="Pre-Detach"
            value={data.dnrPreDetach}
            sub="Kickoff / Survey / Design / Permit / Ready"
            deals={drilldown.dnrPreDetach}
            dateLabel=""
          />
          <DrilldownMetricCard
            label="Detach In Progress"
            value={data.dnrDetachInProgress}
            sub="active detach"
            deals={drilldown.dnrDetachInProgress}
            dateLabel=""
          />
          <DrilldownMetricCard
            label="Roofing Phase"
            value={data.dnrRoofingPhase}
            sub="detach complete, roofing in progress"
            deals={drilldown.dnrRoofingPhase}
            dateLabel=""
          />
          <DrilldownMetricCard
            label="Reset Blocked"
            value={data.dnrResetBlocked}
            valueColor={data.dnrResetBlocked > 0 ? 'text-red-400' : 'text-emerald-400'}
            sub="waiting on payment"
            deals={drilldown.dnrResetBlocked}
            dateLabel=""
          />
          <DrilldownMetricCard
            label="Reset Phase"
            value={data.dnrResetPhase}
            sub="Ready for Reset + Reset"
            deals={drilldown.dnrResetPhase}
            dateLabel=""
          />
          <DrilldownMetricCard
            label="Closeout"
            value={data.dnrCloseout}
            sub="Inspection + Closeout"
            deals={drilldown.dnrCloseout}
            dateLabel=""
          />
        </div>
      </div>

      {/* Row 3: Roofing Stage Breakdown */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">
          Roofing workflow <span className="font-normal opacity-70">· active jobs by stage</span>
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <DrilldownMetricCard
            label="Pre-Production"
            value={data.roofPreProduction}
            sub="On Hold / Color / Material / Confirm / Staged"
            deals={drilldown.roofingPreProduction}
            dateLabel=""
          />
          <DrilldownMetricCard
            label="In Production"
            value={data.roofInProduction}
            sub="active install"
            deals={drilldown.roofingInProduction}
            dateLabel=""
          />
          <DrilldownMetricCard
            label="Post-Production"
            value={data.roofPostProduction}
            sub="Post / Invoice / Closeout Paperwork"
            deals={drilldown.roofingPostProduction}
            dateLabel=""
          />
        </div>
      </div>

      {/* Row 4: Aging */}
      <div className="grid grid-cols-2 gap-4">
        <DrilldownMetricCard
          label="Stuck D&R Jobs"
          value={data.stuckDnrJobs}
          valueColor={data.stuckDnrJobs === 0 ? 'text-emerald-400' : 'text-amber-400'}
          sub=">14 days in current stage"
          deals={drilldown.dnrStuck}
          dateLabel=""
        />
        <DrilldownMetricCard
          label="Stuck Roofing Jobs"
          value={data.stuckRoofingJobs}
          valueColor={data.stuckRoofingJobs === 0 ? 'text-emerald-400' : 'text-amber-400'}
          sub=">14 days in current stage"
          deals={drilldown.roofingStuck}
          dateLabel=""
        />
      </div>
    </div>
  );
}
