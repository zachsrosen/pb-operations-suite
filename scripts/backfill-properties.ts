// scripts/backfill-properties.ts
//
// Resumable 4-phase backfill for the HubSpot Property object.
//
// Usage:
//   PROPERTY_SYNC_ENABLED=true tsx scripts/backfill-properties.ts
//   BACKFILL_LIMIT=10 PROPERTY_SYNC_ENABLED=true tsx scripts/backfill-properties.ts
//
// Resumability: if a prior run crashed, `acquireBackfillLock()` will either
// steal the stale lock (after STALE_LOCK_MS) or report already-running. When
// it returns a `resumeFrom` (non-null), we start the matching phase at the
// stored cursor instead of the beginning.
//
// Throttling: per-record work runs serially. The underlying handlers
// (property-sync) internally throttle HubSpot + Google Maps calls below
// Google's 50 req/s limit.
//
// Exit codes:
//   0 — success
//   1 — PROPERTY_SYNC_ENABLED is not "true"
//   2 — another backfill already holds the lock
//   3 — unhandled error during run (see stderr)

import "dotenv/config";
import {
  acquireBackfillLock,
  releaseBackfillLock,
  heartbeatBackfillLock,
  HEARTBEAT_MS,
} from "../src/lib/property-backfill-lock";
import {
  onContactAddressChange,
  onDealOrTicketCreated,
  reconcileAllProperties,
  type SyncOutcome,
} from "../src/lib/property-sync";
import { prisma } from "../src/lib/db";
import {
  searchHubSpotContactsWithDeals,
  searchAllHubSpotDeals,
  searchAllHubSpotTickets,
} from "../src/lib/hubspot";

const LIMIT = process.env.BACKFILL_LIMIT
  ? Number(process.env.BACKFILL_LIMIT)
  : Infinity;

/** Counters shared across all phases so BACKFILL_LIMIT bounds the whole run. */
let totalProcessed = 0;

type CounterDeltas = {
  processed?: number;
  created?: number;
  associated?: number;
  failed?: number;
};

async function incrementCounters(runId: string, deltas: CounterDeltas): Promise<void> {
  if (deltas.processed) totalProcessed += deltas.processed;
  await prisma.propertyBackfillRun.update({
    where: { id: runId },
    data: {
      totalProcessed: { increment: deltas.processed ?? 0 },
      totalCreated: { increment: deltas.created ?? 0 },
      totalAssociated: { increment: deltas.associated ?? 0 },
      totalFailed: { increment: deltas.failed ?? 0 },
    },
  });
}

/**
 * Map a SyncOutcome to counter deltas.
 *   created    → created++, processed++
 *   associated → associated++, processed++
 *   skipped    → processed++
 *   deferred   → processed++
 *   failed     → failed++, processed++
 */
function outcomeDeltas(outcome: SyncOutcome): CounterDeltas {
  switch (outcome.status) {
    case "created":
      return { processed: 1, created: 1 };
    case "associated":
      return { processed: 1, associated: 1 };
    case "skipped":
    case "deferred":
      return { processed: 1 };
    case "failed":
      return { processed: 1, failed: 1 };
    default:
      // Exhaustiveness: unreachable, but count as processed so we don't stall.
      return { processed: 1 };
  }
}

async function runPhase(
  runId: string,
  phase: "contacts" | "deals" | "tickets" | "reconcile",
  body: (updateCursor: (c: string | null) => Promise<void>) => Promise<void>,
): Promise<void> {
  await prisma.propertyBackfillRun.update({
    where: { id: runId },
    data: { phase, cursor: null },
  });
  await body(async (c) => {
    await prisma.propertyBackfillRun.update({
      where: { id: runId },
      data: { cursor: c },
    });
  });
}

function limitReached(): boolean {
  return totalProcessed >= LIMIT;
}

async function main(): Promise<void> {
  if (process.env.PROPERTY_SYNC_ENABLED !== "true") {
    console.error("PROPERTY_SYNC_ENABLED is false — refusing to run");
    process.exit(1);
  }

  const lock = await acquireBackfillLock();
  if ("reason" in lock) {
    console.error(
      `Another backfill is running (runId=${lock.runningRunId}, last heartbeat ${lock.heartbeatAt.toISOString()}). Aborting.`,
    );
    process.exit(2);
  }

  console.warn(
    `[backfill] acquired lock runId=${lock.runId}` +
      (lock.resumeFrom
        ? ` resumeFrom=${lock.resumeFrom.phase}:${lock.resumeFrom.cursor ?? "start"}`
        : ""),
  );

  const heartbeatTimer = setInterval(() => {
    heartbeatBackfillLock(lock.runId).catch((err) =>
      console.error("[backfill] heartbeat failed:", err),
    );
  }, HEARTBEAT_MS);
  heartbeatTimer.unref?.();

  try {
    // ---------------------------------------------------------------------
    // Phase 1: Contacts that have been on a Deal
    // ---------------------------------------------------------------------
    const resumeContacts =
      lock.resumeFrom?.phase === "contacts" ? lock.resumeFrom.cursor : null;
    const skipContacts =
      lock.resumeFrom != null && lock.resumeFrom.phase !== "contacts";

    if (!skipContacts) {
      await runPhase(lock.runId, "contacts", async (updateCursor) => {
        let cursor: string | null = resumeContacts;
        do {
          if (limitReached()) break;
          const page = await searchHubSpotContactsWithDeals(cursor);
          for (const contact of page.results) {
            if (limitReached()) break;
            try {
              const outcome = await onContactAddressChange(contact.id);
              await incrementCounters(lock.runId, outcomeDeltas(outcome));
            } catch (err) {
              console.error(
                `[backfill] contact ${contact.id} failed:`,
                err instanceof Error ? err.message : err,
              );
              await incrementCounters(lock.runId, { processed: 1, failed: 1 });
            }
          }
          cursor = page.paging?.next?.after ?? null;
          await updateCursor(cursor);
        } while (cursor);
      });
    }

    // ---------------------------------------------------------------------
    // Phase 2: Deals
    // ---------------------------------------------------------------------
    const resumeDeals =
      lock.resumeFrom?.phase === "deals" ? lock.resumeFrom.cursor : null;
    const skipDeals =
      lock.resumeFrom != null &&
      lock.resumeFrom.phase !== "contacts" &&
      lock.resumeFrom.phase !== "deals";

    if (!skipDeals && !limitReached()) {
      await runPhase(lock.runId, "deals", async (updateCursor) => {
        let cursor: string | null = resumeDeals;
        do {
          if (limitReached()) break;
          const page = await searchAllHubSpotDeals(cursor);
          for (const deal of page.results) {
            if (limitReached()) break;
            try {
              const outcome = await onDealOrTicketCreated("deal", deal.id);
              await incrementCounters(lock.runId, outcomeDeltas(outcome));
            } catch (err) {
              console.error(
                `[backfill] deal ${deal.id} failed:`,
                err instanceof Error ? err.message : err,
              );
              await incrementCounters(lock.runId, { processed: 1, failed: 1 });
            }
          }
          cursor = page.paging?.next?.after ?? null;
          await updateCursor(cursor);
        } while (cursor);
      });
    }

    // ---------------------------------------------------------------------
    // Phase 3: Tickets (mirror of phase 2)
    // ---------------------------------------------------------------------
    const resumeTickets =
      lock.resumeFrom?.phase === "tickets" ? lock.resumeFrom.cursor : null;
    const skipTickets =
      lock.resumeFrom != null && lock.resumeFrom.phase === "reconcile";

    if (!skipTickets && !limitReached()) {
      await runPhase(lock.runId, "tickets", async (updateCursor) => {
        let cursor: string | null = resumeTickets;
        do {
          if (limitReached()) break;
          const page = await searchAllHubSpotTickets(cursor);
          for (const ticket of page.results) {
            if (limitReached()) break;
            try {
              const outcome = await onDealOrTicketCreated("ticket", ticket.id);
              await incrementCounters(lock.runId, outcomeDeltas(outcome));
            } catch (err) {
              console.error(
                `[backfill] ticket ${ticket.id} failed:`,
                err instanceof Error ? err.message : err,
              );
              await incrementCounters(lock.runId, { processed: 1, failed: 1 });
            }
          }
          cursor = page.paging?.next?.after ?? null;
          await updateCursor(cursor);
        } while (cursor);
      });
    }

    // ---------------------------------------------------------------------
    // Phase 4: Reconcile — the net catcher for any records that 1–3 missed
    // or that drifted while we were running.
    // ---------------------------------------------------------------------
    if (!limitReached()) {
      await runPhase(lock.runId, "reconcile", async () => {
        await reconcileAllProperties();
      });
    } else {
      console.warn(
        `[backfill] BACKFILL_LIMIT=${LIMIT} reached — skipping reconcile phase`,
      );
    }

    await releaseBackfillLock(lock.runId, "completed");
    console.warn(
      `[backfill] completed runId=${lock.runId} totalProcessed=${totalProcessed}`,
    );
  } catch (err) {
    await releaseBackfillLock(
      lock.runId,
      "failed",
      err instanceof Error ? err.message : "unknown",
    );
    throw err;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(3);
});
