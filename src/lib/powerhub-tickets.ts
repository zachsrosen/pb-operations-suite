/**
 * PowerHub fleet-table ticket enrichment.
 *
 * Surfaces a site's OPEN service tickets on the fleet table, resolved via the
 * site's deal(s) → ticket associations. This is the reliable source: tickets
 * hang off deals in HubSpot, whereas PropertyTicketLink is a webhook/reconcile
 * rollup that misses tickets (e.g. one created after the property last synced).
 * Cached in appCache; strictly best-effort — any failure yields an empty map
 * (uncached, so the next request retries) and the row simply shows no tickets.
 */

import { hubspotClient } from "@/lib/hubspot";
import { fetchServiceTickets } from "@/lib/hubspot-tickets";
import { appCache, CACHE_KEYS } from "@/lib/cache";

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

/**
 * Open service tickets grouped by their associated HubSpot deal id.
 *
 * This is the reliable source for "does this site have an open ticket": tickets
 * hang off deals (and contacts) in HubSpot, whereas PropertyTicketLink is a
 * webhook/reconcile-driven rollup that misses tickets (e.g. one created after
 * the property last synced). There are only ~a few hundred open service tickets
 * fleet-wide, so we fetch them once, batch-read their deal associations, and
 * map deal → open tickets. Cached 5 min; {} on any failure (uncached).
 */
export async function getOpenTicketsByDeal(): Promise<Record<string, SiteTicket[]>> {
  try {
    const { data } = await appCache.getOrFetch(
      CACHE_KEYS.POWERHUB_OPEN_TICKETS_BY_DEAL,
      async () => {
        // fetchServiceTickets already returns only OPEN tickets (closed stages
        // are excluded server-side) with id + subject.
        const openTickets = await fetchServiceTickets();
        const subjectById = new Map<string, string>(
          openTickets.map((t) => [t.id, t.title || `Ticket ${t.id}`])
        );
        const ticketIds = openTickets.map((t) => t.id);

        const byDeal: Record<string, SiteTicket[]> = {};
        for (let i = 0; i < ticketIds.length; i += BATCH_CHUNK) {
          const chunk = ticketIds.slice(i, i + BATCH_CHUNK);
          const resp = await hubspotClient.crm.associations.v4.batchApi.getPage(
            "tickets",
            "deals",
            { inputs: chunk.map((id) => ({ id })) }
          );
          for (const r of resp.results ?? []) {
            const rec = r as unknown as {
              _from?: { id?: string }; from?: { id?: string };
              to?: Array<{ toObjectId?: number; id?: string }>;
            };
            const ticketId = rec._from?.id ?? rec.from?.id;
            if (!ticketId) continue;
            const subject = subjectById.get(ticketId) || `Ticket ${ticketId}`;
            for (const t of rec.to ?? []) {
              const dealId = String(t.toObjectId ?? t.id ?? "");
              if (!dealId) continue;
              (byDeal[dealId] ??= []).push({ id: ticketId, subject });
            }
          }
        }
        return byDeal;
      },
      false,
      { ttl: CACHE_TTL_MS, staleTtl: CACHE_STALE_TTL_MS }
    );
    return data;
  } catch (err) {
    console.error("[powerhub-tickets] getOpenTicketsByDeal failed:", err);
    return {};
  }
}

/**
 * Open tickets to render for one site: union of open tickets across all the
 * site's deals, deduped by ticket id, capped at MAX_TICKETS_PER_SITE.
 */
export function buildSiteTicketsFromDeals(
  dealIds: string[],
  openTicketsByDeal: Record<string, SiteTicket[]>
): SiteTicket[] {
  const seen = new Set<string>();
  const out: SiteTicket[] = [];
  for (const dealId of dealIds) {
    for (const ticket of openTicketsByDeal[dealId] ?? []) {
      if (seen.has(ticket.id)) continue;
      seen.add(ticket.id);
      out.push(ticket);
      if (out.length >= MAX_TICKETS_PER_SITE) return out;
    }
  }
  return out;
}
