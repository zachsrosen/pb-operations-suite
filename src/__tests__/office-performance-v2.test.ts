jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/hubspot", () => ({ fetchAllProjects: jest.fn() }));

import { buildPipelineData, buildDealRows, buildComplianceData } from "@/lib/office-performance";
import type { ComplianceCachedJob } from "@/lib/office-performance";
import type { OfficeMetricName } from "@/lib/office-performance-types";

const DEFAULT_GOALS: Record<OfficeMetricName, number> = {
  projects_completed: 15,
  surveys_completed: 25,
  installs_completed: 12,
  inspections_completed: 10,
};

describe("buildPipelineData — deals and no leaderboards", () => {
  const now = new Date("2026-04-07T12:00:00Z");

  it("returns deals array with totalCount instead of leaderboards", () => {
    const projects = [
      { id: 1, name: "Smith 10.2kW", stage: "Install", daysSinceStageMovement: 14 },
      { id: 2, name: "Jones Residential", stage: "Survey", daysSinceStageMovement: 9 },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect((result as unknown as Record<string, unknown>).pmLeaderboard).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).designerLeaderboard).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).ownerLeaderboard).toBeUndefined();
    expect(result.deals).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.deals[0].name).toBe("Smith 10.2kW");
  });

  it("does not include PM milestone achievements in recentWins", () => {
    const projects = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, name: `Project ${i + 1}`, stage: "PTO", projectManager: "Sarah",
      ptoGrantedDate: `2026-04-0${i + 2}`,
    }));
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    const hasPmAchievement = result.recentWins.some((w: string) => w.includes("Sarah"));
    expect(hasPmAchievement).toBe(false);
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

  it("rejects first-name-only when one side has no last name (ambiguous)", () => {
    // "Mike" alone is too ambiguous — could match Mike Smith or Mike Rodriguez
    expect(nameMatchesLoosely("Mike", "Mike Smith")).toBe(false);
    expect(nameMatchesLoosely("Mike", "Mike Rodriguez")).toBe(false);
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

  it("handles out-of-order month keys correctly", () => {
    const { buildLeaderboard } = require("@/lib/office-performance");
    const users = [
      { name: "Alice", userUid: "a", count: 10 },
      { name: "Bob", userUid: "b", count: 5 },
    ];
    // Insert months in non-chronological order to verify explicit sorting
    const history = new Map([
      ["2026-03", [{ name: "Alice", userUid: "a", count: 9 }, { name: "Bob", userUid: "b", count: 6 }]],
      ["2026-01", [{ name: "Alice", userUid: "a", count: 8 }, { name: "Bob", userUid: "b", count: 3 }]],
      ["2026-02", [{ name: "Alice", userUid: "a", count: 12 }, { name: "Bob", userUid: "b", count: 4 }]],
    ]);
    const result = buildLeaderboard(users, history);
    expect(result[0].name).toBe("Alice");
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


describe("buildDealRows", () => {
  const now = new Date("2026-04-07T12:00:00Z");

  it("sorts overdue projects first by daysOverdue desc, then non-overdue by daysInStage desc", () => {
    const projects = [
      { id: 1, name: "Alpha", stage: "Install", daysSinceStageMovement: 20, forecastedInstallDate: "2026-04-10" },
      { id: 2, name: "Beta", stage: "Inspect", daysSinceStageMovement: 5, forecastedInstallDate: "2026-03-30", constructionCompleteDate: "2026-03-28", forecastedInspectionDate: "2026-03-30" },
      { id: 3, name: "Gamma", stage: "Install", daysSinceStageMovement: 3, forecastedInstallDate: "2026-03-25" },
      { id: 4, name: "Delta", stage: "Survey", daysSinceStageMovement: 10 },
    ];
    const result = buildDealRows(projects, now);
    expect(result.deals.map((d) => d.name)).toEqual(["Gamma", "Beta", "Alpha", "Delta"]);
    expect(result.deals[0].overdue).toBe(true);
    expect(result.deals[0].daysOverdue).toBe(13);
    expect(result.deals[1].overdue).toBe(true);
    expect(result.deals[1].daysOverdue).toBe(8);
    expect(result.deals[2].overdue).toBe(false);
    expect(result.deals[3].overdue).toBe(false);
    expect(result.totalCount).toBe(4);
  });

  it("caps at 12 rows and includes totalCount", () => {
    const projects = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Project ${i + 1}`, stage: "Design", daysSinceStageMovement: 20 - i }));
    const result = buildDealRows(projects, now);
    expect(result.deals).toHaveLength(12);
    expect(result.totalCount).toBe(20);
  });

  it("handles missing daysSinceStageMovement as 0", () => {
    const projects = [{ id: 1, name: "NoDays", stage: "Survey" }];
    const result = buildDealRows(projects, now);
    expect(result.deals[0].daysInStage).toBe(0);
    expect(result.deals[0].daysOverdue).toBe(0);
  });

  it("skips completed forecasts when calculating overdue", () => {
    const projects = [{ id: 1, name: "CompletedInstall", stage: "Inspect", daysSinceStageMovement: 5, forecastedInstallDate: "2026-03-01", constructionCompleteDate: "2026-03-05" }];
    const result = buildDealRows(projects, now);
    expect(result.deals[0].overdue).toBe(false);
  });

  it("uses earliest unmet forecasted date for daysOverdue", () => {
    const projects = [{ id: 1, name: "MultiOverdue", stage: "Install", daysSinceStageMovement: 5, forecastedInstallDate: "2026-03-20", forecastedInspectionDate: "2026-04-01" }];
    const result = buildDealRows(projects, now);
    expect(result.deals[0].overdue).toBe(true);
    expect(result.deals[0].daysOverdue).toBe(18);
  });
});

describe("buildComplianceData", () => {
  const now = new Date("2026-04-07T12:00:00Z");

  function makeJob(overrides: Partial<ComplianceCachedJob>): ComplianceCachedJob {
    return {
      jobUid: "j1",
      jobCategory: "Construction",
      jobStatus: "completed",
      completedDate: new Date("2026-04-05"),
      scheduledStart: new Date("2026-04-01"),
      scheduledEnd: new Date("2026-04-04"),
      assignedUsers: [],
      hubspotDealId: "100",
      jobTitle: "Job 1",
      projectName: "Project Alpha",
      ...overrides,
    };
  }

  it("calculates on-time percentage correctly", () => {
    const jobs = [
      makeJob({ jobUid: "j1", completedDate: new Date("2026-04-03"), scheduledEnd: new Date("2026-04-04") }), // on-time
      makeJob({ jobUid: "j2", completedDate: new Date("2026-04-06"), scheduledEnd: new Date("2026-04-04") }), // late
      makeJob({ jobUid: "j3", completedDate: new Date("2026-04-05"), scheduledEnd: new Date("2026-04-04") }), // within 1-day grace
    ];
    const result = buildComplianceData(jobs, now);
    expect(result).not.toBeNull();
    expect(result!.onTimePercent).toBe(67); // 2 of 3
  });

  it("returns -1 onTimePercent when no measurable completed jobs", () => {
    const jobs = [
      makeJob({ jobUid: "j1", jobStatus: "started", completedDate: null, scheduledEnd: null }),
    ];
    const result = buildComplianceData(jobs, now);
    expect(result).not.toBeNull();
    expect(result!.onTimePercent).toBe(-1);
  });

  it("detects stuck jobs", () => {
    const jobs = [
      makeJob({
        jobUid: "j1",
        jobStatus: "started",
        completedDate: null,
        scheduledStart: new Date("2026-04-04"),
        scheduledEnd: new Date("2026-04-05"),
      }),
    ];
    const result = buildComplianceData(jobs, now);
    expect(result).not.toBeNull();
    expect(result!.stuckJobs).toHaveLength(1);
    expect(result!.stuckJobs[0].name).toBe("Project Alpha");
  });

  it("counts never-started jobs past their scheduledStart", () => {
    const jobs = [
      makeJob({
        jobUid: "j1",
        jobStatus: "scheduled",
        completedDate: null,
        scheduledStart: new Date("2026-04-01"),
      }),
    ];
    const result = buildComplianceData(jobs, now);
    expect(result).not.toBeNull();
    expect(result!.neverStartedCount).toBe(1);
  });

  it("returns null for empty jobs array", () => {
    const result = buildComplianceData([], now);
    expect(result).toBeNull();
  });

  it("normalizes job status case for matching", () => {
    const jobs = [
      makeJob({
        jobUid: "j1",
        jobStatus: "Started",
        completedDate: null,
        scheduledStart: new Date("2026-04-04"),
      }),
    ];
    const result = buildComplianceData(jobs, now);
    expect(result!.stuckJobs).toHaveLength(1);
  });

  it("excludes jobs completed before the current month from on-time calculation", () => {
    const jobs = [
      // Completed in March (prior month) — should be excluded from on-time
      makeJob({
        jobUid: "j-old",
        jobStatus: "completed",
        completedDate: new Date("2026-03-15"),
        scheduledEnd: new Date("2026-03-10"), // late, but irrelevant
      }),
      // Completed in April (current month) — on-time
      makeJob({
        jobUid: "j-current",
        jobStatus: "completed",
        completedDate: new Date("2026-04-03"),
        scheduledEnd: new Date("2026-04-03"),
      }),
    ];
    const result = buildComplianceData(jobs, now);
    // Only the April job counts: 1/1 = 100%
    expect(result!.onTimePercent).toBe(100);
  });

  it("respects stuck threshold — jobs stuck less than 1 day are not flagged", () => {
    const jobs = [
      makeJob({
        jobUid: "j1",
        jobStatus: "started",
        completedDate: null,
        scheduledStart: new Date("2026-04-07T06:00:00Z"), // only 6 hours ago
      }),
    ];
    const result = buildComplianceData(jobs, now);
    expect(result!.stuckJobs).toHaveLength(0);
  });
});
