jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/zuper", () => ({ zuper: { isConfigured: () => false } }));
jest.mock("@/lib/cache", () => ({ appCache: { getOrFetch: jest.fn() } }));
jest.mock("@/lib/hubspot-engagements", () => ({
  getDealEngagements: jest.fn(),
  getDealTasks: jest.fn(),
}));

import { parseZuperStatusHistory } from "@/lib/deal-timeline";

describe("parseZuperStatusHistory", () => {
  it("returns empty array for null rawData", () => {
    expect(parseZuperStatusHistory("job-123", "Construction", null)).toEqual([]);
  });

  it("returns empty array when job_status is missing", () => {
    expect(parseZuperStatusHistory("job-123", "Construction", { some: "data" })).toEqual([]);
  });

  it("returns empty array when job_status is not an array", () => {
    expect(parseZuperStatusHistory("job-123", "Construction", { job_status: "bad" })).toEqual([]);
  });

  it("maps status transitions to timeline events", () => {
    const rawData = {
      job_status: [
        { status_name: "SCHEDULED", created_at: "2026-04-10T10:00:00Z" },
        { status_name: "STARTED", created_at: "2026-04-11T08:00:00Z" },
        { status_name: "COMPLETED", created_at: "2026-04-11T16:00:00Z" },
      ],
    };
    const events = parseZuperStatusHistory("job-abc", "Construction", rawData);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      id: "zstatus-job-abc-20260410100000-SCHEDULED",
      type: "zuper_status",
      title: "Construction — SCHEDULED",
      timestamp: "2026-04-10T10:00:00Z",
    });
    expect(events[2]).toMatchObject({
      id: "zstatus-job-abc-20260411160000-COMPLETED",
      type: "zuper_status",
      title: "Construction — COMPLETED",
      timestamp: "2026-04-11T16:00:00Z",
    });
  });

  it("skips entries without a timestamp", () => {
    const rawData = {
      job_status: [
        { status_name: "SCHEDULED", created_at: "2026-04-10T10:00:00Z" },
        { status_name: "STARTED" },
      ],
    };
    const events = parseZuperStatusHistory("job-abc", "Site Survey", rawData);
    expect(events).toHaveLength(1);
  });
});
