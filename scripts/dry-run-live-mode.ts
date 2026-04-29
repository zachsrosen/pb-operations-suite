/**
 * Run the live-mode evaluator against current DB state.
 *
 * NOTE: Despite the "dry-run" name, this DOES mutate the DB — it calls
 * `evaluateLiveFlags()` which creates / auto-resolves / reopens flags.
 * The "dry-run" framing means: a way to preview what live-mode would
 * do at the CLI before opening the page. For a truly read-only preview
 * of rule matches, use `dry-run-pm-flags.ts` (calls runAllRules with
 * dryRun:true).
 *
 * Run: npx tsx scripts/dry-run-live-mode.ts
 */

import { evaluateLiveFlags } from "../src/lib/pm-flag-rules";

async function main() {
  console.log("Running evaluateLiveFlags() against current DB state...\n");
  const summary = await evaluateLiveFlags();

  console.log(`Total runtime:       ${summary.durationMs}ms`);
  console.log("");

  for (const phaseName of ["phase1", "phase2"] as const) {
    const p = summary[phaseName];
    console.log(`=== ${phaseName.toUpperCase()} ===`);
    console.log(`  Matches:        ${p.matches}`);
    console.log(`  Created:        ${p.created}`);
    console.log(`  Reopened:       ${p.reopened}`);
    console.log(`  Auto-resolved:  ${p.autoResolved}`);
    console.log(`  No-op:          ${p.noOp}`);
    console.log(`  Errors:         ${p.errors.length}`);
    if (p.byRule.length > 0) {
      console.log("  Per rule:");
      for (const r of p.byRule) {
        const bar = "▌".repeat(Math.min(r.matches, 30));
        console.log(`    ${r.rule.padEnd(34)} ${String(r.matches).padStart(3)}  ${bar}  (${r.durationMs}ms)`);
      }
    }
    if (p.errors.length > 0) {
      console.log("  Errors:");
      for (const e of p.errors) console.log(`    [${e.rule}] ${e.dealId ?? "-"}: ${e.error}`);
    }
    console.log("");
  }
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
