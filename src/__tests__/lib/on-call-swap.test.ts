import { expandSwapDates, groupIntoBlocks, isShortNotice, SHORT_NOTICE_DAYS } from "@/lib/on-call-swap";

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

describe("groupIntoBlocks", () => {
  const row = (date: string, id: string, name: string) => ({
    poolId: "p1",
    date,
    crewMemberId: id,
    crewMemberName: name,
  });

  it("collapses a full consecutive week into one block (regression: alternating-day bug)", () => {
    const days = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"];
    const blocks = groupIntoBlocks(days.map((d) => row(d, "christian", "Christian White")));
    expect(blocks).toEqual([
      { poolId: "p1", crewMemberId: "christian", crewMemberName: "Christian White", startDate: "2026-07-13", endDate: "2026-07-19" },
    ]);
  });

  it("splits blocks on member change and keeps full ranges", () => {
    const blocks = groupIntoBlocks([
      row("2026-07-13", "a", "A"),
      row("2026-07-14", "a", "A"),
      row("2026-07-15", "b", "B"),
      row("2026-07-16", "b", "B"),
    ]);
    expect(blocks.map((b) => [b.crewMemberId, b.startDate, b.endDate])).toEqual([
      ["a", "2026-07-13", "2026-07-14"],
      ["b", "2026-07-15", "2026-07-16"],
    ]);
  });

  it("splits on date gaps (Sunday-less pools) even for the same member", () => {
    const blocks = groupIntoBlocks([
      row("2026-07-17", "a", "A"), // Fri
      row("2026-07-18", "a", "A"), // Sat — Sunday missing
      row("2026-07-20", "a", "A"), // Mon
    ]);
    expect(blocks.map((b) => [b.startDate, b.endDate])).toEqual([
      ["2026-07-17", "2026-07-18"],
      ["2026-07-20", "2026-07-20"],
    ]);
  });

  it("drops the excluded member's rows without bridging across them", () => {
    const blocks = groupIntoBlocks(
      [
        row("2026-07-13", "b", "B"),
        row("2026-07-14", "me", "Me"),
        row("2026-07-15", "b", "B"),
      ],
      "me",
    );
    expect(blocks.map((b) => [b.startDate, b.endDate])).toEqual([
      ["2026-07-13", "2026-07-13"],
      ["2026-07-15", "2026-07-15"],
    ]);
  });
});
