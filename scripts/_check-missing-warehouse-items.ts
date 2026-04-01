/**
 * Check which line items are missing warehouse_id on 3 flagged SOs.
 * Prints item name, quantity, and any available timestamps.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { ZohoInventoryClient } from "../src/lib/zoho-inventory";

const SO_IDS_BY_NUMBER: Record<string, string> = {};

async function main() {
  const zoho = new ZohoInventoryClient();

  // First find the SO IDs by paging through
  const targets = ["SO-9016", "SO-9084", "SO-8636"];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await zoho.listSalesOrders({
      page,
      perPage: 200,
      sortColumn: "created_time",
      sortOrder: "D",
    });

    for (const so of result.salesorders) {
      if (targets.includes(so.salesorder_number)) {
        SO_IDS_BY_NUMBER[so.salesorder_number] = so.salesorder_id;
      }
    }

    if (Object.keys(SO_IDS_BY_NUMBER).length === targets.length) break;
    hasMore = result.hasMore;
    page++;
  }

  for (const soNum of targets) {
    const soId = SO_IDS_BY_NUMBER[soNum];
    if (!soId) {
      console.log(`${soNum}: NOT FOUND\n`);
      continue;
    }

    const detail = await zoho.getSalesOrderById(soId);
    const lineItems = detail.line_items || [];
    const missing = lineItems.filter((li) => !li.warehouse_id);
    const withWarehouse = lineItems.filter((li) => li.warehouse_id);

    console.log(`\n${soNum} [${detail.status}] — ${lineItems.length} line items total`);
    console.log(`  Warehouse set on ${withWarehouse.length} items, missing on ${missing.length}`);

    if (withWarehouse.length > 0) {
      const wid = withWarehouse[0].warehouse_id;
      console.log(`  Warehouse ID used: ${wid}`);
    }

    for (const li of missing) {
      console.log(`  MISSING: "${li.name}" qty=${li.quantity} item_id=${li.item_id || "NONE"} line_item_id=${li.line_item_id || "NONE"}`);
      // Print all fields to see if there's any date/timestamp info
      console.log(`    All fields:`, JSON.stringify(li, null, 2));
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
