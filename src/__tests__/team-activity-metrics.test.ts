import {
  activeHours,
  interactionCount,
  denverDay,
  isWeekday,
  isTouchOnActiveDeal,
  computePersonDays,
  rollupByPerson,
  verdictFor,
  ptoDaysFromOooEvents,
  type ActivityEvent,
  type TalkTimeRecord,
  type PtoDaysByEmail,
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

  it("task engagements (due-date-timed) don't stretch span/active-hours but still count deals", () => {
    const days = computePersonDays([
      hsEv({ deals: [{ id: "1", active: true }], kind: "engagement/emails", timestamp: new Date("2026-07-01T17:00:00Z") }), // 11:00 Denver
      hsEv({ deals: [{ id: "1", active: true }], kind: "engagement/emails", timestamp: new Date("2026-07-01T18:00:00Z") }), // 12:00 Denver
      hsEv({ deals: [{ id: "2", active: true }], kind: "engagement/tasks", timestamp: new Date("2026-07-02T05:59:00Z") }), // 23:59 Denver Jul 1 (due date)
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].dealsTouched).toBe(2); // task's deal still counts
    expect(days[0].eventCount).toBe(3);
    expect(days[0].spanHours).toBeCloseTo(1); // 11:00-12:00; the 23:59 due date is ignored
    expect(days[0].lastMinute).toBe(12 * 60);
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

describe("ptoDaysFromOooEvents", () => {
  // July MDT = UTC-6. A Denver day runs 06:00Z -> 06:00Z next day.
  it("marks a full-day OOO as a PTO day", () => {
    const days = ptoDaysFromOooEvents([
      { start: new Date("2026-07-01T06:00:00Z"), end: new Date("2026-07-02T06:00:00Z") },
    ]);
    expect([...days]).toEqual(["2026-07-01"]);
  });

  it("ignores a short partial-day OOO (afternoon off is not full PTO)", () => {
    // 13:00-17:00 Denver = 4h, below the 6h threshold.
    const days = ptoDaysFromOooEvents([
      { start: new Date("2026-07-01T19:00:00Z"), end: new Date("2026-07-01T23:00:00Z") },
    ]);
    expect(days.size).toBe(0);
  });

  it("expands a multi-day OOO into every covered Denver day", () => {
    // Mon 00:00 Denver -> Thu 00:00 Denver = Jul 6,7,8.
    const days = ptoDaysFromOooEvents([
      { start: new Date("2026-07-06T06:00:00Z"), end: new Date("2026-07-09T06:00:00Z") },
    ]);
    expect([...days].sort()).toEqual(["2026-07-06", "2026-07-07", "2026-07-08"]);
  });

  it("counts a 9-17 style OOO (8h within one day) as PTO", () => {
    const days = ptoDaysFromOooEvents([
      { start: new Date("2026-07-01T15:00:00Z"), end: new Date("2026-07-01T23:00:00Z") },
    ]);
    expect([...days]).toEqual(["2026-07-01"]);
  });
});

describe("PTO-aware computePersonDays + rollupByPerson", () => {
  const pto: PtoDaysByEmail = new Map([["a@x.com", new Set(["2026-07-01"])]]);

  it("flags person-days that fall on a PTO day", () => {
    const events = [
      ev("a@x.com", "2026-07-01T16:00:00Z", "hubspot", "deal:1"), // PTO day (glanced at email)
      ev("a@x.com", "2026-07-02T16:00:00Z", "hubspot", "deal:2"),
    ];
    const days = computePersonDays(events, [], pto);
    expect(days.find((d) => d.day === "2026-07-01")!.pto).toBe(true);
    expect(days.find((d) => d.day === "2026-07-02")!.pto).toBe(false);
  });

  it("excludes PTO days from weekday averages so a PTO-day email glance doesn't drag them down", () => {
    const events = [
      // Wed Jul 1 (PTO): a single touch -> would average in as a ~0h day.
      ev("a@x.com", "2026-07-01T16:00:00Z", "hubspot", "deal:1"),
      // Thu Jul 2: a real ~4h day.
      ev("a@x.com", "2026-07-02T15:00:00Z", "hubspot", "deal:2"),
      ev("a@x.com", "2026-07-02T19:00:00Z", "hubspot", "deal:3"),
    ];
    const days = computePersonDays(events, [], pto);
    const [withPto] = rollupByPerson(days, pto);
    const [without] = rollupByPerson(computePersonDays(events));
    // Without PTO awareness the Jul 1 zero-hour day halves the average.
    expect(without.avgActiveHours).toBeCloseTo(0.5, 3);
    expect(withPto.avgActiveHours).toBeCloseTo(1, 3);
    expect(withPto.avgSpanHours).toBeCloseTo(4, 3);
  });

  it("counts weekday PTO days in the summary, including fully-offline ones", () => {
    const ptoWeek: PtoDaysByEmail = new Map([
      // Wed + Thu + Sat; Sat is weekend so only 2 should count.
      ["a@x.com", new Set(["2026-07-01", "2026-07-02", "2026-07-04"])],
    ]);
    // Only activity is on Friday — the PTO days themselves have zero events.
    const days = computePersonDays([ev("a@x.com", "2026-07-03T16:00:00Z", "hubspot", "deal:1")], [], ptoWeek);
    const [s] = rollupByPerson(days, ptoWeek);
    expect(s.ptoDays).toBe(2);
  });

  it("defaults ptoDays to 0 and pto flag to false when no PTO data is supplied", () => {
    const days = computePersonDays([ev("a@x.com", "2026-07-01T16:00:00Z", "hubspot", "deal:1")]);
    expect(days[0].pto).toBe(false);
    const [s] = rollupByPerson(days);
    expect(s.ptoDays).toBe(0);
  });
});

describe("matchRosterByDisplayName", () => {
  const { matchRosterByDisplayName } = jest.requireActual("@/lib/team-activity/roster");
  const roster = [
    { email: "kat@photonbrothers.com", name: "Katlyyn Arnoldi" },
    { email: "natasha.sanford@photonbrothers.com", name: "Natasha Wooten Sanford" },
    { email: "kaitlyn@photonbrothers.com", name: "Kaitlyn Martinez" },
    { email: "kristofer.stuhff@photonbrothers.com", name: "Kristofer Stuhff" },
  ];

  it("matches exact names", () => {
    expect(matchRosterByDisplayName(roster, "Kaitlyn Martinez")).toBe("kaitlyn@photonbrothers.com");
  });

  it("matches nickname prefixes (HR 'Kat' vs roster 'Katlyyn')", () => {
    expect(matchRosterByDisplayName(roster, "Kat Arnoldi")).toBe("kat@photonbrothers.com");
  });

  it("ignores dropped middle names (HR 'Natasha Sanford')", () => {
    expect(matchRosterByDisplayName(roster, "Natasha Sanford")).toBe("natasha.sanford@photonbrothers.com");
  });

  it("returns null for non-roster people and single tokens", () => {
    expect(matchRosterByDisplayName(roster, "Sam D")).toBe(null);
    expect(matchRosterByDisplayName(roster, "Kristofer")).toBe(null);
  });

  it("requires >=3-char prefix so initials don't match", () => {
    expect(matchRosterByDisplayName(roster, "Ka Arnoldi")).toBe(null);
  });
});

describe("parsePtoSummary", () => {
  const { parsePtoSummary } = jest.requireActual("@/lib/team-activity/adapters");

  it("parses both HR summary formats", () => {
    expect(parsePtoSummary("Kaitlyn Martinez on Vacation")).toBe("Kaitlyn Martinez");
    expect(parsePtoSummary("Kat Arnoldi is Out of Office")).toBe("Kat Arnoldi");
  });

  it("returns null for unrecognized summaries", () => {
    expect(parsePtoSummary("Company Holiday")).toBe(null);
    expect(parsePtoSummary("")).toBe(null);
  });
});

describe("matchRosterByDisplayName nameAliases", () => {
  const { matchRosterByDisplayName: match } = jest.requireActual("@/lib/team-activity/roster");
  const roster = [
    { email: "alexis@photonbrothers.com", name: "Alexis Severson", nameAliases: ["Lexie Severson"] },
  ];

  it("matches HR nicknames declared as nameAliases (Lexie -> Alexis)", () => {
    expect(match(roster, "Lexie Severson")).toBe("alexis@photonbrothers.com");
    expect(match(roster, "Alexis Severson")).toBe("alexis@photonbrothers.com");
  });
});
