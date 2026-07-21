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
    expect(company.legs["Sale → day of survey"].cy.mean).toBe(5);
    expect(company.legs["Sale → day of survey"].cy.median).toBe(5);
  });

  it("reports both mean and median per turnaround leg", () => {
    const projects = [
      makeProject({ closeDate: "2026-01-10", siteSurveyScheduleDate: "2026-01-11" }), // 1 day
      makeProject({ closeDate: "2026-01-10", siteSurveyScheduleDate: "2026-01-11" }), // 1 day
      makeProject({ closeDate: "2026-01-10", siteSurveyScheduleDate: "2026-02-09" }), // 30 days
    ];
    const out = computeOpsScorecard(projects, NOW);
    const company = out.efficiency.turnaroundsByOffice.find((r) => r.office === "Company")!;
    const leg = company.legs["Sale → day of survey"];
    expect(leg.cy.median).toBe(1);
    expect(leg.cy.mean).toBeCloseTo(10.7, 1);
  });

  it("computes end-to-end sale → CC and sale → DA legs", () => {
    const projects = [
      makeProject({
        closeDate: "2026-01-10",
        designApprovalDate: "2026-02-09", // 30 days
        constructionCompleteDate: "2026-04-10", // 90 days
      }),
      makeProject({ closeDate: "2026-01-10" }), // not there yet → excluded from both legs
    ];
    const out = computeOpsScorecard(projects, NOW);
    const company = out.efficiency.turnaroundsByOffice.find((r) => r.office === "Company")!;
    expect(company.legs["Sale → DA approved"].cy).toEqual({ mean: 30, median: 30 });
    expect(company.legs["Sale → CC"].cy).toEqual({ mean: 90, median: 90 });
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

  it("computes same-point prior-year cohorts through the clock's month-day", () => {
    // NOW is 2026-07-18 → monthDay window is Jan 1 – Jul 18 of each year.
    const projects = [
      makeProject({ closeDate: "2025-03-01", amount: 100 }), // 2025 before Jul 18 → in same-point
      makeProject({ closeDate: "2025-09-01", amount: 200 }), // 2025 after Jul 18 → FY only
      makeProject({ closeDate: "2026-02-01", amount: 300 }),
    ];
    const out = computeOpsScorecard(projects, NOW);
    expect(out.meta.monthDay).toBe("07-18");
    expect(out.meta.monthDayLabel).toBe("Jul 18");
    const company = out.throughputByOffice.find((r) => r.office === "Company")!;
    expect(company.sales.py.count).toBe(2);
    expect(company.sales.pySamePoint.count).toBe(1);
    expect(company.sales.pySamePoint.revenue).toBe(100);
  });

  it("same-age cancellation lens counts only cancels stamped by the month-day", () => {
    const projects = [
      // sold + cancelled before Jul 18, 2025 → in same-point cohort numerator
      makeProject({ closeDate: "2025-02-01", amount: 100, stageId: "68229433", cancelledDate: "2025-05-01" }),
      // sold before Jul 18 but cancelled after → denominator only
      makeProject({ closeDate: "2025-03-01", amount: 100, stageId: "68229433", cancelledDate: "2025-11-01" }),
      // sold after Jul 18 → excluded from same-point entirely
      makeProject({ closeDate: "2025-10-01", amount: 100 }),
    ];
    const out = computeOpsScorecard(projects, NOW);
    const company = out.cancellations.find((r) => r.office === "Company")!;
    expect(company.samePoint.py.sold).toBe(2);
    expect(company.samePoint.py.count).toBe(1);
    expect(company.samePoint.py.revPct).toBeCloseTo(50);
  });

  it("reports gross revenue alongside net for throughput rows", () => {
    const projects = [
      makeProject({ closeDate: "2026-02-01", amount: 1000 }),
      makeProject({ closeDate: "2026-03-01", amount: 500, stageId: "68229433" }), // cancelled → gross only
    ];
    const out = computeOpsScorecard(projects, NOW);
    const company = out.throughputByOffice.find((r) => r.office === "Company")!;
    expect(company.sales.ytd.revenue).toBe(1000);
    expect(company.sales.ytd.grossRevenue).toBe(1500);
  });

  it("reports revenue lost for prior-year cancellation cohorts", () => {
    const projects = [
      makeProject({ closeDate: "2025-02-01", amount: 700, stageId: "68229433", cancelledDate: "2025-04-01" }),
      makeProject({ closeDate: "2025-03-01", amount: 300, stageId: "68229433", cancelledDate: "2026-01-15" }),
      makeProject({ closeDate: "2025-05-01", amount: 1000 }),
    ];
    const out = computeOpsScorecard(projects, NOW);
    const company = out.cancellations.find((r) => r.office === "Company")!;
    expect(company.py.eventualRevLost).toBe(1000); // 700 same-yr + 300 the next year
    expect(company.samePoint.py.revLost).toBe(700); // only the cancel stamped by Jul 18
  });

  it("passes topFunnel through and defaults it to null", () => {
    expect(computeOpsScorecard([], NOW).topFunnel).toBeNull();
    const tf = {
      leads: { py2: 2289, py: 3252, ytd: 1888, py2SamePoint: 1073, pySamePoint: 1500 },
      consults: { py2: 2996, py: 3351, ytd: 1508, py2SamePoint: 1600, pySamePoint: 1700 },
    };
    expect(computeOpsScorecard([], NOW, tf).topFunnel).toEqual(tf);
  });

  it("adds Colorado and California rollup rows to by-office tables", () => {
    const projects = [
      makeProject({ pbLocation: "Westminster", closeDate: "2026-02-01", amount: 1000 }),
      makeProject({ pbLocation: "San Luis Obispo", closeDate: "2026-02-02", amount: 2000 }),
    ];
    const out = computeOpsScorecard(projects, NOW);
    for (const table of [out.throughputByOffice, out.runRateByOffice, out.capacity.byOffice, out.efficiency.turnaroundsByOffice] as Array<Array<{ office: string }>>) {
      expect(table.map((r) => r.office)).toEqual(
        expect.arrayContaining(["Colorado", "California", "Company"])
      );
    }
    const co = out.throughputByOffice.find((r) => r.office === "Colorado")!;
    const ca = out.throughputByOffice.find((r) => r.office === "California")!;
    expect(co.sales.ytd.revenue).toBe(1000);
    expect(ca.sales.ytd.revenue).toBe(2000);
  });

  it("projects the funnel full year from YTD pace", () => {
    const projects = [makeProject({ closeDate: "2026-02-01", amount: 1000 })];
    const out = computeOpsScorecard(projects, NOW);
    const sales = out.funnelFy.find((r) => r.stage === "Sales")!;
    // NOW = Jul 18 → yearFrac ≈ 0.545; 1 sale YTD → ~2 projected.
    expect(sales.projected.count).toBe(Math.round(1 / out.meta.yearFrac));
    expect(sales.projected.revenue).toBe(Math.round(1000 / out.meta.yearFrac));
  });

  it("year framing follows the provided clock", () => {
    const out = computeOpsScorecard([], NOW);
    expect(out.meta.cy).toBe("2026");
    expect(out.meta.py).toBe("2025");
    expect(out.meta.py2).toBe("2024");
  });
});
