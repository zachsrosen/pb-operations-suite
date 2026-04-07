// Mock Prisma client to avoid import.meta issues in Jest
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/hubspot", () => ({ fetchAllProjects: jest.fn() }));

import { buildPipelineData, buildLeaderboard } from "@/lib/office-performance";
import type { OfficeMetricName } from "@/lib/office-performance-types";

const DEFAULT_GOALS: Record<OfficeMetricName, number> = {
  projects_completed: 15,
  surveys_completed: 25,
  installs_completed: 12,
  inspections_completed: 10,
};

describe("buildPipelineData", () => {
  const now = new Date("2026-04-07T12:00:00Z");

  it("counts active projects", () => {
    const projects = [
      { stage: "Design", pbLocation: "Westminster" },
      { stage: "Install", pbLocation: "Westminster" },
      { stage: "RTB", pbLocation: "Westminster" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.activeProjects).toBe(3);
  });

  it("counts MTD completions from ptoGrantedDate", () => {
    const projects = [
      { stage: "PTO", ptoGrantedDate: "2026-04-03" },
      { stage: "PTO", ptoGrantedDate: "2026-03-28" }, // Last month — not MTD
      { stage: "Design" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.completedMtd).toBe(1);
  });

  it("builds stage distribution in correct order", () => {
    const projects = [
      { stage: "survey" },
      { stage: "design" },
      { stage: "design" },
      { stage: "construction" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.stageDistribution[0]).toEqual({ stage: "Survey", count: 1 });
    expect(result.stageDistribution[1]).toEqual({ stage: "Design", count: 2 });
    expect(result.stageDistribution[4]).toEqual({ stage: "Install", count: 1 });
  });

  it("counts overdue projects based on forecasted dates", () => {
    const projects = [
      { stage: "Install", forecastedInstallDate: "2026-04-01" }, // Past = overdue
      { stage: "Inspect", forecastedInspectionDate: "2026-04-10" }, // Future = not overdue
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.overdueCount).toBe(1);
  });

  it("sets completedGoal from goals", () => {
    const result = buildPipelineData([], { ...DEFAULT_GOALS, projects_completed: 20 }, now);
    expect(result.completedGoal).toBe(20);
  });

  it("includes recent wins for PTOs this week", () => {
    const projects = [
      { stage: "PTO", ptoGrantedDate: "2026-04-05" },
      { stage: "PTO", ptoGrantedDate: "2026-04-06" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.recentWins).toContainEqual(expect.stringContaining("2 PTOs granted this week"));
  });

  it("handles empty project list", () => {
    const result = buildPipelineData([], DEFAULT_GOALS, now);
    expect(result.activeProjects).toBe(0);
    expect(result.completedMtd).toBe(0);
    expect(result.overdueCount).toBe(0);
    expect(result.stageDistribution.every((s) => s.count === 0)).toBe(true);
  });
});

describe("buildLeaderboard", () => {
  it("sorts by count descending", () => {
    const users = [
      { name: "Alice", userUid: "a", count: 3 },
      { name: "Bob", userUid: "b", count: 7 },
      { name: "Carol", userUid: "c", count: 5 },
    ];
    const result = buildLeaderboard(users);
    expect(result[0].name).toBe("Bob");
    expect(result[1].name).toBe("Carol");
    expect(result[2].name).toBe("Alice");
  });

  it("returns empty array for no users", () => {
    expect(buildLeaderboard([])).toEqual([]);
  });

  it("handles single user", () => {
    const users = [{ name: "Solo", userUid: "s", count: 10 }];
    const result = buildLeaderboard(users);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Solo");
    expect(result[0].count).toBe(10);
  });
});
