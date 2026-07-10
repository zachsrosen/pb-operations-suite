/**
 * Tests that total item age (time since createDate) contributes to priority
 * scoring, so long-open tickets outrank recently-created ones instead of
 * plateauing on the no-contact / stuck-in-stage factors.
 */
import { scorePriorityItem, type PriorityItem } from "@/lib/service-priority";

const NOW = new Date("2026-07-10T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("Item Age Scoring", () => {
  const baseItem: PriorityItem = {
    id: "ticket-1",
    type: "ticket",
    title: "Test Service Ticket",
    stage: "Site Visit Needed",
    lastModified: NOW.toISOString(),
    createDate: NOW.toISOString(),
  };

  it("adds no age points for an item under 30 days old", () => {
    const result = scorePriorityItem({ ...baseItem, createDate: daysAgo(29) }, NOW);
    expect(result.score).toBe(0);
    expect(result.reasons.some(r => r.startsWith("Open for"))).toBe(false);
  });

  it("adds 5 points at 30 days old", () => {
    const result = scorePriorityItem({ ...baseItem, createDate: daysAgo(30) }, NOW);
    expect(result.score).toBe(5);
    expect(result.reasons).toContain("Open for 30 days");
  });

  it("adds 10 points at 90 days old", () => {
    const result = scorePriorityItem({ ...baseItem, createDate: daysAgo(90) }, NOW);
    expect(result.score).toBe(10);
    expect(result.reasons).toContain("Open for 90 days");
  });

  it("adds 15 points at 180 days old", () => {
    const result = scorePriorityItem({ ...baseItem, createDate: daysAgo(180) }, NOW);
    expect(result.score).toBe(15);
    expect(result.reasons).toContain("Open for 180 days");
  });

  it("adds 20 points at 365+ days old", () => {
    const result = scorePriorityItem({ ...baseItem, createDate: daysAgo(478) }, NOW);
    expect(result.score).toBe(20);
    expect(result.reasons).toContain("Open for 478 days");
  });

  it("tags the score with the item_age reason category", () => {
    const result = scorePriorityItem({ ...baseItem, createDate: daysAgo(400) }, NOW);
    expect(result.reasonCategories).toContain("item_age");
  });

  it("ignores an invalid createDate without adding points or reasons", () => {
    const result = scorePriorityItem({ ...baseItem, createDate: "not-a-date" }, NOW);
    expect(result.score).toBe(0);
    expect(result.reasons.some(r => r.startsWith("Open for"))).toBe(false);
  });

  it("ranks an old ticket above an otherwise-identical fresh one", () => {
    const old = scorePriorityItem(
      { ...baseItem, createDate: daysAgo(478), lastContactDate: daysAgo(478), lastModified: daysAgo(48) },
      NOW
    );
    const fresh = scorePriorityItem(
      { ...baseItem, id: "ticket-2", createDate: daysAgo(8), lastContactDate: daysAgo(8), lastModified: daysAgo(8) },
      NOW
    );
    expect(old.score).toBeGreaterThan(fresh.score);
  });
});
