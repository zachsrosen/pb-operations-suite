import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Get all IP-linked external IDs
  const ips = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { hubspotProductId: true, zuperItemId: true },
  });

  const linkedHsIds = new Set(ips.map(ip => ip.hubspotProductId).filter(Boolean) as string[]);
  const linkedZuperIds = new Set(ips.map(ip => ip.zuperItemId).filter(Boolean) as string[]);

  // Count total HubSpot products
  const hubspot = await import("../src/lib/hubspot.js");
  let hsTotal = 0;
  let hsUnlinked = 0;
  let after: string | undefined;
  while (true) {
    const params: Record<string, unknown> = {
      limit: 100,
      properties: ["name", "hs_object_id"],
    };
    if (after) (params as any).after = after;
    const res = await (hubspot as any).hubspotClient.crm.products.basicApi.getPage(100, after, ["name"]);
    const results = res.results || [];
    hsTotal += results.length;
    for (const p of results) {
      const id = p.id;
      if (!linkedHsIds.has(id)) hsUnlinked++;
    }
    if (res.paging?.next?.after) {
      after = res.paging.next.after;
    } else {
      break;
    }
  }

  // Count total Zuper products
  let zuperTotal = 0;
  let zuperUnlinked = 0;
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as any;
    const batch = d.data || [];
    zuperTotal += batch.length;
    for (const p of batch) {
      if (!linkedZuperIds.has(p.product_uid)) zuperUnlinked++;
    }
    if (batch.length < 100) break;
    page++;
  }

  console.log("=== HubSpot Products ===");
  console.log(`  Total:    ${hsTotal}`);
  console.log(`  Linked:   ${linkedHsIds.size}`);
  console.log(`  Unlinked: ${hsUnlinked}`);
  console.log();
  console.log("=== Zuper Products ===");
  console.log(`  Total:    ${zuperTotal}`);
  console.log(`  Linked:   ${linkedZuperIds.size}`);
  console.log(`  Unlinked: ${zuperUnlinked}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
