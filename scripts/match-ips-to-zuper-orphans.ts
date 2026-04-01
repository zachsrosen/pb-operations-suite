/**
 * Compare InternalProducts with orphaned Zuper products that have HubSpot Product IDs.
 * Find matches by: HS Product ID, exact name, normalized name, brand+model.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Load all active IPs
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true, sku: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
  });

  // Build lookup indexes
  const ipByHsId = new Map<string, typeof allIPs[0]>();
  const ipByZuperId = new Map<string, typeof allIPs[0]>();
  const ipByNormName = new Map<string, typeof allIPs[0][]>();
  const ipByNormBrandModel = new Map<string, typeof allIPs[0][]>();

  for (const ip of allIPs) {
    if (ip.hubspotProductId) ipByHsId.set(ip.hubspotProductId, ip);
    if (ip.zuperItemId) ipByZuperId.set(ip.zuperItemId, ip);

    const normName = normalize(ip.name || `${ip.brand} ${ip.model}`);
    if (!ipByNormName.has(normName)) ipByNormName.set(normName, []);
    ipByNormName.get(normName)!.push(ip);

    const normBM = normalize(`${ip.brand} ${ip.model}`);
    if (!ipByNormBrandModel.has(normBM)) ipByNormBrandModel.set(normBM, []);
    ipByNormBrandModel.get(normBM)!.push(ip);
  }

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

  const linkedZuperUids = new Set(allIPs.filter(p => p.zuperItemId).map(p => p.zuperItemId!));

  // Find orphaned Zuper products with HS IDs
  interface OrphanMatch {
    zuperUid: string;
    zuperName: string;
    hsId: string;
    matchedIp: typeof allIPs[0] | null;
    matchType: string;
    ipAlreadyHasZuper: boolean;
  }

  const matches: OrphanMatch[] = [];
  const noMatches: Array<{ zuperUid: string; zuperName: string; hsId: string }> = [];

  for (const zp of allZuper) {
    const uid = String(zp.product_uid);
    if (linkedZuperUids.has(uid)) continue;

    // Extract HS ID
    let hsId: string | null = null;
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const m of meta) {
        if (m.label === "HubSpot Product ID" && m.value) hsId = String(m.value);
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (!hsId && cfio?.product_hubspot_product_id_1) hsId = String(cfio.product_hubspot_product_id_1);

    if (!hsId) continue;

    const name = String(zp.product_name);
    const normName = normalize(name);

    // Match strategy 1: HS Product ID exact match
    let matchedIp = ipByHsId.get(hsId) || null;
    let matchType = matchedIp ? "hs-id-exact" : "";

    // Match strategy 2: exact normalized name
    if (!matchedIp) {
      const nameMatches = ipByNormName.get(normName);
      if (nameMatches?.length) {
        matchedIp = nameMatches[0];
        matchType = "exact-norm-name";
      }
    }

    // Match strategy 3: normalized brand+model
    if (!matchedIp) {
      const bmMatches = ipByNormBrandModel.get(normName);
      if (bmMatches?.length) {
        matchedIp = bmMatches[0];
        matchType = "brand-model";
      }
    }

    // Match strategy 4: IP model contained in Zuper name or vice versa
    if (!matchedIp) {
      for (const [normBM, ips] of ipByNormBrandModel) {
        if (normBM.length > 6 && normName.includes(normBM)) {
          matchedIp = ips[0];
          matchType = "zuper-name⊃ip-bm";
          break;
        }
        if (normName.length > 6 && normBM.includes(normName)) {
          matchedIp = ips[0];
          matchType = "ip-bm⊃zuper-name";
          break;
        }
      }
    }

    if (matchedIp) {
      matches.push({
        zuperUid: uid,
        zuperName: name,
        hsId,
        matchedIp,
        matchType,
        ipAlreadyHasZuper: Boolean(matchedIp.zuperItemId),
      });
    } else {
      noMatches.push({ zuperUid: uid, zuperName: name, hsId });
    }
  }

  // ── Report ──
  console.log("=".repeat(70));
  console.log("ORPHAN ZUPER ↔ IP MATCHING RESULTS");
  console.log("=".repeat(70));
  console.log(`\nTotal orphaned Zuper products with HS ID: ${matches.length + noMatches.length}`);
  console.log(`Matched to an IP: ${matches.length}`);
  console.log(`No IP match found: ${noMatches.length}`);

  // Split matches by whether IP already has a Zuper link
  const canLink = matches.filter(m => !m.ipAlreadyHasZuper);
  const alreadyLinked = matches.filter(m => m.ipAlreadyHasZuper);

  console.log(`\n--- MATCHES: IP has NO Zuper link yet (${canLink.length}) — can link directly ---`);
  for (const m of canLink.sort((a, b) => a.zuperName.localeCompare(b.zuperName))) {
    const ip = m.matchedIp!;
    console.log(`  Zuper: "${m.zuperName}" (${m.zuperUid.substring(0, 12)}…)`);
    console.log(`    → IP: [${ip.category}] ${ip.brand} ${ip.model} (${ip.id.substring(0, 12)}…) | match: ${m.matchType}`);
    console.log(`    HS: ${m.hsId} | IP HS: ${ip.hubspotProductId || "none"}`);
    console.log();
  }

  console.log(`--- MATCHES: IP ALREADY has a different Zuper link (${alreadyLinked.length}) — DUPLICATES ---`);
  for (const m of alreadyLinked.sort((a, b) => a.zuperName.localeCompare(b.zuperName))) {
    const ip = m.matchedIp!;
    console.log(`  Zuper orphan: "${m.zuperName}" (${m.zuperUid.substring(0, 12)}…)`);
    console.log(`    → IP: [${ip.category}] ${ip.brand} ${ip.model} — already linked to Zuper: ${ip.zuperItemId!.substring(0, 12)}…`);
    console.log(`    match: ${m.matchType} | HS: ${m.hsId}`);
    console.log();
  }

  console.log(`--- NO MATCH FOUND (${noMatches.length}) ---`);
  for (const m of noMatches.sort((a, b) => a.zuperName.localeCompare(b.zuperName))) {
    console.log(`  "${m.zuperName}" (${m.zuperUid.substring(0, 12)}…) HS:${m.hsId}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
