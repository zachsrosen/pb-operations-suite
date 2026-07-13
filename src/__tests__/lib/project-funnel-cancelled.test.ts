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
    closeDate: iso(60),
    pbLocation: "Centennial",
    ...overrides,
  } as Project;
}

// A deal that got its survey done, then cancelled — stalled at the DA Send gate.
function cancelledAtDaSend(): Project {
  return makeProject({
    stageId: "68229433", // Cancelled
    siteSurveyScheduleDate: iso(50),
    siteSurveyCompletionDate: iso(45),
    cancelledDate: iso(10),
  });
}

describe("project funnel — cancelled deals in the backlog drill-down", () => {
  it("places a shown cancelled deal in the bucket where it stalled, flagged red", () => {
    const result = buildProjectFunnelData([cancelledAtDaSend()], 6);
    expect(result.drillDown.awaitingDaSend).toHaveLength(1);
    const deal = result.drillDown.awaitingDaSend[0];
    expect(deal.status).toBe("Cancelled");
    expect(deal.flag).toMatchObject({ label: "Cancelled", tone: "red", parked: true });
    // Its wait ends at cancellation: survey done 45d ago, cancelled 10d ago → 35d.
    expect(deal.daysWaiting).toBe(35);
    // The wait started when it hit the prior milestone (survey completion).
    expect(deal.waitingSince).toBe(iso(45));
    // Counted as cancelled (not active) at the milestones it reached.
    expect(result.summary.salesClosed.cancelledCount).toBe(1);
    expect(result.summary.salesClosed.count).toBe(0);
  });

  it("drops cancelled deals everywhere when includeCancelled is false", () => {
    const result = buildProjectFunnelData([cancelledAtDaSend()], 6, undefined, undefined, undefined, {
      includeCancelled: false,
    });
    expect(result.drillDown.awaitingDaSend).toHaveLength(0);
    expect(result.summary.salesClosed.cancelledCount).toBe(0);
    expect(result.summary.salesClosed.count).toBe(0);
  });

  it("never includes cancelled deals in the active scope", () => {
    const result = buildProjectFunnelData([cancelledAtDaSend()], 6, undefined, undefined, undefined, {
      scope: "active",
    });
    expect(result.drillDown.awaitingDaSend).toHaveLength(0);
    expect(result.summary.salesClosed.cancelledCount).toBe(0);
  });

  it("leaves active deals' buckets and flags untouched", () => {
    const active = makeProject({
      siteSurveyScheduleDate: iso(50),
      siteSurveyCompletionDate: iso(45),
    });
    const result = buildProjectFunnelData([active, cancelledAtDaSend()], 6);
    expect(result.drillDown.awaitingDaSend).toHaveLength(2);
    const activeRow = result.drillDown.awaitingDaSend.find((d) => !d.flag);
    expect(activeRow).toBeDefined();
    expect(activeRow!.status).not.toBe("Cancelled");
    expect(result.summary.salesClosed.count).toBe(1);
    expect(result.summary.salesClosed.cancelledCount).toBe(1);
  });
});
