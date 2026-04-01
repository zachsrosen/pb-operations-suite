/**
 * Fetch raw Zoho item to inspect all fields including custom field API names.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const ZOHO_ITEM_ID = "5385454000000102773";

  // Use the raw request method to get full item response
  const item = await (zohoInventory as any).request(`/items/${ZOHO_ITEM_ID}`);

  // Print ALL keys on the item
  console.log("=== Top-level keys ===");
  const itemObj = item.item || item;
  for (const [key, value] of Object.entries(itemObj)) {
    if (key.startsWith("cf_") || key.includes("zuper") || key.includes("hubspot") || key.includes("custom")) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  // Print custom_fields array if present
  if (itemObj.custom_fields) {
    console.log("\n=== custom_fields array ===");
    for (const cf of itemObj.custom_fields as any[]) {
      console.log(`  api_name="${cf.api_name || cf.customfield_id}" label="${cf.label}" value="${cf.value}" placeholder="${cf.placeholder || ""}"`);
    }
  }

  // Also print all keys starting with "cf"
  console.log("\n=== All cf_ fields ===");
  for (const [key, value] of Object.entries(itemObj)) {
    if (key.startsWith("cf_")) {
      console.log(`  ${key} = ${JSON.stringify(value)}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
