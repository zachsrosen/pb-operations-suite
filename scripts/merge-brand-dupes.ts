/**
 * Merge brand-casing duplicate IPs.
 * Strategy: delete inactive empty dupes, rename active WRONG-branded ones.
 * For two-active conflicts: keep the one with more links, deactivate the other.
 * Pass --live to execute.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--live");

// Each conflict: the WRONG-branded active IP and what blocks it
const MERGES: Array<{
  wrongId: string;      // WRONG brand IP (active, has links)
  keepId: string;       // Correct brand IP (blocking the rename)
  model: string;        // For display
  action: "delete-keep" | "merge-to-keep";
}> = [
  // 1. Hyundai HiN-T440NF(BK) — both active, same zoho+hs. Keep newer "Hyundai", deactivate old "HYUNDAI"
  { wrongId: "cmlx15gf9000x04l5isdxfhxc", keepId: "cmn6luwrl0000bi8oa1synfer", model: "HiN-T440NF(BK)", action: "merge-to-keep" },
  // 2. IronRidge END CLAMP — KEEP is inactive, no links → delete KEEP, rename WRONG
  { wrongId: "cmm47kvtf00e204jrxpgjc8op", keepId: "cmm4c4aoq06k504l5zb1eyi37", model: "END CLAMP", action: "delete-keep" },
  // 3. IronRidge HW-RD1430-01-M1 — KEEP is inactive, same zoho only → delete KEEP, rename WRONG
  { wrongId: "cmm41hh8d01nb04l4pzc8gsyz", keepId: "4640c127-53c2-4537-8718-19567c6d49bf", model: "HW-RD1430-01-M1", action: "delete-keep" },
  // 4. IronRidge QM-HUG-01-M1 — both active. WRONG has HS+zuper, KEEP has different zoho+zuper. Merge HS to KEEP, deactivate WRONG.
  { wrongId: "cmm49nkl6000e04l6dzq99281", keepId: "cmm4bzhyk039p04l55w7y1wmr", model: "QM-HUG-01-M1", action: "merge-to-keep" },
  // 5. IronRidge UFO-MID — KEEP is inactive, no links → delete KEEP, rename WRONG
  { wrongId: "cmm4bspke000804l563tch5bh", keepId: "cmm4idsx9000v2r8ofub634v3", model: "UFO-MID", action: "delete-keep" },
  // 6. IronRidge XR-10-168M — KEEP is inactive, same zoho → delete KEEP, rename WRONG
  { wrongId: "cmm49nkas000a04l6c7z1nmp9", keepId: "cmm4bzhpw039l04l5ge3s7apk", model: "XR-10-168M", action: "delete-keep" },
  // 7. IronRidge XR10-BOSS-01-M1 — both active. WRONG has HS+zuper+zoho, KEEP has different zoho+zuper. Merge HS to KEEP, deactivate WRONG.
  { wrongId: "cmm49nkde000b04l617n70l18", keepId: "cmm4bzhs2039m04l57fv5fgj0", model: "XR10-BOSS-01-M1", action: "merge-to-keep" },
  // 8. Eaton DG222URB — KEEP is inactive, no links → delete KEEP, rename WRONG
  { wrongId: "cmm49nkyc000j04l66qbql1gl", keepId: "cmm4bzi9e039u04l5ep3asqod", model: "DG222URB", action: "delete-keep" },
];

const BRAND_FIX: Record<string, string> = {
  "HYUNDAI": "Hyundai", "IRONRIDGE": "IronRidge", "EATON": "Eaton",
};

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***\n");

  for (const merge of MERGES) {
    const wrong = await prisma.internalProduct.findUnique({ where: { id: merge.wrongId } });
    const keep = await prisma.internalProduct.findUnique({ where: { id: merge.keepId } });
    if (!wrong || !keep) {
      console.log(`⚠ Missing IP for ${merge.model} — skipping`);
      continue;
    }

    const correctBrand = BRAND_FIX[wrong.brand] || wrong.brand;
    console.log(`── ${merge.model} (${merge.action}) ──`);
    console.log(`  WRONG: "${wrong.brand}" id=${wrong.id.substring(0, 16)} zoho=${wrong.zohoItemId || "none"} hs=${wrong.hubspotProductId || "none"} zuper=${wrong.zuperItemId || "none"} active=${wrong.isActive}`);
    console.log(`  KEEP:  "${keep.brand}" id=${keep.id.substring(0, 16)} zoho=${keep.zohoItemId || "none"} hs=${keep.hubspotProductId || "none"} zuper=${keep.zuperItemId || "none"} active=${keep.isActive}`);

    if (merge.action === "delete-keep") {
      // Simple: delete the inactive blocker, rename the active one
      if (!DRY_RUN) {
        await prisma.internalProduct.delete({ where: { id: merge.keepId } });
        await prisma.internalProduct.update({
          where: { id: merge.wrongId },
          data: { brand: correctBrand },
        });
      }
      console.log(`  → Delete inactive "${keep.brand}" dupe, rename "${wrong.brand}" → "${correctBrand}"`);

    } else if (merge.action === "merge-to-keep") {
      // Complex: transfer any links WRONG has that KEEP doesn't, then deactivate WRONG
      const updates: Record<string, unknown> = {};
      if (!keep.hubspotProductId && wrong.hubspotProductId) {
        updates.hubspotProductId = wrong.hubspotProductId;
        console.log(`  → Transfer HS ${wrong.hubspotProductId} to KEEP`);
      }
      if (!keep.zohoItemId && wrong.zohoItemId) {
        updates.zohoItemId = wrong.zohoItemId;
        console.log(`  → Transfer Zoho ${wrong.zohoItemId} to KEEP`);
      }
      // Don't overwrite existing zuperItemId — KEEP already has one
      if (!keep.zuperItemId && wrong.zuperItemId) {
        updates.zuperItemId = wrong.zuperItemId;
        console.log(`  → Transfer Zuper ${wrong.zuperItemId} to KEEP`);
      }

      if (!DRY_RUN) {
        if (Object.keys(updates).length > 0) {
          await prisma.internalProduct.update({ where: { id: merge.keepId }, data: updates });
        }
        await prisma.internalProduct.update({
          where: { id: merge.wrongId },
          data: { isActive: false },
        });
      }
      console.log(`  → Deactivate WRONG "${wrong.brand}" IP`);
    }
    console.log();
  }

  if (DRY_RUN) console.log("*** DRY RUN — pass --live to execute ***");
  else console.log("✓ Done");

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
