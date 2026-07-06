import { expandSwapDates, isShortNotice, SHORT_NOTICE_DAYS } from "@/lib/on-call-swap";

describe("expandSwapDates", () => {
  it("expands a weekly swap date to its full Mon-Sun week", () => {
    // 2026-08-10 is a Monday
    expect(expandSwapDates("weekly", "2026-08-10")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
  });

  it("expands a mid-week date to the same week block", () => {
    // Wednesday inside the Aug 10 week
    expect(expandSwapDates("weekly", "2026-08-12")).toEqual(
      expandSwapDates("weekly", "2026-08-10"),
    );
  });

  it("puts Sunday in the week that started the previous Monday", () => {
    expect(expandSwapDates("weekly", "2026-08-16")[0]).toBe("2026-08-10");
  });

  it("returns just the single date for daily pools", () => {
    expect(expandSwapDates("daily", "2026-08-12")).toEqual(["2026-08-12"]);
  });
});

describe("isShortNotice", () => {
  const today = "2026-07-06";

  it("flags dates inside the window", () => {
    expect(isShortNotice("2026-07-06", today)).toBe(true);
    expect(isShortNotice("2026-07-13", today)).toBe(true);
    expect(isShortNotice("2026-07-19", today)).toBe(true); // day 13
  });

  it("does not flag dates at or beyond the window", () => {
    expect(isShortNotice("2026-07-20", today)).toBe(false); // exactly 14 days out
    expect(isShortNotice("2026-08-10", today)).toBe(false);
  });

  it("flags past dates", () => {
    expect(isShortNotice("2026-07-01", today)).toBe(true);
  });

  it("window constant matches the 2-week policy", () => {
    expect(SHORT_NOTICE_DAYS).toBe(14);
  });
});
