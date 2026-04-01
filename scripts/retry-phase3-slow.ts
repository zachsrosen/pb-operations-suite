/**
 * Retry Phase 3 with 3s delay between Zoho API calls.
 * Only updates items that don't already have cf_zuper_product_id set.
 * Since we can't check cf_zuper_product_id from listItems, we just re-run all 271.
 * Zoho partial updates are idempotent so re-setting the same value is fine.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const linkedIPs = await prisma.internalProduct.findMany({
    where: {
      isActive: true,
      zohoItemId: { not: null },
      zuperItemId: { not: null },
    },
    select: { id: true, zohoItemId: true, zuperItemId: true, brand: true, model: true },
  });

  console.log(`IPs with both Zoho + Zuper: ${linkedIPs.length}`);
  console.log(`Starting with 3s delay between calls...\n`);

  let updated = 0;
  let errors = 0;
  const failures: string[] = [];

  for (let i = 0; i < linkedIPs.length; i++) {
    const ip = linkedIPs[i];

    // 3 second delay between calls
    if (i > 0) await new Promise(r => setTimeout(r, 3000));

    try {
      const result = await zohoInventory.updateItem(ip.zohoItemId!, {
        cf_zuper_product_id: ip.zuperItemId!,
      });

      if (result.status === "updated") {
        updated++;
        if (updated % 25 === 0) {
          console.log(`  ✓ ${updated}/${linkedIPs.length} updated`);
        }
      } else {
        errors++;
        failures.push(`${ip.brand} ${ip.model}: ${result.message}`);
        console.log(`  ✗ ${ip.brand} ${ip.model}: ${result.message}`);
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${ip.brand} ${ip.model}: ${msg.substring(0, 80)}`);
      console.log(`  ✗ ${ip.brand} ${ip.model}: ${msg.substring(0, 80)}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done: ${updated} updated, ${errors} errors out of ${linkedIPs.length}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ${f}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
