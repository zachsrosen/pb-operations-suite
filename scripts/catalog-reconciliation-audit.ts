import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

interface IpRecord {
  id: string;
  category: string;
  brand: string;
  model: string;
  name: string | null;
  sku: string | null;
  vendorPartNumber: string | null;
  unitSpec: number | null;
  unitLabel: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  zohoItemId: string | null;
  isActive: boolean;
}

interface HsProduct {
  id: string;
  name: string;
  hs_sku: string | null;
  description: string | null;
  price: string | null;
}

interface ZuperProduct {
  product_uid: string;
  product_name: string;
  product_sku: string | null;
  product_description: string | null;
  custom_fields?: Array<{ label: string; value: string }>;
  meta_data?: Array<{ label: string; value: string }>;
}

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // ── 1. All active InternalProducts ──
  const allIPs: IpRecord[] = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      sku: true, vendorPartNumber: true, unitSpec: true, unitLabel: true,
      hubspotProductId: true, zuperItemId: true, zohoItemId: true, isActive: true,
    },
  });

  // ── 2. IPs missing HubSpot link ──
  const noHs = allIPs.filter(ip => !ip.hubspotProductId);
  // ── 3. IPs missing Zoho link ──
  const noZoho = allIPs.filter(ip => !ip.zohoItemId);

  // ── 4. Fetch all HubSpot products ──
  const hubspot = await import("../src/lib/hubspot.js");
  const allHsProducts: HsProduct[] = [];
  let after: string | undefined;
  while (true) {
    const res = await (hubspot as any).hubspotClient.crm.products.basicApi.getPage(
      100, after, ["name", "hs_sku", "description", "price"]
    );
    for (const p of (res.results || [])) {
      allHsProducts.push({
        id: p.id,
        name: p.properties?.name || "",
        hs_sku: p.properties?.hs_sku || null,
        description: p.properties?.description || null,
        price: p.properties?.price || null,
      });
    }
    if (res.paging?.next?.after) {
      after = res.paging.next.after;
    } else break;
  }

  // ── 5. Identify HubSpot orphans (not linked to any IP) ──
  const linkedHsIds = new Set(allIPs.map(ip => ip.hubspotProductId).filter(Boolean) as string[]);
  const hsOrphans = allHsProducts.filter(p => !linkedHsIds.has(p.id));

  // ── 6. Fetch all Zuper products ──
  const allZuperProducts: ZuperProduct[] = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as any;
    const batch = d.data || [];
    for (const p of batch) {
      allZuperProducts.push({
        product_uid: p.product_uid,
        product_name: p.product_name || "",
        product_sku: p.product_sku || null,
        product_description: p.product_description || null,
        custom_fields: p.custom_fields,
        meta_data: p.meta_data,
      });
    }
    if (batch.length < 100) break;
    page++;
  }

  // ── 7. Identify Zuper orphans ──
  const linkedZuperIds = new Set(allIPs.map(ip => ip.zuperItemId).filter(Boolean) as string[]);
  const zuperOrphans = allZuperProducts.filter(p => !linkedZuperIds.has(p.product_uid));

  // ── 8. Output Report ──
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║     PRODUCT CATALOG RECONCILIATION AUDIT        ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("═══ SECTION 1: SUMMARY ═══");
  console.log(`Active InternalProducts: ${allIPs.length}`);
  console.log(`  With HubSpot link: ${allIPs.length - noHs.length}`);
  console.log(`  With Zoho link:    ${allIPs.length - noZoho.length}`);
  console.log(`  With Zuper link:   ${allIPs.filter(ip => ip.zuperItemId).length}`);
  console.log(`  Missing HubSpot:   ${noHs.length}`);
  console.log(`  Missing Zoho:      ${noZoho.length}`);
  console.log();
  console.log(`HubSpot Products total: ${allHsProducts.length}`);
  console.log(`  Linked to IP:     ${linkedHsIds.size}`);
  console.log(`  Orphans (no IP):  ${hsOrphans.length}`);
  console.log();
  console.log(`Zuper Products total: ${allZuperProducts.length}`);
  console.log(`  Linked to IP:     ${linkedZuperIds.size}`);
  console.log(`  Orphans (no IP):  ${zuperOrphans.length}`);

  // ── SECTION 2: 20 IPs missing Zoho ──
  console.log("\n═══ SECTION 2: INTERNAL PRODUCTS MISSING ZOHO LINK (${noZoho.length}) ═══");
  for (const ip of noZoho.sort((a, b) => a.category.localeCompare(b.category))) {
    const hs = ip.hubspotProductId ? `HS:${ip.hubspotProductId}` : "HS:—";
    const zp = ip.zuperItemId ? `ZP:${ip.zuperItemId.substring(0, 12)}..` : "ZP:—";
    console.log(`  [${ip.category.padEnd(18)}] ${ip.brand.padEnd(14)} ${ip.model.padEnd(35)} ${hs.padEnd(22)} ${zp}`);
  }

  // ── SECTION 3: IPs missing HubSpot — by category ──
  console.log(`\n═══ SECTION 3: INTERNAL PRODUCTS MISSING HUBSPOT LINK (${noHs.length}) ═══`);
  const byCategory = new Map<string, IpRecord[]>();
  for (const ip of noHs) {
    const cat = ip.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(ip);
  }
  for (const [cat, items] of [...byCategory.entries()].sort()) {
    console.log(`\n  ── ${cat} (${items.length}) ──`);
    for (const ip of items.sort((a, b) => `${a.brand}${a.model}`.localeCompare(`${b.brand}${b.model}`))) {
      console.log(`    ${ip.brand.padEnd(14)} ${ip.model.padEnd(40)} ${(ip.sku || "").padEnd(20)} zoho:${ip.zohoItemId ? "✓" : "—"}`);
    }
  }

  // ── SECTION 4: HubSpot Orphans ──
  console.log(`\n═══ SECTION 4: HUBSPOT ORPHANS — NOT LINKED TO ANY IP (${hsOrphans.length}) ═══`);
  for (const p of hsOrphans.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  [${p.id.padEnd(14)}] ${p.name.padEnd(60)} SKU:${(p.hs_sku || "—").padEnd(20)} Price:${p.price || "—"}`);
  }

  // ── SECTION 5: Zuper Orphans ──
  console.log(`\n═══ SECTION 5: ZUPER ORPHANS — NOT LINKED TO ANY IP (${zuperOrphans.length}) ═══`);
  for (const p of zuperOrphans.sort((a, b) => a.product_name.localeCompare(b.product_name))) {
    const customHsId = (p.custom_fields || []).find(cf => cf.label?.includes("HubSpot"))?.value || "";
    console.log(`  [${p.product_uid.substring(0, 16)}..] ${p.product_name.padEnd(60)} SKU:${(p.product_sku || "—").padEnd(20)} CF-HS:${customHsId || "—"}`);
  }

  // ── SECTION 6: Potential cross-matches (HubSpot orphans that might match IPs missing HubSpot) ──
  console.log(`\n═══ SECTION 6: POTENTIAL MATCHES — HS ORPHANS vs IPs MISSING HUBSPOT ═══`);

  function normalize(s: string): string[] {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(t => t.length >= 2);
  }

  function tokenSimilarity(a: string, b: string): number {
    const tA = new Set(normalize(a));
    const tB = new Set(normalize(b));
    if (tA.size === 0 || tB.size === 0) return 0;
    let overlap = 0;
    for (const t of tA) if (tB.has(t)) overlap++;
    return overlap / Math.max(tA.size, tB.size);
  }

  let matchCount = 0;
  for (const hsOrphan of hsOrphans) {
    const candidates: Array<{ ip: IpRecord; score: number; method: string }> = [];

    for (const ip of noHs) {
      // SKU exact match
      if (hsOrphan.hs_sku && ip.sku && hsOrphan.hs_sku.toLowerCase() === ip.sku.toLowerCase()) {
        candidates.push({ ip, score: 1.0, method: "SKU-exact" });
        continue;
      }
      if (hsOrphan.hs_sku && ip.vendorPartNumber && hsOrphan.hs_sku.toLowerCase() === ip.vendorPartNumber.toLowerCase()) {
        candidates.push({ ip, score: 0.95, method: "SKU-vendorPN" });
        continue;
      }

      // Name vs brand+model token match
      const ipLabel = `${ip.brand} ${ip.model} ${ip.name || ""}`;
      const score = tokenSimilarity(hsOrphan.name, ipLabel);
      if (score >= 0.4) {
        candidates.push({ ip, score, method: "token-similarity" });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      const conf = best.score >= 0.8 ? "HIGH" : best.score >= 0.6 ? "MEDIUM" : "LOW";
      console.log(`  HS[${hsOrphan.id}] "${hsOrphan.name}" (SKU:${hsOrphan.hs_sku || "—"})`);
      console.log(`    → IP[${best.ip.id.substring(0, 16)}..] "${best.ip.brand} ${best.ip.model}" [${best.method}] score=${best.score.toFixed(2)} conf=${conf}`);
      if (candidates.length > 1) {
        console.log(`    (${candidates.length - 1} other candidate(s))`);
      }
      matchCount++;
    }
  }
  console.log(`\n  Total potential matches: ${matchCount} / ${hsOrphans.length} HS orphans`);
  console.log(`  Unmatched HS orphans: ${hsOrphans.length - matchCount}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
