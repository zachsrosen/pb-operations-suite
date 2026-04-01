import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const all = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
  });

  const hasLinks = all.filter(p => p.zohoItemId || p.hubspotProductId || p.zuperItemId);
  const withZoho = hasLinks.filter(p => p.zohoItemId);
  const noZoho = hasLinks.filter(p => !p.zohoItemId);

  console.log(`${hasLinks.length} linked products breakdown:`);
  console.log(`  With Zoho link: ${withZoho.length}`);
  console.log(`  Without Zoho link: ${noZoho.length}`);
  console.log();

  console.log(`=== WITH Zoho link (${withZoho.length}) ===`);
  for (const p of withZoho.sort((a, b) => a.category.localeCompare(b.category))) {
    const hs = p.hubspotProductId ? "H" : "-";
    const zp = p.zuperItemId ? "Z" : "-";
    console.log(`  [${p.category.substring(0, 15).padEnd(15)}] [${hs}${zp}] ${p.brand.padEnd(14)} ${p.model}`);
  }

  console.log();
  console.log(`=== WITHOUT Zoho link (${noZoho.length}) ===`);
  for (const p of noZoho.sort((a, b) => a.category.localeCompare(b.category))) {
    const hs = p.hubspotProductId ? "H" : "-";
    const zp = p.zuperItemId ? "Z" : "-";
    console.log(`  [${p.category.substring(0, 15).padEnd(15)}] [${hs}${zp}] ${p.brand.padEnd(14)} ${p.model}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
