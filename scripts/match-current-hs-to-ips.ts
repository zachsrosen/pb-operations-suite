/**
 * For the ~23 CURRENT/PROBABLY_CURRENT unlinked HS products,
 * find matching IPs by brand+model, SKU, or name — output a clear mapping table.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CURRENT_HS_IDS = [
  // 🟢 CURRENT
  "2883558419",  // Enphase IQ8 Microinverter w/ MC4
  "33136518025", // Tesla 3.8 kW Inverter
  "2650151069",  // QCell Q.TRON 425W BLK
  "2618967612",  // REC 420AA Pure-R
  "30615479836", // REC450AA PURE-RX
  "1579422987",  // EV Circuit Installation (service — skip?)
  "2400618135",  // Solar Install (billing — skip?)
  "1579421249",  // SolarEdge P500
  "2619112468",  // Tesla Powerwall +
  "37042995789", // Tesla UWC | Hardware Only
  // 🟡 PROBABLY_CURRENT
  "2049060932",  // Tesla Powerwall 2.0
  "1591853175",  // SolarEdge 10KW 1PH HD WAVE
  "1591868267",  // SolarEdge 5KW 1PH HD WAVE
  "17133619621", // REC460AA Pure-RX
  "16929724050", // SEG-485-BTB-BG
  "2764680033",  // SIL-410 HC+
  "1579419747",  // Sense Monitoring
  "36757262230", // Surge Protection Device
  "37209297276", // Unirac Custom Racking
  "2670452284",  // Solaredge P1101
  "1591865659",  // SolarEdge P400
  "1591855420",  // SolarEdge P505
  "1591863674",  // Tesla Gateway (354 line items!)
];

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

  // Load all active IPs
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
  });

  // Build lookup indexes
  const ipByNormName = new Map<string, typeof allIPs[0][]>();
  const ipByNormModel = new Map<string, typeof allIPs[0][]>();
  const ipByNormBrandModel = new Map<string, typeof allIPs[0][]>();
  const ipByHsId = new Map<string, typeof allIPs[0]>();

  for (const ip of allIPs) {
    if (ip.hubspotProductId) ipByHsId.set(ip.hubspotProductId, ip);

    const fullName = normalize(ip.name || `${ip.brand} ${ip.model}`);
    if (!ipByNormName.has(fullName)) ipByNormName.set(fullName, []);
    ipByNormName.get(fullName)!.push(ip);

    const normModel = normalize(ip.model);
    if (normModel.length > 3) {
      if (!ipByNormModel.has(normModel)) ipByNormModel.set(normModel, []);
      ipByNormModel.get(normModel)!.push(ip);
    }

    const normBM = normalize(`${ip.brand} ${ip.model}`);
    if (!ipByNormBrandModel.has(normBM)) ipByNormBrandModel.set(normBM, []);
    ipByNormBrandModel.get(normBM)!.push(ip);
  }

  // Fetch the specific HS products
  const hsProducts = new Map<string, { name: string; sku: string; price: string }>();
  for (let i = 0; i < CURRENT_HS_IDS.length; i += 10) {
    const batch = CURRENT_HS_IDS.slice(i, i + 10);
    const url = `https://api.hubapi.com/crm/v3/objects/products/batch/read`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: batch.map(id => ({ id })),
        properties: ["name", "hs_sku", "price"],
      }),
    });
    const data = await res.json() as any;
    for (const r of (data.results || [])) {
      hsProducts.set(String(r.id), {
        name: r.properties?.name || "",
        sku: r.properties?.hs_sku || "",
        price: r.properties?.price || "0",
      });
    }
  }

  // Match each HS product to IP
  console.log("CURRENT HS PRODUCTS → IP MATCHING\n");

  for (const hsId of CURRENT_HS_IDS) {
    const hs = hsProducts.get(hsId);
    if (!hs) { console.log(`HS:${hsId} — NOT FOUND\n`); continue; }

    const normName = normalize(hs.name);
    const normSku = normalize(hs.sku);

    // Check if already linked to an IP
    const existingIP = ipByHsId.get(hsId);
    if (existingIP) {
      const ipDisplay = existingIP.name || `${existingIP.brand} ${existingIP.model}`;
      console.log(`HS:${hsId} "${hs.name}" SKU:${hs.sku}`);
      console.log(`  ✅ ALREADY LINKED → [${existingIP.category}] "${ipDisplay}"`);
      console.log();
      continue;
    }

    // Try matching strategies
    let matchedIp: typeof allIPs[0] | null = null;
    let matchType = "";

    // Strategy 1: SKU exact match to model
    if (!matchedIp && normSku.length > 4) {
      const hits = ipByNormModel.get(normSku);
      if (hits?.length) { matchedIp = hits[0]; matchType = "sku=model"; }
    }

    // Strategy 2: Name exact match
    if (!matchedIp) {
      const hits = ipByNormName.get(normName);
      if (hits?.length) { matchedIp = hits[0]; matchType = "name=name"; }
    }

    // Strategy 3: Name matches brand+model
    if (!matchedIp) {
      const hits = ipByNormBrandModel.get(normName);
      if (hits?.length) { matchedIp = hits[0]; matchType = "name=brand+model"; }
    }

    // Strategy 4: SKU matches brand+model
    if (!matchedIp && normSku.length > 4) {
      const hits = ipByNormBrandModel.get(normSku);
      if (hits?.length) { matchedIp = hits[0]; matchType = "sku=brand+model"; }
    }

    // Strategy 5: HS name/SKU contains IP model (or vice versa)
    if (!matchedIp) {
      for (const [normModel, ips] of ipByNormModel) {
        if (normModel.length >= 6 && normName.includes(normModel)) {
          matchedIp = ips[0]; matchType = `name⊃model(${ips[0].model})`; break;
        }
        if (normModel.length >= 6 && normSku.includes(normModel)) {
          matchedIp = ips[0]; matchType = `sku⊃model(${ips[0].model})`; break;
        }
      }
    }

    // Strategy 6: IP name contains HS name
    if (!matchedIp && normName.length > 6) {
      for (const [ipNormName, ips] of ipByNormName) {
        if (ipNormName.includes(normName) || normName.includes(ipNormName)) {
          matchedIp = ips[0]; matchType = "fuzzy-name"; break;
        }
      }
    }

    console.log(`HS:${hsId} "${hs.name}" SKU:${hs.sku} $${parseFloat(hs.price || "0").toFixed(0)}`);
    if (matchedIp) {
      const ipDisplay = matchedIp.name || `${matchedIp.brand} ${matchedIp.model}`;
      const hasHs = matchedIp.hubspotProductId ? `⚠️ IP already has HS:${matchedIp.hubspotProductId}` : "✅ IP has no HS link";
      console.log(`  → MATCH [${matchedIp.category}] "${ipDisplay}" (${matchType})`);
      console.log(`    ${hasHs}`);
      console.log(`    IP: ${matchedIp.id}`);
    } else {
      console.log(`  ❌ NO IP MATCH — would need new IP`);
    }
    console.log();
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
