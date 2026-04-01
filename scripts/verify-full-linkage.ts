/**
 * Verify 1:1:1 linkage: every IP has Zuper, every Zuper-linked IP has Zoho,
 * and check which Zoho items still need cf_zuper_product_id.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
  });

  console.log(`\nActive InternalProducts: ${allIPs.length}`);
  console.log(`  With Zoho link:    ${allIPs.filter(p => p.zohoItemId).length}`);
  console.log(`  With Zuper link:   ${allIPs.filter(p => p.zuperItemId).length}`);
  console.log(`  With HubSpot link: ${allIPs.filter(p => p.hubspotProductId).length}`);
  console.log(`  Zoho + Zuper:      ${allIPs.filter(p => p.zohoItemId && p.zuperItemId).length}`);
  console.log(`  All three:         ${allIPs.filter(p => p.zohoItemId && p.zuperItemId && p.hubspotProductId).length}`);

  // IPs WITHOUT Zuper
  const noZuper = allIPs.filter(p => !p.zuperItemId);
  if (noZuper.length > 0) {
    console.log(`\n--- IPs WITHOUT Zuper link (${noZuper.length}) ---`);
    for (const ip of noZuper) {
      console.log(`  [${ip.category}] ${ip.brand} ${ip.model} — Zoho: ${ip.zohoItemId || "none"} — HS: ${ip.hubspotProductId || "none"}`);
    }
  } else {
    console.log(`\n✓ All IPs have Zuper links`);
  }

  // IPs WITH Zuper but WITHOUT Zoho
  const zuperNoZoho = allIPs.filter(p => p.zuperItemId && !p.zohoItemId);
  if (zuperNoZoho.length > 0) {
    console.log(`\n--- IPs WITH Zuper but WITHOUT Zoho (${zuperNoZoho.length}) ---`);
    for (const ip of zuperNoZoho) {
      console.log(`  [${ip.category}] ${ip.brand} ${ip.model} — Zuper: ${ip.zuperItemId} — HS: ${ip.hubspotProductId || "none"}`);
    }
  } else {
    console.log(`✓ All Zuper-linked IPs also have Zoho links`);
  }

  // IPs WITH Zoho but WITHOUT Zuper
  const zohoNoZuper = allIPs.filter(p => p.zohoItemId && !p.zuperItemId);
  if (zohoNoZuper.length > 0) {
    console.log(`\n--- IPs WITH Zoho but WITHOUT Zuper (${zohoNoZuper.length}) ---`);
    for (const ip of zohoNoZuper) {
      console.log(`  [${ip.category}] ${ip.brand} ${ip.model} — Zoho: ${ip.zohoItemId}`);
    }
  } else {
    console.log(`✓ All Zoho-linked IPs also have Zuper links`);
  }

  // Phase 3 status: how many Zoho items need cf_zuper_product_id set?
  const needsCrossLink = allIPs.filter(p => p.zohoItemId && p.zuperItemId);
  console.log(`\nZoho items that need cf_zuper_product_id set: ${needsCrossLink.length}`);
  console.log(`(Can't verify from API — will retry the batch update when rate limit resets)`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
