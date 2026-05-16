/**
 * Backfill Shovels property enrichment.
 *
 * Resumable, priority-ordered:
 *   Tier 1: Properties with deal links (by associatedDealsCount DESC)
 *   Tier 2: Properties with ticket links but no deal links
 *   Tier 3: Remaining properties
 *
 * Usage:
 *   npx dotenv -e .env -- npx tsx scripts/backfill-shovels-enrichment.ts
 *   npx dotenv -e .env -- npx tsx scripts/backfill-shovels-enrichment.ts --dry-run
 *   npx dotenv -e .env -- npx tsx scripts/backfill-shovels-enrichment.ts --limit 100
 *   npx dotenv -e .env -- npx tsx scripts/backfill-shovels-enrichment.ts --tier 1
 */

import { prisma } from "../src/lib/db";
import { createShovelsClient, getLastCreditsRemaining } from "../src/lib/shovels";
import { enrichPropertyFromShovels } from "../src/lib/shovels-enrichment";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit"));
const LIMIT = LIMIT_ARG
  ? parseInt(LIMIT_ARG.split("=")[1] || process.argv[process.argv.indexOf("--limit") + 1], 10)
  : Infinity;
const TIER_ARG = process.argv.find((a) => a.startsWith("--tier"));
const TIER_ONLY = TIER_ARG
  ? parseInt(TIER_ARG.split("=")[1] || process.argv[process.argv.indexOf("--tier") + 1], 10)
  : null;

const DELAY_MS = 500;
const CREDIT_FLOOR = 1000;
const CREDIT_MIN_START = 2000;
const LOG_INTERVAL = 50;

let shuttingDown = false;
process.on("SIGINT", () => {
  console.log("\nSIGINT received — finishing current property and saving progress...");
  shuttingDown = true;
});

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface TierQuery {
  tier: number;
  label: string;
  where: object;
  orderBy: object;
}

function getTierQueries(): TierQuery[] {
  const tiers: TierQuery[] = [
    {
      tier: 1,
      label: "Deal-linked properties",
      where: {
        OR: [
          { shovelsEnrichmentStatus: null },
          { shovelsEnrichmentStatus: { notIn: ["ENRICHED", "REJECTED", "NO_MATCH"] } },
        ],
        dealLinks: { some: {} },
      },
      orderBy: { associatedDealsCount: "desc" as const },
    },
    {
      tier: 2,
      label: "Ticket-linked properties (no deals)",
      where: {
        OR: [
          { shovelsEnrichmentStatus: null },
          { shovelsEnrichmentStatus: { notIn: ["ENRICHED", "REJECTED", "NO_MATCH"] } },
        ],
        dealLinks: { none: {} },
        ticketLinks: { some: {} },
      },
      orderBy: { associatedTicketsCount: "desc" as const },
    },
    {
      tier: 3,
      label: "Remaining properties",
      where: {
        OR: [
          { shovelsEnrichmentStatus: null },
          { shovelsEnrichmentStatus: { notIn: ["ENRICHED", "REJECTED", "NO_MATCH"] } },
        ],
        dealLinks: { none: {} },
        ticketLinks: { none: {} },
      },
      orderBy: { createdAt: "asc" as const },
    },
  ];

  if (TIER_ONLY) {
    return tiers.filter((t) => t.tier === TIER_ONLY);
  }
  return tiers;
}

async function main() {
  console.log(`Shovels Property Enrichment Backfill${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`Limit: ${LIMIT === Infinity ? "none" : LIMIT}`);
  if (TIER_ONLY) console.log(`Tier: ${TIER_ONLY} only`);
  console.log();

  // Credit check
  const client = createShovelsClient();
  const usage = await client.getUsage();
  const remaining = (usage.credit_limit ?? 25000) - usage.credits_used;
  console.log(`Credits: ${usage.credits_used} used / ${usage.credit_limit ?? "unlimited"} limit (${remaining} remaining)`);

  if (usage.is_over_limit || remaining < CREDIT_MIN_START) {
    console.error(`Insufficient credits (need at least ${CREDIT_MIN_START}). Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log();

  const tiers = getTierQueries();
  let totalProcessed = 0;

  for (const tierQuery of tiers) {
    if (totalProcessed >= LIMIT || shuttingDown) break;

    console.log(`=== Tier ${tierQuery.tier}: ${tierQuery.label} ===`);

    // Find or create backfill run
    let run = await prisma.shovelsBackfillRun.findFirst({
      where: { tier: tierQuery.tier, status: "RUNNING" },
    });
    if (!run) {
      run = await prisma.shovelsBackfillRun.create({
        data: { tier: tierQuery.tier, status: "RUNNING" },
      });
    }

    // Fetch candidates
    const candidates = await (prisma.hubSpotPropertyCache.findMany as Function)({
      where: {
        ...tierQuery.where,
        ...(run.cursor ? { id: { gt: run.cursor } } : {}),
      },
      select: { id: true, streetAddress: true, city: true, state: true },
      orderBy: tierQuery.orderBy,
      take: Math.min(LIMIT - totalProcessed, 10000),
    });

    console.log(`  Candidates: ${candidates.length}`);

    const stats = { enriched: 0, noMatch: 0, rejected: 0, errors: 0, skipped: 0 };
    let batchCredits = 0;

    for (let i = 0; i < candidates.length; i++) {
      if (totalProcessed >= LIMIT || shuttingDown) break;

      const prop = candidates[i];

      if (DRY_RUN) {
        console.log(`  [DRY] ${prop.streetAddress}, ${prop.city}, ${prop.state}`);
        totalProcessed++;
        continue;
      }

      const result = await enrichPropertyFromShovels(prop.id);
      totalProcessed++;
      batchCredits += result.creditsUsed;

      switch (result.status) {
        case "enriched": stats.enriched++; break;
        case "no-match": stats.noMatch++; break;
        case "rejected": case "low-confidence": stats.rejected++; break;
        case "error": stats.errors++; break;
        case "skipped": stats.skipped++; break;
      }

      // Log progress
      if (totalProcessed % LOG_INTERVAL === 0) {
        const creditsLeft = getLastCreditsRemaining();
        console.log(
          `  [${totalProcessed}] enriched=${stats.enriched} noMatch=${stats.noMatch} ` +
          `rejected=${stats.rejected} errors=${stats.errors} credits_remaining=${creditsLeft ?? "?"}`,
        );
      }

      // Credit guard
      const creditsLeft = getLastCreditsRemaining();
      if (creditsLeft !== null && creditsLeft < CREDIT_FLOOR) {
        console.log(`\n  Credit floor reached (${creditsLeft} remaining). Pausing.`);
        await prisma.shovelsBackfillRun.update({
          where: { id: run.id },
          data: {
            cursor: prop.id,
            totalProcessed: { increment: totalProcessed },
            totalEnriched: { increment: stats.enriched },
            totalNoMatch: { increment: stats.noMatch },
            totalRejected: { increment: stats.rejected },
            totalErrors: { increment: stats.errors },
            creditsUsed: { increment: batchCredits },
            status: "PAUSED",
          },
        });
        await prisma.$disconnect();
        process.exit(0);
      }

      // Update cursor periodically
      if (totalProcessed % LOG_INTERVAL === 0) {
        await prisma.shovelsBackfillRun.update({
          where: { id: run.id },
          data: {
            cursor: prop.id,
            totalProcessed: { increment: LOG_INTERVAL },
            totalEnriched: { increment: stats.enriched },
            totalNoMatch: { increment: stats.noMatch },
            totalRejected: { increment: stats.rejected },
            totalErrors: { increment: stats.errors },
            creditsUsed: { increment: batchCredits },
          },
        });
        // Reset batch counters after saving
        stats.enriched = 0;
        stats.noMatch = 0;
        stats.rejected = 0;
        stats.errors = 0;
        batchCredits = 0;
      }

      await sleep(DELAY_MS);
    }

    // Mark tier complete
    const finalStatus = shuttingDown ? "PAUSED" : "COMPLETED";
    await prisma.shovelsBackfillRun.update({
      where: { id: run.id },
      data: {
        cursor: candidates[candidates.length - 1]?.id ?? run.cursor,
        totalProcessed: { increment: stats.enriched + stats.noMatch + stats.rejected + stats.errors + stats.skipped },
        totalEnriched: { increment: stats.enriched },
        totalNoMatch: { increment: stats.noMatch },
        totalRejected: { increment: stats.rejected },
        totalErrors: { increment: stats.errors },
        creditsUsed: { increment: batchCredits },
        status: finalStatus,
        ...(finalStatus === "COMPLETED" ? { completedAt: new Date() } : {}),
      },
    });

    console.log(`  Tier ${tierQuery.tier} ${finalStatus.toLowerCase()}`);
    console.log();
  }

  console.log("=== BACKFILL COMPLETE ===");
  console.log(`Total processed: ${totalProcessed}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
