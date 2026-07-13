import { buildProjectFunnelData } from "@/lib/project-funnel-aggregation";
import type { Project } from "@/lib/hubspot";

/** ISO date N days ago, local time (matches the lib's date-only handling). */
function iso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: Math.floor(Math.random() * 100000),
    name: "Test Deal",
    stageId: "20461936", // Site Survey
    amount: 50000,
    closeDate: iso(90),
    pbLocation: "Centennial",
    ...overrides,
  } as Project;
}

// A New Construction deal parked early in the pipeline (awaiting survey schedule)
// for a long time — the home isn't built yet.
function newConstructionAwaitingSurvey(): Project {
  return makeProject({ isNewConstruction: true, closeDate: iso(120) });
}

describe("project funnel — New Construction indicator + toggle", () => {
  it("flags New Construction deals as parked (badge + excluded from aging)", () => {
    const result = buildProjectFunnelData([newConstructionAwaitingSurvey()], 6);
    expect(result.drillDown.awaitingSurveySchedule).toHaveLength(1);
    const deal = result.drillDown.awaitingSurveySchedule[0];
    expect(deal.flag).toMatchObject({ label: "New Construction", tone: "blue", parked: true });
  });

  it("hides New Construction deals when includeNewConstruction is false", () => {
    const result = buildProjectFunnelData([newConstructionAwaitingSurvey()], 6, undefined, undefined, undefined, {
      includeNewConstruction: false,
    });
    expect(result.drillDown.awaitingSurveySchedule).toHaveLength(0);
    expect(result.summary.salesClosed.count).toBe(0);
  });

  it("keeps New Construction deals by default (toggle shown)", () => {
    const result = buildProjectFunnelData([newConstructionAwaitingSurvey()], 6);
    expect(result.summary.salesClosed.count).toBe(1);
  });

  it("lets a more urgent flag win over New Construction (On Hold takes precedence)", () => {
    // On Hold stage + NC tag → the On Hold flag should win, not New Construction.
    const result = buildProjectFunnelData(
      [makeProject({ isNewConstruction: true, stageId: "20440344", onHoldReason: "Financing" })],
      6
    );
    const deal = result.drillDown.awaitingSurveySchedule[0];
    expect(deal.flag).toMatchObject({ label: "On hold", parked: true });
  });
});
