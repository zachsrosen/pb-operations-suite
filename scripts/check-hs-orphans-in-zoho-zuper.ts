/**
 * For unlinked HS products that need new IPs, check if matching
 * Zoho Inventory items or Zuper products already exist.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// All "need new IP" HS products from the current/probably_current analysis
const HS_PRODUCTS = [
  { id: "2883558419", name: "Enphase IQ8 Microinverter w/ MC4", sku: "ENP IQ8A-72-M-US" },
  { id: "2650151069", name: "QCell Q.TRON 425W BLK", sku: "Q.TRON BLK M-G2+ 425" },
  { id: "2618967612", name: "REC 420AA Pure-R", sku: "REC420AA Pure-R" },
  { id: "30615479836", name: "REC450AA PURE-RX", sku: "REC450AA PURE-RX" },
  { id: "17133619621", name: "REC460AA Pure-RX", sku: "REC460AA-PURE-RX" },
  { id: "16929724050", name: "SEG-485-BTB-BG", sku: "SEG-485-BTB-BG" },
  { id: "2764680033", name: "SIL-410 HC+", sku: "SIL-410 HC+" },
  { id: "1579421249", name: "SolarEdge P500", sku: "P500" },
  { id: "1591865659", name: "SolarEdge P400", sku: "P400" },
  { id: "1591855420", name: "SolarEdge P505", sku: "P505" },
  { id: "2670452284", name: "Solaredge P1101", sku: "P1101" },
  { id: "2619112468", name: "Tesla Powerwall +", sku: "EP-PWPLUS-CONTR" },
  { id: "2049060932", name: "Tesla Powerwall 2.0", sku: "3012170-05-C" },
  { id: "1591863674", name: "Tesla Gateway", sku: "TESLA GATEWAY" },
  { id: "1579419747", name: "Sense Monitoring", sku: "Sense Monitoring" },
  { id: "37209297276", name: "Unirac Custom Racking", sku: "Unirac Custom Racking" },
  { id: "1579422987", name: "EV Circuit Installation", sku: "Car Charger Circuit" },
  { id: "2400618135", name: "Solar Install", sku: "INST_PV_1" },
];

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Load all Zuper products
  let allZuper: Array<Record<string, unknown>> = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as Record<string, unknown>;
    const batch = (d.data || []) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;
    allZuper.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  console.log(`Loaded ${allZuper.length} Zuper products\n`);

  // Build Zuper lookup by normalized name and HS ID
  const zuperByNormName = new Map<string, typeof allZuper[0][]>();
  const zuperByHsId = new Map<string, typeof allZuper[0]>();

  for (const zp of allZuper) {
    const name = String(zp.product_name || "");
    const norm = normalize(name);
    if (!zuperByNormName.has(norm)) zuperByNormName.set(norm, []);
    zuperByNormName.get(norm)!.push(zp);

    // Extract HS ID from meta_data or custom fields
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const m of meta) {
        if (m.label === "HubSpot Product ID" && m.value) {
          zuperByHsId.set(String(m.value), zp);
        }
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (cfio?.product_hubspot_product_id_1) {
      zuperByHsId.set(String(cfio.product_hubspot_product_id_1), zp);
    }
  }

  // Search Zoho for each product
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  console.log("HS Product → Zoho / Zuper matches\n");
  console.log("─".repeat(80));

  for (const hs of HS_PRODUCTS) {
    console.log(`\nHS:${hs.id} "${hs.name}" SKU:${hs.sku}`);

    // Check Zuper by HS ID
    let zuperMatch = zuperByHsId.get(hs.id);
    let zuperMatchType = zuperMatch ? "hs-id" : "";

    // Check Zuper by normalized name
    if (!zuperMatch) {
      const normName = normalize(hs.name);
      const hits = zuperByNormName.get(normName);
      if (hits?.length) {
        zuperMatch = hits[0];
        zuperMatchType = "exact-name";
      }
    }

    // Check Zuper by SKU in name
    if (!zuperMatch && hs.sku.length > 4) {
      const normSku = normalize(hs.sku);
      for (const [norm, zps] of zuperByNormName) {
        if (norm.includes(normSku) || normSku.includes(norm)) {
          zuperMatch = zps[0];
          zuperMatchType = "sku-in-name";
          break;
        }
      }
    }

    // Check Zuper by partial name
    if (!zuperMatch) {
      const normName = normalize(hs.name);
      for (const [norm, zps] of zuperByNormName) {
        if (norm.length > 6 && normName.includes(norm)) {
          zuperMatch = zps[0];
          zuperMatchType = "partial-name";
          break;
        }
        if (normName.length > 6 && norm.includes(normName)) {
          zuperMatch = zps[0];
          zuperMatchType = "partial-name";
          break;
        }
      }
    }

    if (zuperMatch) {
      const uid = String(zuperMatch.product_uid);
      const zName = String(zuperMatch.product_name);
      console.log(`  Zuper: ✅ "${zName}" (${uid.substring(0, 12)}…) [${zuperMatchType}]`);
    } else {
      console.log(`  Zuper: ❌ No match`);
    }

    // Check Zoho by name/SKU search
    try {
      const searchTerms = [hs.sku, hs.name.substring(0, 30)].filter(s => s.length > 3);
      let zohoMatch: any = null;

      for (const term of searchTerms) {
        if (zohoMatch) break;
        try {
          const results = await zohoInventory.searchItems(term);
          if (results?.length) {
            // Find best match
            const normTerm = normalize(term);
            for (const item of results) {
              const normItemName = normalize(item.name || "");
              const normItemSku = normalize(item.sku || "");
              if (normItemName.includes(normTerm) || normTerm.includes(normItemName) ||
                  normItemSku.includes(normTerm) || normTerm.includes(normItemSku)) {
                zohoMatch = item;
                break;
              }
            }
            if (!zohoMatch && results.length === 1) zohoMatch = results[0];
          }
        } catch {}
        await new Promise(r => setTimeout(r, 1500)); // Zoho rate limit
      }

      if (zohoMatch) {
        console.log(`  Zoho:  ✅ "${zohoMatch.name}" (${zohoMatch.item_id}) SKU:${zohoMatch.sku || "none"}`);
      } else {
        console.log(`  Zoho:  ❌ No match`);
      }
    } catch (err) {
      console.log(`  Zoho:  ⚠️ Error searching`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
