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

- Up to 2 chips, each showing the `alertName`, colored by severity
  (CRITICAL → red, PERFORMANCE → yellow, other → blue), sorted CRITICAL first.
- A `+N` suffix chip when more than 2 alerts exist.
- A `title` tooltip on the cell listing every alert as `SEVERITY alertName`.
- `—` when no alerts (unchanged).

No API change; zero added cost.

### 2. Tickets column with HubSpot links (server enrichment)

**API** — in `/api/powerhub/sites/route.ts`, after loading sites:

1. Collect `propertyId`s of linked sites → `PropertyTicketLink` rows → unique
   ticket IDs.
2. Resolve ticket summaries through a new helper
   `getTicketSummaries(ticketIds)` in `src/lib/powerhub-tickets.ts`:
   - HubSpot `crm.tickets.batchApi.read` in chunks of 100, properties
     `subject`, `hs_pipeline_stage`.
   - Classify open/closed with `getTicketStageMap()` from `lib/hubspot-tickets`
     using the existing label heuristic (label does not contain
     closed/resolved/cancelled — same rule as `property-sync.ts`).
   - Cache the full `ticketId → { subject, isOpen }` map in `appCache`
     (`lib/cache.ts`) under `powerhub:ticket-summaries` with a 5-minute TTL via
     the store's coalescing fetch, so concurrent dashboard loads share one
     HubSpot call. Cache key includes a hash of the sorted ticket-id set so
     membership changes bust the cache.
   - Any HubSpot failure returns `{}` — the fleet response must never fail or
     block on ticket enrichment.
3. Each site in the response gains `tickets: [{ id, subject }]` — **open
   tickets only**, capped at 5 per site, sorted by ticket id descending
   (newest first).

**UI** — `FleetTable.tsx` gains a Tickets column between Alerts and Link:

- Each ticket renders as a truncated (~28 char) `subject ↗` external link to
  `https://app.hubspot.com/contacts/${NEXT_PUBLIC_HUBSPOT_PORTAL_ID}/record/0-5/{id}`,
  `target="_blank"`, with `onClick` `stopPropagation` so following a link does
  not toggle row expansion. Falls back to `Ticket {id}` when subject is empty.
- Up to 2 links shown, `+N` indicator beyond that; `—` when none.
- Row click/expand behavior, sorting, filters unchanged.

## Error handling

- Ticket enrichment is strictly best-effort: on HubSpot error or missing stage
  map, sites return `tickets: []` and the dashboard renders as today.
- Sites without a linked property (or with no ticket links) get `tickets: []`.

## Testing

- Unit tests (`src/__tests__/powerhub-tickets.test.ts`) for the new helper's
  open/closed classification and chunking, with mocked HubSpot client + stage
  map; and for the per-site mapping (property → tickets, cap, open-only).
- Manual verification via dev server against the prod DB: rows with active
  alerts show names; a site with a known open ticket shows the link.

## Out of scope

- Ticket status/owner display, closed-ticket history (lives in SiteDetail /
  PropertyDrawer).
- Any change to alert polling or ticket link syncing.
