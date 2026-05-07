/**
 * Tests that PowerHub alert scoring integrates correctly.
 */
import { scorePriorityItem, type PriorityItem } from "@/lib/service-priority";

describe("PowerHub Alert Scoring", () => {
  const baseItem: PriorityItem = {
    id: "deal-1",
    type: "deal",
    title: "Test Service Deal",
    stage: "Warranty Claim",
    lastModified: new Date().toISOString(),
    createDate: new Date().toISOString(),
  };

  it("should add 25 points for a critical PowerHub alert", () => {
    const item = { ...baseItem, powerhubAlertSeverity: "CRITICAL" as const };
    const result = scorePriorityItem(item);
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.reasons.some(r => r.includes("PowerHub"))).toBe(true);
  });

  it("should add 10 points for a performance PowerHub alert", () => {
    const item = { ...baseItem, powerhubAlertSeverity: "PERFORMANCE" as const };
    const result = scorePriorityItem(item);
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it("should add 0 points when no PowerHub alert", () => {
    const result = scorePriorityItem(baseItem);
    // Only other factors contribute
    expect(result.reasons.some(r => r.includes("PowerHub"))).toBe(false);
  });
});
