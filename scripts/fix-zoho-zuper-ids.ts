/**
 * Fix: Push cf_zuper_product_id to Zoho items for all IPs that have both zohoItemId AND zuperItemId.
 * Uses custom_fields array format (required by Zoho Inventory API for custom field updates).
 *
 * Pass --live to execute. Without it, dry-run only.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  // Find all active IPs with both Zoho and Zuper links
  const ips = await prisma.internalProduct.findMany({
    where: {
      isActive: true,
      zohoItemId: { not: null },
      zuperItemId: { not: null },
    },
    select: {
      id: true, brand: true, model: true, name: true,
      zohoItemId: true, zuperItemId: true, hubspotProductId: true,
    },
  });

  console.log(`Found ${ips.length} active IPs with both Zoho + Zuper links\n`);

  let updated = 0;
  let failed = 0;

  for (const ip of ips) {
    const display = ip.name || `${ip.brand} ${ip.model}`;

    try {
      // Build custom_fields array with both Zuper and HubSpot IDs
      const customFields: Array<{ api_name: string; value: string }> = [
        { api_name: "cf_zuper_product_id", value: ip.zuperItemId! },
      ];
      if (ip.hubspotProductId) {
        customFields.push({ api_name: "cf_hubspot_product_id", value: ip.hubspotProductId });
      }

      console.log(`  ${display}: cf_zuper_product_id → ${ip.zuperItemId!.substring(0, 12)}…${ip.hubspotProductId ? ` + cf_hubspot_product_id → ${ip.hubspotProductId}` : ""}`);

      if (!DRY_RUN) {
        const result = await (zohoInventory as any).requestPut(
          `/items/${encodeURIComponent(ip.zohoItemId!)}`,
          { custom_fields: customFields },
          { is_partial: "true" },
        );

        const code = result?.code;
        if (code === 0) {
          console.log(`    ✓ Updated`);
          updated++;
        } else {
          console.log(`    ⚠ Zoho response code ${code}: ${result?.message}`);
          failed++;
        }

        // Zoho rate limit buffer (100 req/min → 1.5s safe)
        await new Promise(r => setTimeout(r, 1500));
      } else {
        updated++;
      }
    } catch (err) {
      console.log(`  ✗ ${display}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  ${DRY_RUN ? "Would update" : "Updated"}: ${updated}`);
  console.log(`  Failed: ${failed}`);

  if (DRY_RUN) console.log("\n*** Pass --live to execute ***");
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
