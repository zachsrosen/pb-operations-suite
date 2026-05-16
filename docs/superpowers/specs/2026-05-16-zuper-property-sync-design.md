# Zuper Property Sync (Write Direction)

**Date**: 2026-05-16
**Status**: Draft
**Author**: Claude (brainstormed with Zach)

## Problem

Field technicians using the Zuper mobile app have no property context when arriving at a job site. The read direction already works (Property Hub Jobs tab shows ZuperJobCache data), but nothing pushes property-level data from `HubSpotPropertyCache` into Zuper. Techs currently rely on the job title containing an address string and must call the office for system details, battery info, or service history.

Zuper has a native Property module (`/api/property`) that supports custom fields, job linking, and shows on the mobile app. Populating it gives field techs instant access to equipment summary, install dates, AHJ/utility info, and physical property details without leaving Zuper.

### Scope

- **~1,998 properties** currently have linked Zuper jobs (via `PropertyDealLink` + `ZuperJobCache`)
- This number grows as new deals get Zuper jobs created
- Distinct from the separate product-level Zuper custom fields project (module wattage, inverter specs on individual jobs)

## API Spike Findings

Validated via live API testing on 2026-05-16:

| Operation | Method | Endpoint | Body Format |
|-----------|--------|----------|-------------|
| Create property | POST | `/api/property` | `{ property: { property_name, property_address, custom_fields[] } }` |
| Update property | PUT | `/api/property/{uid}` | `{ property: { custom_fields[] } }` |
| Read property | GET | `/api/property/{uid}` | -- |
| Link job to property | PUT | `/api/jobs` | `{ job: { job_uid, property: "uid_string" } }` |

### Critical Behaviors

1. **`custom_fields` is clobber-on-write**: Sending a partial array wipes omitted fields. Must always read existing fields, merge, and send the full array. Use the `mergeZuperMetaData()` pattern from `zuper-catalog.ts`.
2. **Job property link uses plain string UID**: `"property": "uid_string"`, not `{ property_uid: "..." }`. The object format causes a 504 timeout.
3. **Job updates use `PUT /jobs`** (not `/jobs/{uid}`): The UID goes inside the body as `job.job_uid`.
4. **`no_of_jobs` auto-increments** on the property when jobs are linked.

### Test Properties Created

- `a0a48f90-50e8-11f1-be8e-ddba08e65365` -- 21 Friendship Ln, Colorado Springs (4 jobs, 10 custom fields)
- `893f7fa0-50ec-11f1-a56a-055a83f12b0e` -- 237 Jeffrey Dr, San Luis Obispo (1 job, 10 custom fields)

## Design

### Overview

Three components:

1. **`src/lib/zuper-property-sync.ts`** -- Core sync logic. Maps `HubSpotPropertyCache` fields to Zuper Property custom fields, creates or updates Zuper Property records, links jobs.
2. **`/api/cron/zuper-property-sync` route** -- Cron job (every 15 min). Picks up properties where cache data changed since last sync. Feature-flagged on `ZUPER_PROPERTY_SYNC_ENABLED`.
3. **`scripts/backfill-zuper-properties.ts`** -- One-time script. Creates Zuper Property objects for all 1,998 properties that have linked Zuper jobs, sets custom fields, links existing jobs.

### Data Flow

```
HubSpotPropertyCache (updated by webhooks, reconcile cron, Shovels enrichment)
  |
  v
Dirty detection: updatedAt > zuperPropertySyncedAt (or zuperPropertyUid is null)
  |
  v
Cron picks up batch of dirty properties
  |
  +-- For each property:
  |     1. Read HubSpotPropertyCache (address, rollups, dates, geo links, Shovels data)
  |     2. If zuperPropertyUid is null:
  |     |     POST /api/property -> create Zuper Property with address + custom_fields
  |     |     Store zuperPropertyUid on HubSpotPropertyCache
  |     3. If zuperPropertyUid exists:
  |           GET /api/property/{uid} -> read existing custom_fields
  |           Merge with new values (mergeZuperMetaData pattern)
  |           PUT /api/property/{uid} -> update
  |     4. Update zuperPropertySyncedAt timestamp
  |
  v
Job linking (backfill only):
  Find ZuperJobCache records linked via PropertyDealLink
  For each job where property field is null:
    PUT /api/jobs { job: { job_uid, property: "zuper_property_uid" } }
```

### Custom Field Mapping

10 fields across 4 categories. All stored as strings in Zuper's `custom_fields` array.

**Equipment Summary:**

| Label | Source | Format |
|-------|--------|--------|
| System Size (kW) | `systemSizeKwDc` | Decimal or "N/A" if null |
| Has Battery | `hasBattery` | "Yes" / "No" |
| Has EV Charger | `hasEvCharger` | "Yes" / "No" |

**Install / Service Dates:**

| Label | Source | Format |
|-------|--------|--------|
| Install Date | `firstInstallDate` | "YYYY-MM-DD" or "" |

**Property Details (Shovels-enriched):**

| Label | Source | Format |
|-------|--------|--------|
| Year Built | `yearBuilt` | Integer string or "" |
| Square Footage | `squareFootage` | Integer string or "" |
| Stories | `stories` | Integer string or "" |

**Owner / Location Context:**

| Label | Source | Format |
|-------|--------|--------|
| PB Location | `pbLocation` | Shop name or "" |
| AHJ | `ahjName` | Authority Having Jurisdiction or "" |
| Utility | `utilityName` | Utility company name or "" |

**Field coverage for the 1,998 Zuper-linked properties (verified 2026-05-16 after backfill + Zuper address fallback):**

| Field | Coverage | Notes |
|-------|----------|-------|
| Address | 99.8% (1,994/1,998) | From HubSpot geocode |
| AHJ + Utility | 100% (1,998/1,998) | From HubSpot geocode |
| hasBattery / hasEvCharger | 100% | Boolean rollups (default false) |
| firstInstallDate | 63.8% (1,275/1,998) | From deal stage dates |
| pbLocation | 72.3% (1,444/1,998) | From deal/contact |
| systemSizeKwDc | 17.3% (345/1,998) | Line item rollup -- low, improves over time |
| yearBuilt / sqft / stories | 6.7% (134/1,998) | Shovels enrichment in progress |

**Note**: 46 Zuper deals (2.0%) have no PropertyDealLink because they lack all address sources (no contact, no deal address, no Zuper job address). These deals cannot be linked to properties and will be skipped by the sync. Deal link coverage: 98.0% (2,200/2,246). Rollup accuracy: 100%.

Fields with null values sync as empty string `""` to Zuper. As Shovels enrichment and deal rollups fill in data, the next cron cycle pushes the updates automatically.

### Dirty Detection

Compare `HubSpotPropertyCache.updatedAt` > `zuperPropertySyncedAt`. Any cache update (from webhooks, reconcile cron, Shovels enrichment, manual edits) automatically marks the property dirty for the next sync cycle. This is zero-config -- no event bus or trigger registration needed.

### DB Schema Changes

Three new nullable columns on `HubSpotPropertyCache`:

```prisma
model HubSpotPropertyCache {
  // ... existing fields ...
  
  zuperPropertyUid      String?    // Zuper Property UID once created
  zuperPropertySyncedAt DateTime?  // Last successful sync to Zuper
  zuperSyncFailCount    Int        @default(0) // Consecutive sync failures; skip at >= 5
}
```

Migration is additive-only (no data loss, no column drops). Index on `zuperPropertyUid` for reverse lookups.

### Cron Route

`/api/cron/zuper-property-sync` -- runs every 15 minutes.

- **Auth**: `CRON_SECRET` bearer token (same as other cron routes)
- **Feature flag**: `ZUPER_PROPERTY_SYNC_ENABLED` must be `"true"`
- **Batch size**: 20 properties per run (Zuper API is slower than HubSpot -- each property requires 1-2 API calls for create/update)
- **Time budget**: 250s of the 300s `maxDuration` (same pattern as shovels-enrich)
- **Error handling**: Per-property try/catch. Failures don't block other properties. Errors increment `zuperSyncFailCount` on the property cache row. Properties with `zuperSyncFailCount >= 5` are skipped by the cron query (poison-row protection). The counter resets to 0 on the next successful sync. Operators can manually reset via a DB update if needed.
- **Response**: JSON with `{ status, processed, created, updated, errors, elapsed }`

### Backfill Script

`scripts/backfill-zuper-properties.ts` -- run manually via `source .env && npx tsx scripts/backfill-zuper-properties.ts`.

**Three phases:**

1. **Create Zuper Properties**: For each `HubSpotPropertyCache` that has `PropertyDealLink` rows pointing to deals with `ZuperJobCache` entries, and where `zuperPropertyUid` is null: POST to create Zuper Property with address + custom fields. Store the returned UID.

2. **Link Jobs**: For each newly created Zuper Property, find all `ZuperJobCache` records linked via `PropertyDealLink`. PUT `/api/jobs` to set the property field on each job.

3. **Progress tracking**: Log progress to stdout. Resumable -- checks `zuperPropertyUid` before creating, so re-running skips already-synced properties.

**Flags:**
- `--dry-run`: Log what would be created/linked without hitting Zuper API. Validates field mapping and query logic.
- `--limit N`: Process only N properties (for testing).

**Rate limiting**: 200ms delay between Zuper API calls. Estimated runtime for 1,998 properties + ~3,400 jobs: ~20-25 minutes.

### Job Linking

**At job creation time**: When a new Zuper job is created for a deal that has a property with `zuperPropertyUid` set, include the `property` field in the job creation payload. Modify the Zuper job creation calls (in `zuper.ts` `createJob()` callers or the scheduling confirm route) to:
1. Look up the deal's property via `PropertyDealLink`
2. If the property has `zuperPropertyUid`, pass `property: zuperPropertyUid` in the job payload

**Cron reconciliation**: The cron also checks for unlinked jobs on each synced property. After creating/updating the Zuper Property, query `ZuperJobCache` for jobs linked via `PropertyDealLink` whose `rawData` does not contain a `property` field (or it's null). Link them via `PUT /api/jobs`. This catches jobs created between backfill and cron cycles, or jobs for deals that were associated to a property after creation. Cap at 10 job links per cron run to stay within the time budget.

### Feature Flag

`ZUPER_PROPERTY_SYNC_ENABLED` (server-side only):
- `"true"`: cron runs, backfill script runs, new job creation includes property link
- Not set / `"false"`: cron returns `{ status: "disabled" }`, backfill script exits, job creation unchanged

No UI flag needed -- this feature has no user-facing UI changes. The data appears in the Zuper mobile app automatically once properties are synced.

### Middleware / Route Access

The new cron route `/api/cron/zuper-property-sync` must be added to the `PUBLIC_ROUTES` array in `src/middleware.ts` (the same list that includes other `/api/cron/*` paths). Cron routes are authenticated by `CRON_SECRET` bearer token inside the handler, not by session middleware. No role allowlist change needed.

## Files

| File | Change |
|------|--------|
| `src/lib/zuper-property-sync.ts` | **NEW** -- core sync logic (map fields, create/update Zuper Property, merge custom fields) |
| `src/app/api/cron/zuper-property-sync/route.ts` | **NEW** -- cron endpoint |
| `scripts/backfill-zuper-properties.ts` | **NEW** -- one-time backfill script |
| `prisma/schema.prisma` | Add `zuperPropertyUid` and `zuperPropertySyncedAt` to `HubSpotPropertyCache` |
| `prisma/migrations/YYYYMMDD_add_zuper_property_sync/` | **NEW** -- additive migration |
| `vercel.json` | Add cron `{ "path": "/api/cron/zuper-property-sync", "schedule": "*/15 * * * *" }` + function `"src/app/api/cron/zuper-property-sync/route.ts": { "maxDuration": 300 }` |
| `src/lib/zuper.ts` | Modify `createJob()` or callers to include property UID when available |
| `src/middleware.ts` | Add `/api/cron/zuper-property-sync` to `PUBLIC_ROUTES` |

## Verification

1. **Test properties**: Verify the two test properties created during the spike (`21 Friendship Ln`, `237 Jeffrey Dr`) show correct data in the Zuper web app and mobile app.
2. **Backfill dry-run**: Run backfill script with a `--dry-run` flag against 10 properties, verify the payloads look correct without hitting Zuper API.
3. **Backfill execution**: Run full backfill, verify all ~1,998 properties created in Zuper with correct custom fields and job links.
4. **Cron cycle**: Update a property in HubSpot (trigger webhook or reconcile), wait for cron, verify Zuper property updated.
5. **New job creation**: Schedule a job for a property with `zuperPropertyUid`, verify the job is auto-linked.
6. **Custom field merge**: Update one field on a synced property, verify other fields preserved (not clobbered).
7. **Build**: `npm run build` passes with no type errors.

## Out of Scope

- **Product-level Zuper custom fields** (module wattage, inverter specs on individual jobs) -- separate followup project
- **Zuper-to-HubSpot sync** (write back from Zuper to Property cache) -- not needed, HubSpot is source of truth
- **Zuper Property UI in PB Ops Suite** -- the Zuper mobile app is the consumer; no new PB Ops dashboard needed
- **Custom field creation in Zuper admin** -- labels are created dynamically by the API when first used (validated in spike)
- **Dedup against manually-created Zuper Properties** -- if a tech manually creates a Zuper Property before the sync runs, a duplicate will be created. The sync uses `zuperPropertyUid` presence as the only guard. Manual dedup can be done in Zuper admin if needed. A future enhancement could search Zuper by address before creating, but the API doesn't offer address-based search so this would require listing all properties -- not worth the complexity for the expected low collision rate.
