/**
 * Comprehensive gap & duplicate analysis:
 * 1. 257 unlinked HubSpot products — check if any match existing IPs by name/brand/model
 * 2. 85 orphaned Zuper products (have HS ID) — check if duplicates of existing IPs
 * 3. 4 Zuper duplicates that share HS ID with an IP
 * 4. ~116 Zuper products with no HS ID — check if duplicates
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractBrandModel(name: string): { brand: string; model: string } {
  const patterns: Array<[RegExp, string]> = [
    [/\bsilfab\b/i, "Silfab"], [/\bsil[-\s]?\d/i, "Silfab"],
    [/\bsolaredge\b/i, "SolarEdge"], [/\bsoled\b/i, "SolarEdge"],
    [/\benphase\b/i, "Enphase"], [/\benp\b/i, "Enphase"],
    [/\btesla\b/i, "Tesla"], [/\bpowerwall\b/i, "Tesla"],
    [/\brec\s?\d/i, "REC"], [/\brecso\b/i, "REC"],
    [/\bqcell\b/i, "QCells"], [/\bq\.?peak\b/i, "QCells"], [/\bq\.?tron\b/i, "QCells"],
    [/\bironridge\b/i, "IronRidge"], [/\bquickmount\b/i, "IronRidge"],
    [/\bseg[-\s]?\d/i, "SEG Solar"], [/\bseg solar\b/i, "SEG Solar"],
    [/\bjinko\b/i, "Jinko"], [/\blongi\b/i, "Longi"],
    [/\bhyundai\b/i, "Hyundai"], [/\bsma\b/i, "SMA"],
    [/\bsolis\b/i, "Solis"], [/\bsense\b/i, "Sense"],
    [/\bunirac\b/i, "Unirac"], [/\btygo\b/i, "Tigo"],
    [/\baee\b/i, "AEE Solar"], [/\bsolar4america\b/i, "Solar for America"],
    [/\bfronius\b/i, "Fronius"], [/\blg chem\b/i, "LG"],
    [/\bsunpower\b/i, "SunPower"],
  ];

  let brand = "Generic";
  for (const [re, b] of patterns) {
    if (re.test(name)) { brand = b; break; }
  }

  // Try to extract a model-like string
  const model = name
    .replace(/^\[LEGACY.*?\]\s*/i, "")
    .replace(/\(deleted\)/i, "")
    .replace(/\(DO NOT USE\)/i, "")
    .trim();

  return { brand, model };
}

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;
  const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

  // ── Load all IPs ──────────────────────────────────────────────
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true, sku: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
  });

  // Build lookup indexes for duplicate detection
  const ipByHsId = new Map<string, typeof allIPs[0]>();
  const ipByZuperId = new Map<string, typeof allIPs[0]>();
  const ipByNormName = new Map<string, typeof allIPs[0][]>();
  const ipByNormModel = new Map<string, typeof allIPs[0][]>();

  for (const ip of allIPs) {
    if (ip.hubspotProductId) ipByHsId.set(ip.hubspotProductId, ip);
    if (ip.zuperItemId) ipByZuperId.set(ip.zuperItemId, ip);

    const normName = normalize(ip.name || `${ip.brand} ${ip.model}`);
    if (!ipByNormName.has(normName)) ipByNormName.set(normName, []);
    ipByNormName.get(normName)!.push(ip);

    const normModel = normalize(ip.model);
    if (normModel.length > 3) {
      if (!ipByNormModel.has(normModel)) ipByNormModel.set(normModel, []);
      ipByNormModel.get(normModel)!.push(ip);
    }
  }

  // ── Load all Zuper products ───────────────────────────────────
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

  // ── Load all HubSpot products ─────────────────────────────────
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

  // Helper: find IP match for a product name
  function findIpMatch(name: string, sku?: string): { ip: typeof allIPs[0]; matchType: string } | null {
    const norm = normalize(name);

    // Exact normalized name match
    const nameMatch = ipByNormName.get(norm);
    if (nameMatch?.length) return { ip: nameMatch[0], matchType: "exact-name" };

    // SKU-based match
    if (sku) {
      const normSku = normalize(sku);
      if (normSku.length > 3) {
        const skuMatch = ipByNormModel.get(normSku);
        if (skuMatch?.length) return { ip: skuMatch[0], matchType: "sku→model" };
      }
    }

    // Partial model match (name contains IP model or vice versa)
    for (const [normModel, ips] of ipByNormModel) {
      if (normModel.length > 5 && norm.includes(normModel)) {
        return { ip: ips[0], matchType: "name⊃model" };
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION A: UNLINKED HUBSPOT PRODUCTS
  // ═══════════════════════════════════════════════════════════════
  console.log("=".repeat(70));
  console.log("A. HUBSPOT PRODUCTS NOT LINKED TO ANY IP (257)");
  console.log("=".repeat(70));

  const hsLinkedIds = new Set(allIPs.filter(p => p.hubspotProductId).map(p => p.hubspotProductId!));

  type HsItem = { id: string; name: string; sku: string; dupIp: string | null; matchType: string | null };
  const hsEquipment: HsItem[] = [];
  const hsService: HsItem[] = [];
  const hsFees: HsItem[] = [];
  const hsLegacy: HsItem[] = [];

  for (const hp of allHsProducts) {
    const id = String(hp.id);
    if (hsLinkedIds.has(id)) continue;

    const props = hp.properties as Record<string, unknown>;
    const name = String(props?.name || "");
    const sku = String(props?.hs_sku || "");

    const match = findIpMatch(name, sku);
    const item: HsItem = {
      id, name, sku,
      dupIp: match ? `[${match.ip.category}] ${match.ip.brand} ${match.ip.model}` : null,
      matchType: match?.matchType || null,
    };

    // Categorize
    const isLegacy = /\blegacy\b|\bdo not use\b|\bdeleted\b|\btest\b/i.test(name);
    const isSvc = /\bsvc\b|\bservice\b|\blabor\b|\btravel\b|\btruck roll\b|\badmin\b|\bsupport\b|\bswap\b|\brma\b|\bdefective\b|\bmapping\b|\bfuse\b|\bmisc\b|\bhourly\b|\bupgrade modules\b/i.test(name);
    const isFee = /\bfee\b|\binstall\b|\bpermit\b|\bdesign\b|\bdetach\b|\breset\b|\breroof\b|\broof\b|\btile\b|\bsteep\b|\btwo story\b|\btrip\b|\bground mount\b|\btrench\b|\bsub panel\b|\bcustom\b|\bsemi-custom\b|\bcar charger\b|\bdisposal\b|\bequipment removal\b|\bcritter guard\b|\bmain service\b|\badder\b|\bpanel add\b|\bdiscount\b|\bdeposit\b|\brefund\b|\bchange order\b|\bcancellation\b|\blayout\b|\bconstruction\b|\bovernight\b|\bsales tax\b|\brent\b|\bhazardous\b|\bfinal inspection\b|\bess outside\b|\bsolar install\b|\broof final\b|\broof deposit\b|\bpre-?wire\b|\bdc coupled module adder\b/i.test(name);

    if (isLegacy) hsLegacy.push(item);
    else if (isSvc) hsService.push(item);
    else if (isFee) hsFees.push(item);
    else hsEquipment.push(item);
  }

  function printSection(label: string, items: HsItem[]) {
    const dupes = items.filter(i => i.dupIp);
    const unique = items.filter(i => !i.dupIp);
    console.log(`\n--- ${label} (${items.length} total, ${dupes.length} likely dupes, ${unique.length} new) ---`);

    if (dupes.length > 0) {
      console.log(`\n  LIKELY DUPLICATES OF EXISTING IPs:`);
      for (const i of dupes.sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`    HS:${i.id.padEnd(14)} "${i.name.substring(0, 50)}" → ${i.dupIp} (${i.matchType})`);
      }
    }

    if (unique.length > 0) {
      console.log(`\n  NEW (no IP match found):`);
      for (const i of unique.sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`    HS:${i.id.padEnd(14)} "${i.name.substring(0, 55)}" SKU:${i.sku.substring(0, 25)}`);
      }
    }
  }

  printSection("Equipment", hsEquipment);
  printSection("Service Items", hsService);
  printSection("Fees/Adders", hsFees);
  printSection("Legacy/Do-Not-Use/Test", hsLegacy);

  // ═══════════════════════════════════════════════════════════════
  // SECTION B: ORPHANED ZUPER PRODUCTS (have HS ID, no IP link)
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(70)}`);
  console.log("B. ORPHANED ZUPER PRODUCTS — HAVE HS ID, NO IP LINK (85)");
  console.log("=".repeat(70));

  const linkedZuperUids = new Set(allIPs.filter(p => p.zuperItemId).map(p => p.zuperItemId!));

  type ZuperItem = { uid: string; name: string; hsId: string | null; dupIp: string | null; matchType: string | null; ipHsMatch: boolean };
  const zuperOrphansEquip: ZuperItem[] = [];
  const zuperOrphansSvc: ZuperItem[] = [];
  const zuperOrphansFees: ZuperItem[] = [];
  const zuperOrphansLegacy: ZuperItem[] = [];

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

    if (!hsId) continue; // Section C handles no-HS-ID ones

    const name = String(zp.product_name);
    const ipHsMatch = hsId ? ipByHsId.has(hsId) : false;
    const match = findIpMatch(name);

    const item: ZuperItem = {
      uid, name, hsId,
      dupIp: ipHsMatch
        ? `[HS ID match] ${ipByHsId.get(hsId!)!.brand} ${ipByHsId.get(hsId!)!.model}`
        : match ? `[name match] ${match.ip.brand} ${match.ip.model}` : null,
      matchType: ipHsMatch ? "hs-id" : match?.matchType || null,
      ipHsMatch,
    };

    const isLegacy = /\bdo not use\b|\btest\b|\bdeleted\b/i.test(name);
    const isSvc = /\bsvc\b|\bservice\b|\blabor\b|\btravel\b|\btruck roll\b|\bswap\b|\brma\b|\bdefective\b|\bmapping\b|\bmain service\b/i.test(name);
    const isFee = /\bfee\b|\binstall\b|\bpermit\b|\bdesign\b|\bdetach\b|\breset\b|\breroof\b|\broof\b|\btile\b|\bsteep\b|\btwo story\b|\btrip\b|\bground mount\b|\bsub panel\b|\bcustom\b|\bcar charger\b|\bdisposal\b|\bequipment removal\b|\bcritter guard\b|\bovernight\b|\bsales tax\b|\brent\b|\bhazardous\b|\bsolar install\b|\bdiscount\b|\bdeposit\b|\bchange order\b|\blayout\b|\bpanel add\b/i.test(name);

    if (isLegacy) zuperOrphansLegacy.push(item);
    else if (isSvc) zuperOrphansSvc.push(item);
    else if (isFee) zuperOrphansFees.push(item);
    else zuperOrphansEquip.push(item);
  }

  function printZuperSection(label: string, items: ZuperItem[]) {
    const dupes = items.filter(i => i.dupIp);
    const unique = items.filter(i => !i.dupIp);
    console.log(`\n--- ${label} (${items.length} total, ${dupes.length} likely dupes, ${unique.length} unique) ---`);

    if (dupes.length > 0) {
      console.log(`\n  LIKELY DUPLICATES:`);
      for (const i of dupes.sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`    Z:${i.uid.substring(0, 12)}… "${i.name.substring(0, 45)}" → ${i.dupIp}`);
      }
    }
    if (unique.length > 0) {
      console.log(`\n  NO IP MATCH:`);
      for (const i of unique.sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`    Z:${i.uid.substring(0, 12)}… "${i.name.substring(0, 55)}" HS:${i.hsId}`);
      }
    }
  }

  printZuperSection("Equipment", zuperOrphansEquip);
  printZuperSection("Service Items", zuperOrphansSvc);
  printZuperSection("Fees/Adders", zuperOrphansFees);
  printZuperSection("Legacy/Test", zuperOrphansLegacy);

  // ═══════════════════════════════════════════════════════════════
  // SECTION C: ZUPER PRODUCTS WITH NO HS ID AND NO IP LINK (116)
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(70)}`);
  console.log("C. ZUPER PRODUCTS — NO HS ID, NO IP LINK (116)");
  console.log("=".repeat(70));

  const zuperNoHsEquip: ZuperItem[] = [];
  const zuperNoHsSvc: ZuperItem[] = [];
  const zuperNoHsFees: ZuperItem[] = [];
  const zuperNoHsLegacy: ZuperItem[] = [];

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

    if (hsId) continue; // Section B handled these

    const name = String(zp.product_name);
    const match = findIpMatch(name);

    const item: ZuperItem = {
      uid, name, hsId: null,
      dupIp: match ? `${match.ip.brand} ${match.ip.model}` : null,
      matchType: match?.matchType || null,
      ipHsMatch: false,
    };

    const isLegacy = /\bdo not use\b|\btest\b|\bdeleted\b/i.test(name);
    const isSvc = /\bsvc\b|\bservice\b|\blabor\b|\btravel\b|\btruck roll\b|\bswap\b|\brma\b|\bdefective\b|\bmapping\b|\bmain service\b/i.test(name);
    const isFee = /\bfee\b|\binstall\b|\bpermit\b|\bdesign\b|\bdetach\b|\breset\b|\breroof\b|\broof\b|\btile\b|\bsteep\b|\btwo story\b|\btrip\b|\bground mount\b|\bsub panel\b|\bcustom\b|\bcar charger\b|\bdisposal\b|\bequipment removal\b|\bcritter guard\b|\bovernight\b|\bsales tax\b|\brent\b|\bhazardous\b|\bsolar install\b|\bdiscount\b|\bdeposit\b|\bchange order\b|\blayout\b|\bpanel add\b|\bcancellation\b|\bconstruction complete\b|\bev charger\b/i.test(name);

    if (isLegacy) zuperNoHsLegacy.push(item);
    else if (isSvc) zuperNoHsSvc.push(item);
    else if (isFee) zuperNoHsFees.push(item);
    else zuperNoHsEquip.push(item);
  }

  printZuperSection("Equipment", zuperNoHsEquip);
  printZuperSection("Service Items", zuperNoHsSvc);
  printZuperSection("Fees/Adders", zuperNoHsFees);
  printZuperSection("Legacy/Test", zuperNoHsLegacy);

  // ═══════════════════════════════════════════════════════════════
  // SECTION D: SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY");
  console.log("=".repeat(70));

  const allHsUnlinked = [...hsEquipment, ...hsService, ...hsFees, ...hsLegacy];
  const allZuperOrphans = [...zuperOrphansEquip, ...zuperOrphansSvc, ...zuperOrphansFees, ...zuperOrphansLegacy];
  const allZuperNoHs = [...zuperNoHsEquip, ...zuperNoHsSvc, ...zuperNoHsFees, ...zuperNoHsLegacy];

  console.log(`\nActive IPs: ${allIPs.length}`);
  console.log(`\nA. HubSpot unlinked: ${allHsUnlinked.length}`);
  console.log(`   - Likely dupes: ${allHsUnlinked.filter(i => i.dupIp).length}`);
  console.log(`   - New (no match): ${allHsUnlinked.filter(i => !i.dupIp).length}`);
  console.log(`   - Legacy/junk: ${hsLegacy.length}`);

  console.log(`\nB. Zuper orphans (have HS ID): ${allZuperOrphans.length}`);
  console.log(`   - Likely dupes: ${allZuperOrphans.filter(i => i.dupIp).length}`);
  console.log(`   - No match: ${allZuperOrphans.filter(i => !i.dupIp).length}`);

  console.log(`\nC. Zuper no HS ID, no IP: ${allZuperNoHs.length}`);
  console.log(`   - Likely dupes: ${allZuperNoHs.filter(i => i.dupIp).length}`);
  console.log(`   - No match: ${allZuperNoHs.filter(i => !i.dupIp).length}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
