import { computeDnrRoofingHealth } from "@/lib/shop-health-dnr-roofing";
import type { Project } from "@/lib/hubspot";

function makeDeal(over: Partial<Project> & { id: number; stageId: string }): Project {
  const base: Partial<Project> = {
    name: "Test",
    projectNumber: "P",
    pbLocation: "Westminster",
    ahj: "",
    utility: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    projectType: "",
    stage: "",
    pipelineId: "21997330",
    amount: 0,
    url: "",
    daysSinceStageMovement: 0,
  };
  return { ...base, ...over } as Project;
}

describe("computeDnrRoofingHealth", () => {
  const weekStart = new Date("2026-05-25T00:00:00Z");

  it("returns zeros for empty inputs", () => {
    const { section } = computeDnrRoofingHealth([], [], weekStart);
    expect(section.dnrActive).toBe(0);
    expect(section.roofingActive).toBe(0);
    expect(section.unknownDnrStageCount).toBe(0);
    expect(section.unknownRoofingStageCount).toBe(0);
  });

  it("buckets D&R deals by stage", () => {
    const dnrDeals = [
      makeDeal({ id: 1, stageId: "52474739" }), // Kickoff → preDetach
      makeDeal({ id: 2, stageId: "52474743" }), // Detach → detachInProgress
      makeDeal({ id: 3, stageId: "78412639" }), // Reset Blocked
      makeDeal({ id: 4, stageId: "68245827" }), // Complete → terminal
    ];
    const { section } = computeDnrRoofingHealth(dnrDeals, [], weekStart);
    expect(section.dnrPreDetach).toBe(1);
    expect(section.dnrDetachInProgress).toBe(1);
    expect(section.dnrResetBlocked).toBe(1);
    expect(section.dnrActive).toBe(3);
  });

  it("buckets Roofing deals by stage", () => {
    const roofingDeals = [
      makeDeal({ id: 10, stageId: "1117662745", pipelineId: "765928545" }),
      makeDeal({ id: 11, stageId: "1215078281", pipelineId: "765928545" }),
      makeDeal({ id: 12, stageId: "1215078285", pipelineId: "765928545" }),
    ];
    const { section } = computeDnrRoofingHealth([], roofingDeals, weekStart);
    expect(section.roofPreProduction).toBe(1);
    expect(section.roofInProduction).toBe(1);
    expect(section.roofingActive).toBe(2);
  });

  it("counts stuck deals >14 days in current stage", () => {
    const dnrDeals = [
      makeDeal({ id: 1, stageId: "52474743", daysSinceStageMovement: 20 }),
      makeDeal({ id: 2, stageId: "52474743", daysSinceStageMovement: 5 }),
    ];
    const { section } = computeDnrRoofingHealth(dnrDeals, [], weekStart);
    expect(section.stuckDnrJobs).toBe(1);
  });

  it("tracks unknown stage IDs separately", () => {
    const dnrDeals = [makeDeal({ id: 1, stageId: "99999999" })];
    const { section } = computeDnrRoofingHealth(dnrDeals, [], weekStart);
    expect(section.unknownDnrStageCount).toBe(1);
    expect(section.dnrActive).toBe(0);
  });
});
