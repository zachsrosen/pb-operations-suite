/**
 * src/lib/powerhub-crosslink.ts
 *
 * Cross-system propagation of Tesla PowerHub portal links into
 * HubSpot Property/Deal/Ticket records and Zuper Property/Job custom fields.
 *
 * Entry points (added in subsequent tasks):
 *   - resolvePrimarySite(propertyId)
 *   - pushToHubSpotForProperty(propertyId)
 *   - enqueueCrossSystemPush(propertyId)
 *
 * All entry points no-op when POWERHUB_CROSSLINK_ENABLED !== "true".
 */

import { prisma } from "@/lib/db";
import { updateDealProperty } from "@/lib/hubspot";
import { updateTicketProperties } from "@/lib/hubspot-tickets";
import { updateProperty as updateHubSpotProperty } from "@/lib/hubspot-property";

const CROSSLINK_FLAG = "POWERHUB_CROSSLINK_ENABLED";

function isCrosslinkEnabled(): boolean {
  return process.env[CROSSLINK_FLAG] === "true";
}

export interface PrimarySiteCandidate {
  id: string;
  siteName: string;
  createdAt: Date;
  totalGateways: number;
  totalBatteries: number;
  totalInverters: number;
}

const STE_PATTERN = /^STE(\d{8})-\d+$/;

/**
 * Parse the date portion of a Tesla STE site name.
 * Format: STE<YYYYMMDD>-<NNN>
 * Returns null if the name doesn't match the pattern or the date is invalid.
 */
export function parseSteDateFromName(name: string): Date | null {
  const m = name?.match(STE_PATTERN);
  if (!m) return null;
  const ymd = m[1];
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  if (year < 2000 || year > 2099) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Use UTC to avoid timezone drift
  const dt = new Date(Date.UTC(year, month - 1, day));
  // Validate (e.g., Feb 30 rolls over to March)
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/**
 * Build a denormalized device-summary block from a PowerhubSite's `devices`
 * JSON column. Used by resolvePrimarySite() to populate the cache columns
 * pushed to HubSpot Property/Deal/Ticket + Zuper Property/Job.
 *
 * Tesla's payload uses snake_case; this helper projects into typed fields
 * (serial + model/part_number per device class) + a formatted multi-line
 * string suitable for display or copy-paste into Tesla support tickets.
 */
export interface DeviceSummary {
  gatewaySerial: string | null;
  powerwallSerials: string | null; // Semicolon-joined for multi-Powerwall sites
  inverterSerial: string | null;
  meterSerial: string | null;
  gatewayModel: string | null;
  powerwallModel: string | null;
  inverterModel: string | null;
  meterModel: string | null;
  formatted: string | null;
}

export function buildDeviceSummary(devicesJson: unknown): DeviceSummary {
  const root = (devicesJson ?? {}) as Record<string, unknown>;
  const asArray = (k: string): Record<string, unknown>[] => {
    const v = root[k];
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  };
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  const gateways = asArray("gateways").map((d) => ({
    sn: str(d.serial_number),
    pn: str(d.part_number),
    eWh: typeof d.nameplate_energy_watt_hours === "number" ? d.nameplate_energy_watt_hours : null,
    pW: typeof d.nameplate_max_discharge_power_watts === "number" ? d.nameplate_max_discharge_power_watts : null,
  }));
  const batteries = asArray("batteries").map((d) => ({ sn: str(d.serial_number), pn: str(d.part_number) }));
  const inverters = asArray("inverters").map((d) => ({ sn: str(d.serial_number), pn: str(d.part_number) }));
  const meters = asArray("meters").map((d) => ({ sn: str(d.serial_number), pn: str(d.part_number) }));

  const firstNonEmpty = (arr: { pn: string }[]): string | null => {
    for (const item of arr) if (item.pn) return item.pn;
    return null;
  };

  const gatewaySerial = gateways[0]?.sn || null;
  const powerwallSerials = batteries.length > 0
    ? batteries.map((b) => b.sn).filter((s) => s.length > 0).join("; ") || null
    : null;
  const inverterSerial = inverters[0]?.sn || null;
  const meterSerial = meters[0]?.sn || null;

  const gatewayModel = firstNonEmpty(gateways);
  const powerwallModel = firstNonEmpty(batteries);
  const inverterModel = firstNonEmpty(inverters);
  const meterModel = firstNonEmpty(meters);

  const lines: string[] = [];
  for (const g of gateways) {
    const tail = g.pn || g.eWh != null || g.pW != null
      ? " (" + [g.pn, g.eWh != null && `${(g.eWh / 1000).toFixed(1)} kWh`, g.pW != null && `${(g.pW / 1000).toFixed(1)} kW max`].filter(Boolean).join(", ") + ")"
      : "";
    lines.push(`Gateway: ${g.sn}${tail}`);
  }
  for (const b of batteries) lines.push(`Powerwall: ${b.sn}${b.pn ? ` (${b.pn})` : ""}`);
  for (const i of inverters) lines.push(`Inverter: ${i.sn}${i.pn ? ` (${i.pn})` : ""}`);
  for (const m of meters) lines.push(`Meter: ${m.sn}${m.pn ? ` (${m.pn})` : ""}`);
  const formatted = lines.length > 0 ? lines.join("\n") : null;

  return {
    gatewaySerial,
    powerwallSerials,
    inverterSerial,
    meterSerial,
    gatewayModel,
    powerwallModel,
    inverterModel,
    meterModel,
    formatted,
  };
}

/**
 * Choose the primary site from a list of candidates.
 *
 * Rules:
 *   1. Sites with equipment (gateways/batteries/inverters) beat empty sites
 *   2. Newest STE date wins
 *   3. Tie → lexicographically max siteName
 *   4. No STE pattern → newest createdAt
 *   5. STE-named sites beat any fallback-named site
 *   6. Final tie-break: lexicographically max id (cuid)
 *
 * Returns null only if the input is empty.
 */
export function pickPrimarySite<T extends PrimarySiteCandidate>(sites: T[]): T | null {
  if (sites.length === 0) return null;
  const enriched = sites.map((s) => ({
    site: s,
    steDate: parseSteDateFromName(s.siteName),
    hasEquipment:
      (s.totalGateways ?? 0) + (s.totalBatteries ?? 0) + (s.totalInverters ?? 0) > 0,
  }));
  enriched.sort((a, b) => {
    // Sites with equipment always beat empty sites
    if (a.hasEquipment && !b.hasEquipment) return -1;
    if (!a.hasEquipment && b.hasEquipment) return 1;
    // STE-named always beats fallback-named
    if (a.steDate && !b.steDate) return -1;
    if (!a.steDate && b.steDate) return 1;
    // Both STE-named
    if (a.steDate && b.steDate) {
      const diff = b.steDate.getTime() - a.steDate.getTime();
      if (diff !== 0) return diff;
      // Tie: lexicographic siteName desc
      if (a.site.siteName !== b.site.siteName) {
        return b.site.siteName.localeCompare(a.site.siteName);
      }
    } else {
      // Both fallback: newest createdAt desc
      const diff = b.site.createdAt.getTime() - a.site.createdAt.getTime();
      if (diff !== 0) return diff;
    }
    // Final tie-break: lexicographic id desc
    return b.site.id.localeCompare(a.site.id);
  });
  return enriched[0].site;
}

export interface ResolvedPrimarySite {
  id: string;
  siteId: string;
  siteName: string;
  portalUrl: string | null;
}

/**
 * Look up all PowerhubSite rows for a property, pick the primary, write
 * the `primaryForProperty` flag, and update the denormalized
 * teslaPortalUrl + teslaSiteId on HubSpotPropertyCache.
 *
 * Returns the primary site (or null if no sites are linked to this property).
 *
 * Idempotent: safe to call repeatedly. Race-safe via the partial unique
 * index — if a concurrent caller flips primaryForProperty on a different
 * site, this caller's update will hit the index constraint and we retry once.
 */
export async function resolvePrimarySite(propertyId: string): Promise<ResolvedPrimarySite | null> {
  const sites = await prisma.powerhubSite.findMany({
    where: { propertyId },
    select: {
      id: true,
      siteId: true,
      siteName: true,
      portalUrl: true,
      createdAt: true,
      primaryForProperty: true,
      devices: true,
      totalGateways: true,
      totalBatteries: true,
      totalInverters: true,
    },
  });

  if (sites.length === 0) {
    // No sites: clear cache + demote any orphaned primary flags (defense in depth).
    // Use updateMany (not update) so a missing HubSpotPropertyCache row is a no-op
    // instead of P2025 — the backfill iterates from PowerhubSite.propertyId which
    // can outlive the corresponding cache row.
    await prisma.hubSpotPropertyCache.updateMany({
      where: { id: propertyId },
      data: {
        teslaPortalUrl: null,
        teslaSiteId: null,
        teslaGatewaySerial: null,
        teslaPowerwallSerials: null,
        teslaInverterSerial: null,
        teslaMeterSerial: null,
        teslaGatewayModel: null,
        teslaPowerwallModel: null,
        teslaInverterModel: null,
        teslaMeterModel: null,
        teslaHardwareSummary: null,
      },
    });
    return null;
  }

  const primary = pickPrimarySite(sites)!;

  // Two writes in sequence (NOT a transaction — the demote-then-promote order
  // avoids the partial unique index conflict naturally).
  await prisma.powerhubSite.updateMany({
    where: { propertyId, id: { not: primary.id } },
    data: { primaryForProperty: false },
  });
  await retryOnUniqueConflict(() =>
    prisma.powerhubSite.update({
      where: { id: primary.id },
      data: { primaryForProperty: true },
    })
  );

  // Update denormalized fields on the property cache, including device
  // summary derived from the primary site's `devices` JSON.
  const summary = buildDeviceSummary(primary.devices);
  await prisma.hubSpotPropertyCache.updateMany({
    where: { id: propertyId },
    data: {
      teslaPortalUrl: primary.portalUrl,
      teslaSiteId: primary.siteId,
      teslaGatewaySerial: summary.gatewaySerial,
      teslaPowerwallSerials: summary.powerwallSerials,
      teslaInverterSerial: summary.inverterSerial,
      teslaMeterSerial: summary.meterSerial,
      teslaGatewayModel: summary.gatewayModel,
      teslaPowerwallModel: summary.powerwallModel,
      teslaInverterModel: summary.inverterModel,
      teslaMeterModel: summary.meterModel,
      teslaHardwareSummary: summary.formatted,
    },
  });

  return {
    id: primary.id,
    siteId: primary.siteId,
    siteName: primary.siteName,
    portalUrl: primary.portalUrl,
  };
}

/**
 * Retry helper for the partial unique index race: a concurrent caller may
 * have promoted a different site, so we retry once after re-demoting.
 */
async function retryOnUniqueConflict<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      // Tiny jitter before retry
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Push tesla_portal_url + tesla_site_id to HubSpot Property + all linked
 * Deals + all linked Tickets. Reads denormalized fields from
 * HubSpotPropertyCache (which must be up to date — call resolvePrimarySite
 * first if needed).
 *
 * No-ops if POWERHUB_CROSSLINK_ENABLED !== "true".
 *
 * Failures on individual deal/ticket updates are logged but don't stop the
 * batch — partial-success is preferable to all-or-nothing rollback for
 * idempotent property writes.
 */
export async function pushToHubSpotForProperty(propertyId: string): Promise<void> {
  if (!isCrosslinkEnabled()) return;

  const cache = await prisma.hubSpotPropertyCache.findUnique({
    where: { id: propertyId },
    include: { dealLinks: true, ticketLinks: true },
  });
  if (!cache) {
    console.warn(`[powerhub-crosslink] Property ${propertyId} not found in cache; skipping push`);
    return;
  }

  const props = {
    tesla_portal_url: cache.teslaPortalUrl,
    tesla_site_id: cache.teslaSiteId,
    tesla_gateway_serial: cache.teslaGatewaySerial,
    tesla_powerwall_serials: cache.teslaPowerwallSerials,
    tesla_inverter_serial: cache.teslaInverterSerial,
    tesla_meter_serial: cache.teslaMeterSerial,
    tesla_gateway_model: cache.teslaGatewayModel,
    tesla_powerwall_model: cache.teslaPowerwallModel,
    tesla_inverter_model: cache.teslaInverterModel,
    tesla_meter_model: cache.teslaMeterModel,
    tesla_hardware_summary: cache.teslaHardwareSummary,
  };

  // 1. HubSpot Property object
  try {
    await updateHubSpotProperty(cache.hubspotObjectId, props);
  } catch (err) {
    console.error(
      `[powerhub-crosslink] Failed to update HubSpot Property ${cache.hubspotObjectId}:`,
      err
    );
  }

  // 2. Deals — push in parallel with Promise.allSettled
  const dealResults = await Promise.allSettled(
    cache.dealLinks.map((link) => updateDealProperty(link.dealId, props))
  );
  const dealFailures = dealResults.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === false)
  ).length;
  if (dealFailures > 0) {
    console.warn(
      `[powerhub-crosslink] ${dealFailures}/${cache.dealLinks.length} deal updates failed for property ${propertyId}`
    );
  }

  // 3. Tickets — push in parallel with Promise.allSettled
  const ticketResults = await Promise.allSettled(
    cache.ticketLinks.map((link) => updateTicketProperties(link.ticketId, props))
  );
  const ticketFailures = ticketResults.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === false)
  ).length;
  if (ticketFailures > 0) {
    console.warn(
      `[powerhub-crosslink] ${ticketFailures}/${cache.ticketLinks.length} ticket updates failed for property ${propertyId}`
    );
  }
}

/**
 * Full cross-system cascade for a property:
 *   1. resolvePrimarySite — pick primary, update flags + denormalized cache fields
 *      (this updates HubSpotPropertyCache.updatedAt, which is the dirty signal
 *      for the existing zuper-property-sync cron)
 *   2. pushToHubSpotForProperty — push URL to HubSpot Property + Deals + Tickets
 *
 * The Zuper push happens asynchronously: the cache update from step 1 bumps
 * updatedAt, which causes findDirtyProperties (in zuper-property-sync.ts) to
 * pick up this property on the next 15-min cron cycle.
 *
 * No-ops when POWERHUB_CROSSLINK_ENABLED !== "true".
 */
export async function enqueueCrossSystemPush(propertyId: string): Promise<void> {
  if (!isCrosslinkEnabled()) return;
  try {
    await resolvePrimarySite(propertyId);
    await pushToHubSpotForProperty(propertyId);
  } catch (err) {
    console.error(`[powerhub-crosslink] enqueueCrossSystemPush failed for ${propertyId}:`, err);
    // Don't re-throw — caller is usually a sync loop that processes many properties
  }
}
