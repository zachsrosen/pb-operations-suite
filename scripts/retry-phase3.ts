/**
 * Retry Phase 3: Set cf_zuper_product_id on Zoho items that still need it.
 * Slower rate to avoid 429s.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // Get all IPs with both Zoho + Zuper links
  const linkedIPs = await prisma.internalProduct.findMany({
    where: {
      isActive: true,
      zohoItemId: { not: null },
      zuperItemId: { not: null },
    },
    select: { id: true, zohoItemId: true, zuperItemId: true, brand: true, model: true },
  });

  console.log(`IPs with both Zoho + Zuper: ${linkedIPs.length}`);

  // We'll just update all of them — idempotent, and we don't know which ones failed
  let updated = 0;
  let errors = 0;

  for (const ip of linkedIPs) {
    try {
      const result = await zohoInventory.updateItem(ip.zohoItemId!, {
        cf_zuper_product_id: ip.zuperItemId!,
      });

      if (result.status === "updated") {
        updated++;
      } else {
        errors++;
        console.log(`  ✗ ${ip.brand} ${ip.model}: ${result.message}`);
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${ip.brand} ${ip.model}: ${msg.substring(0, 80)}`);
    }

    // Slow down: 2 per second max
    await new Promise(r => setTimeout(r, 600));

    if (updated % 20 === 0 && updated > 0) {
      console.log(`  ... updated ${updated}/${linkedIPs.length}`);
    }
  }

  console.log(`\nDone: ${updated} updated, ${errors} errors out of ${linkedIPs.length}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
