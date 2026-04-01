/**
 * Fix Zuper duplicates — swap IP's zuperItemId to the original Zuper product,
 * delete the duplicate we created, update Zoho, and backfill hubspotProductId.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");

// Manually verified correct mappings:
// [orphan Zuper UID → IP zuperItemId to replace, orphan name, HS product ID on orphan]
const FIXES: Array<{
  correctZuperUid: string;
  correctZuperName: string;
  orphanHsId: string | null;
  ipId?: string; // filled at runtime
  duplicateZuperUid?: string; // filled at runtime
}> = [
  // HS ID exact matches
  { correctZuperUid: "a643a00f-1b94-4a18-818d-e057985a75da", correctZuperName: "Tesla Powerwall 3 Expansion Pack", orphanHsId: "2708424207" },
  { correctZuperUid: "67c0ad65-2314-4e77-a859-abe09f149d71", correctZuperName: "Tesla Powerwall 3", orphanHsId: "2708371836" },
  { correctZuperUid: "13421be7-ee60-4de2-a990-fa61873361fa", correctZuperName: "Tesla Remote Meter", orphanHsId: "37148075952" },
  // Name exact match
  { correctZuperUid: "6ef782c9-e4e1-4a00-b2c8-0a8028648843", correctZuperName: "Tesla Universal Wall Connector", orphanHsId: "2708574572" },
  // Verified partial-name matches
  { correctZuperUid: "ef3673db-315c-4199-ab8f-cbc85d672f39", correctZuperName: "REC360TP4 Black", orphanHsId: "2750443823" },
  { correctZuperUid: "09fd4477-3e27-498f-b07c-47f397c99aca", correctZuperName: "SEG-430-BTD-BG", orphanHsId: "3651291828" },
  { correctZuperUid: "190a7760-d03f-4f8b-84b0-679b870e59aa", correctZuperName: "SEG-440-BTD-BG", orphanHsId: "30611733767" },
  { correctZuperUid: "56b57b18-deb2-4be9-834c-5867b386ae37", correctZuperName: "Service Technician Labor", orphanHsId: "2400774674" },
];

// EXCLUDED (false matches):
// "Tesla Powerwall +" → PW3 Expansion (different product)
// "Hardware" → Ironridge T-bolt (completely different)
// "Critter Guard" → Critter Guard 6" Roll (generic fee vs physical product)

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  // Find IPs currently pointing to a different Zuper product
  for (const fix of FIXES) {
    // Find the IP that should use this Zuper product — match by HS ID if available
    let ip;
    if (fix.orphanHsId) {
      ip = await prisma.internalProduct.findFirst({
        where: { isActive: true, hubspotProductId: fix.orphanHsId },
        select: { id: true, category: true, brand: true, model: true, name: true, zohoItemId: true, hubspotProductId: true, zuperItemId: true },
      });
    }
    if (!ip) {
      // Fallback: find IP currently linked to a Zuper product with this name pattern
      const allWithZuper = await prisma.internalProduct.findMany({
        where: { isActive: true, zuperItemId: { not: null } },
        select: { id: true, category: true, brand: true, model: true, name: true, zohoItemId: true, hubspotProductId: true, zuperItemId: true },
      });
      // Try to find by name similarity
      const normCorrect = fix.correctZuperName.toLowerCase().replace(/[^a-z0-9]/g, "");
      ip = allWithZuper.find(p => {
        const normIp = (p.name || `${p.brand} ${p.model}`).toLowerCase().replace(/[^a-z0-9]/g, "");
        return normIp.includes(normCorrect) || normCorrect.includes(normIp);
      });
    }

    if (!ip) {
      console.log(`⚠ No IP found for "${fix.correctZuperName}" (HS:${fix.orphanHsId}) — skipping`);
      continue;
    }

    if (ip.zuperItemId === fix.correctZuperUid) {
      console.log(`✓ "${fix.correctZuperName}" — IP already points to correct Zuper product`);
      continue;
    }

    fix.ipId = ip.id;
    fix.duplicateZuperUid = ip.zuperItemId || undefined;

    const ipDisplay = ip.name || `${ip.brand} ${ip.model}`;
    console.log(`[${ip.category}] "${ipDisplay}"`);
    console.log(`  Current Zuper (DUPE): ${ip.zuperItemId}`);
    console.log(`  Correct Zuper:        ${fix.correctZuperUid} ("${fix.correctZuperName}")`);
    console.log(`  Zoho:                 ${ip.zohoItemId || "none"}`);
    console.log(`  HS Product ID:        ${ip.hubspotProductId || "none"} → orphan has: ${fix.orphanHsId}`);

    if (!DRY_RUN) {
      // Step 1: Swap IP's zuperItemId
      const updateData: Record<string, unknown> = { zuperItemId: fix.correctZuperUid };

      // Also backfill hubspotProductId if IP doesn't have one but orphan does
      if (!ip.hubspotProductId && fix.orphanHsId) {
        updateData.hubspotProductId = fix.orphanHsId;
        console.log(`  ✓ Backfilling hubspotProductId → ${fix.orphanHsId}`);
      }

      await prisma.internalProduct.update({
        where: { id: ip.id },
        data: updateData,
      });
      console.log(`  ✓ IP zuperItemId → ${fix.correctZuperUid}`);

      // Step 2: Delete the duplicate Zuper product
      if (fix.duplicateZuperUid) {
        try {
          const delRes = await fetch(`${ZUPER_API_URL}/product/${fix.duplicateZuperUid}`, {
            method: "DELETE",
            headers: { "x-api-key": ZUPER_API_KEY },
          });
          if (delRes.ok) {
            console.log(`  ✓ Deleted duplicate Zuper: ${fix.duplicateZuperUid}`);
          } else {
            const body = await delRes.text();
            console.log(`  ⚠ Delete returned ${delRes.status}: ${body.substring(0, 120)}`);
          }
        } catch (err) {
          console.log(`  ⚠ Delete failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Step 3: Update Zoho cf_zuper_product_id
      if (ip.zohoItemId) {
        try {
          const { zohoInventory } = await import("../src/lib/zoho-inventory.js");
          await zohoInventory.updateItem(ip.zohoItemId, {
            cf_zuper_product_id: fix.correctZuperUid,
          });
          console.log(`  ✓ Zoho cf_zuper_product_id → ${fix.correctZuperUid}`);
        } catch (err) {
          console.log(`  ⚠ Zoho update failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log(`*** DRY RUN complete — pass --live to execute ***`);
  } else {
    console.log(`✓ Done`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
