import {
  calculatePriorityScore,
  generateOptimizedSchedule,
  nextBusinessDayAfter,
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
/*  generateOptimizedSchedule Tests                                    */
/* ================================================================== */

describe("generateOptimizedSchedule", () => {
  it("returns empty for empty input", () => {
    const result = generateOptimizedSchedule([], CREWS, DIRECTORS, TIMEZONES);
    expect(result.entries).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("round-robins across crews at same location", () => {
    // 4 projects at Westminster with 2 crews → 2 each
    const projects = [
      makeProject({ id: "p1", amount: 40000, daysInstall: 1 }),
      makeProject({ id: "p2", amount: 30000, daysInstall: 1 }),
      makeProject({ id: "p3", amount: 20000, daysInstall: 1 }),
      makeProject({ id: "p4", amount: 10000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18", // Wednesday
    });

    expect(result.entries).toHaveLength(4);
    const alphaCount = result.entries.filter((e) => e.crew === "WESTY Alpha").length;
    const bravoCount = result.entries.filter((e) => e.crew === "WESTY Bravo").length;
    expect(alphaCount).toBe(2);
    expect(bravoCount).toBe(2);
  });

  it("single-crew location stacks sequentially", () => {
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
    // First: Wed Feb 18, 2 days → ends Thu Feb 19, next = Fri Feb 20
    expect(result.entries[0].startDate).toBe("2026-02-18");
    expect(result.entries[1].startDate).toBe("2026-02-20");
  });

  it("off-by-one: 1-day job on Friday → crew next available Monday", () => {
    const projects = [
      makeProject({ id: "p1", amount: 100000, daysInstall: 1 }),
      makeProject({ id: "p2", amount: 50000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-20", // Friday
    });

    // p1 (higher score) → Alpha, starts Fri, 1 day → ends Fri, next = Mon
    // p2 → Bravo, starts Fri (both start same date), 1 day → ends Fri, next = Mon
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].startDate).toBe("2026-02-20");
    expect(result.entries[1].startDate).toBe("2026-02-20");
  });

  it("off-by-one: single crew, 1-day Friday → next job Monday", () => {
    const projects = [
      makeProject({ id: "p1", location: "Colorado Springs", amount: 100000, daysInstall: 1 }),
      makeProject({ id: "p2", location: "Colorado Springs", amount: 50000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-20", // Friday
    });

    expect(result.entries[0].startDate).toBe("2026-02-20"); // Friday
    expect(result.entries[1].startDate).toBe("2026-02-23"); // Monday (not Friday!)
  });

  it("multi-day span: 3-day job starting Wednesday → ends Friday, next Monday", () => {
    const projects = [
      makeProject({ id: "p1", location: "Colorado Springs", amount: 100000, daysInstall: 3 }),
      makeProject({ id: "p2", location: "Colorado Springs", amount: 50000, daysInstall: 1 }),
    ];

    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-02-18", // Wednesday
    });

    // p1: starts Wed, 3 days → Wed, Thu, Fri → ends Fri Feb 20, next = Mon Feb 23
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

  it("does not assign crew on dates with existing bookings", () => {
    const projects = [makeProject({ id: "new-1", daysInstall: 2 })];
    const existingBookings = [
      { crew: "WESTY Alpha", startDate: "2026-03-02", days: 3 }, // Mon-Wed
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02",
      existingBookings,
    });
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    // Should be assigned to WESTY Bravo (starts Mon) since Alpha is blocked Mon-Wed
    // OR to WESTY Alpha starting Thu (after existing booking ends)
    if (entry.crew === "WESTY Alpha") {
      expect(entry.startDate).toBe("2026-03-05"); // Thu
    } else {
      expect(entry.crew).toBe("WESTY Bravo");
      expect(entry.startDate).toBe("2026-03-02"); // Mon
    }
  });

  it("prefers crew with earlier availability when one is blocked", () => {
    const projects = [makeProject({ id: "new-1", daysInstall: 1 })];
    const existingBookings = [
      { crew: "WESTY Alpha", startDate: "2026-03-02", days: 5 }, // Full week
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02",
      existingBookings,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].crew).toBe("WESTY Bravo");
    expect(result.entries[0].startDate).toBe("2026-03-02");
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
    expect(r1.entries.map(e => e.crew)).toEqual(r2.entries.map(e => e.crew));
    expect(r1.entries.map(e => e.startDate)).toEqual(r2.entries.map(e => e.startDate));
  });

  it("multi-day job avoids partial overlap with existing booking", () => {
    // Existing booking blocks Wed-Fri. New 3-day job should not start Mon
    // because it would span Mon-Wed and overlap on Wed.
    const projects = [makeProject({ id: "p1", location: "Colorado Springs", daysInstall: 3 })];
    const existingBookings = [
      { crew: "COSP Alpha", startDate: "2026-03-04", days: 3 }, // Wed-Fri
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02", // Mon
      existingBookings,
    });
    expect(result.entries).toHaveLength(1);
    // COSP has only one crew — must start after Fri, so next Mon
    expect(result.entries[0].startDate).toBe("2026-03-09"); // Next Monday
  });

  it("blocks all location crews when all are booked (fallback behavior)", () => {
    // Simulates what happens when existingBookings are built from an
    // unresolvable crew name — the scheduler page blocks ALL crews at the
    // location. The optimizer should see both WESTY crews as blocked.
    const projects = [makeProject({ id: "new-1", daysInstall: 1 })];
    const existingBookings = [
      { crew: "WESTY Alpha", startDate: "2026-03-02", days: 3 },
      { crew: "WESTY Bravo", startDate: "2026-03-02", days: 3 },
    ];
    const result = generateOptimizedSchedule(projects, CREWS, DIRECTORS, TIMEZONES, {
      startDate: "2026-03-02",
      existingBookings,
    });
    expect(result.entries).toHaveLength(1);
    // Both Westminster crews blocked Mon-Wed, so earliest available is Thu
    expect(result.entries[0].startDate).toBe("2026-03-05");
  });
});
