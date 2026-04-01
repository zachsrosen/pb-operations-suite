import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  // Check the specific Zoho item
  const item = await zohoInventory.getItemById("5385454000000135735");
  console.log("Zoho item 5385454000000135735:");
  console.log(JSON.stringify(item, null, 2));

  // Also search for S6466 and critter guard separately
  const allItems = await zohoInventory.listItems();

  console.log("\n--- Items matching 'S6466' ---");
  const s6466 = allItems.filter(i =>
    i.name.toLowerCase().includes("s6466") ||
    (i.sku && i.sku.toLowerCase().includes("s6466"))
  );
  for (const i of s6466) {
    console.log(`  ${i.item_id}: "${i.name}" (SKU: ${i.sku})`);
  }

  console.log("\n--- Items matching 'critter guard' ---");
  const cg = allItems.filter(i =>
    i.name.toLowerCase().includes("critter guard") ||
    i.name.toLowerCase().includes("critter")
  );
  for (const i of cg) {
    console.log(`  ${i.item_id}: "${i.name}" (SKU: ${i.sku})`);
  }

  console.log("\n--- Items matching 'solaredge s6' ---");
  const se = allItems.filter(i =>
    i.name.toLowerCase().includes("solaredge s6") ||
    (i.sku && i.sku.toLowerCase().includes("s646"))
  );
  for (const i of se) {
    console.log(`  ${i.item_id}: "${i.name}" (SKU: ${i.sku})`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
