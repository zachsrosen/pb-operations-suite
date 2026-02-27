import {
  addBusinessDaysYmd,
  addDaysYmd,
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
    expect(countBusinessDaysInclusive("2026-03-10", "2026-03-05")).toBe(1);
  });

  it("adds days and business days with weekend handling", () => {
    expect(addDaysYmd("2026-03-31", 1)).toBe("2026-04-01");
    expect(addBusinessDaysYmd("2026-03-07", 0)).toBe("2026-03-09");
    expect(addBusinessDaysYmd("2026-03-06", 1)).toBe("2026-03-09");
  });

  it("expands install spans into business dates", () => {
    expect(getBusinessDatesInSpan("2026-03-06", 3)).toEqual([
      "2026-03-06",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(getBusinessDatesInSpan("2026-03-07", 2)).toEqual([
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

  it("normalizes malformed and inverted boundary inputs safely", () => {
    expect(
      normalizeZuperBoundaryDates({
        startIso: "bad 2026-03-10 data",
        endIso: "2026-03-12T10:00:00Z",
        timezone: "UTC",
      })
    ).toEqual({ startDate: "2026-03-10", endDate: "2026-03-12" });

    expect(
      normalizeZuperBoundaryDates({
        startIso: "2026-03-12T10:00:00Z",
        endIso: "2026-03-10T08:00:00Z",
        timezone: "UTC",
      })
    ).toEqual({ startDate: "2026-03-12", endDate: "2026-03-12" });
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

  it("returns undefined when no parseable boundaries or fallback days exist", () => {
    expect(
      getConstructionSpanDaysFromZuper({
        startIso: "not-a-date",
        endIso: "still-not-a-date",
        timezone: "UTC",
      })
    ).toBeUndefined();
  });
});
