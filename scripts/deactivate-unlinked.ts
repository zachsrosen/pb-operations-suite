/**
 * Deactivate InternalProducts with zero external links (no Zoho, HubSpot, or Zuper).
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const all = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { id: true, zohoItemId: true, hubspotProductId: true, zuperItemId: true },
  });

  const noLinks = all.filter(p => !p.zohoItemId && !p.hubspotProductId && !p.zuperItemId);
  console.log(`Active products: ${all.length}`);
  console.log(`With zero links: ${noLinks.length}`);

  if (noLinks.length > 0) {
    const result = await prisma.internalProduct.updateMany({
      where: { id: { in: noLinks.map(p => p.id) } },
      data: { isActive: false },
    });
    console.log(`✓ Deactivated: ${result.count}`);
  } else {
    console.log("Nothing to deactivate");
  }

  const remaining = await prisma.internalProduct.count({ where: { isActive: true } });
  console.log(`Active products remaining: ${remaining}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
