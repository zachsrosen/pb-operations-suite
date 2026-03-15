import { ACTIVE_STAGES, DEAL_STAGE_MAP } from "@/lib/hubspot";

describe("ACTIVE_STAGES contract", () => {
  it("includes On Hold", () => {
    expect(ACTIVE_STAGES).toContain("On Hold");
  });

  it("includes Project Rejected - Needs Review", () => {
    expect(ACTIVE_STAGES).toContain("Project Rejected - Needs Review");
  });

  it("does NOT include Project Complete", () => {
    expect(ACTIVE_STAGES).not.toContain("Project Complete");
  });

  it("does NOT include Cancelled", () => {
    expect(ACTIVE_STAGES).not.toContain("Cancelled");
  });

  it("covers all DEAL_STAGE_MAP stages except Project Complete and Cancelled", () => {
    const inactiveStages = ["Project Complete", "Cancelled"];
    const mappedStages = Object.values(DEAL_STAGE_MAP);

    for (const stage of mappedStages) {
      if (inactiveStages.includes(stage)) {
        expect(ACTIVE_STAGES).not.toContain(stage);
      } else {
        expect(ACTIVE_STAGES).toContain(stage);
      }
    }
  });
});
