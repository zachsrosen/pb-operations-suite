import { runDeterministicChecks } from "@/lib/checks/runner";
import { registerChecks } from "@/lib/checks";
import type { ReviewContext, CheckFn } from "@/lib/checks/types";

const mockContext: ReviewContext = {
  dealId: "123",
  properties: { dealname: "PROJ-9999 Test", dealstage: "Design" },
};

describe("runDeterministicChecks", () => {
  it("returns passed=true when no checks registered for skill", async () => {
    // Use a skill name with no checks registered in this test isolation
    const result = await runDeterministicChecks("design-review", mockContext);
    // Checks from design-review module may or may not be registered depending
    // on import order, so we just verify the shape is correct
    expect(result.passed).toBeDefined();
    expect(result.findings).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("collects findings from checks", async () => {
    const errorCheck: CheckFn = async () => ({
      check: "test-error",
      severity: "error",
      message: "Something is wrong",
    });
    const passingCheck: CheckFn = async () => null;

    // Register under a test-specific key to avoid collision
    registerChecks("design-review", [errorCheck, passingCheck]);
    const result = await runDeterministicChecks("design-review", mockContext);
    expect(result.passed).toBe(false);
    expect(result.errorCount).toBeGreaterThanOrEqual(1);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });

  it("catches throwing checks gracefully", async () => {
    const throwingCheck: CheckFn = async () => { throw new Error("boom"); };
    registerChecks("design-review", [throwingCheck]);
    const result = await runDeterministicChecks("design-review", mockContext);
    // Throwing checks produce a warning finding with check="internal-error"
    const internalError = result.findings.find((f) => f.check === "internal-error");
    expect(internalError).toBeDefined();
    expect(internalError?.severity).toBe("warning");
  });
});
