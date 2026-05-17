/**
 * scripts/fix-property-backfill-gaps.ts
 *
 * Targeted fix for the HubSpot Property backfill gaps identified by audit:
 *
 *   1. Clean stale "running" backfill lock (May 14, never completed)
 *   2. Link Zuper deals missing PropertyDealLinks (uses onDealOrTicketCreated
 *      which tries: contact address → deal address → Zuper job address)
 *   3. Recompute rollups for all Zuper-linked properties
 *
 * The original backfill script failed 5 times (never got past contacts/deals
 * phases). Properties were created via webhooks (18,904 total), but many deal
 * links and all rollups are missing.
 *
 * Re-runnable: Phase 1 skips deals that already have a PropertyDealLink.
 * Phase 2 recomputes all rollups (idempotent). Safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/fix-property-backfill-gaps.ts                    # full run
 *   npx tsx scripts/fix-property-backfill-gaps.ts --dry-run           # log only
 *   npx tsx scripts/fix-property-backfill-gaps.ts --phase=links       # only deal links
 *   npx tsx scripts/fix-property-backfill-gaps.ts --phase=rollups     # only rollups
 *   npx tsx scripts/fix-property-backfill-gaps.ts --limit=10          # process 10 items
 */

import "dotenv/config";
import { prisma } from "../src/lib/db";
import {
  onDealOrTicketCreated,
  computePropertyRollups,
} from "../src/lib/property-sync";

const DRY_RUN = process.argv.includes("--dry-run");
const PHASE = process.argv.find((a) => a.startsWith("--phase="))?.split("=")[1] ?? "all";
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? Number(arg.split("=")[1]) : Infinity;
})();

// Delay between API-heavy operations to avoid HubSpot rate limits
const INTER_OP_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 0: Clean stale backfill lock
// ─────────────────────────────────────────────────────────────────────────────

async function cleanStaleLock(): Promise<void> {
  log("Phase 0: Checking for stale backfill locks...");

  const staleRuns = await prisma.propertyBackfillRun.findMany({
    where: { status: "running" },
  });

  if (staleRuns.length === 0) {
    log("  No stale locks found.");
    return;
  }

  for (const run of staleRuns) {
    const ageMs = Date.now() - run.heartbeatAt.getTime();
    const ageHours = (ageMs / 3_600_000).toFixed(1);
    log(`  Stale run: ${run.id} (phase=${run.phase}, heartbeat ${ageHours}h ago)`);

    if (DRY_RUN) {
      log("  [DRY RUN] Would mark as failed.");
      continue;
    }

    await prisma.propertyBackfillRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        lastError: `Manually cleaned by fix-property-backfill-gaps.ts (heartbeat stale ${ageHours}h)`,
      },
    });
    log(`  Marked as failed.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Link missing Zuper deals
// ─────────────────────────────────────────────────────────────────────────────

async function findMissingZuperDealLinks(): Promise<string[]> {
  const zuperDeals = await prisma.zuperJobCache.findMany({
    select: { hubspotDealId: true },
    distinct: ["hubspotDealId"],
    where: { hubspotDealId: { not: null } },
  });

  const zuperDealIds = zuperDeals.map((d) => d.hubspotDealId!).filter(Boolean);

  const linkedDealIds = await prisma.propertyDealLink.findMany({
    select: { dealId: true },
    distinct: ["dealId"],
    where: { dealId: { in: zuperDealIds } },
  });

  const linkedSet = new Set(linkedDealIds.map((d) => d.dealId));
  return zuperDealIds.filter((id) => !linkedSet.has(id));
}

async function linkMissingDeals(): Promise<{ processed: number; linked: number; failed: number; skipped: number }> {
  log("Phase 1: Finding Zuper deals missing PropertyDealLinks...");

  const missingDealIds = await findMissingZuperDealLinks();
  log(`  Found ${missingDealIds.length} deals missing links.`);

  if (missingDealIds.length === 0) return { processed: 0, linked: 0, failed: 0, skipped: 0 };

  const toProcess = missingDealIds.slice(0, LIMIT);
  if (toProcess.length < missingDealIds.length) {
    log(`  Processing ${toProcess.length} of ${missingDealIds.length} (--limit=${LIMIT}).`);
  }

  const stats = { processed: 0, linked: 0, failed: 0, skipped: 0 };

  for (const dealId of toProcess) {
    stats.processed++;

    if (DRY_RUN) {
      log(`  [DRY RUN] Would process deal ${dealId}`);
      continue;
    }

    try {
      const outcome = await onDealOrTicketCreated("deal", dealId);
      if (outcome.status === "created" || outcome.status === "associated") {
        stats.linked++;
        log(`  Deal ${dealId}: ${outcome.status}`);
      } else {
        stats.skipped++;
        log(`  Deal ${dealId}: ${outcome.status} (${outcome.reason ?? ""})`);
      }
    } catch (err) {
      stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      log(`  Deal ${dealId}: ERROR — ${msg.slice(0, 150)}`);
    }

    if (stats.processed % 20 === 0) {
      log(`  Progress: ${stats.processed}/${toProcess.length} (linked=${stats.linked}, failed=${stats.failed})`);
    }

    await sleep(INTER_OP_DELAY_MS);
  }

  log(`  Phase 1 complete: ${stats.linked} linked, ${stats.failed} failed, ${stats.skipped} skipped.`);
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Recompute rollups for Zuper-linked properties
// ─────────────────────────────────────────────────────────────────────────────

async function findPropertiesNeedingRollups(): Promise<Array<{ id: string; hubspotObjectId: string }>> {
  // Use raw SQL to avoid Prisma's `in` clause size limits.
  // Find ALL Zuper-linked properties — recompute everything for accuracy.
  const properties = await prisma.$queryRaw<Array<{ id: string; hubspotObjectId: string }>>`
    SELECT DISTINCT pc.id, pc."hubspotObjectId"
    FROM "HubSpotPropertyCache" pc
    JOIN "PropertyDealLink" pdl ON pdl."propertyId" = pc.id
    JOIN "ZuperJobCache" zj ON zj."hubspotDealId" = pdl."dealId"
  `;

  return properties;
}

async function recomputeRollups(): Promise<{ processed: number; updated: number; failed: number }> {
  log("Phase 2: Finding Zuper-linked properties needing rollup recomputation...");

  const properties = await findPropertiesNeedingRollups();
  log(`  Found ${properties.length} properties with stale/missing rollups.`);

  if (properties.length === 0) return { processed: 0, updated: 0, failed: 0 };

  const toProcess = properties.slice(0, LIMIT);
  if (toProcess.length < properties.length) {
    log(`  Processing ${toProcess.length} of ${properties.length} (--limit=${LIMIT}).`);
  }

  const stats = { processed: 0, updated: 0, failed: 0 };

  for (const prop of toProcess) {
    stats.processed++;

    if (DRY_RUN) {
      log(`  [DRY RUN] Would recompute rollups for property ${prop.hubspotObjectId}`);
      continue;
    }

    try {
      await computePropertyRollups(prop.id);
      stats.updated++;
    } catch (err) {
      stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      log(`  Property ${prop.hubspotObjectId}: ERROR — ${msg.slice(0, 150)}`);
    }

    if (stats.processed % 50 === 0) {
      log(`  Progress: ${stats.processed}/${toProcess.length} (updated=${stats.updated}, failed=${stats.failed})`);
    }

    // computePropertyRollups makes ~3 HubSpot API calls per property
    await sleep(INTER_OP_DELAY_MS);
  }

  log(`  Phase 2 complete: ${stats.updated} updated, ${stats.failed} failed.`);
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.PROPERTY_SYNC_ENABLED !== "true") {
    console.error("PROPERTY_SYNC_ENABLED is not 'true' — refusing to run.");
    process.exit(1);
  }

  log(`fix-property-backfill-gaps.ts starting (phase=${PHASE}, dryRun=${DRY_RUN}, limit=${LIMIT === Infinity ? "none" : LIMIT})`);

  const start = Date.now();

  // Phase 0: Always clean stale locks
  await cleanStaleLock();

  // Phase 1: Link missing deals
  let linkStats = { processed: 0, linked: 0, failed: 0, skipped: 0 };
  if (PHASE === "all" || PHASE === "links") {
    linkStats = await linkMissingDeals();
  }

  // Phase 2: Recompute rollups
  let rollupStats = { processed: 0, updated: 0, failed: 0 };
  if (PHASE === "all" || PHASE === "rollups") {
    rollupStats = await recomputeRollups();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  log("=== SUMMARY ===");
  log(`  Elapsed: ${elapsed}s`);
  if (PHASE === "all" || PHASE === "links") {
    log(`  Deal links: ${linkStats.linked} linked, ${linkStats.failed} failed, ${linkStats.skipped} skipped`);
  }
  if (PHASE === "all" || PHASE === "rollups") {
    log(`  Rollups: ${rollupStats.updated} updated, ${rollupStats.failed} failed`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
