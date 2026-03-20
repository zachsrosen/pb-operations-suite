/**
 * Fix Zoho Sales Order reference numbers that contain the address.
 * Should be: "PROJ-#### | Name"
 * Was:       "PROJ-#### | Name | 1234 Street, City"
 *
 * Usage: npx tsx scripts/fix-so-reference-numbers.ts [--dry-run]
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { ZohoInventoryClient } from "../src/lib/zoho-inventory";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const zoho = new ZohoInventoryClient();

  let page = 1;
  let hasMore = true;
  const toFix: Array<{ id: string; soNumber: string; oldRef: string; newRef: string }> = [];

  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");
  console.log("Scanning Zoho Sales Orders...\n");

  while (hasMore) {
    const result = await zoho.listSalesOrders({
      page,
      perPage: 200,
      sortColumn: "created_time",
      sortOrder: "D",
    });

    for (const so of result.salesorders) {
      const ref = so.reference_number;
      if (!ref) continue;

      // Check if reference has 3+ pipe segments (has address)
      const segments = ref.split("|").map((s) => s.trim());
      if (segments.length <= 2) continue;

      // Only fix PROJ-#### prefixed references
      if (!segments[0].match(/^PROJ-\d+$/)) continue;

      const newRef = segments.slice(0, 2).join(" | ").trim().slice(0, 50);
      toFix.push({
        id: so.salesorder_id,
        soNumber: so.salesorder_number,
        oldRef: ref,
        newRef,
      });
    }

    hasMore = result.hasMore;
    page++;
  }

  console.log(`Found ${toFix.length} SOs to fix:\n`);

  for (const item of toFix) {
    console.log(`  ${item.soNumber}`);
    console.log(`    OLD: ${item.oldRef}`);
    console.log(`    NEW: ${item.newRef}`);

    if (!DRY_RUN) {
      try {
        await zoho.updateSalesOrder(item.id, { reference_number: item.newRef });
        console.log(`    ✓ Updated`);
      } catch (err) {
        console.error(`    ✗ Failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log(`\nDone. ${DRY_RUN ? "Re-run without --dry-run to apply." : `Updated ${toFix.length} SOs.`}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
