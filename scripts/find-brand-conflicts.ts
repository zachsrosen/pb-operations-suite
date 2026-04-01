/**
 * Find brand fix conflicts due to unique constraint (category, brand, model).
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const BRAND_FIX: Record<string, string> = {
  "HYUNDAI": "Hyundai", "REC SOLAR": "REC", "SEG SOLAR": "SEG Solar",
  "TESLA": "Tesla", "IRONRIDGE": "IronRidge", "Ironridge": "IronRidge",
  "EATON": "Eaton", "SIEMENS": "Siemens", "SQUARE D": "Square D",
  "ENPHASE": "Enphase", "SOLAREDGE": "SolarEdge", "AP SMART": "AP Smart",
};

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { id: true, category: true, brand: true, model: true, name: true,
              zohoItemId: true, hubspotProductId: true, zuperItemId: true },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  const existingKeys = new Set<string>();
  const ipByKey = new Map<string, typeof allIPs[0]>();
  for (const ip of allIPs) {
    const key = `${ip.category}|${ip.brand}|${ip.model}`;
    existingKeys.add(key);
    ipByKey.set(key, ip);
  }

  let conflicts = 0;
  let safe = 0;
  for (const ip of allIPs) {
    const correctBrand = BRAND_FIX[ip.brand];
    if (!correctBrand || correctBrand === ip.brand) continue;

    const newKey = `${ip.category}|${correctBrand}|${ip.model}`;
    if (existingKeys.has(newKey)) {
      conflicts++;
      const existing = ipByKey.get(newKey)!;
      console.log(`CONFLICT: [${ip.category}] "${ip.brand}" → "${correctBrand}" model=${ip.model}`);
      console.log(`  This IP:     ${ip.id} name="${ip.name || ""}" zoho=${ip.zohoItemId || "none"} hs=${ip.hubspotProductId || "none"} zuper=${ip.zuperItemId || "none"}`);
      console.log(`  Existing IP: ${existing.id} name="${existing.name || ""}" zoho=${existing.zohoItemId || "none"} hs=${existing.hubspotProductId || "none"} zuper=${existing.zuperItemId || "none"}`);
      console.log();
    } else {
      safe++;
    }
  }

  console.log(`\nSafe to fix: ${safe}`);
  console.log(`Conflicts: ${conflicts}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
