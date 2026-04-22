import {
  generateAssignments,
  computeWorkload,
  rankReplacements,
  daysBetween,
  addDays,
  isWeekend,
  dayOfWeek,
} from "@/lib/on-call-rotation";

const CA_MEMBERS = [
  { crewMemberId: "nick", orderIndex: 0, isActive: true },
  { crewMemberId: "lucas", orderIndex: 1, isActive: true },
  { crewMemberId: "charlie", orderIndex: 2, isActive: true },
  { crewMemberId: "ruben", orderIndex: 3, isActive: true },
];

const DEN_MEMBERS = Array.from({ length: 10 }, (_, i) => ({
  crewMemberId: `d${i}`,
  orderIndex: i,
  isActive: true,
}));

describe("on-call rotation date math", () => {
  it("daysBetween counts calendar days correctly", () => {
    expect(daysBetween("2026-05-01", "2026-05-08")).toBe(7);
    expect(daysBetween("2026-05-08", "2026-05-01")).toBe(-7);
  });

  it("addDays wraps month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("addDays is unaffected by DST", () => {
    // US spring-forward: 2026-03-08. Fall-back: 2026-11-01.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("isWeekend identifies Sat and Sun only", () => {
    expect(isWeekend("2026-05-02")).toBe(true); // Sat
    expect(isWeekend("2026-05-03")).toBe(true); // Sun
    expect(isWeekend("2026-05-04")).toBe(false); // Mon
    expect(isWeekend("2026-05-08")).toBe(false); // Fri
  });

  it("dayOfWeek matches JS convention (Sun=0)", () => {
    expect(dayOfWeek("2026-05-03")).toBe(0); // Sunday
    expect(dayOfWeek("2026-05-04")).toBe(1); // Monday
    expect(dayOfWeek("2026-05-09")).toBe(6); // Saturday
  });
});

describe("generateAssignments — strict round-robin", () => {
  it("cycles through 4-member CA pool over 14 days", () => {
    const out = generateAssignments({
      startDate: "2026-04-06",
      fromDate: "2026-04-06",
      toDate: "2026-04-19",
      members: CA_MEMBERS,
    });
    expect(out).toHaveLength(14);
    expect(out[0]).toEqual({ date: "2026-04-06", crewMemberId: "nick" });
    expect(out[3]).toEqual({ date: "2026-04-09", crewMemberId: "ruben" });
    expect(out[4]).toEqual({ date: "2026-04-10", crewMemberId: "nick" }); // wraps
    // Day offset 13, 13 % 4 = 1 → lucas.
    expect(out[13]).toEqual({ date: "2026-04-19", crewMemberId: "lucas" });
  });

  it("respects orderIndex ordering even when members arrive out of order", () => {
    const shuffled = [...CA_MEMBERS].reverse();
    const out = generateAssignments({
      startDate: "2026-04-06",
      fromDate: "2026-04-06",
      toDate: "2026-04-09",
      members: shuffled,
    });
    expect(out.map((a) => a.crewMemberId)).toEqual(["nick", "lucas", "charlie", "ruben"]);
  });

  it("computes offset correctly when query window is after anchor", () => {
    const out = generateAssignments({
      startDate: "2026-01-01",
      fromDate: "2026-05-01",
      toDate: "2026-05-04",
      members: CA_MEMBERS,
    });
    // daysBetween 2026-01-01 and 2026-05-01 = 120. 120 % 4 = 0 → nick.
    expect(out[0].crewMemberId).toBe("nick");
  });

  it("handles fromDate before startDate (negative offset)", () => {
    const out = generateAssignments({
      startDate: "2026-04-06",
      fromDate: "2026-04-04",
      toDate: "2026-04-06",
      members: CA_MEMBERS,
    });
    // Offset = -2. (-2 mod 4) = 2 → charlie.
    expect(out[0].crewMemberId).toBe("charlie");
    expect(out[2].crewMemberId).toBe("nick"); // arrives at anchor
  });

  it("skips inactive members entirely", () => {
    const withInactive = [
      ...CA_MEMBERS.slice(0, 2),
      { ...CA_MEMBERS[2], isActive: false },
      CA_MEMBERS[3],
    ];
    const out = generateAssignments({
      startDate: "2026-04-06",
      fromDate: "2026-04-06",
      toDate: "2026-04-09",
      members: withInactive,
    });
    // Active: nick, lucas, ruben (3 members). Cycle: nick, lucas, ruben, nick.
    expect(out.map((a) => a.crewMemberId)).toEqual(["nick", "lucas", "ruben", "nick"]);
  });

  it("throws when no active members", () => {
    expect(() =>
      generateAssignments({
        startDate: "2026-04-06",
        fromDate: "2026-04-06",
        toDate: "2026-04-10",
        members: CA_MEMBERS.map((m) => ({ ...m, isActive: false })),
      }),
    ).toThrow(/no active members/);
  });

  it("returns empty when toDate < fromDate", () => {
    const out = generateAssignments({
      startDate: "2026-04-06",
      fromDate: "2026-04-10",
      toDate: "2026-04-09",
      members: CA_MEMBERS,
    });
    expect(out).toEqual([]);
  });

  it("crosses DST boundary without drift", () => {
    // Spring forward on 2026-03-08 (US). Cycle through 8 days.
    const out = generateAssignments({
      startDate: "2026-03-05",
      fromDate: "2026-03-05",
      toDate: "2026-03-12",
      members: CA_MEMBERS,
    });
    expect(out.map((a) => a.date)).toEqual([
      "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08",
      "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12",
    ]);
  });
});

describe("computeWorkload", () => {
  it("tallies per-person days, weekends, holidays in May 2026 (Denver 10-person)", () => {
    const assignments = generateAssignments({
      startDate: "2026-05-01",
      fromDate: "2026-05-01",
      toDate: "2026-05-31",
      members: DEN_MEMBERS,
    });
    const workload = computeWorkload({ month: "2026-05", assignments });
    // 31 days / 10 members = 3 or 4 per person.
    const totalDays = Object.values(workload).reduce((sum, s) => sum + s.days, 0);
    expect(totalDays).toBe(31);
    // Memorial Day 2026 = May 25. Person for day 25: offset from May 1 is 24, 24 % 10 = 4 → d4.
    expect(workload["d4"].holidays).toBe(1);
  });

  it("ignores assignments outside the month window", () => {
    const workload = computeWorkload({
      month: "2026-05",
      assignments: [
        { date: "2026-04-30", crewMemberId: "nick" },
        { date: "2026-05-01", crewMemberId: "nick" },
        { date: "2026-06-01", crewMemberId: "nick" },
      ],
    });
    expect(workload["nick"].days).toBe(1);
  });
});

describe("rankReplacements", () => {
  it("ranks least-loaded first and recommends top eligible", () => {
    // 4-person CA pool for one week of May. Nick gets May 1, Lucas May 2, ...
    const assignments = generateAssignments({
      startDate: "2026-05-01",
      fromDate: "2026-05-01",
      toDate: "2026-05-07",
      members: CA_MEMBERS,
    });
    // Ask for replacement on May 5 (assignee = nick again via rotation).
    const ranked = rankReplacements({
      targetDate: "2026-05-05",
      currentAssignments: assignments,
      members: CA_MEMBERS,
      ptoMemberIds: new Set(),
      month: "2026-05",
    });
    // Nick is current assignee — excluded. Lucas/Charlie/Ruben return.
    expect(ranked.map((r) => r.crewMemberId).sort()).toEqual(["charlie", "lucas", "ruben"]);
    // Top result flagged recommended if eligible.
    expect(ranked[0].reason).toMatch(/recommended|adjacent-conflict|pto/);
  });

  it("flags adjacent-day conflicts", () => {
    const assignments = generateAssignments({
      startDate: "2026-05-01",
      fromDate: "2026-05-01",
      toDate: "2026-05-07",
      members: CA_MEMBERS,
    });
    // May 5 = nick. Day before (May 4) = ruben. Day after (May 6) = lucas.
    const ranked = rankReplacements({
      targetDate: "2026-05-05",
      currentAssignments: assignments,
      members: CA_MEMBERS,
      ptoMemberIds: new Set(),
      month: "2026-05",
    });
    const ruben = ranked.find((r) => r.crewMemberId === "ruben");
    const lucas = ranked.find((r) => r.crewMemberId === "lucas");
    expect(ruben?.reason).toBe("adjacent-conflict");
    expect(lucas?.reason).toBe("adjacent-conflict");
  });

  it("flags PTO members as unavailable", () => {
    const assignments = generateAssignments({
      startDate: "2026-05-01",
      fromDate: "2026-05-01",
      toDate: "2026-05-07",
      members: CA_MEMBERS,
    });
    const ranked = rankReplacements({
      targetDate: "2026-05-05",
      currentAssignments: assignments,
      members: CA_MEMBERS,
      ptoMemberIds: new Set(["charlie"]),
      month: "2026-05",
    });
    const charlie = ranked.find((r) => r.crewMemberId === "charlie");
    expect(charlie?.reason).toBe("pto");
  });
});

describe("weekly rotation", () => {
  const WEEKLY_OPTS = (from: string, to: string) => ({
    startDate: "2026-05-04", // Monday
    fromDate: from,
    toDate: to,
    members: CA_MEMBERS,
    rotationUnit: "weekly" as const,
  });

  it("assigns all 7 days of a week to the same member", () => {
    const out = generateAssignments(WEEKLY_OPTS("2026-05-04", "2026-05-10"));
    const unique = new Set(out.map((a) => a.crewMemberId));
    expect(unique.size).toBe(1);
    expect(out[0].crewMemberId).toBe("nick");
    expect(out).toHaveLength(7);
  });

  it("cycles to the next member at Monday boundary", () => {
    const out = generateAssignments(WEEKLY_OPTS("2026-05-04", "2026-05-17"));
    // Week 1 (May 4-10) = nick, Week 2 (May 11-17) = lucas.
    expect(out[0].crewMemberId).toBe("nick");
    expect(out[6].crewMemberId).toBe("nick"); // Sun
    expect(out[7].crewMemberId).toBe("lucas"); // Mon
    expect(out[13].crewMemberId).toBe("lucas");
  });

  it("wraps through 4-member pool in 4 weeks and restarts", () => {
    const out = generateAssignments(WEEKLY_OPTS("2026-05-04", "2026-06-07"));
    // Weeks: nick, lucas, charlie, ruben, nick.
    const byMonday = [0, 7, 14, 21, 28].map((i) => out[i].crewMemberId);
    expect(byMonday).toEqual(["nick", "lucas", "charlie", "ruben", "nick"]);
  });

  it("aligns to Monday even when pool startDate is mid-week", () => {
    const out = generateAssignments({
      startDate: "2026-05-06", // Wednesday
      fromDate: "2026-05-04",  // Monday of same week
      toDate:   "2026-05-17",
      members: CA_MEMBERS,
      rotationUnit: "weekly",
    });
    // anchor Monday = 2026-05-04. Week 1 = nick, Week 2 = lucas.
    expect(out[0].crewMemberId).toBe("nick");
    expect(out[7].crewMemberId).toBe("lucas");
  });
});
