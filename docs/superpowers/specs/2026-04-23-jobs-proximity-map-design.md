# Jobs Proximity Map — Design

**Date:** 2026-04-23
**Status:** Draft
**Author:** Zach Rosen + Claude

## Problem

Dispatchers and ops managers need a single geographic view of all scheduled and unscheduled jobs to answer questions like: "a tech just finished early in Boulder — who has open work nearby?" Today, this requires hopping between seven different scheduler pages (installs, service, inspection, survey, D&R, roofing, dnr-scheduler), none of which show cross-type proximity. Crew reassignment decisions are made blind to what's happening one town over.

## Goals

- One map page (`/dashboards/map`) showing all active work types across all Colorado and California locations.
- Dispatcher can see crew positions (by next scheduled stop) + scheduled work + unscheduled backlog + proximity between them.
- Clicking a job reveals detail + "nearby open work" + "closest crew" + deep-link back into the right scheduler to act.
- Phased rollout — Phase 1 ships useful value with installs + service, behind a feature flag.

## Non-goals

- Live GPS tracking of technicians (future phase; requires Zuper mobile adoption + privacy review).
- Drag-to-reassign on the map itself (Zuper API limitation: `assigned_to` is only settable at job creation, so drag-reassign would require destroy-and-recreate flows — intentionally deferred).
- Mobile-first design (desktop dashboard; viewable on tablet, not optimized for phone).
- Replacing the existing schedulers. The map augments them, schedulers remain source of truth for time-slot booking.

## User decisions captured during brainstorming

| Question | Decision |
|----------|----------|
| Scope of jobs shown | **A** — Unified map with filter chips for all work types |
| Primary user | **A-focused dispatcher**, with Today/Week/Backlog mode toggle for D coverage |
| "Unscheduled" definition | **C** — Today mode = ready-to-schedule only; Backlog mode = full pre-scheduled pipeline |
| Interactivity | **D** — View + click-to-detail + deep-link "Schedule this" button (no drag-reassign Phase 1) |
| Crew position | **D** now (next-scheduled-stop + route polyline); **C** (live GPS) deferred |
| Architecture | **A** — Standalone `/dashboards/map` page, phased rollout |
| UI layout | **B** — Top toolbar (max map real estate) |
| Marker taxonomy | Approved — color=type, fill=scheduled, dashed=unscheduled |
| Detail panel | Approved — includes "nearby open work" / "closest crew" sections |

## Architecture

### Route & shell

```
/dashboards/map  →  src/app/dashboards/map/page.tsx
  └─ <DashboardShell title="Jobs Map" accentColor="blue" fullWidth={true}>
      └─ <MapClient>
          ├─ <FilterBar>            (top toolbar, mode + type chips + crew/shop dropdowns)
          ├─ <JobMapCanvas>         (Google Maps via @vis.gl/react-google-maps)
          │   ├─ markers (clustered)
          │   ├─ crew pins
          │   └─ crew route polylines on hover
          ├─ <DetailPanel>          (right slide-out, opens on marker click)
          └─ <DroppedCountFooter>   (surface markers without lat/lng)
```

Wrapped in the existing `DashboardShell`. Full-bleed layout. Accent color blue.

### Data sources

Single aggregation endpoint:

```
GET /api/map/markers?mode={today|week|backlog}&types={csv}&date={ISO}
```

The handler fans out in parallel:

| Source | Today mode | Week mode | Backlog mode |
|--------|-----------|-----------|--------------|
| HubSpot project-pipeline deals (installs) | `install_date = today` | `install_date in week` | RTB/blocked stages (unscheduled) |
| Zuper service jobs | `schedule_date = today` | `schedule_date in week` | Open tickets without Zuper job |
| HubSpot tickets | — | — | all open tickets |
| Inspection deals (Phase 2) | same as installs | same | pending inspection stage |
| Survey deals (Phase 2) | same as installs | same | pre-survey stages |
| D&R + Roofing (Phase 2) | same | same | open D&R/roofing work |
| `CrewMember` + today's scheduled stops | always | always | always |

**Phase 1 scope**: installs + service + crews only. Other types return empty arrays with the type chip showing "coming soon."

### Geocoding strategy

Priority order per address:
1. **`HubSpotPropertyCache` lookup by `addressHash`** — if property sync has already geocoded this address, use the cached lat/lng. No Google call.
2. **In-memory cache in `travel-time.ts`** — 24h TTL, already-warm addresses.
3. **`geocodeAddress()` live call** — fail-open (null) on errors or missing API key.

Markers whose address can't be geocoded are dropped from the response with a count. The footer shows "N jobs could not be placed (missing address)" with a link to `/api/map/markers?include=unplaced&debug=1` for resolution.

### API response contract

```ts
// src/lib/map-types.ts

export type JobMarkerKind = "install" | "service" | "inspection" | "survey" | "dnr" | "roofing";

export interface JobMarker {
  id: string;                    // stable: "install:PROJ-8241", "ticket:3114", "zuperjob:UUID"
  kind: JobMarkerKind;
  scheduled: boolean;
  lat: number;
  lng: number;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  title: string;                 // project name or ticket subject
  subtitle?: string;             // e.g. "9:00 AM · Alex P."
  status?: string;               // stage or live status
  priorityScore?: number;        // tickets only
  scheduledAt?: string;          // ISO; present when scheduled=true
  crewId?: string;
  dealId?: string;
  ticketId?: string;
  zuperJobUid?: string;
  rawStage?: string;             // for debugging / tooltips
}

export interface CrewPin {
  id: string;                    // CrewMember.id
  name: string;
  shopId: "dtc" | "westy" | "cosp" | "ca" | "camarillo";
  currentLat?: number;           // next scheduled stop lat
  currentLng?: number;
  routeStops: Array<{
    lat: number;
    lng: number;
    time: string;                // ISO
    title: string;
    kind: JobMarkerKind;
  }>;
  working: boolean;              // false → grey home-shop pin
}

export interface MapMarkersResponse {
  markers: JobMarker[];
  crews: CrewPin[];
  lastUpdated: string;           // ISO
  droppedCount: number;          // markers with unresolvable coords
  partialFailures?: string[];    // e.g. ["zuper: timeout", "hubspot: rate-limit fallback"]
  unplaced?: UnplacedMarker[];   // populated only when ?include=unplaced is passed
}

export interface UnplacedMarker {
  id: string;
  kind: JobMarkerKind;
  title: string;
  address: { street: string; city: string; state: string; zip: string };
  reason: "no-cache" | "geocode-failed" | "missing-address";
}
```

### Caching

- **Server**: 60s in-memory TTL via `lib/cache.ts`, keyed by `map:markers:${mode}:${date}:${typesHash}`. Shields underlying APIs.
- **Client**: React Query, `staleTime: 30_000`, `refetchOnWindowFocus: true`.
- **Real-time invalidation**: SSE cascade — when `deals:*`, `serviceTickets:*`, or `zuper:*` fire (keys defined in `lib/query-keys.ts`), invalidate `map:markers` with 500ms debounce to match the service-priority-cache pattern in `lib/service-priority-cache.ts`. No dedicated `crew:*` key exists today; crew assignment changes flow through the upstream `deals:*` / `zuper:*` keys, which is sufficient for Phase 1.

### Proximity computation

In-browser Haversine over already-loaded markers (no round-trip). `src/lib/map-proximity.ts`:

```ts
export function nearbyMarkers(
  origin: { lat: number; lng: number },
  markers: JobMarker[],
  options: { maxMiles?: number; limit?: number; excludeId?: string }
): Array<JobMarker & { distanceMiles: number }>;

export function closestCrews(
  origin: { lat: number; lng: number },
  crews: CrewPin[],
  options: { maxMiles?: number; limit?: number }
): Array<CrewPin & { distanceMiles: number }>;
```

Defaults: `maxMiles = 10`, `limit = 5`. Haversine is Euclidean-on-sphere — accurate enough for "which crew is close"; we don't need driving distance in the panel (the user can hit Maps for that).

## UI

### Top toolbar (Layout B)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Today | Week | Backlog]  [Install] [Service] [Survey] [Inspect] [+3]       │
│                                                      Crews ▾    Shops ▾     │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Mode toggle (3 segments) left-aligned
- Type chips (filter): active = solid orange background, inactive = dim
- Crews dropdown: checklist of active crews to show/hide on map
- Shops dropdown: checklist of shop locations (filter by branch)
- Theme: all tokens from `globals.css` — `bg-surface`, `text-foreground`, etc. No hardcoded colors.

### Marker taxonomy

| Element | Style |
|---------|-------|
| Scheduled install | Solid orange circle `#f97316`, 18px, white border |
| Unscheduled install | Dashed orange outline, transparent fill |
| Scheduled service | Solid green `#22c55e` |
| Unscheduled service ticket | Dashed green outline |
| Inspection | Solid/dashed blue `#3b82f6` |
| Survey | Solid/dashed purple `#a855f7` |
| D&R | Solid/dashed yellow `#eab308` |
| Roofing | Solid/dashed red `#ef4444` |
| Crew (working) | Cyan `#38bdf8` rounded square, 22px |
| Crew (home shop, not working) | Grey `#64748b` rounded square |
| Cluster small (2–9) | Orange translucent circle, 44px |
| Cluster medium (10–49) | Orange opaque, 52px |
| Cluster large (50+) | Warmer red tint, 60px |

**Color palette exception**: Map markers render on a Google Maps canvas and cannot use CSS variable tokens — the Maps JS API requires concrete color strings. All hex values listed above are centralized in `src/lib/map-colors.ts` as the single source of truth; map code imports from there rather than inlining literals. This is the only place in the app where hardcoded colors are acceptable.

Clustering via `supercluster` integrated with `@vis.gl/react-google-maps`. Individual markers render above zoom 13; below that, supercluster rolls up.

### Detail panel

Right-side slide-out, triggered by marker click. Sections scale by marker kind:

**Scheduled install** panel:
1. Header — kind pin + project name + PROJ-XXXX + status chip
2. Schedule — when, crew, status chip
3. Location — street + city + county
4. System — size kW DC, batteries, AHJ
5. Nearby open work — top 5 within 10 mi (distance-sorted)
6. Action buttons — Open in HubSpot · Scheduler · Zuper job

**Unscheduled service ticket** panel:
1. Header — kind pin + ticket subject + TICKET-XXXX
2. Priority — score + tier chip + stage + age + warranty chip
3. Location — street + city
4. Customer — name + phone + install date/size
5. Closest crew today — top 3 within 10 mi (distance + next-free-time)
6. Action buttons — Schedule this (primary) · Open ticket · Call customer

"Schedule this" deep-links to the relevant scheduler with query params:
- Service → `/dashboards/service-scheduler?ticketId=X&proposedCrewId=Y`
- Install → `/dashboards/construction-scheduler?dealId=X&proposedDate=Z`
- Etc. Each scheduler already supports these params for preselection (verify during implementation; add param support where missing — scoped in plan).

### Error states

| Failure | Behavior |
|---------|----------|
| Google Maps JS fails to load | Show `<JobMarkerTable>` fallback (same data, no map) |
| Aggregation endpoint 500 | Show error toast + retry button; detail panel closed |
| One source fails (e.g. Zuper timeout) | Partial response; `partialFailures` surfaced in footer + Sentry breadcrumb |
| Address won't geocode | Marker dropped; counted in `droppedCount`; footer link to list |
| SSE disconnect | `<LiveIndicator>` shows offline; manual refresh button appears |

## Role access

Added to `allowedRoutes` in `src/lib/roles.ts` for: `ADMIN`, `OWNER`, `PROJECT_MANAGER`, `OPERATIONS_MANAGER`, `OPERATIONS`, `SERVICE`.

Suite cards on:
- `src/app/suites/operations/page.tsx` — "Jobs Map" card linking to `/dashboards/map?mode=today`
- `src/app/suites/service/page.tsx` — "Jobs Map" card, default types=service

Routes added to both suites' role allowlists (see `feedback_api_route_role_allowlist.md`).

## Feature flags

| Flag | Default | Effect |
|------|---------|--------|
| `NEXT_PUBLIC_UI_MAP_VIEW_ENABLED` | `false` | When off, `/dashboards/map` shows "coming soon" stub; suite cards hidden |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | required for prod | Client-exposed Google Maps JS key (separate from server `GOOGLE_MAPS_API_KEY` used for Geocoding/Distance Matrix) |

Turn off route & cards entirely if flag is missing — no half-on states.

**Env var sync**: add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to `.env.example` and push to Vercel production BEFORE launching (see `feedback_vercel_env_sync.md`).

## Performance budgets

- **Marker count**: Phase 1 expected <500 markers/mode; clustering kicks in above 150 individual markers
- **Aggregation endpoint latency**: <3s p95 for Today mode, <5s for Backlog mode
- **Client bundle impact**: +~50kb gzipped (supercluster + map wrapper already in `@vis.gl/react-google-maps`)
- **Google Maps API cost**: Geocoding is cached in `HubSpotPropertyCache` for most addresses; only unplaced addresses trigger live Geocoding calls. Distance Matrix is NOT called for proximity (we use Haversine client-side).

## Data model changes

**None.** No new Prisma models, no migrations. Uses existing:
- `HubSpotPropertyCache` (lat/lng, already indexed on `[latitude, longitude]`)
- `CrewMember` + `CrewAvailability`
- HubSpot deals (via `lib/hubspot.ts`)
- Zuper jobs (via `lib/zuper.ts`)
- HubSpot tickets (via `lib/hubspot-tickets.ts`)

This keeps Phase 1 migration-free per `feedback_migration_ordering.md`.

## Testing strategy

### Unit tests

- `src/__tests__/map-aggregator.test.ts`:
  - Normalizes HubSpot deals → JobMarker (correct `kind`, `scheduled` flag, stable `id`)
  - Normalizes Zuper jobs → JobMarker
  - Normalizes tickets → JobMarker (priority score populated)
  - Drops markers with unresolvable coords, increments `droppedCount`
  - One source failing doesn't fail the whole response (`partialFailures` populated)
  - Geocoding priority order: cache → in-memory → live call
  - Geocoding fallback cascade: `HubSpotPropertyCache` miss → `travel-time` in-memory miss → live `geocodeAddress()` fails → marker goes to `unplaced[]` with `reason: "geocode-failed"`
- `src/__tests__/map-proximity.test.ts`:
  - Haversine distance correct for known coord pairs (Denver → Boulder ≈ 26 mi)
  - `nearbyMarkers` respects `maxMiles`, `limit`, `excludeId`
  - `closestCrews` sorts by distance ascending

### Component tests

- `src/__tests__/FilterBar.test.tsx`: toggling type chip removes/adds markers from rendered output
- `src/__tests__/DetailPanel.test.tsx`: shows correct sections for scheduled install vs unscheduled ticket
- Mock `@vis.gl/react-google-maps` with a dumb div — don't need real map for component tests

### Manual E2E (PR checklist)

Phase 1 smoke:
1. Load `/dashboards/map?mode=today` as OPERATIONS_MANAGER role
2. Verify installs + service markers appear with correct colors
3. Toggle install chip off — install markers disappear
4. Click a service ticket pin — detail panel opens with "Schedule this" button
5. Click "Schedule this" — navigates to `/dashboards/service-scheduler` with ticket preloaded
6. Click a crew pin — route polyline appears on hover
7. Flip feature flag off — page shows stub, suite cards hidden

## Phased delivery

### Phase 1 (this spec)
- Route + shell + top toolbar
- `/api/map/markers` for Today mode, installs + service only
- JobMarker + CrewPin types
- Map canvas + clustering
- Detail panel for install + service
- Deep-link scheduler handoff
- Proximity computation (client-side Haversine)
- Role access + feature flag + suite cards
- Unit + component tests
- Ship behind `NEXT_PUBLIC_UI_MAP_VIEW_ENABLED=false`, enable after smoke test in prod

### Phase 2 (separate spec, not in this one)
- Week + Backlog modes
- Inspection, survey, D&R, roofing markers
- Crew route polylines (data already in CrewPin, just needs rendering)
- Cluster polish (click-to-expand animation)

### Phase 3 (separate spec, not in this one)
- Live GPS integration via Zuper mobile
- Drag-to-reassign workflow (requires Zuper create-recreate pattern)

## File inventory (Phase 1)

New files:
- `src/app/dashboards/map/page.tsx`
- `src/app/dashboards/map/MapClient.tsx`
- `src/app/dashboards/map/JobMapCanvas.tsx`
- `src/app/dashboards/map/FilterBar.tsx`
- `src/app/dashboards/map/DetailPanel.tsx`
- `src/app/dashboards/map/JobMarkerTable.tsx` (fallback when Maps JS fails)
- `src/app/api/map/markers/route.ts`
- `src/lib/map-types.ts`
- `src/lib/map-aggregator.ts`
- `src/lib/map-proximity.ts`
- `src/lib/map-colors.ts`
- `src/__tests__/map-aggregator.test.ts`
- `src/__tests__/map-proximity.test.ts`
- `src/__tests__/FilterBar.test.tsx`
- `src/__tests__/DetailPanel.test.tsx`

Modified files:
- `src/lib/roles.ts` — add `/dashboards/map` + `/api/map/markers` to allowlists for ADMIN/OWNER/PM/OPS_MGR/OPS/SERVICE
- `src/app/suites/operations/page.tsx` — add suite card
- `src/app/suites/service/page.tsx` — add suite card
- `src/lib/query-keys.ts` — add `map:markers` key factory
- `.env.example` — add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_UI_MAP_VIEW_ENABLED`

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Google Maps JS API key exposed publicly | Restrict by HTTP referrer in Google Cloud Console; separate from server Geocoding key |
| Marker overload at full rollout | Supercluster handles 10k+ markers; Phase 1 capped at ~500 anyway |
| Address geocoding inconsistencies | Use `HubSpotPropertyCache` as source of truth; surface dropped count in UI for manual resolution |
| SSE cascade causing thundering herd | 500ms debounce matches existing service-priority-cache pattern |
| Scheduler deep-link params not universally supported | Audit each scheduler's query-param support during implementation; add where missing (scoped in plan) |
| Feature flag on without env var | Page shell checks for `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and falls back to table view if missing |

## Open questions

None remaining — all brainstorming decisions recorded above.
