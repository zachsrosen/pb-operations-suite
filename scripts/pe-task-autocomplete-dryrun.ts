/**
 * READ-ONLY preview of what PE task auto-completion WOULD close, grouped by kind.
 * Makes no writes (dryRun). Use before enabling PE_TASK_AUTOCOMPLETE_ENABLED.
 *
 *   tsx scripts/pe-task-autocomplete-dryrun.ts
 */
import "dotenv/config";
import { autocompletePeTasks } from "../src/lib/pe-task-autocomplete";

async function main() {
  const res = await autocompletePeTasks({ dryRun: true });

  const byKind = new Map<string, number>();
  for (const c of res.completed) {
    const k = `${c.kind}${c.team ? `/${c.team}` : ""}/${c.milestone}`;
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }

  console.log(
    `scanned open PE tasks: ${res.scannedTasks} | candidates: ${res.candidates} | WOULD complete: ${res.completed.length}`,
  );
  console.log("\nby kind:");
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${k}`);
  }
  console.log("\ndetail:");
  for (const c of res.completed) {
    console.log(
      `  ${c.kind}/${c.milestone}${c.team ? `/${c.team}` : ""}  ${c.dealName}  (${c.reason})  [task ${c.taskId}]`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
