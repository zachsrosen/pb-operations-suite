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

import { computePortalUrl, createPowerHubClient, type PowerHubSiteDetail, type PowerHubTelemetrySignal } from "./tesla-powerhub";
import {
  normalizeAddress,
  linkSite,
  type DealAddress,
} from "./powerhub-linkage";
import { enqueueCrossSystemPush } from "./powerhub-crosslink";
import { prisma } from "./db";
import { Prisma } from "@/generated/prisma/client";
import { appCache } from "./cache";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Telemetry signals to poll per site */
// All signals Tesla's /v2/telemetry/last can return per site. We always
// request the full set — `getAvailableSignals` is called first per site, so
// we only end up requesting the subset Tesla flagged as available. Adding a
// signal here is safe: missing signals come back as null in the response and
// we write null to the snapshot column.
const TELEMETRY_SIGNALS = [
  // Power (instantaneous)
  "solar_instant_power",
  "solar_instant_power_rgm",
  "solar_reactive_power",
  "solar_real_power_limit",
  "battery_instant_power",
  "battery_charge_power",
  "battery_discharge_power",
  "battery_instant_reactive_power",
  "battery_target_power",
  "battery_target_reactive_power",
  "max_charge_power",
  "max_discharge_power",
  "estimated_battery_power_next_period",
  "site_instant_power",
  "load_instant_real_power",
  "grid_services_instant_power",
  // Battery state
  "battery_state_of_energy",
  "battery_expected_energy_remaining_percentage",
  "battery_expected_energy_remaining",
  "battery_nominal_full_pack_energy",
  "backup_reserve",
  "battery_fault",
  // Cumulative energy
  "solar_energy_exported",
  "solar_energy_imported",
  "solar_energy_exported_rgm",
  "battery_energy_imported",
  "battery_energy_exported",
  "site_energy_imported",
  "site_energy_exported",
  "load_energy_imported",
  "solar_to_load_energy",
  "solar_to_battery_energy",
  "battery_to_load_energy",
  "grid_services_energy_imported",
  "grid_services_energy_exported",
  // Grid quality
  "voltage",
  "grid_voltage",
  "chassis_voltage",
  "frequency",
  // Grid / island state
  "grid_connected_status",
  "island_mode",
  "islander_disconnected",
  "breaker_open_status",
  "grid_ready_sync",
  "off_grid_fault_state",
  "loads_dropped",
  "system_shutdown",
  // Operational + control
  "command_real_mode",
  "opticaster_control_reason_code",
  "is_primary",
  "wait_for_user_low_soe",
  "wait_for_user_manual_backup",
  "wait_for_user_no_inverters_ready",
  "wait_for_user_retries_exhausted",
  // Comms health
  "battery_comms",
  "battery_meter_comms",
  "site_meter_comms",
  "solar_meter_comms",
  // Rate plan
  "energy_buy_price",
  "energy_sell_price",
  "customer_energy_buy_price",
  "customer_energy_sell_price",
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
 * Now that we filter to provisioned sites only (~2400 vs 3100 total),
 * we can be more aggressive with batch sizes.
 * Telemetry: 2 API calls per site (available signals + last telemetry).
 * At 4 req/sec: 50 sites × 2 calls = 100 calls ≈ ~28s. Well within 300s limit.
 */
const TELEMETRY_BATCH_LIMIT = 50;

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
    select: { id: true, linkMethod: true, address: true, city: true, state: true, zip: true, addressHash: true, dealId: true, propertyId: true },
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
    aggregatorSiteId: detail.aggregator_site_identifier || null,
    portalUrl: computePortalUrl(detail.site_id),
    address: existing?.address || "",
    city: existing?.city || "",
    state: existing?.state || "",
    zip: existing?.zip ?? (null as string | null),
    addressHash: existing?.addressHash ?? (null as string | null),
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
  await prisma.powerhubSite.upsert({
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

  // Track post-link state so the cross-system cascade at the bottom of this
  // function sees the freshest propertyId / linkMethod after any link update.
  let finalPropertyId: string | null = existing?.propertyId ?? null;
  let finalLinkMethod: string = existing?.linkMethod ?? "UNLINKED";

  // Linkage: Tesla API doesn't return addresses, so auto-linkage
  // relies on site_name or manual admin assignment.
  // If address was manually set (e.g. by admin), try linkage.
  if (existing?.linkMethod === "UNLINKED" && existing?.address) {
    const street = normalizeAddress(existing.address);
    const linkResult = await linkSite(
      { street, city: existing.city || "", state: existing.state || "", zip: existing.zip || null },
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
      finalPropertyId = linkResult.propertyId;
      finalLinkMethod = linkResult.method;
    }
  }

  // Backfill address from deal cache for linked sites with empty addresses.
  // Tesla API never provides addresses, so we populate them from the HubSpot
  // deal cache once a site is linked (auto or manual).
  const linkedDealId = existing?.dealId;
  if (linkedDealId && !existing?.address) {
    const dealCache = await prisma.hubSpotProjectCache.findUnique({
      where: { dealId: linkedDealId },
      select: { address: true, city: true, state: true, zipCode: true },
    });
    if (dealCache?.address) {
      await prisma.powerhubSite.update({
        where: { siteId: detail.site_id },
        data: {
          address: dealCache.address,
          city: dealCache.city || "",
          state: dealCache.state || "",
          zip: dealCache.zipCode || null,
        },
      });
    }
  }

  // Trigger cross-system propagation (resolve primary site → push to HubSpot
  // Property/Deals/Tickets; Zuper picks up via cache.updatedAt on next cron).
  // No-ops when POWERHUB_CROSSLINK_ENABLED !== "true". Errors are caught
  // internally so this await never throws.
  if (finalPropertyId && finalLinkMethod !== "UNLINKED") {
    await enqueueCrossSystemPush(finalPropertyId);
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

  // Fetch ACTIVE sites with devices, ordered by least-recently-polled first.
  // Skip shell sites with no gateways/batteries/inverters — they have no
  // telemetry signals and waste API calls + batch budget.
  const provisionedFilter = {
    status: "ACTIVE" as const,
    OR: [
      { totalGateways: { gt: 0 } },
      { totalBatteries: { gt: 0 } },
      { totalInverters: { gt: 0 } },
    ],
  };
  const activeSites = await prisma.powerhubSite.findMany({
    where: provisionedFilter,
    select: { siteId: true },
    orderBy: { lastTelemetryAt: { sort: "asc", nulls: "first" } },
    take: TELEMETRY_BATCH_LIMIT,
  });

  // Also count total provisioned for reporting
  result.totalActive = await prisma.powerhubSite.count({
    where: provisionedFilter,
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

          // Prefer the direct SoC percentage signal when available; fall back
          // to battery_state_of_energy (older Powerwall firmware). The
          // remaining-percentage signal returns 0–100 directly.
          const socPctDirect = signalNumericValue(signalMap.get("battery_expected_energy_remaining_percentage"));
          const socLegacy = signalNumericValue(signalMap.get("battery_state_of_energy"));

          const snapshotData = {
            timestamp,
            // Power flows (instantaneous)
            solarPowerW: signalNumericValue(signalMap.get("solar_instant_power")),
            solarPowerRgmW: signalNumericValue(signalMap.get("solar_instant_power_rgm")),
            solarReactivePowerVar: signalNumericValue(signalMap.get("solar_reactive_power")),
            solarRealPowerLimitW: signalNumericValue(signalMap.get("solar_real_power_limit")),
            batteryPowerW: signalNumericValue(signalMap.get("battery_instant_power")),
            batteryChargePowerW: signalNumericValue(signalMap.get("battery_charge_power")),
            batteryDischargePowerW: signalNumericValue(signalMap.get("battery_discharge_power")),
            batteryReactivePowerVar: signalNumericValue(signalMap.get("battery_instant_reactive_power")),
            batteryTargetPowerW: signalNumericValue(signalMap.get("battery_target_power")),
            batteryTargetReactiveVar: signalNumericValue(signalMap.get("battery_target_reactive_power")),
            batteryMaxChargeW: signalNumericValue(signalMap.get("max_charge_power")),
            batteryMaxDischargeW: signalNumericValue(signalMap.get("max_discharge_power")),
            estimatedBatteryNextPeriodW: signalNumericValue(signalMap.get("estimated_battery_power_next_period")),
            gridPowerW: signalNumericValue(signalMap.get("site_instant_power")),
            loadPowerW: signalNumericValue(signalMap.get("load_instant_real_power")),
            gridServicesPowerW: signalNumericValue(signalMap.get("grid_services_instant_power")),
            // Battery state
            batterySocPercent: socPctDirect ?? socLegacy,
            batteryEnergyRemainingWh: signalNumericValue(signalMap.get("battery_expected_energy_remaining")),
            batteryNominalCapacityWh: signalNumericValue(signalMap.get("battery_nominal_full_pack_energy")),
            backupReservePercent: signalNumericValue(signalMap.get("backup_reserve")),
            batteryFault: signalBoolValue(signalMap.get("battery_fault")),
            // Cumulative energy
            solarEnergyTodayWh: signalNumericValue(signalMap.get("solar_energy_exported")),
            solarEnergyImportedWh: signalNumericValue(signalMap.get("solar_energy_imported")),
            solarEnergyExportedRgmWh: signalNumericValue(signalMap.get("solar_energy_exported_rgm")),
            batteryEnergyImportedWh: signalNumericValue(signalMap.get("battery_energy_imported")),
            batteryEnergyExportedWh: signalNumericValue(signalMap.get("battery_energy_exported")),
            gridEnergyImportedWh: signalNumericValue(signalMap.get("site_energy_imported")),
            gridEnergyExportedWh: signalNumericValue(signalMap.get("site_energy_exported")),
            loadEnergyImportedWh: signalNumericValue(signalMap.get("load_energy_imported")),
            solarToLoadEnergyWh: signalNumericValue(signalMap.get("solar_to_load_energy")),
            solarToBatteryEnergyWh: signalNumericValue(signalMap.get("solar_to_battery_energy")),
            batteryToLoadEnergyWh: signalNumericValue(signalMap.get("battery_to_load_energy")),
            gridServicesEnergyInWh: signalNumericValue(signalMap.get("grid_services_energy_imported")),
            gridServicesEnergyOutWh: signalNumericValue(signalMap.get("grid_services_energy_exported")),
            // Grid quality
            voltageV: signalNumericValue(signalMap.get("voltage")),
            gridVoltageV: signalNumericValue(signalMap.get("grid_voltage")),
            chassisVoltageV: signalNumericValue(signalMap.get("chassis_voltage")),
            frequencyHz: signalNumericValue(signalMap.get("frequency")),
            // Grid / island state
            gridConnectedStatus: signalStringValue(signalMap.get("grid_connected_status")),
            islandMode: signalStringValue(signalMap.get("island_mode")),
            islanderDisconnected: signalBoolValue(signalMap.get("islander_disconnected")),
            breakerOpenStatus: signalBoolValue(signalMap.get("breaker_open_status")),
            gridReadySync: signalBoolValue(signalMap.get("grid_ready_sync")),
            offGridFaultState: signalStringValue(signalMap.get("off_grid_fault_state")),
            loadsDropped: signalBoolValue(signalMap.get("loads_dropped")),
            systemShutdown: signalBoolValue(signalMap.get("system_shutdown")),
            // Operational + control
            batteryMode: signalStringValue(signalMap.get("command_real_mode")),
            opticasterReasonCode: signalStringValue(signalMap.get("opticaster_control_reason_code")),
            isPrimaryGateway: signalBoolValue(signalMap.get("is_primary")),
            waitForUserLowSoe: signalBoolValue(signalMap.get("wait_for_user_low_soe")),
            waitForUserManualBackup: signalBoolValue(signalMap.get("wait_for_user_manual_backup")),
            waitForUserNoInverters: signalBoolValue(signalMap.get("wait_for_user_no_inverters_ready")),
            waitForUserRetriesDone: signalBoolValue(signalMap.get("wait_for_user_retries_exhausted")),
            // Comms health
            commsBattery: signalBoolValue(signalMap.get("battery_comms")),
            commsBatteryMeter: signalBoolValue(signalMap.get("battery_meter_comms")),
            commsSiteMeter: signalBoolValue(signalMap.get("site_meter_comms")),
            commsSolarMeter: signalBoolValue(signalMap.get("solar_meter_comms")),
            // Rate plan
            energyBuyPrice: signalNumericValue(signalMap.get("energy_buy_price")),
            energySellPrice: signalNumericValue(signalMap.get("energy_sell_price")),
            customerEnergyBuyPrice: signalNumericValue(signalMap.get("customer_energy_buy_price")),
            customerEnergySellPrice: signalNumericValue(signalMap.get("customer_energy_sell_price")),

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
  alertsFetched: number;
  alertsCreated: number;
  alertsResolved: number;
  alertsMapped: number;
  alertsUnmapped: number;
  errors: string[];
}

/**
 * Poll active alerts at the GROUP level (Tesla's alert API returns alerts
 * per-group, not per-site). Alerts are mapped to sites via DIN matching
 * against the devices JSON on PowerhubSite.
 *
 * Pagination: Tesla returns up to 100 alerts per page with a next_cursor.
 * We fetch up to 5 pages (500 alerts) per cron invocation to stay within
 * Vercel function time limits.
 */
const ALERT_MAX_PAGES = 5;

export async function pollAlerts(): Promise<AlertPollResult> {
  const client = createPowerHubClient();
  const result: AlertPollResult = {
    alertsFetched: 0,
    alertsCreated: 0,
    alertsResolved: 0,
    alertsMapped: 0,
    alertsUnmapped: 0,
    errors: [],
  };

  try {
    // 1. Get our group ID (we have one group: "Photon Brothers")
    const groups = await client.getGroups();
    if (groups.length === 0) {
      result.errors.push("No groups found");
      return result;
    }
    const groupId = groups[0].group_id;

    // 2. Build DIN → siteId lookup from all provisioned sites
    const sites = await prisma.powerhubSite.findMany({
      where: {
        OR: [
          { totalGateways: { gt: 0 } },
          { totalBatteries: { gt: 0 } },
          { totalInverters: { gt: 0 } },
        ],
      },
      select: { siteId: true, devices: true },
    });

    const dinToSiteId = new Map<string, string>();
    for (const site of sites) {
      const devObj = site.devices as Record<string, Array<{ din?: string }>> | null;
      if (!devObj || typeof devObj !== "object") continue;
      for (const category of Object.values(devObj)) {
        if (!Array.isArray(category)) continue;
        for (const device of category) {
          if (device.din) {
            dinToSiteId.set(device.din, site.siteId);
          }
        }
      }
    }

    // 3. Fetch alerts (paginated, up to ALERT_MAX_PAGES pages)
    const allAlerts: Array<{
      alertId: string;
      siteId: string;
      din: string | null;
      deviceId: string;
      alertName: string;
      description: string;
      severity: "CRITICAL" | "PERFORMANCE" | "INFORMATIONAL";
      reportedAt: Date;
      teslaAlertId: string | null;
      alias: string | null;
      ecuPart: string | null;
      ecuSerial: string | null;
      bcPart: string | null;
      bcSerial: string | null;
      toolboxId: string | null;
      alertTags: unknown;
      symptomCodes: unknown;
      supportAutoTicketUrl: string | null;
    }> = [];

    let cursor: string | undefined;
    for (let page = 0; page < ALERT_MAX_PAGES; page++) {
      const response = await client.getActiveAlerts(groupId, cursor);
      const alerts = response.data || [];
      result.alertsFetched += alerts.length;

      for (const alert of alerts) {
        const reportedAt = new Date(alert.start_time);
        if (isNaN(reportedAt.getTime())) continue;

        // Map DIN to site
        const siteId = alert.din ? dinToSiteId.get(alert.din) || null : null;
        if (siteId) {
          result.alertsMapped++;
        } else {
          result.alertsUnmapped++;
        }

        // Skip alerts we can't map to a site
        if (!siteId) continue;

        // Normalize severity to match Prisma enum
        const rawSev = alert.severity?.toUpperCase() || "";
        const severity: "CRITICAL" | "PERFORMANCE" | "INFORMATIONAL" =
          rawSev === "CRITICAL" ? "CRITICAL" :
          rawSev === "PERFORMANCE" ? "PERFORMANCE" :
          "INFORMATIONAL"; // ReturnMerchandiseAuthorization, etc. → INFORMATIONAL

        allAlerts.push({
          alertId: alert.alert_id,
          siteId,
          din: alert.din || null,
          deviceId: alert.device_id || alert.din || "site",
          alertName: alert.alert_name,
          description: alert.description,
          severity,
          reportedAt,
          teslaAlertId: alert.alert_id || null,
          alias: alert.alias ?? null,
          ecuPart: alert.ecu_part ?? null,
          ecuSerial: alert.ecu_serial ?? null,
          bcPart: alert.bc_part ?? null,
          bcSerial: alert.bc_serial ?? null,
          toolboxId: alert.toolbox_id ?? null,
          alertTags: alert.alert_tags ?? null,
          symptomCodes: alert.symptom_codes ?? null,
          supportAutoTicketUrl: alert.support_auto_ticket_url ?? null,
        });
      }

      // Check for more pages
      const nextCursor = response.metadata?.next_cursor;
      if (!nextCursor) break;
      cursor = nextCursor;

      // Rate limit between pages
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }

    // 4. Upsert alerts in DB
    const activeAlertIds = new Set<string>();
    for (const alert of allAlerts) {
      activeAlertIds.add(`${alert.siteId}|${alert.deviceId}|${alert.alertName}|${alert.reportedAt.toISOString()}`);

      const existing = await prisma.powerhubAlert.findUnique({
        where: {
          siteId_deviceId_alertName_reportedAt: {
            siteId: alert.siteId,
            deviceId: alert.deviceId,
            alertName: alert.alertName,
            reportedAt: alert.reportedAt,
          },
        },
      });

      if (!existing) {
        await prisma.powerhubAlert.create({
          data: {
            siteId: alert.siteId,
            deviceId: alert.deviceId,
            din: alert.din,
            alertName: alert.alertName,
            description: alert.description,
            severity: alert.severity,
            isActive: true,
            origin: "powerhub",
            reportedAt: alert.reportedAt,
            teslaAlertId: alert.teslaAlertId,
            alias: alert.alias,
            ecuPart: alert.ecuPart,
            ecuSerial: alert.ecuSerial,
            bcPart: alert.bcPart,
            bcSerial: alert.bcSerial,
            toolboxId: alert.toolboxId,
            // Prisma Json columns accept null + JSON-serializable values
            alertTags: alert.alertTags as Prisma.InputJsonValue | undefined,
            symptomCodes: alert.symptomCodes as Prisma.InputJsonValue | undefined,
            supportAutoTicketUrl: alert.supportAutoTicketUrl,
          },
        });
        result.alertsCreated++;
      } else {
        // Backfill richer fields onto pre-existing rows so a one-time
        // upgrade doesn't require a separate migration script.
        await prisma.powerhubAlert.update({
          where: { id: existing.id },
          data: {
            teslaAlertId: alert.teslaAlertId,
            alias: alert.alias,
            ecuPart: alert.ecuPart,
            ecuSerial: alert.ecuSerial,
            bcPart: alert.bcPart,
            bcSerial: alert.bcSerial,
            toolboxId: alert.toolboxId,
            alertTags: alert.alertTags as Prisma.InputJsonValue | undefined,
            symptomCodes: alert.symptomCodes as Prisma.InputJsonValue | undefined,
            supportAutoTicketUrl: alert.supportAutoTicketUrl,
          },
        });
      }
    }

    // 5. Resolve alerts that are no longer in the active set
    //    Only resolve for sites that appeared in this poll — don't resolve
    //    alerts for sites we didn't fetch alerts about.
    const siteIdsInPoll = new Set(allAlerts.map((a) => a.siteId));
    if (siteIdsInPoll.size > 0) {
      const currentlyActive = await prisma.powerhubAlert.findMany({
        where: {
          siteId: { in: [...siteIdsInPoll] },
          isActive: true,
        },
        select: { id: true, siteId: true, deviceId: true, alertName: true, reportedAt: true },
      });

      for (const existing of currentlyActive) {
        const key = `${existing.siteId}|${existing.deviceId}|${existing.alertName}|${existing.reportedAt.toISOString()}`;
        if (!activeAlertIds.has(key)) {
          await prisma.powerhubAlert.update({
            where: { id: existing.id },
            data: { isActive: false, resolvedAt: new Date() },
          });
          result.alertsResolved++;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Alert poll: ${msg}`);
  }

  // Emit SSE invalidation
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

/**
 * Extract the latest value as a boolean. Tesla returns booleans as 0/1
 * numbers or "true"/"false" strings depending on the signal — handle both.
 */
function signalBoolValue(signal: PowerHubTelemetrySignal | undefined): boolean | null {
  if (!signal?.data_points?.length) return null;
  const v = signal.data_points[0].value;
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return null;
}
