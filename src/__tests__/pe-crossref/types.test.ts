import { TASK_SEVERITY, TASK_CATEGORY, TASK_STATUS } from "@/lib/pe-crossref/types";

describe("pe-crossref types", () => {
  it("exports severity tier list (used for UI ordering + DB validation)", () => {
    expect(TASK_SEVERITY).toEqual(["critical", "major", "conditional", "monitoring"]);
  });

  it("exports category list aligned to analyzer families", () => {
    expect(TASK_CATEGORY).toEqual(["hardware", "so", "planset", "photo", "monitoring"]);
  });

  it("exports task status state machine values", () => {
    expect(TASK_STATUS).toEqual(["OPEN", "RESOLVED_AUTO", "RESOLVED_MANUAL", "DISMISSED"]);
  });
});
