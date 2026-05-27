/**
 * Service section computation for the Weekly Shop Health dashboard.
 *
 * Pure function over deals + tickets + goals passed in by the orchestrator.
 * No DB or HubSpot API calls.
 */

import type { Project } from "@/lib/hubspot";
import type { EnrichedTicketItem, ClosedTicketItem } from "@/lib/hubspot-tickets";
import type { ServiceSection, DrilldownDeal, DrilldownTicket } from "@/lib/shop-health-types";

// Service-pipeline stage IDs (from STAGE_MAPS.service in deals-pipeline.ts)
const STAGE_SITE_VISIT = "1058924076";
const STAGE_WORK_IN_PROGRESS = "171758480";
const STAGE_INSPECTION = "1058924077";
const TERMINAL_SERVICE_STAGES = new Set(["76979603", "56217769"]); // Completed, Cancelled

export interface ServiceDrilldownBundle {
  activeJobs: DrilldownDeal[];
  awaitingSiteVisit: DrilldownDeal[];
  workInProgress: DrilldownDeal[];
  awaitingInspection: DrilldownDeal[];
  openTickets: DrilldownTicket[];
  ticketsCreated: DrilldownTicket[];
  ticketsClosed: DrilldownTicket[];
  stuckTickets: DrilldownTicket[];
}

function toDealDrilldown(d: Project): DrilldownDeal {
  return {
    id: String(d.id),
    name: d.name,
    projectNumber: d.projectNumber,
    amount: d.amount,
    stage: d.stage,
    pm: "",
    date: null,
  };
}

// EnrichedTicketItem extends PriorityItem — fields: id, title, stage, createDate, lastModified.
// Map title → subject and stage → status for the DrilldownTicket display contract.
function toOpenTicketDrilldown(t: EnrichedTicketItem): DrilldownTicket {
  const createDate = t.createDate ?? null;
  const ageDays = createDate
    ? Math.floor((Date.now() - new Date(createDate).getTime()) / 86_400_000)
    : null;
  return {
    id: t.id,
    subject: t.title ?? "",
    status: t.stage ?? "",
    priority: null,
    createDate,
    lastModified: t.lastModified ?? null,
    ageDays,
    dealName: null,
  };
}

function toClosedTicketDrilldown(t: ClosedTicketItem): DrilldownTicket {
  const ageDays = Math.floor(t.resolutionHours / 24);
  return {
    id: t.id,
    subject: t.subject || "",
    status: t.stageName || "Closed",
    priority: null,
    createDate: t.createDate,
    lastModified: t.closedDate,
    ageDays,
    dealName: null,
  };
}

export function computeServiceHealth(
  serviceDeals: Project[],
  openTickets: EnrichedTicketItem[],
  closedTickets: ClosedTicketItem[],
  weekStart: Date
): { section: ServiceSection; drilldown: ServiceDrilldownBundle } {
  const weekStartMs = weekStart.getTime();

  // ── Deals ──
  const activeDeals = serviceDeals.filter((d) => !TERMINAL_SERVICE_STAGES.has(d.stageId));
  const siteVisitDeals = activeDeals.filter((d) => d.stageId === STAGE_SITE_VISIT);
  const wipDeals = activeDeals.filter((d) => d.stageId === STAGE_WORK_IN_PROGRESS);
  const inspectionDeals = activeDeals.filter((d) => d.stageId === STAGE_INSPECTION);

  // ── Tickets ── EnrichedTicketItem fields: id, title, stage, createDate, lastModified
  const openCount = openTickets.length;
  const ticketsCreatedThisWeekArr = openTickets.filter(
    (t) => t.createDate && new Date(t.createDate).getTime() >= weekStartMs
  );
  const ticketsClosedThisWeekArr = closedTickets.filter(
    (t) => new Date(t.closedDate).getTime() >= weekStartMs
  );

  // ── Ages ──
  const ages: number[] = [];
  const stuckTickets: EnrichedTicketItem[] = [];
  for (const t of openTickets) {
    if (!t.createDate) continue;
    const ageDays = (Date.now() - new Date(t.createDate).getTime()) / 86_400_000;
    ages.push(ageDays);
    if (ageDays > 7) stuckTickets.push(t);
  }
  const avgTicketAgeDays = ages.length > 0
    ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10
    : null;

  // ── Resolution ──
  const avgResolutionHours = ticketsClosedThisWeekArr.length > 0
    ? Math.round(
        (ticketsClosedThisWeekArr.reduce((a, t) => a + t.resolutionHours, 0) /
          ticketsClosedThisWeekArr.length) * 10
      ) / 10
    : null;

  const section: ServiceSection = {
    activeJobs: activeDeals.length,
    awaitingSiteVisit: siteVisitDeals.length,
    workInProgress: wipDeals.length,
    awaitingInspection: inspectionDeals.length,
    openTickets: openCount,
    ticketsCreatedThisWeek: ticketsCreatedThisWeekArr.length,
    ticketsClosedThisWeek: ticketsClosedThisWeekArr.length,
    netTicketChange: ticketsCreatedThisWeekArr.length - ticketsClosedThisWeekArr.length,
    avgTicketAgeDays,
    avgResolutionHours,
    stuckTicketsOver7d: stuckTickets.length,
  };

  const drilldown: ServiceDrilldownBundle = {
    activeJobs: activeDeals.map(toDealDrilldown),
    awaitingSiteVisit: siteVisitDeals.map(toDealDrilldown),
    workInProgress: wipDeals.map(toDealDrilldown),
    awaitingInspection: inspectionDeals.map(toDealDrilldown),
    openTickets: openTickets.map(toOpenTicketDrilldown),
    ticketsCreated: ticketsCreatedThisWeekArr.map(toOpenTicketDrilldown),
    ticketsClosed: ticketsClosedThisWeekArr.map(toClosedTicketDrilldown),
    stuckTickets: stuckTickets.map(toOpenTicketDrilldown),
  };

  return { section, drilldown };
}
