/**
 * For each InternalProduct that has a HubSpot link but no Zuper link,
 * check if a Zuper product exists with that HubSpot product ID.
 *
 * Zuper stores it in:
 *   meta_data[].label === "HubSpot Product ID" → .value
 *   custom_field_internal_object.product_hubspot_product_id_1
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Fetch ALL Zuper products
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

  // Build index: HubSpot product ID → Zuper product
  const zuperByHsId = new Map<string, Record<string, unknown>>();

  for (const zp of allZuperProducts) {
    // Check meta_data array
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const entry of meta) {
        if (entry.label === "HubSpot Product ID" && entry.value) {
          zuperByHsId.set(String(entry.value), zp);
        }
      }
    }

    // Also check custom_field_internal_object
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (cfio?.product_hubspot_product_id_1) {
      zuperByHsId.set(String(cfio.product_hubspot_product_id_1), zp);
    }
  }

  console.log(`Zuper products with HubSpot Product ID: ${zuperByHsId.size}\n`);

  // Find ALL active InternalProducts (not just HS-only)
  const allProducts = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      hubspotProductId: true, zohoItemId: true, zuperItemId: true,
    },
  });

  // Check products with HS link but no Zuper link
  const hsNoZuper = allProducts.filter(p => p.hubspotProductId && !p.zuperItemId);
  console.log(`InternalProducts with HS link but no Zuper link: ${hsNoZuper.length}\n`);

  let foundCount = 0;
  let notFoundCount = 0;
  const backfillable: Array<{ ipId: string; name: string; zuperUid: string; zuperName: string }> = [];

  for (const p of hsNoZuper) {
    const hsId = p.hubspotProductId!;
    const zuperMatch = zuperByHsId.get(hsId);
    const displayName = (p.name || `${p.brand} ${p.model}`).substring(0, 45).padEnd(47);

    if (zuperMatch) {
      foundCount++;
      const zuperUid = String(zuperMatch.product_uid);
      const zuperName = String(zuperMatch.product_name);
      console.log(`  ✓ MATCH: ${displayName} HS:${hsId.substring(0, 15).padEnd(17)} → Zuper: ${zuperUid} (${zuperName})`);
      backfillable.push({ ipId: p.id, name: displayName.trim(), zuperUid, zuperName });
    } else {
      notFoundCount++;
      console.log(`  ✗ NONE:  ${displayName} HS:${hsId}`);
    }
  }

  // Also check: products WITH Zuper link — does the link match what's in Zuper?
  const hsAndZuper = allProducts.filter(p => p.hubspotProductId && p.zuperItemId);
  console.log(`\n--- Already linked (HS + Zuper): ${hsAndZuper.length} ---`);
  let mismatches = 0;
  for (const p of hsAndZuper) {
    const zuperFromHs = zuperByHsId.get(p.hubspotProductId!);
    if (zuperFromHs) {
      const expectedUid = String(zuperFromHs.product_uid);
      if (expectedUid !== p.zuperItemId) {
        mismatches++;
        console.log(`  ⚠ MISMATCH: ${p.brand} ${p.model} — IP.zuperItemId=${p.zuperItemId} but Zuper has uid=${expectedUid} for HS:${p.hubspotProductId}`);
      }
    }
  }
  if (mismatches === 0) console.log("  All existing links match ✓");

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Can backfill zuperItemId from HS match: ${foundCount}`);
  console.log(`  No Zuper product found for HS ID:       ${notFoundCount}`);
  console.log(`  Existing link mismatches:                ${mismatches}`);
  console.log(`${"=".repeat(60)}`);

  // Also: how many Zuper products have an HS ID that doesn't match ANY InternalProduct?
  const allHsIds = new Set(allProducts.filter(p => p.hubspotProductId).map(p => p.hubspotProductId!));
  const orphanZuper: string[] = [];
  for (const [hsId, zp] of zuperByHsId) {
    if (!allHsIds.has(hsId)) {
      orphanZuper.push(`  Zuper "${zp.product_name}" (${zp.product_uid}) has HS:${hsId} — no matching IP`);
    }
  }
  if (orphanZuper.length > 0) {
    console.log(`\nZuper products with HS IDs not in any InternalProduct: ${orphanZuper.length}`);
    for (const o of orphanZuper) console.log(o);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
