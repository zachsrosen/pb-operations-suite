# Tesla PowerHub Integration — Design Spec

**Date:** 2026-05-06
**Author:** Claude + Zach
**Status:** Draft
**Teams:** Service, Design & Engineering, Admin

## Problem

Photon Brothers installs Tesla Powerwall + Solar Inverter systems across 5 Colorado and California locations. Post-installation, there is no visibility into system health, production, or alerts within the operations suite. Service teams discover problems only when customers call. Design teams cannot validate real-world production against their designs. PowerHub — Tesla's fleet monitoring platform — exposes all of this data via API, but it lives in a separate portal that most PB staff never check.

## Goal

Integrate Tesla PowerHub monitoring data into the PB Operations Suite so Service and Design teams can proactively monitor installed systems, catch alerts before customers report them, and validate production performance — all without leaving the suite.

## Scope

### Phase 1 (this spec)

- PowerHub API client with mTLS + JWT authentication
- Cron-based data sync: assets (6h), telemetry (15m), alerts (5m)
- Three-tier site-to-deal linkage (property match → address match → manual)
- Fleet monitoring dashboard (`/dashboards/powerhub`)
- Service Suite integration (priority queue scoring + customer 360 system health)
- Admin site linkage manager (`/dashboards/admin/powerhub`)
- Feature-flagged behind `POWERHUB_ENABLED`

### Phase 2 (future)

- Project detail panel with live power flow diagram and production charts
- Bulk Telemetry API ingestion (CSV pipeline for device-level signals)
- Production vs. design validation for Design team (compare actual kWh to Solar Designer estimates)
- Historical analytics and reporting

### Out of Scope

- Tesla API write operations (no remote commands, no settings changes)
- Non-Tesla monitoring (Enphase, SolarEdge, etc.)
- Customer-facing portal views of PowerHub data

## Prerequisites

Before this integration can go live:

1. **mTLS Certificate Setup**: Generate a CSR (`openssl req -sha256 -newkey rsa:2048 -keyout powerhub.key -out powerhub.csr -nodes`), send to Tesla at CertifiedInstaller@tesla.com, receive signed X.509 certificate back.
2. **IP Allowlisting**: Provide Vercel's egress IP range (or a proxy with static IP) to Tesla for their firewall allowlist.
3. **Instance ID**: Request PB's PowerHub Instance ID from Tesla account manager.

**Note on Vercel + mTLS**: Vercel serverless functions don't support mTLS natively (no client cert on outbound HTTPS). Options:
- **Option A (recommended)**: Proxy through a lightweight mTLS-capable service (e.g., a small Node.js service on Railway/Fly.io with static IP that terminates mTLS and forwards to our API routes).
- **Option B**: Use Vercel's Edge Functions with a custom `fetch` that includes cert/key (experimental, not well-supported).
- **Option C**: Self-host the cron workers on a VPS with static IP (simplest mTLS, but operational overhead).

We will finalize the proxy approach during implementation. The API client abstraction layer is designed so the proxy is transparent — the client calls the proxy URL instead of Tesla directly.

## Architecture

### Data Flow

```
Tesla PowerHub API (gridlogic-api.sn.tesla.services/v2)
        │
        │ mTLS + JWT (via proxy with static IP)
        ▼
┌─────────────────────────────┐
│  Cron Jobs (Vercel)         │
│  ├─ Asset Sync (6h)        │──── Upserts PowerhubSite
│  ├─ Telemetry Poll (15m)   │──── Upserts Snapshot + History
│  └─ Alert Poll (5m)        │──── Upserts PowerhubAlert
└─────────────────────────────┘
        │
        │ SSE invalidation (powerhub:telemetry, powerhub:alerts)
        ▼
┌─────────────────────────────┐
│  UI Surfaces                │
│  ├─ Fleet Dashboard         │  /dashboards/powerhub
│  ├─ Service Priority Queue  │  scoring boost from alerts
│  ├─ Customer 360            │  system health section
│  └─ Admin Linkage Manager   │  /dashboards/admin/powerhub
└─────────────────────────────┘
```

### Data Model

#### PowerhubSite

Represents a single Tesla site (one Gateway + its devices). Synced from `/asset/groups` and `/asset/sites/{id}`.

| Column | Type | Description |
|--------|------|-------------|
| id | String (cuid) | Internal PK |
| siteId | String (unique) | Tesla site UUID |
| siteName | String | Tesla site name (e.g., "STE20240105-00008") |
| instanceId | String | Tesla instance UUID |
| address | String | Street address |
| city | String | City |
| state | String | State |
| zip | String? | ZIP/postal code |
| addressHash | String? | SHA-256 of normalized address (for Property matching) |
| propertyId | String? | FK → HubSpotPropertyCache (tier 1 link). Relation: `property HubSpotPropertyCache? @relation(fields: [propertyId], references: [id])` |
| dealId | String? | Direct HubSpot deal ID (tier 2/3 link). Bare string — no Prisma `@relation` (HubSpot deal IDs live in HubSpot, not a Prisma-managed FK table). Lookups use `HubSpotProjectCache.dealId` for display but no referential constraint. |
| linkMethod | Enum | PROPERTY, ADDRESS_MATCH, MANUAL, UNLINKED |
| linkConfidence | Enum | HIGH, MEDIUM, LOW |
| devices | Json | Full device tree (gateways, batteries, inverters, meters) |
| totalBatteryEnergy | Int? | Nameplate battery energy (Wh) |
| totalBatteryPower | Int? | Nameplate battery power (W) |
| totalGateways | Int | Gateway count |
| totalBatteries | Int | Battery count |
| totalInverters | Int | Inverter count |
| status | Enum | ACTIVE, OFFLINE, ERROR |
| lastAssetSyncAt | DateTime | Last asset data refresh |
| lastTelemetryAt | DateTime? | Last telemetry poll |
| lastAlertCheckAt | DateTime? | Last alert check |
| createdAt | DateTime | Row creation |
| updatedAt | DateTime | Last update |

**Prisma back-relations on `PowerhubSite`**: `telemetrySnapshots PowerhubTelemetrySnapshot[]`, `telemetryHistory PowerhubTelemetryHistory[]`, `alerts PowerhubAlert[]`.

#### PowerhubTelemetrySnapshot

Latest telemetry values per site. One row per site, upserted every 15 minutes.

**FK convention for child tables**: All `siteId` columns in `PowerhubTelemetrySnapshot`, `PowerhubTelemetryHistory`, and `PowerhubAlert` store the Tesla site UUID (matching `PowerhubSite.siteId`). Prisma relations use `@relation(fields: [siteId], references: [siteId])` — referencing the unique `siteId` field, NOT the internal cuid `id`.

| Column | Type | Description |
|--------|------|-------------|
| id | String (cuid) | Internal PK |
| siteId | String | FK → PowerhubSite.siteId (Tesla UUID). Relation: `site PowerhubSite @relation(fields: [siteId], references: [siteId])` |
| timestamp | DateTime | Measurement time from Tesla |
| solarPowerW | Float? | Solar real power (W) |
| solarEnergyTodayWh | Float? | Solar energy produced today (Wh) |
| batteryPowerW | Float? | Battery real power (W, +discharge/-charge) |
| batterySocPercent | Float? | Battery state of energy (%) |
| batteryEnergyRemainingWh | Float? | Energy remaining (Wh) |
| gridPowerW | Float? | Grid real power (W, +import/-export) |
| gridEnergyImportedWh | Float? | Grid energy imported (Wh) |
| gridEnergyExportedWh | Float? | Grid energy exported (Wh) |
| loadPowerW | Float? | Load real power (W) |
| gridConnectedStatus | String? | "Grid Connected" or "Grid Disconnected" |
| batteryMode | String? | "Self-Powered", "Time Based Control", etc. |
| raw | Json? | Full signal dump for future use |
| updatedAt | DateTime | Last upsert |

Unique constraint: `(siteId)` — one snapshot row per site.

#### PowerhubTelemetryHistory

Time-series telemetry data. Designed to absorb both cron-polled data (Phase 1) and bulk CSV data (Phase 2).

| Column | Type | Description |
|--------|------|-------------|
| id | String (cuid) | Internal PK |
| siteId | String | FK → PowerhubSite.siteId (Tesla UUID). Relation: `site PowerhubSite @relation(fields: [siteId], references: [siteId])` |
| timestamp | DateTime | Measurement time |
| signalName | String | Tesla signal name (e.g., "solar_instant_power") |
| value | Float? | Numeric value |
| valueString | String? | String value (for status signals) |
| source | Enum | POLL, BULK |

Composite index: `(siteId, signalName, timestamp)` for efficient time-range queries.

**Retention policy**: POLL data retained for 90 days. BULK data retained indefinitely (Phase 2). A scheduled cleanup job prunes old POLL rows.

#### PowerhubAlert

Active and historical alerts per site.

| Column | Type | Description |
|--------|------|-------------|
| id | String (cuid) | Internal PK |
| siteId | String | FK → PowerhubSite.siteId (Tesla UUID). Relation: `site PowerhubSite @relation(fields: [siteId], references: [siteId])` |
| deviceId | String | Tesla device UUID (use `"site"` sentinel for site-level alerts without a specific device) |
| din | String? | Device Identification Number |
| alertName | String | Alert name (e.g., "Battery Fault") |
| description | String | Alert description with fix steps |
| severity | Enum | INFORMATIONAL, PERFORMANCE, CRITICAL |
| isActive | Boolean | Currently active |
| origin | String | "device" or "server_inferred" |
| reportedAt | DateTime | When Tesla reported the alert |
| resolvedAt | DateTime? | When the alert was resolved (null if active) |
| createdAt | DateTime | Row creation |
| updatedAt | DateTime | Last update |

Unique constraint: `(siteId, deviceId, alertName, reportedAt)` — prevents duplicate alert rows.

### API Client

**File**: `src/lib/tesla-powerhub.ts`

Singleton client following the established pattern (HubSpot, Zoho). Key design decisions:

**Authentication**:
```typescript
// Env vars
TESLA_POWERHUB_INSTANCE_ID   // Fleet instance UUID
TESLA_POWERHUB_USER_ID       // Email for token auth
TESLA_POWERHUB_PROXY_URL     // mTLS proxy base URL
POWERHUB_ENABLED             // Feature flag

// The proxy handles mTLS (cert + key). Our client sends:
// - Authorization: Bearer <JWT>
// - Standard HTTPS (no client cert needed from Vercel)
```

**Token management**: JWT cached in module-level variable. Auto-refreshed when expiry < 60 seconds. Token endpoint: `POST /asset/tokens` with `{ user_id, instance_id }`.

**Rate limiting**: Token bucket at 4 req/sec (conservative, under Tesla's 5 req/sec limit). Retry on 429 with exponential backoff (same pattern as `searchWithRetry` in `hubspot.ts`). Immediate failure on 401/403 (re-auth or cert issue).

**Error handling**:
- 429: exponential backoff, max 3 retries
- 401: clear cached JWT, re-authenticate, retry once
- 403: log + fail (IP not allowlisted or cert revoked)
- 5xx: exponential backoff, max 3 retries
- Network errors: exponential backoff

### API Routes

All under `/api/powerhub/`, gated by `POWERHUB_ENABLED` env var.

| Route | Method | Description | Auth |
|-------|--------|-------------|------|
| `/api/powerhub/sites` | GET | List all sites with linkage status | Session (Service, Design, Admin) |
| `/api/powerhub/sites/[siteId]` | GET | Site detail + snapshot + active alerts | Session |
| `/api/powerhub/sites/[siteId]/history` | GET | Telemetry history (query params: signals, start, end) | Session |
| `/api/powerhub/sites/[siteId]/alerts` | GET | Alert history for site | Session |
| `/api/powerhub/fleet` | GET | Aggregated fleet metrics from local cache | Session |
| `/api/powerhub/link` | POST | Manually link site to deal | Session (Admin only) |
| `/api/powerhub/unlink` | POST | Remove manual link | Session (Admin only) |
| `/api/powerhub/sync` | POST | Trigger manual re-sync | Session (Admin only) |

**Role access**: Add both `/api/powerhub` AND `/dashboards/powerhub` to `allowedRoutes` for every role that can see the fleet dashboard OR embedded System Health panel:
- ADMIN, OWNER, EXECUTIVE: already have wildcard access (`["*"]`) — no changes needed
- PROJECT_MANAGER, OPERATIONS_MANAGER: add `/api/powerhub`, `/dashboards/powerhub`
- SERVICE: add `/api/powerhub`, `/dashboards/powerhub`
- OPERATIONS: add `/api/powerhub` (needed for embedded System Health panel in Customer 360; OPERATIONS users have `/dashboards/service-customers` access and the panel calls `/api/powerhub/sites/[siteId]`)
- TECH_OPS: add `/api/powerhub`, `/dashboards/powerhub` (TECH_OPS has `/dashboards/service-customers` access, so needs `/api/powerhub` for both fleet dashboard AND Customer 360 System Health embed)
- DESIGN: add `/api/powerhub`, `/dashboards/powerhub` (for fleet dashboard only — DESIGN cannot access `/dashboards/service-customers`)

Admin linkage page (`/dashboards/admin/powerhub`) is covered by the existing `ADMIN_ONLY_ROUTES` prefix check on `/dashboards/admin/`.

### Cron Jobs

All gated by `POWERHUB_ENABLED`. All write to `ActivityLog` with appropriate `ActivityType` enums.

**Cron authentication**: Every cron handler validates `Authorization: Bearer ${CRON_SECRET}` in the request header — the same pattern used by `audit-digest`, `audit-retention`, and every other cron in this codebase. Vercel Cron sends this header automatically when `CRON_SECRET` is set.

**Schedule staggering**: Cron schedules are offset to avoid overlapping on the same rate-limit bucket:
- Asset sync: `0 0,6,12,18 * * *` (on the hour)
- Telemetry poll: `2,17,32,47 * * * *` (offset by 2 min)
- Alert poll: `4,9,14,19,24,29,34,39,44,49,54,59 * * * *` (offset by 4 min)

This prevents simultaneous API calls when the telemetry and alert polls would otherwise fire at the same cron boundary.

#### 1. Asset Sync (`/api/cron/powerhub-assets`)

**Schedule**: `0 0,6,12,18 * * *` (every 6 hours, on the hour)
**Rate budget**: ~1 + N API calls (N = number of sites)

```
GET /asset/groups → walk group tree, collect site_ids
For each site_id:
  GET /asset/sites/{site_id} → devices, nameplate specs
  Upsert PowerhubSite row
  Run three-tier linkage if UNLINKED:
    1. Compute addressHash → match HubSpotPropertyCache
    2. Normalize address → fuzzy match HubSpot deal property_address
    3. Leave as UNLINKED (surfaces in admin queue)
```

**Address normalization**: Strip unit/apt/suite/# suffixes, lowercase, trim whitespace, remove periods. Compare `street + city + state`. Exact match = HIGH confidence. Street + city only (no zip) = MEDIUM.

#### 2. Telemetry Poll (`/api/cron/powerhub-telemetry`)

**Schedule**: `2,17,32,47 * * * *` (every 15 minutes, offset by 2 min)
**Rate budget**: N API calls (one per ACTIVE site)

**Signals polled** (site-level, via `/telemetry/last`):
- `solar_instant_power` — current solar production (W)
- `solar_energy_exported` — solar energy produced (Wh)
- `battery_instant_power` — battery charge/discharge (W)
- `battery_state_of_energy` — battery SOC (%)
- `battery_expected_energy_remaining` — energy remaining (Wh)
- `site_instant_power` — grid power (W)
- `site_energy_imported` — grid import (Wh)
- `site_energy_exported` — grid export (Wh)
- `load_instant_real_power` — load consumption (W)
- `grid_connected_status` — on/off grid
- `command_real_mode` — battery operating mode

```
For each ACTIVE PowerhubSite:
  GET /telemetry/last?target_id={siteId}&signals={signal_list}
  Upsert PowerhubTelemetrySnapshot
  Insert PowerhubTelemetryHistory rows (source: POLL)
  Update PowerhubSite.lastTelemetryAt
Emit SSE event: powerhub:telemetry
```

**Batch throttling**: Process sites in chunks of 4 (matching rate limit), with 1-second pause between chunks.

#### 3. Alert Poll (`/api/cron/powerhub-alerts`)

**Schedule**: `4,9,14,19,24,29,34,39,44,49,54,59 * * * *` (every 5 minutes, offset by 4 min)
**Rate budget**: N API calls (one per ACTIVE site)

```
For each ACTIVE PowerhubSite:
  GET /alerts/last?target_id={siteId}&active_only=true&since_time={lastAlertCheckAt}
  For each alert in response:
    Upsert PowerhubAlert (match on siteId + deviceId + alertName + reportedAt)
  Mark alerts not in response as resolved (resolvedAt = now, isActive = false)
  Update PowerhubSite.lastAlertCheckAt
Emit SSE event: powerhub:alerts
```

**Priority queue cascade**: `powerhub:alerts*` invalidation triggers `service:priority-queue` recalculation with 500ms debounce (same pattern as `service-tickets*`).

### Service Priority Queue Integration

Modify `src/lib/service-priority.ts` to add a new scoring factor:

| Factor | Points | Condition |
|--------|--------|-----------|
| PowerHub Critical Alert | +25 | Deal linked to site with active CRITICAL alert |
| PowerHub Performance Alert | +10 | Deal linked to site with active PERFORMANCE alert |

**Lookup**: When scoring a service deal, check if deal has a linked `PowerhubSite` (via `dealId` or `propertyId` → `HubSpotPropertyCache` → `PropertyDealLink`). If so, query `PowerhubAlert` for active alerts on that site.

**Cache**: PowerHub alert counts per deal cached with same TTL as priority queue. Invalidated by `powerhub:alerts*` SSE events.

### UI Surfaces

#### A. Fleet Monitoring Dashboard

**Route**: `/dashboards/powerhub`
**Component**: `src/app/dashboards/powerhub/page.tsx`
**Shell**: `DashboardShell` with `accentColor="cyan"`

**Layout**:
```
┌─────────────────────────────────────────────────┐
│ Hero Row (4 StatCards)                          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐│
│ │Solar Prod│ │Fleet SOC │ │Sites     │ │Active││
│ │  XX kW   │ │  XX%     │ │ XX / YY  │ │Alerts││
│ └──────────┘ └──────────┘ └──────────┘ └──────┘│
├─────────────────────────────────────────────────┤
│ Filters: [Location ▼] [Status ▼] [Alerts ▼]   │
├─────────────────────────────────────────────────┤
│ Site Table                                      │
│ Site Name | Address | Location | Solar | SOC |  │
│ Grid | Alerts | Link Status                     │
│ ─────────────────────────────────────────────── │
│ STE2024... | 123 Main | DTC | 4.2kW | 85% |   │
│  ✓ On-grid | ⚠ 1 | ✓ Linked                   │
│ [expandable row → detail panel]                 │
└─────────────────────────────────────────────────┘
```

**Expanded row detail**: Telemetry snapshot values, device inventory list, active alerts with severity badges and descriptions.

**Data fetching**: React Query with `useSSE` hook listening to `powerhub:telemetry` and `powerhub:alerts` for real-time updates.

**Suite visibility**: Service Suite + Design & Engineering Suite. Add a dashboard card to both suite landing pages (`src/app/suites/service/page.tsx` and `src/app/suites/design-engineering/page.tsx`). Note: `suite-nav.ts` only controls the top-level suite switcher, not per-suite card listings.

#### B. Service Suite — Customer 360 System Health

**Location**: Embedded in existing customer 360 view (`/dashboards/service-customers`)

**Section**: "System Health" — renders only when the customer has a deal linked to a PowerHub site. Appears above the existing Deals/Tickets/Jobs sections.

**Layout**:
```
┌─────────────────────────────────────┐
│ ⚡ System Health — STE20240105-008  │
│ ┌────────┐ ┌────────┐ ┌──────────┐ │
│ │Solar   │ │Battery │ │Grid      │ │
│ │ 4.2 kW │ │ 85%    │ │Connected │ │
│ └────────┘ └────────┘ └──────────┘ │
│ ⚠ 1 active alert: Battery Meter    │
│   Comms (Performance)              │
└─────────────────────────────────────┘
```

**Data source**: `GET /api/powerhub/sites/[siteId]` — returns snapshot + active alerts.

#### D. Admin Site Linkage Manager

**Route**: `/dashboards/admin/powerhub`
**Shell**: `DashboardShell` with `accentColor="purple"` (matches admin palette)

**Layout**:
```
┌─────────────────────────────────────────────────┐
│ Sync Status Panel                               │
│ Assets: synced 2h ago ✓  Telemetry: 3m ago ✓   │
│ Alerts: 1m ago ✓         [Force Sync]           │
├─────────────────────────────────────────────────┤
│ Filters: [Link Status ▼] [Location ▼]          │
├─────────────────────────────────────────────────┤
│ Site Linkage Table                              │
│ Site Name | Address | Linked Deal | Method |    │
│ Confidence | Actions                            │
│ ─────────────────────────────────────────────── │
│ STE2024...| 123 Main | Deal #456 | AUTO | HIGH │
│ STE2024...| 789 Oak  | — UNLINKED — | [Link]   │
└─────────────────────────────────────────────────┘
```

**Link action**: Opens a deal search dialog (reuses existing deal search from `/api/deals/search`). On selection, POST `/api/powerhub/link` with `{ siteId, dealId }`.

### Feature Flags

| Flag | Type | Default | Controls |
|------|------|---------|----------|
| `POWERHUB_ENABLED` | Server env | `false` | All cron jobs, API routes, UI rendering |
| `NEXT_PUBLIC_POWERHUB_ENABLED` | Client env | `false` | Client-side UI surface rendering |

Both must be `true` for the feature to be visible. Server flag gates API routes and cron. Client flag gates React component rendering and suite nav entries.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POWERHUB_ENABLED` | Yes | Feature flag |
| `NEXT_PUBLIC_POWERHUB_ENABLED` | Yes | Client-side feature flag |
| `TESLA_POWERHUB_INSTANCE_ID` | Yes | Fleet instance UUID from Tesla |
| `TESLA_POWERHUB_USER_ID` | Yes | Email for token auth |
| `TESLA_POWERHUB_PROXY_URL` | Yes | mTLS proxy base URL |
| `TESLA_POWERHUB_CERT` | Proxy only | Base64-encoded client cert (on proxy server) |
| `TESLA_POWERHUB_KEY` | Proxy only | Base64-encoded private key (on proxy server) |

### New Files

```
src/lib/tesla-powerhub.ts              # API client (auth, rate limit, endpoints)
src/lib/powerhub-sync.ts               # Asset sync, telemetry poll, alert poll logic
src/lib/powerhub-linkage.ts            # Three-tier site-to-deal linkage
src/app/api/powerhub/sites/route.ts    # List sites
src/app/api/powerhub/sites/[siteId]/route.ts      # Site detail
src/app/api/powerhub/sites/[siteId]/history/route.ts  # Telemetry history
src/app/api/powerhub/sites/[siteId]/alerts/route.ts   # Alert history
src/app/api/powerhub/fleet/route.ts    # Fleet aggregates
src/app/api/powerhub/link/route.ts     # Manual link (admin)
src/app/api/powerhub/unlink/route.ts   # Remove link (admin)
src/app/api/powerhub/sync/route.ts     # Manual sync trigger (admin)
src/app/api/cron/powerhub-assets/route.ts    # Asset sync cron
src/app/api/cron/powerhub-telemetry/route.ts # Telemetry poll cron
src/app/api/cron/powerhub-alerts/route.ts    # Alert poll cron
src/app/dashboards/powerhub/page.tsx   # Fleet dashboard
src/app/dashboards/admin/powerhub/page.tsx  # Admin linkage manager
src/components/powerhub/FleetTable.tsx        # Site table with expand
src/components/powerhub/SiteDetail.tsx        # Expanded site detail
src/components/powerhub/SystemHealth.tsx      # Customer 360 embed
src/components/powerhub/LinkDialog.tsx        # Deal search + link modal
src/components/powerhub/SyncStatus.tsx        # Sync status panel
```

### Modified Files

```
prisma/schema.prisma                   # New models + enums + add `powerhubSites PowerhubSite[]` back-relation to existing HubSpotPropertyCache model
src/lib/service-priority.ts            # PowerHub alert scoring factors
src/app/suites/service/page.tsx         # Add PowerHub fleet dashboard card to Service suite landing page
src/app/suites/design-engineering/page.tsx  # Add PowerHub fleet dashboard card to D&E suite landing page
src/lib/roles.ts                       # Add /api/powerhub + /dashboards/powerhub routes
src/lib/query-keys.ts                  # Add powerhub query key factory + add `if (serverKey.startsWith("powerhub"))` branches to `cacheKeyToQueryKeys()`:
#                                         - "powerhub:telemetry" → returns [queryKeys.powerhub.root]
#                                         - "powerhub:alerts" → returns [queryKeys.powerhub.root, queryKeys.servicePriority.root]
#                                       The second entry is the cascade: alert changes trigger priority queue recalc (500ms debounce on client via React Query).
#                                       IMPORTANT: Insert the "powerhub:alerts" branch BEFORE "powerhub:telemetry" (more-specific first), and both BEFORE the final `return []`.
#                                       Note: existing function has ordering bugs (e.g., "deals:permit" eaten by "deals" branch) — don't repeat that pattern.
src/app/dashboards/service-customers/  # Embed SystemHealth component
# NOTE: src/app/api/stream/route.ts does NOT need modification — it's a pass-through for all appCache events.
# The cron handlers call `appCache.invalidate("powerhub:telemetry")` and `appCache.invalidate("powerhub:alerts")`
# directly, and the stream forwards them automatically to connected clients.
src/middleware.ts                       # Add three explicit paths to PUBLIC_API_ROUTES:
#                                         "/api/cron/powerhub-assets",
#                                         "/api/cron/powerhub-telemetry",
#                                         "/api/cron/powerhub-alerts",
#                                       (middleware uses exact prefix match — glob patterns won't work)
vercel.json                             # Add cron entries + function maxDuration overrides:
#                                         { "path": "/api/cron/powerhub-assets", "schedule": "0 0,6,12,18 * * *" }
#                                         { "path": "/api/cron/powerhub-telemetry", "schedule": "2,17,32,47 * * * *" }
#                                         { "path": "/api/cron/powerhub-alerts", "schedule": "4,9,14,19,24,29,34,39,44,49,54,59 * * * *" }
#                                       Function overrides: maxDuration: 300 for powerhub-assets (walks full site tree + linkage),
#                                         maxDuration: 120 for powerhub-telemetry and powerhub-alerts (must complete within their poll interval to avoid concurrent overlap — Vercel fires next cron regardless of prior run status)
```

### Testing Strategy

- **Unit tests**: API client (token refresh, rate limiting, error handling), linkage logic (address normalization, matching), priority queue scoring with PowerHub alerts
- **Integration tests**: Cron job flows with mocked Tesla API responses
- **Manual testing**: With `POWERHUB_ENABLED=false`, verify no UI surfaces render, no cron jobs execute, no API routes respond

### Rollout Plan

1. **Pre-deploy**: Complete mTLS certificate setup with Tesla. Deploy mTLS proxy with static IP. Verify API connectivity.
2. **Deploy code**: Ship with `POWERHUB_ENABLED=false`. Code is inert.
3. **Enable on staging**: Set flags to `true` on preview deployment. Run asset sync manually. Verify sites appear in admin linkage manager.
4. **Link sites**: Use admin tool to verify auto-links and manually link remaining sites.
5. **Enable on production**: Set flags to `true`. Cron jobs begin. Monitor for errors via Sentry.
6. **Announce**: Notify Service and Design teams. Add PowerHub dashboard card to their suites.

### Open Questions

1. **mTLS proxy hosting**: Railway vs. Fly.io vs. small VPS — needs cost/complexity evaluation during implementation.
2. **Fleet size**: How many Tesla sites does PB currently have in PowerHub? Affects initial sync time and rate budget. Will be discovered on first API call.
3. **Vercel cron limits**: Free tier has limited cron invocations. The 5-minute alert poll may need adjustment on the free plan. Verify against current Vercel plan.

### Phase 2 Additions (documented for future reference)

**C) Project Detail Panel**: Collapsible "System Monitoring" section on deal detail views. Live power flow diagram, 7-day production chart, device inventory. Blocked on: solid linkage coverage from Phase 1.

**Bulk Telemetry Ingestion**: Fourth cron job polls `/telemetry/bulk/site/signals` every 30 minutes. Downloads CSV files, parses rows (device_id, timestamp, signal_name, value), inserts into `PowerhubTelemetryHistory` with `source: BULK`. Enables device-level analytics (per-MPPT, per-battery). CSV data retained 21 days on Tesla's side — we store indefinitely.

**Production Validation**: Compare actual `solar_energy_exported` from PowerHub against Solar Designer estimated annual production. Surface discrepancies as a "Production Delta" metric on design dashboards. Jacob's original request.
