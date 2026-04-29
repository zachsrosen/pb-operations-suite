/**
 * Dry-run the PM flag rules locally — shows match counts per rule without
 * creating flags or sending emails. Uses the current branch's rules code,
 * so it reflects any pending fixes before they hit prod.
 *
 * Run: npx tsx scripts/dry-run-pm-flags.ts
 */

import { runAllRules } from "../src/lib/pm-flag-rules";

async function main() {
  const start = Date.now();
  const summary = await runAllRules({ dryRun: true });
  const total = Date.now() - start;

  console.log(`Total runtime:       ${total}ms`);
  console.log(`Total matches:       ${summary.totalMatches}`);
  console.log(`Created (should be 0): ${summary.totalCreated}`);
  console.log(`Already existed:     ${summary.totalAlreadyExisted}`);
  console.log(`Errors:              ${summary.totalErrors}`);
  console.log("");
  console.log("Per rule:");
  for (const r of summary.byRule) {
    const bar = "▌".repeat(Math.min(r.matches, 30));
    console.log(`  ${r.rule.padEnd(34)} ${String(r.matches).padStart(3)}  ${bar}  (${r.durationMs}ms)`);
  }
  if (summary.errors.length > 0) {
    console.log("\nErrors:");
    for (const e of summary.errors) console.log(`  [${e.rule}] ${e.dealId ?? "-"}: ${e.error}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
