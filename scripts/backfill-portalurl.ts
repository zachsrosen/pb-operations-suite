/**
 * One-shot: populate PowerhubSite.portalUrl for existing rows.
 *
 * After the schema migration added the column, all existing rows have
 * portalUrl=NULL. The asset-sync cron will fill it on its next 6h cycle,
 * but for an immediate backfill we compute it here.
 */
import { prisma } from "../src/lib/db";
import { computePortalUrl } from "../src/lib/tesla-powerhub";

(async () => {
  const rows = await prisma.powerhubSite.findMany({
    where: { portalUrl: null },
    select: { id: true, siteId: true },
  });
  console.log(`Found ${rows.length} PowerhubSites with portalUrl=NULL`);

  let updated = 0;
  for (const row of rows) {
    const url = computePortalUrl(row.siteId);
    if (!url) continue;
    await prisma.powerhubSite.update({
      where: { id: row.id },
      data: { portalUrl: url },
    });
    updated++;
    if (updated % 200 === 0) console.log(`  progress: ${updated}/${rows.length}`);
  }
  console.log(`Done. Updated ${updated} rows.`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
