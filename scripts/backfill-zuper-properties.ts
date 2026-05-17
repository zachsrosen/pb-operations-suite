// scripts/backfill-zuper-properties.ts
//
// One-time backfill: pushes all HubSpotPropertyCache rows to Zuper Property module.
// Re-runnable and idempotent — skips properties that already have a zuperPropertyUid.
//
// Usage:
//   ZUPER_PROPERTY_SYNC_ENABLED=true tsx scripts/backfill-zuper-properties.ts
//   ZUPER_PROPERTY_SYNC_ENABLED=true tsx scripts/backfill-zuper-properties.ts --dry-run
//   ZUPER_PROPERTY_SYNC_ENABLED=true tsx scripts/backfill-zuper-properties.ts --limit=50
//   ZUPER_PROPERTY_SYNC_ENABLED=true tsx scripts/backfill-zuper-properties.ts --limit=5 --dry-run
//
// Exit codes:
//   0 — success
//   1 — ZUPER_PROPERTY_SYNC_ENABLED is not "true"
//   2 — unhandled error (see stderr)

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { syncPropertyToZuper, findDirtyProperties } from "../src/lib/zuper-property-sync";

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.ZUPER_PROPERTY_SYNC_ENABLED !== "true") {
    console.error("❌ ZUPER_PROPERTY_SYNC_ENABLED must be 'true'. Exiting.");
    process.exit(1);
  }

  console.log(`\n🏠 Zuper Property Backfill`);
  console.log(`   Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`   Limit: ${LIMIT === Infinity ? "none" : LIMIT}`);
  console.log("");

  // Find all properties that need syncing (no zuperPropertyUid yet)
  const batchSize = Math.min(LIMIT === Infinity ? 500 : LIMIT, 500);
  const dirtyProperties = await findDirtyProperties(batchSize);

  if (dirtyProperties.length === 0) {
    console.log("✅ No dirty properties found. Nothing to sync.");
    return;
  }

  console.log(`   Found ${dirtyProperties.length} properties to sync.\n`);

  const results = { created: 0, updated: 0, errors: 0, jobsLinked: 0, skipped: 0 };
  let processed = 0;

  for (const { id } of dirtyProperties) {
    if (processed >= LIMIT) break;

    if (DRY_RUN) {
      const prop = await prisma.hubSpotPropertyCache.findUnique({
        where: { id },
        select: { street: true, city: true, state: true, zuperPropertyUid: true },
      });
      const action = prop?.zuperPropertyUid ? "UPDATE" : "CREATE";
      console.log(
        `   [DRY] Would ${action}: ${prop?.street || "?"}, ${prop?.city || "?"} ${prop?.state || ""}`
      );
      results.skipped++;
      processed++;
      continue;
    }

    try {
      const result = await syncPropertyToZuper(id);
      if (result.action === "created") results.created++;
      else if (result.action === "updated") results.updated++;
      results.jobsLinked += result.jobsLinked;
      processed++;

      const pct = ((processed / dirtyProperties.length) * 100).toFixed(0);
      console.log(
        `   [${pct}%] ${result.action.toUpperCase()} property ${result.zuperPropertyUid} (${result.jobsLinked} jobs linked)`
      );

      // Small delay between API calls to respect rate limits
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      results.errors++;
      processed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ❌ Error syncing property ${id}: ${msg}`);

      // Increment fail count
      await prisma.hubSpotPropertyCache
        .update({
          where: { id },
          data: { zuperSyncFailCount: { increment: 1 } },
        })
        .catch(() => {});
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Created:   ${results.created}`);
  console.log(`   Updated:   ${results.updated}`);
  console.log(`   Jobs linked: ${results.jobsLinked}`);
  console.log(`   Errors:    ${results.errors}`);
  if (DRY_RUN) console.log(`   Skipped (dry run): ${results.skipped}`);
  console.log("");
}

main()
  .then(() => {
    console.log("✅ Backfill complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Unhandled error:", err);
    process.exit(2);
  })
  .finally(() => {
    prisma.$disconnect();
  });
