/**
 * Adder catalog → OpenSolar sync orchestrator.
 *
 * Walks the local `Adder` table, diffs each row against its `openSolarId`
 * state, and calls the client's push/archive as needed. Aggregates
 * per-adder outcomes into an `AdderSyncRun` row for telemetry.
 *
 * Kill-switch contract: when `ADDER_SYNC_ENABLED !== "true"`, the
 * orchestrator short-circuits to a SUCCESS run with 0 pushes / 0 failures
 * and does NOT call the client at all. This keeps the system safe until
 * Pre-Phase Discovery finishes.
 */
import { prisma } from "@/lib/db";
import type { AdderSyncRunStatus, AdderSyncTrigger } from "@/generated/prisma/enums";
import type { AdderWithOverrides } from "./types";
import {
  pushAdder,
  archiveAdder,
  toPayload,
} from "./opensolar-client";

export type SyncTrigger = AdderSyncTrigger;

export type SyncErrorEntry = {
  adderId: string;
  code: string;
  action: "push" | "archive";
  error: string;
};

export type SyncRunResult = {
  runId: string;
  status: AdderSyncRunStatus;
  addersPushed: number;
  addersFailed: number;
  errors: SyncErrorEntry[];
  skipped?: boolean; // true when kill switch was off
};

function isEnabled(): boolean {
  return process.env.ADDER_SYNC_ENABLED === "true";
}

/**
 * Sync a single adder by id. Primarily used by future `ON_SAVE` triggers
 * from the catalog editor. Exported here so the same diff logic powers
 * both single + batch paths.
 */
export async function syncAdder(
  adderId: string,
  opts: { trigger: SyncTrigger },
): Promise<SyncRunResult> {
  const run = await prisma.adderSyncRun.create({
    data: {
      status: "RUNNING",
      trigger: opts.trigger,
    },
  });

  if (!isEnabled()) {
    const finished = await prisma.adderSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        addersPushed: 0,
        addersFailed: 0,
      },
    });
    return {
      runId: finished.id,
      status: finished.status,
      addersPushed: 0,
      addersFailed: 0,
      errors: [],
      skipped: true,
    };
  }

  const adder = await prisma.adder.findUnique({
    where: { id: adderId },
    include: { overrides: true },
  });
  if (!adder) {
    const finished = await prisma.adderSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorLog: { errors: [{ adderId, error: "not found" }] },
      },
    });
    return {
      runId: finished.id,
      status: finished.status,
      addersPushed: 0,
      addersFailed: 1,
      errors: [{ adderId, code: "", action: "push", error: "not found" }],
    };
  }

  const { pushed, failed, errors } = await processOne(adder);
  const status: AdderSyncRunStatus = failed > 0 ? "FAILED" : "SUCCESS";
  const finished = await prisma.adderSyncRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt: new Date(),
      addersPushed: pushed,
      addersFailed: failed,
      errorLog: errors.length > 0 ? { errors } : undefined,
    },
  });
  return {
    runId: finished.id,
    status: finished.status,
    addersPushed: pushed,
    addersFailed: failed,
    errors,
  };
}

/**
 * Sync every adder. Invoked by manual-trigger API + nightly cron.
 *
 * Diff rules:
 *  - `active=true` + no `openSolarId` → push (create).
 *  - `active=true` + has `openSolarId` → push (update, client decides).
 *  - `active=false` + has `openSolarId` → archive.
 *  - `active=false` + no `openSolarId` → no-op.
 *
 * Partial failure does not abort the batch — each adder is attempted
 * independently so a single bad row can't block the rest.
 */
export async function syncAll(opts: {
  trigger: SyncTrigger;
}): Promise<SyncRunResult> {
  const run = await prisma.adderSyncRun.create({
    data: {
      status: "RUNNING",
      trigger: opts.trigger,
    },
  });

  if (!isEnabled()) {
    const finished = await prisma.adderSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        addersPushed: 0,
        addersFailed: 0,
      },
    });
    return {
      runId: finished.id,
      status: finished.status,
      addersPushed: 0,
      addersFailed: 0,
      errors: [],
      skipped: true,
    };
  }

  const adders = await prisma.adder.findMany({
    include: { overrides: true },
  });

  let pushed = 0;
  let failed = 0;
  const errors: SyncErrorEntry[] = [];

  for (const adder of adders) {
    const res = await processOne(adder);
    pushed += res.pushed;
    failed += res.failed;
    errors.push(...res.errors);
  }

  const status: AdderSyncRunStatus =
    failed === 0 ? "SUCCESS" : pushed === 0 ? "FAILED" : "PARTIAL";

  const finished = await prisma.adderSyncRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt: new Date(),
      addersPushed: pushed,
      addersFailed: failed,
      errorLog: errors.length > 0 ? { errors } : undefined,
    },
  });

  return {
    runId: finished.id,
    status: finished.status,
    addersPushed: pushed,
    addersFailed: failed,
    errors,
  };
}

/**
 * Process one adder: decide push vs archive vs no-op, call client, write
 * back `openSolarId` on push success. Isolated so both single and batch
 * callers share exactly the same diff logic.
 */
async function processOne(adder: AdderWithOverrides): Promise<{
  pushed: number;
  failed: number;
  errors: SyncErrorEntry[];
}> {
  const errors: SyncErrorEntry[] = [];
  try {
    if (!adder.active && !adder.openSolarId) {
      // Inactive and never synced → nothing to do. Idempotent no-op.
      return { pushed: 0, failed: 0, errors };
    }

    if (!adder.active && adder.openSolarId) {
      const res = await archiveAdder(
        { externalId: adder.id },
        adder.openSolarId,
      );
      if (!res.ok) {
        errors.push({
          adderId: adder.id,
          code: adder.code,
          action: "archive",
          error: res.error ?? "unknown",
        });
        return { pushed: 0, failed: 1, errors };
      }
      // Keep `openSolarId` so reactivation can re-push to the same record.
      return { pushed: 1, failed: 0, errors };
    }

    // Active adder: push.
    const payload = toPayload(adder);
    const res = await pushAdder(payload, adder.openSolarId);
    if (!res.ok) {
      errors.push({
        adderId: adder.id,
        code: adder.code,
        action: "push",
        error: res.error ?? "unknown",
      });
      return { pushed: 0, failed: 1, errors };
    }
    // Write back the remote id if it changed (first create, or remote
    // reassigned). No-op update when identical — Prisma is fine with that.
    if (res.openSolarId && res.openSolarId !== adder.openSolarId) {
      await prisma.adder.update({
        where: { id: adder.id },
        data: { openSolarId: res.openSolarId },
      });
    }
    return { pushed: 1, failed: 0, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({
      adderId: adder.id,
      code: adder.code,
      action: adder.active ? "push" : "archive",
      error: msg,
    });
    return { pushed: 0, failed: 1, errors };
  }
}
