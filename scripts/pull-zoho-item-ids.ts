/**
 * Pull Zoho item IDs for all 344 unique items used in 2026 SOs.
 * Cross-reference against InternalProduct.zohoItemId.
 * Output: scripts/2026-so-items-with-ids.json
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync, writeFileSync } from "fs";

async function main() {
  // Lazy-load after dotenv
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // 1. Load 2026 SO data
  const soData = JSON.parse(readFileSync("scripts/2026-so-review.json", "utf-8"));

  // Build unique items from SOs (name + sku as composite key)
  const uniqueItems = new Map<string, { name: string; sku: string; soCount: number; totalQty: number }>();
  for (const so of soData.salesOrders) {
    for (const item of so.items) {
      const key = `${item.name}|||${item.sku}`;
      if (!uniqueItems.has(key)) {
        uniqueItems.set(key, { name: item.name, sku: item.sku, soCount: 0, totalQty: 0 });
      }
      const entry = uniqueItems.get(key)!;
      entry.soCount++;
      entry.totalQty += item.qty;
    }
  }
  console.log(`Unique SO items (name+sku): ${uniqueItems.size}\n`);

  // 2. Fetch ALL Zoho items
  console.log("Fetching all Zoho inventory items...");
  const allZohoItems = await zohoInventory.listItems();
  console.log(`Loaded ${allZohoItems.length} Zoho items\n`);

  // Build lookup indexes
  const zohoByName = new Map<string, typeof allZohoItems[0]>();
  const zohoBySku = new Map<string, typeof allZohoItems[0]>();
  const zohoByNameLower = new Map<string, typeof allZohoItems[0]>();

  for (const zi of allZohoItems) {
    zohoByName.set(zi.name, zi);
    zohoByNameLower.set(zi.name.toLowerCase().trim(), zi);
    if (zi.sku) zohoBySku.set(zi.sku, zi);
  }

  // 3. Fetch all InternalProducts
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
  });

  // Build lookup: zohoItemId → IP
  const ipByZohoId = new Map<string, typeof allIPs[0]>();
  for (const ip of allIPs) {
    if (ip.zohoItemId) ipByZohoId.set(ip.zohoItemId, ip);
  }

  // 4. Match each SO item to a Zoho item_id
  console.log("Matching SO items to Zoho item_ids...\n");

  type ResultItem = {
    soName: string;
    soSku: string;
    soCount: number;
    totalQty: number;
    zohoItemId: string | null;
    zohoName: string | null;
    zohoSku: string | null;
    matchMethod: string | null;
    ipId: string | null;
    ipCategory: string | null;
    ipBrand: string | null;
    ipModel: string | null;
    hasZuper: boolean;
    hasHubspot: boolean;
  };

  const results: ResultItem[] = [];
  let matched = 0;
  let unmatched = 0;
  let hasIP = 0;
  let noIP = 0;

  for (const [, item] of uniqueItems) {
    let zohoItem: typeof allZohoItems[0] | undefined;
    let matchMethod: string | null = null;

    // Try exact name match
    zohoItem = zohoByName.get(item.name);
    if (zohoItem) {
      matchMethod = "exact_name";
    }

    // Try exact SKU match
    if (!zohoItem && item.sku) {
      zohoItem = zohoBySku.get(item.sku);
      if (zohoItem) matchMethod = "exact_sku";
    }

    // Try case-insensitive name
    if (!zohoItem) {
      zohoItem = zohoByNameLower.get(item.name.toLowerCase().trim());
      if (zohoItem) matchMethod = "name_lower";
    }

    // Try SKU as name
    if (!zohoItem && item.sku && item.sku !== item.name) {
      zohoItem = zohoByName.get(item.sku);
      if (zohoItem) matchMethod = "sku_as_name";
    }

    // Check if this Zoho item has an InternalProduct
    let ip: typeof allIPs[0] | undefined;
    if (zohoItem) {
      ip = ipByZohoId.get(zohoItem.item_id);
    }

    if (zohoItem) matched++;
    else unmatched++;
    if (ip) hasIP++;
    else noIP++;

    results.push({
      soName: item.name,
      soSku: item.sku,
      soCount: item.soCount,
      totalQty: item.totalQty,
      zohoItemId: zohoItem?.item_id || null,
      zohoName: zohoItem?.name || null,
      zohoSku: zohoItem?.sku || null,
      matchMethod,
      ipId: ip?.id || null,
      ipCategory: ip?.category || null,
      ipBrand: ip?.brand || null,
      ipModel: ip?.model || null,
      hasZuper: !!ip?.zuperItemId,
      hasHubspot: !!ip?.hubspotProductId,
    });
  }

  // Sort: unmatched first, then by soCount desc
  results.sort((a, b) => {
    if (a.zohoItemId && !b.zohoItemId) return 1;
    if (!a.zohoItemId && b.zohoItemId) return -1;
    return b.soCount - a.soCount;
  });

  // 5. Summary
  console.log("=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));
  console.log(`Total unique SO items:       ${uniqueItems.size}`);
  console.log(`Matched to Zoho item_id:     ${matched}`);
  console.log(`  → Has InternalProduct:     ${hasIP}`);
  console.log(`    → Has Zuper link:        ${results.filter(r => r.hasZuper).length}`);
  console.log(`    → Has HubSpot link:      ${results.filter(r => r.hasHubspot).length}`);
  console.log(`  → No InternalProduct:      ${matched - hasIP}`);
  console.log(`No Zoho item_id found:       ${unmatched}`);

  // Show unmatched
  const unmatchedItems = results.filter(r => !r.zohoItemId);
  if (unmatchedItems.length > 0) {
    console.log(`\n--- Items with NO Zoho item_id (${unmatchedItems.length}) ---`);
    for (const r of unmatchedItems) {
      console.log(`  "${r.soName}" (SKU: ${r.soSku}) — used ${r.soCount}x`);
    }
  }

  // Show matched but no IP
  const matchedNoIP = results.filter(r => r.zohoItemId && !r.ipId);
  console.log(`\n--- Zoho item found but NO InternalProduct (${matchedNoIP.length}) ---`);
  for (const r of matchedNoIP.slice(0, 30)) {
    console.log(`  "${r.soName}" → Zoho: ${r.zohoItemId} (used ${r.soCount}x)`);
  }
  if (matchedNoIP.length > 30) console.log(`  ... and ${matchedNoIP.length - 30} more`);

  // Show matched with IP but no Zuper
  const hasIPNoZuper = results.filter(r => r.ipId && !r.hasZuper);
  console.log(`\n--- Has InternalProduct but NO Zuper link (${hasIPNoZuper.length}) ---`);
  for (const r of hasIPNoZuper) {
    console.log(`  [${r.ipCategory}] ${r.ipBrand} ${r.ipModel} → Zoho: ${r.zohoItemId}`);
  }

  // Save full results
  const output = {
    generated: new Date().toISOString(),
    summary: {
      totalUniqueItems: uniqueItems.size,
      matchedToZoho: matched,
      hasInternalProduct: hasIP,
      hasZuper: results.filter(r => r.hasZuper).length,
      hasHubspot: results.filter(r => r.hasHubspot).length,
      noInternalProduct: matched - hasIP,
      noZohoMatch: unmatched,
    },
    items: results,
  };

  writeFileSync("scripts/2026-so-items-with-ids.json", JSON.stringify(output, null, 2));
  console.log(`\nSaved to scripts/2026-so-items-with-ids.json`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
