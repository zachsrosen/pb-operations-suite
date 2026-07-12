/**
 * PowerHub fleet-table ticket enrichment.
 *
 * Resolves PropertyTicketLink ticket IDs to { subject, isOpen } summaries via
 * a HubSpot batch read, cached in appCache so concurrent dashboard loads share
 * one HubSpot call per TTL window. Strictly best-effort: any failure yields an
 * empty map (uncached, so the next request retries) and the fleet response
 * renders without ticket links.
 *
 * Uses `batchReadTicketsWithRetry` from lib/hubspot rather than the older
 * `batchReadTickets` in lib/hubspot-tickets — the latter has no 429 retry,
 * and repo convention requires rate-limit retry on all HubSpot calls.
 */

import { batchReadTicketsWithRetry } from "@/lib/hubspot";
import { getTicketStageMap } from "@/lib/hubspot-tickets";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export interface TicketSummary {
  subject: string;
  isOpen: boolean;
}

export interface SiteTicket {
  id: string;
  subject: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
// Stale-while-revalidate window: stale summaries may be served for up to this
// long while a background refresh runs.
const CACHE_STALE_TTL_MS = 15 * 60 * 1000;
const BATCH_CHUNK = 100;
/** Max ticket links rendered per fleet row. */
export const MAX_TICKETS_PER_SITE = 5;

/** Same open/closed heuristic as property-sync.ts computeTicketStats. */
export function isOpenStageLabel(label: string): boolean {
  const l = label.toLowerCase();
  return !["closed", "resolved", "cancelled"].some((needle) => l.includes(needle));
}

interface BatchTicketResult {
  id: string;
  properties?: Record<string, string | null>;
}

/**
 * Pure classification step: batch-read results + stage map → summary map.
 * Tickets whose stage isn't in the service-pipeline map (i.e. tickets from
 * another pipeline) are EXCLUDED — we can't tell open from closed, and a
 * stale "open" link is worse than omission (the full history lives in
 * SiteDetail / PropertyDrawer).
 */
export function classifyTickets(
  results: BatchTicketResult[],
  stageMap: Record<string, string>
): Record<string, TicketSummary> {
  const out: Record<string, TicketSummary> = {};
  for (const t of results) {
    const stageId = t.properties?.hs_pipeline_stage || "";
    const label = stageMap[stageId];
    if (!label) continue;
    out[t.id] = {
      subject: t.properties?.subject || "",
      isOpen: isOpenStageLabel(label),
    };
  }
  return out;
}

/**
 * Pure mapping step: a property's ticket links (newest association first) +
 * the summary map → the open tickets to render for one site, capped at
 * MAX_TICKETS_PER_SITE, preserving association-recency order.
 */
export function buildSiteTickets(
  ticketIds: string[],
  summaries: Record<string, TicketSummary>
): SiteTicket[] {
  const tickets: SiteTicket[] = [];
  for (const id of ticketIds) {
    const summary = summaries[id];
    if (!summary || !summary.isOpen) continue;
    tickets.push({ id, subject: summary.subject });
    if (tickets.length >= MAX_TICKETS_PER_SITE) break;
  }
  return tickets;
}

/** djb2 — stable short hash so the cache key tracks ticket-set membership. */
function hashIds(ids: string[]): string {
  let h = 5381;
  const s = ids.join(",");
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Resolve ticket IDs to summaries. Cached (coalesced) for 5 minutes; returns
 * {} on any failure or when the service-pipeline stage map is unavailable.
 * Failures throw inside the fetcher so nothing is cached and the next
 * request retries.
 */
export async function getTicketSummaries(
  ticketIds: string[]
): Promise<Record<string, TicketSummary>> {
  const unique = [...new Set(ticketIds)].sort();
  if (unique.length === 0) return {};

  const cacheKey = CACHE_KEYS.POWERHUB_TICKET_SUMMARIES(
    `${unique.length}:${hashIds(unique)}`
  );
  try {
    const { data } = await appCache.getOrFetch(
      cacheKey,
      async () => {
        const { map: stageMap } = await getTicketStageMap();
        if (Object.keys(stageMap).length === 0) {
          // getTicketStageMap never throws — an empty map IS its failure
          // mode. Throw so the empty result is not cached for the TTL.
          throw new Error("service ticket stage map unavailable");
        }
        const summaries: Record<string, TicketSummary> = {};
        for (let i = 0; i < unique.length; i += BATCH_CHUNK) {
          const chunk = unique.slice(i, i + BATCH_CHUNK);
          const res = await batchReadTicketsWithRetry(chunk, [
            "subject",
            "hs_pipeline_stage",
          ]);
          Object.assign(
            summaries,
            classifyTickets((res.results || []) as BatchTicketResult[], stageMap)
          );
        }
        return summaries;
      },
      false,
      { ttl: CACHE_TTL_MS, staleTtl: CACHE_STALE_TTL_MS }
    );
    return data;
  } catch (err) {
    console.error("[powerhub-tickets] ticket enrichment failed:", err);
    return {};
  }
}
