/**
 * Batch selection for the PowerHub asset-sync cron.
 *
 * Regression cover for the 2026-07-22 starvation bug: the old implementation
 * filtered by a staleness cutoff shorter than the cron interval and then took
 * `staleSiteIds.slice(0, LIMIT)` off a fixed Tesla group ordering, so the same
 * head of the list was re-picked every run. Sites appended at the tail — which
 * is where Tesla puts new registrations — were never reached, leaving 145
 * portal sites uningested and 2,804 rows unsynced for 30+ days.
 */

// selectAssetSyncBatch is pure, but powerhub-sync pulls in prisma + the Tesla
// client at module load. Stub both so this suite stays a unit test.
jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: { findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/tesla-powerhub", () => ({
  createPowerHubClient: jest.fn(),
  computePortalUrl: jest.fn(),
}));

import { selectAssetSyncBatch, type KnownSiteSyncState } from "@/lib/powerhub-sync";

const NOW = new Date("2026-07-22T18:00:00Z");
const CUTOFF = new Date(NOW.getTime() - 12 * 60 * 60 * 1000);

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("selectAssetSyncBatch", () => {
  it("puts never-ingested sites first, even when they are last in Tesla's ordering", () => {
    const allSiteIds = ["old-a", "old-b", "brand-new"];
    const known: KnownSiteSyncState[] = [
      { siteId: "old-a", lastAssetSyncAt: hoursAgo(48) },
      { siteId: "old-b", lastAssetSyncAt: hoursAgo(72) },
      // "brand-new" has no row at all
    ];

    const { batch } = selectAssetSyncBatch(allSiteIds, known, CUTOFF, 10);

    expect(batch[0]).toBe("brand-new");
  });

  it("orders the rest least-recently-synced first", () => {
    const allSiteIds = ["recent", "ancient", "middle"];
    const known: KnownSiteSyncState[] = [
      { siteId: "recent", lastAssetSyncAt: hoursAgo(13) },
      { siteId: "ancient", lastAssetSyncAt: hoursAgo(800) },
      { siteId: "middle", lastAssetSyncAt: hoursAgo(100) },
    ];

    const { batch } = selectAssetSyncBatch(allSiteIds, known, CUTOFF, 10);

    expect(batch).toEqual(["ancient", "middle", "recent"]);
  });

  it("ranks rows that exist but were never synced ahead of any synced row", () => {
    const allSiteIds = ["synced-long-ago", "never-synced"];
    const known: KnownSiteSyncState[] = [
      { siteId: "synced-long-ago", lastAssetSyncAt: hoursAgo(5000) },
      { siteId: "never-synced", lastAssetSyncAt: null },
    ];

    const { batch } = selectAssetSyncBatch(allSiteIds, known, CUTOFF, 10);

    expect(batch).toEqual(["never-synced", "synced-long-ago"]);
  });

  it("skips sites synced inside the staleness window", () => {
    const allSiteIds = ["fresh", "stale"];
    const known: KnownSiteSyncState[] = [
      { siteId: "fresh", lastAssetSyncAt: hoursAgo(6) }, // inside 12h window
      { siteId: "stale", lastAssetSyncAt: hoursAgo(18) },
    ];

    const { stale, batch } = selectAssetSyncBatch(allSiteIds, known, CUTOFF, 10);

    expect(stale).toEqual(["stale"]);
    expect(batch).toEqual(["stale"]);
  });

  it("respects the batch limit while still reporting the full stale count", () => {
    const allSiteIds = Array.from({ length: 200 }, (_, i) => `site-${i}`);
    const known: KnownSiteSyncState[] = allSiteIds.map((siteId, i) => ({
      siteId,
      lastAssetSyncAt: hoursAgo(24 + i),
    }));

    const { stale, batch } = selectAssetSyncBatch(allSiteIds, known, CUTOFF, 50);

    expect(stale).toHaveLength(200);
    expect(batch).toHaveLength(50);
    // Oldest is the highest index (hoursAgo grows with i)
    expect(batch[0]).toBe("site-199");
  });

  it("rotates across runs instead of re-picking the same head", () => {
    // 120 sites, 50 per run: the second run must not repeat the first run's batch.
    const allSiteIds = Array.from({ length: 120 }, (_, i) => `site-${i}`);
    const known: KnownSiteSyncState[] = allSiteIds.map((siteId, i) => ({
      siteId,
      lastAssetSyncAt: hoursAgo(24 + i),
    }));

    const first = selectAssetSyncBatch(allSiteIds, known, CUTOFF, 50).batch;

    // Simulate the run: everything in `first` was just synced.
    const afterRun = known.map((row) =>
      first.includes(row.siteId) ? { ...row, lastAssetSyncAt: NOW } : row,
    );
    const second = selectAssetSyncBatch(allSiteIds, afterRun, CUTOFF, 50).batch;

    expect(second.filter((id) => first.includes(id))).toHaveLength(0);
  });

  it("returns an empty batch when everything is fresh", () => {
    const allSiteIds = ["a", "b"];
    const known: KnownSiteSyncState[] = [
      { siteId: "a", lastAssetSyncAt: hoursAgo(1) },
      { siteId: "b", lastAssetSyncAt: hoursAgo(2) },
    ];

    const { stale, batch } = selectAssetSyncBatch(allSiteIds, known, CUTOFF, 50);

    expect(stale).toEqual([]);
    expect(batch).toEqual([]);
  });
});
