/**
 * Match active Zoho orphan items (no cf_internal_product_id, used in 2026 SOs
 * or modified in 2026) to InternalProduct rows by SKU/model.
 *
 * Also matches each result against existing Zuper Products (by SKU/name) so
 * we know whether the Zuper side needs a link or a new product create too.
 *
 * Read-only. Output: scripts/zoho-orphan-matches.json
 *
 * Categories of action:
 *   - LINK_ALL   : matched InternalProduct + matched Zuper. Just write IDs.
 *   - LINK_INT_NEW_ZUPER : matched InternalProduct, no Zuper match. Link to internal, create Zuper.
 *   - NEW_INT_NEW_ZUPER  : no InternalProduct match. Create both internal + Zuper from Zoho data.
 *   - NEW_INT_LINK_ZUPER : no InternalProduct match, but Zuper match exists. Create internal, link to existing Zuper.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_match-zoho-orphans.ts
 */
import { prisma } from "../src/lib/db";
import { zohoInventory } from "../src/lib/zoho-inventory";

const ZUPER_API_KEY = process.env.ZUPER_API_KEY;
const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
const ORG_ID = process.env.ZOHO_INVENTORY_ORG_ID;
const YEAR_START_MS = new Date("2026-01-01T00:00:00Z").getTime();

function normalize(s: string | null | undefined): string {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

interface ZohoItemRecord {
  item_id: string;
  name?: string;
  sku?: string;
  part_number?: string;
  brand?: string;
  manufacturer?: string;
  category_name?: string;
  category_id?: string;
  rate?: number;
  purchase_rate?: number;
  unit?: string;
  description?: string;
  status?: string;
  last_modified_time?: string;
  custom_fields?: Array<{ api_name?: string; value?: unknown }>;
}

interface InternalRow {
  id: string;
  brand: string;
  model: string;
  category: string;
  sku: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  zohoItemId: string | null;
}

interface ZuperRecord {
  product_uid: string;
  product_name?: string;
  sku?: string;
  product_id?: string;
  part_number?: string;
}

async function getZohoAccessToken(): Promise<string> {
  return (zohoInventory as unknown as { getAccessToken: () => Promise<string> }).getAccessToken();
}

async function listZoho2026SOItemIds(): Promise<Set<string>> {
  const itemIds = new Set<string>();
  let page = 1;
  while (true) {
    const params = new URLSearchParams({
      organization_id: ORG_ID!,
      page: String(page),
      per_page: "200",
      date_start: "2026-01-01",
      date_end: "2026-12-31",
    });
    const r = await fetch(`https://www.zohoapis.com/inventory/v1/salesorders?${params}`, {
      headers: { Authorization: `Zoho-oauthtoken ${await getZohoAccessToken()}` },
    });
    if (!r.ok) break;
    const d = await r.json();
    const orders = d.salesorders || [];
    process.stdout.write(`\r  fetched SO page ${page} (${orders.length}+ orders so far)`);
    for (const o of orders) {
      const detail = await fetch(`https://www.zohoapis.com/inventory/v1/salesorders/${o.salesorder_id}?organization_id=${ORG_ID}`, {
        headers: { Authorization: `Zoho-oauthtoken ${await getZohoAccessToken()}` },
      });
      if (!detail.ok) continue;
      const dd = await detail.json();
      for (const li of dd.salesorder?.line_items || []) {
        if (li.item_id) itemIds.add(li.item_id);
      }
    }
    if (!d.page_context?.has_more_page) break;
    page++;
    if (page > 50) break;
  }
  console.log("");
  return itemIds;
}

async function listAllZuperProducts(): Promise<ZuperRecord[]> {
  if (!ZUPER_API_KEY) return [];
  const all: ZuperRecord[] = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY, "Content-Type": "application/json" },
    });
    if (!r.ok) break;
    const d = await r.json();
    const items: ZuperRecord[] = d.data || d.products || [];
    if (items.length === 0) break;
    all.push(...items);
    process.stdout.write(`\r  fetched Zuper page ${page} (${all.length} total)`);
    if (items.length < 100) break;
    page++;
    if (page > 100) break;
  }
  console.log("");
  return all;
}

async function main() {
  if (!prisma) { console.error("prisma not configured"); process.exit(1); }

  console.log("Fetching all InternalProduct rows...");
  const internals: InternalRow[] = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { id: true, brand: true, model: true, category: true, sku: true,
      hubspotProductId: true, zuperItemId: true, zohoItemId: true },
  });
  console.log(`  ${internals.length} active InternalProducts`);

  // Build lookup indexes for matching
  const internalByZoho = new Map<string, InternalRow>();
  const internalBySku = new Map<string, InternalRow[]>();
  const internalByModel = new Map<string, InternalRow[]>();
  for (const r of internals) {
    if (r.zohoItemId) internalByZoho.set(r.zohoItemId, r);
    if (r.sku) {
      const k = normalize(r.sku);
      if (k) (internalBySku.get(k) ?? internalBySku.set(k, []).get(k)!).push(r);
    }
    if (r.model) {
      const k = normalize(r.model);
      if (k) (internalByModel.get(k) ?? internalByModel.set(k, []).get(k)!).push(r);
    }
  }

  console.log("\nFetching all Zuper Products...");
  const zuperAll = await listAllZuperProducts();
  console.log(`  ${zuperAll.length} Zuper Products total`);
  const zuperBySku = new Map<string, ZuperRecord[]>();
  const zuperByName = new Map<string, ZuperRecord[]>();
  for (const z of zuperAll) {
    const sku = normalize(z.sku || z.product_id || z.part_number);
    if (sku) (zuperBySku.get(sku) ?? zuperBySku.set(sku, []).get(sku)!).push(z);
    const nm = normalize(z.product_name);
    if (nm) (zuperByName.get(nm) ?? zuperByName.set(nm, []).get(nm)!).push(z);
  }

  console.log("\nFetching 2026 Zoho SO line item ids...");
  const itemIds2026 = await listZoho2026SOItemIds();
  console.log(`  ${itemIds2026.size} distinct item_ids referenced in 2026 SOs`);

  console.log("\nFetching all active Zoho items...");
  const allZoho = (await zohoInventory.listItems()) as ZohoItemRecord[];
  const activeZoho = allZoho.filter((i) => !i.status || i.status === "active");
  console.log(`  ${activeZoho.length} active Zoho items`);

  console.log("\nClassifying each Zoho item — fetching cf_* details...");
  const orphansToProcess: Array<{ z: ZohoItemRecord; reason: string }> = [];
  let internalLinked = 0, dormantOrphans = 0;
  for (let i = 0; i < activeZoho.length; i++) {
    const z = activeZoho[i];
    if (!z.item_id) continue;
    if (i % 50 === 0) process.stdout.write(`\r  [${i + 1}/${activeZoho.length}]`);
    // Already linked from internal side?
    if (internalByZoho.has(z.item_id)) { internalLinked++; continue; }
    // Get detail to check cf_internal_product_id
    const det = await zohoInventory.getItemById(z.item_id) as ZohoItemRecord | null;
    if (!det) continue;
    const cfs = det.custom_fields || [];
    const hasInternal = cfs.some((cf) => cf.api_name === "cf_internal_product_id" && cf.value);
    if (hasInternal) { internalLinked++; continue; }
    // Orphan — is it active in 2026?
    const usedInSO = itemIds2026.has(z.item_id);
    const recentlyMod = det.last_modified_time && new Date(det.last_modified_time).getTime() >= YEAR_START_MS;
    if (!usedInSO && !recentlyMod) { dormantOrphans++; continue; }
    orphansToProcess.push({
      z: { ...det, item_id: z.item_id },
      reason: usedInSO ? "in 2026 SO" : "modified in 2026",
    });
  }
  console.log("");
  console.log(`\nClassification:`);
  console.log(`  InternalProduct linked already: ${internalLinked}`);
  console.log(`  Orphan + dormant:               ${dormantOrphans}`);
  console.log(`  Orphan + active (to process):   ${orphansToProcess.length}`);

  // Match each active orphan against InternalProduct + Zuper
  console.log("\nMatching active orphans...");
  interface Match {
    zohoId: string; zohoName: string; zohoSku: string; zohoCategory: string;
    zohoBrand: string | null; zohoPrice: number | null; zohoUnit: string | null;
    zohoLastMod: string | null; reason: string;
    internalMatch: { id: string; brand: string; model: string; matchedBy: string } | null;
    zuperMatch: { id: string; name: string; matchedBy: string } | null;
    action: "LINK_ALL" | "LINK_INT_NEW_ZUPER" | "NEW_INT_LINK_ZUPER" | "NEW_INT_NEW_ZUPER";
  }
  const matches: Match[] = [];
  for (const { z, reason } of orphansToProcess) {
    // InternalProduct match
    let internalMatch: Match["internalMatch"] = null;
    const skuKey = normalize(z.sku || z.part_number);
    if (skuKey && internalBySku.has(skuKey)) {
      const cands = internalBySku.get(skuKey)!;
      if (cands.length === 1) internalMatch = { id: cands[0].id, brand: cands[0].brand, model: cands[0].model, matchedBy: "sku" };
    }
    if (!internalMatch && skuKey && internalByModel.has(skuKey)) {
      const cands = internalByModel.get(skuKey)!;
      if (cands.length === 1) internalMatch = { id: cands[0].id, brand: cands[0].brand, model: cands[0].model, matchedBy: "model" };
    }
    // Zuper match
    let zuperMatch: Match["zuperMatch"] = null;
    if (skuKey && zuperBySku.has(skuKey)) {
      const cands = zuperBySku.get(skuKey)!;
      if (cands.length === 1) zuperMatch = { id: cands[0].product_uid, name: cands[0].product_name || "", matchedBy: "sku" };
    }
    if (!zuperMatch && z.name) {
      const nm = normalize(z.name);
      if (nm && zuperByName.has(nm)) {
        const cands = zuperByName.get(nm)!;
        if (cands.length === 1) zuperMatch = { id: cands[0].product_uid, name: cands[0].product_name || "", matchedBy: "name" };
      }
    }
    let action: Match["action"];
    if (internalMatch && zuperMatch) action = "LINK_ALL";
    else if (internalMatch && !zuperMatch) action = "LINK_INT_NEW_ZUPER";
    else if (!internalMatch && zuperMatch) action = "NEW_INT_LINK_ZUPER";
    else action = "NEW_INT_NEW_ZUPER";
    matches.push({
      zohoId: z.item_id, zohoName: z.name || "", zohoSku: z.sku || "",
      zohoCategory: z.category_name || "", zohoBrand: z.brand || z.manufacturer || null,
      zohoPrice: typeof z.rate === "number" ? z.rate : null,
      zohoUnit: z.unit || null, zohoLastMod: z.last_modified_time || null,
      reason, internalMatch, zuperMatch, action,
    });
  }

  // Summary
  const byAction = new Map<string, number>();
  for (const m of matches) byAction.set(m.action, (byAction.get(m.action) || 0) + 1);
  console.log("\n──── ACTIONS BREAKDOWN ────");
  for (const [a, n] of byAction) console.log(`  ${a.padEnd(22)} ${n}`);

  // Sample by action
  for (const action of ["LINK_ALL", "LINK_INT_NEW_ZUPER", "NEW_INT_LINK_ZUPER", "NEW_INT_NEW_ZUPER"] as const) {
    const sample = matches.filter((m) => m.action === action).slice(0, 8);
    if (sample.length === 0) continue;
    console.log(`\n── ${action} (${matches.filter((m) => m.action === action).length}) — first 8 ──`);
    for (const m of sample) {
      const im = m.internalMatch ? `→ ${m.internalMatch.id} "${m.internalMatch.brand} ${m.internalMatch.model}" (by ${m.internalMatch.matchedBy})` : "(no internal match)";
      const zm = m.zuperMatch ? `→ Zuper ${m.zuperMatch.id.slice(0, 8)}... "${m.zuperMatch.name}" (by ${m.zuperMatch.matchedBy})` : "(no zuper match)";
      console.log(`  ${m.zohoId.padEnd(22)} sku="${m.zohoSku}" name="${m.zohoName.slice(0, 40)}"`);
      console.log(`    internal: ${im}`);
      console.log(`    zuper:    ${zm}`);
    }
  }

  // Persist
  const fs = await import("fs");
  fs.writeFileSync("scripts/zoho-orphan-matches.json", JSON.stringify({
    generated_at: new Date().toISOString(),
    summary: {
      active_zoho_total: activeZoho.length,
      already_linked_to_internal: internalLinked,
      dormant_orphans: dormantOrphans,
      active_orphans_to_process: orphansToProcess.length,
      action_breakdown: Object.fromEntries(byAction),
    },
    matches,
  }, null, 2));
  console.log("\nWrote scripts/zoho-orphan-matches.json");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
