/**
 * Create InternalProducts for 16 HS products that have matching Zuper products.
 * Links both hubspotProductId and zuperItemId.
 * Pass --live to execute.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");

// Manually mapped: HS ID, name, SKU, category, brand, model, Zuper UID
const PRODUCTS: Array<{
  hsId: string;
  zuperUid: string;
  category: string;
  brand: string;
  model: string;
  name: string;
}> = [
  { hsId: "2883558419", zuperUid: "d0c62cfa-8e3", category: "INVERTER", brand: "Enphase", model: "IQ8A-72-M-US", name: "Enphase IQ8 Microinverter w/ MC4" },
  { hsId: "2650151069", zuperUid: "11c3d60a-e15", category: "MODULE", brand: "Hanwha", model: "Q.TRON BLK M-G2+ 425", name: "QCell Q.TRON 425W BLK" },
  { hsId: "2618967612", zuperUid: "a262bd7d-2f8", category: "MODULE", brand: "REC", model: "REC420AA Pure-R", name: "REC 420AA Pure-R" },
  { hsId: "17133619621", zuperUid: "98d74d13-362", category: "MODULE", brand: "REC", model: "REC460AA-PURE-RX", name: "REC 460AA Pure-RX" },
  { hsId: "16929724050", zuperUid: "a99a6f37-095", category: "MODULE", brand: "SEG Solar", model: "SEG-485-BTB-BG", name: "SEG Solar 485W" },
  { hsId: "2764680033", zuperUid: "9be769b2-1b8", category: "MODULE", brand: "Silfab", model: "SIL-410 HC+", name: "Silfab SIL-410 HC+" },
  { hsId: "1579421249", zuperUid: "eb99ba00-ebe", category: "ELECTRICAL_BOS", brand: "SolarEdge", model: "P500", name: "SolarEdge P500 Optimizer" },
  { hsId: "1591865659", zuperUid: "8383e292-986", category: "ELECTRICAL_BOS", brand: "SolarEdge", model: "P400", name: "SolarEdge P400 Optimizer" },
  { hsId: "1591855420", zuperUid: "deb5af6e-b6b", category: "ELECTRICAL_BOS", brand: "SolarEdge", model: "P505", name: "SolarEdge P505 Optimizer" },
  { hsId: "2670452284", zuperUid: "a905ec3a-3e6", category: "ELECTRICAL_BOS", brand: "SolarEdge", model: "P1101", name: "SolarEdge P1101 Optimizer" },
  { hsId: "2619112468", zuperUid: "578a9e8d-92f", category: "BATTERY", brand: "Tesla", model: "EP-PWPLUS-CONTR", name: "Tesla Powerwall +" },
  { hsId: "2049060932", zuperUid: "3c02ea93-ef0", category: "BATTERY", brand: "Tesla", model: "3012170-05-C", name: "Tesla Powerwall 2.0" },
  { hsId: "1591863674", zuperUid: "445c8703-2e8", category: "GATEWAY", brand: "Tesla", model: "TESLA-GATEWAY-1", name: "Tesla Gateway" },
  { hsId: "1579419747", zuperUid: "0498f5b3-0ef", category: "MONITORING", brand: "Sense", model: "SENSE-MONITOR", name: "Sense Monitoring" },
  { hsId: "1579422987", zuperUid: "ad5c0309-eb6", category: "SERVICE", brand: "SVC", model: "EV-CIRCUIT-INSTALL", name: "EV Circuit Installation" },
  { hsId: "2400618135", zuperUid: "5ec83bfa-04a", category: "PROJECT_MILESTONES", brand: "SVC", model: "SOLAR-INSTALL", name: "Solar Install" },
];

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  // First, get full Zuper UIDs (we only have truncated ones above)
  // Load all Zuper products and match by HS ID
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

  const zuperByHsId = new Map<string, string>();
  const zuperByNormName = new Map<string, string>();
  for (const zp of allZuper) {
    const uid = String(zp.product_uid);
    const name = String(zp.product_name || "");
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    zuperByNormName.set(norm, uid);

    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const m of meta) {
        if (m.label === "HubSpot Product ID" && m.value) {
          zuperByHsId.set(String(m.value), uid);
        }
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (cfio?.product_hubspot_product_id_1) {
      zuperByHsId.set(String(cfio.product_hubspot_product_id_1), uid);
    }
  }

  let created = 0;
  let skipped = 0;

  for (const p of PRODUCTS) {
    // Resolve full Zuper UID
    let fullZuperUid = zuperByHsId.get(p.hsId);
    if (!fullZuperUid) {
      const norm = p.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      fullZuperUid = zuperByNormName.get(norm);
    }

    if (!fullZuperUid) {
      console.log(`⚠ No Zuper UID found for "${p.name}" (HS:${p.hsId}) — skipping`);
      skipped++;
      continue;
    }

    // Check for existing IP with same category+brand+model
    const existing = await prisma.internalProduct.findFirst({
      where: { category: p.category, brand: p.brand, model: p.model },
    });

    if (existing) {
      console.log(`⚠ IP already exists for [${p.category}] ${p.brand} ${p.model} — id=${existing.id} active=${existing.isActive}`);
      // If it exists but lacks links, update it
      if (!DRY_RUN && (!existing.hubspotProductId || !existing.zuperItemId)) {
        const updates: Record<string, unknown> = {};
        if (!existing.hubspotProductId) updates.hubspotProductId = p.hsId;
        if (!existing.zuperItemId) updates.zuperItemId = fullZuperUid;
        if (!existing.isActive) updates.isActive = true;
        if (Object.keys(updates).length > 0) {
          await prisma.internalProduct.update({ where: { id: existing.id }, data: updates });
          console.log(`  ✓ Updated links: ${Object.keys(updates).join(", ")}`);
        }
      }
      skipped++;
      continue;
    }

    console.log(`[${p.category}] ${p.brand} ${p.model} — "${p.name}"`);
    console.log(`  HS:${p.hsId} Zuper:${fullZuperUid}`);

    if (!DRY_RUN) {
      await prisma.internalProduct.create({
        data: {
          category: p.category,
          brand: p.brand,
          model: p.model,
          name: p.name,
          hubspotProductId: p.hsId,
          zuperItemId: fullZuperUid,
          isActive: true,
        },
      });
      console.log(`  ✓ Created`);
    }
    created++;
  }

  console.log(`\n${DRY_RUN ? "Would create" : "Created"}: ${created}`);
  if (skipped) console.log(`Skipped/updated: ${skipped}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
