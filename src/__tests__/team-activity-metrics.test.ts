import {
  activeHours,
  interactionCount,
  denverDay,
  isWeekday,
  isTouchOnActiveDeal,
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

describe("isTouchOnActiveDeal", () => {
  const t = (iso: string) => new Date(iso);

  it("counts a touch on a non-terminal stage as active", () => {
    expect(isTouchOnActiveDeal("Construction", "Project Pipeline", null, t("2026-07-01T12:00:00Z"))).toBe(true);
  });

  it("counts a terminal-stage touch within the 3-day buffer as active", () => {
    expect(
      isTouchOnActiveDeal("Project Complete", "Project Pipeline", t("2026-07-01T00:00:00Z"), t("2026-07-03T23:00:00Z")),
    ).toBe(true);
  });

  it("does not count a terminal-stage touch past the buffer", () => {
    expect(
      isTouchOnActiveDeal("Project Complete", "Project Pipeline", t("2026-07-01T00:00:00Z"), t("2026-07-04T00:00:01Z")),
    ).toBe(false);
  });

  it("treats a terminal-stage deal with no entered date as not active (conservative)", () => {
    expect(isTouchOnActiveDeal("Cancelled", "Project Pipeline", null, t("2026-07-01T12:00:00Z"))).toBe(false);
  });

  it("matches terminal labels case-insensitively and across hyphen variants", () => {
    const entered = t("2026-06-01T00:00:00Z");
    const touch = t("2026-07-01T00:00:00Z");
    for (const label of ["cancelled", "ON-HOLD", "On-hold", "project complete", "Complete", "Completed", "Closed lost", "Closed won"]) {
      expect(isTouchOnActiveDeal(label, "Project Pipeline", entered, touch)).toBe(false);
    }
  });

  it("excludes Test Pipeline deals from BOTH counts by returning null", () => {
    expect(isTouchOnActiveDeal("Contract Sent", "Test Pipeline", null, t("2026-07-01T12:00:00Z"))).toBe(null);
  });

  it("respects a custom buffer", () => {
    const entered = t("2026-07-01T00:00:00Z");
    expect(isTouchOnActiveDeal("Completed", "Service Pipeline", entered, t("2026-07-05T00:00:00Z"), 7)).toBe(true);
    expect(isTouchOnActiveDeal("Completed", "Service Pipeline", entered, t("2026-07-05T00:00:00Z"), 3)).toBe(false);
  });
});

describe("dealsTouched metrics", () => {
  const hsEv = (over: Partial<ActivityEvent>): ActivityEvent => ({
    email: "pm@photonbrothers.com",
    timestamp: new Date("2026-07-01T17:00:00Z"), // 11:00 Denver, weekday (Wed)
    source: "hubspot",
    ...over,
  });

  it("counts distinct active deals per day; repeat touches of one deal count once", () => {
    const days = computePersonDays([
      hsEv({ deals: [{ id: "1", active: true }], objectKey: "DEAL:1", kind: "engagement/emails" }),
      hsEv({ deals: [{ id: "1", active: true }], objectKey: "DEAL:1", kind: "CRM_OBJECT/UPDATE", timestamp: new Date("2026-07-01T18:00:00Z") }),
      hsEv({ deals: [{ id: "2", active: false }], objectKey: "DEAL:2", kind: "engagement/notes" }),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].dealsTouched).toBe(1); // deal 2 is inactive
    expect(days[0].dealsTouchedAll).toBe(2);
  });

  it("a multi-deal engagement counts each attributed deal once but stays one event", () => {
    const days = computePersonDays([
      hsEv({ deals: [{ id: "1", active: true }, { id: "2", active: true }], objectKey: "DEAL:1", kind: "engagement/emails" }),
    ]);
    expect(days[0].dealsTouched).toBe(2);
    expect(days[0].eventCount).toBe(1);
    expect(days[0].interactions).toBe(1);
  });

  it("ignores DEAL:-keyed events without a deals field (zuper/pe) in both counts", () => {
    const days = computePersonDays([
      hsEv({ source: "zuper", objectKey: "DEAL:9", kind: "job status" }),
      hsEv({ source: "pe", objectKey: "DEAL:9", kind: "uploaded doc" }),
      hsEv({ source: "hubspot", objectKey: "DEAL:9", kind: "login" }), // no deals field either
    ]);
    expect(days[0].dealsTouched).toBe(0);
    expect(days[0].dealsTouchedAll).toBe(0);
  });

  it("only hubspot-source events feed the counts even if deals is present", () => {
    const days = computePersonDays([hsEv({ source: "zuper", deals: [{ id: "1", active: true }] })]);
    expect(days[0].dealsTouched).toBe(0);
    expect(days[0].dealsTouchedAll).toBe(0);
  });

  it("rollupByPerson averages dealsTouched over active weekdays", () => {
    const days = computePersonDays([
      hsEv({ deals: [{ id: "1", active: true }, { id: "2", active: true }] }), // Wed 7/1
      hsEv({ deals: [{ id: "3", active: true }], timestamp: new Date("2026-07-02T17:00:00Z") }), // Thu 7/2
      hsEv({ deals: [{ id: "4", active: true }], timestamp: new Date("2026-07-04T17:00:00Z") }), // Sat — excluded from avg
    ]);
    const [s] = rollupByPerson(days);
    expect(s.avgDealsTouched).toBeCloseTo(1.5); // (2 + 1) / 2 weekdays
  });
});
