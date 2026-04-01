/**
 * Test different approaches to update Zoho custom fields.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const ZOHO_ITEM_ID = "5385454000000102773"; // Powerwall 3
  const ZUPER_ID = "67c0ad65-2314-4e77-a859-abe09f149d71";
  const HS_ID = "2708371836";

  // Approach 1: custom_fields array with api_name
  console.log("=== Approach 1: custom_fields array ===");
  try {
    const result = await (zohoInventory as any).requestPut(
      `/items/${ZOHO_ITEM_ID}`,
      {
        custom_fields: [
          { api_name: "cf_zuper_product_id", value: ZUPER_ID },
          { api_name: "cf_hubspot_product_id", value: HS_ID },
        ],
      },
      { is_partial: "true" },
    );
    console.log("Result:", JSON.stringify(result).substring(0, 500));
  } catch (e) {
    console.log("Failed:", (e as Error).message);
  }

  // Wait a moment for Zoho to process
  await new Promise(r => setTimeout(r, 3000));

  // Verify
  console.log("\n=== Verify ===");
  const rawItem = await (zohoInventory as any).request(`/items/${ZOHO_ITEM_ID}`);
  const item = rawItem.item || rawItem;
  console.log("cf_zuper_product_id:", item.cf_zuper_product_id || "NOT SET");
  console.log("cf_hubspot_product_id:", item.cf_hubspot_product_id || "NOT SET");
  if (item.custom_fields?.length) {
    console.log("custom_fields:");
    for (const cf of item.custom_fields) {
      console.log(`  ${cf.label || cf.api_name}: "${cf.value}"`);
    }
  } else {
    console.log("custom_fields: empty");
  }
}
main().catch(e => { console.error(e); process.exit(1); });
