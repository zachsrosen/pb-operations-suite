// src/__tests__/product-sync-integration.test.ts
//
// Integration tests for the ProductSyncRun DB model and advisory lock behavior.
// These tests exercise real DB logic (CRUD, partial unique index, stale cleanup).
//
// The generated Prisma client uses import.meta.url (ESM) which breaks Jest (CJS).
// We mock @/generated/prisma/client to bypass that single line and re-export
// the real PrismaClient constructor from the internal class module directly.

jest.mock("@/generated/prisma/client", () => {
  const $Class = jest.requireActual(
    "@/generated/prisma/internal/class",
  ) as typeof import("@/generated/prisma/internal/class");
  const $Enums = jest.requireActual(
    "@/generated/prisma/enums",
  ) as typeof import("@/generated/prisma/enums");
  const Prisma = jest.requireActual(
    "@/generated/prisma/internal/prismaNamespace",
  ) as typeof import("@/generated/prisma/internal/prismaNamespace");
  return {
    PrismaClient: $Class.getPrismaClientClass(),
    Prisma,
    ...$Enums,
    $Enums,
  };
});

import { prisma } from "@/lib/db";

// Skip if no test database configured
const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb("product-sync integration", () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma!.productSyncRun.deleteMany({});
  });

  afterAll(async () => {
    // Clean up and disconnect
    await prisma!.productSyncRun.deleteMany({});
    await prisma!.$disconnect();
  });

  it("creates a ProductSyncRun record on execution", async () => {
    // This test validates the DB model works correctly
    const run = await prisma!.productSyncRun.create({
      data: {
        trigger: "manual",
        triggeredBy: "test@example.com",
        zohoScanned: 10,
        hubspotScanned: 5,
        zuperScanned: 3,
        imported: 2,
        linked: 1,
        flagged: 3,
        skipped: 12,
        completedAt: new Date(),
      },
    });

    expect(run.id).toBeTruthy();
    expect(run.trigger).toBe("manual");
    expect(run.imported).toBe(2);

    // Verify index works by querying by startedAt
    const recent = await prisma!.productSyncRun.findFirst({
      orderBy: { startedAt: "desc" },
    });
    expect(recent?.id).toBe(run.id);
  });

  it("active run prevents concurrent execution via unique constraint", async () => {
    // Create an active run with lockSentinel="ACTIVE"
    await prisma!.productSyncRun.create({
      data: {
        trigger: "cron",
        lockSentinel: "ACTIVE",
      },
    });

    // A second create with lockSentinel="ACTIVE" should fail with P2002
    await expect(
      prisma!.productSyncRun.create({
        data: { trigger: "cron", lockSentinel: "ACTIVE" },
      }),
    ).rejects.toThrow();
  });

  it("completed runs do not block new runs", async () => {
    // Create a completed run (lockSentinel is null — no schema default)
    await prisma!.productSyncRun.create({
      data: {
        trigger: "cron",
        completedAt: new Date(),
        // lockSentinel omitted = null, so it won't hold the lock
      },
    });

    // A new active run should succeed
    const newRun = await prisma!.productSyncRun.create({
      data: { trigger: "cron", lockSentinel: "ACTIVE" },
    });
    expect(newRun.id).toBeTruthy();
  });

  it("stale runs older than 5 min are cleaned up", async () => {
    // Create a stale run (started 10 min ago, never completed)
    await prisma!.productSyncRun.create({
      data: {
        trigger: "cron",
        lockSentinel: "ACTIVE",
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    // Clean up stale runs (same logic as orchestrator)
    const updated = await prisma!.productSyncRun.updateMany({
      where: {
        lockSentinel: "ACTIVE",
        startedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
      data: {
        completedAt: new Date(),
        lockSentinel: null,
        errors: JSON.stringify(["Marked as failed: exceeded 5-minute timeout"]),
      },
    });

    expect(updated.count).toBe(1);
  });
});
