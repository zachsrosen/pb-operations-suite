/**
 * Enphase Enlighten Cross-System Propagation
 *
 * Mirrors powerhub-crosslink.ts for Enphase systems. Propagates
 * Enphase portal links and device info into HubSpot Property/Deal/Ticket
 * records and Zuper Property/Job custom fields.
 *
 * Entry points:
 *   - resolvePrimarySite(propertyId)
 *   - pushToHubSpotForProperty(propertyId)
 *   - enqueueCrossSystemPush(propertyId)
 *
 * All entry points no-op when ENPHASE_CROSSLINK_ENABLED !== "true".
 */

import { prisma } from "@/lib/db";
import { updateDealProperty } from "@/lib/hubspot";
import { updateTicketProperties } from "@/lib/hubspot-tickets";
import { updateProperty as updateHubSpotProperty } from "@/lib/hubspot-property";

const CROSSLINK_FLAG = "ENPHASE_CROSSLINK_ENABLED";

function isCrosslinkEnabled(): boolean {
  return process.env[CROSSLINK_FLAG] === "true";
}

// ─── Device Summary ─────────────────────────────────────────────────────────

export interface EnphaseDeviceSummary {
  envoySerial: string | null;
  envoyModel: string | null;
  microModel: string | null;
  microCount: number;
  batterySerials: string | null;
  batteryModel: string | null;
  meterInfo: string | null;
  formatted: string | null;
}

/**
 * Build a denormalized device-summary block from an EnphaseSite's `devices`
 * JSON column. Used by resolvePrimarySite() to populate the cache columns
 * pushed to HubSpot Property/Deal/Ticket.
 *
 * Enphase payload keys: micro_inverters, encharges, batteries, enpower, meters.
 * Projects into typed fields + a formatted multi-line string for display.
 */
export function buildEnphaseDeviceSummary(devicesJson: unknown): EnphaseDeviceSummary {
  const root = (devicesJson ?? {}) as Record<string, unknown>;
  const asArray = (k: string): Record<string, unknown>[] => {
    const v = root[k];
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  };
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  const micros = asArray("micro_inverters").map((d) => ({
    sn: str(d.serial_number),
    model: str(d.model),
  }));
  const batteries = [
    ...asArray("batteries").map((d) => ({ sn: str(d.serial_number), model: str(d.model) })),
    ...asArray("encharges").map((d) => ({ sn: str(d.serial_number), model: str(d.model) })),
  ];
  const envoys = asArray("enpower").map((d) => ({
    sn: str(d.serial_number),
    model: str(d.model),
  }));
  const meters = asArray("meters").map((d) => ({
    sn: str(d.serial_number),
    model: str(d.model),
  }));

  const envoySerial = envoys[0]?.sn || null;
  const envoyModel = envoys[0]?.model || null;
  const microModel = micros[0]?.model || null;
  const microCount = micros.length;
  const batterySerials =
    batteries.length > 0
      ? batteries
          .map((b) => b.sn)
          .filter((s) => s.length > 0)
          .join("; ") || null
      : null;
  const batteryModel = batteries[0]?.model || null;
  const meterInfo =
    meters.length > 0 ? meters.map((m) => `${m.sn} (${m.model})`).join("; ") : null;

  const lines: string[] = [];
  if (envoySerial) lines.push(`Envoy: ${envoySerial}${envoyModel ? ` (${envoyModel})` : ""}`);
  if (microCount > 0)
    lines.push(`Microinverters: ${microCount}× ${microModel || "unknown"}`);
  for (const b of batteries) {
    if (b.sn) lines.push(`Battery: ${b.sn}${b.model ? ` (${b.model})` : ""}`);
  }
  for (const m of meters) {
    if (m.sn) lines.push(`Meter: ${m.sn}${m.model ? ` (${m.model})` : ""}`);
  }
  const formatted = lines.length > 0 ? lines.join("\n") : null;

  return {
    envoySerial,
    envoyModel,
    microModel,
    microCount,
    batterySerials,
    batteryModel,
    meterInfo,
    formatted,
  };
}

// ─── Primary Site Selection ─────────────────────────────────────────────────

export interface PrimaryEnphaseSiteCandidate {
  id: string;
  systemName: string;
  operationalAt: Date | null;
  createdAt: Date;
}

/**
 * Pick the primary Enphase site from candidates.
 *
 * Rules:
 *   1. Sites with operationalAt beat sites without
 *   2. Newest operationalAt wins
 *   3. If all null, newest createdAt wins
 *   4. Tie-break: systemName desc, then id desc
 *
 * Returns null only if the input is empty.
 */
export function pickPrimaryEnphaseSite<T extends PrimaryEnphaseSiteCandidate>(
  sites: T[]
): T | null {
  if (sites.length === 0) return null;

  const enriched = sites.map((s) => ({ site: s, hasOp: s.operationalAt != null }));
  enriched.sort((a, b) => {
    // Sites with operationalAt beat those without
    if (a.hasOp && !b.hasOp) return -1;
    if (!a.hasOp && b.hasOp) return 1;
    // Both have operationalAt: newest wins
    if (a.hasOp && b.hasOp) {
      const diff = b.site.operationalAt!.getTime() - a.site.operationalAt!.getTime();
      if (diff !== 0) return diff;
    } else {
      // Both missing operationalAt: newest createdAt wins
      const diff = b.site.createdAt.getTime() - a.site.createdAt.getTime();
      if (diff !== 0) return diff;
    }
    // Tie-break: systemName desc
    if (a.site.systemName !== b.site.systemName) {
      return b.site.systemName.localeCompare(a.site.systemName);
    }
    // Final: id desc
    return b.site.id.localeCompare(a.site.id);
  });

  return enriched[0].site;
}

// ─── Retry Helper ───────────────────────────────────────────────────────────

/**
 * Retry helper for the partial unique index race: a concurrent caller may
 * have promoted a different site, so we retry after a short jitter.
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
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  throw lastErr;
}

// ─── Crosslink Cascade ──────────────────────────────────────────────────────

/**
 * Look up all EnphaseSite rows for a property, pick the primary, write the
 * `primaryForProperty` flag, and update the denormalized Enphase fields on
 * HubSpotPropertyCache.
 *
 * Returns the primary site (or null if no sites are linked to this property).
 *
 * Idempotent: safe to call repeatedly. Race-safe via the demote-then-promote
 * pattern — demote all losers first to avoid the partial unique index
 * conflict, then promote the winner with retryOnUniqueConflict.
 */
export async function resolvePrimarySite(propertyId: string): Promise<{
  id: string;
  systemId: number;
  systemName: string;
  portalUrl: string | null;
} | null> {
  const sites = await prisma.enphaseSite.findMany({
    where: { propertyId },
    select: {
      id: true,
      systemId: true,
      systemName: true,
      portalUrl: true,
      operationalAt: true,
      createdAt: true,
      primaryForProperty: true,
      devices: true,
      systemSizeW: true,
      microinverterCount: true,
    },
  });

  if (sites.length === 0) {
    // No sites: clear denormalized cache fields (updateMany to tolerate missing row)
    await prisma.hubSpotPropertyCache.updateMany({
      where: { id: propertyId },
      data: {
        enphasePortalUrl: null,
        enphaseSystemId: null,
        enphaseEnvoySerial: null,
        enphaseMicroCount: null,
        enphaseBatterySerials: null,
        enphaseBatteryModel: null,
        enphaseSystemSize: null,
        enphaseHardwareSummary: null,
      },
    });
    return null;
  }

  const primary = pickPrimaryEnphaseSite(sites)!;

  // Two writes in sequence (NOT a transaction — the demote-then-promote order
  // avoids the partial unique index conflict naturally).
  await prisma.enphaseSite.updateMany({
    where: { propertyId, id: { not: primary.id } },
    data: { primaryForProperty: false },
  });
  await retryOnUniqueConflict(() =>
    prisma.enphaseSite.update({
      where: { id: primary.id },
      data: { primaryForProperty: true },
    })
  );

  const summary = buildEnphaseDeviceSummary(primary.devices);
  const systemSizeKw = primary.systemSizeW ? (primary.systemSizeW / 1000).toFixed(1) : null;

  await prisma.hubSpotPropertyCache.updateMany({
    where: { id: propertyId },
    data: {
      enphasePortalUrl: primary.portalUrl,
      enphaseSystemId: String(primary.systemId),
      enphaseEnvoySerial: summary.envoySerial,
      enphaseMicroCount: String(summary.microCount),
      enphaseBatterySerials: summary.batterySerials,
      enphaseBatteryModel: summary.batteryModel,
      enphaseSystemSize: systemSizeKw ? `${systemSizeKw} kW` : null,
      enphaseHardwareSummary: summary.formatted,
    },
  });

  return {
    id: primary.id,
    systemId: primary.systemId,
    systemName: primary.systemName,
    portalUrl: primary.portalUrl,
  };
}

/**
 * Push enphase_portal_url + device fields to HubSpot Property + all linked
 * Deals + all linked Tickets. Reads denormalized fields from
 * HubSpotPropertyCache (call resolvePrimarySite first to ensure freshness).
 *
 * No-ops if ENPHASE_CROSSLINK_ENABLED !== "true".
 *
 * Failures on individual deal/ticket updates are logged but don't stop the
 * batch — partial-success is preferable to all-or-nothing rollback.
 */
export async function pushToHubSpotForProperty(propertyId: string): Promise<void> {
  if (!isCrosslinkEnabled()) return;

  const cache = await prisma.hubSpotPropertyCache.findUnique({
    where: { id: propertyId },
    include: { dealLinks: true, ticketLinks: true },
  });
  if (!cache) {
    console.warn(
      `[enphase-crosslink] Property ${propertyId} not found in cache; skipping push`
    );
    return;
  }

  const props = {
    enphase_portal_url: cache.enphasePortalUrl,
    enphase_system_id: cache.enphaseSystemId,
    enphase_envoy_serial: cache.enphaseEnvoySerial,
    enphase_micro_count: cache.enphaseMicroCount,
    enphase_battery_serials: cache.enphaseBatterySerials,
    enphase_battery_model: cache.enphaseBatteryModel,
    enphase_system_size: cache.enphaseSystemSize,
    enphase_hardware_summary: cache.enphaseHardwareSummary,
  };

  // 1. HubSpot Property object
  try {
    await updateHubSpotProperty(cache.hubspotObjectId, props);
  } catch (err) {
    console.error(
      `[enphase-crosslink] Failed to update HubSpot Property ${cache.hubspotObjectId}:`,
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
      `[enphase-crosslink] ${dealFailures}/${cache.dealLinks.length} deal updates failed for property ${propertyId}`
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
      `[enphase-crosslink] ${ticketFailures}/${cache.ticketLinks.length} ticket updates failed for property ${propertyId}`
    );
  }
}

/**
 * Full cross-system cascade for a property:
 *   1. resolvePrimarySite — pick primary, update flags + denormalized cache fields
 *   2. pushToHubSpotForProperty — push fields to HubSpot Property + Deals + Tickets
 *
 * The Zuper push happens asynchronously: the cache update from step 1 bumps
 * updatedAt, which causes findDirtyProperties (in zuper-property-sync.ts) to
 * pick up this property on the next 15-min cron cycle.
 *
 * No-ops when ENPHASE_CROSSLINK_ENABLED !== "true".
 */
export async function enqueueCrossSystemPush(propertyId: string): Promise<void> {
  if (!isCrosslinkEnabled()) return;
  try {
    await resolvePrimarySite(propertyId);
    await pushToHubSpotForProperty(propertyId);
  } catch (err) {
    console.error(
      `[enphase-crosslink] enqueueCrossSystemPush failed for ${propertyId}:`,
      err
    );
    // Don't re-throw — caller is usually a sync loop that processes many properties
  }
}
