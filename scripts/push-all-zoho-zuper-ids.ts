/**
 * Set cf_zuper_product_id on ALL Zoho items that have both Zoho + Zuper links.
 * 3s delay between calls to avoid Zoho rate limiting.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ips = await prisma.internalProduct.findMany({
    where: { isActive: true, zohoItemId: { not: null }, zuperItemId: { not: null } },
    select: { id: true, brand: true, model: true, zohoItemId: true, zuperItemId: true },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });

  console.log(`Pushing cf_zuper_product_id to ${ips.length} Zoho items (3s delay each)…`);
  console.log(`Estimated time: ~${Math.ceil(ips.length * 3 / 60)} minutes\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < ips.length; i++) {
    const ip = ips[i];
    const label = `[${i + 1}/${ips.length}] ${ip.brand} ${ip.model}`;

    try {
      await zohoInventory.updateItem(ip.zohoItemId!, {
        cf_zuper_product_id: ip.zuperItemId!,
      });
      success++;
      if ((i + 1) % 25 === 0 || i === ips.length - 1) {
        console.log(`${label} — ✓ (${success} ok, ${failed} fail)`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`${label} — ✗ ${msg.substring(0, 80)}`);

      // If rate limited, wait longer
      if (msg.includes("429") || msg.includes("rate") || msg.includes("Rate")) {
        console.log("  Rate limited — waiting 30s…");
        await new Promise(r => setTimeout(r, 30000));
      }
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n✓ Done: ${success} updated, ${failed} failed out of ${ips.length}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
