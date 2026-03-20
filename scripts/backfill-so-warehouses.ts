/**
 * Backfill Zoho Sales Order warehouse IDs based on HubSpot deal pb_location.
 *
 * For each SO with a PROJ-#### reference:
 *   1. Look up the deal in HubSpot to get pb_location
 *   2. Map location → Zoho warehouse ID
 *   3. Fetch SO detail, set warehouse_id on each line item, PUT back
 *
 * Usage: npx tsx scripts/backfill-so-warehouses.ts [--dry-run]
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { ZohoInventoryClient } from "../src/lib/zoho-inventory";

const DRY_RUN = process.argv.includes("--dry-run");

const ZOHO_WAREHOUSE_IDS: Record<string, string> = {
  Centennial: "5385454000000088162",
  DTC: "5385454000000088162",
  Westminster: "5385454000000114025",
  "Colorado Springs": "5385454000000114101",
  "San Luis Obispo": "5385454000000114177",
  Camarillo: "5385454000001367019",
};

const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!HS_TOKEN) throw new Error("HUBSPOT_ACCESS_TOKEN required");

/** Search HubSpot for a deal by PROJ-XXXX in dealname, return pb_location. */
async function getPbLocation(projNumber: string): Promise<string | null> {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: "dealname", operator: "CONTAINS_TOKEN", value: projNumber },
          ],
        },
      ],
      properties: ["dealname", "pb_location"],
      limit: 1,
    }),
  });

  if (!res.ok) {
    console.warn(`    HubSpot search failed (${res.status}) for ${projNumber}`);
    return null;
  }

  const data = (await res.json()) as {
    results?: Array<{ properties?: { pb_location?: string } }>;
  };
  return data.results?.[0]?.properties?.pb_location?.trim() || null;
}

async function main() {
  const zoho = new ZohoInventoryClient();

  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");
  console.log("Scanning Zoho Sales Orders...\n");

  // Collect all SOs with PROJ-#### references
  let page = 1;
  let hasMore = true;
  const allSos: Array<{
    id: string;
    soNumber: string;
    ref: string;
    projNumber: string;
    status: string;
    date: string;
  }> = [];

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

      // Skip closed/void SOs — only update draft/open/confirmed
      const status = (so.status || "").toLowerCase();
      if (status === "void" || status === "closed" || status === "fulfilled") continue;

      allSos.push({
        id: so.salesorder_id,
        soNumber: so.salesorder_number,
        ref,
        projNumber: projMatch[0],
        status: so.status || "unknown",
        date: so.date || "unknown",
      });
    }

    hasMore = result.hasMore;
    page++;
  }

  console.log(`Found ${allSos.length} SOs with PROJ references.\n`);

  let updated = 0;
  let skipped = 0;
  let alreadySet = 0;

  for (const so of allSos) {
    // Look up deal's pb_location
    const location = await getPbLocation(so.projNumber);
    const warehouseId = location ? ZOHO_WAREHOUSE_IDS[location] : undefined;

    if (!warehouseId) {
      console.log(`  ${so.soNumber} (${so.projNumber}) — no location found, skipping`);
      skipped++;
      continue;
    }

    // Fetch full SO to get line items
    let soDetail;
    try {
      soDetail = await zoho.getSalesOrderById(so.id);
    } catch (err) {
      console.error(`  ${so.soNumber} — failed to fetch detail:`, err instanceof Error ? err.message : err);
      skipped++;
      continue;
    }

    // Check if all line items already have this warehouse
    const lineItems = soDetail.line_items || [];
    const allAlreadySet = lineItems.every((li) => li.warehouse_id === warehouseId);
    if (allAlreadySet) {
      alreadySet++;
      continue;
    }

    // Build updated line items
    const updatedLineItems = lineItems.map((li) => ({
      line_item_id: li.line_item_id,
      item_id: li.item_id,
      name: li.name ?? "",
      quantity: li.quantity ?? 1,
      rate: li.rate,
      description: li.description,
      warehouse_id: warehouseId,
    }));

    console.log(`  ${so.soNumber} [${so.status}] ${so.date} (${so.projNumber}) → ${location}, ${lineItems.length} line items`);

    if (!DRY_RUN) {
      try {
        await zoho.updateSalesOrder(so.id, { line_items: updatedLineItems });
        console.log(`    ✓ Updated`);
        updated++;
      } catch (err) {
        console.error(`    ✗ Failed:`, err instanceof Error ? err.message : err);
        skipped++;
      }
    } else {
      updated++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Already set: ${alreadySet}, Skipped: ${skipped}`);
  if (DRY_RUN) console.log("Re-run without --dry-run to apply.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
