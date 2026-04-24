import { resolveTaskTimestamp } from "@/lib/compliance-v2/task-timestamp";

describe("resolveTaskTimestamp", () => {
  it("returns earliest of actual_end_time, form.created_at, parent completion", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: "2026-04-03T15:00:00Z",
      formCreatedAt: "2026-04-03T17:00:00Z",
      parentCompletedTime: "2026-04-03T20:00:00Z",
    });
    expect(result?.toISOString()).toBe("2026-04-03T15:00:00.000Z");
  });

  it("uses form.created_at when earlier than task actual_end_time (rare)", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: "2026-04-03T15:00:00Z",
      formCreatedAt: "2026-04-03T13:00:00Z",
      parentCompletedTime: null,
    });
    expect(result?.toISOString()).toBe("2026-04-03T13:00:00.000Z");
  });

  it("falls back to parent completion when task has no timestamps", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: null,
      formCreatedAt: null,
      parentCompletedTime: "2026-04-03T20:00:00Z",
    });
    expect(result?.toISOString()).toBe("2026-04-03T20:00:00.000Z");
  });

  it("returns null when all signals are missing", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: null,
      formCreatedAt: null,
      parentCompletedTime: null,
    });
    expect(result).toBeNull();
  });

  it("ignores invalid date strings", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: "not-a-date",
      formCreatedAt: "2026-04-03T13:00:00Z",
      parentCompletedTime: null,
    });
    expect(result?.toISOString()).toBe("2026-04-03T13:00:00.000Z");
  });
});
