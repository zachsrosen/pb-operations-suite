jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/hubspot", () => ({ fetchAllProjects: jest.fn() }));

import { buildPipelineData } from "@/lib/office-performance";
import type { OfficeMetricName } from "@/lib/office-performance-types";

const DEFAULT_GOALS: Record<OfficeMetricName, number> = {
  projects_completed: 15,
  surveys_completed: 25,
  installs_completed: 12,
  inspections_completed: 10,
};

describe("buildPipelineData — employee breakdowns", () => {
  const now = new Date("2026-04-07T12:00:00Z");

  it("builds PM leaderboard sorted by active project count", () => {
    const projects = [
      { stage: "Design", projectManager: "Alice" },
      { stage: "Install", projectManager: "Alice" },
      { stage: "RTB", projectManager: "Bob" },
      { stage: "Design", projectManager: "Alice" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.pmLeaderboard![0].name).toBe("Alice");
    expect(result.pmLeaderboard![0].activeCount).toBe(3);
    expect(result.pmLeaderboard![1].name).toBe("Bob");
    expect(result.pmLeaderboard![1].activeCount).toBe(1);
  });

  it("counts MTD completions per PM", () => {
    const projects = [
      { stage: "PTO", projectManager: "Alice", ptoGrantedDate: "2026-04-03" },
      { stage: "PTO", projectManager: "Alice", ptoGrantedDate: "2026-03-28" },
      { stage: "PTO", projectManager: "Bob", ptoGrantedDate: "2026-04-05" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    const alice = result.pmLeaderboard!.find((p) => p.name === "Alice");
    expect(alice?.completedMtd).toBe(1);
  });

  it("builds designer leaderboard from designLead field", () => {
    const projects = [
      { stage: "Design", designLead: "Carol" },
      { stage: "Design", designLead: "Carol" },
      { stage: "Permit", designLead: "Dave" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.designerLeaderboard![0].name).toBe("Carol");
    expect(result.designerLeaderboard![0].activeCount).toBe(2);
  });

  it("builds deal owner leaderboard from dealOwner field", () => {
    const projects = [
      { stage: "Survey", dealOwner: "Eve" },
      { stage: "Design", dealOwner: "Eve" },
      { stage: "RTB", dealOwner: "Frank" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.ownerLeaderboard![0].name).toBe("Eve");
    expect(result.ownerLeaderboard![0].activeCount).toBe(2);
  });

  it("skips empty/null person fields", () => {
    const projects = [
      { stage: "Design", projectManager: "" },
      { stage: "Design", projectManager: null },
      { stage: "Design" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.pmLeaderboard!).toHaveLength(0);
  });

  it("computes avg days in stage per person", () => {
    const projects = [
      { stage: "Design", projectManager: "Alice", daysSinceStageMovement: 10 },
      { stage: "Install", projectManager: "Alice", daysSinceStageMovement: 4 },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.pmLeaderboard![0].avgDaysInStage).toBe(7);
  });
});
