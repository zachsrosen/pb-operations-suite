import { runChecks } from "@/lib/checks/runner";
import { registerChecks } from "@/lib/checks";
import type { ReviewContext, CheckFn } from "@/lib/checks/types";

const mockContext: ReviewContext = {
  dealId: "123",
  properties: { dealname: "PROJ-9999 Test", dealstage: "Design" },
};

describe("runChecks", () => {
  it("returns passed=true when no checks registered", async () => {
    const result = await runChecks("sales-advisor", mockContext);
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("collects findings from checks", async () => {
    const errorCheck: CheckFn = async () => ({
      check: "test-error",
      severity: "error",
      message: "Something is wrong",
    });
    const passingCheck: CheckFn = async () => null;

    registerChecks("engineering-review", [errorCheck, passingCheck]);
    const result = await runChecks("engineering-review", mockContext);
    expect(result.passed).toBe(false);
    expect(result.errorCount).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  it("catches throwing checks gracefully", async () => {
    const throwingCheck: CheckFn = async () => { throw new Error("boom"); };
    registerChecks("design-review", [throwingCheck]);
    const result = await runChecks("design-review", mockContext);
    expect(result.passed).toBe(true);
    expect(result.warningCount).toBe(1);
    expect(result.findings[0].check).toBe("internal-error");
  });
});
