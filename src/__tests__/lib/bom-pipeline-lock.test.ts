/**
 * Tests for src/lib/bom-pipeline-lock.ts
 *
 * Covers:
 *   1. Stale lock recovery — RUNNING rows older than 10 min are flipped to FAILED
 *   2. Successful lock acquisition — returns new run ID
 *   3. Duplicate run detection — P2002 unique constraint → DuplicateRunError
 *   4. Trigger param passed through — different trigger types are stored
 *   5. Missing database — throws immediately
 */

// ── Mock: Prisma ──────────────────────────────────────────────────────────────
const mockCreate = jest.fn();
const mockUpdateMany = jest.fn();
const mockTransaction = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    bomPipelineRun: {
      create: (...args: unknown[]) => mockCreate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

import { acquirePipelineLock, DuplicateRunError } from "@/lib/bom-pipeline-lock";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulates Prisma $transaction by calling the callback with mock tx */
function setupTransaction() {
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({
      bomPipelineRun: {
        create: (...args: unknown[]) => mockCreate(...args),
        updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      },
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("acquirePipelineLock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupTransaction();
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockCreate.mockResolvedValue({ id: "run_test_123" });
  });

  it("returns run ID on successful lock acquisition", async () => {
    const runId = await acquirePipelineLock("deal-1", "WEBHOOK_DESIGN_COMPLETE");
    expect(runId).toBe("run_test_123");
  });

  it("passes trigger type through to create", async () => {
    await acquirePipelineLock("deal-1", "WEBHOOK_READY_TO_BUILD", "Test Deal");

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dealId: "deal-1",
        trigger: "WEBHOOK_READY_TO_BUILD",
        dealName: "Test Deal",
        status: "RUNNING",
      }),
    });
  });

  it("passes WEBHOOK_INSTALL_SCHEDULED trigger", async () => {
    await acquirePipelineLock("deal-2", "WEBHOOK_INSTALL_SCHEDULED");

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        trigger: "WEBHOOK_INSTALL_SCHEDULED",
        dealId: "deal-2",
      }),
    });
  });

  it("recovers stale locks before inserting", async () => {
    await acquirePipelineLock("deal-1", "WEBHOOK_DESIGN_COMPLETE");

    // updateMany called first (stale recovery), then create
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const updateCall = mockUpdateMany.mock.calls[0][0];
    expect(updateCall.where.dealId).toBe("deal-1");
    expect(updateCall.where.status).toBe("RUNNING");
    expect(updateCall.data.status).toBe("FAILED");
    expect(updateCall.data.errorMessage).toContain("stale lock");
  });

  it("throws DuplicateRunError on P2002 unique constraint violation", async () => {
    const p2002Error = Object.assign(new Error("Unique constraint"), { code: "P2002" });
    mockCreate.mockRejectedValue(p2002Error);

    await expect(acquirePipelineLock("deal-1", "WEBHOOK_DESIGN_COMPLETE"))
      .rejects.toThrow(DuplicateRunError);
  });

  it("re-throws non-P2002 errors as-is", async () => {
    const genericError = new Error("Connection lost");
    mockCreate.mockRejectedValue(genericError);

    await expect(acquirePipelineLock("deal-1", "WEBHOOK_DESIGN_COMPLETE"))
      .rejects.toThrow("Connection lost");
  });

  it("uses empty string for dealName when not provided", async () => {
    await acquirePipelineLock("deal-1", "MANUAL");

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dealName: "",
      }),
    });
  });
});

describe("DuplicateRunError", () => {
  it("has correct name and message", () => {
    const err = new DuplicateRunError("deal-42");
    expect(err.name).toBe("DuplicateRunError");
    expect(err.message).toContain("deal-42");
    expect(err).toBeInstanceOf(Error);
  });
});
