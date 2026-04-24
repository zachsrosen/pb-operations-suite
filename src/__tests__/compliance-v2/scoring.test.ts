jest.mock("@/lib/db", () => ({
  prisma: null,
  getActiveCrewMembers: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/zuper", () => ({
  zuper: { isConfigured: () => false, searchJobs: jest.fn(), getJobServiceTasks: jest.fn(), getFormSubmission: jest.fn() },
  JOB_CATEGORY_UIDS: { SITE_SURVEY: "survey-uid", CONSTRUCTION: "construction-uid", INSPECTION: "inspection-uid" },
  JOB_CATEGORIES: { SITE_SURVEY: "Site Survey", CONSTRUCTION: "Construction", INSPECTION: "Inspection" },
}));

const mockFetchJobsForCategory = jest.fn();
jest.mock("@/lib/compliance-helpers", () => {
  const actual = jest.requireActual("@/lib/compliance-helpers");
  return {
    ...actual,
    fetchJobsForCategory: (...args: unknown[]) => mockFetchJobsForCategory(...args),
  };
});

import { computeLocationComplianceV2 } from "@/lib/compliance-v2/scoring";
import type { ServiceTasksBundle } from "@/lib/compliance-v2/service-tasks-fetcher";
import {
  buildPvBatterySplitFixture,
  buildFormFilerOnlyFixture,
  buildPaperworkOnlyFixture,
  buildEmptyCreditSetFixture,
  buildFractionalLateFixture,
  buildParentOnlyFixture,
  buildFollowUpFixture,
  buildFailedFixture,
  buildExcludedStatusFixture,
  buildTimestampTieBreakFixture,
  buildPvCompletedElectricalStuckFixture,
  buildCrossLocationFixture,
  buildImportedCrewFixture,
  buildDispatcherLagFixture,
  type FixtureBundle,
} from "./fixtures/jobs";

function mkFetcher(fixtures: FixtureBundle[]): () => { fetchBundle: (jobUid: string) => Promise<ServiceTasksBundle | null> } {
  return () => ({
    async fetchBundle(jobUid: string) {
      const f = fixtures.find((x) => x.job.job_uid === jobUid);
      return f?.taskBundle ?? null;
    },
  });
}

async function compute(fixtures: FixtureBundle[]) {
  mockFetchJobsForCategory.mockResolvedValueOnce(fixtures.map((f) => f.job));
  return computeLocationComplianceV2("Construction", "Centennial", 30, {
    createFetcher: mkFetcher(fixtures),
  });
}

describe("computeLocationComplianceV2", () => {
  beforeEach(() => mockFetchJobsForCategory.mockReset());

  it("PV/Battery case: PV tech on-time, Electrical tech late", async () => {
    const result = await compute([buildPvBatterySplitFixture()]);
    const pv = result!.byEmployee.find((e) => e.userUid === "u-pv")!;
    const elec = result!.byEmployee.find((e) => e.userUid === "u-elec")!;
    expect(pv.onTimePercent).toBe(100);
    expect(elec.onTimePercent).toBe(0);
  });

  it("Form-filer-only case: filer is scored symmetrically", async () => {
    const result = await compute([buildFormFilerOnlyFixture()]);
    const filer = result!.byEmployee.find((e) => e.userUid === "u-filer")!;
    expect(filer).toBeDefined();
    expect(filer.tasksFractional).toBe(1); // sole credit-set member
    expect(filer.onTimePercent).toBe(100);
    // Parent-only tech should not appear
    expect(result!.byEmployee.find((e) => e.userUid === "u-parent")).toBeUndefined();
  });

  it("Paperwork task: JHA Form filer is not scored", async () => {
    const result = await compute([buildPaperworkOnlyFixture()]);
    expect(result!.byEmployee.find((e) => e.userUid === "u-paper")).toBeUndefined();
  });

  it("Empty credit set: job excluded entirely", async () => {
    const result = await compute([buildEmptyCreditSetFixture()]);
    expect(result!.byEmployee).toEqual([]);
    expect(result!.emptyCreditSetJobs).toBe(1);
  });

  it("Fractional math: 3 techs on one late task each get 1/3 late", async () => {
    const result = await compute([buildFractionalLateFixture()]);
    for (const uid of ["u1", "u2", "u3"]) {
      const emp = result!.byEmployee.find((e) => e.userUid === uid)!;
      expect(emp.tasksFractional).toBeCloseTo(1 / 3, 5);
      expect(emp.lateCount).toBeCloseTo(1 / 3, 5);
      expect(emp.onTimeCount).toBe(0);
    }
  });

  it("Parent-only tech: ghost not in task credit set is not scored", async () => {
    const result = await compute([buildParentOnlyFixture()]);
    expect(result!.byEmployee.find((e) => e.userUid === "u-real")).toBeDefined();
    expect(result!.byEmployee.find((e) => e.userUid === "u-ghost")).toBeUndefined();
  });

  it("Follow-up status: tagged hasFollowUp + on-time credit", async () => {
    const result = await compute([buildFollowUpFixture()]);
    const emp = result!.byEmployee.find((e) => e.userUid === "u-f")!;
    expect(emp.hasFollowUp).toBe(true);
    expect(emp.onTimePercent).toBe(100);
  });

  it("Failed status: on-time credit + counts toward pass rate", async () => {
    const result = await compute([buildFailedFixture()]);
    const emp = result!.byEmployee.find((e) => e.userUid === "u-f")!;
    expect(emp.onTimePercent).toBe(100); // on-time (showed up on schedule)
    expect(emp.failedCount).toBeCloseTo(1, 5);
    expect(emp.passRate).toBe(0);
  });

  it("Ready To Forecast: excluded entirely from scoring", async () => {
    const result = await compute([buildExcludedStatusFixture()]);
    expect(result!.byEmployee).toEqual([]);
    expect(result!.emptyCreditSetJobs).toBe(0); // excluded, not "empty"
  });

  it("Timestamp tie-break: earliest of signals is used", async () => {
    const result = await compute([buildTimestampTieBreakFixture()]);
    const emp = result!.byEmployee.find((e) => e.userUid === "u-t")!;
    // actual_end_time (2026-04-03T23:00:00Z) is earlier than form.created_at (2026-04-05)
    // scheduledEnd is 2026-04-03T23:00:00Z; with 24h grace this is on-time
    expect(emp.onTimePercent).toBe(100);
  });

  it("Low-volume threshold: <5 credits → grade is '—' + lowVolume flag", async () => {
    // Single fixture with 3 techs on one task → each gets 1/3 < 5
    const result = await compute([buildFractionalLateFixture()]);
    const emp = result!.byEmployee[0];
    expect(emp.lowVolume).toBe(true);
    expect(emp.grade).toBe("—");
  });

  it("Location filter: cross-location job — only the matching-team tech appears per location", async () => {
    // Computing for "Centennial" should surface u-cent only
    mockFetchJobsForCategory.mockResolvedValueOnce([buildCrossLocationFixture().job]);
    const cent = await computeLocationComplianceV2("Construction", "Centennial", 30, {
      createFetcher: mkFetcher([buildCrossLocationFixture()]),
    });
    expect(cent!.byEmployee.map((e) => e.userUid).sort()).toEqual(["u-cent"]);
    expect(cent!.byEmployee[0].tasksFractional).toBe(1); // 1/1 for the location-scoped credit set

    // Computing for "San Luis Obispo" should surface u-slo only
    mockFetchJobsForCategory.mockResolvedValueOnce([buildCrossLocationFixture().job]);
    const slo = await computeLocationComplianceV2("Construction", "San Luis Obispo", 30, {
      createFetcher: mkFetcher([buildCrossLocationFixture()]),
    });
    expect(slo!.byEmployee.map((e) => e.userUid).sort()).toEqual(["u-slo"]);
  });

  it("Imported crew: CO tech on pure-SLO job IS scored for SLO", async () => {
    // Parent job exclusively tagged SLO; tech's task-team tag is Centennial.
    // Under the imported-crew rule the tech should appear in SLO scoring,
    // even though their own team tag points to CO.
    mockFetchJobsForCategory.mockResolvedValueOnce([buildImportedCrewFixture().job]);
    const slo = await computeLocationComplianceV2("Construction", "San Luis Obispo", 30, {
      createFetcher: mkFetcher([buildImportedCrewFixture()]),
    });
    expect(slo!.byEmployee.map((e) => e.userUid)).toEqual(["u-co"]);
    // NOTE: the same tech will also appear in Centennial scoring because
    // their team tag matches. This mirrors v1's team-filter behavior —
    // we don't de-duplicate across locations. Worth documenting but not
    // fixing here, since v1 has the same characteristic and aggregate
    // computation is explicitly unchanged (spec §1 non-goal).
  });

  it("Dispatcher lag: uses earliest completion status (Loose Ends Remaining) over later Construction Complete entry", async () => {
    // Real scenario from PROJ-8846 Lau (Lucas Scarpellino on 2026-04-24):
    // Crew finished 2026-04-09 22:21 (Loose Ends Remaining, within scheduled
    // 23:00 deadline). Dispatcher didn't enter "Construction Complete" until
    // 2026-04-17 — 8 days later. Under the pre-fix code, v2 picked the late
    // timestamp and marked the tech as LATE. After the fix v2 uses the
    // earliest completion signal (22:21 Apr 9) → on-time.
    const result = await compute([buildDispatcherLagFixture()]);
    const emp = result!.byEmployee.find((e) => e.userUid === "u-crew")!;
    expect(emp).toBeDefined();
    expect(emp.onTimePercent).toBe(100); // NOT 0 — the bug we fixed
    expect(emp.lateCount).toBe(0);
  });

  it("CENTRAL FAIRNESS: PV completed on time, Electrical stuck on same parent → PV tech gets no stuck penalty", async () => {
    const result = await compute([buildPvCompletedElectricalStuckFixture()]);
    const pv = result!.byEmployee.find((e) => e.userUid === "u-pv")!;
    const elec = result!.byEmployee.find((e) => e.userUid === "u-elec")!;

    // PV: completed on time, NO stuck penalty (task is completed-full)
    expect(pv).toBeDefined();
    expect(pv.onTimePercent).toBe(100);
    expect(pv.stuckCount).toBe(0);

    // Electrical: stuck 1/1
    expect(elec).toBeDefined();
    expect(elec.stuckCount).toBeCloseTo(1, 5);
    // Electrical has no completion → measurable is 0, onTimePercent is -1
    expect(elec.onTimePercent).toBe(-1);
  });
});
