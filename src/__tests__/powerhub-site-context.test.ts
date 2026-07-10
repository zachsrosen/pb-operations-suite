jest.mock("@/lib/hubspot", () => ({
  batchReadDealsWithRetry: jest.fn(),
  hubspotClient: {
    crm: {
      tickets: { batchApi: { read: jest.fn() } },
      contacts: { batchApi: { read: jest.fn() } },
    },
  },
  DEAL_STAGE_MAP: {
    "22580871": "Ready To Build",
    "20440342": "Construction",
  },
}));
jest.mock("@/lib/hubspot-tickets", () => ({
  getTicketStageMap: jest.fn(),
}));
jest.mock("@/lib/cache", () => ({
  appCache: {
    get: jest.fn(() => ({ data: null, stale: false, hit: false, age: 0 })),
    set: jest.fn(),
    invalidate: jest.fn(),
  },
}));

import {
  resolveDealSummaries,
  resolveTicketSummaries,
  resolveContactNames,
} from "@/lib/powerhub-site-context";
import { batchReadDealsWithRetry, hubspotClient } from "@/lib/hubspot";
import { getTicketStageMap } from "@/lib/hubspot-tickets";

const mockDeals = batchReadDealsWithRetry as jest.Mock;
const mockTicketsRead = hubspotClient.crm.tickets.batchApi.read as jest.Mock;
const mockContactsRead = hubspotClient.crm.contacts.batchApi.read as jest.Mock;
const mockStageMap = getTicketStageMap as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("resolveDealSummaries", () => {
  it("resolves deal names and maps stage IDs to labels", async () => {
    mockDeals.mockResolvedValue({
      results: [
        {
          id: "123",
          properties: { dealname: "Smith, Jane - PROJ-1234", dealstage: "22580871" },
        },
      ],
    });

    const map = await resolveDealSummaries(["123"]);
    expect(map.get("123")).toEqual({
      dealName: "Smith, Jane - PROJ-1234",
      stageLabel: "Ready To Build",
    });
  });

  it("falls back to the raw stage ID for unknown stages", async () => {
    mockDeals.mockResolvedValue({
      results: [{ id: "1", properties: { dealname: "X", dealstage: "999" } }],
    });
    const map = await resolveDealSummaries(["1"]);
    expect(map.get("1")?.stageLabel).toBe("999");
  });

  it("returns an empty map when HubSpot fails or ids are empty", async () => {
    expect((await resolveDealSummaries([])).size).toBe(0);
    mockDeals.mockRejectedValue(new Error("boom"));
    expect((await resolveDealSummaries(["1"])).size).toBe(0);
  });
});

describe("resolveTicketSummaries", () => {
  it("resolves subjects and stage labels", async () => {
    mockStageMap.mockResolvedValue({ map: { s1: "New" } });
    mockTicketsRead.mockResolvedValue({
      results: [
        { id: "555", properties: { subject: "Inverter offline", hs_pipeline_stage: "s1" } },
      ],
    });

    const map = await resolveTicketSummaries(["555"]);
    expect(map.get("555")).toEqual({ subject: "Inverter offline", statusName: "New" });
  });

  it("falls back to 'Ticket {id}' when subject is blank and empty map on failure", async () => {
    mockStageMap.mockResolvedValue({ map: {} });
    mockTicketsRead.mockResolvedValue({
      results: [{ id: "9", properties: { subject: "", hs_pipeline_stage: "zz" } }],
    });
    const map = await resolveTicketSummaries(["9"]);
    expect(map.get("9")?.subject).toBe("Ticket 9");

    mockTicketsRead.mockRejectedValue(new Error("boom"));
    expect((await resolveTicketSummaries(["9"])).size).toBe(0);
  });
});

describe("resolveContactNames", () => {
  it("resolves first/last names with email fallback", async () => {
    mockContactsRead.mockResolvedValue({
      results: [
        { id: "c1", properties: { firstname: "Jane", lastname: "Smith", email: "j@x.com" } },
        { id: "c2", properties: { firstname: "", lastname: "", email: "only@email.com" } },
      ],
    });

    const map = await resolveContactNames(["c1", "c2"]);
    expect(map.get("c1")).toBe("Jane Smith");
    expect(map.get("c2")).toBe("only@email.com");
  });

  it("returns an empty map on failure", async () => {
    mockContactsRead.mockRejectedValue(new Error("boom"));
    expect((await resolveContactNames(["c1"])).size).toBe(0);
  });
});
