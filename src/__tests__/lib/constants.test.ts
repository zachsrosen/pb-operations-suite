import {
  STAGE_ORDER,
  STAGE_ORDER_ASC,
  STAGE_COLORS,
  LOCATION_COLORS,
  LOCATION_COLOR_CLASSES,
  SALES_STAGES,
  ACTIVE_SALES_STAGES,
  DNR_STAGES,
  SERVICE_STAGES,
} from "@/lib/constants";

describe("STAGE_ORDER", () => {
  it("contains all expected pipeline stages", () => {
    expect(STAGE_ORDER).toContain("Close Out");
    expect(STAGE_ORDER).toContain("Permission To Operate");
    expect(STAGE_ORDER).toContain("Inspection");
    expect(STAGE_ORDER).toContain("Construction");
    expect(STAGE_ORDER).toContain("Ready To Build");
    expect(STAGE_ORDER).toContain("RTB - Blocked");
    expect(STAGE_ORDER).toContain("Permitting & Interconnection");
    expect(STAGE_ORDER).toContain("Design & Engineering");
    expect(STAGE_ORDER).toContain("Site Survey");
    expect(STAGE_ORDER).toContain("Project Rejected - Needs Review");
  });

  it("has Close Out at the top (most progressed)", () => {
    expect(STAGE_ORDER[0]).toBe("Close Out");
  });

  it("has 10 stages", () => {
    expect(STAGE_ORDER).toHaveLength(10);
  });
});

describe("STAGE_ORDER_ASC", () => {
  it("is the reverse of STAGE_ORDER", () => {
    expect(STAGE_ORDER_ASC).toEqual([...STAGE_ORDER].reverse());
  });

  it("has Site Survey first (ascending from least progressed)", () => {
    expect(STAGE_ORDER_ASC[0]).toBe("Project Rejected - Needs Review");
  });
});

describe("STAGE_COLORS", () => {
  it("has tw and hex for every stage in STAGE_ORDER", () => {
    for (const stage of STAGE_ORDER) {
      expect(STAGE_COLORS[stage]).toBeDefined();
      expect(STAGE_COLORS[stage].tw).toMatch(/^bg-/);
      expect(STAGE_COLORS[stage].hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("LOCATION_COLORS", () => {
  it("has colors for known locations", () => {
    const expectedLocations = [
      "Westminster",
      "Centennial",
      "Colorado Springs",
      "San Luis Obispo",
      "Camarillo",
    ];
    for (const loc of expectedLocations) {
      expect(LOCATION_COLORS[loc]).toBeDefined();
      expect(LOCATION_COLORS[loc].hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("LOCATION_COLOR_CLASSES", () => {
  it("is a non-empty array of Tailwind bg classes", () => {
    expect(LOCATION_COLOR_CLASSES.length).toBeGreaterThan(0);
    for (const cls of LOCATION_COLOR_CLASSES) {
      expect(cls).toMatch(/^bg-/);
    }
  });
});

describe("SALES_STAGES", () => {
  it("contains Closed won and Closed lost", () => {
    expect(SALES_STAGES).toContain("Closed won");
    expect(SALES_STAGES).toContain("Closed lost");
  });

  it("has 8 stages", () => {
    expect(SALES_STAGES).toHaveLength(8);
  });
});

describe("ACTIVE_SALES_STAGES", () => {
  it("does NOT include Closed won or Closed lost", () => {
    expect(ACTIVE_SALES_STAGES).not.toContain("Closed won");
    expect(ACTIVE_SALES_STAGES).not.toContain("Closed lost");
  });

  it("is a subset of SALES_STAGES", () => {
    for (const stage of ACTIVE_SALES_STAGES) {
      expect(SALES_STAGES).toContain(stage);
    }
  });
});

describe("DNR_STAGES", () => {
  it("contains expected D&R stages", () => {
    expect(DNR_STAGES).toContain("Kickoff");
    expect(DNR_STAGES).toContain("Complete");
    expect(DNR_STAGES).toContain("Cancelled");
  });

  it("has 15 stages", () => {
    expect(DNR_STAGES).toHaveLength(15);
  });
});

describe("SERVICE_STAGES", () => {
  it("contains expected service stages", () => {
    expect(SERVICE_STAGES).toContain("Project Preparation");
    expect(SERVICE_STAGES).toContain("Completed");
    expect(SERVICE_STAGES).toContain("Cancelled");
  });

  it("has 7 stages", () => {
    expect(SERVICE_STAGES).toHaveLength(7);
  });
});
