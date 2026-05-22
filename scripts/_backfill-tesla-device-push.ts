/**
 * Backfill Tesla device serial fields onto:
 *   - HubSpotPropertyCache denorm cols (via resolvePrimarySite)
 *   - HubSpot Property/Deal/Ticket (via pushToHubSpotForProperty)
 *   - Zuper Property + cascade to Zuper Jobs
 *
 * Walks every property currently linked to a Tesla PowerHub site (those
 * with teslaPortalUrl != null), processes sequentially with progress
 * logging.
 *
 * Idempotent. Resumable (just re-run; properties already populated
 * still get pushed cleanly).
 */

import { prisma } from "../src/lib/db";
import { resolvePrimarySite, pushToHubSpotForProperty } from "../src/lib/powerhub-crosslink";
import { syncPropertyToZuper } from "../src/lib/zuper-property-sync";

const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG) : undefined;
const ONLY_ID = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const SKIP_ZUPER = process.argv.includes("--skip-zuper");

(async () => {
  console.log("Loading PowerHub-linked properties…");
  const properties = await prisma.hubSpotPropertyCache.findMany({
    where: ONLY_ID
      ? { id: ONLY_ID }
      : { teslaPortalUrl: { not: null } },
    select: { id: true, fullAddress: true },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`Found ${properties.length} linked properties${LIMIT ? ` (limit ${LIMIT})` : ""}${ONLY_ID ? ` (filter: ${ONLY_ID})` : ""}${SKIP_ZUPER ? " [Zuper push: SKIPPED — nightly cron picks up via cache updatedAt]" : ""}.\n`);

  let done = 0;
  let resolvedOk = 0;
  let hubspotOk = 0;
  let zuperOk = 0;
  let errors = 0;
  const t0 = Date.now();

  for (const prop of properties) {
    // Step 1: populate new denorm cols from primary site's devices JSON
    try {
      await resolvePrimarySite(prop.id);
      resolvedOk++;
    } catch (e) {
      errors++;
      console.error(`  resolve fail @ ${prop.id}:`, e instanceof Error ? e.message : e);
      continue; // skip downstream if denorm failed
    }

    // Step 2: push to HubSpot Property + Deal + Ticket
    try {
      await pushToHubSpotForProperty(prop.id);
      hubspotOk++;
    } catch (e) {
      errors++;
      console.error(`  hubspot push fail @ ${prop.id}:`, e instanceof Error ? e.message : e);
    }

    // Step 3: push to Zuper Property (cascades to linked Zuper Jobs).
    // Skipped by default; resolvePrimarySite() bumps updatedAt on the cache
    // row which the existing nightly zuper-property-sync cron picks up
    // organically — no need to hammer Zuper from the backfill.
    if (!SKIP_ZUPER) {
      try {
        await syncPropertyToZuper(prop.id);
        zuperOk++;
      } catch (e) {
        errors++;
        console.error(`  zuper push fail @ ${prop.id}:`, e instanceof Error ? e.message : e);
      }
    }

    done++;
    if (done % 50 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const rate = (done / Number(elapsed)).toFixed(2);
      console.log(`  ${done}/${properties.length}  (${elapsed}s, ${rate}/s, resolved:${resolvedOk} HS:${hubspotOk} Zuper:${zuperOk} errs:${errors})`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s.`);
  console.log(`  resolved primary OK:     ${resolvedOk}`);
  console.log(`  pushed to HubSpot OK:    ${hubspotOk}`);
  console.log(`  pushed to Zuper OK:      ${zuperOk}`);
  console.log(`  total errors:            ${errors}`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
