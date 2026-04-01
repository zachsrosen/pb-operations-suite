/**
 * Backfill: Write HubSpot Product ID to Zuper products that are missing it.
 * For all IPs with both zuperItemId and hubspotProductId, update the Zuper
 * product's custom field.
 *
 * Pass --live to execute.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  const ips = await prisma.internalProduct.findMany({
    where: { isActive: true, zuperItemId: { not: null }, hubspotProductId: { not: null } },
    select: { brand: true, model: true, name: true, zuperItemId: true, hubspotProductId: true },
  });

  console.log(`IPs with both Zuper + HS: ${ips.length}\n`);

  let updated = 0;
  let alreadySet = 0;
  let failed = 0;

  for (const ip of ips) {
    const display = ip.name || `${ip.brand} ${ip.model}`;

    // Fetch Zuper product to check current HS ID
    const r = await fetch(`${ZUPER_API_URL}/product/${ip.zuperItemId}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    if (r.status !== 200) {
      console.log(`  ✗ ${display}: Zuper product ${ip.zuperItemId} not found (${r.status})`);
      failed++;
      continue;
    }

    const d = await r.json() as any;
    const zp = d.data;

    // Check current HS ID
    let currentHsId: string | null = null;
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (cfio?.product_hubspot_product_id_1) currentHsId = String(cfio.product_hubspot_product_id_1);
    if (!currentHsId) {
      const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(meta)) {
        for (const m of meta) {
          if (m.label === "HubSpot Product ID" && m.value) currentHsId = String(m.value);
        }
      }
    }

    if (currentHsId === ip.hubspotProductId) {
      alreadySet++;
      continue;
    }

    console.log(`  ${display}: setting HS ID → ${ip.hubspotProductId}`);

    if (!DRY_RUN) {
      try {
        const updateRes = await fetch(`${ZUPER_API_URL}/product/${ip.zuperItemId}`, {
          method: "PUT",
          headers: {
            "x-api-key": ZUPER_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            product: {
              meta_data: [
                ...(Array.isArray(zp.meta_data) ? zp.meta_data.filter((m: any) => m.label !== "HubSpot Product ID") : []),
                { label: "HubSpot Product ID", value: ip.hubspotProductId },
              ],
            },
          }),
        });

        if (updateRes.ok) {
          console.log(`    ✓ Updated`);
          updated++;
        } else {
          const err = await updateRes.text();
          console.log(`    ⚠ Failed (${updateRes.status}): ${err.substring(0, 200)}`);
          failed++;
        }
      } catch (err) {
        console.log(`    ✗ ${err instanceof Error ? err.message : err}`);
        failed++;
      }
    } else {
      updated++;
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  Already set: ${alreadySet}`);
  console.log(`  ${DRY_RUN ? "Would update" : "Updated"}: ${updated}`);
  console.log(`  Failed: ${failed}`);

  if (DRY_RUN) console.log("\n*** Pass --live to execute ***");
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
