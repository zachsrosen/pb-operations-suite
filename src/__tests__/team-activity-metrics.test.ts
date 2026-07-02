import {
  activeHours,
  interactionCount,
  denverDay,
  isWeekday,
  computePersonDays,
  rollupByPerson,
  verdictFor,
  type ActivityEvent,
  type TalkTimeRecord,
} from "@/lib/team-activity/metrics";

const ev = (
  email: string,
  iso: string,
  source: ActivityEvent["source"] = "hubspot",
  objectKey?: string,
): ActivityEvent => ({ email, timestamp: new Date(iso), source, objectKey });

describe("activeHours", () => {
  it("returns 0 for zero or one event", () => {
    expect(activeHours([])).toBe(0);
    expect(activeHours([new Date("2026-07-01T15:00:00Z")])).toBe(0);
  });

  it("sums gaps and caps each at 60 min (the worked example)", () => {
    // 13:00, 13:05 (+5), 13:22 (+17), 15:40 (gap 2h18m -> capped 60), 15:41 (+1)
    const times = [
      "2026-07-01T13:00:00Z",
      "2026-07-01T13:05:00Z",
      "2026-07-01T13:22:00Z",
      "2026-07-01T15:40:00Z",
      "2026-07-01T15:41:00Z",
    ].map((s) => new Date(s));
    // 5 + 17 + 60 + 1 = 83 min
    expect(activeHours(times)).toBeCloseTo(83 / 60, 6);
  });

  it("is order-independent", () => {
    const a = activeHours(["2026-07-01T10:00:00Z", "2026-07-01T10:10:00Z"].map((s) => new Date(s)));
    const b = activeHours(["2026-07-01T10:10:00Z", "2026-07-01T10:00:00Z"].map((s) => new Date(s)));
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeCloseTo(10 / 60, 6);
  });
});

describe("interactionCount", () => {
  it("collapses same-object events within the 10-min window to one", () => {
    // A deal edit firing two rows at the same instant = 1 interaction.
    const events = [
      ev("z@x.com", "2026-07-01T13:00:00Z", "hubspot", "deal:1"),
      ev("z@x.com", "2026-07-01T13:00:00Z", "hubspot", "deal:1"),
    ];
    expect(interactionCount(events)).toBe(1);
  });

  it("counts a re-touch of the same object outside the window separately", () => {
    const events = [
      ev("z@x.com", "2026-07-01T13:00:00Z", "hubspot", "deal:1"),
      ev("z@x.com", "2026-07-01T13:11:00Z", "hubspot", "deal:1"), // 11 min later
    ];
    expect(interactionCount(events)).toBe(2);
  });

  it("never dedups events without an objectKey", () => {
    const events = [
      ev("z@x.com", "2026-07-01T13:00:00Z", "aircall"),
      ev("z@x.com", "2026-07-01T13:00:00Z", "aircall"),
      ev("z@x.com", "2026-07-01T13:00:00Z", "aircall"),
    ];
    expect(interactionCount(events)).toBe(3);
  });

  it("treats distinct objects independently", () => {
    const events = [
      ev("z@x.com", "2026-07-01T13:00:00Z", "hubspot", "deal:1"),
      ev("z@x.com", "2026-07-01T13:00:30Z", "hubspot", "deal:2"),
    ];
    expect(interactionCount(events)).toBe(2);
  });
});

describe("denverDay / isWeekday", () => {
  it("buckets a late-night UTC timestamp into the correct Denver day", () => {
    // 2026-07-02T05:30:00Z is 2026-07-01 23:30 MDT -> belongs to Jul 1.
    expect(denverDay(new Date("2026-07-02T05:30:00Z"))).toBe("2026-07-01");
    // 2026-07-02T07:00:00Z is 2026-07-02 01:00 MDT -> Jul 2.
    expect(denverDay(new Date("2026-07-02T07:00:00Z"))).toBe("2026-07-02");
  });

  it("classifies weekend vs weekday", () => {
    expect(isWeekday("2026-07-01")).toBe(true); // Wed
    expect(isWeekday("2026-07-04")).toBe(false); // Sat
    expect(isWeekday("2026-07-05")).toBe(false); // Sun
  });
});

describe("computePersonDays", () => {
  it("groups by person and Denver day and carries talk-time", () => {
    const events = [
      ev("a@x.com", "2026-07-01T16:00:00Z", "hubspot", "deal:1"),
      ev("a@x.com", "2026-07-01T16:20:00Z", "hubspot", "deal:2"),
      ev("b@x.com", "2026-07-01T18:00:00Z", "pbops"),
    ];
    const talk: TalkTimeRecord[] = [{ email: "a@x.com", day: "2026-07-01", talkSec: 900, calls: 3 }];
    const days = computePersonDays(events, talk);
    expect(days).toHaveLength(2);
    const a = days.find((d) => d.email === "a@x.com")!;
    expect(a.eventCount).toBe(2);
    expect(a.interactions).toBe(2);
    expect(a.talkMinutes).toBe(15);
    expect(a.callCount).toBe(3);
    expect(a.perSource.hubspot).toBe(2);
  });

  it("creates a day for talk-only activity (call day, no other events)", () => {
    const talk: TalkTimeRecord[] = [{ email: "a@x.com", day: "2026-07-02", talkSec: 600, calls: 2 }];
    const days = computePersonDays([], talk);
    expect(days).toHaveLength(1);
    expect(days[0].talkMinutes).toBe(10);
    expect(days[0].eventCount).toBe(0);
  });
});

describe("rollupByPerson + verdictFor", () => {
  it("averages over weekdays only and ranks by active hours", () => {
    const events: ActivityEvent[] = [
      // weekday with ~7h active via steady clicks
      ev("a@x.com", "2026-07-01T15:00:00Z", "hubspot", "deal:1"),
      ev("a@x.com", "2026-07-01T22:00:00Z", "hubspot", "deal:2"),
      // weekend day should not affect weekday averages
      ev("a@x.com", "2026-07-04T15:00:00Z", "hubspot", "deal:3"),
    ];
    const [summary] = rollupByPerson(computePersonDays(events));
    expect(summary.activeDays).toBe(2);
    expect(summary.weekdayActiveDays).toBe(1);
    expect(summary.weekendActiveDays).toBe(1);
  });

  it("verdict thresholds", () => {
    expect(verdictFor({ avgSpanHours: 13, avgActiveHours: 5, avgGoogleSpanHours: 0 })).toBe("marathon");
    expect(verdictFor({ avgSpanHours: 8, avgActiveHours: 6.5, avgGoogleSpanHours: 0 })).toBe("full-day");
    expect(verdictFor({ avgSpanHours: 8, avgActiveHours: 2, avgGoogleSpanHours: 8 })).toBe("full-day");
    expect(verdictFor({ avgSpanHours: 3, avgActiveHours: 1, avgGoogleSpanHours: 0 })).toBe("light");
  });
});
