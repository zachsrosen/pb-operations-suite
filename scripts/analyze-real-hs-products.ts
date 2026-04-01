/**
 * Analyze the 106 "real" unlinked HS products — check recency, deal usage, and pricing
 * to determine current vs. legacy.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

  // Load linked HS IDs
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { hubspotProductId: true },
  });
  const linkedHsIds = new Set(allIPs.filter(p => p.hubspotProductId).map(p => p.hubspotProductId!));

  // Fetch all HS products with more properties
  let allHs: Array<Record<string, unknown>> = [];
  let after: string | undefined;
  while (true) {
    const url = `https://api.hubapi.com/crm/v3/objects/products?limit=100&properties=name,hs_sku,price,createdate,hs_lastmodifieddate,description${after ? `&after=${after}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${HS_TOKEN}` } });
    const data = await res.json() as Record<string, unknown>;
    const results = ((data as any).results || []) as Array<Record<string, unknown>>;
    allHs.push(...results);
    const paging = (data as any).paging;
    if (paging?.next?.after) { after = paging.next.after; } else { break; }
  }

  const unlinked = allHs.filter(p => !linkedHsIds.has(String(p.id)));

  // Filter to just real physical products (same logic as categorize script)
  const realProducts: Array<{
    id: string; name: string; sku: string; price: number;
    created: string; modified: string; category: string;
  }> = [];

  for (const hp of unlinked) {
    const props = hp.properties as Record<string, unknown>;
    const name = String(props?.name || "");
    const sku = String(props?.hs_sku || "");
    const price = parseFloat(String(props?.price || "0")) || 0;
    const created = String(props?.createdate || "").split("T")[0];
    const modified = String(props?.hs_lastmodifieddate || "").split("T")[0];
    const nameLower = name.toLowerCase();
    const skuLower = sku.toLowerCase();

    // Skip non-real
    if (nameLower.includes("legacy") || nameLower.includes("do not use") || nameLower.includes("deleted") || nameLower.includes("test ")) continue;
    if (nameLower.startsWith("svc") || skuLower.startsWith("svc")) continue;
    if (/^DR\d+$/i.test(sku)) continue;
    if (/deposit|invoice|install fee|labor|refund|discount|sales tax|rent expense|permit|change order|design fee/i.test(nameLower)) continue;
    if (/\(\d\)\s*(ac|dc|pw)/i.test(nameLower) || /\bcoupled\b/i.test(nameLower) || /\+ backup/i.test(nameLower) || /with new solar/i.test(nameLower)) continue;
    if (/tesla (custom|semi-custom)/i.test(nameLower)) continue;
    if (/detach|reroof|roof repair|roof final|roofing|tile roof|steep roof|thermal removal|two story|overnight|trip charge|travel|trench|pre-wire|hazardous|disposal|equipment removal|upgrade module|critter guard|panel add|main panel|main service|sub panel|adder|car charger/i.test(nameLower)) continue;

    let category = "OTHER";
    if (/\d{3,4}W|\bmodule\b|panel|rec\d|qcell|q\.peak|q\.tron|qpeak|silfab|sil-\d|seg-\d|jinko|longi|aee solar|solar4america/i.test(nameLower + " " + skuLower)) category = "MODULE";
    else if (/inverter|se\d{4,5}h|sunny|tripower|solis|soled se/i.test(nameLower + " " + skuLower)) category = "INVERTER";
    else if (/battery|encharge|resu\d|powerwall\b(?! ?\+)/i.test(nameLower)) category = "BATTERY";
    else if (/solaredge.*(p\d|s\d|cell|control|backup|site)|^(P|S)\d{3,4}$/i.test(nameLower + " " + sku)) category = "SE_ACCESSORY";
    else if (/enphase|iq\d|iq combiner|enlighten|microinverter/i.test(nameLower)) category = "ENPHASE";
    else if (/ironridge|unirac|quickmount|racking/i.test(nameLower)) category = "RACKING";
    else if (/tesla.*(gateway|powerwall|wall conn|magic dock|mci|neurio|stack|internal panel|cold weather|bracket|disconnect)/i.test(nameLower)) category = "TESLA_HW";
    else if (/rapid shut|rsd|tygo|tigo|ts4/i.test(nameLower + " " + skuLower)) category = "RSD";
    else if (/sense|communication|monitoring|cell card|gateway/i.test(nameLower)) category = "MONITORING";

    realProducts.push({ id: String(hp.id), name, sku, price, created, modified, category });
  }

  // Now check recent line item usage for each product
  // Search line items associated with these products in the last 12 months
  console.log(`Checking deal usage for ${realProducts.length} real products...\n`);

  const productUsage = new Map<string, number>();

  // Batch search: for each product, count line items referencing it
  // HubSpot line items have hs_product_id property
  for (let i = 0; i < realProducts.length; i += 10) {
    const batch = realProducts.slice(i, i + 10);
    const promises = batch.map(async (p) => {
      try {
        const searchBody = {
          filterGroups: [{
            filters: [{
              propertyName: "hs_product_id",
              operator: "EQ",
              value: p.id,
            }],
          }],
          properties: ["hs_product_id", "createdate"],
          sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
          limit: 1,
        };
        const r = await fetch("https://api.hubapi.com/crm/v3/objects/line_items/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify(searchBody),
        });
        const d = await r.json() as any;
        const total = d.total || 0;
        const lastUsed = d.results?.[0]?.properties?.createdate?.split("T")[0] || "";
        productUsage.set(p.id, total);
        return { id: p.id, total, lastUsed };
      } catch {
        return { id: p.id, total: 0, lastUsed: "" };
      }
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      productUsage.set(r.id, r.total);
      const prod = realProducts.find(p => p.id === r.id);
      if (prod) (prod as any).lineItemCount = r.total;
      if (prod) (prod as any).lastUsed = r.lastUsed;
    }

    // Small delay to avoid rate limits
    if (i + 10 < realProducts.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Classify as CURRENT vs LEGACY
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().split("T")[0];
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString().split("T")[0];

  interface Analyzed {
    id: string; name: string; sku: string; price: number; category: string;
    created: string; modified: string; lineItemCount: number; lastUsed: string;
    verdict: "CURRENT" | "PROBABLY_CURRENT" | "PROBABLY_LEGACY" | "LEGACY";
    reason: string;
  }

  const analyzed: Analyzed[] = realProducts.map(p => {
    const liCount = (p as any).lineItemCount || 0;
    const lastUsed = (p as any).lastUsed || "";

    let verdict: Analyzed["verdict"];
    let reason: string;

    if (liCount > 0 && lastUsed >= sixMonthsAgo) {
      verdict = "CURRENT";
      reason = `${liCount} line items, last used ${lastUsed}`;
    } else if (liCount > 0 && lastUsed >= oneYearAgo) {
      verdict = "PROBABLY_CURRENT";
      reason = `${liCount} line items, last used ${lastUsed}`;
    } else if (liCount > 0) {
      verdict = "PROBABLY_LEGACY";
      reason = `${liCount} line items, last used ${lastUsed}`;
    } else if (p.modified >= sixMonthsAgo && p.price > 1) {
      verdict = "PROBABLY_CURRENT";
      reason = `0 line items but modified ${p.modified}, price $${p.price}`;
    } else {
      verdict = "LEGACY";
      reason = `${liCount} line items${lastUsed ? `, last ${lastUsed}` : ""}, modified ${p.modified}`;
    }

    return { ...p, lineItemCount: liCount, lastUsed, verdict, reason };
  });

  // Print grouped by verdict
  const verdictOrder: Analyzed["verdict"][] = ["CURRENT", "PROBABLY_CURRENT", "PROBABLY_LEGACY", "LEGACY"];

  for (const v of verdictOrder) {
    const items = analyzed.filter(a => a.verdict === v).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    if (items.length === 0) continue;

    const emoji = v === "CURRENT" ? "🟢" : v === "PROBABLY_CURRENT" ? "🟡" : v === "PROBABLY_LEGACY" ? "🟠" : "🔴";
    console.log(`\n${"═".repeat(70)}`);
    console.log(`${emoji} ${v} (${items.length})`);
    console.log("═".repeat(70));

    for (const a of items) {
      const priceStr = a.price > 0 ? `$${a.price}` : "$0";
      console.log(`  [${a.category.padEnd(14)}] "${a.name.substring(0, 50)}"`);
      console.log(`    HS:${a.id.padEnd(14)} SKU:${a.sku.substring(0, 25).padEnd(26)} ${priceStr.padEnd(8)} ${a.reason}`);
    }
  }

  // Summary
  const counts = new Map<string, number>();
  for (const a of analyzed) {
    counts.set(a.verdict, (counts.get(a.verdict) || 0) + 1);
  }
  console.log(`\n${"═".repeat(70)}`);
  console.log("SUMMARY");
  console.log("═".repeat(70));
  for (const v of verdictOrder) {
    console.log(`  ${v}: ${counts.get(v) || 0}`);
  }
  console.log(`  Total: ${analyzed.length}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
