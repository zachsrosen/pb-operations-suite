import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // All IPs with both Zoho + Zuper
  const ips = await prisma.internalProduct.findMany({
    where: { isActive: true, zohoItemId: { not: null }, zuperItemId: { not: null } },
    select: { id: true, brand: true, model: true, zohoItemId: true, zuperItemId: true },
  });

  console.log(`IPs with both Zoho + Zuper links: ${ips.length}`);

  // Spot-check a few Zoho items to see if cf_zuper_product_id is set
  const sampleSize = Math.min(5, ips.length);
  console.log(`\nSpot-checking ${sampleSize} Zoho items...`);
  
  let needsUpdate = 0;
  let alreadySet = 0;
  let errors = 0;

  for (let i = 0; i < sampleSize; i++) {
    const ip = ips[i];
    try {
      const item = await zohoInventory.getItemById(ip.zohoItemId!);
      const cfZuper = (item as any)?.cf_zuper_product_id || (item as any)?.custom_fields?.find?.((f: any) => f.label === "cf_zuper_product_id")?.value || null;
      
      // Check all custom fields
      let foundValue: string | null = null;
      if (item && typeof item === 'object') {
        const raw = item as Record<string, unknown>;
        if (raw.cf_zuper_product_id) foundValue = String(raw.cf_zuper_product_id);
        if (raw.custom_fields && Array.isArray(raw.custom_fields)) {
          for (const cf of raw.custom_fields as Array<Record<string, unknown>>) {
            if (cf.label === 'cf_zuper_product_id' || cf.api_name === 'cf_zuper_product_id') {
              foundValue = String(cf.value || '');
            }
          }
        }
      }
      
      const matches = foundValue === ip.zuperItemId;
      console.log(`  ${ip.brand} ${ip.model}: cf_zuper=${foundValue?.substring(0, 20) || "empty"} | IP zuper=${ip.zuperItemId!.substring(0, 20)} | ${matches ? "✓" : "MISMATCH"}`);
      if (matches) alreadySet++; else needsUpdate++;
      
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.log(`  ${ip.brand} ${ip.model}: ERROR - ${err instanceof Error ? err.message : String(err)}`);
      errors++;
    }
  }

  console.log(`\nSpot-check: ${alreadySet} set, ${needsUpdate} need update, ${errors} errors`);
  console.log(`\nTotal IPs to push: ${ips.length} (all with Zoho+Zuper)`);
  console.log(`Previously pushed: ~286 (278 + 8 dupe fixes)`);
  console.log(`Likely already correct, but a full re-push ensures consistency.`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
