# PowerHub Fleet Table: Inline Alerts + Ticket Links

**Date**: 2026-07-11
**Status**: Approved (Zach, 2026-07-11)

## Problem

The PowerHub fleet dashboard (`/dashboards/powerhub`) shows alert *counts* per site
and no ticket information at all. Seeing what an alert actually is, or jumping to
the related HubSpot service ticket, requires expanding each row into `SiteDetail`
(and even there, tickets appear only as an `openTicketsCount` number with no link).
Service/ops users triaging the fleet want both visible at a glance.

## Design

Two changes, no new routes, no schema changes.

### 1. Alerts column shows alert names (client-only)

`/api/powerhub/sites` already returns `alerts: [{ id, severity, alertName }]` per
site. `FleetTable.tsx` currently collapses these into count chips. Change the
Alerts cell to render:

- Up to 2 chips, each showing the `alertName`, colored by severity —
  CRITICAL → red, RMA → purple (preserving the existing RMA distinction, with
  an `RMA` prefix on the chip text), PERFORMANCE → yellow, other → blue —
  sorted worst-first by the existing `SEVERITY_WEIGHT` map.
- A `+N` suffix when more than 2 alerts exist.
- A `title` tooltip on the cell listing every alert as `SEVERITY alertName`.
- `—` when no alerts (unchanged).

No API change; zero added cost.

### 2. Tickets column with HubSpot links (server enrichment)

**API** — in `/api/powerhub/sites/route.ts`, after loading sites:

1. Collect `propertyId`s of linked sites → `PropertyTicketLink` rows → unique
   ticket IDs.
2. Resolve ticket summaries through a new helper
   `getTicketSummaries(ticketIds)` in `src/lib/powerhub-tickets.ts`:
   - New `batchReadTicketsWithRetry()` in `lib/hubspot.ts` (mirrors
     `batchReadTasksWithRetry`) in chunks of 100, properties `subject`,
     `hs_pipeline_stage`. The pre-existing `batchReadTickets` in
     `lib/hubspot-tickets.ts` is NOT reused because it has no 429 retry and
     repo convention requires rate-limit retry on all HubSpot calls.
   - Classify open/closed with `getTicketStageMap()` from `lib/hubspot-tickets`
     using the existing label heuristic (label does not contain
     closed/resolved/cancelled — same rule as `property-sync.ts`). Tickets
     whose stage is not in the service-pipeline map (i.e. tickets from another
     pipeline) are **excluded** — open/closed can't be determined, and a stale
     "open" link is worse than omission.
   - `getTicketStageMap()` never throws; an empty map is its failure mode. The
     helper explicitly checks for a zero-entry map and treats it as an error.
   - Cache the full `ticketId → { subject, isOpen }` map in `appCache`
     (`lib/cache.ts`) under `CACHE_KEYS.POWERHUB_TICKET_SUMMARIES(setHash)`
     (5-minute TTL, 15-minute stale-while-revalidate window) via the store's
     coalescing fetch, so concurrent dashboard loads share one HubSpot call.
     The key hashes the sorted ticket-id set so membership changes bust the
     cache.
   - Failures **throw inside the cached fetcher** (so nothing is cached and
     the next request retries) and are caught outside it, returning `{}` — the
     fleet response never fails or blocks on ticket enrichment.
3. Each site in the response gains `tickets: [{ id, subject }]` — **open
   tickets only**, capped at 5 per site, in association-recency order
   (`PropertyTicketLink.associatedAt` descending).

**UI** — `FleetTable.tsx` gains a Tickets column between Alerts and Link
(sortable by open-ticket count; both `colSpan={7}` usages bump to 8):

- Each ticket renders as a truncated `subject ↗` external link built with the
  existing `getHubSpotTicketUrl()` helper (`lib/external-links.ts`, which
  carries the portal-ID fallback), `target="_blank"`, with `onClick`
  `stopPropagation` so following a link does not toggle row expansion. Falls
  back to `Ticket {id}` when subject is empty.
- Up to 2 links shown, `+N` indicator beyond that; `—` when none.
- Row click/expand behavior, sorting, filters unchanged.

## Error handling

- Ticket enrichment is strictly best-effort: on HubSpot error or missing stage
  map, sites return `tickets: []` and the dashboard renders as today.
- Sites without a linked property (or with no ticket links) get `tickets: []`.

## Testing

- Unit tests (`src/__tests__/powerhub-tickets.test.ts`) for the new helper's
  open/closed classification and chunking, with mocked HubSpot client + stage
  map; per-site mapping (property → tickets, cap, open-only); unknown-pipeline
  stages excluded; empty stage map → `{}`; a fetch failure is not cached (a
  retry with the same id set fetches again).
- Manual verification via dev server against the prod DB: rows with active
  alerts show names; a site with a known open ticket shows the link; expanded
  row and empty-filter states span all 8 columns.

## Out of scope

- Ticket status/owner display, closed-ticket history (lives in SiteDetail /
  PropertyDrawer).
- Any change to alert polling or ticket link syncing.
