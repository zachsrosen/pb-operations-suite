/**
 * Create "Internal Product ID" custom field on all 3 external systems:
 *   1. HubSpot Products → "internal_product_id" property
 *   2. Zuper Products   → "internal_product_id" custom field (via meta_data)
 *   3. Zoho Inventory   → "cf_internal_product_id" custom field
 *
 * Safe to re-run — each section checks if the field already exists.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function createHubSpotProperty() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) { console.log("⚠ HUBSPOT_ACCESS_TOKEN not set — skipping HubSpot"); return; }

  console.log("\n── HubSpot: Creating 'internal_product_id' property on Products ──");

  // Check if property already exists
  const checkRes = await fetch(
    "https://api.hubapi.com/crm/v3/properties/products/internal_product_id",
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (checkRes.ok) {
    console.log("  ✓ Property already exists");
    return;
  }

  const createRes = await fetch(
    "https://api.hubapi.com/crm/v3/properties/products",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "internal_product_id",
        label: "Internal Product ID",
        type: "string",
        fieldType: "text",
        groupName: "productinformation",
        description: "UUID linking this product to the PB Operations Suite internal product catalog",
      }),
    }
  );

  if (createRes.ok) {
    const data = await createRes.json();
    console.log(`  ✓ Created property: ${data.name}`);
  } else {
    const err = await createRes.text();
    console.log(`  ✗ Failed (${createRes.status}): ${err.substring(0, 300)}`);
  }
}

async function createZuperCustomField() {
  const apiKey = process.env.ZUPER_API_KEY;
  const baseUrl = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  if (!apiKey) { console.log("⚠ ZUPER_API_KEY not set — skipping Zuper"); return; }

  console.log("\n── Zuper: Creating 'internal_product_id' custom field on Products ──");

  // Check existing custom fields on products
  const listRes = await fetch(`${baseUrl}/custom_field?module=product`, {
    headers: { "x-api-key": apiKey },
  });

  if (listRes.ok) {
    const listData = await listRes.json() as any;
    const fields = listData.data || listData.custom_fields || [];
    const existing = (Array.isArray(fields) ? fields : []).find(
      (f: any) => {
        const key = String(f.label || f.key || f.field_key || "").toLowerCase().replace(/\s+/g, "_");
        return key.includes("internal_product_id");
      }
    );
    if (existing) {
      console.log(`  ✓ Custom field already exists: ${existing.label || existing.key}`);
      return;
    }
  }

  // Try to create the custom field
  const createRes = await fetch(`${baseUrl}/custom_field`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      custom_field: {
        label: "Internal Product ID",
        module: "product",
        data_type: "TEXT",
        mandatory: false,
        default_value: "",
        tooltip: "UUID from PB Operations Suite internal product catalog",
      },
    }),
  });

  if (createRes.ok) {
    const data = await createRes.json() as any;
    console.log(`  ✓ Created custom field`);
    console.log(`    Response: ${JSON.stringify(data).substring(0, 300)}`);
  } else {
    const err = await createRes.text();
    console.log(`  ✗ Create via /custom_field failed (${createRes.status}): ${err.substring(0, 300)}`);

    // Zuper doesn't always expose a custom field creation endpoint.
    // The alternative is to write meta_data directly on a product —
    // Zuper accepts arbitrary meta_data keys.
    console.log("  ℹ Zuper may not support programmatic custom field creation.");
    console.log("  ℹ We can still write 'Internal Product ID' via meta_data on each product.");
    console.log("  ℹ This will create the field implicitly when we backfill.");
  }
}

async function createZohoCustomField() {
  const refreshToken = process.env.ZOHO_INVENTORY_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_INVENTORY_CLIENT_ID;
  const clientSecret = process.env.ZOHO_INVENTORY_CLIENT_SECRET;
  const orgId = process.env.ZOHO_INVENTORY_ORG_ID;

  if (!refreshToken || !clientId || !clientSecret || !orgId) {
    console.log("⚠ Zoho Inventory credentials not complete — skipping Zoho");
    return;
  }

  console.log("\n── Zoho Inventory: Checking for 'cf_internal_product_id' on Items ──");

  // Get access token
  const tokenRes = await fetch(
    `https://accounts.zoho.com/oauth/v2/token?refresh_token=${refreshToken}&client_id=${clientId}&client_secret=${clientSecret}&grant_type=refresh_token`,
    { method: "POST" }
  );
  const tokenData = await tokenRes.json() as any;
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    console.log(`  ✗ Failed to get access token: ${JSON.stringify(tokenData).substring(0, 200)}`);
    return;
  }

  // Check existing custom fields
  const prefsRes = await fetch(
    `https://www.zohoapis.com/inventory/v1/settings/preferences?organization_id=${orgId}`,
    { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
  );

  if (prefsRes.ok) {
    const prefsData = await prefsRes.json() as any;
    const itemFields = prefsData?.preferences?.custom_fields?.item || prefsData?.custom_fields?.item || [];
    const existing = (Array.isArray(itemFields) ? itemFields : []).find(
      (f: any) => String(f.api_name || f.customfield_id || "").includes("internal_product_id")
    );
    if (existing) {
      console.log(`  ✓ Custom field already exists: ${existing.label || existing.api_name}`);
      return;
    }
  }

  // Try to create via settings API
  const createRes = await fetch(
    `https://www.zohoapis.com/inventory/v1/settings/fields?entity=item&organization_id=${orgId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        field: {
          field_name_formatted: "Internal Product ID",
          data_type: "string",
          is_active: true,
        },
      }),
    }
  );

  if (createRes.ok) {
    const data = await createRes.json() as any;
    console.log(`  ✓ Created custom field`);
    console.log(`    Response: ${JSON.stringify(data).substring(0, 300)}`);
  } else {
    const err = await createRes.text();
    console.log(`  ✗ Settings API failed (${createRes.status}): ${err.substring(0, 300)}`);

    // Try alternative endpoint
    const altRes = await fetch(
      `https://www.zohoapis.com/inventory/v1/settings/customfields?organization_id=${orgId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customfield: {
            label: "Internal Product ID",
            data_type: "string",
            entity: "item",
          },
        }),
      }
    );

    if (altRes.ok) {
      const data = await altRes.json() as any;
      console.log(`  ✓ Created via /settings/customfields`);
      console.log(`    Response: ${JSON.stringify(data).substring(0, 300)}`);
    } else {
      const altErr = await altRes.text();
      console.log(`  ✗ Alt endpoint also failed (${altRes.status}): ${altErr.substring(0, 300)}`);
      console.log("  ℹ Zoho Inventory custom fields may need to be created from the admin UI.");
      console.log("  ℹ Go to Settings → Preferences → Items → Custom Fields → + New Custom Field");
      console.log("  ℹ Name: 'Internal Product ID', Type: 'Text', API name should auto-generate as cf_internal_product_id");
    }
  }
}

async function main() {
  console.log("=== Creating 'Internal Product ID' custom fields ===");

  await createHubSpotProperty();
  await createZuperCustomField();
  await createZohoCustomField();

  console.log("\n=== Done ===");
}

main().catch(e => { console.error(e); process.exit(1); });
