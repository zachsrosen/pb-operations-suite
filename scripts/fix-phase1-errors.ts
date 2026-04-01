import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // Check the ATH-01-M1 error
  const ath = await prisma.internalProduct.findMany({
    where: { model: { contains: "ATH" } },
    select: { id: true, category: true, brand: true, model: true, isActive: true, zohoItemId: true },
  });
  console.log("ATH matches:", JSON.stringify(ath, null, 2));

  // Check the 1-1/4 PVC skip
  const pvc = await prisma.internalProduct.findMany({
    where: { brand: "Generic", model: { startsWith: "1-1" } },
    select: { id: true, category: true, brand: true, model: true, isActive: true, zohoItemId: true },
  });
  console.log("\n1-1 matches:", JSON.stringify(pvc, null, 2));

  // How many IPs now have Zoho links?
  const withZoho = await prisma.internalProduct.count({ where: { isActive: true, zohoItemId: { not: null } } });
  const total = await prisma.internalProduct.count({ where: { isActive: true } });
  console.log(`\nActive IPs: ${total}, with Zoho: ${withZoho}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
