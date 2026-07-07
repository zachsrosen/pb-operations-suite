jest.mock("@/lib/db", () => ({
  prisma: {
    deal: { findMany: jest.fn() },
    systemConfig: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}));

import {
  STAGES,
  computeStageSnapshots,
  deriveThresholds,
  type BottleneckDealRow,
} from "@/lib/bottlenecks";

const NOW = new Date("2026-07-07T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);

/** Minimal fixture row; spread overrides per test. */
function deal(overrides: Partial<BottleneckDealRow>): BottleneckDealRow {
  return {
    hubspotDealId: "1",
    dealName: "PROJ-1000 | Test, Casey | 1 Main St",
    projectNumber: "PROJ-1000",
    pbLocation: "Westminster",
    dealOwnerName: "Jane Owner",
    hubspotOwnerId: "42",
    stage: "Permitting & Interconnection",
    isParticipateEnergy: false,
    rawProperties: null,
    designStatus: null,
    permittingStatus: null,
    icStatus: null,
    installStatus: null,
    finalInspectionStatus: null,
    ptoStatus: null,
    siteSurveyCompletionDate: null,
    designStartDate: null,
    designCompletionDate: null,
    permitSubmitDate: null,
    permitIssueDate: null,
    icSubmitDate: null,
    icApprovalDate: null,
    rtbDate: null,
    installScheduleDate: null,
    constructionCompleteDate: null,
    inspectionPassDate: null,
    ptoStartDate: null,
    ptoCompletionDate: null,
    ...overrides,
  };
}

const THRESHOLDS = Object.fromEntries(
  STAGES.map((s) => [s.key, { medianDays: 10, p90Days: 20, thresholdDays: 20, source: "derived" as const }])
);

describe("computeStageSnapshots", () => {
  it("flags a permitting deal past threshold, using permitSubmitDate as entry", () => {
    const rows = [deal({ permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(30) })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const permitting = snap.stages.find((s) => s.key === "permitting")!;
    expect(permitting.totalInStage).toBe(1);
    expect(permitting.flagged).toHaveLength(1);
    expect(permitting.flagged[0].dwellDays).toBe(30);
  });

  it("does not flag a deal under threshold", () => {
    const rows = [deal({ permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(5) })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "permitting")!.flagged).toHaveLength(0);
  });

  it("falls back through the entry chain (construction: installScheduleDate → rtbDate → permitIssueDate)", () => {
    const rows = [deal({
      installStatus: "In Progress",
      installScheduleDate: null,
      rtbDate: daysAgo(25),
      permitIssueDate: daysAgo(60),
    })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const construction = snap.stages.find((s) => s.key === "construction")!;
    expect(construction.flagged[0].dwellDays).toBe(25); // rtbDate, not permitIssueDate
  });

  it("buckets deals with no entry stamp as unknown-age, never flags them", () => {
    const rows = [deal({ designStatus: "In Design" })]; // no design dates at all
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const design = snap.stages.find((s) => s.key === "design")!;
    expect(design.unknownAgeCount).toBe(1);
    expect(design.flagged).toHaveLength(0);
  });

  it("excludes completed statuses from stage membership", () => {
    const rows = [deal({ permittingStatus: "Complete", permitSubmitDate: daysAgo(90) })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "permitting")!.totalInStage).toBe(0);
  });

  it("only counts PE stages for isParticipateEnergy deals, reading status from rawProperties", () => {
    const pe = deal({
      isParticipateEnergy: true,
      inspectionPassDate: daysAgo(45),
      rawProperties: { pe_m1_status: "Submitted" },
    });
    const nonPe = deal({ hubspotDealId: "2", rawProperties: { pe_m1_status: "Submitted" }, inspectionPassDate: daysAgo(45) });
    const snap = computeStageSnapshots([pe, nonPe], THRESHOLDS, NOW);
    const m1 = snap.stages.find((s) => s.key === "pe_m1")!;
    expect(m1.totalInStage).toBe(1);
    expect(m1.flagged[0].dwellDays).toBe(45);
  });

  it("treats PE approved/paid buckets as out of stage", () => {
    const rows = [deal({ isParticipateEnergy: true, inspectionPassDate: daysAgo(45), rawProperties: { pe_m1_status: "Paid" } })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "pe_m1")!.totalInStage).toBe(0);
  });

  it("sorts flagged deals by dwell descending", () => {
    const rows = [
      deal({ hubspotDealId: "a", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(25) }),
      deal({ hubspotDealId: "b", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(40) }),
    ];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "permitting")!.flagged.map((f) => f.hubspotDealId)).toEqual(["b", "a"]);
  });

  it("reconstructs the 90-day volume norm from stamps (in-stage on day D iff entry ≤ D < exit)", () => {
    // One deal in permitting the whole trailing 90 days, one that exited 60 days ago
    // → daily count is 2 on days 61–90 ago, 1 on days 1–60 ago → median of the 90 samples = 1.
    const rows = [
      deal({ hubspotDealId: "v1", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(120) }),
      deal({ hubspotDealId: "v2", permitSubmitDate: daysAgo(120), permitIssueDate: daysAgo(60) }),
    ];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "permitting")!.volumeNorm90d).toBe(1);
  });
});
