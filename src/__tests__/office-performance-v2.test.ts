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

import { nameMatchesLoosely } from "@/lib/office-performance";

describe("nameMatchesLoosely", () => {
  it("matches exact names", () => {
    expect(nameMatchesLoosely("Mike Smith", "Mike Smith")).toBe(true);
  });

  it("matches normalized names (case, punctuation)", () => {
    expect(nameMatchesLoosely("mike smith", "Mike Smith")).toBe(true);
    expect(nameMatchesLoosely("Mike S.", "Mike S")).toBe(true);
  });

  it("matches first name + last initial to full name", () => {
    expect(nameMatchesLoosely("Mike S", "Mike Smith")).toBe(true);
    expect(nameMatchesLoosely("Mike Smith", "Mike S")).toBe(true);
  });

  it("rejects different last initials", () => {
    expect(nameMatchesLoosely("Mike S", "Mike Rodriguez")).toBe(false);
  });

  it("rejects completely different names", () => {
    expect(nameMatchesLoosely("Alice Johnson", "Bob Smith")).toBe(false);
  });

  it("rejects short first-name-only matches (≤2 chars)", () => {
    expect(nameMatchesLoosely("Al", "Al")).toBe(true);
    expect(nameMatchesLoosely("Al Smith", "Al Jones")).toBe(false);
  });

  it("accepts first-name-only when one side has no last name", () => {
    expect(nameMatchesLoosely("Mike", "Mike Smith")).toBe(true);
  });
});

describe("EnrichedPersonStat type", () => {
  it("extends PersonStat with avgTurnaround", () => {
    const stat: import("@/lib/office-performance-types").EnrichedPersonStat = {
      name: "Mike",
      count: 5,
      avgTurnaround: 3.2,
    };
    expect(stat.avgTurnaround).toBe(3.2);
  });
});

describe("InspectionPersonStat enrichment", () => {
  it("InspectionPersonStat supports passRate and consecutivePasses", () => {
    const stat: import("@/lib/office-performance-types").InspectionPersonStat = {
      name: "Jake",
      count: 8,
      passRate: 87.5,
      consecutivePasses: 5,
    };
    expect(stat.passRate).toBe(87.5);
    expect(stat.consecutivePasses).toBe(5);
  });
});

describe("buildLeaderboard with monthlyHistory", () => {
  it("detects a 3-month leader streak", () => {
    const { buildLeaderboard } = require("@/lib/office-performance");
    const users = [
      { name: "Alice", userUid: "a", count: 10 },
      { name: "Bob", userUid: "b", count: 5 },
    ];
    const history = new Map([
      ["2026-01", [{ name: "Alice", userUid: "a", count: 8 }, { name: "Bob", userUid: "b", count: 3 }]],
      ["2026-02", [{ name: "Alice", userUid: "a", count: 12 }, { name: "Bob", userUid: "b", count: 4 }]],
      ["2026-03", [{ name: "Alice", userUid: "a", count: 9 }, { name: "Bob", userUid: "b", count: 6 }]],
    ]);
    const result = buildLeaderboard(users, history);
    expect(result[0].name).toBe("Alice");
    expect(result[0].streak).toBeDefined();
    expect(result[0].streak?.value).toBe(3);
  });

  it("does not assign streak when leader changed", () => {
    const { buildLeaderboard } = require("@/lib/office-performance");
    const users = [
      { name: "Alice", userUid: "a", count: 10 },
      { name: "Bob", userUid: "b", count: 5 },
    ];
    const history = new Map([
      ["2026-01", [{ name: "Bob", userUid: "b", count: 8 }, { name: "Alice", userUid: "a", count: 3 }]],
      ["2026-02", [{ name: "Alice", userUid: "a", count: 12 }, { name: "Bob", userUid: "b", count: 4 }]],
      ["2026-03", [{ name: "Alice", userUid: "a", count: 9 }, { name: "Bob", userUid: "b", count: 6 }]],
    ]);
    const result = buildLeaderboard(users, history);
    expect(result[0].streak?.value).toBe(2);
  });
});

describe("individual achievements", () => {
  it("adds PM milestone to recent wins", () => {
    const projects = Array.from({ length: 5 }, (_, i) => ({
      stage: "PTO",
      projectManager: "Sarah",
      ptoGrantedDate: `2026-04-0${i + 2}`,
    }));
    const result = buildPipelineData(projects, DEFAULT_GOALS, new Date("2026-04-07T12:00:00Z"));
    const hasAchievement = result.recentWins.some((w: string) => w.includes("Sarah"));
    expect(hasAchievement).toBe(true);
  });
});
