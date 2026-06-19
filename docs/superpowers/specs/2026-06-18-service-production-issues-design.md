# Service Production Issues — Design Spec

**Ticket:** Freshservice #747 (Jacob Campbell; "Zach identified this as needed")
**Date:** 2026-06-18
**Status:** Draft for review

## Goal

Extend the existing **Production Issues** dashboard (`/dashboards/production-issues`) to surface **service-side** production issues alongside the current **install-side** issues, giving the team one place to see post-completion system problems the way install clipping/performance issues are tracked today.

## Background — how install issues work today

- Page: `src/app/dashboards/production-issues/page.tsx`
- Source: PROJECT-pipeline deals where the manual boolean `system_performance_review = true`, read via `GET /api/projects/flagged` (`src/app/api/projects/flagged/route.ts`). The flag is toggled from the Clipping Analytics page.
- The page already buckets by stage (`bucketStage()` in `src/lib/production-issues-aggregations.ts`), filters by location, and exports CSV via `DashboardShell`.

Install behavior is **unchanged** by this work.

## What a "service production issue" is

A **union** of two independent sources:

1. **Service tickets** — HubSpot tickets in the Service pipeline (`HUBSPOT_PIPELINE_SERVICE`) whose **Category** (`hs_ticket_category`) is one of:
   - `Production Guarantee`
   - `System Failure/Underperformance`
   Only **open/active** tickets are included (resolved/closed are not active issues). Exact open-stage set resolved from the service stage map at implementation.

2. **Completed-project deals** — PROJECT-pipeline (`HUBSPOT_PIPELINE_PROJECT`) deals at the **"Project Complete"** stage whose `tags` property contains either:
   - `Production Issue - 1 Year`
   - `Production Issue - 180 Days`

These two sources are merged into **one list** (a service production issue is *either* a qualifying ticket *or* a qualifying deal).

## UX

Add an **Install | Service** toggle to the production-issues page header.

- **Install** view: current page, untouched.
- **Service** view: one merged list. Each row is badged by source — **🎫 Ticket** or **📋 Deal** — and shows a common column set with source-specific detail:

| Column | Ticket | Deal |
|---|---|---|
| Source badge | 🎫 Ticket | 📋 Deal |
| Customer / Address | from ticket → associated deal/company | from deal name |
| Location (PB shop) | derived (ticket → deal → `pb_location`, fallback company city/state) | `pb_location` |
| Issue | `hs_ticket_category` value | the matched `tags` value (1-Year / 180-Day) |
| Date | ticket `createdate` (age) | deal close/`Project Complete` entry date |
| Link | HubSpot ticket URL | HubSpot deal URL |

- Reuses the existing **location filter** and **CSV export** (export flattens the union to the common columns).
- Empty state per source noted ("No open production-issue service tickets", "No tagged completed projects").

**Why a toggle, not one combined install+service list:** install issues are live deals flagged for clipping/performance; service issues are post-completion tickets + tagged completed deals. Forcing all three record types into one table makes columns mushy (a ticket has no system size; a deal has no requester). The toggle keeps install as-is and gives service its own clean unified list.

## Architecture

```
production-issues/page.tsx
  ├─ view state: "install" | "service" (default install)
  ├─ install → existing /api/projects/flagged (unchanged)
  └─ service → NEW /api/service/production-issues
                 ├─ fetch service tickets (category filter)  ── lib/hubspot-tickets.ts
                 ├─ fetch Project-Complete tagged deals       ── lib/hubspot.ts (searchWithRetry)
                 └─ normalize both → ServiceProductionIssue[]  (one shape, `source` discriminator)
```

### New API: `GET /api/service/production-issues`

Returns `{ issues: ServiceProductionIssue[], lastUpdated }` where:

```ts
type ServiceProductionIssue = {
  source: "ticket" | "deal";
  id: string;                 // ticket id or deal id
  customerName: string | null;
  address: string | null;
  location: string | null;    // PB shop
  issue: string;              // category value, or matched tag value
  date: string | null;        // ISO; ticket createdate or deal Project-Complete date
  ageDays: number | null;
  hubspotUrl: string;
};
```

- **Tickets:** reuse/extend the service-ticket reader in `lib/hubspot-tickets.ts`; add a `hs_ticket_category` filter (`IN` the two values) + open-status filter. Reuse the existing location fallback chain (ticket → deal → `pb_location`, else ticket → company → city/state).
- **Deals:** `searchWithRetry` over PROJECT pipeline, stage = Project Complete, `tags` `CONTAINS_TOKEN` each production-issue value (HubSpot multi-enum). Read `dealname`, `pb_location`, stage date.
- Role allowlist: add `/api/service/production-issues` to every role that can see the production-issues page in `src/lib/roles.ts` (else middleware 403s).

### Frontend

- `production-issues/page.tsx`: add the toggle + a `useQuery` for the service endpoint; render the merged list when `view === "service"`. Keep install rendering path intact.
- A small `ServiceIssueRow` / list section component (new) to keep the page file from growing unwieldy.

## Non-goals (YAGNI)

- No new flagging UI (tickets/deals are already categorized/tagged in HubSpot).
- No write-back / status changes from this page.
- No merging install + service into a single combined list.
- No service-specific risk scoring (install's clipping risk has no service analog here).
- No real-time SSE (page already polls/refetches on demand).

## Open items to confirm in review

1. **Open-ticket definition:** which service stages count as "open" for inclusion (default: everything except a resolved/closed terminal stage).
2. **Deal date column:** use the "Project Complete" stage-entry timestamp vs `closedate` — pick whichever is populated/meaningful for sorting.

## Files touched

- `src/app/dashboards/production-issues/page.tsx` (toggle + service view)
- `src/app/api/service/production-issues/route.ts` (new)
- `src/lib/hubspot-tickets.ts` (category-filtered service-ticket reader)
- `src/lib/roles.ts` (allowlist the new route)
- new small list/row component under `production-issues/`
