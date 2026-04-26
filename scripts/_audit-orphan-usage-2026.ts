/**
 * For each orphan (HubSpot Product without internal_product_id; Zoho item
 * without cf_internal_product_id), check whether it's been used in 2026 —
 * indicates "live" data vs dormant.
 *
 * Signals:
 *   HubSpot — hs_lastmodifieddate >= 2026-01-01 OR appears on a 2026 Line Item
 *   Zoho    — last_modified_time >= 2026-01-01 OR appears on a 2026 Sales Order
 *
 * Read-only. Output: scripts/orphan-usage-2026.json
 *
 * Run: node --env-file=.env.local --import tsx scripts/_audit-orphan-usage-2026.ts
 */
import { zohoInventory } from "../src/lib/zoho-inventory";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const ORG_ID = process.env.ZOHO_INVENTORY_ORG_ID;

const YEAR_START = "2026-01-01T00:00:00Z";
const YEAR_START_MS = new Date(YEAR_START).getTime();

interface HsProduct {
  id: string;
  properties: Record<string, string>;
}

async function listAllHubSpotProducts(): Promise<HsProduct[]> {
  if (!HUBSPOT_TOKEN) return [];
  const all: HsProduct[] = [];
  let after: string | undefined;
  while (true) {
    const params = new URLSearchParams({
      limit: "100",
      properties: "name,hs_sku,internal_product_id,hs_lastmodifieddate,hs_createdate,manufacturer,price,product_category",
    });
    if (after) params.set("after", after);
    const r = await fetch(`https://api.hubapi.com/crm/v3/objects/products?${params}`, {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    });
    if (!r.ok) break;
    const d = await r.json();
    for (const p of d.results || []) all.push(p);
    after = d.paging?.next?.after;
    if (!after) break;
  }
  return all;
}

interface LineItemHit { dealId?: string; lineItemId: string; createdAt?: string }

async function checkHubSpotProductUsedInLineItems(productId: string): Promise<{ count: number; sample: LineItemHit[] }> {
  if (!HUBSPOT_TOKEN) return { count: 0, sample: [] };
  // Use search API to find line items that reference this product
  const body = {
    filterGroups: [{ filters: [
      { propertyName: "hs_product_id", operator: "EQ", value: productId },
      { propertyName: "createdate", operator: "GTE", value: String(YEAR_START_MS) },
    ] }],
    limit: 5,
    properties: ["createdate", "hs_product_id"],
  };
  const r = await fetch(`https://api.hubapi.com/crm/v3/objects/line_items/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { count: 0, sample: [] };
  const d = await r.json();
  const sample: LineItemHit[] = (d.results || []).map((li: { id: string; properties?: { createdate?: string } }) => ({
    lineItemId: li.id, createdAt: li.properties?.createdate,
  }));
  return { count: d.total || 0, sample };
}

async function listZohoSalesOrders2026(): Promise<{ orderCount: number; itemIds: Set<string>; itemNameToOrderCount: Map<string, number> }> {
  // Fetch all sales orders modified or created in 2026, walk their line items
  const itemIds = new Set<string>();
  const itemNameToOrderCount = new Map<string, number>();
  let page = 1;
  let orderCount = 0;
  const perPage = 200;
  while (true) {
    const params = new URLSearchParams({
      organization_id: ORG_ID!,
      page: String(page),
      per_page: String(perPage),
      date_start: "2026-01-01",
      date_end: "2026-12-31",
    });
    const r = await fetch(`https://www.zohoapis.com/inventory/v1/salesorders?${params}`, {
      headers: { Authorization: `Zoho-oauthtoken ${await (zohoInventory as unknown as { getAccessToken: () => Promise<string> }).getAccessToken()}` },
    });
    if (!r.ok) {
      console.error(`SO list failed (${r.status}): ${(await r.text()).slice(0, 150)}`);
      break;
    }
    const d = await r.json();
    const orders = d.salesorders || [];
    orderCount += orders.length;
    process.stdout.write(`\r  fetched SO page ${page} (${orderCount} orders so far)`);
    // For each order, fetch detail to get line items
    for (const o of orders) {
      const detailRes = await fetch(`https://www.zohoapis.com/inventory/v1/salesorders/${o.salesorder_id}?organization_id=${ORG_ID}`, {
        headers: { Authorization: `Zoho-oauthtoken ${await (zohoInventory as unknown as { getAccessToken: () => Promise<string> }).getAccessToken()}` },
      });
      if (!detailRes.ok) continue;
      const dd = await detailRes.json();
      const items = dd.salesorder?.line_items || [];
      for (const li of items) {
        if (li.item_id) {
          itemIds.add(li.item_id);
          itemNameToOrderCount.set(li.item_id, (itemNameToOrderCount.get(li.item_id) || 0) + 1);
        }
      }
    }
    if (!d.page_context?.has_more_page) break;
    page++;
    if (page > 50) break;
  }
  console.log("");
  return { orderCount, itemIds, itemNameToOrderCount };
}

async function main() {
  console.log("─".repeat(70));
  console.log("ORPHAN USAGE AUDIT (2026)");
  console.log("─".repeat(70));

  // === HubSpot ===
  console.log("\nFetching all HubSpot Products...");
  const hsProducts = await listAllHubSpotProducts();
  console.log(`  ${hsProducts.length} HubSpot Products total`);
  const hsOrphans = hsProducts.filter((p) => !p.properties?.internal_product_id);
  console.log(`  ${hsOrphans.length} orphans (no internal_product_id)\n`);

  // Classify orphans by hs_lastmodifieddate
  const hsLiveByModified: HsProduct[] = [];
  const hsDormant: HsProduct[] = [];
  for (const p of hsOrphans) {
    const ts = Number(p.properties?.hs_lastmodifieddate || 0);
    if (ts >= YEAR_START_MS) hsLiveByModified.push(p);
    else hsDormant.push(p);
  }
  console.log(`HubSpot orphans by hs_lastmodifieddate:`);
  console.log(`  modified in 2026: ${hsLiveByModified.length}`);
  console.log(`  dormant (no 2026 modification): ${hsDormant.length}`);

  // For modified-in-2026, also check line item usage
  console.log(`\nChecking line-item usage in 2026 for ${hsLiveByModified.length} live-by-modified orphans...`);
  const hsLiveByLineItem: Array<{ p: HsProduct; lineItemCount: number; sample: LineItemHit[] }> = [];
  for (let i = 0; i < hsLiveByModified.length; i++) {
    const p = hsLiveByModified[i];
    process.stdout.write(`\r  [${i + 1}/${hsLiveByModified.length}]`);
    const usage = await checkHubSpotProductUsedInLineItems(p.id);
    if (usage.count > 0) hsLiveByLineItem.push({ p, lineItemCount: usage.count, sample: usage.sample });
  }
  console.log(`\n  ${hsLiveByLineItem.length} of ${hsLiveByModified.length} have at least one 2026 line item.`);

  console.log("\n── Top 20 ACTIVE HubSpot orphans (by 2026 line item count) ──");
  hsLiveByLineItem.sort((a, b) => b.lineItemCount - a.lineItemCount);
  for (const h of hsLiveByLineItem.slice(0, 20)) {
    const name = h.p.properties?.name || "(no name)";
    const sku = h.p.properties?.hs_sku || "";
    const mfg = h.p.properties?.manufacturer || "";
    console.log(`  ${h.p.id.padEnd(12)} ${name.slice(0, 50).padEnd(52)} sku=${sku.slice(0, 18).padEnd(20)} mfg=${mfg.slice(0, 12)}  → ${h.lineItemCount} 2026 line items`);
  }

  console.log("\n── Sample of MODIFIED-but-no-line-items HubSpot orphans (10) ──");
  const hsModifiedNoLI = hsLiveByModified.filter((p) => !hsLiveByLineItem.some((h) => h.p.id === p.id)).slice(0, 10);
  for (const p of hsModifiedNoLI) {
    const name = p.properties?.name || "(no name)";
    const lastMod = new Date(Number(p.properties?.hs_lastmodifieddate || 0)).toISOString().slice(0, 10);
    console.log(`  ${p.id.padEnd(12)} ${name.slice(0, 60).padEnd(62)} last_mod=${lastMod}`);
  }

  console.log("\n── Sample DORMANT HubSpot orphans (10, by name) ──");
  for (const p of hsDormant.slice(0, 10)) {
    const name = p.properties?.name || "(no name)";
    console.log(`  ${p.id.padEnd(12)} ${name.slice(0, 60)}`);
  }

  // === Zoho ===
  console.log("\n" + "─".repeat(70));
  console.log("Fetching Zoho 2026 sales orders + line items...");
  console.log("─".repeat(70));
  let zohoActiveItemIds = new Set<string>();
  let zohoOrderCount = 0;
  let zohoItemNameToOrderCount = new Map<string, number>();
  try {
    const r = await listZohoSalesOrders2026();
    zohoActiveItemIds = r.itemIds;
    zohoOrderCount = r.orderCount;
    zohoItemNameToOrderCount = r.itemNameToOrderCount;
  } catch (e) {
    console.error(`Zoho SO walk failed: ${e instanceof Error ? e.message : e}`);
  }
  console.log(`\nZoho 2026 sales orders: ${zohoOrderCount}, distinct item_ids referenced: ${zohoActiveItemIds.size}`);

  // List all active Zoho items + intersect with internal-id presence
  console.log("\nFetching all Zoho items...");
  const zohoItems = await zohoInventory.listItems();
  const activeZoho = zohoItems.filter((i: { status?: string }) => !i.status || i.status === "active");
  console.log(`  ${activeZoho.length} active Zoho items`);

  // For each active Zoho item, check (a) is it used in 2026 SO line items, (b) does it have cf_internal_product_id
  // Need to fetch detail for cf check — sample only
  const ORPHAN_USAGE_SAMPLE = Math.min(activeZoho.length, 300);
  console.log(`\nClassifying ${ORPHAN_USAGE_SAMPLE} Zoho items (orphan + 2026-usage)...`);
  let activeOrphanInUse = 0, activeOrphanDormant = 0, activeWithInternal = 0;
  const orphansInUse: Array<{ id: string; name: string; usageCount: number; lastModified?: string }> = [];
  for (let i = 0; i < ORPHAN_USAGE_SAMPLE; i++) {
    const item = activeZoho[i];
    if (!item.item_id) continue;
    if (i % 30 === 0) process.stdout.write(`\r  [${i + 1}/${ORPHAN_USAGE_SAMPLE}]`);
    const detail = await zohoInventory.getItemById(item.item_id);
    if (!detail) continue;
    const customFields = ((detail as Record<string, unknown>).custom_fields as Array<{ api_name?: string; value?: unknown }> | undefined) || [];
    const hasInternal = customFields.some((cf) => cf.api_name === "cf_internal_product_id" && cf.value);
    if (hasInternal) { activeWithInternal++; continue; }
    // Orphan — check usage
    const usageCount = zohoItemNameToOrderCount.get(item.item_id) || 0;
    const lastModified = (detail as Record<string, string | undefined>).last_modified_time;
    if (usageCount > 0 || (lastModified && new Date(lastModified).getTime() >= YEAR_START_MS)) {
      activeOrphanInUse++;
      orphansInUse.push({ id: item.item_id, name: (item as { name?: string }).name || "", usageCount, lastModified });
    } else {
      activeOrphanDormant++;
    }
  }
  console.log("");
  console.log(`Of ${ORPHAN_USAGE_SAMPLE} Zoho items sampled:`);
  console.log(`  ✓ have cf_internal_product_id: ${activeWithInternal}`);
  console.log(`  ✗ orphan + USED in 2026 (SO or modified): ${activeOrphanInUse}`);
  console.log(`  ✗ orphan + DORMANT: ${activeOrphanDormant}`);

  console.log("\n── Top 20 ACTIVE Zoho orphans (by 2026 SO usage) ──");
  orphansInUse.sort((a, b) => b.usageCount - a.usageCount);
  for (const o of orphansInUse.slice(0, 20)) {
    const lastMod = o.lastModified ? new Date(o.lastModified).toISOString().slice(0, 10) : "(unknown)";
    console.log(`  ${o.id.padEnd(20)} ${o.name.slice(0, 50).padEnd(52)} 2026 SO=${String(o.usageCount).padStart(3)}  last_mod=${lastMod}`);
  }

  // Persist
  const fs = await import("fs");
  fs.writeFileSync("scripts/orphan-usage-2026.json", JSON.stringify({
    audited_at: new Date().toISOString(),
    hubspot: {
      total_products: hsProducts.length,
      orphans_total: hsOrphans.length,
      orphans_modified_in_2026: hsLiveByModified.length,
      orphans_with_2026_line_items: hsLiveByLineItem.length,
      orphans_dormant: hsDormant.length,
      active_orphans_top: hsLiveByLineItem.slice(0, 50).map((h) => ({
        id: h.p.id,
        name: h.p.properties?.name,
        sku: h.p.properties?.hs_sku,
        manufacturer: h.p.properties?.manufacturer,
        price: h.p.properties?.price,
        line_item_count_2026: h.lineItemCount,
        last_modified: h.p.properties?.hs_lastmodifieddate,
      })),
      modified_no_line_items_sample: hsModifiedNoLI.slice(0, 30).map((p) => ({ id: p.id, name: p.properties?.name, last_modified: p.properties?.hs_lastmodifieddate })),
      dormant_sample: hsDormant.slice(0, 30).map((p) => ({ id: p.id, name: p.properties?.name })),
    },
    zoho: {
      sample_size: ORPHAN_USAGE_SAMPLE,
      total_active: activeZoho.length,
      sales_orders_2026: zohoOrderCount,
      distinct_items_in_2026_orders: zohoActiveItemIds.size,
      sampled_with_internal_id: activeWithInternal,
      sampled_orphan_in_use: activeOrphanInUse,
      sampled_orphan_dormant: activeOrphanDormant,
      active_orphans_top: orphansInUse.slice(0, 50),
    },
  }, null, 2));
  console.log("\nWrote scripts/orphan-usage-2026.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
