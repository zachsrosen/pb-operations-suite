/**
 * Tests for PowerHub fleet-table ticket enrichment (lib/powerhub-tickets).
 */

import {
  isOpenStageLabel,
  classifyTickets,
  buildSiteTickets,
  getTicketSummaries,
  MAX_TICKETS_PER_SITE,
} from "@/lib/powerhub-tickets";

jest.mock("@/lib/hubspot", () => ({
  batchReadTicketsWithRetry: jest.fn(),
}));
jest.mock("@/lib/hubspot-tickets", () => ({
  getTicketStageMap: jest.fn(),
}));

import { batchReadTicketsWithRetry } from "@/lib/hubspot";
import { getTicketStageMap } from "@/lib/hubspot-tickets";

const mockBatchRead = batchReadTicketsWithRetry as jest.Mock;
const mockStageMap = getTicketStageMap as jest.Mock;

const STAGE_MAP = {
  "1": "New",
  "2": "Waiting on us",
  "3": "Closed",
  "4": "Resolved",
  "5": "Cancelled - no fix",
};

function ticket(id: string, stage: string, subject = `Subject ${id}`) {
  return { id, properties: { subject, hs_pipeline_stage: stage } };
}

describe("isOpenStageLabel", () => {
  it.each([
    ["New", true],
    ["Waiting on us", true],
    ["Closed", false],
    ["CLOSED - won't fix", false],
    ["Resolved", false],
    ["Cancelled", false],
  ])("%s → open=%s", (label, expected) => {
    expect(isOpenStageLabel(label)).toBe(expected);
  });
});

describe("classifyTickets", () => {
  it("classifies open and closed stages", () => {
    const out = classifyTickets(
      [ticket("10", "1"), ticket("11", "3")],
      STAGE_MAP
    );
    expect(out["10"]).toEqual({ subject: "Subject 10", isOpen: true });
    expect(out["11"]).toEqual({ subject: "Subject 11", isOpen: false });
  });

  it("excludes tickets whose stage is not in the service pipeline map", () => {
    const out = classifyTickets([ticket("12", "unknown-stage")], STAGE_MAP);
    expect(out["12"]).toBeUndefined();
  });

  it("handles missing subject", () => {
    const out = classifyTickets(
      [{ id: "13", properties: { hs_pipeline_stage: "1", subject: null } }],
      STAGE_MAP
    );
    expect(out["13"]).toEqual({ subject: "", isOpen: true });
  });
});

describe("buildSiteTickets", () => {
  const summaries = {
    a: { subject: "Open A", isOpen: true },
    b: { subject: "Closed B", isOpen: false },
    c: { subject: "Open C", isOpen: true },
  };

  it("keeps only open tickets, preserving association order", () => {
    expect(buildSiteTickets(["a", "b", "c"], summaries)).toEqual([
      { id: "a", subject: "Open A" },
      { id: "c", subject: "Open C" },
    ]);
  });

  it("skips tickets with no summary (unknown pipeline / fetch miss)", () => {
    expect(buildSiteTickets(["z", "a"], summaries)).toEqual([
      { id: "a", subject: "Open A" },
    ]);
  });

  it("caps at MAX_TICKETS_PER_SITE", () => {
    const many = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`t${i}`, { subject: `S${i}`, isOpen: true }])
    );
    const ids = Object.keys(many);
    expect(buildSiteTickets(ids, many)).toHaveLength(MAX_TICKETS_PER_SITE);
  });
});

describe("getTicketSummaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns {} for empty input without calling HubSpot", async () => {
    const out = await getTicketSummaries([]);
    expect(out).toEqual({});
    expect(mockBatchRead).not.toHaveBeenCalled();
  });

  it("fetches, classifies, and dedupes ids", async () => {
    mockStageMap.mockResolvedValue({ map: STAGE_MAP, orderedStageIds: [] });
    mockBatchRead.mockResolvedValue({ results: [ticket("20", "1"), ticket("21", "4")] });
    const out = await getTicketSummaries(["21", "20", "20"]);
    expect(mockBatchRead).toHaveBeenCalledTimes(1);
    expect(mockBatchRead.mock.calls[0][0]).toEqual(["20", "21"]);
    expect(out["20"].isOpen).toBe(true);
    expect(out["21"].isOpen).toBe(false);
  });

  it("chunks batch reads at 100 ids", async () => {
    mockStageMap.mockResolvedValue({ map: STAGE_MAP, orderedStageIds: [] });
    mockBatchRead.mockResolvedValue({ results: [] });
    // 150 unique ids, zero-padded so the sorted set is deterministic
    const ids = Array.from({ length: 150 }, (_, i) => `id${String(i).padStart(3, "0")}`);
    await getTicketSummaries(ids);
    expect(mockBatchRead).toHaveBeenCalledTimes(2);
    expect(mockBatchRead.mock.calls[0][0]).toHaveLength(100);
    expect(mockBatchRead.mock.calls[1][0]).toHaveLength(50);
  });

  it("returns {} when the stage map is empty (unavailable)", async () => {
    mockStageMap.mockResolvedValue({ map: {}, orderedStageIds: [] });
    const out = await getTicketSummaries(["30"]);
    expect(out).toEqual({});
    expect(mockBatchRead).not.toHaveBeenCalled();
  });

  it("returns {} on batch-read failure and does NOT cache it", async () => {
    mockStageMap.mockResolvedValue({ map: STAGE_MAP, orderedStageIds: [] });
    mockBatchRead.mockRejectedValueOnce(new Error("HubSpot 500"));
    const first = await getTicketSummaries(["40"]);
    expect(first).toEqual({});

    // Same id set → same cache key. A cached failure would skip this fetch.
    mockBatchRead.mockResolvedValueOnce({ results: [ticket("40", "1")] });
    const second = await getTicketSummaries(["40"]);
    expect(second["40"]).toEqual({ subject: "Subject 40", isOpen: true });
  });
});
