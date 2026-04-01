/**
 * Check what custom fields exist on Zoho Inventory Items.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  // Fetch a sample item and inspect its custom_fields
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const sampleIps = await prisma.internalProduct.findMany({
    where: { isActive: true, zohoItemId: { not: null } },
    select: { zohoItemId: true, name: true },
    take: 3,
  });

  for (const ip of sampleIps) {
    const rawItem = await (zohoInventory as any).request(`/items/${ip.zohoItemId}`);
    const item = rawItem.item || rawItem;
    console.log(`\nItem: ${ip.name} (${ip.zohoItemId})`);

    // Show all cf_ fields
    for (const [k, v] of Object.entries(item)) {
      if (k.startsWith("cf_")) {
        console.log(`  ${k} = ${JSON.stringify(v)}`);
      }
    }

    // Show custom_fields array
    if (item.custom_fields?.length) {
      console.log("  custom_fields array:");
      for (const cf of item.custom_fields) {
        console.log(`    ${JSON.stringify(cf)}`);
      }
    } else {
      console.log("  custom_fields: empty or missing");
    }
  }

  // Also try settings endpoints
  for (const path of ["/settings/preferences", "/settings/customfields"]) {
    try {
      const result = await (zohoInventory as any).request(path);
      const keys = Object.keys(result);
      console.log(`\n${path} → keys: ${keys.join(", ")}`);

      // Look for custom field definitions
      if (result.preferences) {
        const prefKeys = Object.keys(result.preferences);
        const cfKeys = prefKeys.filter(k => k.includes("custom") || k.includes("field"));
        console.log(`  preferences custom/field keys: ${cfKeys.join(", ") || "none"}`);
        for (const k of cfKeys) {
          const val = result.preferences[k];
          if (Array.isArray(val)) {
            console.log(`  ${k}: ${val.length} entries`);
            for (const entry of val.slice(0, 5)) {
              console.log(`    ${JSON.stringify(entry)}`);
            }
          }
        }
      }
      if (result.customfields) {
        console.log(`  customfields keys: ${Object.keys(result.customfields).join(", ")}`);
      }
    } catch (e: any) {
      console.log(`\n${path} → failed: ${e.message}`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
