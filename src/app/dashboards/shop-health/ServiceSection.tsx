'use client';

import { DrilldownMetricCard } from '@/components/ui/DrilldownMetricCard';
import type { ServiceSection as ServiceSectionData, ShopHealthDrilldown } from '@/lib/shop-health-types';

export function ServiceSectionContent({
  data,
  drilldown,
}: {
  data: ServiceSectionData;
  drilldown: ShopHealthDrilldown;
}) {
  const netChangeColor =
    data.netTicketChange > 0
      ? 'text-red-400'
      : data.netTicketChange < 0
        ? 'text-emerald-400'
        : 'text-muted';
  const openTicketsColor =
    data.openTickets <= 3
      ? 'text-emerald-400'
      : data.openTickets <= 10
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <div className="space-y-6">
      {/* Row 1: Service Job Pipeline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DrilldownMetricCard
          label="Active Service Jobs"
          value={data.activeJobs}
          sub="non-terminal deals"
          deals={drilldown.serviceActiveJobs}
          dateLabel=""
        />
        <DrilldownMetricCard
          label="Awaiting Site Visit"
          value={data.awaitingSiteVisit}
          sub="Site Visit Scheduling"
          deals={drilldown.serviceAwaitingSiteVisit}
          dateLabel=""
        />
        <DrilldownMetricCard
          label="Work In Progress"
          value={data.workInProgress}
          sub="active service work"
          deals={drilldown.serviceWorkInProgress}
          dateLabel=""
        />
        <DrilldownMetricCard
          label="Awaiting Inspection"
          value={data.awaitingInspection}
          sub="ready for inspection"
          deals={drilldown.serviceAwaitingInspection}
          dateLabel=""
        />
      </div>

      {/* Row 2: Ticket Activity */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DrilldownMetricCard
          label="Open Tickets"
          value={data.openTickets}
          valueColor={openTicketsColor}
          sub="currently unresolved"
          tickets={drilldown.serviceOpenTickets}
        />
        <DrilldownMetricCard
          label="Tickets Created This Wk"
          value={data.ticketsCreatedThisWeek}
          sub="fresh tickets"
          tickets={drilldown.serviceTicketsCreated}
        />
        <DrilldownMetricCard
          label="Tickets Closed This Wk"
          value={data.ticketsClosedThisWeek}
          sub="resolved this week"
          tickets={drilldown.serviceTicketsClosed}
        />
        <DrilldownMetricCard
          label="Net Change"
          value={data.netTicketChange > 0 ? `+${data.netTicketChange}` : data.netTicketChange}
          valueColor={netChangeColor}
          sub="created − closed"
        />
      </div>

      {/* Row 3: Ticket Response Health */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <DrilldownMetricCard
          label="Avg Ticket Age"
          value={data.avgTicketAgeDays !== null ? `${data.avgTicketAgeDays}d` : '—'}
          sub="days since createdate · open tickets"
        />
        <DrilldownMetricCard
          label="Avg Resolution Time"
          value={data.avgResolutionHours !== null ? `${data.avgResolutionHours}h` : '—'}
          sub="hours to close · tickets closed this wk"
        />
        <DrilldownMetricCard
          label="Stuck >7d"
          value={data.stuckTicketsOver7d}
          valueColor={data.stuckTicketsOver7d === 0 ? 'text-emerald-400' : 'text-red-400'}
          sub="open tickets older than 7 days"
          tickets={drilldown.serviceStuckTickets}
        />
      </div>
    </div>
  );
}
