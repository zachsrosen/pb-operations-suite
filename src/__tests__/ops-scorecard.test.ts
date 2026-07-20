import {
  computeOpsScorecard,
  normalizeLocation,
  daysBetween,
  median,
  mean,
} from "@/lib/ops-scorecard";
import type { Project } from "@/lib/hubspot";

const NOW = new Date("2026-07-18T12:00:00Z");

/** Minimal Project fixture — only the fields the scorecard reads. */
function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 1,
    name: "Test",
    pbLocation: "Westminster",
    stage: "Construction",
    stageId: "20440342",
    amount: 30000,
    closeDate: "2026-02-01",
    siteSurveyScheduleDate: null,
    siteSurveyCompletionDate: null,
    designApprovalSentDate: null,
    designApprovalDate: null,
    permitSubmitDate: null,
    permitIssueDate: null,
    inspectionPassDate: null,
    ptoGrantedDate: null,
    constructionCompleteDate: null,
    cancelledDate: null,
    ...overrides,
  } as unknown as Project;
}

describe("ops-scorecard helpers", () => {
  it("normalizes Pueblo to Colorado Springs", () => {
    expect(normalizeLocation("Pueblo")).toBe("Colorado Springs");
    expect(normalizeLocation("Westminster")).toBe("Westminster");
    expect(normalizeLocation(null)).toBe("Unknown");
  });

  it("clips day spans to [0, 400)", () => {
    expect(daysBetween("2026-01-10", "2026-01-15")).toBe(5);
    expect(daysBetween("2026-01-15", "2026-01-10")).toBeNull(); // negative
    expect(daysBetween("2024-01-01", "2026-01-01")).toBeNull(); // > 400d
    expect(daysBetween(null, "2026-01-01")).toBeNull();
  });

  it("median and mean", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    expect(mean([2, 4])).toBe(3);
    expect(mean([])).toBeNull();
  });
});

describe("computeOpsScorecard", () => {
  it("counts gross but sums net revenue in throughput", () => {
    const projects = [
      makeProject({ closeDate: "2026-03-01", amount: 10000 }),
      makeProject({ closeDate: "2026-03-05", amount: 20000, stageId: "68229433" }), // cancelled
      makeProject({ closeDate: "2026-03-08", amount: 40000, stageId: "20440344" }), // on-hold
    ];
    const out = computeOpsScorecard(projects, NOW);
    const company = out.throughputByOffice.find((r) => r.office === "Company")!;
    expect(company.sales.ytd.count).toBe(3); // gross count
    expect(company.sales.ytd.revenue).toBe(10000); // net revenue
  });

  it("cancellation cohorts: same-yr vs eventual, keyed on year sold", () => {
    const projects = [
      makeProject({ closeDate: "2025-02-01", amount: 100 }),
      // sold 2025, cancelled 2025 → same-yr AND eventual for the 2025 cohort
      makeProject({
        closeDate: "2025-03-01",
        amount: 100,
        stageId: "68229433",
        cancelledDate: "2025-06-01",
      }),
      // sold 2025, cancelled 2026 → eventual only
      makeProject({
        closeDate: "2025-04-01",
        amount: 100,
        stageId: "68229433",
        cancelledDate: "2026-02-01",
      }),
      makeProject({ closeDate: "2025-05-01", amount: 100 }),
    ];
    const out = computeOpsScorecard(projects, NOW);
    const company = out.cancellations.find((r) => r.office === "Company")!;
    expect(company.py.sold).toBe(4);
    expect(company.py.sameYrCount).toBe(1);
    expect(company.py.eventualCount).toBe(2);
    expect(company.py.sameYrRevPct).toBeCloseTo(25);
    expect(company.py.eventualRevPct).toBeCloseTo(50);
  });

  it("excludes cancelled deals from time metrics", () => {
    const projects = [
      makeProject({
        closeDate: "2026-01-10",
        siteSurveyScheduleDate: "2026-01-15", // 5 days
      }),
      makeProject({
        closeDate: "2026-01-10",
        siteSurveyScheduleDate: "2026-03-10", // 60 days — but cancelled
        stageId: "68229433",
      }),
    ];
    const out = computeOpsScorecard(projects, NOW);
    const company = out.efficiency.turnaroundsByOffice.find((r) => r.office === "Company")!;
    expect(company.legs["Sale → day of survey"].cy).toBe(5);
  });

  it("counts backlog only for pre-CC active stages without a CC date", () => {
    const projects = [
      makeProject({ stageId: "20461937", amount: 10000 }), // D&E, no CC → backlog
      makeProject({ stageId: "20440342", amount: 20000, constructionCompleteDate: "2026-06-01" }), // has CC
      makeProject({ stageId: "68229433", amount: 40000 }), // cancelled
      makeProject({ stageId: "20440344", amount: 5000 }), // on-hold → separate bucket
    ];
    const out = computeOpsScorecard(projects, NOW);
    expect(out.capacity.backlogCount).toBe(1);
    expect(out.capacity.backlogRev).toBe(10000);
    expect(out.capacity.onHoldRev).toBe(5000);
  });

  it("merges Pueblo into Colorado Springs office rows", () => {
    const projects = [
      makeProject({ pbLocation: "Pueblo", closeDate: "2026-02-01", amount: 1000 }),
      makeProject({ pbLocation: "Colorado Springs", closeDate: "2026-02-02", amount: 2000 }),
    ];
    const out = computeOpsScorecard(projects, NOW);
    const cos = out.throughputByOffice.find((r) => r.office === "Colorado Springs")!;
    expect(cos.sales.ytd.count).toBe(2);
    expect(cos.sales.ytd.revenue).toBe(3000);
  });

  it("computes same-day DA share on live deals", () => {
    const projects = [
      makeProject({
        closeDate: "2026-01-05",
        designApprovalSentDate: "2026-02-01",
        designApprovalDate: "2026-02-01", // same day
      }),
      makeProject({
        closeDate: "2026-01-06",
        designApprovalSentDate: "2026-02-01",
        designApprovalDate: "2026-02-04",
      }),
    ];
    const out = computeOpsScorecard(projects, NOW);
    expect(out.efficiency.sameDayDaPct.cy).toBe(50);
  });

  it("year framing follows the provided clock", () => {
    const out = computeOpsScorecard([], NOW);
    expect(out.meta.cy).toBe("2026");
    expect(out.meta.py).toBe("2025");
    expect(out.meta.py2).toBe("2024");
  });
});
