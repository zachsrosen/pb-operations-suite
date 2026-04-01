import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Get all IPs that have both Zuper and HubSpot links
  const ips = await prisma.internalProduct.findMany({
    where: { isActive: true, zuperItemId: { not: null }, hubspotProductId: { not: null } },
    select: { brand: true, model: true, name: true, zuperItemId: true, hubspotProductId: true },
  });

  console.log(`IPs with both Zuper + HS: ${ips.length}\n`);

  let hasHsInZuper = 0;
  let missingHsInZuper = 0;
  const missing: string[] = [];

  for (const ip of ips) {
    const r = await fetch(`${ZUPER_API_URL}/product/${ip.zuperItemId}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    if (r.status !== 200) continue;

    const d = await r.json() as any;
    const zp = d.data;

    let hsIdInZuper: string | null = null;
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(meta)) {
      for (const m of meta) {
        if (m.label === "HubSpot Product ID" && m.value) hsIdInZuper = String(m.value);
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (!hsIdInZuper && cfio?.product_hubspot_product_id_1) hsIdInZuper = String(cfio.product_hubspot_product_id_1);

    if (hsIdInZuper) {
      hasHsInZuper++;
    } else {
      missingHsInZuper++;
      missing.push(`${ip.name || `${ip.brand} ${ip.model}`} — Zuper: ${zp.product_name} — expected HS: ${ip.hubspotProductId}`);
    }
  }

  console.log(`Zuper products WITH HS ID:    ${hasHsInZuper}`);
  console.log(`Zuper products MISSING HS ID: ${missingHsInZuper}`);

  if (missing.length > 0) {
    console.log(`\nMissing HS ID in Zuper:`);
    for (const m of missing) console.log(`  ${m}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
