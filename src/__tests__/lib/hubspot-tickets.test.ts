import { transformTicketToPriorityItem, parseStageEnteredDate, type HubSpotTicket } from "@/lib/hubspot-tickets";

describe("parseStageEnteredDate", () => {
  it("parses HubSpot epoch-milliseconds to ISO", () => {
    // 1675401577399 = 2023-02-03
    expect(parseStageEnteredDate("1675401577399")).toBe(new Date(1675401577399).toISOString());
  });
  it("tolerates an ISO string", () => {
    expect(parseStageEnteredDate("2025-08-08T00:00:00Z")).toBe("2025-08-08T00:00:00.000Z");
  });
  it("returns null for empty/invalid", () => {
    expect(parseStageEnteredDate(undefined)).toBeNull();
    expect(parseStageEnteredDate("")).toBeNull();
    expect(parseStageEnteredDate("not-a-date")).toBeNull();
  });
});

describe("transformTicketToPriorityItem stageEnteredDate", () => {
  it("reads hs_date_entered_<currentStageId> for the current stage", () => {
    const ticket: HubSpotTicket = {
      id: "t1",
      properties: {
        hs_object_id: "t1",
        subject: "Stuck ticket",
        hs_pipeline_stage: "32235449",
        hs_lastmodifieddate: "2026-07-04T00:00:00Z",
        createdate: "2025-01-01T00:00:00Z",
        hs_date_entered_32235449: "1754611200000", // 2025-08-08
      },
    };
    const result = transformTicketToPriorityItem(ticket, { "32235449": "Waiting on Equipment Delivery" });
    expect(result.stageEnteredDate).toBe(new Date(1754611200000).toISOString());
  });
});

describe("transformTicketToPriorityItem", () => {
  it("transforms a HubSpot ticket to a PriorityItem", () => {
    const ticket: HubSpotTicket = {
      id: "12345",
      properties: {
        hs_object_id: "12345",
        subject: "AC not working after install",
        content: "Customer reports AC issue",
        hs_pipeline: "0",
        hs_pipeline_stage: "1",
        hs_ticket_priority: "HIGH",
        createdate: "2026-03-10T12:00:00Z",
        hs_lastmodifieddate: "2026-03-14T12:00:00Z",
        notes_last_contacted: "2026-03-13T12:00:00Z",
        hubspot_owner_id: "123",
      },
    };

    const stageMap: Record<string, string> = {
      "1": "New",
      "2": "In Progress",
      "3": "Closed",
    };

    const result = transformTicketToPriorityItem(ticket, stageMap);

    expect(result).toEqual({
      id: "12345",
      type: "ticket",
      title: "AC not working after install",
      stage: "New",
      lastModified: "2026-03-14T12:00:00Z",
      stageEnteredDate: null,
      lastContactDate: "2026-03-13T12:00:00Z",
      createDate: "2026-03-10T12:00:00Z",
      amount: null,
      location: null,
      url: expect.stringContaining("/ticket/12345"),
      priority: "HIGH",
      ownerId: "123",
      serviceType: null,
    });
  });

  it("falls back to stage ID when stage name not found in map", () => {
    const ticket: HubSpotTicket = {
      id: "99",
      properties: {
        hs_object_id: "99",
        subject: "Test",
        content: "",
        hs_pipeline: "0",
        hs_pipeline_stage: "unknown-stage",
        hs_ticket_priority: "LOW",
        createdate: "2026-03-10T12:00:00Z",
        hs_lastmodifieddate: "2026-03-10T12:00:00Z",
      },
    };

    const result = transformTicketToPriorityItem(ticket, {});
    expect(result.stage).toBe("unknown-stage");
  });

  it("derives location from associated deal pb_location", () => {
    const ticket: HubSpotTicket = {
      id: "55",
      properties: {
        hs_object_id: "55",
        subject: "Follow up",
        content: "",
        hs_pipeline: "0",
        hs_pipeline_stage: "1",
        hs_ticket_priority: "MEDIUM",
        createdate: "2026-03-10T12:00:00Z",
        hs_lastmodifieddate: "2026-03-10T12:00:00Z",
      },
      _derivedLocation: "Denver",
    };

    const result = transformTicketToPriorityItem(ticket, { "1": "Open" });
    expect(result.location).toBe("Denver");
  });
});
