/**
 * Check a specific Zoho item and its IP linkage.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const ZOHO_ITEM_ID = "5385454000000102773";

  // Check if any IP links to this Zoho item
  const ip = await prisma.internalProduct.findFirst({
    where: { zohoItemId: ZOHO_ITEM_ID },
    select: { id: true, brand: true, model: true, name: true, isActive: true,
              zohoItemId: true, hubspotProductId: true, zuperItemId: true },
  });

  if (ip) {
    console.log("IP found for Zoho item:");
    console.log(`  [${ip.isActive ? "active" : "INACTIVE"}] ${ip.name || `${ip.brand} ${ip.model}`}`);
    console.log(`  zoho: ${ip.zohoItemId}`);
    console.log(`  hs: ${ip.hubspotProductId || "none"}`);
    console.log(`  zuper: ${ip.zuperItemId || "none"}`);
  } else {
    console.log("⚠ No IP found linking to Zoho item " + ZOHO_ITEM_ID);
  }

  // Also search for PW3 IPs
  const pw3s = await prisma.internalProduct.findMany({
    where: { OR: [
      { model: { contains: "POWERWALL", mode: "insensitive" } },
      { model: { contains: "1707000", mode: "insensitive" } },
      { name: { contains: "Powerwall 3", mode: "insensitive" } },
    ]},
    select: { id: true, brand: true, model: true, name: true, isActive: true,
              zohoItemId: true, hubspotProductId: true, zuperItemId: true },
  });

  console.log(`\nAll Powerwall-related IPs:`);
  for (const p of pw3s) {
    console.log(`  [${p.isActive ? "active" : "INACTIVE"}] ${p.name || `${p.brand} ${p.model}`}`);
    console.log(`    zoho: ${p.zohoItemId || "none"} | hs: ${p.hubspotProductId || "none"} | zuper: ${p.zuperItemId || "none"}`);
  }

  // Fetch the Zoho item directly to see its cf_zuper_product_id
  try {
    const item = await zohoInventory.getItemById(ZOHO_ITEM_ID) as any;
    console.log(`\nZoho item ${ZOHO_ITEM_ID}:`);
    if (!item) {
      console.log(`  ⚠ Item not found in Zoho`);
    } else {
      console.log(`  Name: ${item.name}`);
      console.log(`  SKU: ${item.sku}`);
      console.log(`  cf_zuper_product_id: "${item.cf_zuper_product_id || "NOT SET"}"`);
      // Print all custom fields
      if (item.custom_fields) {
        console.log(`  Custom fields:`);
        for (const cf of item.custom_fields) {
          if (cf.value) console.log(`    ${cf.label}: ${cf.value}`);
        }
      }
    }
  } catch (err) {
    console.log(`\n⚠ Could not fetch Zoho item: ${err instanceof Error ? err.message : err}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
