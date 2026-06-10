import { aggregatePageTraffic, type TrafficRow } from "@/lib/page-traffic";

const rows: TrafficRow[] = [
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/scheduler", userId: "u2", userEmail: "b@x.com", userName: "B", durationMs: null },
  { type: "DASHBOARD_VIEWED", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
  { type: "PAGE_DWELL", entityId: "/dashboards/scheduler", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: 10000 },
  { type: "PAGE_DWELL", entityId: "/dashboards/scheduler", userId: "u2", userEmail: "b@x.com", userName: "B", durationMs: 20000 },
  // ClickTracker click: entityId is "click:button", page path is in metadata.page
  { type: "FEATURE_USED", entityId: "click:button", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null, metadata: { page: "/dashboards/scheduler" } },
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

  it("totals.avgDwellMs derives from per-path dwell data (consistent with per-page averages)", () => {
    // scheduler: sum=30000, n=2 → avg=15000. No other dwell rows. Global avg = 30000/2 = 15000.
    expect(res.totals.avgDwellMs).toBe(15000);
  });
});

describe("aggregatePageTraffic – click keying", () => {
  it("keys clicks by metadata.page, not entityId", () => {
    const r: TrafficRow[] = [
      { type: "FEATURE_USED", entityId: "click:button", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null, metadata: { page: "/dashboards/scheduler" } },
    ];
    const res = aggregatePageTraffic(r);
    const sched = res.pages.find((p) => p.path === "/dashboards/scheduler");
    expect(sched?.clicks).toBe(1);
    // should NOT create an entry keyed to "click:button"
    expect(res.pages.find((p) => p.path === "click:button")).toBeUndefined();
  });

  it("skips FEATURE_USED rows with no metadata.page", () => {
    const r: TrafficRow[] = [
      { type: "FEATURE_USED", entityId: "click:button", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null },
    ];
    const res = aggregatePageTraffic(r);
    expect(res.pages).toHaveLength(0);
  });

  it("ignores non-click: FEATURE_USED rows", () => {
    const r: TrafficRow[] = [
      { type: "FEATURE_USED", entityId: "bom:pipeline:run", userId: "u1", userEmail: "a@x.com", userName: "A", durationMs: null, metadata: { page: "/dashboards/bom" } },
    ];
    const res = aggregatePageTraffic(r);
    expect(res.pages).toHaveLength(0);
  });
});

describe("aggregatePageTraffic – per-user dwell upsert", () => {
  it("user with only PAGE_DWELL rows (no views) appears in users with views=0 and a non-null avgDwellMs", () => {
    const r: TrafficRow[] = [
      { type: "PAGE_DWELL", entityId: "/dashboards/scheduler", userId: "u99", userEmail: "z@x.com", userName: "Z", durationMs: 5000 },
    ];
    const res = aggregatePageTraffic(r);
    const u = res.users.find((x) => x.userEmail === "z@x.com");
    expect(u).toBeDefined();
    expect(u!.views).toBe(0);
    expect(u!.avgDwellMs).not.toBeNull();
    expect(u!.avgDwellMs).toBe(5000);
  });
});
