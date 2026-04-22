/**
 * Unit tests for the adder sync orchestrator.
 *
 * These do NOT hit the real DB or the real OpenSolar API. Both `@/lib/db`
 * and `@/lib/adders/opensolar-client` are mocked so we exercise the diff
 * logic and status aggregation deterministically.
 */

// Mock Prisma client before importing sync.
jest.mock("@/lib/db", () => {
  const adders: Array<Record<string, unknown>> = [];
  const adderSyncRuns: Array<Record<string, unknown>> = [];

  const prisma = {
    __reset(seed: Array<Record<string, unknown>>) {
      adders.length = 0;
      adders.push(...seed);
      adderSyncRuns.length = 0;
    },
    __runs: () => adderSyncRuns,
    adder: {
      findMany: jest.fn(async () => adders),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        adders.find((a) => a.id === where.id) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = adders.find((a) => a.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        },
      ),
    },
    adderSyncRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `run-${adderSyncRuns.length + 1}`;
        const row = { id, startedAt: new Date(), finishedAt: null, ...data };
        adderSyncRuns.push(row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = adderSyncRuns.find((r) => r.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        },
      ),
    },
  };

  return { prisma };
});

// Mock the opensolar-client so each test can control push/archive
// outcomes without actually hitting the stub behavior.
jest.mock("@/lib/adders/opensolar-client", () => {
  const actual = jest.requireActual("@/lib/adders/opensolar-client");
  return {
    ...actual,
    pushAdder: jest.fn(),
    archiveAdder: jest.fn(),
    listAdders: jest.fn(async () => []),
  };
});

import { syncAll, syncAdder } from "@/lib/adders/sync";
import { prisma } from "@/lib/db";
import { pushAdder, archiveAdder } from "@/lib/adders/opensolar-client";

type PrismaTestShim = typeof prisma & {
  __reset: (seed: Array<Record<string, unknown>>) => void;
  __runs: () => Array<Record<string, unknown>>;
};

const ORIGINAL_ENV = process.env.ADDER_SYNC_ENABLED;

function setEnabled(v: boolean) {
  process.env.ADDER_SYNC_ENABLED = v ? "true" : "false";
}

function makeAdder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "adder-1",
    code: "MPU_200A",
    name: "Main Panel Upgrade 200A",
    category: "ELECTRICAL",
    type: "FIXED",
    direction: "ADD",
    autoApply: false,
    appliesTo: null,
    triggerCondition: null,
    triageQuestion: null,
    triageAnswerType: null,
    triageChoices: null,
    triggerLogic: null,
    photosRequired: false,
    unit: "FLAT",
    basePrice: 500,
    baseCost: 300,
    marginTarget: null,
    active: true,
    notes: null,
    openSolarId: null,
    createdBy: "u1",
    updatedBy: "u1",
    createdAt: new Date(),
    updatedAt: new Date(),
    overrides: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (pushAdder as jest.Mock).mockResolvedValue({
    ok: true,
    externalId: "adder-1",
    openSolarId: "os-1",
  });
  (archiveAdder as jest.Mock).mockResolvedValue({
    ok: true,
    externalId: "adder-1",
  });
});

afterAll(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.ADDER_SYNC_ENABLED;
  } else {
    process.env.ADDER_SYNC_ENABLED = ORIGINAL_ENV;
  }
});

describe("syncAll — kill switch", () => {
  test("when ADDER_SYNC_ENABLED=false, returns SUCCESS without calling client", async () => {
    setEnabled(false);
    (prisma as PrismaTestShim).__reset([makeAdder()]);

    const result = await syncAll({ trigger: "MANUAL" });

    expect(result.status).toBe("SUCCESS");
    expect(result.addersPushed).toBe(0);
    expect(result.addersFailed).toBe(0);
    expect(result.skipped).toBe(true);
    expect(pushAdder).not.toHaveBeenCalled();
    expect(archiveAdder).not.toHaveBeenCalled();
    // findMany should NOT be called — we short-circuit before touching the list.
    expect((prisma.adder.findMany as jest.Mock).mock.calls.length).toBe(0);
  });
});

describe("syncAll — enabled", () => {
  test("pushes all active adders and writes back openSolarId", async () => {
    setEnabled(true);
    (prisma as PrismaTestShim).__reset([
      makeAdder({ id: "a1", code: "A1", openSolarId: null }),
      makeAdder({ id: "a2", code: "A2", openSolarId: "os-existing" }),
    ]);
    (pushAdder as jest.Mock).mockImplementation(async (payload) => ({
      ok: true,
      externalId: payload.externalId,
      openSolarId: `os-${payload.externalId}`,
    }));

    const result = await syncAll({ trigger: "MANUAL" });

    expect(result.status).toBe("SUCCESS");
    expect(result.addersPushed).toBe(2);
    expect(result.addersFailed).toBe(0);
    expect(pushAdder).toHaveBeenCalledTimes(2);
    // Write-back happens for both: a1 (null → os-a1) and a2 (os-existing → os-a2).
    expect(prisma.adder.update).toHaveBeenCalledTimes(2);
  });

  test("retired adders (active=false + openSolarId set) call archiveAdder", async () => {
    setEnabled(true);
    (prisma as PrismaTestShim).__reset([
      makeAdder({
        id: "a1",
        code: "A1",
        active: false,
        openSolarId: "os-1",
      }),
    ]);

    const result = await syncAll({ trigger: "MANUAL" });

    expect(result.status).toBe("SUCCESS");
    expect(result.addersPushed).toBe(1);
    expect(archiveAdder).toHaveBeenCalledTimes(1);
    expect(pushAdder).not.toHaveBeenCalled();
  });

  test("inactive adders without openSolarId are skipped as no-op", async () => {
    setEnabled(true);
    (prisma as PrismaTestShim).__reset([
      makeAdder({ id: "a1", active: false, openSolarId: null }),
    ]);

    const result = await syncAll({ trigger: "MANUAL" });

    expect(result.status).toBe("SUCCESS");
    expect(result.addersPushed).toBe(0);
    expect(result.addersFailed).toBe(0);
    expect(pushAdder).not.toHaveBeenCalled();
    expect(archiveAdder).not.toHaveBeenCalled();
  });

  test("partial failure: continues batch, logs failed IDs, returns PARTIAL", async () => {
    setEnabled(true);
    (prisma as PrismaTestShim).__reset([
      makeAdder({ id: "a1", code: "A1" }),
      makeAdder({ id: "a2", code: "A2" }),
      makeAdder({ id: "a3", code: "A3" }),
    ]);
    (pushAdder as jest.Mock).mockImplementation(async (payload) => {
      if (payload.externalId === "a2") {
        return { ok: false, externalId: "a2", openSolarId: "", error: "boom" };
      }
      return {
        ok: true,
        externalId: payload.externalId,
        openSolarId: `os-${payload.externalId}`,
      };
    });

    const result = await syncAll({ trigger: "CRON" });

    expect(result.status).toBe("PARTIAL");
    expect(result.addersPushed).toBe(2);
    expect(result.addersFailed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      adderId: "a2",
      code: "A2",
      action: "push",
      error: "boom",
    });
  });

  test("all failures return FAILED status", async () => {
    setEnabled(true);
    (prisma as PrismaTestShim).__reset([
      makeAdder({ id: "a1", code: "A1" }),
    ]);
    (pushAdder as jest.Mock).mockResolvedValue({
      ok: false,
      externalId: "a1",
      openSolarId: "",
      error: "500",
    });

    const result = await syncAll({ trigger: "CRON" });

    expect(result.status).toBe("FAILED");
    expect(result.addersFailed).toBe(1);
  });

  test("idempotent push: no DB writes when openSolarId unchanged", async () => {
    setEnabled(true);
    (prisma as PrismaTestShim).__reset([
      makeAdder({ id: "a1", openSolarId: "os-stable" }),
    ]);
    (pushAdder as jest.Mock).mockResolvedValue({
      ok: true,
      externalId: "a1",
      openSolarId: "os-stable", // same as DB → no write-back needed
    });

    await syncAll({ trigger: "CRON" });

    // prisma.adder.update should NOT have been called for the write-back
    // path (sync run row updates go through adderSyncRun.update, not adder.update).
    expect(prisma.adder.update).not.toHaveBeenCalled();
  });

  test("caught exception in client call is recorded as a failure, not thrown", async () => {
    setEnabled(true);
    (prisma as PrismaTestShim).__reset([
      makeAdder({ id: "a1", code: "A1" }),
      makeAdder({ id: "a2", code: "A2" }),
    ]);
    (pushAdder as jest.Mock).mockImplementation(async (payload) => {
      if (payload.externalId === "a1") throw new Error("network down");
      return {
        ok: true,
        externalId: payload.externalId,
        openSolarId: "os-a2",
      };
    });

    const result = await syncAll({ trigger: "CRON" });

    expect(result.addersFailed).toBe(1);
    expect(result.addersPushed).toBe(1);
    expect(result.errors[0].error).toBe("network down");
  });
});

describe("syncAdder — single", () => {
  test("missing adder → FAILED with not-found error", async () => {
    setEnabled(true);
    (prisma as PrismaTestShim).__reset([]);

    const result = await syncAdder("ghost", { trigger: "ON_SAVE" });

    expect(result.status).toBe("FAILED");
    expect(result.addersFailed).toBe(1);
  });

  test("kill-switch off short-circuits", async () => {
    setEnabled(false);
    (prisma as PrismaTestShim).__reset([makeAdder()]);

    const result = await syncAdder("adder-1", { trigger: "ON_SAVE" });

    expect(result.status).toBe("SUCCESS");
    expect(result.skipped).toBe(true);
    expect(pushAdder).not.toHaveBeenCalled();
  });
});
