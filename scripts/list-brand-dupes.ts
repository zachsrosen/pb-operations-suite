/**
 * List all brand casing duplicate IPs that need merging.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const BRAND_FIX: Record<string, string> = {
  "HYUNDAI": "Hyundai", "IRONRIDGE": "IronRidge", "EATON": "Eaton",
};

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const allIPs = await prisma.internalProduct.findMany({
    select: {
      id: true, category: true, brand: true, model: true, name: true, isActive: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
      createdAt: true,
    },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  // Find pairs
  const byKey = new Map<string, typeof allIPs>();
  for (const ip of allIPs) {
    const key = `${ip.category}|${ip.model}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(ip);
  }

  console.log("BRAND CASING DUPLICATES TO MERGE\n");

  for (const [key, ips] of byKey) {
    if (ips.length < 2) continue;
    // Check if any pair involves a brand fix
    const wrongBrand = ips.filter(ip => BRAND_FIX[ip.brand]);
    const rightBrand = ips.filter(ip => !BRAND_FIX[ip.brand]);
    if (wrongBrand.length === 0 || rightBrand.length === 0) continue;

    console.log(`── ${key} ──`);
    for (const ip of ips) {
      const tag = BRAND_FIX[ip.brand] ? "WRONG" : "KEEP ";
      const active = ip.isActive ? "active" : "INACTIVE";
      console.log(`  ${tag} [${active}] brand="${ip.brand}" name="${ip.name || ""}" id=${ip.id}`);
      console.log(`        zoho=${ip.zohoItemId || "none"} hs=${ip.hubspotProductId || "none"} zuper=${ip.zuperItemId || "none"} created=${ip.createdAt.toISOString().split("T")[0]}`);
    }
    console.log();
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
