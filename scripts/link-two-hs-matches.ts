/**
 * Link 2 confirmed HS matches.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // Tesla 7.6kW Inverter (HS:1591871280) → Tesla 1538000-45-A
  const r1 = await prisma.internalProduct.updateMany({
    where: { brand: "Tesla", model: "1538000-45-A", isActive: true, hubspotProductId: null },
    data: { hubspotProductId: "1591871280" },
  });
  console.log(`✓ Tesla 7.6kW Inverter → Tesla 1538000-45-A: ${r1.count} updated`);

  // Tesla Backup Gateway 3 (HS:2981160977) → Tesla 1841000-X1-Y
  const r2 = await prisma.internalProduct.updateMany({
    where: { brand: "Tesla", model: "1841000-X1-Y", isActive: true, hubspotProductId: null },
    data: { hubspotProductId: "2981160977" },
  });
  console.log(`✓ Tesla Backup Gateway 3 → Tesla 1841000-X1-Y: ${r2.count} updated`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
