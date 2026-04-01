import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";
import { ZohoInventoryClient } from "../src/lib/zoho-inventory.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const zoho = new ZohoInventoryClient();

async function main() {
  const runs = await prisma.bomPipelineRun.findMany({
    where: { zohoSoId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, dealId: true, zohoSoNumber: true, zohoSoId: true, createdAt: true },
  });

  console.log(`Found ${runs.length} SOs created by the pipeline\n`);

  for (const run of runs) {
    console.log(`--- SO ${run.zohoSoNumber} (deal ${run.dealId}, ${run.createdAt.toISOString().slice(0, 10)}) ---`);
    try {
      const so = await zoho.getSalesOrder(run.zohoSoNumber || run.zohoSoId!);
      if (!so) {
        console.log("  (SO not found in Zoho)\n");
        continue;
      }
      const lineItems = (so as any).line_items || [];
      const hugItems = lineItems.filter(
        (li: any) => /hug|halo.*ultra/i.test(li.name || "") || /hug|2101151|QM-HUG/i.test(li.sku || "")
      );
      if (hugItems.length === 0) {
        console.log("  No HUG/Halo items on this SO\n");
      } else {
        for (const li of hugItems) {
          console.log(`  -> ${li.name} | SKU: ${li.sku} | Qty: ${li.quantity} | Item ID: ${li.item_id}`);
        }
        console.log();
      }
    } catch (e: any) {
      console.log(`  Error fetching SO: ${e.message}\n`);
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
