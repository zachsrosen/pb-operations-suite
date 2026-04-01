/**
 * Check how many of the 79 orphaned Zuper products (have HS ID but no InternalProduct)
 * overlap with the 344 Zoho SO items used in 2026.
 *
 * Strategy: For each orphaned Zuper product, try to match its name against the SO item names.
 * Also: pull the full list of what we need to reconcile.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync } from "fs";

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // 1. Load 2026 SO items
  const soData = JSON.parse(readFileSync("scripts/2026-so-review.json", "utf-8"));
  const soItemMap = new Map<string, { name: string; sku: string; times_used: number }>();
  // Build unique item list from the itemsSummary if available, or from SOs
  // Actually, let's just build from the SOs
  const itemsByName = new Map<string, { name: string; sku: string; count: number }>();
  for (const so of soData.salesOrders) {
    for (const item of so.items) {
      const key = item.name.toLowerCase().trim();
      if (!itemsByName.has(key)) {
        itemsByName.set(key, { name: item.name, sku: item.sku, count: 0 });
      }
      itemsByName.get(key)!.count++;
    }
  }

  // 2. Fetch all Zuper products
  console.log("Fetching all Zuper products...");
  let allZuperProducts: Array<Record<string, unknown>> = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as Record<string, unknown>;
    const batch = (d.data || []) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;
    allZuperProducts.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  console.log(`Loaded ${allZuperProducts.length} Zuper products\n`);

  // 3. Get all InternalProducts
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      hubspotProductId: true, zohoItemId: true, zuperItemId: true,
    },
  });

  // Build set of Zuper UIDs that are already linked to an IP
  const linkedZuperUids = new Set(allIPs.filter(p => p.zuperItemId).map(p => p.zuperItemId!));
  // Build set of HS IDs that are linked to an IP
  const linkedHsIds = new Set(allIPs.filter(p => p.hubspotProductId).map(p => p.hubspotProductId!));

  // 4. Find orphaned Zuper products (have HS ID but no IP links to them)
  const orphaned: Array<{ zuperUid: string; zuperName: string; hsId: string }> = [];

  for (const zp of allZuperProducts) {
    const uid = String(zp.product_uid);
    if (linkedZuperUids.has(uid)) continue; // already linked

    // Extract HS ID
    let hsId: string | null = null;
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const entry of meta) {
        if (entry.label === "HubSpot Product ID" && entry.value) {
          hsId = String(entry.value);
        }
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (!hsId && cfio?.product_hubspot_product_id_1) {
      hsId = String(cfio.product_hubspot_product_id_1);
    }

    if (hsId) {
      orphaned.push({ zuperUid: uid, zuperName: String(zp.product_name), hsId });
    }
  }

  // Also find Zuper products with NO HS ID and not linked
  const unlinkedNoHs: Array<{ zuperUid: string; zuperName: string }> = [];
  for (const zp of allZuperProducts) {
    const uid = String(zp.product_uid);
    if (linkedZuperUids.has(uid)) continue;

    let hasHsId = false;
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const entry of meta) {
        if (entry.label === "HubSpot Product ID" && entry.value) hasHsId = true;
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (cfio?.product_hubspot_product_id_1) hasHsId = true;

    if (!hasHsId) {
      unlinkedNoHs.push({ zuperUid: uid, zuperName: String(zp.product_name) });
    }
  }

  console.log(`Orphaned Zuper products (HS ID, no IP): ${orphaned.length}`);
  console.log(`Unlinked Zuper products (no HS ID, no IP): ${unlinkedNoHs.length}`);
  console.log(`Total linked Zuper → IP: ${linkedZuperUids.size}\n`);

  // 5. Try to match orphaned Zuper names to 2026 SO item names
  console.log("=".repeat(70));
  console.log("Matching orphaned Zuper products to 2026 SO items by name...");
  console.log("=".repeat(70));

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  let matchCount = 0;
  let noMatchCount = 0;
  const matched: Array<{ zuperName: string; soName: string; zuperUid: string; hsId: string }> = [];

  for (const o of orphaned) {
    const normZuper = normalize(o.zuperName);
    let bestMatch: string | null = null;

    for (const [, item] of itemsByName) {
      const normSo = normalize(item.name);
      // Try exact normalized match
      if (normZuper === normSo) {
        bestMatch = item.name;
        break;
      }
      // Try substring containment
      if (normZuper.length > 5 && normSo.includes(normZuper)) {
        bestMatch = item.name;
        break;
      }
      if (normSo.length > 5 && normZuper.includes(normSo)) {
        bestMatch = item.name;
        break;
      }
    }

    if (bestMatch) {
      matchCount++;
      matched.push({ zuperName: o.zuperName, soName: bestMatch, zuperUid: o.zuperUid, hsId: o.hsId });
      console.log(`  ✓ "${o.zuperName}" → SO: "${bestMatch}"`);
    } else {
      noMatchCount++;
      console.log(`  ✗ "${o.zuperName}" — no SO match`);
    }
  }

  // 6. Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log("FULL RECONCILIATION SUMMARY");
  console.log("=".repeat(70));
  console.log(`\nZuper products total: ${allZuperProducts.length}`);
  console.log(`  Already linked to IP: ${linkedZuperUids.size}`);
  console.log(`  Orphaned (HS ID, no IP): ${orphaned.length}`);
  console.log(`    → Match a 2026 SO item: ${matchCount}`);
  console.log(`    → No SO match: ${noMatchCount}`);
  console.log(`  No HS ID, no IP: ${unlinkedNoHs.length}`);
  console.log(`\nInternalProducts total: ${allIPs.length}`);
  console.log(`  With Zuper link: ${allIPs.filter(p => p.zuperItemId).length}`);
  console.log(`  With Zoho link: ${allIPs.filter(p => p.zohoItemId).length}`);
  console.log(`  With HS link: ${allIPs.filter(p => p.hubspotProductId).length}`);
  console.log(`\n2026 SO unique items: ${itemsByName.size}`);

  // 7. Show unlinked Zuper products with no HS ID
  if (unlinkedNoHs.length > 0) {
    console.log(`\n--- Zuper products with NO HS ID and NO IP link (${unlinkedNoHs.length}) ---`);
    for (const u of unlinkedNoHs) {
      console.log(`  ${u.zuperName} (${u.zuperUid})`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
