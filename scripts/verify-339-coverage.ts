import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync } from "fs";

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  // Load SO data
  const soData = JSON.parse(readFileSync("scripts/2026-so-items-with-ids.json", "utf-8"));
  const allZohoItems = await zohoInventory.listItems();
  const zohoByName = new Map(allZohoItems.map(z => [z.name, z]));
  const zohoByNameLower = new Map(allZohoItems.map(z => [z.name.toLowerCase().trim(), z]));
  const zohoBySku = new Map(allZohoItems.filter(z => z.sku).map(z => [z.sku!, z]));

  // Get all IPs with Zoho links
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true, zohoItemId: { not: null } },
    select: { id: true, zohoItemId: true, zuperItemId: true },
  });
  const ipByZohoId = new Map(allIPs.map(ip => [ip.zohoItemId!, ip]));

  // Check every SO item
  const uniqueItems = new Map<string, { name: string; sku: string }>();
  for (const so of JSON.parse(readFileSync("scripts/2026-so-review.json", "utf-8")).salesOrders) {
    for (const item of so.items) {
      const key = `${item.name}|||${item.sku}`;
      if (!uniqueItems.has(key)) uniqueItems.set(key, { name: item.name, sku: item.sku });
    }
  }

  let covered = 0;
  let notCovered = 0;
  const gaps: string[] = [];

  for (const [, item] of uniqueItems) {
    // Find Zoho item
    let zohoItem = zohoByName.get(item.name)
      || zohoBySku.get(item.sku)
      || zohoByNameLower.get(item.name.toLowerCase().trim())
      || zohoByName.get(item.sku);

    if (!zohoItem) {
      gaps.push(`NO ZOHO: "${item.name}" (SKU: ${item.sku})`);
      notCovered++;
      continue;
    }

    const ip = ipByZohoId.get(zohoItem.item_id);
    if (!ip) {
      gaps.push(`NO IP: "${item.name}" → Zoho ${zohoItem.item_id} (${zohoItem.name})`);
      notCovered++;
      continue;
    }

    covered++;
  }

  console.log(`Total unique SO items: ${uniqueItems.size}`);
  console.log(`Covered (Zoho + IP): ${covered}`);
  console.log(`NOT covered: ${notCovered}`);

  if (gaps.length > 0) {
    console.log(`\nGaps:`);
    for (const g of gaps) console.log(`  ${g}`);
  } else {
    console.log(`\n✓ All items covered!`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
