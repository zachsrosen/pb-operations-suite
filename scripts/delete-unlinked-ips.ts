/**
 * Delete InternalProducts that have ZERO external links (no zoho, no HS, no zuper).
 * Pass --live to execute.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  const unlinked = await prisma.internalProduct.findMany({
    where: {
      zohoItemId: null,
      hubspotProductId: null,
      zuperItemId: null,
    },
    select: { id: true, category: true, brand: true, model: true, name: true, isActive: true },
    orderBy: [{ isActive: "desc" }, { category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  const active = unlinked.filter(ip => ip.isActive);
  const inactive = unlinked.filter(ip => !ip.isActive);

  console.log(`Total IPs with ZERO links: ${unlinked.length}`);
  console.log(`  Active: ${active.length}`);
  console.log(`  Inactive: ${inactive.length}\n`);

  if (active.length > 0) {
    console.log("── ACTIVE (zero links) ──");
    for (const ip of active) {
      const display = ip.name || `${ip.brand} ${ip.model}`;
      console.log(`  [${ip.category}] ${display}`);
    }
    console.log();
  }

  if (inactive.length > 0) {
    console.log("── INACTIVE (zero links) ──");
    for (const ip of inactive) {
      const display = ip.name || `${ip.brand} ${ip.model}`;
      console.log(`  [${ip.category}] ${display}`);
    }
    console.log();
  }

  if (!DRY_RUN && unlinked.length > 0) {
    const result = await prisma.internalProduct.deleteMany({
      where: {
        zohoItemId: null,
        hubspotProductId: null,
        zuperItemId: null,
      },
    });
    console.log(`✓ Deleted ${result.count} unlinked IPs`);
  } else if (DRY_RUN) {
    console.log(`Would delete ${unlinked.length} IPs`);
    console.log("*** Pass --live to execute ***");
  } else {
    console.log("No unlinked IPs to delete.");
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
