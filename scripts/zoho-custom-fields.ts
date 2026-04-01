/**
 * List all Zoho Inventory custom fields for Items to find correct API names.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  // Try the settings/preferences endpoint for custom fields
  try {
    const result = await (zohoInventory as any).request("/settings/preferences");
    console.log("Preferences keys:", Object.keys(result));
  } catch (e) {
    console.log("preferences failed:", (e as Error).message);
  }

  // Try fetching an item that we know had zuper updated (Hyundai)
  try {
    // Hyundai's Zoho item - this was updated successfully earlier
    const hyundaiZoho = "5385454000000102764"; // need to find the actual ID

    // Let's just search items and find one with cf_ fields
    const result = await (zohoInventory as any).request("/items?search_text=Hyundai");
    const items = result.items || [];
    for (const item of items) {
      console.log(`\nItem: ${item.name} (${item.item_id})`);
      for (const [k, v] of Object.entries(item)) {
        if (k.startsWith("cf_") || k.includes("zuper") || k.includes("hubspot")) {
          console.log(`  ${k} = ${JSON.stringify(v)}`);
        }
      }
      if (item.custom_fields?.length) {
        console.log("  custom_fields:");
        for (const cf of item.custom_fields) {
          console.log(`    ${JSON.stringify(cf)}`);
        }
      }
    }
  } catch (e) {
    console.log("search failed:", (e as Error).message);
  }

  // Also try the item fields endpoint
  try {
    const fields = await (zohoInventory as any).request("/settings/fields?entity=item");
    console.log("\n=== Item Custom Fields ===");
    const fieldList = fields.fields || fields.custom_fields || [];
    for (const f of fieldList) {
      if (f.is_custom_field || f.field_name_formatted?.startsWith("cf_")) {
        console.log(`  api_name="${f.field_name_formatted || f.api_name}" label="${f.label || f.field_name}" placeholder="${f.placeholder || ""}" type="${f.data_type || f.type}"`);
      }
    }
  } catch (e) {
    console.log("fields endpoint failed:", (e as Error).message);
  }

  // Try fetching the Hyundai item directly by checking the IP
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const hyundaiIp = await prisma.internalProduct.findFirst({
    where: { brand: "Hyundai", isActive: true },
    select: { zohoItemId: true, zuperItemId: true, name: true },
  });
  console.log(`\nHyundai IP: ${hyundaiIp?.name} zoho=${hyundaiIp?.zohoItemId}`);

  if (hyundaiIp?.zohoItemId) {
    const rawItem = await (zohoInventory as any).request(`/items/${hyundaiIp.zohoItemId}`);
    const item = rawItem.item || rawItem;
    console.log("\nHyundai Zoho item fields:");
    for (const [k, v] of Object.entries(item)) {
      if (k.startsWith("cf_") || k.includes("zuper") || k.includes("hubspot") || k === "custom_fields" || k === "custom_field_hash") {
        console.log(`  ${k} = ${JSON.stringify(v)}`);
      }
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
