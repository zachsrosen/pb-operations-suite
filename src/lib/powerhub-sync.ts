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

import { createPowerHubClient, type PowerHubSiteDetail } from "./tesla-powerhub";
import {
  normalizeAddress,
  computeAddressHash,
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

// ─── Asset Sync ──────────────────────────────────────────────────────────────

export interface AssetSyncResult {
  sitesDiscovered: number;
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
    sitesCreated: 0,
    sitesUpdated: 0,
    sitesLinked: 0,
    errors: [],
  };

  // 1. Get all sites from Tesla
  const { sites: siteList } = await client.getSites();
  result.sitesDiscovered = siteList.length;

  // 2. Fetch deal addresses for linkage (batch query)
  const dealAddresses = await fetchDealAddresses();

  // 3. Process sites in chunks
  for (let i = 0; i < siteList.length; i += CHUNK_SIZE) {
    const chunk = siteList.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (siteSummary) => {
        try {
          const detail = await client.getSiteDetail(siteSummary.site_id);
          await upsertSite(detail, dealAddresses, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Site ${siteSummary.site_id}: ${msg}`);
        }
      })
    );

    // Pause between chunks
    if (i + CHUNK_SIZE < siteList.length) {
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
  const devices = detail.equipment || [];
  const gateways = devices.filter((d) => d.device_type === "gateway");
  const batteries = devices.filter((d) => d.device_type === "battery");
  const inverters = devices.filter((d) => d.device_type === "inverter");

  const totalBatteryEnergy = batteries.reduce(
    (sum, b) => sum + (b.nameplate_energy_wh || 0),
    0
  );
  const totalBatteryPower = batteries.reduce(
    (sum, b) => sum + (b.nameplate_power_w || 0),
    0
  );

  // Normalize address for hash
  const street = normalizeAddress(detail.address || "");
  const city = (detail.city || "").toLowerCase().trim();
  const state = (detail.state || "").toLowerCase().trim();
  const zip = detail.zip || null;
  const addressHash = street && city && state
    ? computeAddressHash(street, city, state, zip)
    : null;

  const existing = await prisma.powerhubSite.findUnique({
    where: { siteId: detail.site_id },
    select: { id: true, linkMethod: true },
  });

  const siteData = {
    siteName: detail.site_name,
    instanceId: process.env.TESLA_POWERHUB_INSTANCE_ID!,
    address: detail.address || "",
    city: detail.city || "",
    state: detail.state || "",
    zip,
    addressHash,
    devices: JSON.parse(JSON.stringify(devices)),
    totalBatteryEnergy: totalBatteryEnergy || null,
    totalBatteryPower: totalBatteryPower || null,
    totalGateways: gateways.length,
    totalBatteries: batteries.length,
    totalInverters: inverters.length,
    lastAssetSyncAt: new Date(),
  };

  if (existing) {
    await prisma.powerhubSite.update({
      where: { siteId: detail.site_id },
      data: siteData,
    });
    result.sitesUpdated++;

    // Only run linkage if still UNLINKED
    if (existing.linkMethod === "UNLINKED" && addressHash) {
      const linkResult = await linkSite(
        { street, city, state, zip },
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
  } else {
    // Create new site
    let linkData = {};
    if (addressHash) {
      const linkResult = await linkSite(
        { street, city, state, zip },
        dealAddresses,
        prisma
      );
      if (linkResult) {
        linkData = {
          propertyId: linkResult.propertyId,
          dealId: linkResult.dealId,
          linkMethod: linkResult.method,
          linkConfidence: linkResult.confidence,
        };
        result.sitesLinked++;
      }
    }

    await prisma.powerhubSite.create({
      data: {
        siteId: detail.site_id,
        ...siteData,
        ...linkData,
      },
    });
    result.sitesCreated++;
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
  sitesPolled: number;
  sitesUpdated: number;
  historyRowsInserted: number;
  errors: string[];
}

/**
 * Poll latest telemetry for all ACTIVE sites, upsert snapshots,
 * insert history rows.
 */
export async function pollTelemetry(): Promise<TelemetryPollResult> {
  const client = createPowerHubClient();
  const result: TelemetryPollResult = {
    sitesPolled: 0,
    sitesUpdated: 0,
    historyRowsInserted: 0,
    errors: [],
  };

  const activeSites = await prisma.powerhubSite.findMany({
    where: { status: "ACTIVE" },
    select: { siteId: true },
  });

  for (let i = 0; i < activeSites.length; i += CHUNK_SIZE) {
    const chunk = activeSites.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (site: { siteId: string }) => {
        try {
          result.sitesPolled++;
          const { signals } = await client.getLastTelemetry(
            site.siteId,
            [...TELEMETRY_SIGNALS]
          );

          if (!signals || signals.length === 0) return;

          // Build snapshot data from signals
          const signalMap = new Map(
            signals.map((s) => [s.signal_name, s])
          );
          const timestamp = signals[0]?.timestamp
            ? new Date(signals[0].timestamp)
            : new Date();

          const snapshotData = {
            timestamp,
            solarPowerW: numericValue(signalMap.get("solar_instant_power")),
            solarEnergyTodayWh: numericValue(signalMap.get("solar_energy_exported")),
            batteryPowerW: numericValue(signalMap.get("battery_instant_power")),
            batterySocPercent: numericValue(signalMap.get("battery_state_of_energy")),
            batteryEnergyRemainingWh: numericValue(signalMap.get("battery_expected_energy_remaining")),
            gridPowerW: numericValue(signalMap.get("site_instant_power")),
            gridEnergyImportedWh: numericValue(signalMap.get("site_energy_imported")),
            gridEnergyExportedWh: numericValue(signalMap.get("site_energy_exported")),
            loadPowerW: numericValue(signalMap.get("load_instant_real_power")),
            gridConnectedStatus: stringValue(signalMap.get("grid_connected_status")),
            batteryMode: stringValue(signalMap.get("command_real_mode")),
            raw: JSON.parse(JSON.stringify(signals)),
          };

          // Upsert snapshot (one per site)
          await prisma.powerhubTelemetrySnapshot.upsert({
            where: { siteId: site.siteId },
            create: { siteId: site.siteId, ...snapshotData },
            update: snapshotData,
          });

          // Insert history rows
          const historyRows = signals
            .filter((s) => s.value !== null)
            .map((s) => ({
              siteId: site.siteId,
              timestamp,
              signalName: s.signal_name,
              value: typeof s.value === "number" ? s.value : null,
              valueString: typeof s.value === "string" ? s.value : null,
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
  sitesPolled: number;
  alertsCreated: number;
  alertsResolved: number;
  errors: string[];
}

/**
 * Poll active alerts for all ACTIVE sites, upsert new alerts,
 * resolve alerts no longer in the response.
 */
export async function pollAlerts(): Promise<AlertPollResult> {
  const client = createPowerHubClient();
  const result: AlertPollResult = {
    sitesPolled: 0,
    alertsCreated: 0,
    alertsResolved: 0,
    errors: [],
  };

  const activeSites = await prisma.powerhubSite.findMany({
    where: { status: "ACTIVE" },
    select: { siteId: true, lastAlertCheckAt: true },
  });

  for (let i = 0; i < activeSites.length; i += CHUNK_SIZE) {
    const chunk = activeSites.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (site: { siteId: string; lastAlertCheckAt: Date | null }) => {
        try {
          result.sitesPolled++;

          const sinceTime = site.lastAlertCheckAt?.toISOString();
          const { alerts } = await client.getActiveAlerts(
            site.siteId,
            sinceTime || undefined
          );

          // Upsert each alert
          const activeAlertKeys = new Set<string>();
          for (const alert of alerts) {
            const deviceId = alert.device_id || "site";
            const key = `${site.siteId}|${deviceId}|${alert.alert_name}|${alert.reported_at}`;
            activeAlertKeys.add(key);

            const existing = await prisma.powerhubAlert.findUnique({
              where: {
                siteId_deviceId_alertName_reportedAt: {
                  siteId: site.siteId,
                  deviceId,
                  alertName: alert.alert_name,
                  reportedAt: new Date(alert.reported_at),
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
                  reportedAt: new Date(alert.reported_at),
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

function numericValue(signal: { value: number | string | null } | undefined): number | null {
  if (!signal || signal.value === null) return null;
  const n = Number(signal.value);
  return Number.isFinite(n) ? n : null;
}

function stringValue(signal: { value: number | string | null } | undefined): string | null {
  if (!signal || signal.value === null) return null;
  return String(signal.value);
}
