import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  // 1. Zuper-linked properties: deal link coverage
  const zuperDeals = await prisma.zuperJobCache.findMany({
    select: { hubspotDealId: true },
    distinct: ["hubspotDealId"],
    where: { hubspotDealId: { not: null } },
  });
  const zuperDealIds = zuperDeals.map((d) => d.hubspotDealId!).filter(Boolean);
  
  const linkedDealIds = await prisma.propertyDealLink.findMany({
    select: { dealId: true },
    distinct: ["dealId"],
    where: { dealId: { in: zuperDealIds } },
  });
  const linkedSet = new Set(linkedDealIds.map((d) => d.dealId));
  const missingDeals = zuperDealIds.filter((id) => !linkedSet.has(id));

  console.log("=== ZUPER DEAL LINK COVERAGE ===");
  console.log(`  Total Zuper deals: ${zuperDealIds.length}`);
  console.log(`  Linked to property: ${linkedSet.size} (${((linkedSet.size / zuperDealIds.length) * 100).toFixed(1)}%)`);
  console.log(`  Missing (no primary contact): ${missingDeals.length} (${((missingDeals.length / zuperDealIds.length) * 100).toFixed(1)}%)`);

  // 2. Zuper-linked properties: rollup accuracy
  const zuperProps = await prisma.$queryRaw<Array<{ id: string; hubspotObjectId: string; associatedDealsCount: number }>>`
    SELECT DISTINCT pc.id, pc."hubspotObjectId", pc."associatedDealsCount"
    FROM "HubSpotPropertyCache" pc
    JOIN "PropertyDealLink" pdl ON pdl."propertyId" = pc.id
    JOIN "ZuperJobCache" zj ON zj."hubspotDealId" = pdl."dealId"
  `;

  let rollupMismatches = 0;
  let rollupCorrect = 0;
  for (const p of zuperProps) {
    const actualLinks = await prisma.propertyDealLink.count({ where: { propertyId: p.id } });
    if (actualLinks !== p.associatedDealsCount) {
      rollupMismatches++;
    } else {
      rollupCorrect++;
    }
  }

  console.log("\n=== ZUPER PROPERTY ROLLUP ACCURACY ===");
  console.log(`  Total Zuper-linked properties: ${zuperProps.length}`);
  console.log(`  Rollups correct: ${rollupCorrect} (${((rollupCorrect / zuperProps.length) * 100).toFixed(1)}%)`);
  console.log(`  Rollups mismatched: ${rollupMismatches} (${((rollupMismatches / zuperProps.length) * 100).toFixed(1)}%)`);

  // 3. Field coverage for Zuper-relevant fields
  const coverage = await prisma.$queryRaw<[{
    total: bigint;
    with_address: bigint;
    with_ahj: bigint;
    with_utility: bigint;
    with_pb_location: bigint;
    with_system_size: bigint;
    with_install_date: bigint;
  }]>`
    SELECT 
      COUNT(DISTINCT pc.id) as total,
      COUNT(DISTINCT CASE WHEN pc."streetAddress" != '' THEN pc.id END) as with_address,
      COUNT(DISTINCT CASE WHEN pc."ahjName" IS NOT NULL AND pc."ahjName" != '' THEN pc.id END) as with_ahj,
      COUNT(DISTINCT CASE WHEN pc."utilityName" IS NOT NULL AND pc."utilityName" != '' THEN pc.id END) as with_utility,
      COUNT(DISTINCT CASE WHEN pc."pbLocation" IS NOT NULL AND pc."pbLocation" != '' THEN pc.id END) as with_pb_location,
      COUNT(DISTINCT CASE WHEN pc."systemSizeKwDc" IS NOT NULL AND pc."systemSizeKwDc" > 0 THEN pc.id END) as with_system_size,
      COUNT(DISTINCT CASE WHEN pc."firstInstallDate" IS NOT NULL THEN pc.id END) as with_install_date
    FROM "HubSpotPropertyCache" pc
    JOIN "PropertyDealLink" pdl ON pdl."propertyId" = pc.id
    JOIN "ZuperJobCache" zj ON zj."hubspotDealId" = pdl."dealId"
  `;
  
  const c = coverage[0];
  const t = Number(c.total);
  const pct = (v: bigint) => `${Number(v)} (${((Number(v) / t) * 100).toFixed(1)}%)`;

  console.log("\n=== ZUPER-RELEVANT FIELD COVERAGE ===");
  console.log(`  Total properties with Zuper jobs: ${t}`);
  console.log(`  Address: ${pct(c.with_address)}`);
  console.log(`  AHJ: ${pct(c.with_ahj)}`);
  console.log(`  Utility: ${pct(c.with_utility)}`);
  console.log(`  PB Location: ${pct(c.with_pb_location)}`);
  console.log(`  System Size (kW): ${pct(c.with_system_size)}`);
  console.log(`  First Install Date: ${pct(c.with_install_date)}`);

  // 4. Shovels enrichment status for Zuper properties
  const shovels = await prisma.$queryRaw<[{
    total: bigint;
    enriched: bigint;
    with_year_built: bigint;
    with_sqft: bigint;
  }]>`
    SELECT 
      COUNT(DISTINCT pc.id) as total,
      COUNT(DISTINCT CASE WHEN pc."shovelsEnrichmentStatus" = 'ENRICHED' THEN pc.id END) as enriched,
      COUNT(DISTINCT CASE WHEN pc."yearBuilt" IS NOT NULL THEN pc.id END) as with_year_built,
      COUNT(DISTINCT CASE WHEN pc."squareFootage" IS NOT NULL THEN pc.id END) as with_sqft
    FROM "HubSpotPropertyCache" pc
    JOIN "PropertyDealLink" pdl ON pdl."propertyId" = pc.id
    JOIN "ZuperJobCache" zj ON zj."hubspotDealId" = pdl."dealId"
  `;
  
  const s = shovels[0];
  console.log("\n=== SHOVELS ENRICHMENT (Zuper properties) ===");
  console.log(`  Enriched: ${pct(s.enriched)}`);
  console.log(`  Year Built: ${pct(s.with_year_built)}`);
  console.log(`  Square Footage: ${pct(s.with_sqft)}`);

  console.log("\n=== VERDICT ===");
  const linkedPct = linkedSet.size / zuperDealIds.length;
  const rollupPct = rollupCorrect / zuperProps.length;
  const addrPct = Number(c.with_address) / t;
  
  if (linkedPct >= 0.90 && rollupPct >= 0.95 && addrPct >= 0.99) {
    console.log("  ✅ READY for Zuper Property sync.");
    if (missingDeals.length > 0) {
      console.log(`  Note: ${missingDeals.length} Zuper deals remain unlinked (no contact, no deal address, no Zuper job address).`);
    }
  } else {
    console.log("  ❌ NOT READY — review gaps above.");
    if (linkedPct < 0.90) console.log(`     Deal link coverage: ${(linkedPct * 100).toFixed(1)}% < 90% threshold`);
    if (rollupPct < 0.95) console.log(`     Rollup accuracy: ${(rollupPct * 100).toFixed(1)}% < 95% threshold`);
    if (addrPct < 0.99) console.log(`     Address coverage: ${(addrPct * 100).toFixed(1)}% < 99% threshold`);
  }

  await prisma.$disconnect();
}
main().catch(console.error);
