import { aggregatePageTraffic, type TrafficRow } from "@/lib/page-traffic";

const rows: TrafficRow[] = [
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/scheduler", userId: "u2", userEmail: "b@x.com", userName: "B", durationMs: null },
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
  { type: "PAGE_DWELL", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: 10000 },
  { type: "PAGE_DWELL", entityId: "/dashboards/scheduler", userId: "u2", userEmail: "b@x.com", userName: "B", durationMs: 20000 },
  { type: "FEATURE_USED", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/reviews/999", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
];

describe("aggregatePageTraffic", () => {
  const res = aggregatePageTraffic(rows);

  it("counts views, unique users, clicks, avg dwell per page (normalized)", () => {
    const sched = res.pages.find((p) => p.path === "/dashboards/scheduler")!;
    expect(sched.views).toBe(3);
    expect(sched.uniqueUsers).toBe(2);
    expect(sched.clicks).toBe(1);
    expect(sched.avgDwellMs).toBe(15000);
    expect(sched.suite).toBe("Operations");
  });

  it("normalizes dynamic review path", () => {
    expect(res.pages.some((p) => p.path === "/dashboards/reviews/[dealId]")).toBe(true);
  });

  it("totals reflect distinct users across all pages", () => {
    expect(res.totals.uniqueUsers).toBe(2);
    expect(res.totals.activePages).toBe(2);
    expect(res.totals.views).toBe(4);
  });

  it("rolls up suites", () => {
    const ops = res.suites.find((s) => s.suite === "Operations")!;
    expect(ops.views).toBe(3);
  });

  it("flags known pages with zero traffic as dead", () => {
    expect(res.deadPages.some((d) => d.path === "/dashboards/service-tickets")).toBe(true);
    expect(res.deadPages.some((d) => d.path === "/dashboards/scheduler")).toBe(false);
  });
});
