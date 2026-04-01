import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  console.log("Testing single Zoho API call...");
  const start = Date.now();
  try {
    // Just try to read an item — cheaper than update
    const item = await zohoInventory.getItemById("5385454000000135710");
    console.log(`✓ Success in ${Date.now() - start}ms — item: ${item?.name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✗ Failed in ${Date.now() - start}ms — ${msg}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
