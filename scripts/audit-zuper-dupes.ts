/**
 * Audit: how many IP-linked Zuper products are duplicates of pre-existing orphan Zuper products?
 * Compares IP-linked Zuper products against unlinked Zuper products by name/HS ID.
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

  // Load all active IPs with Zuper links
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true, zuperItemId: { not: null } },
    select: { id: true, brand: true, model: true, name: true, category: true,
              hubspotProductId: true, zuperItemId: true, zohoItemId: true },
  });
  const linkedZuperUids = new Set(allIPs.map(ip => ip.zuperItemId!));

  // Load ALL Zuper products
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

  console.log(`Total Zuper products: ${allZuper.length}`);
  console.log(`IP-linked Zuper products: ${linkedZuperUids.size}`);
  console.log(`Orphaned Zuper products: ${allZuper.length - [...allZuper].filter(z => linkedZuperUids.has(String(z.product_uid))).length}\n`);

  // Build maps for orphan Zuper products (not linked to any IP)
  const orphans: Array<{ uid: string; name: string; hsId: string | null; normName: string }> = [];
  const linked: Array<{ uid: string; name: string; hsId: string | null; normName: string }> = [];

  for (const zp of allZuper) {
    const uid = String(zp.product_uid);
    const name = String(zp.product_name || "");
    const normName = normalize(name);

    let hsId: string | null = null;
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const m of meta) {
        if (m.label === "HubSpot Product ID" && m.value) hsId = String(m.value);
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (!hsId && cfio?.product_hubspot_product_id_1) hsId = String(cfio.product_hubspot_product_id_1);

    const entry = { uid, name, hsId, normName };
    if (linkedZuperUids.has(uid)) {
      linked.push(entry);
    } else {
      orphans.push(entry);
    }
  }

  // For each IP-linked Zuper product, check if there's an orphan with the same name or HS ID
  const orphanByNormName = new Map<string, typeof orphans[0][]>();
  const orphanByHsId = new Map<string, typeof orphans[0]>();
  for (const o of orphans) {
    if (!orphanByNormName.has(o.normName)) orphanByNormName.set(o.normName, []);
    orphanByNormName.get(o.normName)!.push(o);
    if (o.hsId) orphanByHsId.set(o.hsId, o);
  }

  interface DupeMatch {
    ip: typeof allIPs[0];
    ipZuper: typeof linked[0];
    orphan: typeof orphans[0];
    matchType: string;
  }

  const dupes: DupeMatch[] = [];
  const clean: typeof allIPs = [];

  for (const ip of allIPs) {
    const ipZuper = linked.find(l => l.uid === ip.zuperItemId);
    if (!ipZuper) { clean.push(ip); continue; }

    // Check if orphan exists with same HS ID
    let orphanMatch: typeof orphans[0] | null = null;
    let matchType = "";

    if (ip.hubspotProductId) {
      const byHs = orphanByHsId.get(ip.hubspotProductId);
      if (byHs) { orphanMatch = byHs; matchType = "same-hs-id"; }
    }

    // Check by normalized name
    if (!orphanMatch) {
      const hits = orphanByNormName.get(ipZuper.normName);
      if (hits?.length) { orphanMatch = hits[0]; matchType = "exact-name"; }
    }

    // Check by partial name (IP display name in orphan or vice versa)
    if (!orphanMatch) {
      const ipDisplay = normalize(ip.name || `${ip.brand} ${ip.model}`);
      for (const o of orphans) {
        if (o.normName.length > 6 && ipDisplay.length > 6) {
          if (o.normName.includes(ipDisplay) || ipDisplay.includes(o.normName)) {
            orphanMatch = o;
            matchType = "partial-name";
            break;
          }
        }
      }
    }

    if (orphanMatch) {
      dupes.push({ ip, ipZuper, orphan: orphanMatch, matchType });
    } else {
      clean.push(ip);
    }
  }

  // Report
  console.log("═".repeat(70));
  console.log(`ZUPER DUPLICATE AUDIT`);
  console.log("═".repeat(70));
  console.log(`\nIPs pointing to DUPLICATE Zuper products: ${dupes.length}`);
  console.log(`IPs pointing to clean (no orphan match): ${clean.length}`);
  console.log(`Total orphan Zuper products: ${orphans.length}`);

  if (dupes.length > 0) {
    console.log(`\n── DUPLICATES: IP's Zuper product has matching orphan ──`);
    const byMatch = new Map<string, DupeMatch[]>();
    for (const d of dupes) {
      if (!byMatch.has(d.matchType)) byMatch.set(d.matchType, []);
      byMatch.get(d.matchType)!.push(d);
    }

    for (const [matchType, items] of byMatch) {
      console.log(`\n  Match type: ${matchType} (${items.length})`);
      for (const d of items.sort((a, b) => a.ipZuper.name.localeCompare(b.ipZuper.name))) {
        const ipDisplay = d.ip.name || `${d.ip.brand} ${d.ip.model}`;
        console.log(`    IP: "${ipDisplay}" → Zuper: "${d.ipZuper.name}" (${d.ipZuper.uid.substring(0, 12)}…)`);
        console.log(`      Orphan: "${d.orphan.name}" (${d.orphan.uid.substring(0, 12)}…) HS:${d.orphan.hsId || "none"} [${matchType}]`);
      }
    }
  }

  // Count orphans with vs without HS IDs
  const orphansWithHs = orphans.filter(o => o.hsId);
  const orphansNoHs = orphans.filter(o => !o.hsId);
  console.log(`\n── ORPHAN BREAKDOWN ──`);
  console.log(`  With HS Product ID: ${orphansWithHs.length}`);
  console.log(`  Without HS Product ID: ${orphansNoHs.length}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
