/**
 * 1. Silfab SIL-400 HC+ mismatch details
 * 2. 79 orphaned Zuper products (have HS ID, no IP)
 * 3. HubSpot products not linked to any IP
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
  const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

  // ═══════════════════════════════════════════════════════════════
  // #2: SILFAB MISMATCH
  // ═══════════════════════════════════════════════════════════════
  console.log("=".repeat(70));
  console.log("SILFAB SIL-400 HC+ MISMATCH");
  console.log("=".repeat(70));

  const silfab = await prisma.internalProduct.findMany({
    where: { brand: { contains: "Silfab" }, isActive: true },
    select: { id: true, category: true, brand: true, model: true, hubspotProductId: true, zuperItemId: true, zohoItemId: true },
  });
  for (const ip of silfab) {
    console.log(`\nIP: [${ip.category}] ${ip.brand} ${ip.model}`);
    console.log(`  zohoItemId:      ${ip.zohoItemId}`);
    console.log(`  hubspotProductId: ${ip.hubspotProductId}`);
    console.log(`  zuperItemId:      ${ip.zuperItemId}`);

    // Look up this Zuper product
    if (ip.zuperItemId) {
      const zRes = await fetch(`${ZUPER_API_URL}/product/${ip.zuperItemId}`, {
        headers: { "x-api-key": ZUPER_API_KEY },
      });
      if (zRes.ok) {
        const zData = await zRes.json() as Record<string, unknown>;
        const zp = (zData as any).data || zData;
        console.log(`  Zuper product name: ${zp.product_name}`);
        console.log(`  Zuper product_id:   ${zp.product_id}`);
        // Check HS ID in meta_data
        const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(meta)) {
          for (const m of meta) {
            if (m.label === "HubSpot Product ID") {
              console.log(`  Zuper HS Product ID (meta): ${m.value}`);
            }
          }
        }
        const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
        if (cfio?.product_hubspot_product_id_1) {
          console.log(`  Zuper HS Product ID (cfio): ${cfio.product_hubspot_product_id_1}`);
        }
      }
    }

    // Check if HS ID matches a different Zuper product
    if (ip.hubspotProductId) {
      // Search all Zuper products for this HS ID
      let page = 1;
      while (true) {
        const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
          headers: { "x-api-key": ZUPER_API_KEY },
        });
        const d = await r.json() as Record<string, unknown>;
        const batch = (d.data || []) as Array<Record<string, unknown>>;
        if (batch.length === 0) break;
        for (const zp of batch) {
          const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
          let hsId: string | null = null;
          if (Array.isArray(meta)) {
            for (const m of meta) {
              if (m.label === "HubSpot Product ID" && m.value) hsId = String(m.value);
            }
          }
          const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
          if (!hsId && cfio?.product_hubspot_product_id_1) hsId = String(cfio.product_hubspot_product_id_1);

          if (hsId === ip.hubspotProductId) {
            console.log(`  *** Zuper product with matching HS ID: ${zp.product_uid} "${zp.product_name}"`);
            if (String(zp.product_uid) !== ip.zuperItemId) {
              console.log(`  *** MISMATCH: IP links to ${ip.zuperItemId} but HS ID matches ${zp.product_uid}`);
            }
          }
        }
        if (batch.length < 100) break;
        page++;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // #3: ORPHANED ZUPER PRODUCTS
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(70)}`);
  console.log("ORPHANED ZUPER PRODUCTS (have HS ID, no IP link)");
  console.log("=".repeat(70));

  // Get all Zuper products
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

  // Get all IP zuperItemIds
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { zuperItemId: true, hubspotProductId: true },
  });
  const linkedZuperUids = new Set(allIPs.filter(p => p.zuperItemId).map(p => p.zuperItemId!));
  const linkedHsIds = new Set(allIPs.filter(p => p.hubspotProductId).map(p => p.hubspotProductId!));

  // Find orphans — Zuper products not linked to any IP
  const orphans: Array<{ uid: string; name: string; hsId: string | null; hasIpHsMatch: boolean }> = [];
  const unlinkedNoHs: Array<{ uid: string; name: string }> = [];

  for (const zp of allZuper) {
    const uid = String(zp.product_uid);
    if (linkedZuperUids.has(uid)) continue;

    let hsId: string | null = null;
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const m of meta) {
        if (m.label === "HubSpot Product ID" && m.value) hsId = String(m.value);
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (!hsId && cfio?.product_hubspot_product_id_1) hsId = String(cfio.product_hubspot_product_id_1);

    if (hsId) {
      orphans.push({
        uid,
        name: String(zp.product_name),
        hsId,
        hasIpHsMatch: linkedHsIds.has(hsId),
      });
    } else {
      unlinkedNoHs.push({ uid, name: String(zp.product_name) });
    }
  }

  console.log(`\nTotal Zuper products: ${allZuper.length}`);
  console.log(`Linked to IP: ${linkedZuperUids.size}`);
  console.log(`Orphaned (have HS ID): ${orphans.length}`);
  console.log(`Unlinked (no HS ID): ${unlinkedNoHs.length}`);

  // Orphans where the HS ID already matches an IP's hubspotProductId
  const hsOverlap = orphans.filter(o => o.hasIpHsMatch);
  console.log(`\nOrphans where HS ID matches an existing IP: ${hsOverlap.length}`);
  for (const o of hsOverlap) {
    console.log(`  "${o.name}" (${o.uid}) HS:${o.hsId} — IP exists with this HS ID`);
  }

  console.log(`\nOrphans where HS ID does NOT match any IP: ${orphans.length - hsOverlap.length}`);
  for (const o of orphans.filter(o2 => !o2.hasIpHsMatch)) {
    console.log(`  "${o.name}" (${o.uid}) HS:${o.hsId}`);
  }

  console.log(`\nUnlinked Zuper products (no HS ID, no IP): ${unlinkedNoHs.length}`);
  for (const u of unlinkedNoHs) {
    console.log(`  "${u.name}" (${u.uid})`);
  }

  // ═══════════════════════════════════════════════════════════════
  // #4: HUBSPOT PRODUCTS NOT IN ANY IP
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(70)}`);
  console.log("HUBSPOT PRODUCTS NOT LINKED TO ANY IP");
  console.log("=".repeat(70));

  // Fetch all HubSpot products
  let allHsProducts: Array<Record<string, unknown>> = [];
  let after: string | undefined;
  while (true) {
    const url = `https://api.hubapi.com/crm/v3/objects/products?limit=100&properties=name,hs_sku,price${after ? `&after=${after}` : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${HS_TOKEN}` },
    });
    const data = await res.json() as Record<string, unknown>;
    const results = ((data as any).results || []) as Array<Record<string, unknown>>;
    allHsProducts.push(...results);
    const paging = (data as any).paging;
    if (paging?.next?.after) {
      after = paging.next.after;
    } else {
      break;
    }
  }

  console.log(`\nTotal HubSpot products: ${allHsProducts.length}`);

  // Check which HS product IDs are already in IPs
  const ipHsIds = new Set(allIPs.filter(p => p.hubspotProductId).map(p => p.hubspotProductId!));

  const notInIP: Array<{ id: string; name: string; sku: string }> = [];
  for (const hp of allHsProducts) {
    const id = String(hp.id);
    if (!ipHsIds.has(id)) {
      const props = hp.properties as Record<string, unknown>;
      notInIP.push({
        id,
        name: String(props?.name || ""),
        sku: String(props?.hs_sku || ""),
      });
    }
  }

  console.log(`Already linked to IP: ${allHsProducts.length - notInIP.length}`);
  console.log(`NOT linked to any IP: ${notInIP.length}`);

  // Categorize
  const equipment: typeof notInIP = [];
  const services: typeof notInIP = [];
  const other: typeof notInIP = [];

  for (const hp of notInIP) {
    const nl = hp.name.toLowerCase();
    if (/\b(svc|service|labor|travel|truck roll|admin|support|swap|rma|defective|mapping|fuse|misc|hourly|upgrade)\b/i.test(hp.name)) {
      services.push(hp);
    } else if (/\b(fee|install|permit|design|detach|reset|reroof|roof repair|tile|steep|two story|trip|ground mount|trench|sub panel|custom|semi-custom|car charger|disposal|equipment removal|critter guard|main service|adder|panel add|discount|deposit|refund|change order|cancellation|layout|construction|overnight|sales tax|rent|hazardous|final inspection|ess outside)\b/i.test(hp.name)) {
      other.push(hp);
    } else {
      equipment.push(hp);
    }
  }

  console.log(`\n  Equipment: ${equipment.length}`);
  console.log(`  Service items: ${services.length}`);
  console.log(`  Fees/adders/other: ${other.length}`);

  console.log(`\n--- Equipment not in any IP (${equipment.length}) ---`);
  for (const hp of equipment.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${hp.id.padEnd(18)} ${hp.name.substring(0, 55).padEnd(57)} SKU: ${hp.sku.substring(0, 25)}`);
  }

  console.log(`\n--- Service items not in any IP (${services.length}) ---`);
  for (const hp of services.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${hp.id.padEnd(18)} ${hp.name.substring(0, 55).padEnd(57)} SKU: ${hp.sku.substring(0, 25)}`);
  }

  console.log(`\n--- Fees/adders/other not in any IP (${other.length}) ---`);
  for (const hp of other.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${hp.id.padEnd(18)} ${hp.name.substring(0, 55).padEnd(57)} SKU: ${hp.sku.substring(0, 25)}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
