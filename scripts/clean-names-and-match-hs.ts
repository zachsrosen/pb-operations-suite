/**
 * Phase 1: Generate a name cleanup plan for IPs + cross-match with unlinked HS products.
 * Does NOT write anything — just outputs the plan for approval.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Proper brand casing
const BRAND_FIX: Record<string, string> = {
  "HYUNDAI": "Hyundai",
  "REC SOLAR": "REC",
  "SEG SOLAR": "SEG Solar",
  "TESLA": "Tesla",
  "IRONRIDGE": "IronRidge",
  "EATON": "Eaton",
  "SIEMENS": "Siemens",
  "SQUARE D": "Square D",
  "SVC": "SVC", // keep SVC as-is for now, it's a category not a brand
  "ENPHASE": "Enphase",
  "SOLAREDGE": "SolarEdge",
  "SOLED": "SolarEdge",
  "AP SMART": "AP Smart",
};

// Title case helper — capitalize first letter of each word, preserving known acronyms
const PRESERVE_UPPER = new Set([
  "PVC", "AWG", "THHN", "THWN", "SER", "NMD", "UF-B", "MC4", "EMT", "ENT",
  "MLO", "NEMA", "VAC", "kW", "kWh", "AC", "DC", "PV", "BOS", "SQD", "HOM",
  "AFCI", "GFCI", "GE", "ABB", "RSD", "LED", "EV", "CT", "IQ", "MCI",
  "SPD", "NF", "TA", "SCH",
]);

function smartCase(s: string): string {
  // Don't touch strings that are mostly lowercase already or have mixed case
  const upperCount = (s.match(/[A-Z]/g) || []).length;
  const lowerCount = (s.match(/[a-z]/g) || []).length;
  if (lowerCount > upperCount) return s; // already mixed/lowercase, leave it

  // If it's a part number / SKU pattern, leave it
  if (/^[A-Z0-9]{2,}-[A-Z0-9]+/.test(s)) return s;
  if (/^[A-Z]{2,}\d/.test(s)) return s; // "SE3800H", "IQ8A-72-2-US"

  return s; // Don't auto-titlecase, too risky
}

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

  // ── Load IPs ──
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  // ── Part 1: Brand fixes ──
  console.log("=".repeat(70));
  console.log("PART 1: BRAND NAME FIXES");
  console.log("=".repeat(70));

  const brandFixes: Array<{ id: string; old: string; new: string; display: string }> = [];
  for (const ip of allIPs) {
    const upperBrand = ip.brand.toUpperCase();
    if (BRAND_FIX[upperBrand] && BRAND_FIX[upperBrand] !== ip.brand) {
      brandFixes.push({
        id: ip.id,
        old: ip.brand,
        new: BRAND_FIX[upperBrand],
        display: `[${ip.category}] "${ip.brand}" → "${BRAND_FIX[upperBrand]}" (${ip.model})`,
      });
    }
  }
  console.log(`\n${brandFixes.length} brand fixes:`);
  for (const f of brandFixes) {
    console.log(`  ${f.display}`);
  }

  // ── Part 2: Load HS products and cross-match ──
  console.log(`\n${"=".repeat(70)}`);
  console.log("PART 2: HUBSPOT PRODUCT ↔ IP MATCHING");
  console.log("=".repeat(70));

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

  const linkedHsIds = new Set(allIPs.filter(p => p.hubspotProductId).map(p => p.hubspotProductId!));
  const unlinkedHs = allHs.filter(p => !linkedHsIds.has(String(p.id)));

  // Build IP lookup indexes
  const ipByNormName = new Map<string, typeof allIPs[0][]>();
  const ipByNormBrandModel = new Map<string, typeof allIPs[0][]>();
  const ipByNormModel = new Map<string, typeof allIPs[0][]>();

  for (const ip of allIPs) {
    const names = [
      normalize(ip.name || `${ip.brand} ${ip.model}`),
      normalize(`${ip.brand} ${ip.model}`),
    ];
    for (const n of names) {
      if (!ipByNormName.has(n)) ipByNormName.set(n, []);
      ipByNormName.get(n)!.push(ip);
    }

    const normModel = normalize(ip.model);
    if (normModel.length > 4) {
      if (!ipByNormModel.has(normModel)) ipByNormModel.set(normModel, []);
      ipByNormModel.get(normModel)!.push(ip);
    }
  }

  interface HsMatch {
    hsId: string;
    hsName: string;
    hsSku: string;
    ip: typeof allIPs[0];
    matchType: string;
    ipAlreadyHasHs: boolean;
  }

  interface HsNoMatch {
    hsId: string;
    hsName: string;
    hsSku: string;
  }

  const matches: HsMatch[] = [];
  const noMatches: HsNoMatch[] = [];

  for (const hp of unlinkedHs) {
    const hsId = String(hp.id);
    const props = hp.properties as Record<string, unknown>;
    const hsName = String(props?.name || "");
    const hsSku = String(props?.hs_sku || "");
    const normName = normalize(hsName);
    const normSku = normalize(hsSku);

    let matchedIp: typeof allIPs[0] | null = null;
    let matchType = "";

    // Strategy 1: exact normalized name
    const nameHits = ipByNormName.get(normName);
    if (nameHits?.length) {
      matchedIp = nameHits[0];
      matchType = "exact-name";
    }

    // Strategy 2: SKU matches IP model
    if (!matchedIp && normSku.length > 4) {
      const skuHits = ipByNormModel.get(normSku);
      if (skuHits?.length) {
        matchedIp = skuHits[0];
        matchType = "sku→model";
      }
    }

    // Strategy 3: HS name matches IP model
    if (!matchedIp && normName.length > 5) {
      const modelHits = ipByNormModel.get(normName);
      if (modelHits?.length) {
        matchedIp = modelHits[0];
        matchType = "name→model";
      }
    }

    // Strategy 4: HS name contains IP model (or vice versa) — only for longer strings
    if (!matchedIp) {
      for (const [normModel, ips] of ipByNormModel) {
        if (normModel.length >= 8 && normName.includes(normModel)) {
          matchedIp = ips[0];
          matchType = "hs-name⊃ip-model";
          break;
        }
      }
    }

    // Strategy 5: HS SKU contains IP model
    if (!matchedIp && normSku.length > 5) {
      for (const [normModel, ips] of ipByNormModel) {
        if (normModel.length >= 6 && normSku.includes(normModel)) {
          matchedIp = ips[0];
          matchType = "hs-sku⊃ip-model";
          break;
        }
      }
    }

    if (matchedIp) {
      matches.push({
        hsId, hsName, hsSku,
        ip: matchedIp,
        matchType,
        ipAlreadyHasHs: Boolean(matchedIp.hubspotProductId),
      });
    } else {
      noMatches.push({ hsId, hsName, hsSku });
    }
  }

  // ── Print matches ──
  const canLink = matches.filter(m => !m.ipAlreadyHasHs);
  const alreadyLinked = matches.filter(m => m.ipAlreadyHasHs);

  console.log(`\nUnlinked HS products: ${unlinkedHs.length}`);
  console.log(`Matched to an IP: ${matches.length}`);
  console.log(`  Can link (IP has no HS ID): ${canLink.length}`);
  console.log(`  IP already has different HS ID: ${alreadyLinked.length}`);
  console.log(`No match: ${noMatches.length}`);

  if (canLink.length > 0) {
    console.log(`\n--- CAN LINK: IP has no hubspotProductId yet (${canLink.length}) ---`);
    for (const m of canLink.sort((a, b) => a.hsName.localeCompare(b.hsName))) {
      const ipDisplay = m.ip.name || `${m.ip.brand} ${m.ip.model}`;
      console.log(`  HS:${m.hsId.padEnd(14)} "${m.hsName.substring(0, 50)}"`);
      console.log(`    → IP: [${m.ip.category}] "${ipDisplay}" (${m.matchType})`);
    }
  }

  if (alreadyLinked.length > 0) {
    console.log(`\n--- IP ALREADY HAS DIFFERENT HS ID (${alreadyLinked.length}) — possible dupes ---`);
    for (const m of alreadyLinked.sort((a, b) => a.hsName.localeCompare(b.hsName))) {
      const ipDisplay = m.ip.name || `${m.ip.brand} ${m.ip.model}`;
      console.log(`  HS:${m.hsId.padEnd(14)} "${m.hsName.substring(0, 50)}"`);
      console.log(`    → IP: [${m.ip.category}] "${ipDisplay}" already has HS:${m.ip.hubspotProductId} (${m.matchType})`);
    }
  }

  console.log(`\n--- NO MATCH (${noMatches.length}) — would need new IPs ---`);
  for (const m of noMatches.sort((a, b) => a.hsName.localeCompare(b.hsName))) {
    console.log(`  HS:${m.hsId.padEnd(14)} "${m.hsName.substring(0, 55)}" SKU:${m.hsSku.substring(0, 25)}`);
  }

  // ── Summary ──
  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`Brand fixes: ${brandFixes.length}`);
  console.log(`HS products linkable to existing IPs: ${canLink.length}`);
  console.log(`HS products are dupes (IP already has HS): ${alreadyLinked.length}`);
  console.log(`HS products with no IP match: ${noMatches.length}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
