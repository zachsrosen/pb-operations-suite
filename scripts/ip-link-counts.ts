import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const total = await prisma.internalProduct.count({ where: { isActive: true } });
  const hasZoho = await prisma.internalProduct.count({ where: { isActive: true, zohoItemId: { not: null } } });
  const hasZuper = await prisma.internalProduct.count({ where: { isActive: true, zuperItemId: { not: null } } });
  const hasHs = await prisma.internalProduct.count({ where: { isActive: true, hubspotProductId: { not: null } } });
  const hasAll3 = await prisma.internalProduct.count({ where: { isActive: true, zohoItemId: { not: null }, zuperItemId: { not: null }, hubspotProductId: { not: null } } });
  const zohoAndZuper = await prisma.internalProduct.count({ where: { isActive: true, zohoItemId: { not: null }, zuperItemId: { not: null } } });
  const hsAndZuper = await prisma.internalProduct.count({ where: { isActive: true, hubspotProductId: { not: null }, zuperItemId: { not: null } } });
  const noHs = await prisma.internalProduct.count({ where: { isActive: true, hubspotProductId: null } });

  console.log(`Active IPs: ${total}`);
  console.log();
  console.log(`Has Zoho:    ${hasZoho}`);
  console.log(`Has Zuper:   ${hasZuper}`);
  console.log(`Has HubSpot: ${hasHs}`);
  console.log();
  console.log(`Zoho + Zuper:          ${zohoAndZuper}`);
  console.log(`HubSpot + Zuper:       ${hsAndZuper}`);
  console.log(`All 3 (Zoho+Zuper+HS): ${hasAll3}`);
  console.log();
  console.log(`No HubSpot link: ${noHs}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
