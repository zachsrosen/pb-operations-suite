/**
 * Pure helpers for PowerHub alert ingestion — extracted from pollAlerts()
 * so severity normalization and DIN→site mapping are unit-testable and the
 * severity union has one home.
 */

export type PowerhubSeverity =
  | "INFORMATIONAL"
  | "PERFORMANCE"
  | "RMA"
  | "CRITICAL";

/**
 * Normalize Tesla's free-form severity strings to our enum.
 * "ReturnMerchandiseAuthorization" (added by Tesla mid-2026) means a part
 * needs replacing — kept first-class as RMA rather than buried as
 * INFORMATIONAL. Anything unrecognized still degrades to INFORMATIONAL so
 * ingestion never drops an alert over a new severity string.
 */
export function normalizePowerhubSeverity(
  raw: string | null | undefined
): PowerhubSeverity {
  const s = (raw || "").toUpperCase();
  if (s === "CRITICAL") return "CRITICAL";
  if (s === "PERFORMANCE") return "PERFORMANCE";
  if (s === "RETURNMERCHANDISEAUTHORIZATION" || s === "RMA") return "RMA";
  return "INFORMATIONAL";
}

/**
 * Build the DIN → siteId lookup from PowerhubSite.devices JSON. Walks every
 * device category (gateways, batteries, inverters, meters, evse, and any
 * category Tesla adds later) for every site passed in — callers must NOT
 * pre-filter to "provisioned" sites, since alerts fire from meter-only and
 * shell sites too.
 */
export function buildDinToSiteIdMap(
  sites: Array<{ siteId: string; devices: unknown }>
): Map<string, string> {
  const dinToSiteId = new Map<string, string>();
  for (const site of sites) {
    const devObj = site.devices;
    if (!devObj || typeof devObj !== "object" || Array.isArray(devObj)) {
      continue;
    }
    for (const category of Object.values(devObj as Record<string, unknown>)) {
      if (!Array.isArray(category)) continue;
      for (const device of category) {
        const din = (device as { din?: string } | null)?.din;
        if (din) dinToSiteId.set(din, site.siteId);
      }
    }
  }
  return dinToSiteId;
}
