/**
 * Backfill ActivityLog.userId from userEmail where userId IS NULL.
 *
 * Historical non-LOGIN rows written via /api/activity/log never set userId
 * (fixed going forward; this backfills the old rows).
 *
 * Usage:
 *   Dry run (default):   npx tsx scripts/backfill-activity-userid.ts
 *   Apply:               npx tsx scripts/backfill-activity-userid.ts --apply
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const apply = process.argv.includes("--apply");

  const nullCount = await prisma.activityLog.count({ where: { userId: null } });
  const nullWithEmail = await prisma.activityLog.count({
    where: { userId: null, userEmail: { not: null } },
  });

  console.log(`Rows with userId IS NULL: ${nullCount}`);
  console.log(`  of which have userEmail set: ${nullWithEmail}`);

  const preview = await prisma.$queryRawUnsafe<Array<{ email: string; rows: bigint; has_user: boolean }>>(`
    SELECT a."userEmail" as email, COUNT(*)::bigint as rows,
      (u.id IS NOT NULL) as has_user
    FROM "ActivityLog" a
    LEFT JOIN "User" u ON LOWER(u.email) = LOWER(a."userEmail")
    WHERE a."userId" IS NULL AND a."userEmail" IS NOT NULL
    GROUP BY a."userEmail", u.id
    ORDER BY COUNT(*) DESC
    LIMIT 25
  `);
  console.log("\nTop 25 affected userEmails:");
  for (const r of preview) {
    console.log(`  ${r.has_user ? "✓" : "✗ (no User match)"} ${r.email}: ${r.rows} rows`);
  }

  const matched = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(`
    SELECT COUNT(*)::bigint as c
    FROM "ActivityLog" a
    INNER JOIN "User" u ON LOWER(u.email) = LOWER(a."userEmail")
    WHERE a."userId" IS NULL AND a."userEmail" IS NOT NULL
  `);
  const willUpdate = Number(matched[0]?.c ?? 0);
  console.log(`\nRows that will be updated (have a matching User by email): ${willUpdate}`);
  console.log(`Rows that will remain NULL (no matching User): ${nullWithEmail - willUpdate}`);

  if (!apply) {
    console.log("\n[DRY RUN] Re-run with --apply to perform the update.");
    return;
  }

  console.log("\nApplying update...");
  const result = await prisma.$executeRawUnsafe(`
    UPDATE "ActivityLog" a
    SET "userId" = u.id
    FROM "User" u
    WHERE a."userId" IS NULL
      AND a."userEmail" IS NOT NULL
      AND LOWER(u.email) = LOWER(a."userEmail")
  `);
  console.log(`Updated ${result} rows.`);

  const remaining = await prisma.activityLog.count({ where: { userId: null } });
  console.log(`Remaining rows with userId IS NULL: ${remaining}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
