import "@/lib/checks/design-review";
import { runChecks } from "@/lib/checks/runner";
import type { ReviewContext } from "@/lib/checks/types";

function makeContext(overrides: Record<string, string | null> = {}): ReviewContext {
  return {
    dealId: "123",
    properties: {
      dealname: "PROJ-9015 Turner Solar",
      design_status: "Design Complete",
      pb_location: "Westminster",
      amount: "45000",
      site_survey_status: "Complete",
      install_date: "2026-04-15",
      ...overrides,
    },
  };
}

describe("Design Review Checks", () => {
  it("passes when all properties are set correctly", async () => {
    const result = await runChecks("design-review", makeContext());
    expect(result.passed).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("flags missing PROJ-XXXX in dealname", async () => {
    const result = await runChecks("design-review", makeContext({ dealname: "Turner Solar" }));
    expect(result.findings.find((f) => f.check === "project-id-format")).toBeTruthy();
    expect(result.passed).toBe(false);
  });

  it("flags design_status not started", async () => {
    const result = await runChecks("design-review", makeContext({ design_status: "Not Started" }));
    expect(result.findings.find((f) => f.check === "design-status-set")).toBeTruthy();
  });

  it("flags missing site survey as error", async () => {
    const result = await runChecks("design-review", makeContext({ site_survey_status: null }));
    const finding = result.findings.find((f) => f.check === "site-survey-complete");
    expect(finding?.severity).toBe("error");
  });

  it("flags missing amount as warning not error", async () => {
    const result = await runChecks("design-review", makeContext({ amount: "0" }));
    const finding = result.findings.find((f) => f.check === "amount-set");
    expect(finding?.severity).toBe("warning");
    expect(result.passed).toBe(true);
  });

  it("flags missing install date as info", async () => {
    const result = await runChecks("design-review", makeContext({ install_date: null }));
    const finding = result.findings.find((f) => f.check === "install-date-set");
    expect(finding?.severity).toBe("info");
  });
});
