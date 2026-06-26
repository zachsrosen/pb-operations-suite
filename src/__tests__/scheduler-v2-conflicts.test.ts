/**
 * Tests for scheduler-v2 conflict detection.
 * Exercises detectConflicts() from scheduler-v2/conflicts.ts.
 *
 * Rules:
 *   hard double_book      — resourceId already has an assignment on `date`
 *   hard weekend_holiday  — isHolidayOrWeekend is true
 *   hard lead_time        — leadTimeError is non-null
 *   soft over_capacity    — location load (existing + new job) exceeds capacityDays
 *   soft travel           — travel.infeasible is true
 *
 *   ok = hard.length === 0
 */
import { detectConflicts } from "@/lib/scheduler-v2/conflicts";
import type { Assignment, CapacityCell } from "@/lib/scheduler-v2/types";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeAssignment(overrides: Partial<Assignment> & { date: string }): Assignment {
  return {
    id: `a-${Math.random()}`,
    source: "schedule_record",
    resourceName: "Joe Lynch",
    date: overrides.date,
    startTime: null,
    endTime: null,
    workType: "install",
    location: "Westminster",
    workItemId: "wi-existing",
    projectId: "p-existing",
    projectName: "Existing Project",
    value: null,
    status: "scheduled",
    ...overrides,
  };
}

function makeCapacityCell(overrides: Partial<CapacityCell> & { location: string; date: string }): CapacityCell {
  return {
    location: overrides.location,
    date: overrides.date,
    loadDays: 0,
    capacityDays: 2,
    ...overrides,
  };
}

const BASE_PARAMS = {
  resourceId: "resource-abc",
  location: "Westminster",
  date: "2026-07-01",
  days: 2,
  workType: "install",
} as const;

const CLEAN_CONTEXT = {
  existingAssignments: [],
  capacityCells: [makeCapacityCell({ location: "Westminster", date: "2026-07-01", loadDays: 0, capacityDays: 2 })],
  isHolidayOrWeekend: false,
  leadTimeError: null,
};

/* ------------------------------------------------------------------ */
/*  Happy path                                                         */
/* ------------------------------------------------------------------ */

describe("detectConflicts — happy path", () => {
  it("returns ok:true with no flags when everything is clean", () => {
    const result = detectConflicts(BASE_PARAMS, CLEAN_CONTEXT);
    expect(result.ok).toBe(true);
    expect(result.hard).toHaveLength(0);
    expect(result.soft).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Hard: double_book                                                  */
/* ------------------------------------------------------------------ */

describe("detectConflicts — hard: double_book", () => {
  it("flags double_book when the resource already has an assignment on that date", () => {
    const context = {
      ...CLEAN_CONTEXT,
      existingAssignments: [
        makeAssignment({ id: "a-existing", resourceName: "Joe Lynch", date: "2026-07-01" }),
      ],
    };
    // We need to supply a resource id → name mapping or the assignment itself identifies the resource
    // The detectConflicts function receives resourceId; the assignment must carry that resource id
    // Per the spec, assignment doesn't have resourceId but has resourceName. The caller must pass
    // existingAssignments already filtered to the target resource.
    // Test: resource already has one assignment on the date → double_book.
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.ok).toBe(false);
    const flag = result.hard.find((f) => f.kind === "double_book");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("hard");
  });

  it("does NOT flag double_book when the existing assignment is on a different date", () => {
    const context = {
      ...CLEAN_CONTEXT,
      existingAssignments: [
        makeAssignment({ date: "2026-07-02" }), // different date
      ],
    };
    const result = detectConflicts(BASE_PARAMS, context);
    const flag = result.hard.find((f) => f.kind === "double_book");
    expect(flag).toBeUndefined();
  });

  it("does NOT flag double_book for an assignment in a different location only (same date)", () => {
    // existingAssignments already pre-filtered to the resource in question;
    // any assignment on the same date is a conflict regardless of location.
    const context = {
      ...CLEAN_CONTEXT,
      existingAssignments: [
        makeAssignment({ date: "2026-07-01", location: "Centennial" }),
      ],
    };
    // Still a double-book: same resource, same date, different location is still overbooked
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.hard.find((f) => f.kind === "double_book")).toBeDefined();
  });

  it("flags double_book even when the conflicting assignment is from a different workItemId", () => {
    const context = {
      ...CLEAN_CONTEXT,
      existingAssignments: [
        makeAssignment({ date: "2026-07-01", workItemId: "wi-other" }),
      ],
    };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.hard.find((f) => f.kind === "double_book")).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Hard: weekend_holiday                                              */
/* ------------------------------------------------------------------ */

describe("detectConflicts — hard: weekend_holiday", () => {
  it("flags weekend_holiday when isHolidayOrWeekend is true", () => {
    const context = { ...CLEAN_CONTEXT, isHolidayOrWeekend: true };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.ok).toBe(false);
    const flag = result.hard.find((f) => f.kind === "weekend_holiday");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("hard");
  });

  it("does NOT flag weekend_holiday when isHolidayOrWeekend is false", () => {
    const result = detectConflicts(BASE_PARAMS, CLEAN_CONTEXT);
    expect(result.hard.find((f) => f.kind === "weekend_holiday")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Hard: lead_time                                                    */
/* ------------------------------------------------------------------ */

describe("detectConflicts — hard: lead_time", () => {
  it("flags lead_time when leadTimeError is non-null", () => {
    const context = { ...CLEAN_CONTEXT, leadTimeError: "Must schedule at least 2 days out" };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.ok).toBe(false);
    const flag = result.hard.find((f) => f.kind === "lead_time");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("hard");
    expect(flag?.message).toContain("Must schedule at least 2 days out");
  });

  it("does NOT flag lead_time when leadTimeError is null", () => {
    const result = detectConflicts(BASE_PARAMS, CLEAN_CONTEXT);
    expect(result.hard.find((f) => f.kind === "lead_time")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Soft: over_capacity                                                */
/* ------------------------------------------------------------------ */

describe("detectConflicts — soft: over_capacity", () => {
  it("flags over_capacity when adding this job pushes load above capacity", () => {
    // Current load=2, capacity=2 → adding 1 more job (load becomes 3) → over_capacity
    const context = {
      ...CLEAN_CONTEXT,
      capacityCells: [
        makeCapacityCell({ location: "Westminster", date: "2026-07-01", loadDays: 2, capacityDays: 2 }),
      ],
    };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.ok).toBe(true); // soft only — ok is still true (no hard flags)
    const flag = result.soft.find((f) => f.kind === "over_capacity");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("soft");
  });

  it("does NOT flag over_capacity when load + 1 ≤ capacity", () => {
    // Current load=1, capacity=2 → load+1=2 ≤ 2 → no over_capacity
    const context = {
      ...CLEAN_CONTEXT,
      capacityCells: [
        makeCapacityCell({ location: "Westminster", date: "2026-07-01", loadDays: 1, capacityDays: 2 }),
      ],
    };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.soft.find((f) => f.kind === "over_capacity")).toBeUndefined();
  });

  it("does NOT flag over_capacity when no matching capacity cell is found", () => {
    // Missing cell for this location/date → conservative: don't flag
    const context = { ...CLEAN_CONTEXT, capacityCells: [] };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.soft.find((f) => f.kind === "over_capacity")).toBeUndefined();
  });

  it("does NOT flag over_capacity for a cell at a different location", () => {
    const context = {
      ...CLEAN_CONTEXT,
      capacityCells: [
        makeCapacityCell({ location: "Centennial", date: "2026-07-01", loadDays: 99, capacityDays: 1 }),
      ],
    };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.soft.find((f) => f.kind === "over_capacity")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Soft: travel                                                       */
/* ------------------------------------------------------------------ */

describe("detectConflicts — soft: travel", () => {
  it("flags travel (soft) when travel.infeasible is true", () => {
    const context = { ...CLEAN_CONTEXT, travel: { infeasible: true, minutes: 120 } };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.ok).toBe(true); // soft only
    const flag = result.soft.find((f) => f.kind === "travel");
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("soft");
  });

  it("does NOT flag travel when travel.infeasible is false", () => {
    const context = { ...CLEAN_CONTEXT, travel: { infeasible: false, minutes: 30 } };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.soft.find((f) => f.kind === "travel")).toBeUndefined();
  });

  it("does NOT flag travel when no travel context is provided", () => {
    const result = detectConflicts(BASE_PARAMS, CLEAN_CONTEXT);
    expect(result.soft.find((f) => f.kind === "travel")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  ok semantics                                                       */
/* ------------------------------------------------------------------ */

describe("detectConflicts — ok field semantics", () => {
  it("ok:true when only soft flags are present", () => {
    const context = {
      ...CLEAN_CONTEXT,
      travel: { infeasible: true },
      capacityCells: [
        makeCapacityCell({ location: "Westminster", date: "2026-07-01", loadDays: 2, capacityDays: 2 }),
      ],
    };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.ok).toBe(true);
    expect(result.soft.length).toBeGreaterThan(0);
    expect(result.hard.length).toBe(0);
  });

  it("ok:false when any hard flag is present", () => {
    const context = { ...CLEAN_CONTEXT, isHolidayOrWeekend: true };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.ok).toBe(false);
  });

  it("accumulates multiple hard flags independently", () => {
    const context = {
      existingAssignments: [makeAssignment({ date: "2026-07-01" })],
      capacityCells: [],
      isHolidayOrWeekend: true,
      leadTimeError: "Too soon",
    };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.ok).toBe(false);
    const kinds = result.hard.map((f) => f.kind);
    expect(kinds).toContain("double_book");
    expect(kinds).toContain("weekend_holiday");
    expect(kinds).toContain("lead_time");
  });

  it("accumulates both hard and soft flags simultaneously", () => {
    const context = {
      existingAssignments: [makeAssignment({ date: "2026-07-01" })],
      capacityCells: [
        makeCapacityCell({ location: "Westminster", date: "2026-07-01", loadDays: 2, capacityDays: 2 }),
      ],
      isHolidayOrWeekend: false,
      leadTimeError: null,
      travel: { infeasible: true },
    };
    const result = detectConflicts(BASE_PARAMS, context);
    expect(result.ok).toBe(false); // has a hard flag
    expect(result.hard.find((f) => f.kind === "double_book")).toBeDefined();
    expect(result.soft.find((f) => f.kind === "over_capacity")).toBeDefined();
    expect(result.soft.find((f) => f.kind === "travel")).toBeDefined();
  });
});
