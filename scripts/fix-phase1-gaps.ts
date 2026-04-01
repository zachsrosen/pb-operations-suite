import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // 1. Reactivate ATH-01-M1 and set its Zoho link
  const athZohoId = "5385454000000306167"; // from the SO data
  await prisma.internalProduct.update({
    where: { id: "b8bf4708-c4b2-437b-a3b5-0cb5b2b40a4a" },
    data: { isActive: true, zohoItemId: athZohoId },
  });
  console.log("✓ Reactivated IronRidge ATH-01-M1 with Zoho link");

  // 2. Create the second PVC item (1-1/4" PVC 90)
  // The first "1-1" got Zoho 5385454000001869115 (1.25" PVC TA)
  // The second one is 5385454000001840483 (1.25" PVC 90)
  await prisma.internalProduct.create({
    data: {
      category: "ELECTRICAL_BOS",
      brand: "Generic",
      model: "1-1/4\" 90D PVC ELBOW",
      name: "1.25\" PVC 90",
      sku: "1-1/4\" 90D PVC ELBOW",
      zohoItemId: "5385454000001840483",
      isActive: true,
    },
  });
  console.log("✓ Created 1-1/4\" 90D PVC ELBOW with Zoho link");

  const withZoho = await prisma.internalProduct.count({ where: { isActive: true, zohoItemId: { not: null } } });
  const total = await prisma.internalProduct.count({ where: { isActive: true } });
  console.log(`\nActive IPs: ${total}, with Zoho: ${withZoho}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
