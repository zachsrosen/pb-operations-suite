import "@/lib/checks/engineering-review";
import { runChecks } from "@/lib/checks/runner";

describe("Engineering Review Checks", () => {
  it("passes with all properties set", async () => {
    const result = await runChecks("engineering-review", {
      dealId: "123",
      properties: { permitting_status: "Submitted", inspection_date: "2026-05-01" },
    });
    expect(result.passed).toBe(true);
  });

  it("flags missing permitting status", async () => {
    const result = await runChecks("engineering-review", {
      dealId: "123",
      properties: { permitting_status: null, inspection_date: "2026-05-01" },
    });
    expect(result.findings.find((f) => f.check === "permitting-status-set")).toBeTruthy();
  });
});
