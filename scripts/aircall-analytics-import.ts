/**
 * Import an Aircall Analytics+ ringing-attempts CSV into AircallAnalyticsSummary.
 *
 * Usage:
 *   source .env && npx tsx scripts/aircall-analytics-import.ts \
 *     --file /path/to/ringing_attempts_per_user.csv \
 *     --start 2026-01-01 \
 *     --end   2026-05-02 \
 *     --apply
 *
 * Without --apply, runs as a dry-run (parses and reports only).
 */

import fs from "node:fs";
import path from "node:path";

import { PrismaNeon } from "@prisma/adapter-neon";

import { importRingingAttemptsCsv, parseAircallCsv } from "../src/lib/aircall-analytics-import";
import { PrismaClient } from "../src/generated/prisma/client";

interface Options {
  file: string;
  start: string;
  end: string;
  apply: boolean;
  importedBy?: string;
}

function parseArgs(argv: string[]): Options {
  const o: Partial<Options> = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") o.file = argv[++i];
    else if (a === "--start") o.start = argv[++i];
    else if (a === "--end") o.end = argv[++i];
    else if (a === "--by") o.importedBy = argv[++i];
    else if (a === "--apply") o.apply = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: aircall-analytics-import --file PATH --start YYYY-MM-DD --end YYYY-MM-DD [--apply] [--by EMAIL]`);
      process.exit(0);
    }
  }
  if (!o.file || !o.start || !o.end) {
    console.error("Missing --file/--start/--end. Run with --help.");
    process.exit(2);
  }
  return o as Options;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. `source .env` first.");
    process.exit(1);
  }

  const filePath = path.resolve(opts.file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  const csv = fs.readFileSync(filePath, "utf8");
  const start = new Date(opts.start);
  const end = new Date(opts.end);

  // Dry-run: parse and show summary
  const rows = parseAircallCsv(csv);
  console.log(`File: ${filePath}`);
  console.log(`Period: ${start.toISOString()} → ${end.toISOString()}`);
  console.log(`Parsed rows: ${rows.length}`);
  if (rows.length > 0) {
    const first = rows[0];
    console.log(`First row sample: ${JSON.stringify(first)}`);
  }
  if (!opts.apply) {
    console.log("\nDRY RUN — no DB writes. Pass --apply to import.");
    return;
  }

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const result = await importRingingAttemptsCsv({
    csvText: csv,
    periodStart: start,
    periodEnd: end,
    importedBy: opts.importedBy ?? null,
    filename: path.basename(filePath),
    prisma: prisma as unknown as Parameters<typeof importRingingAttemptsCsv>[0]["prisma"],
  });

  console.log(`\nImported: ${result.rowsImported} of ${result.rowsParsed} rows`);
  if (result.errors.length > 0) {
    console.log(`Errors:`);
    for (const e of result.errors) console.log(`  row ${e.row}: ${e.message}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
