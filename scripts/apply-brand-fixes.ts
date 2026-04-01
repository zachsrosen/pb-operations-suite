/**
 * Apply brand name fixes to InternalProducts.
 * Skips conflicts (where corrected brand+model already exists in ANY IP, active or not).
 * Pass --live to execute, otherwise dry run.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");

const BRAND_FIX: Record<string, string> = {
  "HYUNDAI": "Hyundai",
  "REC SOLAR": "REC",
  "SEG SOLAR": "SEG Solar",
  "TESLA": "Tesla",
  "IRONRIDGE": "IronRidge",
  "Ironridge": "IronRidge",
  "EATON": "Eaton",
  "SIEMENS": "Siemens",
  "SQUARE D": "Square D",
  "ENPHASE": "Enphase",
  "SOLAREDGE": "SolarEdge",
  "AP SMART": "AP Smart",
};

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  // Load ALL IPs (including inactive) to check unique constraint
  const everyIP = await prisma.internalProduct.findMany({
    select: { id: true, category: true, brand: true, model: true, name: true, isActive: true },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  // Build index of ALL existing keys (active + inactive)
  const existingKeys = new Set<string>();
  for (const ip of everyIP) {
    existingKeys.add(`${ip.category}|${ip.brand}|${ip.model}`);
  }

  // Only fix active ones
  const activeIPs = everyIP.filter(ip => ip.isActive);

  let fixed = 0;
  let skipped = 0;
  for (const ip of activeIPs) {
    const correctBrand = BRAND_FIX[ip.brand];
    if (!correctBrand || correctBrand === ip.brand) continue;

    const newKey = `${ip.category}|${correctBrand}|${ip.model}`;
    if (existingKeys.has(newKey)) {
      console.log(`  ⚠ SKIP (conflict): [${ip.category}] "${ip.brand}" → "${correctBrand}" (${ip.model})`);
      skipped++;
      continue;
    }

    const display = `[${ip.category}] "${ip.brand}" → "${correctBrand}" (${ip.model})`;

    if (!DRY_RUN) {
      try {
        await prisma.internalProduct.update({
          where: { id: ip.id },
          data: { brand: correctBrand },
        });
        // Update the key set so subsequent iterations see the new key
        existingKeys.delete(`${ip.category}|${ip.brand}|${ip.model}`);
        existingKeys.add(newKey);
        console.log(`  ✓ Fixed: ${display}`);
        fixed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ Failed: ${display} — ${msg.substring(0, 80)}`);
      }
    } else {
      console.log(`  Would fix: ${display}`);
      fixed++;
    }
  }

  console.log(`\n${DRY_RUN ? "Would fix" : "Fixed"}: ${fixed} brand names`);
  if (skipped) console.log(`Skipped ${skipped} conflicts (need merge)`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
