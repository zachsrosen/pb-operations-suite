/**
 * Create "Internal Product ID" custom field on Zoho Inventory Items.
 * Zoho's custom field creation API for Inventory:
 *   POST /settings/fields?entity=item
 *   Body: { field: { label: "...", data_type: "string" } }
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const refreshToken = process.env.ZOHO_INVENTORY_REFRESH_TOKEN!;
  const clientId = process.env.ZOHO_INVENTORY_CLIENT_ID!;
  const clientSecret = process.env.ZOHO_INVENTORY_CLIENT_SECRET!;
  const orgId = process.env.ZOHO_INVENTORY_ORG_ID!;

  // Get access token
  const tokenRes = await fetch(
    `https://accounts.zoho.com/oauth/v2/token?refresh_token=${refreshToken}&client_id=${clientId}&client_secret=${clientSecret}&grant_type=refresh_token`,
    { method: "POST" }
  );
  const tokenData = await tokenRes.json() as any;
  const accessToken = tokenData.access_token;

  const headers = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    "Content-Type": "application/json",
  };

  // First, check what fields exist
  console.log("Checking existing custom fields...\n");
  const prefsRes = await fetch(
    `https://www.zohoapis.com/inventory/v1/settings/preferences?organization_id=${orgId}`,
    { headers }
  );
  const prefs = await prefsRes.json() as any;
  const existingFields = prefs?.preferences?.customfield_items || prefs?.preferences?.custom_fields?.item || [];
  console.log(`Found ${Array.isArray(existingFields) ? existingFields.length : 0} existing fields:`);
  if (Array.isArray(existingFields)) {
    for (const f of existingFields) {
      console.log(`  - ${f.label || f.field_name} (api: ${f.api_name || f.customfield_id}, type: ${f.data_type})`);
    }
  }

  // Check if already exists
  const hasIpId = Array.isArray(existingFields) && existingFields.some(
    (f: any) => String(f.api_name || "").includes("internal_product_id") || String(f.label || "").toLowerCase().includes("internal product id")
  );
  if (hasIpId) {
    console.log("\n✓ 'Internal Product ID' field already exists!");
    return;
  }

  // Try different body formats
  const attempts = [
    {
      label: "label format",
      body: JSON.stringify({ field: { label: "Internal Product ID", data_type: "string" } }),
    },
    {
      label: "customfield format",
      body: JSON.stringify({ customfield: { label: "Internal Product ID", data_type: "string" } }),
    },
    {
      label: "flat format",
      body: JSON.stringify({ label: "Internal Product ID", data_type: "string" }),
    },
    {
      label: "field_name format",
      body: JSON.stringify({ field: { field_name: "Internal Product ID", data_type: "text" } }),
    },
    {
      label: "JSONString format",
      body: `JSONString=${encodeURIComponent(JSON.stringify({ field: { label: "Internal Product ID", data_type: "string" } }))}`,
    },
  ];

  const endpoints = [
    `/settings/fields?entity=item&organization_id=${orgId}`,
    `/settings/customfields?entity=item&organization_id=${orgId}`,
  ];

  for (const ep of endpoints) {
    for (const att of attempts) {
      const url = `https://www.zohoapis.com/inventory/v1${ep}`;
      const contentType = att.label === "JSONString format"
        ? "application/x-www-form-urlencoded"
        : "application/json";

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { ...headers, "Content-Type": contentType },
          body: att.body,
        });
        const data = await res.text();
        console.log(`\n${ep} [${att.label}]: ${res.status}`);
        console.log(`  ${data.substring(0, 200)}`);
        if (res.ok) {
          console.log("  ✓ SUCCESS!");
          return;
        }
      } catch (e) {
        console.log(`\n${ep} [${att.label}]: Error - ${e}`);
      }
    }
  }

  console.log("\n\n⚠ Could not create field via API. Please create manually:");
  console.log("  Zoho Inventory → Settings → Preferences → Items → Custom Fields → + New Custom Field");
  console.log("  Label: Internal Product ID, Type: Text");
}

main().catch(e => { console.error(e); process.exit(1); });
