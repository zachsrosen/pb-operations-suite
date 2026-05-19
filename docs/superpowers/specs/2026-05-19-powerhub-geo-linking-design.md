# PowerHub Geo-Coordinate Linking — Design Spec

**Date:** 2026-05-19
**Author:** Claude + Zach
**Status:** Draft
**Teams:** Service, Design & Engineering, Admin
**Supersedes:** Auto-link algorithm in `src/lib/powerhub-auto-link.ts` (the date+battery heuristic)
**Builds on:**
- `2026-05-06-powerhub-integration-design.md` (Phase 1: API client + `PowerhubSite` table)
- `2026-05-18-powerhub-property-zuper-linking-design.md` (Phase 2: cross-system linking + UI surfacing)

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

## Discovery — the right signal exists

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

`HubSpotPropertyCache` already stores `latitude` and `longitude` from the Google geocoding pass that runs during property creation. The link reduces to a geometric problem we can solve in one SQL query.

## Goal

Replace the date+battery heuristic with geographic-proximity matching. Achieve ≥95% auto-link accuracy on the existing fleet with zero false-positive clustering. Make the link maintainable as new Tesla sites come online.

## Scope

### In scope

1. **New Tesla client method** — `getSiteLocations(targetId)` on `PowerHubClient`, hitting the GraphQL endpoint with the documented query.
2. **Geo-match script** — `scripts/link-powerhub-by-geo.ts`. Fetches all site locations for the configured group, matches each to its nearest `HubSpotPropertyCache` row within a distance threshold, writes the link with confidence based on distance.
3. **Auto-link replacement** — rip out the date+battery heuristic in `src/lib/powerhub-auto-link.ts`. Replace with a geo-distance check, OR delete `autoLinkSites()` entirely and rely on (a) the one-shot backfill script + (b) per-site geo matching at sync time.
4. **Sync-time geo matching** — `src/lib/powerhub-sync.ts` calls `getSiteLocations()` for new/changed sites and applies the geo match at provisioning, so the fleet stays linked as Tesla sites come online without periodic backfills.
5. **Admin UI surface** — `/dashboards/admin/powerhub` shows geo-link distance per site (badge: HIGH/MEDIUM/LOW based on meters), lets admins override mismatches.

### Out of scope

- Gateway serial extraction from install photos (deferred; geo matching covers the vast majority of cases, serial only needed for edge cases).
- Re-architecting the existing `PowerHubClient` from REST to GraphQL wholesale. We add one GraphQL call; rest of the client stays REST. (Tesla returns telemetry via REST; only asset/location data is GraphQL-only.)
- Anything to do with Tesla portal authentication. The `getSiteLocations` GraphQL endpoint uses the same partner-API JWT we already mint via `TESLA_POWERHUB_CLIENT_ID`/`SECRET`.

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

### Backfill script

`scripts/link-powerhub-by-geo.ts`:

```
1. const sites = await teslaClient.getSiteLocations(GROUP_ID)
   → 3,130 sites with lat/lng/siteId/siteName

2. const properties = await prisma.hubSpotPropertyCache.findMany({
     where: { latitude: { not: null }, longitude: { not: null } },
     select: { id, latitude, longitude },
   })

3. For each site:
     - Compute haversine distance to every property
     - Find nearest within 100m
     - Write/update PowerhubSite:
         { propertyId, linkMethod: 'GEO', linkConfidence: tier, 
           latitude: site.latitude, longitude: site.longitude }
     - If no match within 100m: leave UNLINKED

4. For each affected propertyId:
     - resolvePrimarySite(propertyId) — refreshes teslaPortalUrl/teslaSiteId

5. Output a JSON report: 
     { highMatches, mediumMatches, lowMatches, unlinked, ambiguous }
```

Defaults to dry-run (`--apply` to execute), writes backup JSON like the unlink script.

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

`src/lib/powerhub-auto-link.ts::autoLinkSites()` is the only call path. Replace its body with a thin shim that calls the geo logic, or just delete the file entirely.

Hard-removal is preferred — the function has a documented bug, and the way to "auto-link" going forward is the geo path, not the heuristic path. If we leave it in, someone (probably future-me) will accidentally call it again.

`POST /api/powerhub/auto-link` route stays but its body becomes the geo-match logic. Same admin entry point, different algorithm.

### Asset-sync cron integration

`src/lib/powerhub-sync.ts::syncSitesForGroup()` currently calls `tesla.getGroups()` then `tesla.getSiteDetail(siteId)` per site. After this change:

1. Once per sync (not per-site): `tesla.getSiteLocations(groupId)` → cache the (siteId → lat/lng) map in memory for the sync run.
2. When upserting each `PowerhubSite`, look up its coords in that map; write to `PowerhubSite.latitude/longitude`.
3. If the site is currently `UNLINKED`, attempt a geo-match against `HubSpotPropertyCache` and write the link.

New sites land linked at sync time. No periodic backfills needed.

## Migration plan

### Phase 1: Schema + client (1 PR)

1. Prisma migration: add `latitude`, `longitude`, `linkDistanceM` to `PowerhubSite`; add `GEO` to `PowerhubLinkMethod` enum.
2. Add `getSiteLocations(targetId)` to `PowerHubClient` in `src/lib/tesla-powerhub.ts`. Uses an `apiCallGraphQL<T>()` helper that POSTs to `/graphql`.
3. Add unit tests for the GraphQL client + a Jest test asserting we don't accidentally call REST `/asset/sites/{id}` for location lookups.

### Phase 2: Backfill script (1 PR)

1. `scripts/link-powerhub-by-geo.ts` — dry-run by default, `--apply` to execute, JSON backup.
2. Run against prod after PR merge (manual `tsx scripts/...` invocation with prod `DATABASE_URL`).
3. Verify in Brotherton's Monitoring tab that the right site (STE20230810-00404, not STE20230821-00641) shows as primary at 1.16m.

### Phase 3: Sync integration + algorithm cleanup (1 PR)

1. Update `powerhub-sync.ts` to call `getSiteLocations()` once per sync and apply per-site geo match.
2. Delete `autoLinkSites()` (or rewrite as geo).
3. Update `/api/powerhub/auto-link` body to call the geo path.
4. Admin UI: add distance badges on the PowerHub admin dashboard.

## Risks

1. **GraphQL endpoint is undocumented.** Tesla could change or remove it without warning. Mitigation: the REST `/asset/sites/{siteId}` endpoint stays in use for telemetry, and we add a unit test that calls `getSiteLocations` against a sandbox to catch schema drift in CI. If the endpoint disappears, fall back to the gateway-serial-from-photos plan (deferred work).

2. **Authentication.** Need to verify the GraphQL endpoint accepts the same partner-API JWT as the REST endpoints. The probe ran in a browser session with the user logged in; production will mint a fresh JWT via the existing OAuth flow and hit `/graphql` directly. Quick test in Phase 1 will confirm.

3. **Property coordinates that don't match Tesla's.** Google geocoding and Tesla's site coordinates can disagree by tens of meters even for the same address — different geocoding sources, different snap-to-street logic. The 25m HIGH threshold should absorb most of this; the 100m wide net catches the rest as MEDIUM/LOW with admin review.

4. **Apartment buildings / dense urban infill.** Multiple Powerwalls at the same physical address but different units. The geo-match will tie them all to one property cache row (since `HubSpotPropertyCache.addressHash` doesn't distinguish unit numbers cleanly today). Acceptable for now — the Monitoring tab already supports multiple linked sites per property.

5. **Sites with no coordinates.** Tesla returned 3,130 sites for our group; the broader provisioned count is 2,996. The mismatch (3,130 vs 2,996) suggests some sites exist in the GraphQL response but not in our `PowerhubSite` table (newer sites? sub-group differences?). Need to reconcile during Phase 2 backfill — and accept that some sites may not have coords (e.g., off-grid pre-commissioning state).

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
