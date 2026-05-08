/**
 * PowerHub Sync Orchestration
 *
 * Three sync operations:
 * 1. Asset sync — discovers sites, devices, runs linkage
 * 2. Telemetry poll — fetches latest signals per site
 * 3. Alert poll — fetches active alerts, resolves cleared ones
 *
 * All operations are designed to be called from Vercel Cron handlers.
 */

import { createPowerHubClient, type PowerHubSiteDetail, type PowerHubTelemetrySignal } from "./tesla-powerhub";
import {
  normalizeAddress,
  linkSite,
  type DealAddress,
} from "./powerhub-linkage";
import { prisma } from "./db";
import { appCache } from "./cache";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Telemetry signals to poll per site */
const TELEMETRY_SIGNALS = [
  "solar_instant_power",
  "solar_energy_exported",
  "battery_instant_power",
  "battery_state_of_energy",
  "battery_expected_energy_remaining",
  "site_instant_power",
  "site_energy_imported",
  "site_energy_exported",
  "load_instant_real_power",
  "grid_connected_status",
  "command_real_mode",
] as const;

/** Process sites in chunks to respect rate limit (4 req/sec) */
const CHUNK_SIZE = 4;
const CHUNK_DELAY_MS = 1100; // 1.1s between chunks for safety

/**
 * Max sites to process per cron invocation.
 * With 3,100+ sites and 4 req/sec rate limit, a single Vercel function
 * can't sync the entire fleet. Each run processes a batch and the cron
 * schedule (every 6h) progressively covers all sites.
 * 50 sites × ~1.3s per chunk of 4 ≈ ~17s per run (well within 300s limit).
 */
const ASSET_SYNC_BATCH_LIMIT = 50;

/**
 * Max sites to poll per telemetry/alert cron invocation.
 * Telemetry needs 2 API calls per site (available signals + last telemetry).
 * At 4 req/sec: 25 sites × 2 calls = 50 calls ≈ ~14s. Well within 300s limit.
 */
const TELEMETRY_BATCH_LIMIT = 25;
const ALERT_BATCH_LIMIT = 40;

// ─── Asset Sync ──────────────────────────────────────────────────────────────

export interface AssetSyncResult {
  sitesDiscovered: number;
  sitesStale: number;
  sitesBatched: number;
  sitesCreated: number;
  sitesUpdated: number;
  sitesLinked: number;
  errors: string[];
}

/**
 * Discover all sites from Tesla, upsert PowerhubSite rows, and run linkage
 * for any UNLINKED sites.
 */
export async function syncAssets(): Promise<AssetSyncResult> {
  const client = createPowerHubClient();
  const result: AssetSyncResult = {
    sitesDiscovered: 0,
    sitesStale: 0,
    sitesBatched: 0,
    sitesCreated: 0,
    sitesUpdated: 0,
    sitesLinked: 0,
    errors: [],
  };

  // 1. Get all sites from Tesla (flatten site IDs from groups)
  const groups = await client.getGroups();
  const allSiteIds: string[] = [];
  function collectSites(grps: typeof groups) {
    for (const g of grps) {
      if (g.sites) {
        for (const s of g.sites) allSiteIds.push(s.site_id);
      }
      if (g.child_groups) collectSites(g.child_groups);
    }
  }
  collectSites(groups);
  result.sitesDiscovered = allSiteIds.length;

  // 2. Find which sites were recently synced (within last 5h) — skip those
  const recentCutoff = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const recentlySynced = await prisma.powerhubSite.findMany({
    where: {
      siteId: { in: allSiteIds },
      lastAssetSyncAt: { gte: recentCutoff },
    },
    select: { siteId: true },
  });
  const recentSet = new Set(recentlySynced.map((s: { siteId: string }) => s.siteId));

  // 3. Filter to stale/new sites, take a batch
  const staleSiteIds = allSiteIds.filter((id) => !recentSet.has(id));
  const batchSiteIds = staleSiteIds.slice(0, ASSET_SYNC_BATCH_LIMIT);
  result.sitesStale = staleSiteIds.length;
  result.sitesBatched = batchSiteIds.length;

  if (batchSiteIds.length === 0) {
    return result; // All sites recently synced — nothing to do
  }

  // 4. Fetch deal addresses for linkage (batch query)
  const dealAddresses = await fetchDealAddresses();

  // 5. Process batch in chunks
  for (let i = 0; i < batchSiteIds.length; i += CHUNK_SIZE) {
    const chunk = batchSiteIds.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (siteId) => {
        try {
          const detail = await client.getSiteDetail(siteId);
          await upsertSite(detail, dealAddresses, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Site ${siteId}: ${msg}`);
        }
      })
    );

    // Pause between chunks
    if (i + CHUNK_SIZE < batchSiteIds.length) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  return result;
}

async function upsertSite(
  detail: PowerHubSiteDetail,
  dealAddresses: DealAddress[],
  result: AssetSyncResult
): Promise<void> {
  // Real Tesla API returns equipment in typed sub-objects, not a flat array
  const gatewayCount = detail.gateway?.total_gateways ?? detail.gateway?.gateways?.length ?? 0;
  const batteryCount = detail.battery?.batteries?.length ?? 0;
  const inverterCount = Array.isArray(detail.inverter) ? detail.inverter.length : 0;

  const totalBatteryEnergy = detail.battery?.total_nameplate_energy ?? 0;
  const totalBatteryPower = detail.battery?.total_nameplate_max_discharge_power ?? 0;

  // Tesla API does NOT return address fields on site detail —
  // address linkage relies on site_name pattern matching or manual linking.
  // We leave address/city/state empty and rely on the linkage system
  // to match via deal cache or manual admin override.

  const existing = await prisma.powerhubSite.findUnique({
    where: { siteId: detail.site_id },
    select: { id: true, linkMethod: true, address: true },
  });

  // Build a complete device snapshot for the JSON column
  const deviceSnapshot = {
    gateways: detail.gateway?.gateways ?? [],
    batteries: detail.battery?.batteries ?? [],
    inverters: detail.inverter ?? [],
    meters: detail.meter ?? [],
    evse: detail.evse ?? [],
  };

  const siteData = {
    siteName: detail.site_name || detail.site_id,
    // Instance ID is derived from the client credential's scoped_instance_relationships
    // in the JWT — no separate env var needed
    instanceId: process.env.TESLA_POWERHUB_INSTANCE_ID || "",
    address: existing?.address || "",
    city: "",
    state: "",
    zip: null as string | null,
    addressHash: null as string | null,
    devices: JSON.parse(JSON.stringify(deviceSnapshot)),
    totalBatteryEnergy: totalBatteryEnergy || null,
    totalBatteryPower: totalBatteryPower || null,
    totalGateways: gatewayCount,
    totalBatteries: batteryCount,
    totalInverters: inverterCount,
    lastAssetSyncAt: new Date(),
  };

  // Use upsert to avoid race conditions between concurrent cron runs
  // that both see a site as "new" and try to create it simultaneously
  const upserted = await prisma.powerhubSite.upsert({
    where: { siteId: detail.site_id },
    update: siteData,
    create: {
      siteId: detail.site_id,
      ...siteData,
    },
  });

  if (existing) {
    result.sitesUpdated++;
  } else {
    result.sitesCreated++;
  }

  // Linkage: Tesla API doesn't return addresses, so auto-linkage
  // relies on site_name or manual admin assignment.
  // If address was manually set (e.g. by admin), try linkage.
  if (existing?.linkMethod === "UNLINKED" && existing?.address) {
    const street = normalizeAddress(existing.address);
    const linkResult = await linkSite(
      { street, city: "", state: "", zip: null },
      dealAddresses,
      prisma
    );
    if (linkResult) {
      await prisma.powerhubSite.update({
        where: { siteId: detail.site_id },
        data: {
          propertyId: linkResult.propertyId,
          dealId: linkResult.dealId,
          linkMethod: linkResult.method,
          linkConfidence: linkResult.confidence,
        },
      });
      result.sitesLinked++;
    }
  }
}

/** Fetch all deal addresses from HubSpot project cache for linkage matching */
async function fetchDealAddresses(): Promise<DealAddress[]> {
  const deals = await prisma.hubSpotProjectCache.findMany({
    where: {
      address: { not: null },
    },
    select: {
      dealId: true,
      address: true,
      city: true,
      state: true,
      zipCode: true,
    },
  });

  return deals
    .filter((d: { address: string | null }) => d.address)
    .map((d: { dealId: string; address: string | null; city: string | null; state: string | null; zipCode: string | null }) => ({
      dealId: d.dealId,
      street: normalizeAddress(d.address!),
      city: (d.city || "").toLowerCase().trim(),
      state: (d.state || "").toLowerCase().trim(),
      zip: d.zipCode || null,
    }));
}

// ─── Telemetry Poll ─────────────────────────────────────────────────────────

export interface TelemetryPollResult {
  totalActive: number;
  sitesBatched: number;
  sitesPolled: number;
  sitesUpdated: number;
  historyRowsInserted: number;
  errors: string[];
}

/**
 * Poll latest telemetry for ACTIVE sites, upsert snapshots,
 * insert history rows. Batched to stay within Vercel function limits.
 */
export async function pollTelemetry(): Promise<TelemetryPollResult> {
  const client = createPowerHubClient();
  const result: TelemetryPollResult = {
    totalActive: 0,
    sitesBatched: 0,
    sitesPolled: 0,
    sitesUpdated: 0,
    historyRowsInserted: 0,
    errors: [],
  };

  // Fetch ACTIVE sites ordered by least-recently-polled first
  const activeSites = await prisma.powerhubSite.findMany({
    where: { status: "ACTIVE" },
    select: { siteId: true },
    orderBy: { lastTelemetryAt: { sort: "asc", nulls: "first" } },
    take: TELEMETRY_BATCH_LIMIT,
  });

  // Also count total active for reporting
  result.totalActive = await prisma.powerhubSite.count({
    where: { status: "ACTIVE" },
  });
  result.sitesBatched = activeSites.length;

  for (let i = 0; i < activeSites.length; i += CHUNK_SIZE) {
    const chunk = activeSites.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (site: { siteId: string }) => {
        try {
          result.sitesPolled++;

          // First discover which signals this site supports,
          // then request only those. Tesla returns 400 if any
          // signal in the list is unsupported for the site.
          const availableMap = await client.getAvailableSignals(site.siteId);
          const availableSignals = TELEMETRY_SIGNALS.filter(
            (s) => availableMap[s] === true
          );

          if (availableSignals.length === 0) {
            // Site has no supported signals — skip but still mark polled
            await prisma.powerhubSite.update({
              where: { siteId: site.siteId },
              data: { lastTelemetryAt: new Date() },
            });
            return;
          }

          const signals = await client.getLastTelemetry(
            site.siteId,
            [...availableSignals]
          );

          if (!signals || signals.length === 0) return;

          // Build snapshot data from signals
          // Each signal has data_points: [{ value, timestamp }]
          const signalMap = new Map(
            signals.map((s) => [s.signal_name, s])
          );
          const firstTimestamp = signals[0]?.data_points?.[0]?.timestamp;
          const timestamp = firstTimestamp
            ? new Date(firstTimestamp)
            : new Date();

          const snapshotData = {
            timestamp,
            solarPowerW: signalNumericValue(signalMap.get("solar_instant_power")),
            solarEnergyTodayWh: signalNumericValue(signalMap.get("solar_energy_exported")),
            batteryPowerW: signalNumericValue(signalMap.get("battery_instant_power")),
            batterySocPercent: signalNumericValue(signalMap.get("battery_state_of_energy")),
            batteryEnergyRemainingWh: signalNumericValue(signalMap.get("battery_expected_energy_remaining")),
            gridPowerW: signalNumericValue(signalMap.get("site_instant_power")),
            gridEnergyImportedWh: signalNumericValue(signalMap.get("site_energy_imported")),
            gridEnergyExportedWh: signalNumericValue(signalMap.get("site_energy_exported")),
            loadPowerW: signalNumericValue(signalMap.get("load_instant_real_power")),
            gridConnectedStatus: signalStringValue(signalMap.get("grid_connected_status")),
            batteryMode: signalStringValue(signalMap.get("command_real_mode")),
            raw: JSON.parse(JSON.stringify(signals)),
          };

          // Upsert snapshot (one per site)
          await prisma.powerhubTelemetrySnapshot.upsert({
            where: { siteId: site.siteId },
            create: { siteId: site.siteId, ...snapshotData },
            update: snapshotData,
          });

          // Insert history rows — one per signal that has data_points
          const historyRows = signals
            .filter((s) => s.data_points?.length > 0 && s.data_points[0].value !== null)
            .map((s) => ({
              siteId: site.siteId,
              timestamp: new Date(s.data_points[0].timestamp),
              signalName: s.signal_name,
              value: typeof s.data_points[0].value === "number" ? s.data_points[0].value : null,
              valueString: typeof s.data_points[0].value === "string" ? String(s.data_points[0].value) : null,
              source: "POLL" as const,
            }));

          if (historyRows.length > 0) {
            await prisma.powerhubTelemetryHistory.createMany({
              data: historyRows,
            });
            result.historyRowsInserted += historyRows.length;
          }

          // Update site metadata
          await prisma.powerhubSite.update({
            where: { siteId: site.siteId },
            data: { lastTelemetryAt: new Date() },
          });

          result.sitesUpdated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Telemetry ${site.siteId}: ${msg}`);
        }
      })
    );

    if (i + CHUNK_SIZE < activeSites.length) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  // Emit SSE invalidation
  appCache.invalidate("powerhub:telemetry");

  return result;
}

// ─── Alert Poll ──────────────────────────────────────────────────────────────

export interface AlertPollResult {
  totalActive: number;
  sitesBatched: number;
  sitesPolled: number;
  alertsCreated: number;
  alertsResolved: number;
  errors: string[];
}

/**
 * Poll active alerts for ACTIVE sites, upsert new alerts,
 * resolve alerts no longer in the response. Batched to stay within limits.
 */
export async function pollAlerts(): Promise<AlertPollResult> {
  const client = createPowerHubClient();
  const result: AlertPollResult = {
    totalActive: 0,
    sitesBatched: 0,
    sitesPolled: 0,
    alertsCreated: 0,
    alertsResolved: 0,
    errors: [],
  };

  // Fetch ACTIVE sites ordered by least-recently-checked first
  const activeSites = await prisma.powerhubSite.findMany({
    where: { status: "ACTIVE" },
    select: { siteId: true, lastAlertCheckAt: true },
    orderBy: { lastAlertCheckAt: { sort: "asc", nulls: "first" } },
    take: ALERT_BATCH_LIMIT,
  });

  result.totalActive = await prisma.powerhubSite.count({
    where: { status: "ACTIVE" },
  });
  result.sitesBatched = activeSites.length;

  for (let i = 0; i < activeSites.length; i += CHUNK_SIZE) {
    const chunk = activeSites.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (site: { siteId: string; lastAlertCheckAt: Date | null }) => {
        try {
          result.sitesPolled++;

          const sinceTime = site.lastAlertCheckAt?.toISOString();
          const alerts = await client.getActiveAlerts(
            site.siteId,
            sinceTime || undefined
          );

          // Upsert each alert
          const activeAlertKeys = new Set<string>();
          for (const alert of alerts) {
            const deviceId = alert.device_id || "site";

            // Tesla sometimes returns invalid/missing reported_at — skip those
            const reportedAt = new Date(alert.reported_at);
            if (isNaN(reportedAt.getTime())) continue;

            const key = `${site.siteId}|${deviceId}|${alert.alert_name}|${reportedAt.toISOString()}`;
            activeAlertKeys.add(key);

            const existing = await prisma.powerhubAlert.findUnique({
              where: {
                siteId_deviceId_alertName_reportedAt: {
                  siteId: site.siteId,
                  deviceId,
                  alertName: alert.alert_name,
                  reportedAt,
                },
              },
            });

            if (!existing) {
              await prisma.powerhubAlert.create({
                data: {
                  siteId: site.siteId,
                  deviceId,
                  din: alert.din || null,
                  alertName: alert.alert_name,
                  description: alert.description,
                  severity: alert.severity.toUpperCase() as any,
                  isActive: true,
                  origin: alert.origin,
                  reportedAt,
                },
              });
              result.alertsCreated++;
            }
          }

          // Resolve alerts that are no longer active
          const currentlyActive = await prisma.powerhubAlert.findMany({
            where: { siteId: site.siteId, isActive: true },
            select: { id: true, deviceId: true, alertName: true, reportedAt: true },
          });

          for (const existing of currentlyActive) {
            const key = `${site.siteId}|${existing.deviceId}|${existing.alertName}|${existing.reportedAt.toISOString()}`;
            if (!activeAlertKeys.has(key)) {
              await prisma.powerhubAlert.update({
                where: { id: existing.id },
                data: { isActive: false, resolvedAt: new Date() },
              });
              result.alertsResolved++;
            }
          }

          // Update site metadata
          await prisma.powerhubSite.update({
            where: { siteId: site.siteId },
            data: { lastAlertCheckAt: new Date() },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Alerts ${site.siteId}: ${msg}`);
        }
      })
    );

    if (i + CHUNK_SIZE < activeSites.length) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  // Emit SSE invalidation — cascades to service priority queue via cacheKeyToQueryKeys
  appCache.invalidate("powerhub:alerts");

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the latest numeric value from a telemetry signal's data_points */
function signalNumericValue(signal: PowerHubTelemetrySignal | undefined): number | null {
  if (!signal?.data_points?.length) return null;
  const v = signal.data_points[0].value;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Extract the latest value as a string from a telemetry signal's data_points */
function signalStringValue(signal: PowerHubTelemetrySignal | undefined): string | null {
  if (!signal?.data_points?.length) return null;
  const v = signal.data_points[0].value;
  if (v === null || v === undefined) return null;
  return String(v);
}
