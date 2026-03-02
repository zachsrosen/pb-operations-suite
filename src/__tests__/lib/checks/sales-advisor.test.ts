import "@/lib/checks/sales-advisor";
import { runChecks } from "@/lib/checks/runner";

describe("Sales Advisor Checks", () => {
  it("flags unusually low amount", async () => {
    const result = await runChecks("sales-advisor", {
      dealId: "123",
      properties: { amount: "3000", closedate: "2026-06-01" },
    });
    expect(result.findings.find((f) => f.check === "deal-amount-low")).toBeTruthy();
  });

  it("passes with normal amount and close date", async () => {
    const result = await runChecks("sales-advisor", {
      dealId: "123",
      properties: { amount: "45000", closedate: "2026-06-01" },
    });
    expect(result.passed).toBe(true);
    expect(result.errorCount).toBe(0);
  });
});
