import {
  countBusinessDaysInclusive,
  getBusinessDatesInSpan,
  getConstructionSpanDaysFromZuper,
  isWeekendDateYmd,
  normalizeZuperBoundaryDates,
} from "@/lib/scheduling-utils";

describe("scheduling-utils", () => {
  it("detects weekends", () => {
    expect(isWeekendDateYmd("2026-03-07")).toBe(true);
    expect(isWeekendDateYmd("2026-03-08")).toBe(true);
    expect(isWeekendDateYmd("2026-03-09")).toBe(false);
  });

  it("counts business days inclusively", () => {
    expect(countBusinessDaysInclusive("2026-03-05", "2026-03-06")).toBe(2);
    expect(countBusinessDaysInclusive("2026-03-06", "2026-03-09")).toBe(2);
  });

  it("expands install spans into business dates", () => {
    expect(getBusinessDatesInSpan("2026-03-06", 3)).toEqual([
      "2026-03-06",
      "2026-03-09",
      "2026-03-10",
    ]);
  });

  it("normalizes zuper boundary dates in timezone", () => {
    expect(
      normalizeZuperBoundaryDates({
        startIso: "2026-03-05T08:00:00Z",
        endIso: "2026-03-06T17:00:00Z",
        timezone: "UTC",
      })
    ).toEqual({ startDate: "2026-03-05", endDate: "2026-03-06" });
  });

  it("derives install span from zuper boundaries before fallback days", () => {
    expect(
      getConstructionSpanDaysFromZuper({
        startIso: "2026-03-05T08:00:00Z",
        endIso: "2026-03-06T17:00:00Z",
        scheduledDays: 1,
        timezone: "UTC",
      })
    ).toBe(2);
  });

  it("falls back to scheduled days when boundaries are missing", () => {
    expect(
      getConstructionSpanDaysFromZuper({
        scheduledDays: 2.2,
        timezone: "UTC",
      })
    ).toBe(3);
  });
});
