import { denverWeekBounds, isoWeekKey } from "@/lib/team-activity/week";

describe("denverWeekBounds", () => {
  // Fired Monday 2026-07-13 13:00 UTC (7am MDT). Prior week = Mon 7/6 -> Sun 7/12.
  it("returns the prior Mon-Sun and the week before it, Denver-local", () => {
    const { current, previous } = denverWeekBounds(new Date("2026-07-13T13:00:00Z"));
    // 2026-07-06 00:00 MDT = 06:00 UTC
    expect(current.from.toISOString()).toBe("2026-07-06T06:00:00.000Z");
    // 2026-07-13 00:00 MDT = 06:00 UTC (end is exclusive-ish: last ms of Sun 7/12)
    expect(current.to.toISOString()).toBe("2026-07-13T05:59:59.999Z");
    expect(previous.from.toISOString()).toBe("2026-06-29T06:00:00.000Z");
    expect(previous.to.toISOString()).toBe("2026-07-06T05:59:59.999Z");
  });

  it("works when fired on the Tuesday retry day (still targets the same prior week)", () => {
    const mon = denverWeekBounds(new Date("2026-07-13T13:00:00Z"));
    const tue = denverWeekBounds(new Date("2026-07-14T13:00:00Z"));
    expect(tue.current.from.toISOString()).toBe(mon.current.from.toISOString());
    expect(tue.current.to.toISOString()).toBe(mon.current.to.toISOString());
  });

  it("is DST-safe across the spring-forward week (Mar 8 2026, 2am MST->MDT)", () => {
    // Fired Mon 2026-03-16. Prior week Mon 3/9 -> Sun 3/15 is fully MDT (UTC-6).
    // The week before (3/2 -> 3/8) STARTS in MST (UTC-7) and ends spanning the
    // transition; its Monday 3/2 00:00 is MST = 07:00 UTC.
    const { current, previous } = denverWeekBounds(new Date("2026-03-16T13:00:00Z"));
    expect(current.from.toISOString()).toBe("2026-03-09T06:00:00.000Z"); // MDT
    expect(previous.from.toISOString()).toBe("2026-03-02T07:00:00.000Z"); // MST
  });
});

describe("isoWeekKey", () => {
  it("keys by the Monday-anchored ISO week", () => {
    // 2026-07-13 is a Monday.
    expect(isoWeekKey(new Date("2026-07-13T13:00:00Z"))).toMatch(/^2026-W\d{2}$/);
    // Same week for any day Mon-Sun.
    expect(isoWeekKey(new Date("2026-07-15T09:00:00Z"))).toBe(isoWeekKey(new Date("2026-07-13T13:00:00Z")));
    // Different week for the next Monday.
    expect(isoWeekKey(new Date("2026-07-20T13:00:00Z"))).not.toBe(isoWeekKey(new Date("2026-07-13T13:00:00Z")));
  });
});
