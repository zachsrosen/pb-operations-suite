# PowerHub Geo-Coordinate Linking — Design Spec

**Date:** 2026-05-19
**Author:** Claude + Zach
**Status:** Approved (revised after implementation discovered an auth blocker)
**Teams:** Service, Design & Engineering, Admin
**Supersedes:** Auto-link algorithm in `src/lib/powerhub-auto-link.ts` (the date+battery heuristic)
**Builds on:**
- `2026-05-06-powerhub-integration-design.md` (Phase 1: API client + `PowerhubSite` table)
- `2026-05-18-powerhub-property-zuper-linking-design.md` (Phase 2: cross-system linking + UI surfacing)

> **Revision history (2026-05-19, after initial draft):** the first draft assumed the backend would call Tesla's portal GraphQL endpoint directly. Implementation found that `powerhub.energy.tesla.com/graphql` rejects our partner JWT with a 302 redirect to SSO login — and our partner-API proxy (`pb-powerhub-proxy.fly.dev`) has no GraphQL passthrough. Pivot: the user runs `assetGetSiteLocations` in their authenticated browser (Chrome MCP, a future admin-UI button, or a bookmarklet) and POSTs the JSON response to a new admin-only ingest endpoint. Same matching logic, different transport. Sections below reflect the revised approach. Verified blocker:
>
> ```
> partner JWT against portal /graphql, follow redirects
> FINAL HTTP 411, URL https://powerhub.energy.tesla.com/login?redirect_to=%2Fgraphql
> ```

## Problem

PowerHub linkage uses a date+battery heuristic because Tesla's documented REST API (`/asset/sites/{siteId}`) doesn't return site addresses. The heuristic scores each Tesla site one-directionally against candidate `HubSpotPropertyCache` rows using:

- Install-date proximity (`siteName` STE prefix vs `firstInstallDate ± window`)
- Battery presence (`PowerhubSite.totalBatteries > 0` vs `HubSpotPropertyCache.hasBattery`)

The flaw: each site finds its best property, but the algorithm never checks whether that property's best site is *this* site. Two-week install windows produce date-clusters of 5–28 Tesla sites that independently pick the same property as their top match. The "gap to runner-up" guard fires per-site, not per-property, so all of them auto-link.

**Backfill impact (measured 2026-05-19, pre-cleanup):**

- 2,996 provisioned Tesla sites in the fleet
- 175 sites linked to properties
- **Only 20 unique properties** carried those 175 links
- Top offenders: 28, 22, 18, 15, 12 sites on a single property
- **Zero of 175** had a real `addressHash` — every link came from the heuristic
- Cleanup ran at 16:45 UTC (script `scripts/unlink-heuristic-powerhub-links.ts`); fleet currently at zero linked sites

## Discovery — the right signal exists, but only in the browser

A network probe of Tesla's GridLogic portal (`powerhub.energy.tesla.com`) on 2026-05-19 revealed an undocumented GraphQL endpoint:

```graphql
query GetSiteLocations($targetId: String!) {
  assetGetSiteLocations(targetId: $targetId)
}
```

**Endpoint:** `POST https://powerhub.energy.tesla.com/graphql`

**Response shape:**
```json
{
  "data": {
    "assetGetSiteLocations": [
      {
        "latitude": 35.17170333862305,
        "longitude": -120.69721984863281,
        "siteId": "d81b536c-f1af-477b-a755-d21a0aefce8d",
        "siteName": "STE20230810-00404",
        "siteNumber": "STE20230810-00404"
      },
      ...
    ]
  }
}
```

**One call returns lat/lng for every site in the partner group** (3,130 sites for PB's instance). The Tesla portal uses the same endpoint to render its Map view, so latency and availability are production-grade.

**Validation against known truth:** 128 Hermosa Dr, Pismo Beach (HubSpot Property `51680210691`, Brotherton's install) geocodes to (35.1716958, -120.6972111). The probe returned a Tesla site at **1.16 meters** distance — unambiguously his install. The two next-nearest sites (96m, 186m) are neighbors with their own installs.

`HubSpotPropertyCache` already stores `latitude` and `longitude` from the Google geocoding pass that runs during property creation. The link reduces to a geometric problem.

### Auth blocker: portal GraphQL rejects partner JWT

The original draft of this spec assumed `getSiteLocations` could be called from the backend using our existing partner-API JWT. That turned out to be false. Empirical results from a follow-up probe:

| Test | Result |
|---|---|
| `pb-powerhub-proxy.fly.dev/v1/graphql` | 404 — proxy has no GraphQL passthrough |
| `pb-powerhub-proxy.fly.dev/v2/graphql` | 404 |
| `pb-powerhub-proxy.fly.dev/v2/asset/sites/locations` | 404 (route doesn't exist) |
| `pb-powerhub-proxy.fly.dev/v2/asset/sites/{id}` (the existing path) | 200 — **no geo fields in payload** |
| `powerhub.energy.tesla.com/graphql` w/ partner JWT | 302 → `/login?redirect_to=%2Fgraphql` |

The portal uses Tesla SSO browser cookies, not our partner OAuth tokens. Our backend cannot authenticate against the portal endpoint without scraping a user's session.

### Pivot: user-driven browser ingest

Rather than build a brittle Playwright bridge that logs into Tesla SSO with stored credentials (2FA handling, ToS gray area, credential rotation overhead), the design pivots to **a user-driven ingest pattern**:

1. An authenticated user (admin, already logged into the Tesla portal) runs the `assetGetSiteLocations` GraphQL query in their browser. Three equivalent paths:
   - **Chrome MCP** (used for the initial bulk import on 2026-05-19): the assistant fetches in the user's session, captures the JSON.
   - **Bookmarklet** (future): one-click capture and POST.
   - **Admin UI button** (future): in `/dashboards/admin/powerhub`, a "Refresh from portal" button opens the portal in a hidden iframe + extracts via `postMessage`. May not be feasible due to CORS; bookmarklet is the realistic alternative.
2. The browser POSTs the JSON payload (`{sites:[{siteId, latitude, longitude, siteName?}]}`) to `/api/powerhub/import-locations` on PB Tech Ops Suite.
3. The backend matches each site to its nearest `HubSpotPropertyCache` row within the configured threshold and writes the link.

Frequency: manual quarterly cadence is fine. New Tesla sites land in our `PowerhubSite` table via the every-6h asset-sync cron without coords; they sit UNLINKED until the next manual import. PB's fleet adds a handful of sites per week, so a quarterly refresh keeps the fleet ≥98% linked.

## Goal

Replace the date+battery heuristic with geographic-proximity matching. Achieve ≥95% auto-link accuracy on the existing fleet with zero false-positive clustering. Make the link maintainable as new Tesla sites come online.

## Scope

### In scope (this spec)

1. **Schema additions** — `PowerhubSite.{latitude, longitude, linkDistanceM, lastGeoSyncAt}`; `PowerhubLinkMethod.GEO` enum value; composite btree index on `(latitude, longitude)`.
2. **Geo-match library** — `src/lib/powerhub-geo-match.ts`: pure haversine, confidence tiering, bounding-box pre-filter, nearest-property selection. 100% unit-testable.
3. **Ingest API** — `POST /api/powerhub/import-locations`: admin-only, accepts `{sites:[{siteId, latitude, longitude, siteName?}]}`, writes coords + geo-link per site, re-resolves primary site per affected property. Supports `?dryRun=1`.
4. **Initial fleet import** — one-shot run via Chrome MCP after the API ships, populating coords + links for all 3,130 Tesla sites.

### Out of scope (follow-ups)

- **Deletion of `autoLinkSites()`** (the broken date+battery heuristic). Stays for now; safe because nothing calls it post-cleanup.
- **Admin UI panel** for triggering the import + showing distance badges per linked site, plus an unlink/manual-override workflow for the LOW (50-100m) tier.
- **Bookmarklet** or admin-UI button for the recurring refresh. Initial import uses Chrome MCP; ongoing refresh is a manual ritual until that ships.
- **Asset-sync cron integration** — currently new Tesla sites land without coords and stay UNLINKED until the next manual import. Future work: when the asset-sync cron sees a new site, kick off an admin notification ("3 new Tesla sites pending geo-import") so the cadence stays tight.

## Design

### Distance thresholds

```
≤  25m   → linkConfidence='HIGH',   linkMethod='GEO',   auto-write
≤  50m   → linkConfidence='MEDIUM', linkMethod='GEO',   auto-write
≤ 100m   → linkConfidence='LOW',    linkMethod='GEO',   write but flag for admin review
> 100m   → leave UNLINKED, admin queue
```

**Rationale for 25m HIGH:** Tesla's lat/lng appears precise to ~6 decimals (sub-meter); Google geocoding on a residential street address is typically accurate to 10–20m. A 25m circle covers normal geocoding jitter for the same address. The 1.16m match at Brotherton's confirms this is realistic for the bulk of cases.

**Rationale for >100m UNLINKED:** Beyond 100m, you're crossing into the next lot or apartment building. Better to leave unlinked than risk neighbor-collisions like we just saw (96m, 186m around Brotherton).

### Multi-site-at-same-property handling

If two Tesla sites are both ≤25m of the same property (e.g., expansion install ~1 year later), both link to that property. Existing `resolvePrimarySite()` picks one as primary using its established logic (newest STE date by default). No changes needed.

If a single Tesla site is ≤25m of two different properties (apartment buildings, dense urban infill), pick the closer one. Tag with a `linkAmbiguity: true` flag for admin review.

### The geo-match SQL

PostgreSQL doesn't ship with geo functions, but we can use the haversine formula in pure SQL. Approximate fast path:

```sql
-- For each Tesla site at (siteLat, siteLng):
WITH site AS (SELECT $1::float AS lat, $2::float AS lng)
SELECT 
  hpc.id,
  -- meters via haversine
  6371000 * 2 * ASIN(SQRT(
    POWER(SIN(RADIANS(hpc.latitude - site.lat) / 2), 2) +
    COS(RADIANS(site.lat)) * COS(RADIANS(hpc.latitude)) *
    POWER(SIN(RADIANS(hpc.longitude - site.lng) / 2), 2)
  )) AS distance_m
FROM "HubSpotPropertyCache" hpc, site
WHERE hpc.latitude IS NOT NULL
  AND hpc.longitude IS NOT NULL
  -- Pre-filter: rough bounding box (1° lat ≈ 111km, narrows the index scan)
  AND hpc.latitude  BETWEEN site.lat - 0.002 AND site.lat + 0.002
  AND hpc.longitude BETWEEN site.lng - 0.002 AND site.lng + 0.002
ORDER BY distance_m ASC
LIMIT 5;
```

For the one-shot script (3,130 sites × ~3,000 candidate properties), batch this. Loading all properties' coordinates into memory and doing the haversine loop in Node is fine — 9M operations completes in seconds. The bounding-box pre-filter isn't even strictly necessary at this scale.

### Ingest endpoint

`POST /api/powerhub/import-locations` (admin-only, `?dryRun=1` for preview):

```ts
// Request body
{
  sites: [
    { siteId: string, latitude: number, longitude: number, siteName?: string },
    ...
  ]
}

// Server-side flow
1. Load all HubSpotPropertyCache rows with non-null lat/lng → candidates
2. Load existing PowerhubSite rows matching incoming siteIds → existing
3. For each incoming site:
     - Bounding-box pre-filter the candidates (cheap)
     - Find nearest within 100m via haversine
     - Build update payload:
         (a) match found       → write coords + GEO link
         (b) no match, was linked → CLEAR the stale link (propertyId=null,
             linkMethod=UNLINKED, demote primaryForProperty) and mark the
             OLD propertyId as touched so its denorm fields refresh
         (c) no match, wasn't linked → write coords only
4. For each touched propertyId, call resolvePrimarySite()
5. Respond with { coordsUpdated, linksWritten, linksCleared, skippedUnknown,
                  matched:{HIGH,MEDIUM,LOW,UNMATCHED}, propertiesResolved,
                  dryRun }
```

The "clear stale links on no-match" branch (case b) is critical: without it, re-imports after a property's geocoding shifts would silently preserve broken links. Caught in code review on PR #784.

### Schema additions

Two new fields on `PowerhubSite`:

```prisma
model PowerhubSite {
  ...
  latitude         Float?
  longitude        Float?
  linkDistanceM    Float?     // distance from matched property, for ranking + UI badge
}
```

No new tables. `linkMethod` enum gets `GEO` added.

### Removing the old heuristic

`src/lib/powerhub-auto-link.ts::autoLinkSites()` is the only call path that previously produced the over-clustering. Post-cleanup (PR #775), no caller currently invokes it. It stays in the codebase as a separate follow-up cleanup PR — deleting it isn't required for the geo path to work, and leaving it for now keeps PR #784 focused. The follow-up should:

1. Delete `src/lib/powerhub-auto-link.ts` and the corresponding route at `/api/powerhub/auto-link/route.ts`.
2. Remove any UI references in `/dashboards/admin/powerhub`.
3. Drop the `ScoredCandidate`-related types.

### Asset-sync cron — left as-is

Because we can't call `assetGetSiteLocations` from the backend, the asset-sync cron (`syncSitesForGroup()`) cannot automatically populate coords on newly-discovered sites. New sites land in `PowerhubSite` with `latitude=null, longitude=null` and `linkMethod=UNLINKED`. They surface in the admin queue.

The expected operational cadence:
- Asset-sync cron runs every 6 hours and discovers new sites (a few per week)
- Quarterly (or as-needed), an admin opens the Tesla portal in their browser and runs the import via Chrome MCP / bookmarklet / admin UI button (when the latter ships)
- Fleet stays ≥98% linked at quarterly cadence given PB's install pace

## Migration plan

### Phase 1 (this PR, #784): Schema + ingest endpoint + initial import

1. Prisma migration: add `latitude`, `longitude`, `linkDistanceM`, `lastGeoSyncAt` to `PowerhubSite`; add `GEO` to `PowerhubLinkMethod` enum; composite index on `(latitude, longitude)`.
2. `src/lib/powerhub-geo-match.ts`: pure haversine + tier helpers, unit-tested.
3. `POST /api/powerhub/import-locations`: admin-only ingest, with the stale-link clearing logic from code review.
4. After merge + Vercel deploy + prod migration: run a one-shot import via Chrome MCP. Captures the `assetGetSiteLocations` JSON in the user's authenticated Tesla portal session, POSTs to the new endpoint, writes coords + links + resolves primaries for all ~3,130 sites in one go.

### Phase 2 (follow-up): Delete the broken heuristic

- Delete `autoLinkSites()` and `/api/powerhub/auto-link` route.
- Drop the date+battery scoring types.
- Sanity-check that no UI references the deleted route.

### Phase 3 (follow-up): Admin UI for ongoing refresh

- Add a "Refresh from Tesla portal" button to `/dashboards/admin/powerhub` that opens a bookmarklet helper or guides the user through Chrome DevTools.
- Show per-site distance badges (`1.16m HIGH`) in the admin sites table.
- Show "N new sites pending geo-import" banner when asset-sync discovers sites without coords.

### Phase 4 (deferred): Gateway-serial fallback

If we hit edge cases the geo match can't solve (rural addresses with poor geocoding, off-grid systems with no Tesla-reported coords, dense apartment buildings where multiple Powerwalls share an addressHash), pivot to gateway-serial matching — the partner-API `/v2/asset/sites/{id}` endpoint already returns gateway serials in `devices[]`. We'd add a HubSpot deal property `tesla_gateway_serial` populated via install-photo OCR or tech entry. Not needed for the ≥95% target.

## Risks

1. **Tesla portal endpoint changes.** Tesla could remove `assetGetSiteLocations`, change its schema, or harden auth further. Mitigation: the import is manual and infrequent (quarterly), so breakage surfaces as "this import failed" and we can adapt the captured query. If the endpoint disappears entirely, fall back to Phase 4 (gateway serials).

2. **User's portal session ends mid-import.** The Chrome MCP / bookmarklet pattern depends on the admin being actively logged in. Trivial failure mode (re-login and retry) and the dry-run flow protects against accidental partial writes.

3. **Property coordinates that don't match Tesla's.** Google geocoding and Tesla's site coordinates can disagree by tens of meters even for the same address — different geocoding sources, different snap-to-street logic. The 25m HIGH threshold should absorb most of this; the 100m wide net catches the rest as MEDIUM/LOW with admin review.

4. **Apartment buildings / dense urban infill.** Multiple Powerwalls at the same physical address but different units. The geo-match will tie them all to one property cache row (since `HubSpotPropertyCache.addressHash` doesn't distinguish unit numbers cleanly today). Acceptable for now — the Monitoring tab already supports multiple linked sites per property.

5. **Sites with no coordinates.** Tesla returned 3,130 sites for our group; the broader provisioned count is 2,996. The mismatch suggests some sites exist in the GraphQL response but not in our `PowerhubSite` table (newer sites? sub-group differences? off-grid pre-commissioning state?). Acceptable — they fall out of the geo match and stay UNLINKED.

6. **ToS / bot-check on the portal.** Browser-driven captures from a logged-in admin should be indistinguishable from normal portal usage. If Tesla starts enforcing a bot check on `/graphql`, the import flow breaks and we'd need Phase 4. Low probability.

## Success criteria

- All 19 currently over-clustered properties resolve to a single Tesla site (or honest multi-site cluster representing real expansion installs).
- ≥95% of sites previously misattributed re-link to the correct property within 25m.
- Brotherton's Monitoring tab shows exactly one site (STE20230810-00404) at 1.16m, not the 10 sites the heuristic produced.
- New sites coming online via the asset-sync cron auto-link at provisioning with no admin intervention.
- `autoLinkSites()` (date+battery heuristic) is deleted from the codebase.

## Appendix — full GraphQL operation catalog discovered during probe

These are the operations the Tesla portal makes against `https://powerhub.energy.tesla.com/graphql`. Only `assetGetSiteLocations` is required for this spec, but the others are documented for future reference:

| Operation | Purpose | Use case |
|-----------|---------|----------|
| `GetSiteLocations` | All sites' lat/lng for a group | **This spec** |
| `GetActiveAlerts` | Paginated alert list with `din`, `siteId`, severity, description, symptom codes | Already implemented via REST; GraphQL version is richer |
| `GetHierarchyDescendantsAggregates` | Total counts (sites, gateways, batteries, inverters, wall connectors) | Fleet dashboard |
| `getDataPoints` (a.k.a. `getTelemetryHistory`) | Telemetry history with full signal control | Telemetry charting |
| `GetChargerSiteStatuses` | Wall-connector status | EV charger monitoring |
| `GetChargerSiteAggregates` | Wall-connector aggregates | EV charger dashboard |
| `getEnergySummaries` | Energy summary stats | Reporting |
| `getTelemetryGroupRtaAggregate` | Group-level real-time telemetry | Live dashboards |
| `GetStatusBannerMessage` | Portal banner messages | UI shell |

GraphQL introspection is disabled on Tesla's server (`INTROSPECTION_DISABLED`), so schema details for these operations must be reverse-engineered from network captures rather than introspection.
