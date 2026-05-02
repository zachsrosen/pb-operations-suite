/**
 * Backfill the AircallCallCache table from the Aircall REST API.
 *
 * Usage:
 *   source .env && npm run aircall:backfill -- --days 90
 *
 * Required env vars:
 *   - DATABASE_URL
 *   - AIRCALL_API_ID
 *   - AIRCALL_API_TOKEN
 *
 * Default window: 7 days. Sleeps ~1.1s between pages to stay safely under
 * the 60 req/min Aircall rate limit.
 */

import { PrismaNeon } from "@prisma/adapter-neon";

import { AircallClient } from "../src/lib/aircall";
import { mapCallToCacheRow } from "../src/lib/aircall-webhook";
import { PrismaClient } from "../src/generated/prisma/client";

interface Options {
  days: number;
  apply: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { days: 7, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--days") {
      const next = argv[i + 1];
      if (!next) throw new Error("--days requires a number");
      opts.days = Math.max(1, Math.min(365, Number(next) || 7));
      i += 1;
    } else if (arg === "--apply") {
      opts.apply = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run aircall:backfill -- [--days N] [--apply]");
      process.exit(0);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. `source .env` first.");
    process.exit(1);
  }

  const aircall = new AircallClient();
  if (!aircall.isConfigured()) {
    console.error("AIRCALL_API_ID / AIRCALL_API_TOKEN are not set.");
    process.exit(1);
  }

  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  const to = new Date();
  const from = new Date(to.getTime() - opts.days * 24 * 60 * 60 * 1000);

  console.log(
    `Backfill window: ${from.toISOString()} → ${to.toISOString()} (${opts.days} day${opts.days === 1 ? "" : "s"})`,
  );
  if (!opts.apply) {
    console.log("DRY RUN — pass --apply to write to the database.");
  }

  let pages = 0;
  let total = 0;
  for await (const calls of aircall.iterateCalls({ from, to, perPage: 50, pageDelayMs: 1100 })) {
    pages += 1;
    if (opts.apply) {
      for (const call of calls) {
        const row = mapCallToCacheRow(call);
        await prisma.aircallCallCache.upsert({
          where: { id: row.id },
          create: row,
          update: row,
        });
      }
    }
    total += calls.length;
    console.log(`  page ${pages}: ${calls.length} calls (running total ${total})`);
  }

  console.log(`Done. Pages: ${pages}. Calls: ${total}. Wrote: ${opts.apply ? total : 0}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
