/**
 * Unit tests for computeLocationCompliance — the shared compliance computation
 * used by the office performance TV dashboard.
 *
 * We mock fetchJobsForCategory to return controlled Zuper API job payloads,
 * and mock getActiveCrewMembers to return an empty array (no crew DB needed).
 */

jest.mock("@/lib/db", () => ({
  prisma: null,
  getActiveCrewMembers: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/zuper", () => ({
  zuper: { isConfigured: () => false, searchJobs: jest.fn() },
  JOB_CATEGORY_UIDS: {
    SITE_SURVEY: "survey-uid",
    CONSTRUCTION: "construction-uid",
    INSPECTION: "inspection-uid",
  },
  JOB_CATEGORIES: {
    SITE_SURVEY: "Site Survey",
    CONSTRUCTION: "Construction",
    INSPECTION: "Inspection",
  },
}));

// Mock fetchJobsForCategory to return controlled jobs
const mockFetchJobsForCategory = jest.fn();
jest.mock("@/lib/compliance-helpers", () => {
  const actual = jest.requireActual("@/lib/compliance-helpers");
  return {
    ...actual,
    fetchJobsForCategory: (...args: unknown[]) => mockFetchJobsForCategory(...args),
  };
});

import { computeLocationCompliance } from "@/lib/compliance-compute";

// ========== Helpers ==========

function makeZuperJob(overrides: Record<string, unknown> = {}) {
  return {
    job_uid: "j1",
    job_title: "Test Job",
    job_category: { category_uid: "construction-uid" },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T08:00:00Z",
    scheduled_end_time: "2026-04-03T17:00:00Z",
    assigned_to: [
      {
        user: {
          user_uid: "u1",
          first_name: "Mike",
          last_name: "Torres",
          is_active: true,
        },
        team: { team_name: "Westminster" },
      },
    ],
    assigned_to_team: [
      { team: { team_uid: "t1", team_name: "Westminster" } },
    ],
    job_status: [
      {
        status_name: "Completed",
        created_at: "2026-04-03T15:00:00Z",
      },
    ],
    ...overrides,
  };
}

// ========== Tests ==========

describe("computeLocationCompliance", () => {
  beforeEach(() => {
    mockFetchJobsForCategory.mockReset();
  });

  it("returns null for unknown category", async () => {
    const result = await computeLocationCompliance("Unknown Category", "Westminster");
    expect(result).toBeNull();
    expect(mockFetchJobsForCategory).not.toHaveBeenCalled();
  });

  it("returns null when no jobs are fetched", async () => {
    mockFetchJobsForCategory.mockResolvedValue([]);
    const result = await computeLocationCompliance("Construction", "Westminster");
    expect(result).toBeNull();
  });

  it("returns null when no jobs match the location team", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      makeZuperJob({
        assigned_to: [
          {
            user: { user_uid: "u1", first_name: "Alex", last_name: "S", is_active: true },
            team: { team_name: "Colorado Springs" },
          },
        ],
        assigned_to_team: [{ team: { team_uid: "t2", team_name: "Colorado Springs" } }],
      }),
    ]);
    const result = await computeLocationCompliance("Construction", "Westminster");
    expect(result).toBeNull();
  });

  it("calculates on-time percentage with 1-day grace period", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      // On-time: completed before scheduledEnd
      makeZuperJob({
        job_uid: "j1",
        job_status: [{ status_name: "Completed", created_at: "2026-04-02T15:00:00Z" }],
        scheduled_end_time: "2026-04-03T17:00:00Z",
      }),
      // Within grace: completed within 1 day after scheduledEnd
      makeZuperJob({
        job_uid: "j2",
        job_status: [{ status_name: "Completed", created_at: "2026-04-04T10:00:00Z" }],
        scheduled_end_time: "2026-04-03T17:00:00Z",
      }),
      // Late: completed more than 1 day after scheduledEnd
      makeZuperJob({
        job_uid: "j3",
        job_status: [{ status_name: "Completed", created_at: "2026-04-06T12:00:00Z" }],
        scheduled_end_time: "2026-04-03T17:00:00Z",
      }),
    ]);

    const result = await computeLocationCompliance("Construction", "Westminster");
    expect(result).not.toBeNull();
    // 2 on-time (j1, j2 within grace) out of 3 measurable = 67%
    expect(result!.summary.onTimePercent).toBe(67);
    expect(result!.summary.completedJobs).toBe(3);
  });

  it("detects stuck jobs (in-progress past scheduledEnd)", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      makeZuperJob({
        job_uid: "j1",
        current_job_status: { status_name: "Started" },
        scheduled_end_time: "2026-04-01T17:00:00Z", // past
        job_status: [], // no completion
      }),
    ]);

    const result = await computeLocationCompliance("Construction", "Westminster");
    expect(result).not.toBeNull();
    expect(result!.summary.stuckCount).toBe(1);
    expect(result!.stuckJobs).toHaveLength(1);
    expect(result!.stuckJobs[0].assignedUser).toBe("Mike Torres");
  });

  it("detects never-started jobs past scheduledStart", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      makeZuperJob({
        job_uid: "j1",
        current_job_status: { status_name: "Scheduled" },
        scheduled_start_time: "2026-04-01T08:00:00Z", // past
        job_status: [],
      }),
    ]);

    const result = await computeLocationCompliance("Construction", "Westminster");
    expect(result).not.toBeNull();
    expect(result!.summary.neverStartedCount).toBe(1);
  });

  it("computes per-employee compliance scores with Bayesian adjustment", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      // Mike: 1 on-time, 1 stuck
      makeZuperJob({
        job_uid: "j1",
        job_status: [{ status_name: "Completed", created_at: "2026-04-02T15:00:00Z" }],
      }),
      makeZuperJob({
        job_uid: "j2",
        current_job_status: { status_name: "Started" },
        scheduled_end_time: "2026-04-01T17:00:00Z",
        job_status: [],
      }),
      // Sarah: 1 on-time, clean
      makeZuperJob({
        job_uid: "j3",
        assigned_to: [
          {
            user: { user_uid: "u2", first_name: "Sarah", last_name: "Chen", is_active: true },
            team: { team_name: "Westminster" },
          },
        ],
        job_status: [{ status_name: "Completed", created_at: "2026-04-02T15:00:00Z" }],
      }),
    ]);

    const result = await computeLocationCompliance("Construction", "Westminster");
    expect(result).not.toBeNull();
    expect(result!.byEmployee).toHaveLength(2);

    // Both should have grades
    for (const emp of result!.byEmployee) {
      expect(["A", "B", "C", "D", "F"]).toContain(emp.grade);
      expect(emp.complianceScore).toBeGreaterThan(0);
    }

    // Mike has a stuck job so should score lower
    const mike = result!.byEmployee.find((e) => e.name === "Mike Torres")!;
    const sarah = result!.byEmployee.find((e) => e.name === "Sarah Chen")!;
    expect(mike.stuckCount).toBe(1);
    expect(sarah.stuckCount).toBe(0);
    expect(mike.complianceScore).toBeLessThan(sarah.complianceScore);
  });

  it("sorts employees worst-first by compliance score", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      // Late job for user 1
      makeZuperJob({
        job_uid: "j1",
        job_status: [{ status_name: "Completed", created_at: "2026-04-10T15:00:00Z" }],
        scheduled_end_time: "2026-04-03T17:00:00Z",
      }),
      // On-time job for user 2
      makeZuperJob({
        job_uid: "j2",
        assigned_to: [
          {
            user: { user_uid: "u2", first_name: "Good", last_name: "Worker", is_active: true },
            team: { team_name: "Westminster" },
          },
        ],
        job_status: [{ status_name: "Completed", created_at: "2026-04-02T15:00:00Z" }],
      }),
    ]);

    const result = await computeLocationCompliance("Construction", "Westminster");
    expect(result).not.toBeNull();
    // Worst score first
    expect(result!.byEmployee[0].name).toBe("Mike Torres");
    expect(result!.byEmployee[1].name).toBe("Good Worker");
  });

  it("excludes test/demo users from results", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      makeZuperJob({
        job_uid: "j1",
        assigned_to: [
          {
            user: { user_uid: "u-test", first_name: "Patrick", last_name: "Test", is_active: true },
            team: { team_name: "Westminster" },
          },
        ],
      }),
    ]);

    const result = await computeLocationCompliance("Construction", "Westminster");
    // Patrick is excluded by EXCLUDED_USER_NAMES, so no jobs match
    expect(result).toBeNull();
  });

  it("computes OOW on-time percentage", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      // OOW triggered before scheduledStart (on-time)
      makeZuperJob({
        job_uid: "j1",
        scheduled_start_time: "2026-04-02T08:00:00Z",
        job_status: [
          { status_name: "On Our Way", created_at: "2026-04-02T07:30:00Z" },
          { status_name: "Completed", created_at: "2026-04-02T15:00:00Z" },
        ],
      }),
      // OOW triggered after scheduledStart (late)
      makeZuperJob({
        job_uid: "j2",
        scheduled_start_time: "2026-04-03T08:00:00Z",
        job_status: [
          { status_name: "On Our Way", created_at: "2026-04-03T09:00:00Z" },
          { status_name: "Completed", created_at: "2026-04-03T15:00:00Z" },
        ],
      }),
    ]);

    const result = await computeLocationCompliance("Construction", "Westminster");
    expect(result).not.toBeNull();
    // 1 of 2 OOW on-time = 50%
    expect(result!.summary.oowOnTimePercent).toBe(50);
  });

  it("computes average days to complete and average days late", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      // 2 days to complete, 0 days late
      makeZuperJob({
        job_uid: "j1",
        scheduled_start_time: "2026-04-01T08:00:00Z",
        scheduled_end_time: "2026-04-05T17:00:00Z",
        job_status: [{ status_name: "Completed", created_at: "2026-04-03T08:00:00Z" }],
      }),
      // 4 days to complete, 1 day late
      makeZuperJob({
        job_uid: "j2",
        scheduled_start_time: "2026-04-01T08:00:00Z",
        scheduled_end_time: "2026-04-04T08:00:00Z",
        job_status: [{ status_name: "Completed", created_at: "2026-04-05T08:00:00Z" }],
      }),
    ]);

    const result = await computeLocationCompliance("Construction", "Westminster");
    expect(result).not.toBeNull();
    // avg days to complete: (2 + 4) / 2 = 3
    expect(result!.summary.avgDaysToComplete).toBe(3);
    // avg days late: only j2 was late (1 day past end)
    expect(result!.summary.avgDaysLate).toBe(1);
  });

  it("maps DTC location to Centennial team filter", async () => {
    mockFetchJobsForCategory.mockResolvedValue([
      makeZuperJob({
        assigned_to: [
          {
            user: { user_uid: "u1", first_name: "Alan", last_name: "Lanka", is_active: true },
            team: { team_name: "Centennial" },
          },
        ],
        assigned_to_team: [{ team: { team_uid: "t1", team_name: "Centennial" } }],
      }),
    ]);

    const result = await computeLocationCompliance("Construction", "DTC");
    expect(result).not.toBeNull();
    expect(result!.summary.totalJobs).toBe(1);
  });

  it("works across all three category types", async () => {
    mockFetchJobsForCategory.mockResolvedValue([makeZuperJob()]);

    for (const cat of ["Site Survey", "Construction", "Inspection"]) {
      const result = await computeLocationCompliance(cat, "Westminster");
      expect(result).not.toBeNull();
    }
    expect(mockFetchJobsForCategory).toHaveBeenCalledTimes(3);
  });
});
