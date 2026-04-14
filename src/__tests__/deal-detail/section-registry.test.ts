jest.mock("@/lib/db", () => ({ prisma: null }));

import { getSectionsForPipeline, getStageColor } from "@/components/deal-detail/section-registry";
import { STAGE_COLORS } from "@/lib/constants";

describe("getSectionsForPipeline", () => {
  it("returns all 'all' sections plus project-specific for PROJECT", () => {
    const sections = getSectionsForPipeline("PROJECT");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("project-details");
    expect(keys).toContain("milestone-dates");
    expect(keys).toContain("status-details");
    expect(keys).not.toContain("qc-metrics");
    expect(keys).not.toContain("revision-counts");
    expect(keys).not.toContain("incentive-programs");
    expect(keys).not.toContain("service-details");
    expect(keys).not.toContain("roofing-details");
  });

  it("includes service-details for SERVICE pipeline", () => {
    const sections = getSectionsForPipeline("SERVICE");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("service-details");
    expect(keys).toContain("project-details");
  });

  it("includes roofing-details for DNR pipeline", () => {
    const sections = getSectionsForPipeline("DNR");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("roofing-details");
  });

  it("includes roofing-details for ROOFING pipeline", () => {
    const sections = getSectionsForPipeline("ROOFING");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("roofing-details");
  });

  it("returns at least project-details for SALES pipeline", () => {
    const sections = getSectionsForPipeline("SALES");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("project-details");
  });

  it("returns correct default open states", () => {
    const sections = getSectionsForPipeline("PROJECT");
    const projectDetails = sections.find(s => s.key === "project-details");
    const installPlanning = sections.find(s => s.key === "install-planning");
    expect(projectDetails?.defaultOpen).toBe(true);
    expect(installPlanning?.defaultOpen).toBe(false);
  });
});

describe("getStageColor", () => {
  it("returns known color for project pipeline stages", () => {
    const color = getStageColor("PROJECT", "Construction", []);
    expect(color).toBe(STAGE_COLORS["Construction"].hex);
  });

  it("returns fallback zinc for unknown project stage", () => {
    const color = getStageColor("PROJECT", "Unknown Stage", []);
    expect(color).toBe("#71717A");
  });

  it("returns position-based color for non-project pipeline", () => {
    const stageOrder = ["Step 1", "Step 2", "Step 3", "Closed Won", "Closed Lost"];
    const color1 = getStageColor("SERVICE", "Step 1", stageOrder);
    const color2 = getStageColor("SERVICE", "Step 3", stageOrder);
    expect(color1).toBeDefined();
    expect(color2).toBeDefined();
    expect(color1).not.toBe(color2);
  });

  it("returns green for terminal won stages", () => {
    const stageOrder = ["Active", "Closed Won", "Closed Lost"];
    const color = getStageColor("SERVICE", "Closed Won", stageOrder);
    expect(color).toBe("#22C55E");
  });

  it("returns gray for terminal lost stages", () => {
    const stageOrder = ["Active", "Closed Won", "Closed Lost"];
    const color = getStageColor("SERVICE", "Closed Lost", stageOrder);
    expect(color).toBe("#71717A");
  });
});
