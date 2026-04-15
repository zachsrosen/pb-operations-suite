// Tests for src/lib/property-backfill-lock.ts
//
// Verifies DB-enforced singleton lock semantics:
//   * first acquire succeeds
//   * concurrent acquire returns already-running
//   * healthy long-running lock (fresh heartbeat) is NEVER stolen
//   * stale-heartbeat lock IS stolen via optimistic CAS
//   * heartbeat race returns already-running instead of double-acquiring
//   * heartbeat/release/resume helpers call the right Prisma ops

jest.mock("@/generated/prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, opts: { code: string }) {
        super(message);
        this.code = opts.code;
      }
    },
  },
}));

const mockPrisma = {
  propertyBackfillRun: {
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
};
jest.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import {
  acquireBackfillLock,
  heartbeatBackfillLock,
  releaseBackfillLock,
  resumeInterruptedRun,
  HEARTBEAT_MS,
  STALE_LOCK_MS,
} from "@/lib/property-backfill-lock";
import { Prisma } from "@/generated/prisma/client";

function makeP2002(): Error {
  // Constructor signature is faked in the mock above; cast through unknown.
  const Ctor = Prisma.PrismaClientKnownRequestError as unknown as new (
    message: string,
    opts: { code: string },
  ) => Error;
  return new Ctor("unique constraint", { code: "P2002" });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("property-backfill-lock", () => {
  describe("constants", () => {
    it("HEARTBEAT_MS is 30s and STALE_LOCK_MS is 5 min", () => {
      expect(HEARTBEAT_MS).toBe(30_000);
      expect(STALE_LOCK_MS).toBe(5 * 60 * 1000);
    });
  });

  describe("acquireBackfillLock", () => {
    it("returns {runId, resumeFrom: null} on first acquire", async () => {
      mockPrisma.propertyBackfillRun.create.mockResolvedValueOnce({
        id: "run-1",
        status: "running",
        phase: "contacts",
        cursor: null,
      });

      const result = await acquireBackfillLock();
      expect(result).toEqual({ runId: "run-1", resumeFrom: null });
      expect(mockPrisma.propertyBackfillRun.create).toHaveBeenCalledTimes(1);
      const callArg = mockPrisma.propertyBackfillRun.create.mock.calls[0][0];
      expect(callArg.data.status).toBe("running");
      expect(callArg.data.phase).toBe("contacts");
      expect(callArg.data.heartbeatAt).toBeInstanceOf(Date);
    });

    it("returns already-running on concurrent acquire (fresh heartbeat)", async () => {
      mockPrisma.propertyBackfillRun.create.mockRejectedValueOnce(makeP2002());
      const freshHeartbeat = new Date(Date.now() - 10_000);
      mockPrisma.propertyBackfillRun.findFirst.mockResolvedValueOnce({
        id: "run-existing",
        status: "running",
        startedAt: new Date(Date.now() - 60_000),
        heartbeatAt: freshHeartbeat,
        phase: "contacts",
        cursor: null,
      });

      const result = await acquireBackfillLock();
      expect(result).toEqual({
        reason: "already-running",
        runningRunId: "run-existing",
        heartbeatAt: freshHeartbeat,
      });
      expect(mockPrisma.propertyBackfillRun.updateMany).not.toHaveBeenCalled();
    });

    it("does NOT steal a healthy long-running lock (startedAt old but heartbeat fresh)", async () => {
      mockPrisma.propertyBackfillRun.create.mockRejectedValueOnce(makeP2002());
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
      const tenSecondsAgo = new Date(Date.now() - 10_000);
      mockPrisma.propertyBackfillRun.findFirst.mockResolvedValueOnce({
        id: "run-long",
        status: "running",
        startedAt: fourHoursAgo,
        heartbeatAt: tenSecondsAgo,
        phase: "deals",
        cursor: "cursor-abc",
      });

      const result = await acquireBackfillLock();
      expect(result).toEqual({
        reason: "already-running",
        runningRunId: "run-long",
        heartbeatAt: tenSecondsAgo,
      });
      expect(mockPrisma.propertyBackfillRun.updateMany).not.toHaveBeenCalled();
    });

    it("steals a stale-heartbeat lock (>5 min) and acquires a new one", async () => {
      const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
      // First create → P2002. Second create (after takeover) → success.
      mockPrisma.propertyBackfillRun.create
        .mockRejectedValueOnce(makeP2002())
        .mockResolvedValueOnce({
          id: "run-new",
          status: "running",
          phase: "contacts",
          cursor: null,
        });
      mockPrisma.propertyBackfillRun.findFirst.mockResolvedValueOnce({
        id: "run-dead",
        status: "running",
        startedAt: new Date(Date.now() - 30 * 60 * 1000),
        heartbeatAt: staleHeartbeat,
        phase: "deals",
        cursor: "cursor-xyz",
      });
      mockPrisma.propertyBackfillRun.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await acquireBackfillLock();

      expect(result).toEqual({ runId: "run-new", resumeFrom: null });
      // Verify optimistic CAS: updateMany.where must include heartbeatAt equality on the stale Date.
      expect(mockPrisma.propertyBackfillRun.updateMany).toHaveBeenCalledTimes(1);
      const updateArg = mockPrisma.propertyBackfillRun.updateMany.mock.calls[0][0];
      expect(updateArg.where.id).toBe("run-dead");
      expect(updateArg.where.status).toBe("running");
      expect(updateArg.where.heartbeatAt).toBe(staleHeartbeat);
      expect(updateArg.data.status).toBe("failed");
      expect(updateArg.data.lastError).toMatch(/stolen/i);
      // And the second create was attempted (recursive retry).
      expect(mockPrisma.propertyBackfillRun.create).toHaveBeenCalledTimes(2);
    });

    it("heartbeat race: updateMany.count === 0 returns already-running (no double-acquire)", async () => {
      const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000);
      mockPrisma.propertyBackfillRun.create.mockRejectedValueOnce(makeP2002());
      mockPrisma.propertyBackfillRun.findFirst.mockResolvedValueOnce({
        id: "run-raced",
        status: "running",
        startedAt: new Date(Date.now() - 30 * 60 * 1000),
        heartbeatAt: staleHeartbeat,
        phase: "deals",
        cursor: null,
      });
      // CAS fails because another process advanced heartbeatAt between our read and write.
      mockPrisma.propertyBackfillRun.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await acquireBackfillLock();

      expect(result).toEqual({
        reason: "already-running",
        runningRunId: "run-raced",
        heartbeatAt: staleHeartbeat,
      });
      // Crucially: create was NOT called a second time.
      expect(mockPrisma.propertyBackfillRun.create).toHaveBeenCalledTimes(1);
    });

    it("rethrows non-P2002 Prisma errors", async () => {
      const Ctor = Prisma.PrismaClientKnownRequestError as unknown as new (
        message: string,
        opts: { code: string },
      ) => Error;
      const otherErr = new Ctor("other", { code: "P2001" });
      mockPrisma.propertyBackfillRun.create.mockRejectedValueOnce(otherErr);
      await expect(acquireBackfillLock()).rejects.toThrow("other");
    });

    it("throws if P2002 but no running row can be found (index corruption)", async () => {
      mockPrisma.propertyBackfillRun.create.mockRejectedValueOnce(makeP2002());
      mockPrisma.propertyBackfillRun.findFirst.mockResolvedValueOnce(null);
      await expect(acquireBackfillLock()).rejects.toThrow(/index corrupt/i);
    });
  });

  describe("heartbeatBackfillLock", () => {
    it("updates heartbeatAt on the given run id", async () => {
      mockPrisma.propertyBackfillRun.update.mockResolvedValueOnce({});
      const before = Date.now();
      await heartbeatBackfillLock("run-1");
      const arg = mockPrisma.propertyBackfillRun.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: "run-1" });
      expect(arg.data.heartbeatAt).toBeInstanceOf(Date);
      expect(arg.data.heartbeatAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe("releaseBackfillLock", () => {
    it("flips status to completed and sets completedAt, clears lastError when no error provided", async () => {
      mockPrisma.propertyBackfillRun.update.mockResolvedValueOnce({});
      await releaseBackfillLock("run-1", "completed");
      const arg = mockPrisma.propertyBackfillRun.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: "run-1" });
      expect(arg.data.status).toBe("completed");
      expect(arg.data.completedAt).toBeInstanceOf(Date);
      expect(arg.data.lastError).toBeNull();
    });

    it("records lastError when provided", async () => {
      mockPrisma.propertyBackfillRun.update.mockResolvedValueOnce({});
      await releaseBackfillLock("run-1", "failed", "boom");
      const arg = mockPrisma.propertyBackfillRun.update.mock.calls[0][0];
      expect(arg.data.status).toBe("failed");
      expect(arg.data.lastError).toBe("boom");
    });
  });

  describe("resumeInterruptedRun", () => {
    it("returns null when no running row exists", async () => {
      mockPrisma.propertyBackfillRun.findFirst.mockResolvedValueOnce(null);
      const result = await resumeInterruptedRun();
      expect(result).toBeNull();
    });

    it("returns {runId, resumeFrom} when a running row exists", async () => {
      mockPrisma.propertyBackfillRun.findFirst.mockResolvedValueOnce({
        id: "run-crashed",
        status: "running",
        phase: "deals",
        cursor: "paging-cursor-1",
      });
      const result = await resumeInterruptedRun();
      expect(result).toEqual({
        runId: "run-crashed",
        resumeFrom: { phase: "deals", cursor: "paging-cursor-1" },
      });
    });
  });
});
