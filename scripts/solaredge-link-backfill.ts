/* eslint-disable no-console */
/**
 * One-off: resolve SolarEdge → HubSpot links for the existing fleet.
 *
 * Same pass the daily solaredge-sync cron now runs. Local-only (PROJ number →
 * Deal mirror → PropertyDealLink); makes no HubSpot API calls. Additive: only
 * sets dealId/propertyId/linkMethod on SolarEdgeSite rows that carry a PROJ.
 *
 *   npx tsx scripts/solaredge-link-backfill.ts
 */

import { resolveSolarEdgeLinks } from "../src/lib/solaredge-linkage-resolve";

async function main() {
  const r = await resolveSolarEdgeLinks();
  console.log(
    `SolarEdge linkage: ${r.linkedToDeal}/${r.sitesWithProj} PROJ sites linked to a deal, ` +
      `${r.linkedToProperty} also linked to a property.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
