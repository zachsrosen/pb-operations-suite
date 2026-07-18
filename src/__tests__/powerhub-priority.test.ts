/**
 * Tests that PowerHub alert scoring integrates correctly.
 *
 * Scoring reads `highestAlertSeverity` — the field the priority-queue route
 * populates from PowerHub enrichment. (It previously read a separate
 * `powerhubAlertSeverity` field that nothing ever set, so alerts silently
 * never affected the score.)
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
    const item = { ...baseItem, highestAlertSeverity: "CRITICAL" as const };
    const result = scorePriorityItem(item);
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.reasons.some(r => r.includes("PowerHub"))).toBe(true);
  });

  it("should add 20 points for a Tesla RMA alert, ranked below critical", () => {
    const rma = scorePriorityItem({ ...baseItem, highestAlertSeverity: "RMA" as const });
    const critical = scorePriorityItem({ ...baseItem, highestAlertSeverity: "CRITICAL" as const });
    const performance = scorePriorityItem({ ...baseItem, highestAlertSeverity: "PERFORMANCE" as const });
    expect(rma.score).toBeGreaterThanOrEqual(20);
    expect(rma.reasons.some(r => r.includes("RMA"))).toBe(true);
    // Rank ordering: PERFORMANCE < RMA < CRITICAL
    expect(rma.score).toBeGreaterThan(performance.score);
    expect(rma.score).toBeLessThan(critical.score);
  });

  it("should add 10 points for a performance PowerHub alert", () => {
    const item = { ...baseItem, highestAlertSeverity: "PERFORMANCE" as const };
    const result = scorePriorityItem(item);
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it("should add nothing for an informational PowerHub alert", () => {
    const result = scorePriorityItem({ ...baseItem, highestAlertSeverity: "INFORMATIONAL" as const });
    expect(result.reasons.some(r => r.includes("PowerHub"))).toBe(false);
  });

  it("should add 0 points when no PowerHub alert", () => {
    const result = scorePriorityItem(baseItem);
    // Only other factors contribute
    expect(result.reasons.some(r => r.includes("PowerHub"))).toBe(false);
  });
});
