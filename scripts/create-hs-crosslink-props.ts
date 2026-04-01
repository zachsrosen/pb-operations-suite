/**
 * Create zuper_item_id and zoho_item_id properties on HubSpot Products.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

async function createProperty(name: string, label: string, description: string) {
  // Check if exists
  const checkRes = await fetch(
    `https://api.hubapi.com/crm/v3/properties/products/${name}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (checkRes.ok) {
    console.log(`  ✓ ${name} already exists`);
    return;
  }

  const createRes = await fetch(
    "https://api.hubapi.com/crm/v3/properties/products",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        label,
        type: "string",
        fieldType: "text",
        groupName: "productinformation",
        description,
      }),
    }
  );

  if (createRes.ok) {
    console.log(`  ✓ Created ${name}`);
  } else {
    const err = await createRes.text();
    console.log(`  ✗ Failed ${name} (${createRes.status}): ${err.substring(0, 200)}`);
  }
}

async function main() {
  console.log("Creating cross-link properties on HubSpot Products...\n");
  await createProperty("zuper_item_id", "Zuper Item ID", "UUID linking this product to Zuper field service catalog");
  await createProperty("zoho_item_id", "Zoho Item ID", "ID linking this product to Zoho Inventory");
}

main().catch(e => { console.error(e); process.exit(1); });
