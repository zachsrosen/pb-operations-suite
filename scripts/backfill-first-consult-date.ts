/**
 * One-time backfill of the `first_consult_date` deal property for Project-
 * pipeline deals sold since 2024 (the scorecard's comparison window).
 *
 *   npx tsx scripts/backfill-first-consult-date.ts [--dry-run] [--max N]
 *
 * Ongoing stamping is handled by /api/cron/consult-stamp.
 */
import { stampFirstConsultDates } from "../src/lib/consult-date";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const maxArg = process.argv.indexOf("--max");
  const max = maxArg >= 0 ? parseInt(process.argv[maxArg + 1], 10) : 5000;

  let total = { examined: 0, stamped: 0, noContact: 0, noConsult: 0, errors: 0 };
  // Loop until no unstamped deals remain (deals without a consult are
  // re-examined each pass but never stamped, so stop when stamped stalls).
  for (let pass = 1; pass <= 10; pass++) {
    const r = await stampFirstConsultDates({ closedOnOrAfter: "2024-01-01", max, dryRun });
    total = {
      examined: total.examined + r.examined,
      stamped: total.stamped + r.stamped,
      noContact: r.noContact,
      noConsult: r.noConsult,
      errors: total.errors + r.errors,
    };
    console.log(`pass ${pass}:`, r);
    if (dryRun || r.stamped === 0) break;
  }
  console.log("TOTAL:", total);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
