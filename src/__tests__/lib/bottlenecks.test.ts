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
    hubspotUpdatedAt: daysAgo(2), // recently active → flagged deals default to "stalled"
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

  it("excludes deals on terminal pipeline stages even when their status column reads open", () => {
    const rows = [
      deal({ stage: "Project Complete", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(400) }),
      deal({ hubspotDealId: "2", stage: "Cancelled", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(30) }),
    ];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const permitting = snap.stages.find((s) => s.key === "permitting")!;
    expect(permitting.totalInStage).toBe(0);
    expect(permitting.flagged).toHaveLength(0);
  });

  it("treats an exit stamp as leaving the stage regardless of status text (e.g. inspection 'Passed')", () => {
    const rows = [deal({
      finalInspectionStatus: "Passed",
      constructionCompleteDate: daysAgo(50),
      inspectionPassDate: daysAgo(10),
    })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "inspection")!.totalInStage).toBe(0);
  });

  it("keeps a cancelled deal with no exit stamp out of the volume reconstruction", () => {
    const rows = [deal({ stage: "Cancelled", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(120) })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "permitting")!.volumeNorm90d).toBe(0);
  });

  it("assigns teams per Zach's mapping: PTO → pi, PE → compliance", () => {
    const byKey = Object.fromEntries(STAGES.map((s) => [s.key, s.team]));
    expect(byKey.pto).toBe("pi");
    expect(byKey.pe_m1).toBe("compliance");
    expect(byKey.pe_m2).toBe("compliance");
    expect(byKey.construction).toBe("ops");
  });

  it("buckets flagged deals: recently-touched → stalled, untouched 90d+ or unknown → zombie", () => {
    const rows = [
      deal({ hubspotDealId: "s1", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(40), hubspotUpdatedAt: daysAgo(5) }),
      deal({ hubspotDealId: "z1", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(40), hubspotUpdatedAt: daysAgo(200) }),
      deal({ hubspotDealId: "z2", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(40), hubspotUpdatedAt: null }),
    ];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const permitting = snap.stages.find((s) => s.key === "permitting")!;
    const buckets = Object.fromEntries(permitting.flagged.map((f) => [f.hubspotDealId, f.bucket]));
    expect(buckets).toEqual({ s1: "stalled", z1: "zombie", z2: "zombie" });
    expect(permitting.stalledCount).toBe(1);
    expect(permitting.zombieCount).toBe(2);
    const s1 = permitting.flagged.find((f) => f.hubspotDealId === "s1")!;
    expect(s1.daysSinceActivity).toBe(5);
    expect(s1.status).toBe("Submitted to AHJ");
  });
});

describe("deriveThresholds", () => {
  const completed = (n: number, days: number) =>
    Array.from({ length: n }, (_, i) =>
      deal({
        hubspotDealId: `c${days}-${i}`,
        permitSubmitDate: daysAgo(days + 30),
        permitIssueDate: daysAgo(30),
      })
    );

  it("computes median and p90 from completed transitions and defaults threshold to p90", () => {
    // 10 transitions of 10d + 2 of 100d → median 10, p90 = 100
    const rows = [...completed(10, 10), ...completed(2, 100)];
    const t = deriveThresholds(rows, NOW);
    expect(t.permitting.medianDays).toBe(10);
    expect(t.permitting.thresholdDays).toBe(t.permitting.p90Days);
  });

  it("leaves derived thresholdDays null below 10 completed transitions; flagging falls back to the cap", () => {
    const t = deriveThresholds(completed(3, 12), NOW);
    expect(t.permitting.thresholdDays).toBeNull();
    // computeStageSnapshots still flags via the stage cap (permitting: 30d)
    const rows = [deal({ permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(500) })];
    const snap = computeStageSnapshots(rows, t, NOW);
    const permitting = snap.stages.find((s) => s.key === "permitting")!;
    expect(permitting.effective).toEqual({ days: 30, source: "capped" });
    expect(permitting.flagged).toHaveLength(1);
  });

  it("caps a lenient derived p90 at the stage cap", () => {
    // 12 completed permitting transitions of 200d → p90 = 200, way over the 30d cap.
    const t = deriveThresholds(completed(12, 200), NOW);
    const rows = [deal({ permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(40) })];
    const snap = computeStageSnapshots(rows, t, NOW);
    const permitting = snap.stages.find((s) => s.key === "permitting")!;
    expect(permitting.effective).toEqual({ days: 30, source: "capped" });
    expect(permitting.flagged).toHaveLength(1); // 40d > 30d cap, though under the 200d p90
  });

  it("manual thresholds bypass the cap", () => {
    const manual = {
      permitting: { medianDays: 10, p90Days: 20, thresholdDays: 60, source: "manual" as const },
    };
    const rows = [deal({ permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(40) })];
    const snap = computeStageSnapshots(rows, manual, NOW);
    const permitting = snap.stages.find((s) => s.key === "permitting")!;
    expect(permitting.effective).toEqual({ days: 60, source: "manual" });
    expect(permitting.flagged).toHaveLength(0); // 40d < 60d manual
  });

  it("preserves manual overrides while refreshing stats", () => {
    const existing = {
      permitting: { medianDays: 1, p90Days: 2, thresholdDays: 55, source: "manual" as const },
    };
    const t = deriveThresholds(completed(12, 10), NOW, existing);
    expect(t.permitting.thresholdDays).toBe(55);
    expect(t.permitting.source).toBe("manual");
    expect(t.permitting.medianDays).toBe(10); // stats still refresh
  });

  it("ignores transitions older than the 12-month window", () => {
    const old = completed(12, 10).map((d) => ({
      ...d,
      permitSubmitDate: daysAgo(500),
      permitIssueDate: daysAgo(400),
    }));
    const t = deriveThresholds(old, NOW);
    expect(t.permitting.medianDays).toBeNull();
  });
});

describe("flow", () => {
  it("buckets entries and exits by ISO week over all rows", () => {
    const rows = [
      deal({ hubspotDealId: "f1", permitSubmitDate: daysAgo(3) }),
      deal({ hubspotDealId: "f2", permitSubmitDate: daysAgo(10), permitIssueDate: daysAgo(2) }),
    ];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const flow = snap.stages.find((s) => s.key === "permitting")!.flow;
    const totals = flow.reduce((acc, w) => ({ entered: acc.entered + w.entered, exited: acc.exited + w.exited }), { entered: 0, exited: 0 });
    expect(totals).toEqual({ entered: 2, exited: 1 });
  });
});
