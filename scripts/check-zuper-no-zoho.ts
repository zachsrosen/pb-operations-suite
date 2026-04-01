import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // IPs with Zuper but no Zoho
  const zuperNoZoho = await prisma.internalProduct.findMany({
    where: { isActive: true, zuperItemId: { not: null }, zohoItemId: null },
    select: { id: true, category: true, brand: true, model: true, name: true, zuperItemId: true, hubspotProductId: true },
  });
  console.log(`IPs with Zuper but no Zoho (${zuperNoZoho.length}):`);
  for (const ip of zuperNoZoho) {
    console.log(`  [${ip.category}] ${ip.brand} ${ip.model} — Zuper: ${ip.zuperItemId} — HS: ${ip.hubspotProductId || "none"}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
