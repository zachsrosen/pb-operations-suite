/**
 * Tests for scheduler-v2 capacity computation.
 * Exercises computeCapacityCells from scheduler-v2/capacity.ts.
 *
 * Capacity blend rule (phase 1):
 *   capacityDays = DEFAULT_LOCATION_CAPACITY[location] (the floor / default).
 *   If Resource[] are provided for that location, capacityDays = sum of their
 *   capacityPerDay values (one row per crew member). This lets locations with
 *   multiple configured crew members report higher capacity than the default.
 *   The DEFAULT_LOCATION_CAPACITY is always used when no Resource matches the
 *   location, ensuring we never report 0 capacity for a location that exists.
 */
import { computeCapacityCells } from "@/lib/scheduler-v2/capacity";
import { capacityColor } from "@/lib/scheduler-v2/colors";
import type { Assignment, Resource } from "@/lib/scheduler-v2/types";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeAssignment(overrides: Partial<Assignment> & { location: string; date: string }): Assignment {
  return {
    id: `a-${Math.random()}`,
    source: "schedule_record",
    resourceName: "Joe Lynch",
    startTime: null,
    endTime: null,
    workType: "install",
    workItemId: "wi-1",
    projectId: "p-1",
    projectName: "Test Project",
    value: null,
    status: "scheduled",
    ...overrides,
  } as Assignment;
}

function makeResource(overrides: Partial<Resource> & { primaryLocation: string }): Resource {
  return {
    id: `r-${Math.random()}`,
    name: "Crew Member",
    kind: "crew",
    color: "#3b82f6",
    capacityPerDay: 1,
    assignable: true,
    locations: [overrides.primaryLocation],
    ...overrides,
  } as Resource;
}

/* ------------------------------------------------------------------ */
/*  computeCapacityCells — basic cell generation                       */
/* ------------------------------------------------------------------ */

describe("computeCapacityCells", () => {
  const dateRange = { start: "2026-06-29", end: "2026-07-03" }; // Mon-Fri (5 days)
  const locations = ["Westminster"];

  it("returns one cell per location per date in range", () => {
    const cells = computeCapacityCells([], [], locations, dateRange);
    expect(cells.length).toBe(5); // 5 days × 1 location
    expect(cells.every((c) => c.location === "Westminster")).toBe(true);
    const dates = cells.map((c) => c.date);
    expect(dates).toContain("2026-06-29");
    expect(dates).toContain("2026-07-01");
    expect(dates).toContain("2026-07-03");
  });

  it("spans multiple locations", () => {
    const cells = computeCapacityCells(
      [],
      [],
      ["Westminster", "Pueblo"],
      { start: "2026-06-29", end: "2026-06-29" }
    );
    expect(cells.length).toBe(2);
    const locs = cells.map((c) => c.location);
    expect(locs).toContain("Westminster");
    expect(locs).toContain("Pueblo");
  });

  /* ---------------------------------------------------------------- */
  /*  loadDays                                                         */
  /* ---------------------------------------------------------------- */

  it("loadDays = 0 when no assignments exist", () => {
    const cells = computeCapacityCells([], [], locations, { start: "2026-06-29", end: "2026-06-29" });
    expect(cells[0].loadDays).toBe(0);
  });

  it("sums assignment install-days by location+date", () => {
    const assignments: Assignment[] = [
      makeAssignment({ location: "Westminster", date: "2026-06-29" }),
      makeAssignment({ location: "Westminster", date: "2026-06-29" }),
      makeAssignment({ location: "Westminster", date: "2026-06-30" }),
    ];
    const cells = computeCapacityCells(assignments, [], locations, dateRange);
    const jun29 = cells.find((c) => c.date === "2026-06-29")!;
    const jun30 = cells.find((c) => c.date === "2026-06-30")!;
    expect(jun29.loadDays).toBe(2);
    expect(jun30.loadDays).toBe(1);
  });

  it("does NOT count assignments for a different location", () => {
    const assignments: Assignment[] = [
      makeAssignment({ location: "Centennial", date: "2026-06-29" }),
    ];
    const cells = computeCapacityCells(assignments, [], ["Westminster"], dateRange);
    const cell = cells.find((c) => c.date === "2026-06-29")!;
    expect(cell.loadDays).toBe(0);
  });

  it("ignores assignments outside the date range", () => {
    const assignments: Assignment[] = [
      makeAssignment({ location: "Westminster", date: "2026-06-28" }), // before range
      makeAssignment({ location: "Westminster", date: "2026-07-04" }), // after range
    ];
    const cells = computeCapacityCells(assignments, [], locations, dateRange);
    const total = cells.reduce((s, c) => s + c.loadDays, 0);
    expect(total).toBe(0);
  });

  /* ---------------------------------------------------------------- */
  /*  capacityDays — default (no resources)                            */
  /* ---------------------------------------------------------------- */

  it("uses DEFAULT_LOCATION_CAPACITY when no resources are supplied", () => {
    // Westminster default = 2
    const cells = computeCapacityCells([], [], ["Westminster"], { start: "2026-06-29", end: "2026-06-29" });
    expect(cells[0].capacityDays).toBe(2);
  });

  it("defaults to 1 for a location not in DEFAULT_LOCATION_CAPACITY", () => {
    const cells = computeCapacityCells([], [], ["DTC"], { start: "2026-06-29", end: "2026-06-29" });
    // DTC not in DEFAULT_LOCATION_CAPACITY → fallback 1
    expect(cells[0].capacityDays).toBe(1);
  });

  it("uses Pueblo default capacity of 1", () => {
    const cells = computeCapacityCells([], [], ["Pueblo"], { start: "2026-06-29", end: "2026-06-29" });
    expect(cells[0].capacityDays).toBe(1);
  });

  /* ---------------------------------------------------------------- */
  /*  capacityDays — resource-aware blend                             */
  /* ---------------------------------------------------------------- */

  it("sums Resource.capacityPerDay for the location when resources are present", () => {
    const resources: Resource[] = [
      makeResource({ primaryLocation: "Westminster", capacityPerDay: 2 }),
      makeResource({ primaryLocation: "Westminster", capacityPerDay: 1 }),
    ];
    const cells = computeCapacityCells([], resources, ["Westminster"], { start: "2026-06-29", end: "2026-06-29" });
    expect(cells[0].capacityDays).toBe(3); // 2 + 1
  });

  it("falls back to DEFAULT_LOCATION_CAPACITY when no resource matches the location", () => {
    const resources: Resource[] = [
      makeResource({ primaryLocation: "Centennial", capacityPerDay: 5 }),
    ];
    // Westminster has no matching resource → falls back to default (2)
    const cells = computeCapacityCells([], resources, ["Westminster"], { start: "2026-06-29", end: "2026-06-29" });
    expect(cells[0].capacityDays).toBe(2);
  });

  it("only counts assignable resources toward capacity", () => {
    const resources: Resource[] = [
      makeResource({ primaryLocation: "Westminster", capacityPerDay: 2, assignable: true }),
      makeResource({ primaryLocation: "Westminster", capacityPerDay: 1, assignable: false }),
    ];
    const cells = computeCapacityCells([], resources, ["Westminster"], { start: "2026-06-29", end: "2026-06-29" });
    // Only the assignable crew member counts
    expect(cells[0].capacityDays).toBe(2);
  });

  /* ---------------------------------------------------------------- */
  /*  Over-capacity scenario (the canonical 3-load / 2-capacity test) */
  /* ---------------------------------------------------------------- */

  it("reports loadDays > capacityDays when location is overloaded", () => {
    // Westminster default capacity = 2; add 3 assignments for the same day
    const assignments: Assignment[] = [
      makeAssignment({ location: "Westminster", date: "2026-06-29" }),
      makeAssignment({ location: "Westminster", date: "2026-06-29" }),
      makeAssignment({ location: "Westminster", date: "2026-06-29" }),
    ];
    const cells = computeCapacityCells(assignments, [], ["Westminster"], { start: "2026-06-29", end: "2026-06-29" });
    const cell = cells[0];
    expect(cell.loadDays).toBe(3);
    expect(cell.capacityDays).toBe(2);
    expect(cell.loadDays).toBeGreaterThan(cell.capacityDays);
  });

  /* ---------------------------------------------------------------- */
  /*  capacityColor integration                                        */
  /* ---------------------------------------------------------------- */

  it("over-capacity cell returns a non-green capacityColor", () => {
    // loadDays=3, capacityDays=2 → utilization=150% → red
    const cells = computeCapacityCells(
      [
        makeAssignment({ location: "Westminster", date: "2026-06-29" }),
        makeAssignment({ location: "Westminster", date: "2026-06-29" }),
        makeAssignment({ location: "Westminster", date: "2026-06-29" }),
      ],
      [],
      ["Westminster"],
      { start: "2026-06-29", end: "2026-06-29" }
    );
    const cell = cells[0];
    const util = (cell.loadDays / cell.capacityDays) * 100;
    // 150% → red zone (>120)
    expect(capacityColor(util)).toContain("red");
  });

  it("at-capacity cell (100%) returns yellow capacityColor", () => {
    // loadDays=2, capacityDays=2 → utilization=100% → yellow
    const cells = computeCapacityCells(
      [
        makeAssignment({ location: "Westminster", date: "2026-06-29" }),
        makeAssignment({ location: "Westminster", date: "2026-06-29" }),
      ],
      [],
      ["Westminster"],
      { start: "2026-06-29", end: "2026-06-29" }
    );
    const cell = cells[0];
    const util = (cell.loadDays / cell.capacityDays) * 100;
    expect(capacityColor(util)).toContain("yellow");
  });

  it("under-capacity cell returns green capacityColor", () => {
    // loadDays=1, capacityDays=2 → utilization=50% → green
    const cells = computeCapacityCells(
      [makeAssignment({ location: "Westminster", date: "2026-06-29" })],
      [],
      ["Westminster"],
      { start: "2026-06-29", end: "2026-06-29" }
    );
    const cell = cells[0];
    const util = (cell.loadDays / cell.capacityDays) * 100;
    expect(capacityColor(util)).toContain("emerald");
  });

  /* ---------------------------------------------------------------- */
  /*  Single-day range edge case                                       */
  /* ---------------------------------------------------------------- */

  it("handles start === end (single day)", () => {
    const cells = computeCapacityCells([], [], ["Westminster"], { start: "2026-06-29", end: "2026-06-29" });
    expect(cells.length).toBe(1);
    expect(cells[0].date).toBe("2026-06-29");
  });
});
