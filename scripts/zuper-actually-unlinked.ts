/**
 * Find Zuper products that are ACTUALLY active (return 200 on single fetch)
 * and not linked to any IP.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Get all IP-linked Zuper IDs
  const ips = await prisma.internalProduct.findMany({
    where: { isActive: true, zuperItemId: { not: null } },
    select: { zuperItemId: true },
  });
  const linkedZuperIds = new Set(ips.map(ip => ip.zuperItemId!));

  // Fetch all Zuper products from list endpoint
  let allZuper: any[] = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as any;
    const batch = d.data || [];
    allZuper.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  const unlinked = allZuper.filter(z => !linkedZuperIds.has(z.product_uid));
  console.log(`List endpoint total: ${allZuper.length}`);
  console.log(`Unlinked from list: ${unlinked.length}`);

  // Now verify each unlinked product is actually accessible
  console.log(`\nVerifying each unlinked product via single-fetch...\n`);

  let alive = 0;
  let dead = 0;
  const liveProducts: Array<{ uid: string; name: string; hsId: string | null }> = [];

  for (const zp of unlinked) {
    const r = await fetch(`${ZUPER_API_URL}/product/${zp.product_uid}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });

    if (r.status === 200) {
      alive++;
      let hsId: string | null = null;
      const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(meta)) {
        for (const m of meta) {
          if (m.label === "HubSpot Product ID" && m.value) hsId = String(m.value);
        }
      }
      const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
      if (!hsId && cfio?.product_hubspot_product_id_1) hsId = String(cfio.product_hubspot_product_id_1);

      liveProducts.push({ uid: zp.product_uid, name: zp.product_name, hsId });
    } else {
      dead++;
    }
  }

  console.log(`Actually alive: ${alive}`);
  console.log(`Dead (404/archived): ${dead}\n`);

  if (liveProducts.length > 0) {
    console.log("=== LIVE unlinked Zuper products ===");
    for (const p of liveProducts.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${p.name}${p.hsId ? ` (HS: ${p.hsId})` : ""}`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
