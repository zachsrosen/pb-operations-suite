/**
 * List all Zoho Inventory custom fields from preferences.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const result = await (zohoInventory as any).request("/settings/preferences");

  // Dump the customfields structure to understand it
  const customfields = result.customfields;
  console.log("customfields type:", typeof customfields);
  console.log("customfields:", JSON.stringify(customfields, null, 2).substring(0, 5000));
}
main().catch(e => { console.error(e); process.exit(1); });
