/**
 * Verify all non-closed Zoho SOs for outliers:
 *   1. Reference numbers still containing address text
 *   2. Missing warehouse_id on line items
 *
 * Usage: npx tsx scripts/_verify-so-outliers.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { ZohoInventoryClient } from "../src/lib/zoho-inventory";

async function main() {
  const zoho = new ZohoInventoryClient();

  let page = 1;
  let hasMore = true;
  const issues: Array<{
    soNumber: string;
    ref: string;
    status: string;
    issue: string;
  }> = [];
  let totalChecked = 0;

  while (hasMore) {
    const result = await zoho.listSalesOrders({
      page,
      perPage: 200,
      sortColumn: "created_time",
      sortOrder: "D",
    });

    for (const so of result.salesorders) {
      const ref = so.reference_number || "";
      const projMatch = ref.match(/PROJ-\d+/);
      if (!projMatch) continue;

      const status = (so.status || "").toLowerCase();
      if (status === "void" || status === "closed" || status === "fulfilled") continue;

      totalChecked++;

      // Check 1: Reference number contains address text
      // Expected: "PROJ-#### | Name" — if there's a 3rd pipe-delimited segment or
      // digits that look like an address (street number + street name), flag it
      const parts = ref.split("|").map((s) => s.trim());
      if (parts.length > 2) {
        issues.push({
          soNumber: so.salesorder_number,
          ref,
          status: so.status || "unknown",
          issue: `Reference has ${parts.length} segments (address still present)`,
        });
        continue; // don't double-count
      }

      // Also check for address-like patterns even without a pipe:
      // e.g., "PROJ-9016 | Aung, Tin | 6276 Wild Turkey Dr"
      const afterProj = ref.replace(/PROJ-\d+/, "").trim();
      if (/\d{3,5}\s+\w+\s+(St|Dr|Ave|Blvd|Rd|Ct|Ln|Way|Pl|Cir|Loop|Pkwy|Trl)/i.test(afterProj)) {
        issues.push({
          soNumber: so.salesorder_number,
          ref,
          status: so.status || "unknown",
          issue: "Reference appears to contain street address",
        });
        continue;
      }

      // Check 2: Fetch detail to check warehouse on line items
      try {
        const detail = await zoho.getSalesOrderById(so.salesorder_id);
        const lineItems = detail.line_items || [];
        const missingWarehouse = lineItems.filter((li) => !li.warehouse_id);
        if (missingWarehouse.length > 0) {
          issues.push({
            soNumber: so.salesorder_number,
            ref,
            status: so.status || "unknown",
            issue: `${missingWarehouse.length}/${lineItems.length} line items missing warehouse_id`,
          });
        }
      } catch (err) {
        issues.push({
          soNumber: so.salesorder_number,
          ref,
          status: so.status || "unknown",
          issue: `Failed to fetch detail: ${err instanceof Error ? err.message : err}`,
        });
      }
    }

    hasMore = result.hasMore;
    page++;
  }

  console.log(`\nChecked ${totalChecked} non-closed SOs with PROJ references.\n`);

  if (issues.length === 0) {
    console.log("✓ No outliers found — all SOs have clean references and warehouse assignments.");
  } else {
    console.log(`Found ${issues.length} outlier(s):\n`);
    for (const i of issues) {
      console.log(`  ${i.soNumber} [${i.status}] ref="${i.ref}"`);
      console.log(`    → ${i.issue}\n`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
