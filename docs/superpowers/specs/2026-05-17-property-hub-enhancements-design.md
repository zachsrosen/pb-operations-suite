# Property Hub Enhancements Design

## Goal

Enrich the Property Hub page (`/properties/[id]`) with actual equipment names, total revenue, external links to Zuper and HubSpot, and Zuper job photos — replacing placeholder counts with real data and connecting the property view to all upstream systems.

## Context

The Property Hub page exists at `/properties/[id]` with 6 tabs (Activity, Deals, Tickets, Jobs, Schedule, Equipment). The header shows address, location badges, equipment presence chips, and an "Open in HubSpot" button. Several data gaps exist:

- Equipment shows counts only ("Batteries: 2") despite `computePropertyRollups()` already computing brand/model summary strings and pushing them to HubSpot
- No total revenue metric despite it being computed and pushed to HubSpot as `total_deal_value`
- No link to the Zuper Property despite `zuperPropertyUid` being stored in `HubSpotPropertyCache`
- Deal cards link internally only — no HubSpot external link
- Job cards have no links to Zuper at all
- Zuper job photos are fetchable via `getJobPhotos()` but not surfaced anywhere

The extended rollup fields (equipment summaries, panel count, total deal value) are computed in `computePropertyRollups()` and pushed to HubSpot, but NOT cached locally — the Prisma schema has no columns for them (noted at property-sync.ts:638-643).

## Enhancements

### 1. Local Cache for Extended Rollups (Migration)

Add 6 nullable columns to `HubSpotPropertyCache`:

| Column | Type | Source |
|--------|------|--------|
| `moduleSummary` | `String?` | `buildEquipmentSummaries()` output |
| `inverterSummary` | `String?` | `buildEquipmentSummaries()` output |
| `batterySummary` | `String?` | `buildEquipmentSummaries()` output |
| `evChargerSummary` | `String?` | `buildEquipmentSummaries()` output |
| `panelCount` | `Int?` | Count of module line items |
| `totalDealValue` | `Float?` | Sum of `Deal.amount` across linked deals |

Update `computePropertyRollups()` to write these to the local cache alongside the existing HubSpot push. Pure additive — existing fields unchanged.

### 2. Equipment Names in Header + Equipment Tab

**Header**: Replace generic "Battery" / "EV Charger" chips with the actual summary strings when available. Examples:
- "Tesla Powerwall 3 x 2" instead of "Battery"
- "REC Alpha Pure 400W x 24 (9.6 kW)" instead of "7.2 kW System"

Fall back to the current generic chips when summaries are null (pre-rollup properties).

**Equipment Tab**: Below each count card, render the summary string as secondary text. E.g., under "Batteries: 2 (27 kWh)" show "Tesla Powerwall 3, Tesla Powerwall 3 Expansion Pack".

### 3. Total Revenue in Header

Display `totalDealValue` as a formatted USD amount in the header badge area. Show as a stat next to the system size / equipment chips. Format: "$30,550" with `Intl.NumberFormat`. Only render when value is non-null and > 0.

### 4. Zuper Property Link in Header

Add an "Open in Zuper" button alongside "Open in HubSpot" in the quick-actions area. URL format: `https://web.zuperpro.com/property/{zuperPropertyUid}/details`. Only render when `zuperPropertyUid` is non-null.

Expose `zuperPropertyUid` through:
- Add field to `PropertyDetail` type in `property-detail.ts`
- Map it in `mapCacheRowToPropertyDetail()`
- API already returns the full `PropertyDetail` — no route change needed

### 5. HubSpot Deal + Zuper Job/Project External Links

**Deals Tab**: Add an external link icon (arrow-top-right) on each deal card that opens the HubSpot deal record: `https://app.hubspot.com/contacts/{portalId}/record/0-3/{dealId}`. Portal ID from `NEXT_PUBLIC_HUBSPOT_PORTAL_ID`. Keep existing internal link as primary click.

**Jobs Tab**: Add external link icon on each job card → `https://web.zuperpro.com/jobs/{jobUid}/details`. If the job has a `projectUid` (already extracted from rawData into `HubJob`), add a second icon → `https://web.zuperpro.com/projects/{projectUid}/details`.

### 6. Zuper Job Photos (New Tab)

Add a 7th "Photos" tab to the Property Hub.

**API**: `GET /api/properties/[id]/hub?tab=photos` — resolves all Zuper jobs for the property via `ZuperJobCache`, calls `getJobPhotos(jobUid)` for each job (parallel, capped at 5 concurrent), deduplicates by URL, groups by job, sorts newest first. Returns `PhotosTabData = { groups: PhotoGroup[], totalPhotos: number }` where `PhotoGroup = { jobTitle, jobUid, category, photos: ZuperAttachment[] }`.

**Component**: `PropertyPhotosTab.tsx` — photo grid grouped by job. Each group has a job name header with Zuper link. Photos render as thumbnails in a responsive grid. Click opens full-size in a lightbox/modal. Show photo date and filename on hover. Empty state: "No photos available."

**Caching**: 5-minute TTL via `lib/cache.ts` with key `property-photos:{propertyId}`.

## Data Flow

```
HubSpotPropertyCache (DB)
  ├── moduleSummary, inverterSummary, etc. (new columns)
  ├── totalDealValue (new column)
  └── zuperPropertyUid (existing)
        │
        ▼
mapCacheRowToPropertyDetail() → PropertyDetail (adds new fields)
        │
        ▼
GET /api/properties/[id] → PropertyHubHeader (renders summaries, revenue, Zuper link)
GET /api/properties/[id]/hub?tab=equipment → EquipmentTab (renders summaries below counts)
GET /api/properties/[id]/hub?tab=deals → DealsTab (adds HubSpot external links)
GET /api/properties/[id]/hub?tab=jobs → JobsTab (adds Zuper external links)
GET /api/properties/[id]/hub?tab=photos → PhotosTab (new, fetches from Zuper API)
```

## Files Modified

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 6 columns to `HubSpotPropertyCache` |
| `src/lib/property-sync.ts` | Write extended rollups to local cache in `computePropertyRollups()` |
| `src/lib/property-detail.ts` | Add fields to `PropertyDetail`, `EquipmentSummary`; update mapper |
| `src/lib/property-hub.ts` | Add `PhotosTabData`, `PhotoGroup` types; add photos fetcher; update `HubTab` union |
| `src/components/property/PropertyHubHeader.tsx` | Equipment summaries, revenue, Zuper button |
| `src/components/property/PropertyHubTabs.tsx` | Add Photos tab |
| `src/components/property/PropertyEquipmentTab.tsx` | Show summary strings below count cards |
| `src/components/property/PropertyDealsTab.tsx` | Add HubSpot external link icons |
| `src/components/property/PropertyJobsTab.tsx` | Add Zuper job/project external link icons |
| `src/components/property/PropertyPhotosTab.tsx` | **NEW** — photo gallery component |
| `src/app/properties/[id]/page.tsx` | Import and render PropertyPhotosTab |
| `src/app/api/properties/[id]/hub/route.ts` | Handle `tab=photos` case |
| `src/lib/cache.ts` | Add `PROPERTY_PHOTOS` cache key |

## Non-Goals

- Photo upload or editing (read-only from Zuper)
- Zuper customer URL links (no property-level customer association in the UI)
- Equipment photos vs job photos distinction (all photos from all jobs at this address)
- Backfilling extended rollup columns for all properties (happens organically on next rollup computation via reconcile cron or webhook)
