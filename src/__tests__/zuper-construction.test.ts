import type { ZuperJobCache } from "@/generated/prisma/client";
import {
  isConstructionCategoryUid,
  isConstructionCategoryName,
  categoryToSystemType,
  groupConstructionJobsByDeal,
  allocateDealValueAcrossJobs,
} from "@/lib/zuper-construction";
import { JOB_CATEGORIES, JOB_CATEGORY_UIDS } from "@/lib/zuper";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<ZuperJobCache> = {}): ZuperJobCache {
  const now = new Date("2026-05-01T00:00:00Z");
  return {
    id: overrides.id ?? "cuid_" + Math.random().toString(36).slice(2),
    jobUid: overrides.jobUid ?? "job_" + Math.random().toString(36).slice(2),
    jobTitle: overrides.jobTitle ?? "Test Job",
    jobCategory: overrides.jobCategory ?? JOB_CATEGORIES.CONSTRUCTION,
    jobStatus: overrides.jobStatus ?? "SCHEDULED",
    jobPriority: overrides.jobPriority ?? null,
    scheduledStart: overrides.scheduledStart ?? null,
    scheduledEnd: overrides.scheduledEnd ?? null,
    completedDate: overrides.completedDate ?? null,
    assignedUsers: overrides.assignedUsers ?? null,
    assignedTeam: overrides.assignedTeam ?? null,
    customerAddress: overrides.customerAddress ?? null,
    hubspotDealId: "hubspotDealId" in overrides ? overrides.hubspotDealId ?? null : "12345",
    projectName: overrides.projectName ?? null,
    jobTags: overrides.jobTags ?? [],
    jobNotes: overrides.jobNotes ?? null,
    lastSyncedAt: overrides.lastSyncedAt ?? now,
    rawData: overrides.rawData ?? null,
  } as ZuperJobCache;
}

describe("isConstructionCategoryUid", () => {
  it("returns true for legacy CONSTRUCTION UID", () => {
    expect(isConstructionCategoryUid(JOB_CATEGORY_UIDS.CONSTRUCTION)).toBe(true);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isConstructionCategoryUid(null)).toBe(false);
    expect(isConstructionCategoryUid(undefined)).toBe(false);
    expect(isConstructionCategoryUid("")).toBe(false);
  });

  it("returns false for non-construction category (Site Survey)", () => {
    expect(isConstructionCategoryUid(JOB_CATEGORY_UIDS.SITE_SURVEY)).toBe(false);
  });
});

describe("isConstructionCategoryName", () => {
  it("returns true for legacy 'Construction' display name", () => {
    expect(isConstructionCategoryName("Construction")).toBe(true);
  });

  it("returns true for new split names", () => {
    expect(isConstructionCategoryName("Construction - Solar")).toBe(true);
    expect(isConstructionCategoryName("Construction - Battery")).toBe(true);
    expect(isConstructionCategoryName("Construction - EV")).toBe(true);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isConstructionCategoryName(null)).toBe(false);
    expect(isConstructionCategoryName(undefined)).toBe(false);
    expect(isConstructionCategoryName("")).toBe(false);
  });

  it("returns false for non-construction names", () => {
    expect(isConstructionCategoryName("Site Survey")).toBe(false);
    expect(isConstructionCategoryName("Inspection")).toBe(false);
  });
});

describe("categoryToSystemType", () => {
  it("maps display names to system types", () => {
    expect(categoryToSystemType("Construction")).toBe("legacy");
    expect(categoryToSystemType("Construction - Solar")).toBe("solar");
    expect(categoryToSystemType("Construction - Battery")).toBe("battery");
    expect(categoryToSystemType("Construction - EV")).toBe("ev");
  });

  it("returns 'legacy' for unknown values (defensive default)", () => {
    expect(categoryToSystemType("something else")).toBe("legacy");
    expect(categoryToSystemType("")).toBe("legacy");
  });
});

describe("groupConstructionJobsByDeal", () => {
  it("returns empty array for empty input", () => {
    expect(groupConstructionJobsByDeal([])).toEqual([]);
  });

  it("groups two jobs with same dealId into one aggregate", () => {
    const jobs = [
      makeJob({ jobUid: "j1", hubspotDealId: "deal-1", jobCategory: "Construction - Solar" }),
      makeJob({ jobUid: "j2", hubspotDealId: "deal-1", jobCategory: "Construction - Battery" }),
    ];

    const result = groupConstructionJobsByDeal(jobs);

    expect(result).toHaveLength(1);
    expect(result[0].dealId).toBe("deal-1");
    expect(result[0].jobs).toHaveLength(2);
    expect(result[0].systemTypes.sort()).toEqual(["battery", "solar"]);
  });

  it("returns separate aggregates for different dealIds", () => {
    const jobs = [
      makeJob({ jobUid: "j1", hubspotDealId: "deal-1", jobCategory: "Construction - Solar" }),
      makeJob({ jobUid: "j2", hubspotDealId: "deal-2", jobCategory: "Construction - Solar" }),
    ];

    const result = groupConstructionJobsByDeal(jobs);

    expect(result).toHaveLength(2);
    const ids = result.map((a) => a.dealId).sort();
    expect(ids).toEqual(["deal-1", "deal-2"]);
  });

  it("drops jobs with null hubspotDealId", () => {
    const jobs = [
      makeJob({ jobUid: "j1", hubspotDealId: null }),
      makeJob({ jobUid: "j2", hubspotDealId: "deal-1" }),
    ];

    const result = groupConstructionJobsByDeal(jobs);

    expect(result).toHaveLength(1);
    expect(result[0].dealId).toBe("deal-1");
  });

  it("computes earliestStart and latestEnd across sub-jobs", () => {
    const jobs = [
      makeJob({
        jobUid: "j1",
        hubspotDealId: "deal-1",
        scheduledStart: new Date("2026-05-12T08:00:00Z"),
        scheduledEnd: new Date("2026-05-13T17:00:00Z"),
      }),
      makeJob({
        jobUid: "j2",
        hubspotDealId: "deal-1",
        scheduledStart: new Date("2026-05-13T08:00:00Z"),
        scheduledEnd: new Date("2026-05-14T17:00:00Z"),
      }),
    ];

    const [agg] = groupConstructionJobsByDeal(jobs);

    expect(agg.earliestStart?.toISOString()).toBe("2026-05-12T08:00:00.000Z");
    expect(agg.latestEnd?.toISOString()).toBe("2026-05-14T17:00:00.000Z");
  });

  it("a single legacy CONSTRUCTION job behaves like a 1-job aggregate", () => {
    const jobs = [makeJob({ hubspotDealId: "deal-1", jobCategory: "Construction" })];

    const result = groupConstructionJobsByDeal(jobs);

    expect(result).toHaveLength(1);
    expect(result[0].systemTypes).toEqual(["legacy"]);
    expect(result[0].jobs).toHaveLength(1);
  });

  it("groups crews by system type", () => {
    const jobs = [
      makeJob({
        hubspotDealId: "deal-1",
        jobCategory: "Construction - Solar",
        assignedUsers: [{ user_uid: "u1", user_name: "Solar Steve" }],
      } as Partial<ZuperJobCache>),
      makeJob({
        hubspotDealId: "deal-1",
        jobCategory: "Construction - Battery",
        assignedUsers: [{ user_uid: "u2", user_name: "Battery Bob" }],
      } as Partial<ZuperJobCache>),
    ];

    const [agg] = groupConstructionJobsByDeal(jobs);

    expect(agg.assignedCrewsByType.solar).toEqual(["Solar Steve"]);
    expect(agg.assignedCrewsByType.battery).toEqual(["Battery Bob"]);
  });
});

describe("allocateDealValueAcrossJobs", () => {
  it("splits evenly across N jobs", () => {
    expect(allocateDealValueAcrossJobs(90000, 3)).toBe(30000);
    expect(allocateDealValueAcrossJobs(80000, 2)).toBe(40000);
    expect(allocateDealValueAcrossJobs(50000, 1)).toBe(50000);
  });

  it("returns 0 for jobCount=0 (avoids divide-by-zero)", () => {
    expect(allocateDealValueAcrossJobs(50000, 0)).toBe(0);
  });

  it("returns 0 when dealAmount is 0", () => {
    expect(allocateDealValueAcrossJobs(0, 3)).toBe(0);
  });

  it("handles non-evenly-divisible amounts (returns float)", () => {
    expect(allocateDealValueAcrossJobs(100, 3)).toBeCloseTo(33.333, 2);
  });
});

describe("revenue split scenarios (mirrors revenue-calendar logic)", () => {
  it("3-system deal at $90k splits to $30k per sub-job", () => {
    expect(allocateDealValueAcrossJobs(90000, 3)).toBe(30000);
  });

  it("2-system deal at $80k splits to $40k per sub-job", () => {
    expect(allocateDealValueAcrossJobs(80000, 2)).toBe(40000);
  });

  it("1-system deal preserves full value", () => {
    expect(allocateDealValueAcrossJobs(50000, 1)).toBe(50000);
  });
});
