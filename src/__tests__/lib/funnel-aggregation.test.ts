import { buildFunnelData } from "@/lib/funnel-aggregation";
import type { Project } from "@/lib/hubspot";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: Math.floor(Math.random() * 100000),
    name: "Test Deal",
    stageId: "20461937",
    amount: 50000,
    closeDate: "2026-02-15",
    siteSurveyCompletionDate: null,
    designApprovalSentDate: null,
    designApprovalDate: null,
    pbLocation: "Centennial",
    ...overrides,
  } as Project;
}

describe("buildFunnelData", () => {
  it("returns empty funnel when no projects", () => {
    const result = buildFunnelData([], 6);
    expect(result.summary.salesClosed.count).toBe(0);
    expect(result.cohorts).toHaveLength(0);
  });

  it("counts a deal with closeDate as salesClosed only", () => {
    const projects = [makeProject({ closeDate: "2026-02-10" })];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.count).toBe(1);
    expect(result.summary.salesClosed.amount).toBe(50000);
    expect(result.summary.surveyDone.count).toBe(0);
    expect(result.summary.daSent.count).toBe(0);
    expect(result.summary.daApproved.count).toBe(0);
  });

  it("counts a deal with all milestones through all stages", () => {
    const projects = [
      makeProject({
        closeDate: "2026-02-10",
        siteSurveyCompletionDate: "2026-02-20",
        designApprovalSentDate: "2026-02-28",
        designApprovalDate: "2026-03-05",
      }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.count).toBe(1);
    expect(result.summary.surveyDone.count).toBe(1);
    expect(result.summary.daSent.count).toBe(1);
    expect(result.summary.daApproved.count).toBe(1);
  });

  it("tracks cancelled deals separately via stageId 68229433", () => {
    const projects = [
      makeProject({
        closeDate: "2026-02-10",
        siteSurveyCompletionDate: "2026-02-20",
        stageId: "68229433",
      }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.cancelledCount).toBe(1);
    expect(result.summary.salesClosed.cancelledAmount).toBe(50000);
    expect(result.summary.surveyDone.cancelledCount).toBe(1);
    expect(result.summary.salesClosed.count).toBe(0);
    expect(result.summary.surveyDone.count).toBe(0);
  });

  it("groups deals into monthly cohorts by closeDate", () => {
    const projects = [
      makeProject({ closeDate: "2026-01-15", amount: 30000 }),
      makeProject({ closeDate: "2026-01-20", amount: 40000 }),
      makeProject({ closeDate: "2026-02-10", amount: 50000 }),
    ];
    const result = buildFunnelData(projects, 6);
    const jan = result.cohorts.find((c) => c.month === "2026-01");
    const feb = result.cohorts.find((c) => c.month === "2026-02");
    expect(jan?.salesClosed.count).toBe(2);
    expect(jan?.salesClosed.amount).toBe(70000);
    expect(feb?.salesClosed.count).toBe(1);
    expect(feb?.salesClosed.amount).toBe(50000);
  });

  it("cohorts are sorted newest-first", () => {
    const projects = [
      makeProject({ closeDate: "2026-01-15" }),
      makeProject({ closeDate: "2026-03-10" }),
      makeProject({ closeDate: "2026-02-10" }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.cohorts[0].month).toBe("2026-03");
    expect(result.cohorts[1].month).toBe("2026-02");
    expect(result.cohorts[2].month).toBe("2026-01");
  });

  it("filters by canonical location when provided", () => {
    const projects = [
      makeProject({ closeDate: "2026-02-10", pbLocation: "Centennial" }),
      makeProject({ closeDate: "2026-02-12", pbLocation: "Westminster" }),
    ];
    const result = buildFunnelData(projects, 6, "Westminster");
    expect(result.summary.salesClosed.count).toBe(1);
  });

  it("normalizes raw pbLocation aliases to canonical before filtering", () => {
    const projects = [
      makeProject({ closeDate: "2026-02-10", pbLocation: "Denver Tech Center" }),
      makeProject({ closeDate: "2026-02-12", pbLocation: "Westminster" }),
    ];
    // "Denver Tech Center" normalizes to "Centennial" — filtering by Centennial should match it
    const result = buildFunnelData(projects, 6, "Centennial");
    expect(result.summary.salesClosed.count).toBe(1);
    expect(result.summary.salesClosed.amount).toBe(50000);
  });

  it("excludes deals outside the months lookback window", () => {
    const projects = [
      makeProject({ closeDate: "2024-01-01" }),
      makeProject({ closeDate: "2026-03-01" }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.count).toBe(1);
  });

  it("computes median days between stages", () => {
    const projects = [
      makeProject({
        closeDate: "2026-02-01",
        siteSurveyCompletionDate: "2026-02-11",
      }),
      makeProject({
        closeDate: "2026-02-05",
        siteSurveyCompletionDate: "2026-02-25",
      }),
      makeProject({
        closeDate: "2026-02-10",
        siteSurveyCompletionDate: "2026-02-16",
      }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.medianDays.closedToSurvey).toBe(10);
  });

  it("treats Project Rejected (20461935) as active, not cancelled", () => {
    const projects = [
      makeProject({
        closeDate: "2026-02-10",
        stageId: "20461935",
      }),
    ];
    const result = buildFunnelData(projects, 6);
    expect(result.summary.salesClosed.count).toBe(1);
    expect(result.summary.salesClosed.cancelledCount).toBe(0);
  });
});
