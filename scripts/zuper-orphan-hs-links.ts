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

  // Fetch all Zuper products
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

  // Filter to unlinked only
  const unlinked = allZuper.filter(z => !linkedZuperIds.has(z.product_uid));

  let withHs = 0;
  let withoutHs = 0;

  for (const zp of unlinked) {
    let hsId: string | null = null;
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const m of meta) {
        if (m.label === "HubSpot Product ID" && m.value) hsId = String(m.value);
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (!hsId && cfio?.product_hubspot_product_id_1) hsId = String(cfio.product_hubspot_product_id_1);

    if (hsId) {
      withHs++;
    } else {
      withoutHs++;
    }
  }

  console.log(`Unlinked Zuper products: ${unlinked.length}`);
  console.log(`  With HubSpot ID:    ${withHs}`);
  console.log(`  Without HubSpot ID: ${withoutHs}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
