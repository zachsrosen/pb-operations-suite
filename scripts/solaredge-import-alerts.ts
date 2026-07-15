/* eslint-disable no-console */
/**
 * Import the SolarEdge Alerts export (portal → Reports → Alerts → Export) into
 * SolarEdgeAlert. Full replace: rebuilds named-alert detail from the file.
 *
 * The Monitoring API key is not entitled to the alerts endpoint (403), so this
 * export is the only source of named alerts. Re-run whenever a fresh export is
 * dropped to refresh the fleet.
 *
 *   npx tsx --env-file=.env scripts/solaredge-import-alerts.ts "<path to Alerts xlsx>"
 */

import * as XLSX from "xlsx";
import { importSolarEdgeAlerts } from "../src/lib/solaredge-alerts-sync";
import type { RawAlertRow } from "../src/lib/solaredge-alerts-import";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: tsx scripts/solaredge-import-alerts.ts <path to Alerts xlsx>");
    process.exit(1);
  }
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawAlertRow>(sheet, { defval: null });
  console.log(`Read ${rows.length} rows from ${file}`);

  const r = await importSolarEdgeAlerts(rows);
  console.log(
    `Imported: ${r.inserted} alerts across ${r.sitesWithAlerts} sites ` +
      `(${r.matched}/${r.parsed} rows matched a site; ${r.unmatchedRows} unmatched).`
  );
  if (r.unmatchedSites.length) {
    console.log(`Unmatched site names (${r.unmatchedSites.length}):`);
    for (const s of r.unmatchedSites.slice(0, 40)) console.log(`  - ${s}`);
    if (r.unmatchedSites.length > 40) console.log(`  … and ${r.unmatchedSites.length - 40} more`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
