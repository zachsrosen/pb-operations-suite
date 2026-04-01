import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // 1. Fix ATH-01-M1 — wrong Zoho ID
  await prisma.internalProduct.update({
    where: { id: "b8bf4708-c4b2-437b-a3b5-0cb5b2b40a4a" },
    data: { zohoItemId: "5385454000005802485" },
  });
  console.log("✓ Fixed ATH-01-M1 Zoho ID → 5385454000005802485");

  // 2. Fix 1.25" PVC 90 — wrong Zoho ID
  const pvc90 = await prisma.internalProduct.findFirst({
    where: { brand: "Generic", model: '1-1/4" 90D PVC ELBOW', isActive: true },
  });
  if (pvc90) {
    await prisma.internalProduct.update({
      where: { id: pvc90.id },
      data: { zohoItemId: "5385454000001869038" },
    });
    console.log("✓ Fixed PVC 90 Zoho ID → 5385454000001869038");
  }

  // 3. Create Hyundai 440W — first check if it exists in Zoho
  const allZoho = await zohoInventory.listItems();
  const hyundaiMatches = allZoho.filter(z =>
    z.name.toLowerCase().includes("hyundai") ||
    (z.sku && z.sku.toLowerCase().includes("hin-t440"))
  );
  console.log("\nHyundai Zoho matches:", hyundaiMatches.map(z => `${z.item_id}: ${z.name} (SKU: ${z.sku})`));

  if (hyundaiMatches.length > 0) {
    // Use the first match
    const hz = hyundaiMatches[0];
    await prisma.internalProduct.create({
      data: {
        category: "MODULE",
        brand: "Hyundai",
        model: "HiN-T440NF(BK)",
        name: "Hyundai Solar HiN-T440NF(BK)",
        sku: "HYU HIN-T440NF(BK)",
        zohoItemId: hz.item_id,
        isActive: true,
      },
    });
    console.log(`✓ Created Hyundai HiN-T440NF(BK) with Zoho ID ${hz.item_id}`);
  } else {
    // Create in Zoho first
    console.log("No Hyundai in Zoho — creating...");
    const result = await zohoInventory.upsertItem({
      brand: "Hyundai",
      model: "HiN-T440NF(BK)",
      name: "Hyundai Solar HiN-T440NF(BK)",
      sku: "HYU HIN-T440NF(BK)",
      description: "Hyundai 440W Solar Module",
    });
    if (result.item_id) {
      await prisma.internalProduct.create({
        data: {
          category: "MODULE",
          brand: "Hyundai",
          model: "HiN-T440NF(BK)",
          name: "Hyundai Solar HiN-T440NF(BK)",
          sku: "HYU HIN-T440NF(BK)",
          zohoItemId: result.item_id,
          isActive: true,
        },
      });
      console.log(`✓ Created Hyundai in Zoho (${result.item_id}) and InternalProduct`);
    }
  }

  // Final count
  const withZoho = await prisma.internalProduct.count({ where: { isActive: true, zohoItemId: { not: null } } });
  const total = await prisma.internalProduct.count({ where: { isActive: true } });
  console.log(`\nActive IPs: ${total}, with Zoho: ${withZoho}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
