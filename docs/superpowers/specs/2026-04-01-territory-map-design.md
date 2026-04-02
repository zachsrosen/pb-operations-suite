# Territory Map Dashboard — Design Spec

## Context

Ownership wants to rebalance Colorado office territories so Westminster and Centennial (DTC) handle roughly equal deal volume, with Colorado Springs at 50% of each (2:2:1 ratio). The current HubSpot workflow routes deals by latitude, but the boundaries (39.815 / 39.29) are misaligned — Westminster is overweight at 2,924 deals vs Centennial's 1,263.

Analysis of 4,700 geocoded CO deals shows optimal boundaries at **39.81** (Westminster/Centennial) and **39.52** (Centennial/Colorado Springs), yielding ~1,880 / ~1,880 / ~940.

This dashboard lets ownership visualize the current vs proposed territory lines on a real map, see deal distribution, and click through to individual deals in HubSpot.

## New Files

### 1. `src/app/api/territory-map/route.ts`

Dedicated lightweight API that paginates through all CO project-pipeline deals with coordinates.

**Query params:** None — the API always returns all deals. Active/all filtering is done client-side (see dashboard page section).

**HubSpot search filters:**
- `state` EQ `CO`
- `pipeline` EQ `6900017` (project pipeline)
- `latitude` HAS_PROPERTY
- `longitude` HAS_PROPERTY

**Properties fetched (minimal set):**
- `hs_object_id`, `dealname`, `latitude`, `longitude`, `pb_location`, `amount`, `dealstage`, `pipeline`

**Pagination:** Loop `searchWithRetry()` with `after` cursor, 200 per page, with `150ms` delay between pages (matches existing `fetchDealsForPipeline` pattern to avoid 429s).

**Active filter:** `getActiveStages()` returns stage *labels*, not HubSpot stage IDs. To filter server-side we'd need to reverse-map through `getStageMaps()`. Since this adds complexity for marginal benefit (we cache the full set anyway), use **client-side post-filter** instead: always fetch all deals, and when `active=true` the page filters out closed-stage deals before rendering. The API returns all deals regardless, and the page `useMemo` applies the active filter.

**Response shape:**
```typescript
interface TerritoryDeal {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  pbLocation: string;
  amount: number;
  stage: string;
  url: string;
}

// GET /api/territory-map
{
  deals: TerritoryDeal[];
  total: number;
  lastUpdated: string;
}
```

**Caching:** The shared `appCache` singleton is fixed at 5-min fresh / 10-min stale with no per-key override. Create a dedicated `territoryCache = new CacheStore(15 * 60 * 1000, 20 * 60 * 1000)` instance in the route file for the longer TTL. Add `TERRITORY_MAP` to `CACHE_KEYS` in `lib/cache.ts` for consistency (used as the key string, not as a TTL config).

**Auth:** Standard session auth via middleware (executive-level access).

### 2. `src/app/dashboards/territory-map/page.tsx`

Client component wrapped in `<DashboardShell title="Territory Map" accentColor="blue" fullWidth>`.

**SSR guard:** The Google Maps component must be imported via `next/dynamic` with `{ ssr: false }` since it accesses `window`/`document`. Extract the map + overlays into a `TerritoryMapView` sub-component and dynamically import it.

**Layout (top to bottom):**

1. **MetricCards row** — Three `MetricCard` components, one per office (Westminster / Centennial / Colorado Springs), each showing:
   - Deal count
   - Total revenue (formatted via `formatCurrencyCompact`)
   - Percentage of total
   - Left border accent using `LOCATION_COLORS[office].hex`
   - Cards recalculate based on boundary toggle (current vs proposed)

2. **Controls bar** — Flex row with:
   - **Scope toggle:** "Active Only" / "All Time" (client-side `useMemo` filter on the cached dataset)
   - **Boundary toggle:** "Current" / "Proposed" (switches lat lines and recalculates cards)
   - Styled as small pill buttons matching existing dashboard filter patterns

3. **Google Map** — Full-width, height `calc(100vh - 320px)` to fill remaining viewport.
   - **Center:** ~39.5, -104.8 (central Colorado)
   - **Zoom:** 7 (shows full state)
   - **Map type:** roadmap (with terrain option)

**Map overlays:**

- **Deal markers:** `AdvancedMarkerElement` colored by `LOCATION_COLORS[pbLocation].hex`. Use `@googlemaps/markerclusterer` for clustering when zoomed out.
- **Boundary lines:** Two horizontal `Polyline` components at the latitude cutoffs. Dashed stroke, color matching the zone below. In "Proposed" mode, lines shift from 39.815/39.29 to 39.81/39.52.
- **Zone shading:** Three `Rectangle` overlays with low-opacity fill between boundary lines, colored per office.
- **InfoWindow on marker click:** Shows deal name, pb_location badge, amount, and "Open in HubSpot" button (`window.open(deal.url, '_blank')`).

**Data fetching:** React Query via `useQuery` with key from `queryKeys.territoryMap()`. Stale time 5 minutes. The API always returns all deals; the active/all toggle is a client-side `useMemo` filter, so only one query key is needed.

**Location normalization:** All `pbLocation` values must be run through `normalizeLocation()` from `src/lib/locations.ts` before using for color lookup or aggregation. This handles aliases like `DTC` → `Centennial`, `Westy` → `Westminster`, `COSP` → `Colorado Springs`.

**States:**
- **Loading:** Skeleton placeholder matching map dimensions
- **Error:** `ErrorState` component with retry button
- **Empty:** Message indicating no geocoded deals found

**Recalculation logic for "Proposed" toggle:**
- When toggled, iterate deals and reassign `computedLocation` based on proposed latitude thresholds (39.81 / 39.52) instead of `pbLocation`
- MetricCards reflect the recomputed counts/revenue
- Marker colors update to show where deals *would* go

## Modified Files

### 3. `src/app/suites/executive/page.tsx`

Add a "Territory Map" card to the Executive Views section, linking to `/dashboards/territory-map`. Icon: map pin or globe.

### 4. `src/components/DashboardShell.tsx`

Add entry to `SUITE_MAP`:
```typescript
"/dashboards/territory-map": { href: "/suites/executive", label: "Executive" }
```

### 5. `src/lib/query-keys.ts`

Add `territoryMap` key factory and `cacheKeyToQueryKeys` mapping:
```typescript
// In queryKeys object:
territoryMap: {
  root: ["territory-map"] as const,
  all: () => ["territory-map"] as const,
},

// In cacheKeyToQueryKeys():
if (serverKey.startsWith("territory-map")) return [queryKeys.territoryMap.root];
```

### 6. `src/lib/cache.ts`

Add to `CACHE_KEYS`:
```typescript
TERRITORY_MAP: "territory-map",
```
(Single key — active filtering is client-side, so only one cached dataset.)

### 7. `src/lib/constants.ts`

Add `TERRITORY_BOUNDARIES` constant:
```typescript
export const TERRITORY_BOUNDARIES = {
  current: { westminster: 39.815, centennial: 39.29 },
  proposed: { westminster: 39.81, centennial: 39.52 },
} as const;
```

### 8. `src/lib/role-permissions.ts`

Add both `/dashboards/territory-map` and `/api/territory-map` to executive-level route access for: ADMIN, EXECUTIVE, PROJECT_MANAGER (read-only), OPERATIONS_MANAGER (read-only).

### 9. `.env.example`

Add:
```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=  # Client-side Google Maps (restrict by HTTP referrer in Cloud Console)
```

The existing `GOOGLE_MAPS_API_KEY` stays for server-side use (travel time). The new `NEXT_PUBLIC_` variant is needed for the client-side Maps JS API. Both can reference the same key, but the public one must have referrer restrictions configured in Google Cloud Console.

## Dependencies

**New npm packages:**
- `@vis.gl/react-google-maps` — official Google-maintained React wrapper for Maps JS API
- `@googlemaps/markerclusterer` — marker clustering for dense areas

**Existing (reused):**
- `LOCATION_COLORS` from `src/lib/constants.ts`
- `formatCurrencyCompact` from `src/lib/format.ts`
- `MetricCard` from `src/components/ui/MetricCard.tsx`
- `DashboardShell` from `src/components/DashboardShell.tsx`
- `LoadingSpinner` / `ErrorState` from `src/components/ui/`
- `searchWithRetry` from `src/lib/hubspot.ts`
- `CacheStore` from `src/lib/cache.ts` (dedicated instance with 15-min TTL)
- `normalizeLocation` from `src/lib/locations.ts`

## Not Modified (intentional)

- **`src/lib/deals-pipeline.ts` / `src/app/api/deals/route.ts`** — the territory map has its own dedicated API route with a minimal property set. No need to add latitude/longitude to the shared `DEAL_PROPERTIES` or general `Deal` interface since no other consumer needs them today.

## Verification

1. `npm run build` — no type errors
2. `npm run lint` — clean
3. Visit `/dashboards/territory-map` — map loads with deal dots
4. Click a deal dot — InfoWindow shows with "Open in HubSpot" link that opens correct deal
5. Toggle Active/All — deal count changes, map updates
6. Toggle Current/Proposed — boundary lines shift, MetricCards recalculate, marker colors update
7. Verify MetricCards show ~1,880/1,880/940 split in Proposed mode for all-time
8. Check mobile — map should still be usable (pinch zoom)
