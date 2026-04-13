/**
 * Test the groupItemsByDeal helper used by SearchResultsList.
 * Verifies cross-page merge: a deal split across two pages
 * produces one group with the correct meeting count.
 */

import { groupItemsByDeal, type DealGroup } from "@/app/dashboards/idr-meeting/SearchResultsList";

describe("groupItemsByDeal", () => {
  const makeItem = (dealId: string, dealName: string, conclusion: string | null, sessionDate: string) => ({
    dealId,
    dealName,
    region: "DTC",
    systemSizeKw: 8,
    projectType: "Solar",
    conclusion,
    session: { date: sessionDate, status: "COMPLETED" },
  });

  it("groups items by dealId", () => {
    const items = [
      makeItem("d1", "Smith", "Approved", "2026-04-07"),
      makeItem("d1", "Smith", "Hold for battery", "2026-03-31"),
      makeItem("d2", "Jones", "Go ahead", "2026-04-07"),
    ];

    const groups = groupItemsByDeal(items, new Map());
    expect(groups.size).toBe(2);
    expect(groups.get("d1")!.meetingCount).toBe(2);
    expect(groups.get("d2")!.meetingCount).toBe(1);
  });

  it("merges new items into existing groups (cross-page)", () => {
    const page1 = [
      makeItem("d1", "Smith", "Approved", "2026-04-07"),
      makeItem("d1", "Smith", "Hold", "2026-03-31"),
    ];
    const existing = groupItemsByDeal(page1, new Map());

    const page2 = [
      makeItem("d1", "Smith", "Initial review", "2026-03-10"),
      makeItem("d3", "Lee", "Standard", "2026-04-01"),
    ];
    const merged = groupItemsByDeal(page2, existing);

    expect(merged.get("d1")!.meetingCount).toBe(3);
    expect(merged.get("d1")!.conclusions).toHaveLength(3);
    expect(merged.get("d3")!.meetingCount).toBe(1);
  });

  it("deduplicates conclusions by session date", () => {
    const items = [
      makeItem("d1", "Smith", "Same conclusion", "2026-04-07"),
      makeItem("d1", "Smith", "Same conclusion", "2026-04-07"), // duplicate row
    ];
    const groups = groupItemsByDeal(items, new Map());
    expect(groups.get("d1")!.conclusions).toHaveLength(1);
  });
});
