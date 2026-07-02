/**
 * One-time (re-runnable) backfill of PE payment-split properties on HubSpot.
 *
 * Writes pe_payment_ic / pe_payment_pc / pe_total_pb_revenue for every
 * Project-pipeline, Participate-Energy-tagged deal whose stored value diverges
 * from the canonical calc (idempotent — only writes deltas). Same logic the
 * pe-api-sync cron runs on a schedule; this is for an immediate one-off heal.
 *
 * Usage:
 *   source .env && npx tsx scripts/backfill-pe-payment-splits.ts          # dry run
 *   source .env && npx tsx scripts/backfill-pe-payment-splits.ts --live   # execute
 *
 * Required env: HUBSPOT_ACCESS_TOKEN, DATABASE_URL
 */
import { backfillPePaymentSplits } from "../src/lib/pe-payment-split";

async function main() {
  const dryRun = !process.argv.includes("--live");
  console.log("═══ PE payment-split backfill ═══");
  console.log(dryRun ? "*** DRY RUN — pass --live to write to HubSpot ***\n" : "🚀 LIVE — writing to HubSpot\n");

  const r = await backfillPePaymentSplits({ dryRun });

  console.log("Sample of deals to write:");
  for (const s of r.samples) {
    console.log(`  ${s.dealId}  ${s.dealName.slice(0, 30).padEnd(30)}  ic=${s.ic}  pc=${s.pc}`);
  }
  console.log("\n═══ Summary ═══");
  console.log(`Scanned:          ${r.scanned}`);
  console.log(`Already correct:  ${r.unchanged}`);
  console.log(`No amount (skip):  ${r.skippedNoAmount}`);
  console.log(`${dryRun ? "Would write:     " : "Written:         "} ${r.updated}`);
  console.log(`Failed:           ${r.failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
