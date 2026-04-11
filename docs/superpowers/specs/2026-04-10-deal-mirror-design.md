# Deal Mirror — Local HubSpot Deal Replication

**Date:** 2026-04-10
**Status:** Draft
**Author:** Claude (with Zach)

## Overview

Replicate all HubSpot deals into a local Postgres table (`Deal`) so the suite reads from its own database instead of calling HubSpot on every request. This is the foundation for decoupling from HubSpot and reducing seat count.

### Goals

- **Read-only V1**: all dashboards read from local DB, not HubSpot API
- **All 5 pipelines**: Sales, Project, D&R, Service, Roofing
- **Hybrid sync**: periodic batch refresh + webhook-driven updates for key events
- **Zero-downtime migration**: feature-flag cutover, route by route
- **Future-ready**: schema supports write-back (not built in V1)

### Non-Goals (V1)

- Write-back from suite → HubSpot (deferred to V2)
- Role-scoped property editing (deferred to V2)
- Replacing HubSpot as source of truth (HubSpot wins on conflict)
- Live fallback to HubSpot API when local data is stale

### Staleness Policy

Serve stale local data with a visible "last synced X ago" indicator. Never fall back to live HubSpot calls. If sync is broken, users see stale data until it's fixed. This is intentional — true decoupling means finding and fixing sync issues, not silently papering over them.

### Conflict Resolution

HubSpot wins. Suite edits (V2) will push to HubSpot immediately; the next sync cycle pulls HubSpot's value back as canonical. During V1 (read-only), conflicts don't arise — all writes happen in HubSpot.

---

## Data Model

### `Deal` Table

The primary local replica. Columns organized by domain rather than mirroring HubSpot's flat property bag.

#### Identity

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (cuid) | Primary key |
| `hubspotDealId` | String (unique) | HubSpot object ID |
| `dealName` | String | |
| `pipeline` | Enum | SALES, PROJECT, DNR, SERVICE, ROOFING |
| `stage` | String | Resolved stage name |
| `stageId` | String | HubSpot stage ID (for future write-back) |
| `amount` | Decimal? | Deal value |

#### Location

| Column | Type | Notes |
|--------|------|-------|
| `pbLocation` | String? | DTC, WESTY, COSP, CA, CAMARILLO |
| `address` | String? | |
| `city` | String? | |
| `state` | String? | |
| `zipCode` | String? | |
| `ahj` | String? | Authority Having Jurisdiction |
| `utility` | String? | Utility company |

#### Team

| Column | Type | Notes |
|--------|------|-------|
| `hubspotOwnerId` | String? | HubSpot owner ID |
| `dealOwnerName` | String? | Resolved from Owners API |
| `projectManager` | String? | |
| `operationsManager` | String? | |
| `siteSurveyor` | String? | |
| `departmentLeads` | Json? | `{ design, permit_tech, ic_tech, rtb_lead }` |

#### Milestones (all DateTime?)

| Column | HubSpot Property |
|--------|-----------------|
| `closeDate` | `closedate` |
| `siteSurveyScheduleDate` | `site_survey_schedule_date` |
| `siteSurveyScheduledDate` | `site_survey_scheduled_date` |
| `siteSurveyCompletionDate` | `site_survey_date` |
| `dateReturnedFromDesigners` | `date_returned_from_designers` |
| `designStartDate` | `design_start_date` |
| `designDraftCompletionDate` | `design_draft_completion_date` |
| `designCompletionDate` | `design_completion_date` |
| `designApprovalSentDate` | `design_approval_sent_date` |
| `layoutApprovalDate` | `layout_approval_date` |
| `permitSubmitDate` | `permit_submit_date` |
| `permitIssueDate` | `permit_completion_date` |
| `icSubmitDate` | `interconnections_submit_date` |
| `icApprovalDate` | `interconnections_completion_date` |
| `rtbDate` | `ready_to_build_date` |
| `installScheduleDate` | `install_schedule_date` |
| `constructionCompleteDate` | `construction_complete_date` |
| `inspectionScheduleDate` | `inspections_schedule_date` |
| `inspectionPassDate` | `inspections_completion_date` |
| `inspectionFailDate` | `inspections_fail_date` |
| `inspectionBookedDate` | `inspection_booked_date` |
| `ptoStartDate` | `pto_start_date` |
| `ptoCompletionDate` | `pto_completion_date` |
| `forecastedInstallDate` | `forecasted_installation_date` |
| `forecastedInspectionDate` | `forecasted_inspection_date` |
| `forecastedPtoDate` | `forecasted_pto_date` |

#### Status Flags

| Column | Type | HubSpot Property |
|--------|------|-----------------|
| `isSiteSurveyScheduled` | Boolean | `is_site_survey_scheduled_` |
| `isSiteSurveyCompleted` | Boolean | `is_site_survey_completed_` |
| `isDaSent` | Boolean | `is_da_sent_` |
| `isLayoutApproved` | Boolean | `layout_approved` |
| `isDesignDrafted` | Boolean | `is_design_drafted_` |
| `isDesignCompleted` | Boolean | `is_design_completed_` |
| `isPermitSubmitted` | Boolean | `is_permit_submitted_` |
| `isPermitIssued` | Boolean | `permit_issued_` |
| `isIcSubmitted` | Boolean | `is_interconnection_submitted_` |
| `isIcApproved` | Boolean | `interconnection_approved_` |
| `isParticipateEnergy` | Boolean | Computed from `tags` containing "Participate Energy" |
| `isInspectionPassed` | Boolean | `is_inspection_passed_` |
| `hasInspectionFailed` | Boolean | `has_inspection_failed_` |
| `firstTimeInspectionPass` | Boolean | `first_time_inspection_pass_` |
| `hasInspectionFailedNotRejected` | Boolean | `has_inspection_failed__not_rejected__` |
| `firstTimeInspectionPassNotRejected` | Boolean | `first_time_inspection_pass____not_rejected_` |
| `readyForInspection` | String? | `ready_for_inspection_` (stored as string — HubSpot enumeration, not a true boolean) |
| `finalInspectionStatus` | String? | `final_inspection_status` |
| `inspectionFailCount` | Int? | `inspection_fail_count` |
| `inspectionFailureReason` | String? | `inspection_failure_reason` |
| `installStatus` | String? | `install_status` |
| `designStatus` | String? | `design_status` |
| `surveyStatus` | String? | `site_survey_status` |
| `permittingStatus` | String? | `permitting_status` |
| `layoutStatus` | String? | `layout_status` |
| `icStatus` | String? | `interconnection_status` |
| `ptoStatus` | String? | `pto_status` |

#### Equipment

| Column | Type | HubSpot Property |
|--------|------|-----------------|
| `systemSizeKwdc` | Decimal? | `calculated_system_size__kwdc_` |
| `systemSizeKwac` | Decimal? | `system_size_kwac` |
| `moduleBrand` | String? | `module_brand` |
| `moduleModel` | String? | `module_model` |
| `moduleCount` | Int? | `module_count` |
| `moduleWattage` | Int? | `module_wattage` |
| `moduleName` | String? | `modules` |
| `inverterBrand` | String? | `inverter_brand` |
| `inverterModel` | String? | `inverter_model` |
| `inverterQty` | Int? | `inverter_qty` |
| `inverterSizeKwac` | Decimal? | `inverter_size_kwac` |
| `inverterName` | String? | `inverter` |
| `batteryBrand` | String? | `battery_brand` |
| `batteryModel` | String? | `battery_model` |
| `batteryCount` | Int? | `battery_count` |
| `batterySizeKwh` | Decimal? | `battery_size` |
| `batteryName` | String? | `battery` |
| `batteryExpansionCount` | Int? | `battery_expansion_count` |
| `batteryExpansionName` | String? | `battery_expansion` |
| `batteryExpansionModel` | String? | `expansion_model` |
| `evCount` | Int? | `ev_count` |

#### QC Metrics (all Decimal?, stored in days — converted from HubSpot milliseconds)

| Column | HubSpot Property |
|--------|-----------------|
| `siteSurveyTurnaroundDays` | `site_survey_turnaround_time` |
| `designTurnaroundDays` | `design_turnaround_time` |
| `permitTurnaroundDays` | `permit_turnaround_time` |
| `icTurnaroundDays` | `interconnection_turnaround_time` |
| `constructionTurnaroundDays` | `construction_turnaround_time` |
| `projectTurnaroundDays` | `project_turnaround_time` |
| `daReadyToSentDays` | `time_between_da_ready_and_da_sent` |
| `daSentToApprovedDays` | `time_between_da_sent_and_da_approved` |
| `timeToSubmitPermitDays` | `time_to_submit_permit` |
| `timeToSubmitIcDays` | `time_to_submit_interconnection` |
| `daToRtbDays` | `da_to_rtb` |
| `rtbToConstructionDays` | `time_between_rtb___construction_schedule_date` |
| `ccToPtoDays` | `time_between_cc___pto` |
| `timeToCcDays` | `time_to_cc` |
| `timeToDaDays` | `time_to_da` |
| `timeToPtoDays` | `time_to_pto` |
| `timeToRtbDays` | `time_to_rtb` |
| `rtbToCcDays` | `time_from_rtb_to_cc` |
| `daToCcDays` | `da_to_cc` |
| `daToPermitDays` | `da_to_permit` |
| `inspectionTurnaroundDays` | `inspection_turnaround_time` |

#### Revisions

| Column | Type | HubSpot Property |
|--------|------|-----------------|
| `daRevisionCount` | Int? | `da_revision_counter` |
| `asBuiltRevisionCount` | Int? | `as_built_revision_counter` |
| `permitRevisionCount` | Int? | `permit_revision_counter` |
| `icRevisionCount` | Int? | `interconnection_revision_counter` |
| `totalRevisionCount` | Int? | `total_revision_count` |

#### External Links

| Column | Type | HubSpot Property |
|--------|------|-----------------|
| `designDocumentsUrl` | String? | `design_documents` |
| `designFolderUrl` | String? | `design_document_folder_id` |
| `allDocumentFolderUrl` | String? | `all_document_parent_folder_id` |
| `driveUrl` | String? | `g_drive` |
| `openSolarUrl` | String? | `link_to_opensolar` or `os_project_link` |
| `openSolarId` | String? | `os_project_id` |
| `zuperUid` | String? | `zuper_site_survey_uid` |
| `hubspotUrl` | String? | Computed: `https://app.hubspot.com/contacts/{portalId}/deal/{hubspotDealId}` |

#### Install Planning

| Column | Type | HubSpot Property |
|--------|------|-----------------|
| `expectedDaysForInstall` | Int? | `expected_days_for_install` |
| `daysForInstallers` | Int? | `days_for_installers` |
| `daysForElectricians` | Int? | `days_for_electricians` |
| `installCrew` | String? | `install_crew` |
| `installDifficulty` | String? | `install_difficulty` |
| `installNotes` | String? | `notes_for_install` |
| `expectedInstallerCount` | Int? | `expected_installer_cont` |
| `expectedElectricianCount` | Int? | `expected_electrician_count` |

#### Incentive Programs

| Column | Type | HubSpot Property |
|--------|------|-----------------|
| `n3ceEvStatus` | String? | `n3ce_ev_status` |
| `n3ceBatteryStatus` | String? | `n3ce_battery_status` |
| `sgipStatus` | String? | `sgip_incentive_status` |
| `pbsrStatus` | String? | `pbsr_incentive_status` |
| `cpaStatus` | String? | `cpa_status` |
| `participateEnergyStatus` | String? | `participate_energy_status` |

#### Misc

| Column | Type | HubSpot Property |
|--------|------|-----------------|
| `projectNumber` | String? | `project_number` |
| `projectType` | String? | `project_type` |
| `tags` | String? | `tags` |
| `discoReco` | String? | `disco__reco` |
| `interiorAccess` | String? | `interior_access` |
| `siteSurveyDocuments` | String? | `site_survey_documents` |
| `systemPerformanceReview` | String? | `system_performance_review` (HubSpot sends string; `deal-reader.ts` must coerce to boolean for `Project.systemPerformanceReview`) |
| `dateEnteredCurrentStage` | DateTime? | `hs_v2_date_entered_current_stage` |
| `createDate` | DateTime? | `hs_createdate` |

#### Associations

Contact and company data resolved during sync via HubSpot v4 associations API.

| Column | Type | Notes |
|--------|------|-------|
| `hubspotContactId` | String? | Primary contact association (used by BOM pipeline for Zoho customer match) |
| `customerName` | String? | Resolved from associated contact |
| `customerEmail` | String? | Resolved from associated contact |
| `customerPhone` | String? | Resolved from associated contact |
| `hubspotCompanyId` | String? | Primary company association |
| `companyName` | String? | Resolved from associated company |

**Sync behavior:** Contact/company associations are resolved during sync, but the approach differs by sync type:
- **Batch sync:** Collect all changed deal IDs, then use HubSpot batch association reads (`POST /crm/v4/associations/deals/contacts/batch/read` and `.../companies/...`) to resolve associations in bulk (100 per request). Then batch-read contact/company properties for the resolved IDs. This avoids per-deal API calls that would hit rate limits on initial backfill (~6,500 deals) or broad full syncs.
- **Webhook sync:** Single-deal association read is acceptable (one deal = one call). Use existing `fetchPrimaryContactId()` pattern.
- This avoids any live HubSpot calls at read time.

#### Sync Metadata

| Column | Type | Notes |
|--------|------|-------|
| `hubspotUpdatedAt` | DateTime? | `hs_lastmodifieddate` from HubSpot |
| `lastSyncedAt` | DateTime | When we last wrote this row |
| `syncSource` | Enum | BATCH, WEBHOOK, MANUAL |
| `rawProperties` | Json? | Full HubSpot response for debugging |

#### Standard

| Column | Type |
|--------|------|
| `createdAt` | DateTime |
| `updatedAt` | DateTime |

#### Indexes

- `hubspotDealId` — unique
- `pipeline, stage` — composite, for pipeline-filtered queries
- `pbLocation` — for location-filtered dashboards
- `lastSyncedAt` — for sync health monitoring
- `hubspotOwnerId` — for owner-based lookups

---

### `DealSyncLog` Table

Audit trail for every sync event.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (cuid) | PK |
| `dealId` | String? | FK → Deal (null for batch-level logs) |
| `hubspotDealId` | String? | For logging even if Deal row doesn't exist yet |
| `syncType` | Enum | BATCH_FULL, BATCH_INCREMENTAL, WEBHOOK, MANUAL |
| `source` | String | e.g. `"cron:10min"`, `"webhook:deal.propertyChange"` |
| `changesDetected` | Json? | `{ field: [oldVal, newVal] }` |
| `dealCount` | Int? | For batch-level logs: how many deals processed |
| `status` | Enum | SUCCESS, FAILED, SKIPPED |
| `errorMessage` | String? | |
| `durationMs` | Int? | |
| `createdAt` | DateTime | |

**Indexes:** `dealId, createdAt` (composite), `syncType, createdAt` (composite), `status, createdAt` (composite)

**Retention:** 30 days. Add `prisma.dealSyncLog.deleteMany()` to the existing `/api/cron/audit-retention/route.ts` job alongside the existing `activityLog`/`auditSession`/`auditAnomalyEvent` cleanup.

---

### `DealPipelineConfig` Table

Local copy of pipeline and stage definitions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (cuid) | PK |
| `pipeline` | Enum (unique) | SALES, PROJECT, DNR, SERVICE, ROOFING |
| `hubspotPipelineId` | String | |
| `stages` | Json | `[{ id, name, displayOrder, isActive }]` |
| `lastSyncedAt` | DateTime | |
| `updatedAt` | DateTime | |

Synced on startup and daily via the HubSpot Pipelines API (`GET /crm/v3/pipelines/deals`), which returns all 5 pipelines and their stages in a single call. Replaces hardcoded `DEAL_STAGE_MAP`, `SALES_STAGE_MAP`, `DNR_STAGE_MAP`, `SERVICE_STAGE_MAP`, and `ROOFING_STAGE_MAP` over time. Stage ID → name resolution during deal sync reads from this table instead of hardcoded maps.

---

### Pipeline Enum

```prisma
enum DealPipeline {
  SALES
  PROJECT
  DNR
  SERVICE
  ROOFING
}

enum DealSyncSource {
  BATCH
  WEBHOOK
  MANUAL
}

enum DealSyncType {
  BATCH_FULL
  BATCH_INCREMENTAL
  WEBHOOK
  MANUAL
}

enum DealSyncStatus {
  SUCCESS
  FAILED
  SKIPPED
}
```

---

## Sync Engine

Three sync mechanisms working together.

### Batch Sync (Cron)

Runs every 10 minutes via `GET /api/cron/deal-sync` (Vercel cron). Route must export `maxDuration = 300` (5 min) since the default 60s timeout in `vercel.json` is insufficient for a full multi-pipeline sync. Add the cron entry to `vercel.json`: `{ "path": "/api/cron/deal-sync", "schedule": "*/10 * * * *" }`.

**Flow:**

1. **Fetch deal IDs per pipeline** — uses HubSpot search API with minimal properties. Active deals every 10 min; all deals every 6 hours. **Sales pipeline special case:** HubSpot search rejects `pipeline = default` as a filter value. The Sales pipeline must be queried by its stage IDs (batch search per stage), matching the existing pattern in `/api/deals/route.ts`.
2. **Batch-read properties** — 100 deals per batch, 3 concurrent. Same two-phase pattern as existing `fetchAllProjects()`.
3. **Diff against local DB** — compare `hubspotUpdatedAt` (hs_lastmodifieddate). Skip unchanged deals.
4. **Upsert changed deals** — map HubSpot properties → Deal columns via property mapper. Write `DealSyncLog` with change diff.
5. **Detect deletions** (full sync only, not incremental) — deals in DB but not in HubSpot response → soft-mark with `stage: "DELETED"`. Incremental syncs only contain recently modified deals, so deletion detection is skipped to avoid false positives.
6. **Invalidate connected clients** — the current SSE stream is backed by in-process `appCache.subscribe()`, which means a cron or webhook invocation on one Vercel serverless instance cannot directly notify SSE clients connected to a different instance. Two-pronged approach:
   - **Short-term (V1):** Rely on React Query's `staleTime` / `refetchInterval` for eventual UI refresh. SSE invalidation is best-effort for same-instance hits only. **Implementation requirement:** Before flipping any route to `local` mode, audit and standardize polling on every consumer of that route's data. Current state varies widely — `useProjectData` and `useProgressiveDeals` poll at 5 min, some pages at 15 min, and `/dashboards/deals` uses manual fetch + SSE with no polling fallback at all. Each migrated read path must have a `refetchInterval` (recommended: 60s for high-activity dashboards like deals/scheduler/executive, 5 min for lower-traffic pages). The realistic V1 freshness bound is **1–5 minutes depending on the page**, not 30–60s. The staleness indicator thresholds (Section: Staleness Indicator) already accommodate this.
   - **Future enhancement:** Add a shared broadcast channel (e.g., Neon `pg_notify`, Redis pub/sub, or Vercel KV polling) so the sync engine can reliably notify all SSE-connected instances. This is not blocking for V1 since the data is already fresh in Postgres.
   - Emit both legacy keys (`"projects:"`, `"deals:"`) and new keys (`"deals:sync:{pipeline}"`) during migration so existing `useSSE` hooks continue to work for same-instance invalidations.

**Incremental optimization:** After first full sync, use a high-watermark cursor to fetch only recently changed deals. The watermark is the maximum `hs_lastmodifieddate` observed in the previous sync run (stored in `DealSyncLog` or a dedicated `SystemConfig` key per pipeline), **not** the local `lastSyncedAt` timestamp. Apply a 2-minute overlap window (`watermark - 2min`) to catch changes that landed during the previous sync but have an older HubSpot timestamp. Fall back to full sync every 6 hours as a consistency check.

**Performance estimate:** ~3,500 active deals across 5 pipelines. At 100/batch with 3 concurrent, that's ~12 batch calls. With timestamp diff, most cycles only upsert a handful of changed deals.

**Owner resolution:** HubSpot owner IDs resolved to names via Owners API. Reuse existing circuit-breaker logic (20-min blackout on 403). Owner names cached separately — only re-resolved when `hubspotOwnerId` changes.

### Webhook Sync (Real-Time)

Extends existing webhook infrastructure at `/api/webhooks/hubspot/`.

**New subscriptions:**

| Event | Trigger |
|-------|---------|
| `deal.propertyChange` | Stage, amount, close date, install dates change |
| `deal.creation` | New deal in any pipeline |
| `deal.deletion` | Soft-delete local record |
| `deal.merge` | Update hubspotDealId, merge properties |

**Handler flow:**

1. Validate HubSpot signature (existing `validateHubSpotWebhook()`)
2. Idempotency check via HubSpot `eventId` + existing `IdempotencyKey` table
3. Extract `objectId` + event type from payload
4. **Branch by event type:**
   - **`deal.deletion`**: Mark local row `stage: "DELETED"` using `objectId` alone — do NOT fetch the deal (it may no longer exist). Write `DealSyncLog`.
   - **`deal.merge`**: The payload includes `mergedObjectIds`. Mark merged deals as `stage: "MERGED"`, then fetch the surviving deal and upsert it.
   - **`deal.creation` / `deal.propertyChange`**: Fetch full deal from HubSpot (single batch-read of 1 deal). Resolve associations (single-deal read is acceptable). Upsert `Deal` row + write `DealSyncLog` with change diff.
5. Best-effort SSE invalidation for same-instance clients (see batch sync step 6)

**Why not webhook-only?** HubSpot webhooks are eventually consistent and can miss events under load. Batch sync is the safety net that guarantees convergence.

### Manual Sync (On-Demand)

Admin-triggered refresh via API:

- `POST /api/admin/deal-sync` — trigger full or per-pipeline sync (pipeline in request body)
- `POST /api/admin/deal-sync/[dealId]` — refresh single deal (`src/app/api/admin/deal-sync/[dealId]/route.ts`)
- Writes `DealSyncLog` with `syncType: MANUAL`

### Property Mapper

Central mapping module — single source of truth for HubSpot property → Deal column.

```typescript
// src/lib/deal-property-map.ts
type PropertyMapping = {
  column: string;
  type: 'string' | 'decimal' | 'int' | 'boolean' | 'datetime' | 'json';
  transform?: (value: string | null) => unknown;
};

const dealPropertyMap: Record<string, PropertyMapping> = {
  dealname:            { column: 'dealName',    type: 'string' },
  amount:              { column: 'amount',      type: 'decimal' },
  dealstage:           { column: 'stageId',     type: 'string' },
  // stageId → stage name resolved via DealPipelineConfig
  closedate:           { column: 'closeDate',   type: 'datetime' },
  site_survey_turnaround_time: {
    column: 'siteSurveyTurnaroundDays',
    type: 'decimal',
    transform: msToDays,
  },
  // ... all 88 properties
};
```

This map drives:
- Batch sync upserts
- Webhook single-deal updates
- Change diff detection (old vs new values)
- Future write-back (reverse mapping, V2)

---

## API Cutover Strategy

### Feature Flag

`SystemConfig` row (existing table) controls data source per route:

| Key | Values | Behavior |
|-----|--------|----------|
| `deal-sync:source:{route}` | `hubspot` | Current behavior — hits HubSpot API (default) |
| | `local-with-verify` | Reads local DB; also fetches HubSpot in background and logs discrepancies |
| | `local` | Reads local DB only (final state) |

### Cutover Phases

**Phase 1: Sync engine running, all routes on `hubspot`**
- Deploy sync engine (cron + webhooks)
- Validate sync accuracy via `DealSyncLog`
- Monitor: are we catching all changes? How fast?

**Phase 2: Shadow mode — high-traffic routes on `local-with-verify`**
- `/api/projects` (serves 90+ dashboards)
- `/api/deals` (multi-pipeline)
- Log discrepancies for 1–2 weeks
- Fix any mapper bugs or missing properties

**Phase 3: Flip to `local`**
- Route by route, starting with least critical
- Monitor staleness indicators and user reports

**Phase 4: Remove HubSpot API calls from read paths**
- `fetchAllProjects()` only used by sync engine
- In-memory `appCache` retired for deal data
- HubSpot API usage drops to sync engine + webhook handlers only
- Deprecate `HubSpotProjectCache` model — the `Deal` table supersedes it entirely. Remove after all consumers are migrated. During Phase 2–3, both tables coexist.

### Route Changes

Minimal changes to API routes themselves. The swap is in the data-fetching layer:

```
Before:  /api/projects → appCache.getOrFetch() → fetchAllProjects() → HubSpot API
After:   /api/projects → prisma.deal.findMany() → local DB
```

The codebase has three downstream data shapes that API routes return:
- `Project` (from `hubspot.ts`) — full shape used by `/api/projects`, ~80 fields
- `TransformedProject` (from `types.ts`) — dashboard-ready shape after `transformProject()`
- `Deal` type (from `types.ts`) — used by `/api/deals` for sales/service/DNR dashboards

The `deal-reader.ts` module provides mappers for all three: `dealToProject()`, `dealToTransformedProject()`, and `dealToDeal()`. **Nothing downstream of the API routes changes in V1.** Dashboards, React Query keys, SSE invalidation — all unchanged.

### Staleness Indicator

Every API response includes sync metadata:

```json
{
  "data": [...],
  "sync": {
    "source": "local",
    "lastSyncedAt": "2026-04-10T14:30:00Z",
    "staleness": "2m",
    "syncHealth": "healthy"
  }
}
```

`DashboardShell` renders a staleness indicator based on **sync engine** freshness (how recently the DB was updated from HubSpot), not client polling latency:

| Staleness | Display |
|-----------|---------|
| < 15 min | Green dot, no text |
| 15–30 min | Yellow dot, "Synced 18m ago" |
| > 30 min | Red dot, "Data may be stale — last synced 45m ago" |

Note: total end-to-end latency = sync engine staleness + client polling interval. With a 10-min sync cycle and 1–5 min polling, worst case is ~15 min for a change in HubSpot to appear on-screen. The indicator only surfaces the sync engine side — if the cron is healthy (green dot), any remaining delay is the client's polling interval, which is an acceptable UX tradeoff for V1.

---

## Sync Health & Monitoring

### Health Endpoint

`GET /api/admin/deal-sync/health`

Returns per-pipeline sync status:

```json
{
  "status": "healthy | degraded | down",
  "pipelines": {
    "PROJECT": {
      "dealCount": 712,
      "lastBatchSync": "2026-04-10T14:30:00Z",
      "lastWebhookEvent": "2026-04-10T14:28:12Z",
      "avgSyncLatencyMs": 4200,
      "failedSyncsLast24h": 0
    }
  },
  "recentErrors": [],
  "nextScheduledSync": "2026-04-10T14:40:00Z"
}
```

**Status thresholds:**
- **healthy** — all pipelines synced within 15 min, no errors in last hour
- **degraded** — any pipeline > 30 min stale, or > 3 failed syncs in last hour
- **down** — any pipeline > 60 min stale, or batch sync hasn't completed in 2+ cycles

### Activity Logging

Integrates with existing `ActivityLog` system. New activity types:

- `DEAL_SYNC_BATCH_COMPLETE` — batch finished, deal count + duration
- `DEAL_SYNC_WEBHOOK_RECEIVED` — webhook processed, deal ID + changed fields
- `DEAL_SYNC_ERROR` — sync failure with error details
- `DEAL_SYNC_DISCREPANCY` — shadow-mode mismatch (during `local-with-verify`)

### Admin Dashboard Widget

Card on existing admin dashboard:
- Sync status indicator (green/yellow/red)
- Deal counts by pipeline
- Last sync time per pipeline
- Recent errors
- "Sync Now" button

### Alerting

Sync errors logged as `DEAL_SYNC_ERROR` with HIGH severity → caught by existing Sentry integration. No new alerting infrastructure needed.

---

## Key Files (Implementation Reference)

| Area | Existing Files | New Files |
|------|---------------|-----------|
| Schema | `prisma/schema.prisma` | (add Deal, DealSyncLog, DealPipelineConfig models) |
| Property mapper | `src/lib/hubspot.ts` (DEAL_PROPERTIES) | `src/lib/deal-property-map.ts` |
| Sync engine | — | `src/lib/deal-sync.ts` |
| Batch cron | `src/app/api/cron/` | `src/app/api/cron/deal-sync/route.ts` |
| Webhook handler | `src/app/api/webhooks/hubspot/` | `src/app/api/webhooks/hubspot/deal-sync/route.ts` |
| Admin endpoints | `src/app/api/admin/` | `src/app/api/admin/deal-sync/route.ts` |
| Health endpoint | — | `src/app/api/admin/deal-sync/health/route.ts` |
| DB reader | — | `src/lib/deal-reader.ts` (Deal → Project, TransformedProject, Deal type) |
| Feature flag | `src/lib/db.ts` (SystemConfig) | (reuse existing) |
| API routes | `src/app/api/projects/route.ts`, `src/app/api/deals/route.ts` | (modify to read from local DB) |
| Dashboard shell | `src/components/DashboardShell.tsx` | (add staleness indicator) |
| Admin widget | — | Component in admin dashboard |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Neon DB storage growth | ~3,500 deals × 90 columns = modest. ~6,500 total with closed. | Monitor row count. DealSyncLog has 30-day retention. |
| HubSpot webhook delivery gaps | Stale data for specific deals | Batch sync every 10 min as safety net |
| Property mapper drift | New HubSpot properties not captured | Property map is declarative — easy to add. Sync engine logs unmapped properties. |
| Migration downtime | Users see stale data during cutover | Feature flag allows instant rollback to `hubspot` mode |
| Vercel cron cold start | Sync job delayed or times out | Split batch across multiple cron invocations if needed. Vercel Pro allows up to 5 min execution. |
| Owner API circuit breaker | Deal owner names show as IDs | Existing 20-min blackout logic. Owner names cached — only re-resolved on change. |
| Rate limits during full sync | HubSpot 429 errors during 6-hour full sync (~6,500 deals = ~130 API calls) | Reuse existing `searchWithRetry()` exponential backoff. Per-pipeline timing logs to catch issues early. |
| rawProperties storage growth | ~6,500 deals × full JSON = significant | Store raw JSON only during `local-with-verify` phase or on webhook-triggered updates. Add config flag to disable after stabilization. |
| HubSpot webhook routing | New subscriptions may conflict with existing webhook target URL | Verify HubSpot app webhook configuration. May need a unified dispatcher route or separate app registration. |
