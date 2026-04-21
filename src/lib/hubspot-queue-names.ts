/**
 * Admin-configured HubSpot task-queue id→name lookup.
 *
 * HubSpot's public API does not expose queue listings, so we maintain the
 * mapping in the HubspotQueueName table and cache it process-wide.
 */

import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";

const CACHE_KEY = "hubspot:queue-names:all";

export async function getQueueNameMap(): Promise<Map<string, string>> {
  const cached = appCache.get<Record<string, string>>(CACHE_KEY);
  if (cached.hit && cached.data) {
    return new Map(Object.entries(cached.data));
  }
  if (!prisma) return new Map();

  try {
    const rows = await prisma.hubspotQueueName.findMany({
      select: { queueId: true, name: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.queueId, r.name);
    appCache.set(CACHE_KEY, Object.fromEntries(map));
    return map;
  } catch {
    return new Map();
  }
}
