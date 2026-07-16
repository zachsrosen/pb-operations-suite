/**
 * value → label resolution for HubSpot enumeration deal properties.
 *
 * The hubs store, filter, and route on the internal VALUE, but several
 * permit/IC statuses have a different human LABEL — so rendering the raw value
 * showed the team something different from what HubSpot shows them:
 *
 *   permitting_status:  "Rejected"              → "Permit Rejected - Needs Revision"
 *                       "In Design For Revision" → "Design Revision In Progress"
 *                       "Returned from Design"   → "Revision Ready To Resubmit"
 *                       "Pending SolarApp"       → "Ready to Submit for SolarApp"
 *
 * Archived options are merged in too: a deal can still sit on a status whose
 * option was later archived, and we want its real label rather than the raw
 * value. Active definitions win on conflict.
 */

import { appCache } from "@/lib/cache";
import { getDealPropertyDefinition } from "@/lib/hubspot";

/** Option lists change rarely; an hour keeps this off the hot path. */
const TTL_MS = 60 * 60 * 1000;

function cacheKey(propertyName: string): string {
  return `enum-labels:${propertyName}`;
}

/**
 * Returns a value → label map for an enumeration deal property.
 * Returns an empty map on failure — callers should fall back to the raw value.
 */
export async function getEnumLabelMap(
  propertyName: string,
): Promise<Map<string, string>> {
  const cached = appCache.get<Array<[string, string]>>(cacheKey(propertyName));
  if (cached.hit && cached.data) return new Map(cached.data);

  const map = new Map<string, string>();
  // Active first so it wins over an archived option with the same value.
  const [active, archived] = await Promise.allSettled([
    getDealPropertyDefinition(propertyName),
    getDealPropertyDefinition(propertyName, true),
  ]);

  for (const result of [active, archived]) {
    if (result.status !== "fulfilled" || !result.value?.options) continue;
    for (const option of result.value.options) {
      const value = String(option.value ?? "").trim();
      const label = String(option.label ?? "").trim();
      if (value && label && !map.has(value)) map.set(value, label);
    }
  }

  if (map.size > 0) {
    appCache.set(cacheKey(propertyName), Array.from(map.entries()), {
      ttl: TTL_MS,
      staleTtl: TTL_MS,
    });
  }
  return map;
}

/** Convenience: resolve one value, falling back to the value itself. */
export function labelFor(
  map: Map<string, string>,
  value: string | null | undefined,
): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  return map.get(raw) ?? raw;
}
