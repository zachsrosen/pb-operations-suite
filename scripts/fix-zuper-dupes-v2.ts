/**
 * Fix confirmed Zuper duplicates: swap IPs to original Zuper products,
 * delete our duplicates, update Zoho cf_zuper_product_id.
 *
 * Pass --live to execute. Without it, dry-run only.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");

interface DupeSwap {
  label: string;
  /** Our duplicate Zuper product (currently on the IP) */
  ourZuperUid: string;
  /** The original pre-existing Zuper product (orphan) */
  originalZuperUid: string;
  /** IP search criteria */
  ipBrand: string;
  ipModel: string;
}

// Confirmed duplicates from audit
const SWAPS: DupeSwap[] = [
  {
    label: "SEG Solar 420W",
    ourZuperUid: "c1c2545d-3176-418c-b757-ddaf11bd1692",
    originalZuperUid: "036169ac-0172-4ac2-bca7-c1edfe3e9e4e",
    ipBrand: "SEG Solar",
    ipModel: "420W",
  },
  {
    label: "Tesla 7.6kW Inverter (1538000-45-A)",
    ourZuperUid: "0eecc0a8-5254-42c2-9abe-0b35ec153774",
    originalZuperUid: "e0eb2bc5-11f8-487c-bf43-f1a3fc2b54fa",
    ipBrand: "Tesla",
    ipModel: "1538000-45-A",
  },
  {
    label: "Tesla Backup Gateway 3 (1841000-X1-Y)",
    ourZuperUid: "db43ac6b-3656-4a76-8005-1b99e321f08f",
    originalZuperUid: "f408661a-b748-432d-8b75-12e8bcff5e5f",
    ipBrand: "Tesla",
    ipModel: "1841000-X1-Y",
  },
  {
    label: "IronRidge QM-HUG-01-M1",
    ourZuperUid: "2cf8cd66-bbd5-430e-95c1-0d318493400b",
    originalZuperUid: "2243f4ee-65dc-4c97-be80-b2b9b7da7ede",
    ipBrand: "IronRidge",
    ipModel: "QM-HUG-01-M1",
  },
  {
    label: "IronRidge XR10-BOSS-01-M1",
    ourZuperUid: "0b9edbc5-3d0e-4a58-b260-918bda2d4af9",
    originalZuperUid: "c1883093-1575-4b99-b5c6-e12a42e4b3f2",
    ipBrand: "IronRidge",
    ipModel: "XR10-BOSS-01-M1",
  },
  {
    label: "Enphase IQ Combiner Box 5",
    ourZuperUid: "b61fcca5-0228-4ed8-9ded-0e176600b945",
    originalZuperUid: "e7f997e0-22fc-4c7e-ad81-66b05e6dccaf",
    ipBrand: "Enphase",
    ipModel: "IQ COMBINER BOX 5",
  },
  {
    label: "Tesla PW3 Expansion (1807000-XX-Y)",
    ourZuperUid: "a643a00f-1b94-4a18-818d-e057985a75da",
    originalZuperUid: "d75da1ea-cd1c-4ac1-8b6c-2b03c7cd6aba",
    ipBrand: "Tesla",
    ipModel: "POWERWALL-3 EXPANSION UNIT (1807000-XX-Y)",
  },
  {
    label: "Silfab SIL-400 HC+",
    ourZuperUid: "047545eb-f346-4e3e-987b-d0e4736a4fc5",
    originalZuperUid: "14702e40-f392-4b6e-8c0e-96e4e3f9c71d",
    ipBrand: "Silfab",
    ipModel: "SIL-400 HC+",
  },
];

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  let swapped = 0;
  let deleted = 0;
  let zohoUpdated = 0;
  let errors = 0;

  for (const swap of SWAPS) {
    console.log(`\n── ${swap.label} ──`);

    // Verify both Zuper products exist
    const [ourRes, origRes] = await Promise.all([
      fetch(`${ZUPER_API_URL}/product/${swap.ourZuperUid}`, {
        headers: { "x-api-key": ZUPER_API_KEY },
      }),
      fetch(`${ZUPER_API_URL}/product/${swap.originalZuperUid}`, {
        headers: { "x-api-key": ZUPER_API_KEY },
      }),
    ]);

    const ourData = (await ourRes.json()) as any;
    const origData = (await origRes.json()) as any;

    const ourName = ourData.data?.product_name || "NOT FOUND";
    const origName = origData.data?.product_name || "NOT FOUND";

    console.log(`  Ours (to delete): "${ourName}" (${swap.ourZuperUid.substring(0, 12)}…)`);
    console.log(`  Original (to keep): "${origName}" (${swap.originalZuperUid.substring(0, 12)}…)`);

    if (!ourData.data || !origData.data) {
      console.log(`  ⚠ Skipping — one or both Zuper products not found`);
      errors++;
      continue;
    }

    // Find the IP
    const ip = await prisma.internalProduct.findFirst({
      where: { brand: swap.ipBrand, model: swap.ipModel, isActive: true },
      select: { id: true, name: true, zuperItemId: true, zohoItemId: true },
    });

    if (!ip) {
      console.log(`  ⚠ No active IP found for ${swap.ipBrand} ${swap.ipModel}`);
      errors++;
      continue;
    }

    if (ip.zuperItemId !== swap.ourZuperUid) {
      console.log(`  ⚠ IP zuperItemId (${ip.zuperItemId}) doesn't match expected (${swap.ourZuperUid}) — skipping`);
      errors++;
      continue;
    }

    console.log(`  IP: "${ip.name || `${swap.ipBrand} ${swap.ipModel}`}" → swapping zuper to original`);

    if (!DRY_RUN) {
      // 1. Update IP to point to original
      await prisma.internalProduct.update({
        where: { id: ip.id },
        data: { zuperItemId: swap.originalZuperUid },
      });
      console.log(`  ✓ IP zuperItemId → ${swap.originalZuperUid.substring(0, 12)}…`);
      swapped++;

      // 2. Delete our duplicate from Zuper
      try {
        const delRes = await fetch(`${ZUPER_API_URL}/product/${swap.ourZuperUid}`, {
          method: "DELETE",
          headers: { "x-api-key": ZUPER_API_KEY },
        });
        console.log(`  ✓ Deleted duplicate Zuper product: ${delRes.status}`);
        deleted++;
      } catch (err) {
        console.log(`  ⚠ Delete failed: ${err}`);
      }

      // 3. Update Zoho cf_zuper_product_id
      if (ip.zohoItemId) {
        try {
          await (zohoInventory as any).requestPut(
            `/items/${encodeURIComponent(ip.zohoItemId)}`,
            {
              custom_fields: [
                { api_name: "cf_zuper_product_id", value: swap.originalZuperUid },
              ],
            },
            { is_partial: "true" },
          );
          console.log(`  ✓ Zoho cf_zuper_product_id → ${swap.originalZuperUid.substring(0, 12)}…`);
          zohoUpdated++;
        } catch (err) {
          console.log(`  ⚠ Zoho update failed: ${err}`);
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    } else {
      swapped++;
    }
  }

  console.log(`\n══ Summary ══`);
  console.log(`  ${DRY_RUN ? "Would swap" : "Swapped"}: ${swapped}`);
  console.log(`  ${DRY_RUN ? "Would delete" : "Deleted"}: ${DRY_RUN ? swapped : deleted}`);
  console.log(`  ${DRY_RUN ? "Would update Zoho" : "Zoho updated"}: ${DRY_RUN ? swapped : zohoUpdated}`);
  console.log(`  Errors/skipped: ${errors}`);

  if (DRY_RUN) console.log("\n*** Pass --live to execute ***");
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
