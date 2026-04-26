/**
 * Comprehensive catalog sync integrity audit.
 *
 * Checks across InternalProduct ↔ HubSpot Product ↔ Zoho Item ↔ Zuper Product:
 *
 * A. linkage gaps — rows missing one or more external IDs
 * B. broken external IDs — internal points to an external record that doesn't exist
 * C. cross-link mismatches — internal row says zohoItemId=X but linked external
 *    record's stored ID points to a different value
 * D. external orphans — external records with no internal_product_id pointing back
 * E. property-coverage gaps — common HubSpot/Zuper/Zoho properties that aren't
 *    being populated by the sync
 *
 * Read-only. Output: scripts/catalog-integrity-audit.json
 *
 * Run: node --env-file=.env.local --import tsx scripts/_audit-catalog-integrity.ts
 */
import { prisma } from "../src/lib/db";
import { zohoInventory } from "../src/lib/zoho-inventory";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const ZUPER_API_KEY = process.env.ZUPER_API_KEY;
const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";

const SAMPLE_SIZE = Number(process.env.AUDIT_SAMPLE_SIZE || 50); // limit cross-link round-trip checks

interface InternalRow {
  id: string;
  brand: string;
  model: string;
  category: string;
  isActive: boolean;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  zohoItemId: string | null;
}

async function main() {
  if (!prisma) { console.error("prisma not configured"); process.exit(1); }

  console.log("─".repeat(70));
  console.log("CATALOG SYNC INTEGRITY AUDIT");
  console.log("─".repeat(70));

  // === A. Linkage gaps ===
  console.log("\nA. Linkage gaps in InternalProduct...");
  const allActive: InternalRow[] = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { id: true, brand: true, model: true, category: true, isActive: true,
      hubspotProductId: true, zuperItemId: true, zohoItemId: true },
  });
  const total = allActive.length;
  const missingHs = allActive.filter((r) => !r.hubspotProductId);
  const missingZuper = allActive.filter((r) => !r.zuperItemId);
  const missingZoho = allActive.filter((r) => !r.zohoItemId);
  const fullyLinked = allActive.filter((r) => r.hubspotProductId && r.zuperItemId && r.zohoItemId);
  const noneLinked = allActive.filter((r) => !r.hubspotProductId && !r.zuperItemId && !r.zohoItemId);

  console.log(`  Total active InternalProducts: ${total}`);
  console.log(`  ✓ fully linked (all 3):      ${fullyLinked.length}  (${Math.round(fullyLinked.length / total * 100)}%)`);
  console.log(`  ✗ missing HubSpot id:        ${missingHs.length}`);
  console.log(`  ✗ missing Zuper id:          ${missingZuper.length}`);
  console.log(`  ✗ missing Zoho id:           ${missingZoho.length}`);
  console.log(`  ✗ no external links at all:  ${noneLinked.length}`);

  // Linkage gaps by category
  console.log("\n  Linkage gaps by category (≥1 system unlinked):");
  const byCat = new Map<string, { total: number; gappy: number }>();
  for (const r of allActive) {
    const e = byCat.get(r.category) ?? { total: 0, gappy: 0 };
    e.total++;
    if (!r.hubspotProductId || !r.zuperItemId || !r.zohoItemId) e.gappy++;
    byCat.set(r.category, e);
  }
  const catRows = [...byCat.entries()].sort((a, b) => b[1].gappy - a[1].gappy);
  for (const [cat, c] of catRows) {
    if (c.gappy === 0) continue;
    console.log(`    ${cat.padEnd(28)} ${String(c.gappy).padStart(4)} / ${c.total} gappy (${Math.round(c.gappy / c.total * 100)}%)`);
  }

  // === B. Broken external IDs (sampled) ===
  console.log(`\nB. Broken external IDs (sampling first ${SAMPLE_SIZE} of each link type)...`);
  const brokenHs: Array<{ id: string; ext: string }> = [];
  const brokenZoho: Array<{ id: string; ext: string }> = [];
  const brokenZuper: Array<{ id: string; ext: string }> = [];

  // HubSpot — check a sample
  const hsSample = allActive.filter((r) => r.hubspotProductId).slice(0, SAMPLE_SIZE);
  process.stdout.write(`  HubSpot ${hsSample.length} sample`);
  for (const r of hsSample) {
    if (!HUBSPOT_TOKEN) break;
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${r.hubspotProductId}?properties=name`, {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    });
    if (res.status === 404) brokenHs.push({ id: r.id, ext: r.hubspotProductId! });
    process.stdout.write(".");
  }
  console.log(`  ${brokenHs.length} broken`);

  // Zoho — check a sample
  const zohoSample = allActive.filter((r) => r.zohoItemId).slice(0, SAMPLE_SIZE);
  process.stdout.write(`  Zoho    ${zohoSample.length} sample`);
  for (const r of zohoSample) {
    const item = await zohoInventory.getItemById(r.zohoItemId!);
    if (!item) brokenZoho.push({ id: r.id, ext: r.zohoItemId! });
    process.stdout.write(".");
  }
  console.log(`  ${brokenZoho.length} broken`);

  // Zuper — check a sample
  const zuperSample = allActive.filter((r) => r.zuperItemId).slice(0, SAMPLE_SIZE);
  process.stdout.write(`  Zuper   ${zuperSample.length} sample`);
  for (const r of zuperSample) {
    if (!ZUPER_API_KEY) break;
    const res = await fetch(`${ZUPER_API_URL}/product/${r.zuperItemId}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    if (res.status === 404) brokenZuper.push({ id: r.id, ext: r.zuperItemId! });
    process.stdout.write(".");
  }
  console.log(`  ${brokenZuper.length} broken`);

  // === C. Cross-link mismatches (sampled) ===
  console.log(`\nC. Cross-link mismatches (sampling first ${SAMPLE_SIZE} fully-linked rows)...`);
  const xlinkSample = fullyLinked.slice(0, SAMPLE_SIZE);
  const mismatches: Array<{ id: string; system: string; field: string; expected: string; actual: string | null }> = [];
  process.stdout.write(`  ${xlinkSample.length} rows`);
  for (const r of xlinkSample) {
    if (HUBSPOT_TOKEN) {
      const res = await fetch(
        `https://api.hubapi.com/crm/v3/objects/products/${r.hubspotProductId}?properties=internal_product_id,zoho_item_id,zuper_item_id`,
        { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } },
      );
      if (res.ok) {
        const d = await res.json();
        const p = d.properties || {};
        if ((p.internal_product_id || "") !== r.id) mismatches.push({ id: r.id, system: "hubspot", field: "internal_product_id", expected: r.id, actual: p.internal_product_id || null });
        if ((p.zoho_item_id || "") !== r.zohoItemId) mismatches.push({ id: r.id, system: "hubspot", field: "zoho_item_id", expected: r.zohoItemId!, actual: p.zoho_item_id || null });
        if ((p.zuper_item_id || "") !== r.zuperItemId) mismatches.push({ id: r.id, system: "hubspot", field: "zuper_item_id", expected: r.zuperItemId!, actual: p.zuper_item_id || null });
      }
    }
    const zItem = await zohoInventory.getItemById(r.zohoItemId!);
    if (zItem) {
      const customFields = ((zItem as Record<string, unknown>).custom_fields as Array<{ api_name?: string; value?: unknown }> | undefined) || [];
      const cfMap: Record<string, string | undefined> = {};
      for (const cf of customFields) {
        if (cf.api_name) cfMap[cf.api_name] = cf.value != null ? String(cf.value) : undefined;
      }
      if ((cfMap.cf_internal_product_id || "") !== r.id) mismatches.push({ id: r.id, system: "zoho", field: "cf_internal_product_id", expected: r.id, actual: cfMap.cf_internal_product_id || null });
      if ((cfMap.cf_hubspot_product_id || "") !== r.hubspotProductId) mismatches.push({ id: r.id, system: "zoho", field: "cf_hubspot_product_id", expected: r.hubspotProductId!, actual: cfMap.cf_hubspot_product_id || null });
      if ((cfMap.cf_zuper_product_id || "") !== r.zuperItemId) mismatches.push({ id: r.id, system: "zoho", field: "cf_zuper_product_id", expected: r.zuperItemId!, actual: cfMap.cf_zuper_product_id || null });
    }
    process.stdout.write(".");
  }
  console.log(`  ${mismatches.length} mismatches`);
  // Group by (system, field)
  const mmByCat = new Map<string, number>();
  for (const m of mismatches) {
    const k = `${m.system}.${m.field}`;
    mmByCat.set(k, (mmByCat.get(k) || 0) + 1);
  }
  for (const [k, n] of [...mmByCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(36)} ${n} mismatches`);
  }

  // === D. External orphans (HubSpot — sampled) ===
  console.log(`\nD. External orphans — HubSpot Products with no internal_product_id...`);
  if (HUBSPOT_TOKEN) {
    const orphans: Array<{ id: string; name: string }> = [];
    let after: string | undefined;
    let scanned = 0;
    const maxScan = 500;
    while (scanned < maxScan) {
      const params = new URLSearchParams({ limit: "100", properties: "name,internal_product_id" });
      if (after) params.set("after", after);
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/products?${params}`, {
        headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
      });
      if (!res.ok) break;
      const d = await res.json();
      for (const p of d.results || []) {
        scanned++;
        if (!p.properties?.internal_product_id) {
          orphans.push({ id: p.id, name: p.properties?.name || "(no name)" });
        }
      }
      after = d.paging?.next?.after;
      if (!after) break;
    }
    console.log(`  Scanned ${scanned} HubSpot Products. Orphans (no internal_product_id): ${orphans.length}`);
    if (orphans.length > 0) {
      console.log(`  First 10:`);
      for (const o of orphans.slice(0, 10)) console.log(`    ${o.id}  ${o.name}`);
    }
  }

  // === E. Zoho orphans (no cf_internal_product_id) ===
  console.log(`\nE. External orphans — Zoho items with no cf_internal_product_id...`);
  const zohoItems = await zohoInventory.listItems();
  const activeZoho = zohoItems.filter((i: { status?: string; item_id?: string }) => !i.status || i.status === "active");
  // Need to fetch detail to see custom_fields — sample
  const orphanSampleSize = Math.min(100, activeZoho.length);
  const orphanZoho: Array<{ id: string; name: string }> = [];
  process.stdout.write(`  Sampling ${orphanSampleSize} Zoho items`);
  for (let i = 0; i < orphanSampleSize; i++) {
    const item = activeZoho[i];
    if (!item.item_id) continue;
    const detail = await zohoInventory.getItemById(item.item_id);
    const customFields = ((detail as Record<string, unknown> | null)?.custom_fields as Array<{ api_name?: string; value?: unknown }> | undefined) || [];
    const hasInternal = customFields.some((cf) => cf.api_name === "cf_internal_product_id" && cf.value);
    if (!hasInternal) orphanZoho.push({ id: item.item_id, name: (item as { name?: string }).name || "(no name)" });
    if (i % 20 === 0) process.stdout.write(".");
  }
  console.log(`  ${orphanZoho.length} of ${orphanSampleSize} sampled Zoho items lack cf_internal_product_id (${Math.round(orphanZoho.length / orphanSampleSize * 100)}%)`);

  // === F. Field coverage on a sample ===
  console.log(`\nF. Sync field-coverage on linked products (sampling 30)...`);
  const coverageSample = fullyLinked.slice(0, 30);
  const hsPropCounts = new Map<string, number>();
  let hsCovered = 0;
  for (const r of coverageSample) {
    if (!HUBSPOT_TOKEN) break;
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/products/${r.hubspotProductId}?properties=name,manufacturer,price,hs_cost_of_goods_sold,description,vendor_name,vendor_part_number,unit_label,product_category,internal_product_id`,
      { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } },
    );
    if (!res.ok) continue;
    hsCovered++;
    const d = await res.json();
    const p = d.properties || {};
    for (const k of ["name", "manufacturer", "price", "hs_cost_of_goods_sold", "description", "vendor_name", "vendor_part_number", "unit_label", "product_category", "internal_product_id"]) {
      const v = p[k];
      if (v && String(v).trim()) hsPropCounts.set(k, (hsPropCounts.get(k) || 0) + 1);
    }
  }
  console.log(`  HubSpot universal property fill rate (of ${hsCovered} sampled):`);
  for (const k of ["name", "manufacturer", "description", "price", "hs_cost_of_goods_sold", "vendor_name", "vendor_part_number", "unit_label", "product_category", "internal_product_id"]) {
    const n = hsPropCounts.get(k) || 0;
    const pct = hsCovered > 0 ? Math.round(n / hsCovered * 100) : 0;
    const bar = "▰".repeat(Math.round(pct / 5)) + "▱".repeat(20 - Math.round(pct / 5));
    console.log(`    ${k.padEnd(28)} ${bar} ${n}/${hsCovered}  (${pct}%)`);
  }

  // Persist
  const fs = await import("fs");
  fs.writeFileSync("scripts/catalog-integrity-audit.json", JSON.stringify({
    audited_at: new Date().toISOString(),
    summary: {
      total_active_internal_products: total,
      fully_linked: fullyLinked.length,
      missing_hubspot: missingHs.length,
      missing_zuper: missingZuper.length,
      missing_zoho: missingZoho.length,
      no_external_links: noneLinked.length,
    },
    linkage_gaps_by_category: Object.fromEntries(byCat),
    broken_external_ids: { hubspot: brokenHs, zoho: brokenZoho, zuper: brokenZuper },
    cross_link_mismatches: mismatches,
    cross_link_mismatch_summary: Object.fromEntries(mmByCat),
    sample_unlinked_internal: noneLinked.slice(0, 20).map((r) => ({ id: r.id, brand: r.brand, model: r.model, category: r.category })),
  }, null, 2));
  console.log("\nWrote scripts/catalog-integrity-audit.json");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
