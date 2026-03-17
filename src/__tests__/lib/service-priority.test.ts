import { scorePriorityItem, buildPriorityQueue, type PriorityItem, type PriorityScore } from "@/lib/service-priority";

describe("scorePriorityItem", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("scores a deal with warranty expiring + no contact as critical priority", () => {
    const item: PriorityItem = {
      id: "deal-0",
      type: "deal",
      title: "Service — Critical Test",
      stage: "Work In Progress",
      lastModified: new Date("2026-03-06T12:00:00Z").toISOString(), // 10 days ago
      lastContactDate: new Date("2026-03-06T12:00:00Z").toISOString(), // 10 days, no contact >7 days (+35)
      createDate: new Date("2026-03-01T12:00:00Z").toISOString(),
      amount: 15000, // >$10k (+10)
      location: "Denver",
      url: "https://app.hubspot.com/deals/0",
      warrantyExpiry: new Date("2026-03-19T12:00:00Z").toISOString(), // 3 days from now (+40)
    };
    const result = scorePriorityItem(item, now);
    // 40 (warranty) + 35 (no contact) + 20 (stage 10d) + 10 (value) + 10 (active overdue) = 100 (capped)
    expect(result.tier).toBe("critical");
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("scores a deal stuck in stage >3 days as medium priority", () => {
    const item: PriorityItem = {
      id: "deal-1",
      type: "deal",
      title: "Service — Smith",
      stage: "Site Visit Scheduling",
      lastModified: new Date("2026-03-10T12:00:00Z").toISOString(), // 6 days ago
      lastContactDate: new Date("2026-03-14T12:00:00Z").toISOString(), // 2 days ago
      createDate: new Date("2026-03-01T12:00:00Z").toISOString(),
      amount: 5000,
      location: "Denver",
      url: "https://app.hubspot.com/deals/1",
    };
    const result = scorePriorityItem(item, now);
    expect(result.tier).toBe("medium");
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.score).toBeLessThan(50);
  });

  it("scores a deal with no contact >7 days + stuck in stage as high priority", () => {
    const item: PriorityItem = {
      id: "deal-2",
      type: "deal",
      title: "Service — Garcia",
      stage: "Work In Progress",
      lastModified: new Date("2026-03-06T12:00:00Z").toISOString(), // 10 days ago (+20 stage)
      lastContactDate: new Date("2026-03-08T12:00:00Z").toISOString(), // 8 days ago (+35 no contact >7d)
      createDate: new Date("2026-03-01T12:00:00Z").toISOString(),
      amount: 8000, // +5
      location: "CO Springs",
      url: "https://app.hubspot.com/deals/2",
    };
    const result = scorePriorityItem(item, now);
    // 35 (no contact >7d) + 20 (stage 10d) + 5 (amount) + 10 (active overdue) = 70 → High
    expect(result.tier).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(75);
  });

  it("scores a recently contacted on-track deal as low priority", () => {
    const item: PriorityItem = {
      id: "deal-3",
      type: "deal",
      title: "Service — Williams",
      stage: "Work In Progress",
      lastModified: new Date("2026-03-16T10:00:00Z").toISOString(), // 2 hours ago
      lastContactDate: new Date("2026-03-15T12:00:00Z").toISOString(), // 1 day ago
      createDate: new Date("2026-03-10T12:00:00Z").toISOString(),
      amount: 3000,
      location: "Denver",
      url: "https://app.hubspot.com/deals/3",
    };
    const result = scorePriorityItem(item, now);
    expect(result.tier).toBe("low");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThan(25);
  });

  it("returns reasons array explaining the score", () => {
    const item: PriorityItem = {
      id: "deal-4",
      type: "deal",
      title: "Service — Test",
      stage: "Inspection",
      lastModified: new Date("2026-03-10T12:00:00Z").toISOString(),
      lastContactDate: new Date("2026-03-10T12:00:00Z").toISOString(),
      createDate: new Date("2026-03-01T12:00:00Z").toISOString(),
      amount: 10000,
      location: "Denver",
      url: "https://app.hubspot.com/deals/4",
    };
    const result = scorePriorityItem(item, now);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toBeTruthy();
  });
});

describe("buildPriorityQueue", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("applies manual override to change a low-scored item to critical", () => {
    const lowItem: PriorityItem = {
      id: "deal-low",
      type: "deal",
      title: "Service — Override Test",
      stage: "Work In Progress",
      lastModified: new Date("2026-03-16T10:00:00Z").toISOString(),
      lastContactDate: new Date("2026-03-15T12:00:00Z").toISOString(),
      createDate: new Date("2026-03-10T12:00:00Z").toISOString(),
      amount: 1000,
      location: "Denver",
    };

    const overrides = [
      { itemId: "deal-low", itemType: "deal", overridePriority: "critical" as const },
    ];

    const queue = buildPriorityQueue([lowItem], overrides, now);
    expect(queue).toHaveLength(1);
    expect(queue[0].tier).toBe("critical");
    expect(queue[0].overridden).toBe(true);
    expect(queue[0].reasons[0]).toContain("Manually set to critical");
  });

  it("sorts items by score descending", () => {
    const items: PriorityItem[] = [
      {
        id: "low", type: "deal", title: "Low", stage: "Work In Progress",
        lastModified: now.toISOString(), lastContactDate: now.toISOString(),
        createDate: now.toISOString(), amount: 1000, location: "Denver",
      },
      {
        id: "high", type: "deal", title: "High", stage: "Work In Progress",
        lastModified: new Date("2026-03-06T12:00:00Z").toISOString(),
        lastContactDate: new Date("2026-03-06T12:00:00Z").toISOString(),
        createDate: now.toISOString(), amount: 15000, location: "Denver",
      },
    ];

    const queue = buildPriorityQueue(items, [], now);
    expect(queue[0].item.id).toBe("high");
    expect(queue[1].item.id).toBe("low");
  });
});
