import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // The 9 HubSpot IDs we plan to link
  const targets = [
    { hsId: "1591853175", label: "SolarEdge 10KW" },
    { hsId: "1591868267", label: "SolarEdge 5KW" },
    { hsId: "1591873858", label: "SolarEdge 6.0KW" },
    { hsId: "37364429609", label: "SolarEdge 7.6KW" },
    { hsId: "37301748641", label: "SE3800H" },
    { hsId: "33136518025", label: "Tesla 3.8 kW Inverter" },
    { hsId: "2708424210", label: "Tesla Gateway V3" },
    { hsId: "2883662226", label: "Qcell 425W TopCon" },
    { hsId: "37363933991", label: "Q Cells 400W" },
  ];

  const hsIds = targets.map(t => t.hsId);

  // Check 1: Are any of these already linked to an IP?
  const alreadyLinked = await prisma.internalProduct.findMany({
    where: { hubspotProductId: { in: hsIds } },
    select: {
      id: true, brand: true, model: true, category: true,
      hubspotProductId: true, isActive: true,
    },
  });

  console.log("=== CHECK 1: Are these HS IDs already linked to any IP? ===");
  if (alreadyLinked.length === 0) {
    console.log("  ✓ All clear — none of these 9 HubSpot IDs are linked to any InternalProduct.\n");
  } else {
    console.log("  ✗ WARNING — found existing links:");
    for (const ip of alreadyLinked) {
      const label = targets.find(t => t.hsId === ip.hubspotProductId)?.label;
      console.log(`    IP: ${ip.id.substring(0, 20)} ${ip.brand} ${ip.model} (active:${ip.isActive}) → HS:${ip.hubspotProductId} (${label})`);
    }
    console.log();
  }

  // Check 2: Do the intended source IPs exist and currently have no HS link?
  console.log("=== CHECK 2: Do target IPs exist and have no existing HS link? ===");
  const targetIPs = [
    { brand: "SolarEdge", model: "SE10000H", hsTarget: "1591853175" },
    { brand: "SolarEdge", model: "SE5000H", hsTarget: "1591868267" },
    { brand: "SolarEdge", model: "SE6000H", hsTarget: "1591873858" },
    { brand: "SolarEdge", model: "SE7600H", hsTarget: "37364429609" },
    { brand: "SolarEdge", model: "SE3800H", hsTarget: "37301748641" },
    { brand: "Tesla", model: "1538000-45-A", hsTarget: "33136518025" },
    { brand: "Tesla", model: "1624171-XX-Y", hsTarget: "2708424210" },
    { brand: "Hanwha", model: "Q.TRON BLK M-G2+ 425", hsTarget: "2883662226" },
    { brand: "Hanwha", model: "Q.PEAK DUO BLK ML-G10+ 400", hsTarget: "37363933991" },
  ];

  for (const t of targetIPs) {
    const matches = await prisma.internalProduct.findMany({
      where: { brand: t.brand, model: t.model, isActive: true },
      select: { id: true, brand: true, model: true, category: true, hubspotProductId: true },
    });

    if (matches.length === 0) {
      console.log(`  ✗ NOT FOUND: ${t.brand} / ${t.model}`);
    } else if (matches.length > 1) {
      console.log(`  ⚠ MULTIPLE: ${t.brand} / ${t.model} — ${matches.length} records found`);
      for (const m of matches) {
        console.log(`    → ${m.id.substring(0, 20)} [${m.category}] HS:${m.hubspotProductId || "null"}`);
      }
    } else {
      const m = matches[0];
      if (m.hubspotProductId) {
        console.log(`  ⚠ ALREADY HAS HS: ${t.brand} / ${t.model} → existing HS:${m.hubspotProductId} (would overwrite with ${t.hsTarget})`);
      } else {
        console.log(`  ✓ OK: ${t.brand} / ${t.model} [${m.category}] — no HS link, safe to assign ${t.hsTarget}`);
      }
    }
  }

  // Check 3: Verify the HS IDs also don't appear on inactive IPs
  console.log("\n=== CHECK 3: Inactive IPs with these HS IDs? ===");
  const inactiveLinked = await prisma.internalProduct.findMany({
    where: { hubspotProductId: { in: hsIds }, isActive: false },
    select: { id: true, brand: true, model: true, hubspotProductId: true },
  });
  if (inactiveLinked.length === 0) {
    console.log("  ✓ None found on inactive IPs either.\n");
  } else {
    console.log(`  ⚠ Found ${inactiveLinked.length} inactive IP(s) with these HS IDs:`);
    for (const ip of inactiveLinked) {
      console.log(`    ${ip.brand} ${ip.model} → HS:${ip.hubspotProductId}`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
