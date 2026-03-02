import { registerChecks, getChecks, getRegisteredSkills } from "@/lib/checks";
import type { CheckFn, ReviewContext } from "@/lib/checks/types";

describe("Check Engine Registry", () => {
  it("returns empty array for unregistered skill", () => {
    expect(getChecks("sales-advisor")).toEqual([]);
  });

  it("registers and retrieves checks", () => {
    const mockCheck: CheckFn = async (_ctx: ReviewContext) => null;
    registerChecks("design-review", [mockCheck]);
    expect(getChecks("design-review")).toHaveLength(1);
    expect(getRegisteredSkills()).toContain("design-review");
  });
});
