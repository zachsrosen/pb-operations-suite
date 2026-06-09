# Page Traffic Analytics — Design

**Date:** 2026-06-09
**Status:** Approved (design phase)
**Author:** Zach + Claude

## Problem

The suite already logs every page navigation and click into the `ActivityLog`
table (via `PageViewTracker`, `ClickTracker`, and `useActivityTracking`), but
there is no way to *see* that data as traffic. The only UI is the admin activity
log — a raw, paginated event feed with no aggregation. Admins cannot answer
basic questions like "which dashboards are actually used?", "who uses what?", or
"which pages are dead weight we should retire?".

## Goals

A new admin-only **Page Traffic** analytics view that answers four questions:

1. **Adoption / engagement** — which pages and suites get the most traffic.
2. **Dead weight** — which dashboard pages get little or no traffic (retire/consolidate candidates).
3. **Per-team / per-person usage** — break traffic down by user, role, and PB location.
4. **Engagement depth** — how long people actually spend on a page (real dwell time).

## Non-Goals (v1)

- Nightly materialized rollups. We aggregate live on read; add rollups only if
  `ActivityLog` grows large enough to make windowed queries slow.
- Click heatmaps / click coordinates (the data isn't captured today).
- Real-time live visitor feed.
- Exposure outside the Admin suite (no Executive/Intelligence surface in v1).

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Primary goals | All four above |
| Time-on-page | **Add real dwell tracking** (enter/exit), accurate from launch; counts/users have history |
| Placement & access | **Admin suite, admin-only** |
| Page scope | **Dashboards + suite landings, grouped by suite**; dynamic detail routes collapsed to one entry |
| Aggregation strategy | **Approach A — live aggregation (query-on-read)** against `ActivityLog` |

## Architecture

Five units, each independently testable.

### 1. Dwell tracking (write side)

Extend `src/components/PageViewTracker.tsx`:

- On each route change, record an **enter timestamp** (`performance.now()`) and
  the normalized path for the page being entered.
- On **exit** — i.e. the next route change, plus `visibilitychange` →
  `hidden` and `pagehide` — compute elapsed ms for the page being left and emit
  a `page_dwell` activity event.
- Use `navigator.sendBeacon` for the exit emit so it survives tab close /
  navigation away (a normal `fetch` would be cancelled). Same-origin beacons
  include cookies, so the existing `auth()` check on the endpoint still resolves
  the user. Fall back to `fetch(..., { keepalive: true })` if `sendBeacon` is
  unavailable.
- Guard against noise: ignore dwell < ~1s (instant bounces / redirects) and clamp
  absurd values (e.g. cap at 30 min) to avoid a backgrounded tab skewing averages.
- Only fire when `status === "authenticated"` (same guard the existing tracker uses).

**Endpoint change** — `src/app/api/activity/log/route.ts`. Two edits, not one:
1. Add `case "page_dwell": return "PAGE_DWELL";` to `getActionActivityType`.
2. Add a `case "page_dwell":` branch to the main `POST` action `switch` (which
   currently `default`s to a 400 "Unknown action"), mirroring the `page_view`
   branch, so the row actually persists. Without this branch the beacon hits the
   400 default.

Persist the dwell value into the existing `durationMs` column with `entityType =
"page"`, `entityId =` normalized path. No new endpoint.

> **`durationMs` is semantically overloaded.** Today it stores *server-side request
> duration* (`Date.now() - start`; schema comment "How long the request took").
> For `PAGE_DWELL` rows it stores *client-measured dwell ms*. Rows are always
> disambiguated by `type`, so aggregation only ever reads `durationMs` from
> `PAGE_DWELL` rows and request-duration from others — they are never averaged
> together. Update the `durationMs` schema comment to document both meanings.

> **Write-side volume.** Dwell beacons fire on every route change / tab-hide, a
> higher write rate than the current page-view events. The endpoint runs audit-session
> resolution + anomaly scoring on every POST. `PAGE_DWELL` events are inherently
> low-risk navigation telemetry, so the handler should **skip anomaly scoring** for
> `page_dwell` (treat as `LOW` risk, score 1) to avoid amplifying audit-pipeline load.

**Hook change** — `src/hooks/useActivityTracking.ts`: add a `trackPageDwell(path,
durationMs)` method that posts `action: "page_dwell"` via `sendBeacon`.

### 2. Path normalization + suite mapping (`src/lib/page-traffic.ts`, pure)

- `normalizePath(path: string): string` — strip query string; collapse dynamic
  segments to their route pattern. Examples:
  - `/dashboards/reviews/abc123` → `/dashboards/reviews/[dealId]`
  - `/dashboards/catalog/edit/42` → `/dashboards/catalog/edit/[id]`
  Detection: numeric segments, UUID/objectid-like segments, and HubSpot-style IDs
  map to the parameter name from a small known-pattern table.
- `suiteForPath(path: string): string | null` — map a normalized path to its
  owning suite. **Source of truth:** the per-suite landing pages
  `src/app/suites/*/page.tsx`, each of which declares its dashboard cards as a
  `href: "/dashboards/..."` array. `suite-nav.ts` only holds suite *landing*
  hrefs (`/suites/operations`, etc.) and contains **no** `/dashboards/*` entries,
  so it is **not** the source. The implementation builds a single
  `PATH_TO_SUITE` map by extracting the `/dashboards/*` hrefs from each suite page
  (a page can appear in more than one suite; first-match wins, or pick a documented
  primary suite). Unknown paths bucket to `"Other"`.
- `KNOWN_PAGES` — canonical list of dashboard + suite-landing routes (the union of
  all `/dashboards/*` hrefs harvested from the suite pages, plus the `/suites/*`
  landing routes). This is the denominator for the dead-weight calculation (a known
  page with ~zero traffic in the window is dead).

> Note: harvest the `/dashboards/*` hrefs **programmatically from every
> `src/app/suites/*/page.tsx`** rather than hardcoding a list/count (the set of
> suites changes over time). Decide whether to exclude any non-production sandbox
> suite (e.g. a `testing` suite) from `KNOWN_PAGES`. For pages that appear in more
> than one suite, pin the tie-break in the implementation plan (documented primary
> suite) so suite-rollup numbers are deterministic. If a page isn't referenced by
> any suite card it still gets tracked (its path appears in `ActivityLog`) but
> buckets to `"Other"`.

These are pure functions — unit-tested with no DB.

### 3. Aggregation layer (`src/lib/page-traffic.ts`)

`getPageTraffic(opts: { window, roles?: string[], locations?: string[] }): Promise<PageTrafficResult>`

(`roles`/`locations` are arrays to match the `MultiSelectFilter` UI — empty/undefined = no filter.)

- Window → `createdAt >= start` (`7d | 30d | 90d | all`).
- Query `ActivityLog` where `type ∈ { DASHBOARD_VIEWED, PAGE_DWELL, FEATURE_USED }`
  and `createdAt >= start`, optionally filtered by `pbLocation ∈ locations` and by the
  actor's role (role filter resolves via `userId` → user roles; `IN (roles)`).
- In-process: normalize each row's path, then aggregate:
  - **views** = count of `DASHBOARD_VIEWED` per normalized path
  - **uniqueUsers** = distinct `userId` per path
  - **clicks** = count of `FEATURE_USED` per path
  - **avgDwellMs** = mean `durationMs` of `PAGE_DWELL` per path
- Roll pages up by suite for the suite breakdown.
- **Dead weight** = `KNOWN_PAGES` minus pages with views above a small floor in
  the window, sorted ascending by views.
- **Per-user** = aggregate views/dwell grouped by `(userId, userEmail)`.
- Return `{ totals, pages[], suites[], deadPages[], users[], window, generatedAt }`.

Heavy lifting is `Prisma.groupBy` where possible; path normalization happens in
JS because the dynamic-segment collapse can't be expressed in SQL.

### 4. API route (`src/app/api/admin/analytics/page-traffic/route.ts`)

`GET` with query params `window` (default `30d`), `roles` (comma-separated, optional),
`locations` (comma-separated, optional). Parses the CSV params into arrays and calls
`getPageTraffic`. Returns the `PageTrafficResult` JSON. Under `/api/admin/*`, so it's
already behind the admin-only middleware prefix check — no new middleware wiring.
Validates/normalizes params and rejects unknown window values.

### 5. Page (`src/app/dashboards/admin/page-traffic/page.tsx`)

Wrapped in `<DashboardShell title="Page Traffic" accentColor="purple"
exportData={...} lastUpdated={generatedAt}>`. React Query fetches the API route.

Sections:
- **Summary row** (`MiniStat`): total views · unique users · active pages · avg dwell
- **Top pages** — ranked table/bar: page label · suite · views · unique users · avg dwell · clicks
- **Suite breakdown** — grouped rollup (views + unique users per suite)
- **Dead weight** — known pages with little/no traffic in the window
- **Per-user usage** — table of users by views + avg dwell
- **Controls**: time-window selector; `MultiSelectFilter` for role and PB location;
  CSV export via `DashboardShell`'s `exportData`.

Use theme tokens throughout; `key={String(value)}` + `animate-value-flash` on
metric cards per house style.

## Access control

- **Page route** `/dashboards/admin/page-traffic`: `ADMIN.allowedRoutes` is
  `["*"]`, so the route is already permitted — no `roles.ts` allowlist edit
  needed. (Confirmed in `src/lib/roles.ts`.)
- **API route**: under `/api/admin/*`, covered by the existing `ADMIN_ONLY_ROUTES`
  middleware prefix — no new allowlist entry.
- **Admin suite card**: add a "Page Traffic" card to the Admin suite landing page
  linking to the new route.

## Data model / migration

One **additive** migration, two changes — both non-destructive:
1. Add `PAGE_DWELL` to the `ActivityType` enum in `prisma/schema.prisma`.
2. Add a composite index `@@index([type, createdAt])` on `ActivityLog`. The main
   aggregation query filters `WHERE type IN (...) AND createdAt >= start`; the table
   today has only *separate* single-column indexes `@@index([type])` and
   `@@index([createdAt])`, which Postgres won't combine as efficiently as a composite.
   Adding an index is additive/safe (built `CONCURRENTLY` if the table is large).

No new tables and no new columns (`durationMs`, `entityType`, `entityId`,
`sessionId` all already exist on `ActivityLog`). Also update the `durationMs` column
comment to document its dual meaning (request duration vs. `PAGE_DWELL` dwell ms).

**Migration ordering (per project rules):** this additive enum value must be
applied to the database **before** the code that writes/reads it merges, to avoid
client-regen mismatches on Vercel. Migration is run by the orchestrator with
explicit user approval — **subagents may write the migration file but must not run
`prisma migrate deploy`**.

## Testing

- **Unit (pure):** `normalizePath` (each dynamic-route pattern), `suiteForPath`
  (representative paths per suite + unknown→Other), dead-page detection against a
  synthetic `KNOWN_PAGES`.
- **Aggregation:** seed `ActivityLog` rows (views, dwell, clicks across paths,
  users, locations, windows) and assert `getPageTraffic` totals, per-page rollups,
  unique-user counts, avg dwell, role/location filtering, and dead-page output.
- **Dwell math:** sub-1s ignored, >30min clamped.

## Risks & mitigations

- **Large `ActivityLog`** → long-window queries slow. Mitigation: the new
  composite `(type, createdAt)` index (added by this migration) plus the existing
  `(entityType, entityId)` index; cap default window at 30d; rollups remain the
  documented escape hatch (Approach B) if needed.
- **Beacon reliability** → some dwell events lost on hard crashes. Acceptable;
  averages tolerate sampling. View/click/user counts are unaffected.
- **Backgrounded tabs inflating dwell** → clamp + `visibilitychange` handling.

## Rollout

1. Land additive `PAGE_DWELL` migration (orchestrator, user-approved).
2. Merge dwell tracking + aggregation + API + page + suite card.
3. Dwell data accrues from launch; counts/users/clicks reflect existing history
   immediately.
