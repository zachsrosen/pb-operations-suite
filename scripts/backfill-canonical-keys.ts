/**
 * Backfill canonicalBrand, canonicalModel, canonicalKey on InternalProduct rows
 * where they are currently NULL.
 *
 * Safe to re-run — only touches rows with NULL canonicalKey.
 * Run: npx tsx scripts/backfill-canonical-keys.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  if (!prisma) {
    console.error("❌ Database not configured (check DATABASE_URL)");
    process.exit(1);
  }

  const beforeNull = await prisma.internalProduct.count({ where: { canonicalKey: null } });
  const total = await prisma.internalProduct.count();
  console.log(`\n📊 Before: ${beforeNull}/${total} products have NULL canonicalKey\n`);

  if (beforeNull === 0) {
    console.log("✅ Nothing to backfill — all products already have canonicalKey set.\n");
    process.exit(0);
  }

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "EquipmentSku"
    SET
      "canonicalBrand" = LOWER(REGEXP_REPLACE(TRIM("brand"), '[^a-zA-Z0-9]+', '', 'g')),
      "canonicalModel" = LOWER(REGEXP_REPLACE(TRIM("model"), '[^a-zA-Z0-9]+', '', 'g')),
      "canonicalKey"   = "category"::text || '|' || LOWER(REGEXP_REPLACE(TRIM("brand"), '[^a-zA-Z0-9]+', '', 'g')) || '|' || LOWER(REGEXP_REPLACE(TRIM("model"), '[^a-zA-Z0-9]+', '', 'g'))
    WHERE "canonicalKey" IS NULL
  `);

  const afterNull = await prisma.internalProduct.count({ where: { canonicalKey: null } });
  console.log(`✅ Backfilled ${updated} rows`);
  console.log(`📊 After: ${afterNull}/${total} products still have NULL canonicalKey\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
