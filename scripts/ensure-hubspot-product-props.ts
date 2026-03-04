/**
 * One-time script to create missing custom properties on HubSpot Products.
 * Safe to re-run — skips properties that already exist.
 *
 * Usage: npx tsx scripts/ensure-hubspot-product-props.ts
 */

import "dotenv/config";

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("HUBSPOT_ACCESS_TOKEN is required");
  process.exit(1);
}

const PROPERTIES = [
  {
    name: "weight",
    label: "Weight (lbs)",
    type: "number",
    fieldType: "number",
    groupName: "productinformation",
    description: "Product weight in pounds",
  },
  {
    name: "vendor_name",
    label: "Vendor Name",
    type: "string",
    fieldType: "text",
    groupName: "productinformation",
    description: "Supplier or vendor name",
  },
  {
    name: "vendor_part_number",
    label: "Vendor Part Number",
    type: "string",
    fieldType: "text",
    groupName: "productinformation",
    description: "Vendor-specific part number or SKU",
  },
  {
    name: "unit_label",
    label: "Unit Label",
    type: "string",
    fieldType: "text",
    groupName: "productinformation",
    description: "Unit of measurement (W, kWh, A, etc.)",
  },
] as const;

async function ensureProperty(prop: (typeof PROPERTIES)[number]) {
  // Check if it already exists
  const checkRes = await fetch(
    `https://api.hubapi.com/crm/v3/properties/products/${prop.name}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );

  if (checkRes.ok) {
    console.log(`  ✓ ${prop.name} — already exists`);
    return;
  }

  if (checkRes.status !== 404) {
    const body = await checkRes.text();
    console.error(`  ✗ ${prop.name} — unexpected check response ${checkRes.status}: ${body}`);
    return;
  }

  // Create the property
  const createRes = await fetch(
    "https://api.hubapi.com/crm/v3/properties/products",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(prop),
    }
  );

  if (createRes.ok) {
    console.log(`  ✓ ${prop.name} — created`);
  } else {
    const body = await createRes.text();
    console.error(`  ✗ ${prop.name} — create failed ${createRes.status}: ${body}`);
  }
}

async function main() {
  console.log("Ensuring HubSpot product custom properties...\n");
  for (const prop of PROPERTIES) {
    await ensureProperty(prop);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
