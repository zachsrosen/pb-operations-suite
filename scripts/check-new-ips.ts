import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // These are the 15 IPs created today by create-ips-from-zuper-hs.ts
  // They were created with both HS + Zuper IDs but no Zoho
  const recent = await prisma.internalProduct.findMany({
    where: {
      isActive: true,
      zohoItemId: null,  // The new ones had no Zoho
    },
    select: { id: true, brand: true, model: true, name: true, category: true,
              hubspotProductId: true, zuperItemId: true, zohoItemId: true,
              createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  console.log(`IPs with no Zoho link: ${recent.length}\n`);
  for (const ip of recent) {
    const display = ip.name || `${ip.brand} ${ip.model}`;
    console.log(`${display} [${ip.category}]`);
    console.log(`  HS: ${ip.hubspotProductId || "NONE"}  Zuper: ${ip.zuperItemId || "NONE"}  Zoho: ${ip.zohoItemId || "NONE"}`);
    console.log(`  Created: ${ip.createdAt.toISOString().split("T")[0]}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
