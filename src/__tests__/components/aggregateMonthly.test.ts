import { aggregateMonthly } from "@/components/ui/MonthlyBarChart";

describe("aggregateMonthly", () => {
  beforeEach(() => {
    // Pin system time so the 12-month rolling window is deterministic
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-23T12:00:00"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("buckets first-of-month dates into the correct month", () => {
    // 2026-03-01 should land in March, not February
    const items = [
      { date: "2026-03-01", amount: 1000 },
      { date: "2026-03-15", amount: 2000 },
      { date: "2026-02-28", amount: 500 },
    ];
    const result = aggregateMonthly(items, 12);
    const mar = result.find((r) => r.date.startsWith("2026-03"));
    const feb = result.find((r) => r.date.startsWith("2026-02"));

    expect(mar?.count).toBe(2); // both March dates
    expect(mar?.value).toBe(3000);
    expect(feb?.count).toBe(1); // only Feb 28
    expect(feb?.value).toBe(500);
  });

  it("handles null and undefined dates gracefully", () => {
    const items = [
      { date: null, amount: 100 },
      { date: undefined, amount: 200 },
      { date: "2026-01-15", amount: 300 },
    ];
    const result = aggregateMonthly(items, 12);
    const jan = result.find((r) => r.date.startsWith("2026-01"));
    expect(jan?.count).toBe(1);
  });
});
