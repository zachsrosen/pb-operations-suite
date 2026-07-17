#!/usr/bin/env tsx
/**
 * One-shot: call resolvePrimarySite() for every property that has
 * GEO-linked PowerhubSite rows. This sets primaryForProperty + writes the
 * denormalized teslaPortalUrl/teslaSiteId on HubSpotPropertyCache.
 *
 * Why this script exists: the initial fleet import via
 * /api/powerhub/import-locations hit Vercel's 300s function timeout
 * after the per-site updates completed but before the per-property
 * resolvePrimarySite loop finished (~2,512 of 2,603 properties unresolved).
 * This script finishes the second loop with no timeout pressure.
 *
 * Idempotent. Safe to re-run.
 */

import { prisma } from "../src/lib/db";
import { resolvePrimarySite } from "../src/lib/powerhub-crosslink";

(async () => {
  console.log("Fetching properties that need primary resolution...");
  const propIds = (
    await prisma.powerhubSite.groupBy({
      by: ["propertyId"],
      where: { linkMethod: "GEO", propertyId: { not: null } },
      _count: true,
    })
  )
    .map((g) => g.propertyId)
    .filter((id): id is string => id !== null);

  console.log(`Resolving primary for ${propIds.length} properties...`);

  let done = 0;
  let withPrimary = 0;
  let withoutPrimary = 0;
  const t0 = Date.now();

  for (const propertyId of propIds) {
    const primary = await resolvePrimarySite(propertyId);
    if (primary) {
      withPrimary++;
    } else {
      withoutPrimary++;
    }
    done++;
    if (done % 250 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const rate = (done / Number(elapsed)).toFixed(1);
      console.log(`  ${done}/${propIds.length} (${elapsed}s, ${rate}/s)`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s.`);
  console.log(`  primary assigned: ${withPrimary}`);
  console.log(`  no sites (cleanup): ${withoutPrimary}`);

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
