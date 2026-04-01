import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  console.log("Testing single Zoho update...");
  const start = Date.now();
  try {
    const result = await zohoInventory.updateItem("5385454000000135710", {
      cf_zuper_product_id: "ae831e96-5d1d-4d4a-b3be-8a481333b1c1",
    });
    console.log(`✓ ${result.status} in ${Date.now() - start}ms — ${result.message}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✗ Failed in ${Date.now() - start}ms — ${msg}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
