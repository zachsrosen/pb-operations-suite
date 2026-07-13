import { buildReportCard, type ReportPeriod } from "@/lib/team-activity/report-card";

/** Minimal summary; only the fields buildReportCard reads. */
const summary = (name: string, email: string, over: Partial<ReportPeriod["summaries"][number]> = {}) => ({
  email,
  name,
  activeDays: 10,
  weekdayActiveDays: 10,
  weekendActiveDays: 0,
  avgActiveHours: 6.2,
  avgSpanHours: 8,
  avgInteractions: 40,
  avgEvents: 60,
  avgGoogleSpanHours: 0,
  avgDealsTouched: 20,
  avgTasksCompleted: 5,
  avgPropertyUpdates: 12,
  totalTalkMinutes: 0,
  totalCalls: 0,
  avgStartMinute: 480,
  avgEndMinute: 1020,
  ptoDays: 0,
  verdict: "full-day" as const,
  ...over,
});

const day = (email: string, name: string, d: string, over: Partial<ReportPeriod["personDays"][number]> = {}) => ({
  email,
  name,
  day: d,
  weekday: true,
  pto: false,
  firstMinute: 480,
  lastMinute: 1020,
  spanHours: 9,
  activeHours: 6,
  interactions: 30,
  eventCount: 60,
  perSource: { pbops: 0, aircall: 0, zuper: 0, hubspot: 50, google: 0, pe: 10 },
  talkMinutes: 0,
  callCount: 0,
  googleSpanHours: 0,
  dealsTouched: 20,
  dealsTouchedAll: 22,
  tasksCompleted: 5,
  propertyUpdates: 12,
  ...over,
});

const rosterEntry = (name: string, email: string, ptoWeekdays = 0) => ({ email, name, ptoWeekdays });

// Jun 29 (Mon) - Jul 12 (Sun) 2026: 10 weekdays.
const period = (over: Partial<ReportPeriod> = {}): ReportPeriod => ({
  range: { from: "2026-06-29T00:00:00.000Z", to: "2026-07-12T23:59:59.000Z" },
  summaries: [summary("Kaitlyn Martinez", "kaitlyn@photonbrothers.com")],
  personDays: [day("kaitlyn@photonbrothers.com", "Kaitlyn Martinez", "2026-07-01")],
  roster: [rosterEntry("Kaitlyn Martinez", "kaitlyn@photonbrothers.com")],
  sources: { ran: [{ source: "hubspot", events: 100 }, { source: "pe", events: 20 }], skipped: [] },
  ...over,
});

const prevPeriod = (over: Partial<ReportPeriod> = {}): ReportPeriod =>
  period({ range: { from: "2026-06-15T00:00:00.000Z", to: "2026-06-28T23:59:59.000Z" }, ...over });

describe("buildReportCard", () => {
  it("renders the header with both ranges", () => {
    const text = buildReportCard(period(), prevPeriod());
    expect(text).toContain("Team Activity Report Card: Jun 29 - Jul 12");
    expect(text).toContain("(vs Jun 15 - Jun 28)");
  });

  it("up/down wording carries the prior value at 1 decimal", () => {
    const up = buildReportCard(
      period({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 30 })] }),
      prevPeriod({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 20.55 })], roster: [rosterEntry("A B", "a@x.com")] }),
    );
    expect(up).toContain("A B: 30 deals/day (up from 20.6)");
    const down = buildReportCard(
      period({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 10 })] }),
      prevPeriod({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 20 })], roster: [rosterEntry("A B", "a@x.com")] }),
    );
    expect(down).toContain("A B: 10 deals/day (down from 20)");
  });

  it("steady band is |cur-prev| <= 0.10 * max(prev, 1)", () => {
    const steady = buildReportCard(
      period({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 21.9 })] }),
      prevPeriod({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 20 })], roster: [rosterEntry("A B", "a@x.com")] }),
    );
    expect(steady).toContain("A B: 21.9 deals/day (steady)");
    const notSteady = buildReportCard(
      period({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 22.1 })] }),
      prevPeriod({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 20 })], roster: [rosterEntry("A B", "a@x.com")] }),
    );
    expect(notSteady).toContain("A B: 22.1 deals/day (up from 20)");
  });

  it("prev 0 with current activity reads up from 0; both 0 reads steady", () => {
    const up = buildReportCard(
      period({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 3 })] }),
      prevPeriod({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 0 })], roster: [rosterEntry("A B", "a@x.com")] }),
    );
    expect(up).toContain("(up from 0)");
    const both0 = buildReportCard(
      period({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 0 })] }),
      prevPeriod({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 0 })], roster: [rosterEntry("A B", "a@x.com")] }),
    );
    expect(both0).toContain("(steady)");
  });

  it("person absent from prior summaries AND prior roster reads new this period", () => {
    const text = buildReportCard(
      period({ summaries: [summary("New Guy", "new@x.com")], roster: [rosterEntry("New Guy", "new@x.com")] }),
      prevPeriod({ summaries: [], roster: [] }),
    );
    expect(text).toContain("New Guy: 20 deals/day (new this period)");
  });

  it("person on prior roster but absent from prior summaries is treated as prior 0", () => {
    const text = buildReportCard(
      period({ summaries: [summary("A B", "a@x.com", { avgDealsTouched: 5 })] }),
      prevPeriod({ summaries: [], roster: [rosterEntry("A B", "a@x.com")] }),
    );
    expect(text).toContain("A B: 5 deals/day (up from 0)");
  });

  it("null previous drops parentheticals and adds the comparison caveat", () => {
    const text = buildReportCard(period(), null);
    expect(text).toContain("Kaitlyn Martinez: 20 deals/day, 5 tasks/day, 12 property updates/day, 6.2h active/day");
    expect(text).not.toContain("(up from");
    expect(text).toContain("Prior-period comparison unavailable for this run.");
  });

  it("PTO notes: none, few, and half-or-more phrasing", () => {
    const text = buildReportCard(
      period({
        summaries: [
          summary("No Pto", "np@x.com"),
          summary("Some Pto", "sp@x.com", { ptoDays: 2 }),
          summary("Half Pto", "hp@x.com", { ptoDays: 6 }),
        ],
        roster: [rosterEntry("No Pto", "np@x.com"), rosterEntry("Some Pto", "sp@x.com", 2), rosterEntry("Half Pto", "hp@x.com", 6)],
      }),
      null,
    );
    expect(text).toContain("No Pto: 20 deals/day, 5 tasks/day, 12 property updates/day, 6.2h active/day, no PTO");
    expect(text).toContain("Some Pto: 20 deals/day, 5 tasks/day, 12 property updates/day, 6.2h active/day, 2 PTO days");
    expect(text).toContain("Half Pto: 20 deals/day, 5 tasks/day, 12 property updates/day, 6.2h active/day, 6 of 10 weekdays on PTO");
  });

  it("roster members without a summary row: full-period PTO vs no tracked activity", () => {
    const text = buildReportCard(
      period({
        roster: [
          rosterEntry("Kaitlyn Martinez", "kaitlyn@photonbrothers.com"),
          rosterEntry("Away Person", "away@x.com", 10),
          rosterEntry("Ghost Person", "ghost@x.com", 0),
        ],
      }),
      null,
    );
    expect(text).toContain("Away Person: on PTO the full period");
    expect(text).toContain("Ghost Person: no tracked activity this period");
    // roster-only people come after ranked people
    expect(text.indexOf("Kaitlyn Martinez:")).toBeLessThan(text.indexOf("Away Person:"));
  });

  it("channel callout fires under 25% hubspot+pe share with >=50 events", () => {
    const text = buildReportCard(
      period({
        summaries: [summary("App Worker", "aw@x.com", { avgDealsTouched: 1 })],
        personDays: [
          day("aw@x.com", "App Worker", "2026-07-01", {
            eventCount: 60,
            perSource: { pbops: 55, aircall: 0, zuper: 0, hubspot: 3, google: 0, pe: 2 },
          }),
        ],
        roster: [rosterEntry("App Worker", "aw@x.com")],
      }),
      null,
    );
    expect(text).toContain("App Worker's tracked work is mostly the PB Ops app; deals/day understates them.");
  });

  it("callout boundaries: exactly 25% share suppressed, exactly 50 events fires", () => {
    const at25 = buildReportCard(
      period({
        summaries: [summary("Edge A", "ea@x.com")],
        personDays: [day("ea@x.com", "Edge A", "2026-07-01", { eventCount: 100, perSource: { pbops: 75, aircall: 0, zuper: 0, hubspot: 25, google: 0, pe: 0 } })],
        roster: [rosterEntry("Edge A", "ea@x.com")],
      }),
      null,
    );
    expect(at25).not.toContain("Edge A's tracked work");
    const at50 = buildReportCard(
      period({
        summaries: [summary("Edge B", "eb@x.com")],
        personDays: [day("eb@x.com", "Edge B", "2026-07-01", { eventCount: 50, perSource: { pbops: 45, aircall: 0, zuper: 0, hubspot: 5, google: 0, pe: 0 } })],
        roster: [rosterEntry("Edge B", "eb@x.com")],
      }),
      null,
    );
    expect(at50).toContain("Edge B's tracked work is mostly the PB Ops app");
  });

  it("callouts are suppressed when hubspot or pe is not among ran sources", () => {
    const base = {
      summaries: [summary("App Worker", "aw@x.com")],
      personDays: [
        day("aw@x.com", "App Worker", "2026-07-01", {
          eventCount: 60,
          perSource: { pbops: 60, aircall: 0, zuper: 0, hubspot: 0, google: 0, pe: 0 },
        }),
      ],
      roster: [rosterEntry("App Worker", "aw@x.com")],
    };
    const noPe = buildReportCard(
      period({ ...base, sources: { ran: [{ source: "hubspot", events: 10 }], skipped: [] } }),
      null,
    );
    expect(noPe).not.toContain("tracked work is mostly");
    const noHubspot = buildReportCard(
      period({ ...base, sources: { ran: [{ source: "pe", events: 10 }], skipped: [] } }),
      null,
    );
    expect(noHubspot).not.toContain("tracked work is mostly");
  });

  it("PTO recap note appears exactly once when anyone had PTO, never otherwise", () => {
    const withPto = buildReportCard(
      period({
        summaries: [summary("Some Pto", "sp@x.com", { ptoDays: 2 }), summary("More Pto", "mp@x.com", { ptoDays: 3 })],
        roster: [rosterEntry("Some Pto", "sp@x.com", 2), rosterEntry("More Pto", "mp@x.com", 3)],
      }),
      null,
    );
    const recap = "Averages exclude PTO days (from the HR PTO calendar).";
    expect(withPto.split(recap).length - 1).toBe(1);
    expect(buildReportCard(period(), null)).not.toContain(recap);
  });

  it("skipped or warned sources in either period become a data caveat line", () => {
    const text = buildReportCard(
      period({ sources: { ran: [{ source: "hubspot", events: 5, warning: "cap hit" }, { source: "pe", events: 2 }], skipped: [{ source: "google", reason: "scope" }] } }),
      prevPeriod({ sources: { ran: [{ source: "hubspot", events: 5 }, { source: "pe", events: 2 }], skipped: [{ source: "zuper", reason: "table" }] } }),
    );
    expect(text).toMatch(/hubspot ran with partial data this period/i);
    expect(text).toMatch(/google did not run this period/i);
    expect(text).toMatch(/zuper did not run in the prior period/i);
  });

  it("empty current period collapses to a single line", () => {
    const text = buildReportCard(period({ summaries: [], personDays: [], roster: [] }), null);
    expect(text).toContain("No tracked activity in this range.");
  });

  it("lists PE submissions separately for people with 10+ uploads, never in deals/day", () => {
    const text = buildReportCard(
      period({
        summaries: [summary("Pe Person", "pp@x.com", { avgDealsTouched: 2 })],
        personDays: [
          day("pp@x.com", "Pe Person", "2026-07-01", { perSource: { pbops: 0, aircall: 0, zuper: 0, hubspot: 5, google: 0, pe: 8 } }),
          day("pp@x.com", "Pe Person", "2026-07-02", { perSource: { pbops: 0, aircall: 0, zuper: 0, hubspot: 5, google: 0, pe: 7 } }),
        ],
        roster: [rosterEntry("Pe Person", "pp@x.com")],
      }),
      null,
    );
    expect(text).toContain("Pe Person submitted 15 PE documents this period (tracked separately from deals/day).");
    expect(text).toContain("Pe Person: 2 deals/day");
  });

  it("suppresses the PE-submissions note under 10 uploads", () => {
    const text = buildReportCard(
      period({
        summaries: [summary("Light Pe", "lp@x.com")],
        personDays: [day("lp@x.com", "Light Pe", "2026-07-01", { perSource: { pbops: 0, aircall: 0, zuper: 0, hubspot: 50, google: 0, pe: 9 } })],
        roster: [rosterEntry("Light Pe", "lp@x.com")],
      }),
      null,
    );
    expect(text).not.toContain("PE documents this period");
  });

  it("contains no em dashes and no email addresses in a rich fixture", () => {
    const text = buildReportCard(
      period({
        summaries: [summary("A B", "a@x.com", { ptoDays: 1 }), summary("C D", "c@x.com", { avgDealsTouched: 2 })],
        roster: [rosterEntry("A B", "a@x.com", 1), rosterEntry("C D", "c@x.com"), rosterEntry("E F", "e@x.com", 10)],
        sources: { ran: [{ source: "hubspot", events: 5, warning: "w" }, { source: "pe", events: 1 }], skipped: [{ source: "google", reason: "r" }] },
      }),
      prevPeriod(),
    );
    expect(text).not.toContain("—");
    expect(text).not.toContain("@");
  });

  it("renders zero tasks/props explicitly", () => {
    const text = buildReportCard(
      period({ summaries: [summary("Zero Person", "z@x.com", { avgTasksCompleted: 0, avgPropertyUpdates: 0 })] , roster: [rosterEntry("Zero Person", "z@x.com")] }),
      null,
    );
    expect(text).toContain("Zero Person: 20 deals/day, 0 tasks/day, 0 property updates/day");
  });

  it("orders ranked people by deals/day descending", () => {
    const text = buildReportCard(
      period({
        summaries: [
          summary("Low Person", "l@x.com", { avgDealsTouched: 2 }),
          summary("High Person", "h@x.com", { avgDealsTouched: 30 }),
        ],
        roster: [rosterEntry("Low Person", "l@x.com"), rosterEntry("High Person", "h@x.com")],
      }),
      null,
    );
    expect(text.indexOf("High Person:")).toBeLessThan(text.indexOf("Low Person:"));
  });
});
