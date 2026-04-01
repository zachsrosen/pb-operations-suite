/**
 * Fix remaining brand inconsistencies.
 * Pass --live to execute.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");

const BRAND_FIX: Record<string, string> = {
  "Iron Ridge": "IronRidge",
  "EZ SOLAR": "EZ Solar",
  "UNIRAC": "Unirac",
  "XCEL ENERGY": "Xcel Energy",
  "CutlerHammer": "Cutler-Hammer",
  "PEGASUS": "Pegasus",
  "ABB": "ABB",       // already correct
  "SVC": "SVC",       // leave as-is
};

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  // Load ALL IPs to check unique constraints
  const allIPs = await prisma.internalProduct.findMany({
    select: { id: true, category: true, brand: true, model: true, name: true, isActive: true },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  const existingKeys = new Set<string>();
  for (const ip of allIPs) {
    existingKeys.add(`${ip.category}|${ip.brand}|${ip.model}`);
  }

  const active = allIPs.filter(ip => ip.isActive);
  let fixed = 0;
  let skipped = 0;

  for (const ip of active) {
    const correctBrand = BRAND_FIX[ip.brand];
    if (!correctBrand || correctBrand === ip.brand) continue;

    const newKey = `${ip.category}|${correctBrand}|${ip.model}`;
    if (existingKeys.has(newKey)) {
      console.log(`  ⚠ SKIP (conflict): [${ip.category}] "${ip.brand}" → "${correctBrand}" (${ip.model})`);
      skipped++;
      continue;
    }

    if (!DRY_RUN) {
      try {
        await prisma.internalProduct.update({
          where: { id: ip.id },
          data: { brand: correctBrand },
        });
        existingKeys.delete(`${ip.category}|${ip.brand}|${ip.model}`);
        existingKeys.add(newKey);
        console.log(`  ✓ Fixed: [${ip.category}] "${ip.brand}" → "${correctBrand}" (${ip.model})`);
        fixed++;
      } catch (err) {
        console.log(`  ✗ Failed: "${ip.brand}" → "${correctBrand}" (${ip.model})`);
      }
    } else {
      console.log(`  Would fix: [${ip.category}] "${ip.brand}" → "${correctBrand}" (${ip.model})`);
      fixed++;
    }
  }

  console.log(`\n${DRY_RUN ? "Would fix" : "Fixed"}: ${fixed}`);
  if (skipped) console.log(`Skipped ${skipped} conflicts`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
