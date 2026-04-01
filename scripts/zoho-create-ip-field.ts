/**
 * Create "Internal Product ID" custom field on Zoho Inventory Items
 * using the /settings/customfields endpoint.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  // First list existing item custom fields
  const settings = await (zohoInventory as any).request("/settings/customfields");
  const itemFields = settings.customfields?.item || [];

  console.log(`Existing item custom fields: ${itemFields.length}`);
  for (const f of itemFields) {
    console.log(`  label="${f.label}" api_name="${f.api_name || f.field_name_formatted}" type="${f.data_type}" id=${f.customfield_id || f.field_id}`);
  }

  // Check if Internal Product ID already exists
  const hasIpId = itemFields.some(
    (f: any) =>
      String(f.label || "").toLowerCase().includes("internal product id") ||
      String(f.api_name || "").includes("internal_product_id")
  );

  if (hasIpId) {
    console.log("\n✓ 'Internal Product ID' field already exists!");
    return;
  }

  // Try creating via POST to /settings/customfields
  console.log("\nAttempting to create 'Internal Product ID' field...");

  // Try various formats
  const attempts = [
    {
      label: "entity query param",
      path: "/settings/customfields?entity=item",
      body: { customfield: { label: "Internal Product ID", data_type: "string" } },
    },
    {
      label: "item in body",
      path: "/settings/customfields",
      body: { entity: "item", customfield: { label: "Internal Product ID", data_type: "string" } },
    },
    {
      label: "module_name",
      path: "/settings/customfields",
      body: { module_name: "item", customfield: { label: "Internal Product ID", data_type: "string" } },
    },
  ];

  for (const att of attempts) {
    try {
      console.log(`\n  Trying: ${att.label}`);
      const result = await (zohoInventory as any).requestPost(att.path, att.body);
      console.log(`  ✓ Success: ${JSON.stringify(result).substring(0, 300)}`);
      return;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}`);
    }
  }

  // If direct creation fails, try via the raw token approach
  console.log("\nDirect API creation not supported. Creating manually required.");
  console.log("Go to: Zoho Inventory → Settings → Preferences → Items → Custom Fields → + New Custom Field");
  console.log("Label: Internal Product ID, Type: Text (Single line)");
  console.log("The api_name will auto-generate as cf_internal_product_id");
}

main().catch(e => { console.error(e); process.exit(1); });
