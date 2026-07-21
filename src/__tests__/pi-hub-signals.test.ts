/**
 * Approval-signal UI plumbing: flag-gated queue join (flag off ⇒ the table is
 * never queried and nothing is attached), dismiss transitions through the
 * shared applyDismiss state machine, and the status-write auto-resolve
 * condition (any write that leaves the team's candidate statuses resolves).
 */

// signals.ts → scan.ts transitively pulls the generated Prisma client (via
// idr-meeting → db) which Jest's CJS runtime can't parse; nothing under test
// touches it.
jest.mock("@/lib/idr-meeting", () => ({ locationInBucket: () => false }));
jest.mock("@/lib/db", () => ({
  prisma: {
    approvalSignal: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import {
  attachSignals,
  dismissSignal,
  fetchOpenSignals,
  fetchOpenSignalForDeal,
  resolveSignalsOnStatusWrite,
} from "@/lib/pi-hub/signals";
import type { QueueItem } from "@/lib/pi-hub/types";

const findMany = prisma.approvalSignal.findMany as unknown as jest.Mock;
const findFirst = prisma.approvalSignal.findFirst as unknown as jest.Mock;
const findUnique = prisma.approvalSignal.findUnique as unknown as jest.Mock;
const update = prisma.approvalSignal.update as unknown as jest.Mock;
const updateMany = prisma.approvalSignal.updateMany as unknown as jest.Mock;

const FLAG = "NEXT_PUBLIC_APPROVAL_SIGNALS_ENABLED";
const SCAN_FLAG = "APPROVAL_SCAN_ENABLED";

function queueItem(dealId: string): QueueItem {
  return {
    dealId,
    name: `Deal ${dealId}`,
    address: null,
    pbLocation: null,
    status: "Submitted to AHJ",
    statusLabel: "Submitted to AHJ",
    dealStage: null,
    group: "waiting",
    daysInStatus: 5,
    isStale: false,
    lead: null,
    leadOwnerId: null,
    pm: null,
    amount: null,
  };
}

function signalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sig-1",
    hubspotDealId: "100",
    team: "permit",
    signalType: "permit_issued",
    actualStatus: "Submitted to AHJ",
    proposedStatus: "Complete",
    confidence: "high",
    evidence: {
      messageId: "m1",
      threadId: "t1",
      mailbox: "permits@photonbrothers.com",
      subject: "Permit issued",
      quote: "Your permit has been issued.",
      receivedAt: "2026-07-19T12:00:00Z",
      citedIdentifiers: [],
    },
    detectedAt: new Date("2026-07-19T13:00:00Z"),
    status: "OPEN",
    dismissedMessageIds: [] as string[],
    dismissCount: 0,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env[FLAG] = "true";
  delete process.env[SCAN_FLAG];
});

afterAll(() => {
  delete process.env[FLAG];
  delete process.env[SCAN_FLAG];
});

// ========== flag-gated fetch + queue join ==========

describe("fetchOpenSignals", () => {
  it("flag off ⇒ empty map and the table is never queried", async () => {
    delete process.env[FLAG];
    const map = await fetchOpenSignals("permit");
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("flag on ⇒ OPEN rows for the team keyed by dealId", async () => {
    findMany.mockResolvedValue([signalRow()]);
    const map = await fetchOpenSignals("permit");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { team: "permit", status: "OPEN" } }),
    );
    expect(map.get("100")).toEqual({
      signalType: "permit_issued",
      proposedStatus: "Complete",
      confidence: "high",
      evidence: expect.objectContaining({
        messageId: "m1",
        threadId: "t1",
        quote: "Your permit has been issued.",
      }),
    });
  });

  it("newest row wins a deal's single badge slot (rows arrive desc)", async () => {
    findMany.mockResolvedValue([
      signalRow({ id: "sig-new", signalType: "inspection_passed" }),
      signalRow({ id: "sig-old", signalType: "permit_issued" }),
    ]);
    const map = await fetchOpenSignals("permit");
    expect(map.get("100")?.signalType).toBe("inspection_passed");
  });

  it("Prisma failure (table not migrated yet) degrades to an empty map", async () => {
    findMany.mockRejectedValue(new Error("relation does not exist"));
    await expect(fetchOpenSignals("permit")).resolves.toEqual(new Map());
  });
});

describe("attachSignals", () => {
  it("joins by dealId; deals without a signal get null", async () => {
    findMany.mockResolvedValue([signalRow()]);
    const map = await fetchOpenSignals("permit");
    const items = attachSignals([queueItem("100"), queueItem("200")], map);
    expect(items[0].signal).toEqual({
      signalType: "permit_issued",
      confidence: "high",
    });
    expect(items[1].signal).toBeNull();
  });
});

describe("fetchOpenSignalForDeal", () => {
  it("flag off ⇒ null without querying", async () => {
    delete process.env[FLAG];
    await expect(fetchOpenSignalForDeal("permit", "100")).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("flag on ⇒ newest OPEN signal for the deal", async () => {
    findFirst.mockResolvedValue(signalRow());
    const signal = await fetchOpenSignalForDeal("permit", "100");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hubspotDealId: "100", team: "permit", status: "OPEN" },
      }),
    );
    expect(signal?.proposedStatus).toBe("Complete");
  });
});

// ========== dismiss transitions (applyDismiss integration) ==========

describe("dismissSignal", () => {
  it("first dismissal strikes the evidence messageId → DISMISSED, count 1", async () => {
    findUnique.mockResolvedValue(signalRow());
    update.mockResolvedValue({});
    const status = await dismissSignal({
      dealId: "100",
      team: "permit",
      signalType: "permit_issued",
    });
    expect(status).toBe("DISMISSED");
    expect(update).toHaveBeenCalledWith({
      where: { id: "sig-1" },
      data: {
        status: "DISMISSED",
        dismissedMessageIds: ["m1"],
        dismissCount: 1,
      },
    });
  });

  it("third DISTINCT dismissed message → MUTED", async () => {
    findUnique.mockResolvedValue(
      signalRow({
        status: "DISMISSED",
        dismissedMessageIds: ["m1", "m2"],
        dismissCount: 2,
        evidence: { ...signalRow().evidence, messageId: "m3" },
      }),
    );
    update.mockResolvedValue({});
    const status = await dismissSignal({
      dealId: "100",
      team: "permit",
      signalType: "permit_issued",
    });
    expect(status).toBe("MUTED");
    expect(update).toHaveBeenCalledWith({
      where: { id: "sig-1" },
      data: {
        status: "MUTED",
        dismissedMessageIds: ["m1", "m2", "m3"],
        dismissCount: 3,
      },
    });
  });

  it("re-dismissing the same messageId does not add a strike", async () => {
    findUnique.mockResolvedValue(
      signalRow({
        status: "DISMISSED",
        dismissedMessageIds: ["m1"],
        dismissCount: 1,
      }),
    );
    update.mockResolvedValue({});
    const status = await dismissSignal({
      dealId: "100",
      team: "permit",
      signalType: "permit_issued",
    });
    expect(status).toBe("DISMISSED");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dismissCount: 1 }),
      }),
    );
  });

  it("unknown signal → null, nothing written", async () => {
    findUnique.mockResolvedValue(null);
    const status = await dismissSignal({
      dealId: "999",
      team: "permit",
      signalType: "permit_issued",
    });
    expect(status).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("missing evidence messageId → plain DISMISS, no empty-string strike", async () => {
    findUnique.mockResolvedValue(
      signalRow({ evidence: { ...signalRow().evidence, messageId: "" } }),
    );
    update.mockResolvedValue({});
    const status = await dismissSignal({
      dealId: "100",
      team: "permit",
      signalType: "permit_issued",
    });
    expect(status).toBe("DISMISSED");
    // Only the status flips — "" is never recorded and the strike counter
    // never advances toward MUTE.
    expect(update).toHaveBeenCalledWith({
      where: { id: "sig-1" },
      data: { status: "DISMISSED" },
    });
  });
});

// ========== auto-resolve on status write ==========

describe("resolveSignalsOnStatusWrite", () => {
  it("resolves OPEN/DISMISSED signals when the write matches the proposed status", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await resolveSignalsOnStatusWrite({
      dealId: "100",
      team: "permit",
      newStatus: "Complete",
      userEmail: "zach@photonbrothers.com",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        hubspotDealId: "100",
        status: { in: ["OPEN", "DISMISSED"] },
        OR: [{ team: "permit" }],
      },
      data: expect.objectContaining({
        status: "RESOLVED",
        resolvedBy: "zach@photonbrothers.com",
      }),
    });
  });

  it("a DIFFERENT non-candidate status also resolves — the deal left the waiting state", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await resolveSignalsOnStatusWrite({
      dealId: "100",
      team: "permit",
      newStatus: "Permit Issued Pending Payment",
      userEmail: "zach@photonbrothers.com",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          hubspotDealId: "100",
          status: { in: ["OPEN", "DISMISSED"] },
          OR: [{ team: "permit" }],
        },
        data: expect.objectContaining({ status: "RESOLVED" }),
      }),
    );
  });

  it("a pto status write also resolves the permit-team inspection signal", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await resolveSignalsOnStatusWrite({
      dealId: "100",
      team: "pto",
      newStatus: "PTO",
      userEmail: "zach@photonbrothers.com",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { team: "pto" },
            { team: "permit", signalType: "inspection_passed" },
          ],
        }),
      }),
    );
  });

  it("a write back INTO a candidate (waiting) status leaves signals untouched", async () => {
    await resolveSignalsOnStatusWrite({
      dealId: "100",
      team: "permit",
      newStatus: "Resubmitted to AHJ",
      userEmail: "zach@photonbrothers.com",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("both flags off ⇒ no signal query at all", async () => {
    delete process.env[FLAG];
    await resolveSignalsOnStatusWrite({
      dealId: "100",
      team: "permit",
      newStatus: "Complete",
      userEmail: "zach@photonbrothers.com",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("scan flag alone (shadow mode, UI dark) still resolves", async () => {
    delete process.env[FLAG];
    process.env[SCAN_FLAG] = "true";
    updateMany.mockResolvedValue({ count: 1 });
    await resolveSignalsOnStatusWrite({
      dealId: "100",
      team: "permit",
      newStatus: "Complete",
      userEmail: "zach@photonbrothers.com",
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("never throws — a missing table must not fail the landed status write", async () => {
    updateMany.mockRejectedValue(new Error("relation does not exist"));
    await expect(
      resolveSignalsOnStatusWrite({
        dealId: "100",
        team: "permit",
        newStatus: "Complete",
        userEmail: "zach@photonbrothers.com",
      }),
    ).resolves.toBeUndefined();
  });
});
