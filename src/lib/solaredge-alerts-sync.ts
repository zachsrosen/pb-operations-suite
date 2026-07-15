/**
 * SolarEdge named-alert import — DB writer.
 *
 * Thin IO wrapper around the pure matcher in solaredge-alerts-import.ts: reads
 * the synced fleet, matches the export rows to sites, then full-replaces the
 * SolarEdgeAlert table in one transaction (so the fleet never reads a
 * half-empty table). See that file for why the export is the only source of
 * named alerts (the API key isn't entitled to the alerts endpoint).
 */

import { prisma } from "@/lib/db";
import { buildSiteMatchMaps, matchAlerts, type AlertImportResult, type RawAlertRow } from "@/lib/solaredge-alerts-import";

export async function importSolarEdgeAlerts(rawRows: RawAlertRow[]): Promise<AlertImportResult> {
  const sites = await prisma.solarEdgeSite.findMany({ select: { siteId: true, siteName: true, projNumber: true } });
  const maps = buildSiteMatchMaps(sites);
  const { records, summary } = matchAlerts(rawRows, maps);

  // Safety: never let a wrong/empty file wipe the table. A real export always
  // matches hundreds of rows; zero matches means the file was empty or its
  // site names didn't resolve — refuse the destructive replace and report it.
  if (records.length === 0) {
    return { ...summary, inserted: 0 };
  }

  await prisma.$transaction([
    prisma.solarEdgeAlert.deleteMany({}),
    prisma.solarEdgeAlert.createMany({ data: records }),
  ]);

  return summary;
}
