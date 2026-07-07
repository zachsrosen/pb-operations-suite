// Full mock set up-front (jest.mock is hoisted; the orchestration tests below
// need deal.findMany and the dynamically-imported bot/chat modules too):
jest.mock("@/lib/db", () => ({
  prisma: {
    deal: { findMany: jest.fn() },
    systemConfig: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}));
jest.mock("@/lib/tech-ops-bot-proactive", () => ({ getOwnerDmSpace: jest.fn() }));
jest.mock("@/lib/google-chat-api", () => ({ postGoogleChatMessage: jest.fn() }));

import {
  buildDigestMessage,
  detectChanges,
  filterSnapshotForScope,
  runBottleneckDigest,
} from "@/lib/bottleneck-digest";
import type { BottleneckSnapshot, StageSnapshot } from "@/lib/bottlenecks";

const { prisma } = jest.requireMock("@/lib/db") as {
  prisma: {
    deal: { findMany: jest.Mock };
    systemConfig: { findUnique: jest.Mock; upsert: jest.Mock };
  };
};
const { getOwnerDmSpace } = jest.requireMock("@/lib/tech-ops-bot-proactive") as {
  getOwnerDmSpace: jest.Mock;
};
const { postGoogleChatMessage } = jest.requireMock("@/lib/google-chat-api") as {
  postGoogleChatMessage: jest.Mock;
};

beforeEach(() => jest.clearAllMocks());

function stage(overrides: Partial<StageSnapshot>): StageSnapshot {
  return {
    key: "permitting", label: "Permitting", team: "pi",
    totalInStage: 10, unknownAgeCount: 1, medianDwellDays: 12, volumeNorm90d: 9,
    threshold: { medianDays: 12, p90Days: 30, thresholdDays: 30, source: "derived" },
    flagged: [], flow: [],
    ...overrides,
  };
}
const snap = (stages: StageSnapshot[]): BottleneckSnapshot => ({ computedAt: "2026-07-07T14:00:00.000Z", stages });
const flaggedDeal = (id: string, dwell = 40) => ({
  hubspotDealId: id, dealName: `PROJ-${id} | Test, Casey | 1 Main St`, projectNumber: `PROJ-${id}`,
  pbLocation: "Westminster", dealOwnerName: "Jane Owner", hubspotOwnerId: "42",
  dwellDays: dwell, thresholdDays: 30,
});

describe("detectChanges", () => {
  it("reports new flags, resolved flags, and growth", () => {
    const prev = { permitting: ["1", "2"] };
    const current = snap([stage({ flagged: [flaggedDeal("2"), flaggedDeal("3")] })]);
    const c = detectChanges(prev, current);
    expect(c.newlyFlagged.map((f) => f.hubspotDealId)).toEqual(["3"]);
    expect(c.resolvedIds).toEqual(["1"]);
    expect(c.hasChanges).toBe(true);
  });

  it("reports no changes when flag sets match", () => {
    const prev = { permitting: ["2"] };
    const c = detectChanges(prev, snap([stage({ flagged: [flaggedDeal("2")] })]));
    expect(c.hasChanges).toBe(false);
  });

  it("treats a missing snapshot (first run) as changed", () => {
    const c = detectChanges(null, snap([stage({ flagged: [flaggedDeal("2")] })]));
    expect(c.hasChanges).toBe(true);
  });
});

describe("buildDigestMessage", () => {
  it("renders plain text with per-stage counts, top deals with owners, and the dashboard link", () => {
    const s = snap([stage({ flagged: [flaggedDeal("1", 62), flaggedDeal("2", 45)] })]);
    const msg = buildDigestMessage(s, detectChanges({ permitting: ["2"] }, s), { includeFlow: false });
    expect(msg).toContain("Permitting: 2 flagged / 10 in stage");
    expect(msg).toContain("62d");
    expect(msg).toContain("Jane Owner");
    expect(msg).toContain("/dashboards/bottlenecks");
    expect(msg).toContain("1 new");
    expect(msg).not.toContain("|"); // no markdown tables — Chat renders raw pipes
  });

  it("includes flow lines when includeFlow (Monday) is set", () => {
    const s = snap([stage({ flow: [
      { weekStart: "2026-06-29", entered: 22, exited: 9 },
    ] })]);
    const msg = buildDigestMessage(s, detectChanges(null, s), { includeFlow: true });
    expect(msg).toContain("22 in / 9 out");
  });

  it("returns null when nothing is flagged and nothing changed", () => {
    const s = snap([stage({ flagged: [] })]);
    expect(buildDigestMessage(s, { newlyFlagged: [], resolvedIds: [], hasChanges: false }, { includeFlow: false })).toBeNull();
  });
});

describe("runBottleneckDigest orchestration", () => {
  const MONDAY = Date.parse("2026-07-06T14:00:00Z"); // Monday, America/Denver
  const TUESDAY = Date.parse("2026-07-07T14:00:00Z"); // Tuesday, America/Denver

  /** SystemConfig.findUnique keyed on where.key. */
  function mockConfigRows(rows: Record<string, string>) {
    prisma.systemConfig.findUnique.mockImplementation(
      async ({ where }: { where: { key: string } }) =>
        rows[where.key] != null ? { key: where.key, value: rows[where.key] } : null
    );
  }

  const EMPTY_THRESHOLDS = JSON.stringify({});
  const EMPTY_LAST_DIGEST = JSON.stringify({ sentAt: "2026-07-05T14:00:00.000Z", flags: {} });

  it("suppresses on a weekday when nothing changed", async () => {
    prisma.deal.findMany.mockResolvedValue([]);
    mockConfigRows({
      bottleneck_thresholds: EMPTY_THRESHOLDS,
      bottleneck_last_digest: EMPTY_LAST_DIGEST,
    });

    const result = await runBottleneckDigest({ nowMs: TUESDAY });

    expect(result).toEqual({
      posted: false,
      reason: "no changes since last digest",
      isMonday: false,
    });
    expect(postGoogleChatMessage).not.toHaveBeenCalled();
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it("always sends on Monday and refreshes thresholds", async () => {
    prisma.deal.findMany.mockResolvedValue([]);
    mockConfigRows({
      bottleneck_thresholds: EMPTY_THRESHOLDS,
      bottleneck_last_digest: EMPTY_LAST_DIGEST,
    });
    getOwnerDmSpace.mockResolvedValue("spaces/OWNER");

    const result = await runBottleneckDigest({ nowMs: MONDAY });

    expect(result.isMonday).toBe(true);
    expect(result.posted).toBe(true);
    expect(postGoogleChatMessage).toHaveBeenCalledTimes(1);
    // The Monday threshold refresh persists to the bottleneck_thresholds key.
    const upsertKeys = prisma.systemConfig.upsert.mock.calls.map(
      (c: [{ where: { key: string } }]) => c[0].where.key
    );
    expect(upsertKeys).toContain("bottleneck_thresholds");
  });

  it("previews without posting or saving the snapshot", async () => {
    prisma.deal.findMany.mockResolvedValue([]);
    mockConfigRows({
      bottleneck_thresholds: EMPTY_THRESHOLDS,
      bottleneck_last_digest: EMPTY_LAST_DIGEST,
    });

    const result = await runBottleneckDigest({ nowMs: MONDAY, preview: true });

    expect(result.posted).toBe(false);
    expect(result.message).toContain("Bottleneck digest");
    expect(postGoogleChatMessage).not.toHaveBeenCalled();
    const upsertKeys = prisma.systemConfig.upsert.mock.calls.map(
      (c: [{ where: { key: string } }]) => c[0].where.key
    );
    expect(upsertKeys).not.toContain("bottleneck_last_digest");
  });
});

describe("filterSnapshotForScope", () => {
  const s = snap([
    stage({ key: "permitting", team: "pi", flagged: [flaggedDeal("1")] }),
    stage({ key: "construction", label: "Construction", team: "ops", flagged: [flaggedDeal("2")] }),
  ]);
  it("team scope keeps only that team's stages", () => {
    const out = filterSnapshotForScope(s, { kind: "team", team: "pi" });
    expect(out.stages.map((x) => x.key)).toEqual(["permitting"]);
  });
  it("person scope keeps only that owner's flagged deals across stages", () => {
    const out = filterSnapshotForScope(s, { kind: "person", hubspotOwnerId: "42" });
    expect(out.stages.every((x) => x.flagged.every((f) => f.hubspotOwnerId === "42"))).toBe(true);
  });
  it("all scope is identity", () => {
    expect(filterSnapshotForScope(s, { kind: "all" })).toEqual(s);
  });
});
