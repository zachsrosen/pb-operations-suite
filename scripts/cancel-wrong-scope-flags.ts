/**
 * One-off cleanup: cancel PM flags created by the rule cron that are
 * not on PROJECT-pipeline deals. The original cron run (2026-04-28
 * ~23:25 UTC) raised 211 flags across multiple pipelines because the
 * pipeline filter was missing. This script cancels the wrongly-scoped
 * ones and leaves valid PROJECT-pipeline flags in place.
 *
 * Run with:
 *   npx tsx scripts/cancel-wrong-scope-flags.ts
 *
 * Or use --all to cancel ALL ADMIN_WORKFLOW flags from the bad run
 * (e.g. if PMs already triaged the valid ones and you want a clean
 * slate before the next cron firing).
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const CANCEL_REASON = "First-run misfire — cron lacked pipeline=PROJECT filter and emailed by default. Re-raises cleanly next run if still applicable.";

async function main() {
  const cancelAll = process.argv.includes("--all");

  // The bad run was 2026-04-28 ~23:25 UTC. Use an hour window for safety.
  const since = new Date("2026-04-28T23:00:00Z");
  const until = new Date("2026-04-29T00:30:00Z");

  const candidates = await prisma.pmFlag.findMany({
    where: {
      source: "ADMIN_WORKFLOW",
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      raisedAt: { gte: since, lte: until },
    },
    select: { id: true, hubspotDealId: true, type: true, severity: true },
  });

  console.log(`Candidates (ADMIN_WORKFLOW, OPEN/ACK, in misfire window): ${candidates.length}`);

  // Look up pipelines for each candidate's deal.
  const dealIds = [...new Set(candidates.map(c => c.hubspotDealId))];
  const deals = await prisma.deal.findMany({
    where: { hubspotDealId: { in: dealIds } },
    select: { hubspotDealId: true, pipeline: true },
  });
  const pipelineByDeal = new Map(deals.map(d => [d.hubspotDealId, d.pipeline]));

  const toCancel = candidates.filter(c => {
    if (cancelAll) return true;
    const pipeline = pipelineByDeal.get(c.hubspotDealId);
    return pipeline !== "PROJECT";
  });
  const toKeep = candidates.length - toCancel.length;

  console.log(`Will cancel: ${toCancel.length}`);
  console.log(`Will keep:   ${toKeep} (PROJECT-pipeline flags)`);
  if (cancelAll) console.log("(--all flag set — cancelling ALL misfire flags regardless of pipeline)");

  if (process.argv.includes("--dry-run")) {
    console.log("\nDRY RUN — no changes made. Run without --dry-run to apply.");
    await prisma.$disconnect();
    return;
  }

  let cancelled = 0;
  for (const flag of toCancel) {
    await prisma.pmFlag.update({
      where: { id: flag.id },
      data: {
        status: "CANCELLED",
        events: {
          create: {
            eventType: "CANCELLED",
            actorUserId: null,
            notes: CANCEL_REASON,
          },
        },
      },
    });
    cancelled++;
  }

  console.log(`\nCancelled ${cancelled} flags.`);
  console.log(`Open flags remaining: ${await prisma.pmFlag.count({ where: { status: "OPEN" } })}`);
}

main()
  .catch(err => {
    console.error("ERROR:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
