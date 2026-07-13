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

describe("project funnel — Current Pipeline Position drill-down rows", () => {
  it("emits backlog-shaped rows: days-in-stage in daysWaiting, detail in status, staff fields present", () => {
    const result = buildProjectFunnelData(
      [
        makeProject({
          daysSinceStageMovement: 42,
          projectManager: "Pat PM",
          dealOwner: "Olive Owner",
          siteSurveyor: "Sam Surveyor",
        }),
      ],
      6
    );
    const stage = result.stageDistribution.find((s) => s.stageId === "20461936");
    expect(stage).toBeDefined();
    expect(stage!.deals).toHaveLength(1);
    const row = stage!.deals[0];
    expect(row.daysWaiting).toBe(42);
    expect(row.status).toBe("No status");
    expect(row.projectManager).toBe("Pat PM");
    expect(row.dealOwner).toBe("Olive Owner");
    expect(row.siteSurveyor).toBe("Sam Surveyor");
    expect(row.flag ?? null).toBeNull();
  });

  it("surfaces the on-hold reason as the status and carries the notes on the flag", () => {
    const result = buildProjectFunnelData(
      [
        makeProject({
          stageId: "20440344", // On Hold
          daysSinceStageMovement: 15,
          onHoldReason: "Financing",
          onHoldNotes: "Waiting on bank",
        }),
      ],
      6
    );
    const stage = result.stageDistribution.find((s) => s.stageId === "20440344");
    expect(stage).toBeDefined();
    const row = stage!.deals[0];
    expect(row.status).toBe("Financing");
    expect(row.daysWaiting).toBe(15);
    expect(row.flag).toMatchObject({
      label: "On hold",
      tone: "yellow",
      parked: true,
      reason: "Financing",
      note: "Waiting on bank",
    });
    // The bar segments group by the same reason the rows show.
    expect(stage!.statusBreakdown).toEqual([{ status: "Financing", count: 1 }]);
  });

  it("keeps a live days-in-stage clock for the Cancelled stage row", () => {
    const result = buildProjectFunnelData(
      [
        makeProject({
          stageId: "68229433", // Cancelled
          daysSinceStageMovement: 10,
          cancelledDate: iso(10),
        }),
      ],
      6
    );
    const stage = result.stageDistribution.find((s) => s.stageId === "68229433");
    expect(stage).toBeDefined();
    const row = stage!.deals[0];
    // liveDays: days in the Cancelled stage, not frozen to ~0 by the backlog's
    // stopped-at-cancellation clock.
    expect(row.daysWaiting).toBe(10);
    expect(row.status).toBe("Cancelled");
    expect(row.flag).toMatchObject({ label: "Cancelled", parked: true });
  });

  it("uses close_out_status for the Close Out stage row and the Awaiting Close Out backlog", () => {
    const result = buildProjectFunnelData(
      [
        makeProject({
          stageId: "24743347", // Close Out
          daysSinceStageMovement: 12,
          ptoGrantedDate: iso(30),
          closeOutStatus: "Waiting on Payment",
        }),
      ],
      6
    );
    // Current Pipeline Position: the stage row + its status breakdown.
    const stage = result.stageDistribution.find((s) => s.stageId === "24743347");
    expect(stage).toBeDefined();
    expect(stage!.deals[0].status).toBe("Waiting on Payment");
    expect(stage!.statusBreakdown).toEqual([{ status: "Waiting on Payment", count: 1 }]);
    // Awaiting Close Out backlog bucket carries the same status.
    expect(result.drillDown.awaitingCloseOut).toHaveLength(1);
    expect(result.drillDown.awaitingCloseOut[0].status).toBe("Waiting on Payment");
  });
});
