#!/usr/bin/env tsx
/**
 * Unlink all PowerhubSite rows that were linked via the date+battery
 * heuristic in `src/lib/powerhub-auto-link.ts`. Those links over-clustered:
 * many sites within the same date window all picked the same property as
 * their best match, so a single property ended up with 5-28 sites linked.
 *
 * Selection criterion:
 *   linkMethod = 'PROPERTY' AND addressHash IS NULL
 *
 * The heuristic doesn't compute a real addressHash (Tesla's API doesn't
 * return addresses), so heuristic-linked rows are exactly the
 * addressHash=NULL rows. Genuine address-hash matches retain their hash
 * — verified via the live API: as of this writing, 0 of 175 linked
 * sites have a non-null addressHash, so this cleanup affects every
 * currently linked site.
 *
 * What the script does:
 *   1. Snapshots affected rows to a JSON backup file (rollback aid).
 *   2. Sets linkMethod='UNLINKED', linkConfidence='LOW', clears
 *      propertyId/dealId, demotes primaryForProperty.
 *   3. For each property that loses sites, runs resolvePrimarySite()
 *      so teslaPortalUrl + teslaSiteId on the property cache reset.
 *
 * Usage:
 *   tsx scripts/unlink-heuristic-powerhub-links.ts            # dry-run (default)
 *   tsx scripts/unlink-heuristic-powerhub-links.ts --apply    # execute mutations
 *   tsx scripts/unlink-heuristic-powerhub-links.ts --backup-file /tmp/x.json
 */

import { prisma } from "../src/lib/db";
import { resolvePrimarySite } from "../src/lib/powerhub-crosslink";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const backupFileArg = args.indexOf("--backup-file");
const BACKUP_FILE =
  backupFileArg >= 0 && args[backupFileArg + 1]
    ? args[backupFileArg + 1]
    : join(
        process.cwd(),
        `powerhub-unlink-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      );

async function main() {
  console.log(
    `\n=== Unlink heuristic-linked PowerhubSite rows ===\n` +
      `Mode: ${APPLY ? "\x1b[31mAPPLY (writes)\x1b[0m" : "\x1b[33mDRY-RUN\x1b[0m"}\n` +
      `Backup file: ${BACKUP_FILE}\n`,
  );

  // 1. Find all heuristic-linked sites
  const affected = await prisma.powerhubSite.findMany({
    where: {
      linkMethod: "PROPERTY",
      addressHash: null,
    },
    select: {
      id: true,
      siteId: true,
      siteName: true,
      propertyId: true,
      dealId: true,
      linkMethod: true,
      linkConfidence: true,
      primaryForProperty: true,
      address: true,
      city: true,
      state: true,
    },
  });

  console.log(`Found ${affected.length} sites to unlink.\n`);

  if (affected.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // Group by property for impact summary
  const propertyIds = new Set(
    affected.map((s) => s.propertyId).filter((id): id is string => Boolean(id)),
  );
  const byProperty = new Map<string, typeof affected>();
  for (const s of affected) {
    if (!s.propertyId) continue;
    const arr = byProperty.get(s.propertyId) ?? [];
    arr.push(s);
    byProperty.set(s.propertyId, arr);
  }
  const clusterSizes = [...byProperty.values()]
    .map((arr) => arr.length)
    .sort((a, b) => b - a);

  console.log(`Affected properties: ${propertyIds.size}`);
  console.log(
    `Cluster size distribution (top 10): ${clusterSizes.slice(0, 10).join(", ")}`,
  );
  console.log(
    `Max cluster: ${clusterSizes[0]} sites; min cluster: ${clusterSizes[clusterSizes.length - 1]} sites\n`,
  );

  // 2. Write backup
  if (APPLY) {
    writeFileSync(
      BACKUP_FILE,
      JSON.stringify({ unlinkedAt: new Date().toISOString(), rows: affected }, null, 2),
    );
    console.log(`✅ Backup written: ${BACKUP_FILE}\n`);
  } else {
    console.log(`(dry-run: would write backup to ${BACKUP_FILE})\n`);
  }

  // 3. Unlink the sites
  if (APPLY) {
    const result = await prisma.powerhubSite.updateMany({
      where: {
        linkMethod: "PROPERTY",
        addressHash: null,
      },
      data: {
        linkMethod: "UNLINKED",
        linkConfidence: "LOW",
        propertyId: null,
        dealId: null,
        primaryForProperty: false,
      },
    });
    console.log(`✅ Updated ${result.count} PowerhubSite rows.\n`);
  } else {
    console.log(
      `(dry-run: would UPDATE ${affected.length} PowerhubSite rows — UNLINKED, clear propertyId/dealId/primaryForProperty)\n`,
    );
  }

  // 4. For each affected property, re-resolve primary (which clears teslaPortalUrl/teslaSiteId now)
  console.log(`Re-resolving primary for ${propertyIds.size} properties…`);
  let cleared = 0;
  for (const propertyId of propertyIds) {
    if (APPLY) {
      const primary = await resolvePrimarySite(propertyId);
      if (!primary) cleared++;
    } else {
      cleared++;
    }
  }
  console.log(
    APPLY
      ? `✅ Cleared teslaPortalUrl/teslaSiteId on ${cleared} properties.\n`
      : `(dry-run: would clear teslaPortalUrl/teslaSiteId on ${cleared} properties)\n`,
  );

  console.log("Done.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
