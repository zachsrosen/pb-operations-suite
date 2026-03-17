/**
 * Tests for precise daysSinceStageMovement calculation.
 * Exercises the real computeDaysInStage helper from hubspot.ts.
 */
import { computeDaysInStage } from "@/lib/hubspot";

describe("computeDaysInStage", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("computes exact days from ISO datetime", () => {
    expect(computeDaysInStage("2026-02-14T12:00:00Z", now)).toBe(30);
  });

  it("returns 0 when value is null", () => {
    expect(computeDaysInStage(null, now)).toBe(0);
  });

  it("returns 0 when value is undefined", () => {
    expect(computeDaysInStage(undefined, now)).toBe(0);
  });

  it("returns 0 when value is empty string", () => {
    expect(computeDaysInStage("", now)).toBe(0);
  });

  it("rounds to nearest day", () => {
    // 6.75 days ago → rounds to 7
    expect(computeDaysInStage("2026-03-09T18:30:00.000Z", now)).toBe(7);
  });

  it("clamps to 0 for future dates (clock skew)", () => {
    expect(computeDaysInStage("2026-03-16T14:00:00.000Z", now)).toBe(0);
  });

  it("handles large values (no 120-day cap)", () => {
    // 928 days ago — the old property would show 120 max
    expect(computeDaysInStage("2023-08-31T19:54:52.223Z", now)).toBe(928);
  });

  it("returns 0 for invalid date strings", () => {
    expect(computeDaysInStage("not-a-date", now)).toBe(0);
  });
});
