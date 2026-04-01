/**
 * 1. Clear links from inactive HYUNDAI dupe
 * 2. Check Lightspeed brand situation
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // 1. Clear links from inactive HYUNDAI
  const hyundai = await prisma.internalProduct.findUnique({
    where: { id: "cmlx15gf9000x04l5isdxfhxc" },
  });
  console.log("Inactive HYUNDAI:", hyundai?.brand, hyundai?.model, "active:", hyundai?.isActive);
  console.log("  zoho:", hyundai?.zohoItemId, "hs:", hyundai?.hubspotProductId, "zuper:", hyundai?.zuperItemId);

  if (hyundai && !hyundai.isActive) {
    await prisma.internalProduct.update({
      where: { id: hyundai.id },
      data: { zohoItemId: null, hubspotProductId: null, zuperItemId: null },
    });
    console.log("  ✓ Cleared all links from inactive HYUNDAI dupe\n");
  }

  // 2. Check SEG/Lightspeed
  const seg = await prisma.internalProduct.findMany({
    where: { OR: [
      { brand: { contains: "Lightspeed", mode: "insensitive" } },
      { model: { contains: "420", mode: "insensitive" }, category: "MODULE" },
      { model: { contains: "SEG", mode: "insensitive" } },
    ]},
    select: { id: true, brand: true, model: true, name: true, isActive: true },
  });
  console.log("SEG/Lightspeed products:");
  for (const p of seg) {
    console.log(`  [${p.isActive ? "active" : "INACTIVE"}] brand="${p.brand}" model="${p.model}" name="${p.name || ""}"`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
