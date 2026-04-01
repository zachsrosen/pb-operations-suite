/**
 * Categorize 228 unlinked HS products into real physical products vs service/billing/legacy.
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

  // Fetch all HS products
  let allHs: Array<Record<string, unknown>> = [];
  let after: string | undefined;
  while (true) {
    const url = `https://api.hubapi.com/crm/v3/objects/products?limit=100&properties=name,hs_sku,price${after ? `&after=${after}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${HS_TOKEN}` } });
    const data = await res.json() as Record<string, unknown>;
    const results = ((data as any).results || []) as Array<Record<string, unknown>>;
    allHs.push(...results);
    const paging = (data as any).paging;
    if (paging?.next?.after) { after = paging.next.after; } else { break; }
  }

  const unlinked = allHs.filter(p => !linkedHsIds.has(String(p.id)));

  // Categorize each product
  interface HsProd { id: string; name: string; sku: string; price: string; category: string }

  const categorized: HsProd[] = [];

  for (const hp of unlinked) {
    const props = hp.properties as Record<string, unknown>;
    const name = String(props?.name || "");
    const sku = String(props?.hs_sku || "");
    const price = String(props?.price || "");
    const nameLower = name.toLowerCase();
    const skuLower = sku.toLowerCase();

    let category = "UNKNOWN";

    // Legacy/deleted/do-not-use
    if (nameLower.includes("legacy") || nameLower.includes("do not use") || nameLower.includes("deleted") || nameLower.includes("test ")) {
      category = "LEGACY/DELETED";
    }
    // Service line items
    else if (nameLower.startsWith("svc") || skuLower.startsWith("svc")) {
      category = "SERVICE_LINE_ITEM";
    }
    // D&R fees (DR## SKUs)
    else if (/^DR\d+$/i.test(sku)) {
      category = "DR_FEE";
    }
    // Billing/invoicing items
    else if (/deposit|invoice|install fee|labor|refund|discount|sales tax|rent expense|permit|change order|design fee/i.test(nameLower)) {
      category = "BILLING_ITEM";
    }
    // Bundles / pricing packages
    else if (/\(\d\)\s*(ac|dc|pw)/i.test(nameLower) || /\bcoupled\b/i.test(nameLower) || /\+ backup/i.test(nameLower) || /with new solar/i.test(nameLower)) {
      category = "BUNDLE";
    }
    // Tesla custom/semi-custom
    else if (/tesla (custom|semi-custom)/i.test(nameLower)) {
      category = "BUNDLE";
    }
    // Construction/roofing services
    else if (/detach|reroof|roof repair|roof final|roofing|tile roof|steep roof|thermal removal|two story|overnight|trip charge|travel|trench|pre-wire|hazardous|disposal|equipment removal|upgrade module|critter guard|panel add|main panel|main service|sub panel|adder|car charger|ev (charger|circuit)/i.test(nameLower)) {
      category = "ADDER_SERVICE";
    }
    // Actual physical products — solar modules
    else if (/\d{3,4}W|\bmodule\b|panel|rec\d|qcell|q\.peak|q\.tron|qpeak|silfab|sil-\d|seg-\d|jinko|longi|aee solar|solar4america/i.test(nameLower + " " + skuLower)) {
      category = "⚡ REAL: MODULE";
    }
    // Inverters
    else if (/inverter|se\d{4,5}h|sunny|tripower|solis|soled se/i.test(nameLower + " " + skuLower)) {
      category = "⚡ REAL: INVERTER";
    }
    // Batteries
    else if (/battery|encharge|resu\d|powerwall\b(?! ?\+)/i.test(nameLower)) {
      category = "⚡ REAL: BATTERY";
    }
    // SolarEdge optimizers/accessories
    else if (/solaredge (p\d|s\d|cell|control|backup|site transfer)|^p\d{3,4}$|^s\d{3,4}$/i.test(nameLower + " " + skuLower) || /^(P|S)\d{3,4}$/i.test(sku)) {
      category = "⚡ REAL: SOLAREDGE_ACCESSORY";
    }
    // Enphase microinverters/accessories
    else if (/enphase|iq\d|iq combiner|enlighten|microinverter/i.test(nameLower)) {
      category = "⚡ REAL: ENPHASE";
    }
    // IronRidge / racking
    else if (/ironridge|unirac|quickmount|racking/i.test(nameLower)) {
      category = "⚡ REAL: RACKING";
    }
    // Tesla hardware (not bundles)
    else if (/tesla.*(gateway|powerwall|wall conn|magic dock|mci|neurio|stack|internal panel|cold weather|bracket|disconnect)/i.test(nameLower)) {
      category = "⚡ REAL: TESLA_HARDWARE";
    }
    // Rapid shutdown
    else if (/rapid shut|rsd|tygo|tigo|ts4/i.test(nameLower + " " + skuLower)) {
      category = "⚡ REAL: RAPID_SHUTDOWN";
    }
    // Monitoring
    else if (/sense|communication|monitoring|cell card|dsc.*cell|gateway/i.test(nameLower)) {
      category = "⚡ REAL: MONITORING";
    }
    // Electrical
    else if (/combiner|communication device/i.test(nameLower)) {
      category = "⚡ REAL: ELECTRICAL";
    }

    categorized.push({ id: String(hp.id), name, sku, price, category });
  }

  // Group and print
  const groups = new Map<string, HsProd[]>();
  for (const p of categorized) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category)!.push(p);
  }

  // Print non-real first, then real
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const aReal = a.startsWith("⚡");
    const bReal = b.startsWith("⚡");
    if (aReal && !bReal) return 1;
    if (!aReal && bReal) return -1;
    return a.localeCompare(b);
  });

  let realCount = 0;
  let nonRealCount = 0;

  for (const key of sortedKeys) {
    const items = groups.get(key)!;
    const isReal = key.startsWith("⚡");
    if (isReal) realCount += items.length;
    else nonRealCount += items.length;

    console.log(`\n${"─".repeat(60)}`);
    console.log(`${key} (${items.length})`);
    console.log("─".repeat(60));
    for (const p of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const priceStr = p.price && p.price !== "null" ? ` $${parseFloat(p.price).toFixed(0)}` : "";
      console.log(`  HS:${p.id.padEnd(14)} "${p.name.substring(0, 55)}" SKU:${p.sku.substring(0, 25)}${priceStr}`);
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`SUMMARY`);
  console.log(`Not real products (skip): ${nonRealCount}`);
  console.log(`⚡ Real physical products: ${realCount}`);
  console.log(`Total unlinked: ${categorized.length}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
