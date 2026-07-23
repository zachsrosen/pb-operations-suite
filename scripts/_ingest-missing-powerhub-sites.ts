/**
 * _ingest-missing-powerhub-sites.ts — one-off.
 *
 * Ingests Tesla portal sites that exist in the PowerHub portal but have never
 * landed in `PowerhubSite` (the asset-sync cron takes a fixed head-slice of
 * Tesla's group ordering, so sites appended at the tail are never reached).
 *
 * For each missing site: fetch /asset/sites/{id} for the device payload, create
 * the row with coordinates from the portal scrape, geo-match it to the nearest
 * HubSpotPropertyCache row, then resolve the property's primary site and push
 * tesla_* fields to HubSpot.
 *
 * Uses ONE client instance (one token) — see the token-throttle notes; do not
 * split this across repeated process launches.
 *
 *   node --env-file=.env.local --import tsx scripts/_ingest-missing-powerhub-sites.ts <scrape.json>
 *   node --env-file=.env.local --import tsx scripts/_ingest-missing-powerhub-sites.ts <scrape.json> --apply
 */

import { promises as fs } from "fs";
import { prisma } from "@/lib/db";
import { computePortalUrl, createPowerHubClient } from "@/lib/tesla-powerhub";
import {
  filterByBoundingBox,
  findNearestProperty,
  GEO_PREFILTER_DEG,
  type PropertyCandidate,
} from "@/lib/powerhub-geo-match";
import { resolvePrimarySite, pushToHubSpotForProperty } from "@/lib/powerhub-crosslink";

interface ScrapeSite {
  siteId: string;
  latitude: number;
  longitude: number;
  siteName?: string;
}

async function main() {
  const [, , payloadPath, ...flags] = process.argv;
  if (!payloadPath) {
    console.error("Usage: tsx scripts/_ingest-missing-powerhub-sites.ts <scrape.json> [--apply]");
    process.exit(1);
  }
  const dryRun = !flags.includes("--apply");

  const raw = JSON.parse(await fs.readFile(payloadPath, "utf8")) as { sites: ScrapeSite[] };
  const scraped = raw.sites.filter(
    (s) =>
      typeof s.siteId === "string" &&
      typeof s.latitude === "number" &&
      typeof s.longitude === "number",
  );

  const known = new Set(
    (await prisma.powerhubSite.findMany({ select: { siteId: true } })).map((s) => s.siteId),
  );
  const missing = scraped.filter((s) => !known.has(s.siteId));
  console.log(
    `Scrape: ${scraped.length} sites | already in DB: ${scraped.length - missing.length} | MISSING: ${missing.length} | mode=${dryRun ? "DRY RUN" : "APPLY"}`,
  );
  if (missing.length === 0) return;

  // Property candidates for geo matching
  const props = await prisma.hubSpotPropertyCache.findMany({
    select: { id: true, latitude: true, longitude: true, fullAddress: true },
  });
  const candidates: PropertyCandidate[] = [];
  const addrOf = new Map<string, string>();
  for (const p of props) {
    addrOf.set(p.id, p.fullAddress);
    if (p.latitude !== null && p.longitude !== null) {
      candidates.push({ id: p.id, latitude: p.latitude, longitude: p.longitude });
    }
  }
  console.log(`Property candidates with coords: ${candidates.length}`);

  const client = createPowerHubClient(); // ONE client, ONE token
  const instanceId = process.env.TESLA_POWERHUB_INSTANCE_ID || "";

  const created: string[] = [];
  const linked: Array<{ site: string; addr: string; distM: number; conf: string }> = [];
  const unmatched: string[] = [];
  const failed: Array<{ site: string; err: string }> = [];
  const propertyIdsTouched = new Set<string>();

  for (const [i, site] of missing.entries()) {
    let detail;
    try {
      detail = await client.getSiteDetail(site.siteId);
    } catch (err) {
      failed.push({ site: site.siteName || site.siteId, err: err instanceof Error ? err.message : String(err) });
      continue;
    }

    const gatewayCount = detail.gateway?.total_gateways ?? detail.gateway?.gateways?.length ?? 0;
    const batteryCount = detail.battery?.batteries?.length ?? 0;
    const inverterCount = Array.isArray(detail.inverter) ? detail.inverter.length : 0;
    const deviceSnapshot = {
      gateways: detail.gateway?.gateways ?? [],
      batteries: detail.battery?.batteries ?? [],
      inverters: detail.inverter ?? [],
      meters: detail.meter ?? [],
      evse: detail.evse ?? [],
    };

    const match = findNearestProperty(
      site.latitude,
      site.longitude,
      filterByBoundingBox(site.latitude, site.longitude, candidates, GEO_PREFILTER_DEG),
    );

    const label = detail.site_name || site.siteName || site.siteId;
    if (match) {
      linked.push({
        site: label,
        addr: addrOf.get(match.propertyId) ?? "?",
        distM: Math.round(match.distanceM),
        conf: match.confidence,
      });
      propertyIdsTouched.add(match.propertyId);
    } else {
      unmatched.push(label);
    }
    created.push(label);

    if (dryRun) continue;

    await prisma.powerhubSite.create({
      data: {
        siteId: detail.site_id,
        siteName: label,
        instanceId,
        aggregatorSiteId: detail.aggregator_site_identifier || null,
        portalUrl: computePortalUrl(detail.site_id),
        address: "",
        city: "",
        state: "",
        zip: null,
        addressHash: null,
        devices: JSON.parse(JSON.stringify(deviceSnapshot)),
        totalBatteryEnergy: detail.battery?.total_nameplate_energy || null,
        totalBatteryPower: detail.battery?.total_nameplate_max_discharge_power || null,
        totalGateways: gatewayCount,
        totalBatteries: batteryCount,
        totalInverters: inverterCount,
        latitude: site.latitude,
        longitude: site.longitude,
        lastAssetSyncAt: new Date(),
        lastGeoSyncAt: new Date(),
        ...(match
          ? {
              propertyId: match.propertyId,
              linkMethod: "GEO" as const,
              linkConfidence: match.confidence,
              linkDistanceM: match.distanceM,
              // resolvePrimarySite re-elects below; avoids the partial unique index
              primaryForProperty: false,
            }
          : { linkMethod: "UNLINKED" as const }),
      },
    });

    if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${missing.length}`);
  }

  console.log(`\nSites ${dryRun ? "that WOULD be" : ""} created: ${created.length}`);
  console.log(`  geo-linked to a property: ${linked.length}`);
  console.log(`  no property within threshold (left UNLINKED): ${unmatched.length}`);
  console.log(`  detail fetch failed: ${failed.length}`);
  const byConf = linked.reduce<Record<string, number>>((a, l) => ((a[l.conf] = (a[l.conf] ?? 0) + 1), a), {});
  console.log(`  link confidence: ${JSON.stringify(byConf)}`);

  console.log(`\nLinks (first 60):`);
  for (const l of linked.slice(0, 60)) console.log(`   ${l.site}  →  ${l.addr}  (${l.distM}m, ${l.conf})`);
  if (unmatched.length) console.log(`\nUnmatched: ${unmatched.join(", ")}`);
  if (failed.length) console.log(`\nFailed:`, JSON.stringify(failed.slice(0, 20), null, 1));

  if (!dryRun) {
    console.log(`\nResolving primary site + pushing to HubSpot for ${propertyIdsTouched.size} properties...`);
    let pushed = 0;
    for (const propertyId of propertyIdsTouched) {
      try {
        await resolvePrimarySite(propertyId);
        await pushToHubSpotForProperty(propertyId);
        pushed++;
      } catch (err) {
        console.error(`  push failed for ${propertyId}:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`Pushed ${pushed}/${propertyIdsTouched.size} properties.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
