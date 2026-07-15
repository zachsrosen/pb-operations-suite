/**
 * SolarEdge asset sync — fetch the fleet from the SolarEdge Monitoring API and
 * upsert SolarEdgeSite rows. Stores the PROJ number extracted from the site
 * name (the HubSpot link signal) and the per-site alert summary. Property/deal
 * resolution is a separate linkage pass (mirrors the PowerHub pattern).
 */

import { prisma } from "@/lib/db";
import { createSolarEdgeClient, apiSiteToRow } from "@/lib/solaredge";

export interface SolarEdgeSyncResult {
  fetched: number;
  upserted: number;
  withProj: number;
  errors: string[];
}

export async function syncSolarEdgeSites(): Promise<SolarEdgeSyncResult> {
  const client = createSolarEdgeClient();
  const result: SolarEdgeSyncResult = { fetched: 0, upserted: 0, withProj: 0, errors: [] };

  const sites = await client.listAllSites();
  result.fetched = sites.length;
  const now = new Date();

  for (const site of sites) {
    try {
      const row = apiSiteToRow(site);
      if (row.projNumber) result.withProj++;
      await prisma.solarEdgeSite.upsert({
        where: { siteId: row.siteId },
        create: { ...row, installDate: row.installDate ? new Date(row.installDate) : null, linkMethod: "UNLINKED", lastSyncAt: now },
        // Preserve linkage fields (propertyId/dealId/linkMethod) across syncs.
        update: {
          siteName: row.siteName,
          portalUrl: row.portalUrl,
          siteType: row.siteType,
          activationStatus: row.activationStatus,
          peakPowerKw: row.peakPowerKw,
          address: row.address,
          city: row.city,
          state: row.state,
          zip: row.zip,
          installDate: row.installDate ? new Date(row.installDate) : null,
          projNumber: row.projNumber,
          highestAlertImpact: row.highestAlertImpact,
          openAlertCount: row.openAlertCount,
          lastSyncAt: now,
        },
      });
      result.upserted++;
    } catch (err) {
      result.errors.push(`Site ${site.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
