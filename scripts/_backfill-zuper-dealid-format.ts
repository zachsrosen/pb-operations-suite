/**
 * One-time backfill: rewrite ZuperJobCache.hubspotDealId rows that currently
 * hold a full HubSpot record URL (or other non-numeric mess) into their
 * bare numeric deal ID.
 *
 * Run in dry-run mode first:
 *     npx tsx scripts/_backfill-zuper-dealid-format.ts
 *
 * Then apply:
 *     npx tsx scripts/_backfill-zuper-dealid-format.ts --apply
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

function normalize(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const urlMatch = trimmed.match(/\/record\/[^/]+\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  const tailMatch = trimmed.match(/(\d{5,})(?!.*\d)/);
  if (tailMatch) return tailMatch[1];
  return undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}\n`);

  const rows = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId: { not: null } },
    select: { jobUid: true, hubspotDealId: true, jobCategory: true },
  });
  console.log(`Scanned ${rows.length} rows with non-null hubspotDealId.`);

  const toUpdate: Array<{ jobUid: string; from: string; to: string; category: string }> = [];
  let alreadyClean = 0;
  let unrecoverable = 0;
  const unrecoverableSamples: string[] = [];

  for (const r of rows) {
    const current = r.hubspotDealId!;
    const normalized = normalize(current);
    if (!normalized) {
      unrecoverable++;
      if (unrecoverableSamples.length < 5) unrecoverableSamples.push(current);
      continue;
    }
    if (normalized === current) {
      alreadyClean++;
      continue;
    }
    toUpdate.push({ jobUid: r.jobUid, from: current, to: normalized, category: r.jobCategory });
  }

  console.log(`\nResults:`);
  console.log(`  already clean (raw ID):   ${alreadyClean}`);
  console.log(`  needs update:             ${toUpdate.length}`);
  console.log(`  unrecoverable (no match): ${unrecoverable}`);
  if (unrecoverableSamples.length) {
    console.log(`  unrecoverable samples:`);
    for (const s of unrecoverableSamples) console.log(`    ${s}`);
  }

  if (toUpdate.length) {
    console.log(`\nFirst 5 rewrites:`);
    for (const u of toUpdate.slice(0, 5)) {
      console.log(`  [${u.category}] ${u.jobUid.slice(0, 20)}… ${u.from.slice(0, 70)} → ${u.to}`);
    }
  }

  // Cross-check: do any of the target numeric IDs already collide with
  // existing clean rows? Not a problem (Zuper has multiple jobs per deal),
  // but worth reporting.
  const targetIds = new Set(toUpdate.map((u) => u.to));
  const collisionCount = await prisma.zuperJobCache.count({
    where: { hubspotDealId: { in: [...targetIds] } },
  });
  console.log(`\nAfter rewrite, ${targetIds.size} unique numeric IDs will be the target;`);
  console.log(`currently ${collisionCount} rows in the cache already use one of those IDs (expected — multiple jobs per deal).`);

  if (!apply) {
    console.log(`\nDry run complete. Re-run with --apply to write changes.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying ${toUpdate.length} updates...`);
  let done = 0;
  // Batch in chunks of 50 via $transaction for throughput without
  // blocking the pool.
  const chunkSize = 50;
  for (let i = 0; i < toUpdate.length; i += chunkSize) {
    const chunk = toUpdate.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.zuperJobCache.update({
          where: { jobUid: u.jobUid },
          data: { hubspotDealId: u.to },
        }),
      ),
    );
    done += chunk.length;
    if (done % 200 === 0 || done === toUpdate.length) {
      console.log(`  ${done}/${toUpdate.length}`);
    }
  }
  console.log(`\nBackfill complete — ${done} rows updated.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
