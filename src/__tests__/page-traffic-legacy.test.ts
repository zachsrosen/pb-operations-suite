import {
  computeLegacyPaths,
  fetchRecentTeamViewPaths,
  LEGACY_EXEMPT,
  LEGACY_THRESHOLD_DAYS,
} from "@/lib/page-traffic";

const DAY = 86_400_000;

describe("computeLegacyPaths", () => {
  const fresh = new Set(["/dashboards/scheduler", "/dashboards/bom"]);

  it("flags hrefs with no recent team views", () => {
    const out = computeLegacyPaths(["/dashboards/scheduler", "/dashboards/capacity"], fresh);
    expect(out.has("/dashboards/capacity")).toBe(true);
    expect(out.has("/dashboards/scheduler")).toBe(false);
  });

  it("normalizes hrefs before matching (query strings fold onto the route)", () => {
    const out = computeLegacyPaths(["/dashboards/scheduler?loc=Westminster"], fresh);
    expect(out.size).toBe(0);
  });

  it("never flags exempt paths", () => {
    for (const p of LEGACY_EXEMPT) {
      expect(computeLegacyPaths([p], new Set()).has(p)).toBe(false);
    }
  });

  it("never flags estimator, portal, or suite-landing paths", () => {
    const out = computeLegacyPaths(
      ["/estimator/battery", "/portal/survey/abc", "/suites/operations"],
      new Set(),
    );
    expect(out.size).toBe(0);
  });

  it("ignores non-path hrefs", () => {
    expect(computeLegacyPaths(["https://example.com/x"], new Set()).size).toBe(0);
  });
});

describe("fetchRecentTeamViewPaths", () => {
  const now = Date.now();
  const cutoffDays = LEGACY_THRESHOLD_DAYS;

  function fakePrisma(opts: {
    oldestView: Date | null;
    admins: { id: string }[];
    recentRows: { entityId: string | null }[];
  }) {
    return {
      activityLog: {
        aggregate: jest.fn().mockResolvedValue({ _min: { createdAt: opts.oldestView } }),
        groupBy: jest.fn().mockResolvedValue(opts.recentRows),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(opts.admins),
      },
    };
  }

  it("returns normalized paths with recent non-admin views", async () => {
    const prisma = fakePrisma({
      oldestView: new Date(now - 150 * DAY),
      admins: [{ id: "admin1" }],
      recentRows: [{ entityId: "/dashboards/scheduler?x=1" }, { entityId: null }],
    });
    const out = await fetchRecentTeamViewPaths(prisma as never);
    expect(out).toEqual(new Set(["/dashboards/scheduler"]));
  });

  it("excludes admin userIds but keeps null userIds, with a ~60-day cutoff (query shape)", async () => {
    const prisma = fakePrisma({
      oldestView: new Date(now - 150 * DAY),
      admins: [{ id: "admin1" }],
      recentRows: [],
    });
    await fetchRecentTeamViewPaths(prisma as never);
    const where = (prisma.activityLog.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(where.OR).toEqual([{ userId: null }, { userId: { notIn: ["admin1"] } }]);
    const gte: Date = where.createdAt.gte;
    expect(Math.abs(gte.getTime() - (now - LEGACY_THRESHOLD_DAYS * DAY))).toBeLessThan(60_000);
  });

  it("returns null (guard tripped) when retained history is younger than the threshold", async () => {
    const prisma = fakePrisma({
      oldestView: new Date(now - (cutoffDays - 5) * DAY),
      admins: [],
      recentRows: [{ entityId: "/dashboards/scheduler" }],
    });
    expect(await fetchRecentTeamViewPaths(prisma as never)).toBeNull();
  });

  it("returns null when the log is empty", async () => {
    const prisma = fakePrisma({ oldestView: null, admins: [], recentRows: [] });
    expect(await fetchRecentTeamViewPaths(prisma as never)).toBeNull();
  });
});
