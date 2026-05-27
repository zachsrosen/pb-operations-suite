import { computeServiceHealth } from "@/lib/shop-health-service";
import type { Project } from "@/lib/hubspot";
import type { EnrichedTicketItem } from "@/lib/hubspot-tickets";

// Minimal Project factory — only fields the test exercises
function makeDeal(over: Partial<Project> & { id: number; stageId: string }): Project {
  const base = {
    name: "Test " + over.id,
    projectNumber: "P" + over.id,
    pbLocation: "Westminster",
    ahj: "",
    utility: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    projectType: "",
    stage: "",
    pipelineId: "23928924",
    amount: 1000,
    url: "",
  };
  return { ...base, ...over } as Project;
}

// Minimal EnrichedTicketItem factory
function makeTicket(over: { id: string; createDate: string; lastModified?: string }): EnrichedTicketItem {
  return {
    id: over.id,
    type: "ticket",
    title: `Ticket ${over.id}`,
    stage: "Open",
    createDate: over.createDate,
    lastModified: over.lastModified ?? over.createDate,
    lastContactDate: null,
    location: "Westminster",
  } as EnrichedTicketItem;
}

describe("computeServiceHealth", () => {
  const weekStart = new Date("2026-05-25T00:00:00Z");

  it("returns zero counts when no deals or tickets", () => {
    const { section } = computeServiceHealth([], [], [], weekStart);
    expect(section.activeJobs).toBe(0);
    expect(section.openTickets).toBe(0);
    expect(section.avgTicketAgeDays).toBeNull();
    expect(section.avgResolutionHours).toBeNull();
  });

  it("counts deals by stage", () => {
    const deals = [
      makeDeal({ id: 1, stageId: "1058924076" }), // Site Visit Scheduling
      makeDeal({ id: 2, stageId: "1058924076" }),
      makeDeal({ id: 3, stageId: "171758480" }),  // Work In Progress
      makeDeal({ id: 4, stageId: "1058924077" }), // Inspection (Service)
      makeDeal({ id: 5, stageId: "76979603" }),   // Completed — should NOT count as active
    ];
    const { section } = computeServiceHealth(deals, [], [], weekStart);
    expect(section.activeJobs).toBe(4);
    expect(section.awaitingSiteVisit).toBe(2);
    expect(section.workInProgress).toBe(1);
    expect(section.awaitingInspection).toBe(1);
  });

  it("counts open tickets and stuck >7d", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const tickets = [
      makeTicket({ id: "T1", createDate: tenDaysAgo }),
      makeTicket({ id: "T2", createDate: oneDayAgo }),
    ];
    const { section } = computeServiceHealth([], tickets, [], weekStart);
    expect(section.openTickets).toBe(2);
    expect(section.stuckTicketsOver7d).toBe(1);
    expect(section.avgTicketAgeDays).toBeGreaterThan(4);
  });

  it("computes ticketsCreatedThisWeek, ticketsClosedThisWeek, netTicketChange, avgResolutionHours", () => {
    const inWeek = new Date(weekStart.getTime() + 86_400_000).toISOString();
    const beforeWeek = new Date(weekStart.getTime() - 10 * 86_400_000).toISOString();
    const openTickets = [
      makeTicket({ id: "O1", createDate: inWeek }),
      makeTicket({ id: "O2", createDate: beforeWeek }),
    ];
    const closedTickets = [
      {
        id: "C1",
        subject: "z",
        createDate: beforeWeek,
        closedDate: inWeek,
        stageName: "Closed",
        _derivedLocation: "Westminster",
        resolutionHours: 240,
      },
    ];
    const { section } = computeServiceHealth([], openTickets, closedTickets, weekStart);
    expect(section.ticketsCreatedThisWeek).toBe(1);
    expect(section.ticketsClosedThisWeek).toBe(1);
    expect(section.netTicketChange).toBe(0);
    expect(section.avgResolutionHours).toBe(240);
  });
});
