import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ips = await prisma.internalProduct.findMany({
    where: { isActive: true, zuperItemId: { not: null }, zohoItemId: null },
    select: { id: true, brand: true, model: true, name: true, category: true,
              hubspotProductId: true, zuperItemId: true },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  console.log(`Active IPs with Zuper but NO Zoho: ${ips.length}\n`);
  for (const ip of ips) {
    const display = ip.name || `${ip.brand} ${ip.model}`;
    console.log(`  [${ip.category}] ${display}`);
    console.log(`    HS: ${ip.hubspotProductId || "none"} | Zuper: ${ip.zuperItemId!.substring(0, 12)}…`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
