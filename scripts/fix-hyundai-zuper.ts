/**
 * Check which Hyundai Zuper product is the original (has HS ID) vs our duplicate.
 * Swap if needed, delete the duplicate.
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

  // The two Zuper UIDs
  const originalCandidate = "39fbb9c0-6d7b-4487-a3b8-7c2a76dbcb7f"; // was on inactive HYUNDAI
  const syncCreated = "f711df1d-7406-4308-9fd1-048f92e7d43d";       // on active Hyundai

  // Fetch both from Zuper
  for (const uid of [originalCandidate, syncCreated]) {
    const r = await fetch(`${ZUPER_API_URL}/product/${uid}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as any;
    const zp = d.data;
    if (!zp) { console.log(`Zuper ${uid}: NOT FOUND`); continue; }

    const name = zp.product_name;
    const meta = zp.meta_data as Array<Record<string, unknown>> | undefined;
    let hsId: string | null = null;
    if (Array.isArray(meta)) {
      for (const m of meta) {
        if (m.label === "HubSpot Product ID" && m.value) hsId = String(m.value);
      }
    }
    const cfio = zp.custom_field_internal_object as Record<string, unknown> | undefined;
    if (!hsId && cfio?.product_hubspot_product_id_1) hsId = String(cfio.product_hubspot_product_id_1);

    const created = zp.created_at || "unknown";
    console.log(`Zuper ${uid.substring(0, 12)}…`);
    console.log(`  Name: "${name}" | HS ID: ${hsId || "none"} | Created: ${created}`);
  }

  // The active Hyundai IP
  const ip = await prisma.internalProduct.findFirst({
    where: { brand: "Hyundai", model: "HiN-T440NF(BK)", isActive: true },
    select: { id: true, brand: true, model: true, name: true, zuperItemId: true, zohoItemId: true },
  });

  if (!ip) { console.log("\n⚠ No active Hyundai IP found"); return; }
  console.log(`\nActive IP: "${ip.name}" zuper=${ip.zuperItemId}`);

  // If IP points to the sync-created one, swap to original
  if (ip.zuperItemId === syncCreated) {
    console.log(`  IP points to sync-created Zuper → swapping to original`);
    if (!DRY_RUN) {
      await prisma.internalProduct.update({
        where: { id: ip.id },
        data: { zuperItemId: originalCandidate },
      });
      console.log(`  ✓ IP zuperItemId → ${originalCandidate}`);

      // Delete the duplicate
      try {
        const delRes = await fetch(`${ZUPER_API_URL}/product/${syncCreated}`, {
          method: "DELETE",
          headers: { "x-api-key": ZUPER_API_KEY },
        });
        console.log(`  ✓ Deleted duplicate Zuper ${syncCreated}: ${delRes.status}`);
      } catch (err) {
        console.log(`  ⚠ Delete failed: ${err}`);
      }

      // Update Zoho cf_zuper_product_id
      if (ip.zohoItemId) {
        try {
          const { zohoInventory } = await import("../src/lib/zoho-inventory.js");
          await zohoInventory.updateItem(ip.zohoItemId, { cf_zuper_product_id: originalCandidate });
          console.log(`  ✓ Zoho cf_zuper_product_id → ${originalCandidate}`);
        } catch (err) {
          console.log(`  ⚠ Zoho update failed: ${err}`);
        }
      }
    }
  } else if (ip.zuperItemId === originalCandidate) {
    console.log(`  IP already points to original — good`);
  } else {
    console.log(`  IP points to unknown Zuper ID: ${ip.zuperItemId}`);
  }

  if (DRY_RUN) console.log("\n*** Pass --live to execute ***");
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
