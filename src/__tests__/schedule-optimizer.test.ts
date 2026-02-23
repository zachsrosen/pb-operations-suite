import {
  calculatePriorityScore,
  generateOptimizedSchedule,
  nextBusinessDayAfter,
  DEFAULT_LOCATION_CAPACITY,
  type OptimizableProject,
  type ScoringPreset,
} from "@/lib/schedule-optimizer";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeProject(overrides: Partial<OptimizableProject> = {}): OptimizableProject {
  return {
    id: "proj-1",
    name: "Test Project",
    address: "123 Main St",
    location: "Westminster",
    amount: 50000,
    stage: "rtb",
    isPE: false,
    daysInstall: 2,
    daysToInstall: null,
    ...overrides,
  };
}

const CREWS = {
  Westminster: [
    { name: "WESTY Alpha", roofers: 2, electricians: 1, color: "#3b82f6" },
    { name: "WESTY Bravo", roofers: 2, electricians: 1, color: "#10b981" },
  ],
  Centennial: [
    { name: "DTC Alpha", roofers: 2, electricians: 1, color: "#8b5cf6" },
    { name: "DTC Bravo", roofers: 2, electricians: 1, color: "#ec4899" },
  ],
  "Colorado Springs": [
    { name: "COSP Alpha", roofers: 3, electricians: 1, color: "#f97316" },
  ],
};

const DIRECTORS = {
  Westminster: { name: "Joe Lynch", userUid: "uid-joe", teamUid: "team-westy" },
  Centennial: { name: "Drew Perry", userUid: "uid-drew", teamUid: "team-dtc" },
  "Colorado Springs": { name: "Rolando", userUid: "uid-rolando", teamUid: "team-cosp" },
};

const TIMEZONES: Record<string, string> = {
  Westminster: "America/Denver",
  Centennial: "America/Denver",
  "Colorado Springs": "America/Denver",
};

/* ================================================================== */
/*  Scoring Tests                                                      */
/* ================================================================== */

describe("calculatePriorityScore", () => {
  it("returns base score with revenue + RTB bonus", () => {
    const p = makeProject({ amount: 50000, isPE: false, daysToInstall: null });
    const score = calculatePriorityScore(p, "balanced");
    // revenue = min(100, 50000/1000) = 50
    // pe = 0, urgency = 0, rtb = 30
    expect(score).toBe(80);
  });

  it("adds PE bonus", () => {
    const base = makeProject({ amount: 50000, isPE: false, daysToInstall: null });
    const pe = makeProject({ amount: 50000, isPE: true, daysToInstall: null });
    const diff = calculatePriorityScore(pe, "balanced") - calculatePriorityScore(base, "balanced");
    expect(diff).toBe(50);
  });

  it("caps revenue at 100", () => {
    const p = makeProject({ amount: 200000, isPE: false, daysToInstall: null });
    const score = calculatePriorityScore(p, "balanced");
    // revenue = min(100, 200) = 100, pe = 0, urgency = 0, rtb = 30
    expect(score).toBe(130);
  });

  it("adds urgency for overdue projects (daysToInstall < 0)", () => {
    const p = makeProject({ amount: 0, isPE: false, daysToInstall: -10 });
    const score = calculatePriorityScore(p, "balanced");
    // revenue = 0, pe = 0, urgency = min(200, 10*2) = 20, rtb = 30
    expect(score).toBe(50);
  });

  it("caps overdue urgency at 200", () => {
    const p = makeProject({ amount: 0, isPE: false, daysToInstall: -150 });
    const score = calculatePriorityScore(p, "balanced");
    // urgency = min(200, 300) = 200
    expect(score).toBe(230); // 0 + 0 + 200 + 30
  });

  it("adds urgency for near-deadline projects (0 ≤ daysToInstall ≤ 14)", () => {
    const p = makeProject({ amount: 0, isPE: false, daysToInstall: 7 });
    const score = calculatePriorityScore(p, "balanced");
    // urgency = (14 - 7) * 3 = 21, rtb = 30
    expect(score).toBe(51);
  });

  it("no urgency when daysToInstall > 14", () => {
    const p = makeProject({ amount: 0, isPE: false, daysToInstall: 30 });
    const score = calculatePriorityScore(p, "balanced");
    expect(score).toBe(30); // only rtb bonus
  });

  it("handles null daysToInstall (no urgency)", () => {
    const p = makeProject({ amount: 0, isPE: false, daysToInstall: null });
    const score = calculatePriorityScore(p, "balanced");
    expect(score).toBe(30); // only rtb bonus
  });

  it("applies preset weights correctly", () => {
    const p = makeProject({ amount: 100000, isPE: true, daysToInstall: -20 });
    // revenue = 100, pe = 50, urgency = min(200, 40) = 40, rtb = 30

    const balanced = calculatePriorityScore(p, "balanced");
    // 100*1 + 50*1 + 40*1 + 30 = 220
    expect(balanced).toBe(220);

    const revFirst = calculatePriorityScore(p, "revenue-first");
    // 100*3 + 50*0.5 + 40*0.5 + 30 = 300 + 25 + 20 + 30 = 375
    expect(revFirst).toBe(375);

    const peFirst = calculatePriorityScore(p, "pe-priority");
    // 100*0.5 + 50*3 + 40*1.5 + 30 = 50 + 150 + 60 + 30 = 290
    expect(peFirst).toBe(290);

    const urgFirst = calculatePriorityScore(p, "urgency-first");
    // 100*0.5 + 50*1 + 40*3 + 30 = 50 + 50 + 120 + 30 = 250
    expect(urgFirst).toBe(250);
  });

  it("different presets produce different orderings", () => {
    const highRevenue = makeProject({ id: "a", amount: 150000, isPE: false, daysToInstall: 30 });
    const highPE = makeProject({ id: "b", amount: 10000, isPE: true, daysToInstall: 30 });
    const highUrgency = makeProject({ id: "c", amount: 10000, isPE: false, daysToInstall: -50 });

    const presets: ScoringPreset[] = ["balanced", "revenue-first", "pe-priority", "urgency-first"];
    const orderings = presets.map((preset) => {
      const scores = [
        { id: "a", score: calculatePriorityScore(highRevenue, preset) },
        { id: "b", score: calculatePriorityScore(highPE, preset) },
        { id: "c", score: calculatePriorityScore(highUrgency, preset) },
      ];
      scores.sort((a, b) => b.score - a.score);
      return scores.map((s) => s.id).join(",");
    });

    // Not all orderings should be the same
    const unique = new Set(orderings);
    expect(unique.size).toBeGreaterThan(1);
  });
});

/* ================================================================== */
/*  nextBusinessDayAfter Tests                                         */
/* ================================================================== */

describe("nextBusinessDayAfter", () => {
  it("Friday → Monday", () => {
    expect(nextBusinessDayAfter("2026-02-20")).toBe("2026-02-23"); // Fri → Mon
  });

  it("Saturday → Monday", () => {
    expect(nextBusinessDayAfter("2026-02-21")).toBe("2026-02-23"); // Sat → Mon
  });

  it("Sunday → Monday", () => {
    expect(nextBusinessDayAfter("2026-02-22")).toBe("2026-02-23"); // Sun → Mon
  });

  it("Monday → Tuesday", () => {
    expect(nextBusinessDayAfter("2026-02-23")).toBe("2026-02-24"); // Mon → Tue
  });

  it("Thursday → Friday", () => {
    expect(nextBusinessDayAfter("2026-02-19")).toBe("2026-02-20"); // Thu → Fri
  });
});

/* ================================================================== */
/*  DEFAULT_LOCATION_CAPACITY                                          */
/* ================================================================== */

describe("DEFAULT_LOCATION_CAPACITY", () => {
  it("exports expected location capacities", () => {
    expect(DEFAULT_LOCATION_CAPACITY["Westminster"]).toBe(2);
    expect(DEFAULT_LOCATION_CAPACITY["Centennial"]).toBe(2);
    expect(DEFAULT_LOCATION_CAPACITY["Colorado Springs"]).toBe(1);
    expect(DEFAULT_LOCATION_CAPACITY["San Luis Obispo"]).toBe(2);
    expect(DEFAULT_LOCATION_CAPACITY["Camarillo"]).toBe(1);
  });
});

/* ================================================================== */
/*  generateOptimizedSchedule Tests                                    */
/* ================================================================== */

describe("generateOptimizedSchedule", () => {
  it("returns empty for empty input", () => {
    const result = generateOptimizedSchedule([], CREWS, DIRECTORS, TIMEZONES);
    expect(result.entries).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("schedules 2 jobs on same day at Westminster (capacity=2)", () => {
    const projects = [
      makeProject({ id: "p1", amount: 40000, daysInstall: 1 }),
      makeProject({ id: "p2", amount: 30000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18", // Wednesday
    });

    expect(result.entries).toHaveLength(2);
    // Both should be on the same day since Westminster capacity = 2
    expect(result.entries[0].startDate).toBe("2026-02-18");
    expect(result.entries[1].startDate).toBe("2026-02-18");
  });

  it("third job at Westminster overflows to next day", () => {
    const projects = [
      makeProject({ id: "p1", amount: 40000, daysInstall: 1 }),
      makeProject({ id: "p2", amount: 30000, daysInstall: 1 }),
      makeProject({ id: "p3", amount: 20000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18", // Wednesday
    });

    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].startDate).toBe("2026-02-18");
    expect(result.entries[1].startDate).toBe("2026-02-18");
    // Third job must go to next day since capacity is 2
    expect(result.entries[2].startDate).toBe("2026-02-19");
  });

  it("round-robins crew names within a location", () => {
    const projects = [
      makeProject({ id: "p1", amount: 40000, daysInstall: 1 }),
      makeProject({ id: "p2", amount: 30000, daysInstall: 1 }),
      makeProject({ id: "p3", amount: 20000, daysInstall: 1 }),
      makeProject({ id: "p4", amount: 10000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18",
    });

    expect(result.entries).toHaveLength(4);
    // Round-robin: Alpha, Bravo, Alpha, Bravo
    expect(result.entries[0].crew).toBe("WESTY Alpha");
    expect(result.entries[1].crew).toBe("WESTY Bravo");
    expect(result.entries[2].crew).toBe("WESTY Alpha");
    expect(result.entries[3].crew).toBe("WESTY Bravo");
  });

  it("single-crew location with capacity=1 stacks sequentially", () => {
    const projects = [
      makeProject({ id: "p1", location: "Colorado Springs", daysInstall: 2 }),
      makeProject({ id: "p2", location: "Colorado Springs", daysInstall: 2 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18", // Wednesday
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].crew).toBe("COSP Alpha");
    expect(result.entries[1].crew).toBe("COSP Alpha");
    // First: Wed Feb 18, 2 days → ends Thu Feb 19, next available = Fri Feb 20
    expect(result.entries[0].startDate).toBe("2026-02-18");
    expect(result.entries[1].startDate).toBe("2026-02-20");
  });

  it("off-by-one: 1-day job on Friday → both fit same day at capacity=2 location", () => {
    const projects = [
      makeProject({ id: "p1", amount: 100000, daysInstall: 1 }),
      makeProject({ id: "p2", amount: 50000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-20", // Friday
    });

    // Both on Friday since Westminster has capacity=2
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].startDate).toBe("2026-02-20");
    expect(result.entries[1].startDate).toBe("2026-02-20");
  });

  it("off-by-one: single crew capacity=1, 1-day Friday → next job Monday", () => {
    const projects = [
      makeProject({ id: "p1", location: "Colorado Springs", amount: 100000, daysInstall: 1 }),
      makeProject({ id: "p2", location: "Colorado Springs", amount: 50000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-20", // Friday
    });

    expect(result.entries[0].startDate).toBe("2026-02-20"); // Friday
    expect(result.entries[1].startDate).toBe("2026-02-23"); // Monday (capacity=1, so next day)
  });

  it("multi-day span: 3-day job starting Wednesday → ends Friday, next Monday", () => {
    const projects = [
      makeProject({ id: "p1", location: "Colorado Springs", amount: 100000, daysInstall: 3 }),
      makeProject({ id: "p2", location: "Colorado Springs", amount: 50000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18", // Wednesday
    });

    // p1: starts Wed, 3 days → Wed, Thu, Fri → all at capacity, next available = Mon Feb 23
    expect(result.entries[0].startDate).toBe("2026-02-18");
    expect(result.entries[1].startDate).toBe("2026-02-23");
  });

  it("skips projects with unknown location", () => {
    const projects = [
      makeProject({ id: "p1", location: "Unknown" }),
      makeProject({ id: "p2", location: "Westminster" }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18",
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].project.id).toBe("p2");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe("p1");
  });

  it("assigns correct director and timezone per location", () => {
    const projects = [
      makeProject({ id: "p1", location: "Westminster" }),
      makeProject({ id: "p2", location: "Colorado Springs" }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18",
    });

    const westy = result.entries.find((e) => e.project.location === "Westminster")!;
    expect(westy.assigneeName).toBe("Joe Lynch");
    expect(westy.timezone).toBe("America/Denver");

    const cosp = result.entries.find((e) => e.project.location === "Colorado Springs")!;
    expect(cosp.assigneeName).toBe("Rolando");
  });

  it("sorts by priority score descending", () => {
    const projects = [
      makeProject({ id: "low", amount: 1000, isPE: false, daysToInstall: 30 }),
      makeProject({ id: "high", amount: 150000, isPE: true, daysToInstall: -10 }),
      makeProject({ id: "mid", amount: 50000, isPE: false, daysToInstall: 7 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18",
      preset: "balanced",
    });

    // First entry should be the highest scored
    expect(result.entries[0].project.id).toBe("high");
    expect(result.entries[0].score).toBeGreaterThan(result.entries[1].score);
    expect(result.entries[1].score).toBeGreaterThan(result.entries[2].score);
  });

  it("includes crew color in entries", () => {
    const projects = [makeProject({ id: "p1" })];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18",
    });

    expect(result.entries[0].crewColor).toBeTruthy();
    expect(result.entries[0].crewColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("respects preset option", () => {
    const projects = [makeProject({ id: "p1", amount: 100000, isPE: true, daysToInstall: -5 })];

    const balanced = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18",
      preset: "balanced",
    });
    const revFirst = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18",
      preset: "revenue-first",
    });

    expect(balanced.entries[0].score).not.toBe(revFirst.entries[0].score);
  });

  it("existing bookings reduce available capacity on those days", () => {
    // Westminster capacity=2. One existing booking on Mon → only 1 slot left.
    // Two new 1-day jobs: first fits Mon, second must go to Tue.
    const projects = [
      makeProject({ id: "new-1", daysInstall: 1, amount: 50000 }),
      makeProject({ id: "new-2", daysInstall: 1, amount: 40000 }),
    ];
    const existingBookings = [
      { location: "Westminster", startDate: "2026-03-02", days: 1 }, // Mon
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02",
      existingBookings,
    });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].startDate).toBe("2026-03-02"); // Mon (1 slot left)
    expect(result.entries[1].startDate).toBe("2026-03-03"); // Tue (Mon now full)
  });

  it("location at full capacity pushes to next available day", () => {
    // Westminster capacity=2. Two existing bookings on Mon → no slots left.
    const projects = [makeProject({ id: "new-1", daysInstall: 1 })];
    const existingBookings = [
      { location: "Westminster", startDate: "2026-03-02", days: 1 },
      { location: "Westminster", startDate: "2026-03-02", days: 1 },
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02",
      existingBookings,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].startDate).toBe("2026-03-03"); // Tue
  });

  it("COSP capacity=1 means one booking blocks that day entirely", () => {
    const projects = [makeProject({ id: "new-1", location: "Colorado Springs", daysInstall: 1 })];
    const existingBookings = [
      { location: "Colorado Springs", startDate: "2026-03-02", days: 3 }, // Mon-Wed
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02",
      existingBookings,
    });
    expect(result.entries).toHaveLength(1);
    // Mon-Wed blocked, next available is Thu
    expect(result.entries[0].startDate).toBe("2026-03-05");
  });

  it("no existing bookings behaves same as before", () => {
    const projects = [makeProject({ id: "p1" }), makeProject({ id: "p2" })];
    const r1 = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02",
    });
    const r2 = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02",
      existingBookings: [],
    });
    expect(r1.entries.map(e => e.startDate)).toEqual(r2.entries.map(e => e.startDate));
  });

  it("multi-day job avoids days at capacity", () => {
    // COSP capacity=1. Existing booking Wed only.
    // New 3-day job: Mon-Wed would overlap blocked Wed → must skip.
    const projects = [makeProject({ id: "p1", location: "Colorado Springs", daysInstall: 3 })];
    const existingBookings = [
      { location: "Colorado Springs", startDate: "2026-03-04", days: 1 }, // Wed
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02", // Mon
      existingBookings,
    });
    expect(result.entries).toHaveLength(1);
    // Mon-Wed: Wed is full → conflict. Tue-Thu: Wed full → conflict.
    // Wed: full. Thu-Mon: Thu, Fri, Mon → no conflict
    expect(result.entries[0].startDate).toBe("2026-03-05"); // Thu
  });

  it("backfills earlier gaps when a smaller job fits in a slot a larger job skipped", () => {
    // COSP capacity=1. Existing booking on Wed Mar 4 (1 day).
    // Big job (3 days) can't start Mon (Mon-Wed overlaps Wed) → starts Thu.
    // Small job (1 day) SHOULD backfill to Mon.
    const projects = [
      makeProject({ id: "big", location: "Colorado Springs", amount: 100000, daysInstall: 3 }),
      makeProject({ id: "small", location: "Colorado Springs", amount: 10000, daysInstall: 1 }),
    ];
    const existingBookings = [
      { location: "Colorado Springs", startDate: "2026-03-04", days: 1 }, // Wed blocked
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02", // Mon
      existingBookings,
    });
    expect(result.entries).toHaveLength(2);
    const big = result.entries.find(e => e.project.id === "big")!;
    const small = result.entries.find(e => e.project.id === "small")!;
    expect(big.startDate).toBe("2026-03-05"); // Thu
    expect(small.startDate).toBe("2026-03-02"); // Mon (backfill!)
  });

  it("custom locationCapacity overrides defaults", () => {
    // Override Westminster to capacity=1 (default is 2)
    const projects = [
      makeProject({ id: "p1", daysInstall: 1, amount: 50000 }),
      makeProject({ id: "p2", daysInstall: 1, amount: 40000 }),
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18",
      locationCapacity: { ...DEFAULT_LOCATION_CAPACITY, Westminster: 1 },
    });
    expect(result.entries).toHaveLength(2);
    // With capacity=1, second job goes to next day
    expect(result.entries[0].startDate).toBe("2026-02-18");
    expect(result.entries[1].startDate).toBe("2026-02-19");
  });

  it("capacity=2 allows two multi-day jobs to overlap at Westminster", () => {
    // Two 2-day jobs at Westminster should both start on same day
    const projects = [
      makeProject({ id: "p1", daysInstall: 2, amount: 50000 }),
      makeProject({ id: "p2", daysInstall: 2, amount: 40000 }),
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18", // Wed
    });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].startDate).toBe("2026-02-18");
    expect(result.entries[1].startDate).toBe("2026-02-18");
  });
});
