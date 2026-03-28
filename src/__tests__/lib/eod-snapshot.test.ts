// src/__tests__/lib/eod-snapshot.test.ts
//
// Unit tests for the pure diffSnapshots function in eod-summary/snapshot.ts.
// These tests do NOT hit HubSpot or the database.

// Mock external dependencies so the module can be loaded in Jest
jest.mock("@/lib/db", () => ({
  prisma: {
    dealStatusSnapshot: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/hubspot", () => ({
  searchWithRetry: jest.fn(),
}));

import { diffSnapshots, type SnapshotDeal } from "@/lib/eod-summary/snapshot";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeal(overrides: Partial<SnapshotDeal> = {}): SnapshotDeal {
  return {
    dealId: "100",
    dealName: "Test Deal",
    pipeline: "6900017",
    dealStage: "some-stage",
    pbLocation: null,
    designStatus: null,
    layoutStatus: null,
    permittingStatus: null,
    interconnectionStatus: null,
    ptoStatus: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("diffSnapshots", () => {
  it("detects a status change", () => {
    const morning = new Map<string, SnapshotDeal>([
      ["100", makeDeal({ dealId: "100", permittingStatus: null })],
    ]);
    const evening = new Map<string, SnapshotDeal>([
      ["100", makeDeal({ dealId: "100", permittingStatus: "Submitted to AHJ" })],
    ]);

    const result = diffSnapshots(morning, evening);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      dealId: "100",
      field: "permittingStatus",
      from: null,
      to: "Submitted to AHJ",
    });
    expect(result.newDeals).toHaveLength(0);
    expect(result.resolvedDeals).toHaveLength(0);
  });

  it("detects multiple changes on the same deal", () => {
    const morning = new Map<string, SnapshotDeal>([
      [
        "200",
        makeDeal({
          dealId: "200",
          designStatus: "Initial Review",
          layoutStatus: null,
        }),
      ],
    ]);
    const evening = new Map<string, SnapshotDeal>([
      [
        "200",
        makeDeal({
          dealId: "200",
          designStatus: "Complete",
          layoutStatus: "Sent to Customer",
        }),
      ],
    ]);

    const result = diffSnapshots(morning, evening);

    expect(result.changes).toHaveLength(2);
    const fields = result.changes.map((c) => c.field).sort();
    expect(fields).toEqual(["designStatus", "layoutStatus"]);

    const designChange = result.changes.find((c) => c.field === "designStatus");
    expect(designChange).toMatchObject({ from: "Initial Review", to: "Complete" });

    const layoutChange = result.changes.find((c) => c.field === "layoutStatus");
    expect(layoutChange).toMatchObject({ from: null, to: "Sent to Customer" });
  });

  it("identifies new deals", () => {
    const morning = new Map<string, SnapshotDeal>();
    const evening = new Map<string, SnapshotDeal>([
      ["300", makeDeal({ dealId: "300", dealName: "Brand New Deal" })],
    ]);

    const result = diffSnapshots(morning, evening);

    expect(result.newDeals).toHaveLength(1);
    expect(result.newDeals[0].dealId).toBe("300");
    expect(result.changes).toHaveLength(0);
    expect(result.resolvedDeals).toHaveLength(0);
  });

  it("identifies resolved deals", () => {
    const morning = new Map<string, SnapshotDeal>([
      ["400", makeDeal({ dealId: "400", dealName: "Resolved Deal" })],
    ]);
    const evening = new Map<string, SnapshotDeal>();

    const result = diffSnapshots(morning, evening, { failedOwnerIds: new Set() });

    expect(result.resolvedDeals).toHaveLength(1);
    expect(result.resolvedDeals[0].dealId).toBe("400");
    expect(result.changes).toHaveLength(0);
    expect(result.newDeals).toHaveLength(0);
  });

  it("excludes resolved deals when their owner query failed", () => {
    const morning = new Map<string, SnapshotDeal>([
      ["500", makeDeal({ dealId: "500", dealName: "Missing Deal" })],
    ]);
    const evening = new Map<string, SnapshotDeal>();

    // The deal's owner is Peter Zaun (78035785) whose query failed
    const dealOwnerMap = new Map<string, Set<string>>([
      ["500", new Set(["78035785"])],
    ]);

    const result = diffSnapshots(morning, evening, {
      failedOwnerIds: new Set(["78035785"]),
      dealOwnerMap,
    });

    // Should NOT appear in resolved — it's a false positive
    expect(result.resolvedDeals).toHaveLength(0);
    expect(result.changes).toHaveLength(0);
    expect(result.newDeals).toHaveLength(0);
  });

  it("excludes resolved deal when one of multiple owners had a failed query", () => {
    const morning = new Map<string, SnapshotDeal>([
      ["600", makeDeal({ dealId: "600", dealName: "Multi-Owner Deal" })],
    ]);
    const evening = new Map<string, SnapshotDeal>();

    // Deal has two owners; only one failed — but ANY failure = exclude
    const dealOwnerMap = new Map<string, Set<string>>([
      ["600", new Set(["78035785", "216565308"])],
    ]);

    const result = diffSnapshots(morning, evening, {
      failedOwnerIds: new Set(["78035785"]),
      dealOwnerMap,
    });

    expect(result.resolvedDeals).toHaveLength(0);
  });

  it("ignores deals with no changes", () => {
    const deal = makeDeal({
      dealId: "700",
      permittingStatus: "Submitted to AHJ",
      designStatus: "Complete",
    });
    const morning = new Map<string, SnapshotDeal>([["700", deal]]);
    const evening = new Map<string, SnapshotDeal>([["700", { ...deal }]]);

    const result = diffSnapshots(morning, evening);

    expect(result.changes).toHaveLength(0);
    expect(result.newDeals).toHaveLength(0);
    expect(result.resolvedDeals).toHaveLength(0);
  });
});
