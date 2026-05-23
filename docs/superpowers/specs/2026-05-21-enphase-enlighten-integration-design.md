# Enphase Enlighten API Integration

**Date:** 2026-05-21
**Status:** Draft
**Author:** Claude + Zach

## Summary

Add Enphase Enlighten monitoring API integration at full parity with the existing Tesla PowerHub integration. Covers: API client, Prisma models, site-to-Property address matching, HubSpot/Zuper crosslink propagation, HubSpot UI Extension card, Property Drawer UI, cron-driven sync, and one-time OAuth setup flow.

## Motivation

PB installs both Tesla and Enphase systems. The PowerHub integration already surfaces Tesla device serials, telemetry, portal links, and alerts across HubSpot, Zuper, and the PB Tech Ops UI. Enphase systems have no equivalent — service techs manually check Enlighten for production data, battery state, and micro health. This integration closes that gap.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Mirror PowerHub, separate modules | Two APIs are different enough (OAuth auth-code vs client_credentials, microinverters vs string inverters, flat system list vs group hierarchy) that a generic abstraction would be lossy or leaky |
| Data model | Separate `enphase_*` columns on HubSpotPropertyCache + dedicated Prisma models | Clean separation, both providers coexist on a property independently |
| Network | Proxy-ready with optional direct calls | Unknown if Enphase requires IP allowlisting; `ENPHASE_PROXY_URL` env var routes through Fly.io proxy when set, otherwise calls `api.enphaseenergy.com` directly |
| Alert model | No `EnphaseAlert` table | Enphase v4 Monitoring API has no discrete alerts endpoint; system health is conveyed via `status` field + non-reporting micro counts. Revisit if Enphase adds alerts API |
| Auth | Installer-fleet OAuth2 | PB's installer account sees all customer systems with a single OAuth grant |

## Non-Goals

- **Commissioning API** — provisioning new systems is out of scope
- **Per-microinverter telemetry history** — too granular; store counts only
- **Automatic ticket creation from status changes** — future enhancement after learning Enphase status patterns
- **SolarEdge abstraction layer** — premature; refactor when a third provider arrives
- **Dedicated Enphase fleet dashboard page** — Property Drawer + HubSpot card are sufficient for now

---

## 1. API Client

**File:** `src/lib/enphase-enlighten.ts`

### Authentication

Enphase v4 uses OAuth2 authorization code grant:

1. One-time: PB admin visits Enphase OAuth URL → grants installer-account access → receives authorization code
2. Exchange code for `access_token` + `refresh_token`
3. Store initial `refresh_token` in DB (`SystemConfig` row with key `enphase_refresh_token`)
4. Runtime: refresh token → new access token (~12hr TTL), cached in module state with 60s expiry buffer
5. Every request includes `key={ENPHASE_API_KEY}` as a query parameter

**Refresh token rotation:** Unlike Tesla's client_credentials flow, Enphase's token refresh endpoint returns a NEW refresh token alongside the new access token, invalidating the old one. The client must persist the new refresh token after every successful refresh. We store it in a `SystemConfig` DB row (not an env var) so that serverless cold starts always read the latest token. The `ENPHASE_REFRESH_TOKEN` env var serves as the initial seed only — once the first runtime refresh succeeds, the DB value takes precedence.

Token read priority: DB `SystemConfig('enphase_refresh_token')` → env `ENPHASE_REFRESH_TOKEN` fallback.

### Environment Variables

```
ENPHASE_ENABLED=true
ENPHASE_API_KEY                    # From Enphase developer portal
ENPHASE_CLIENT_ID                  # OAuth app client ID
ENPHASE_CLIENT_SECRET              # OAuth app client secret
ENPHASE_REFRESH_TOKEN              # Initial refresh token seed (one-time OAuth flow; runtime uses DB after first refresh)
ENPHASE_PROXY_URL                  # Optional — if set, routes through Fly.io proxy; else direct to api.enphaseenergy.com
ENPHASE_PORTAL_URL_TEMPLATE=https://enlighten.enphaseenergy.com/systems/{systemId}
ENPHASE_CROSSLINK_ENABLED=true
```

### Rate Limiting

Partner tier: ~10 req/sec. Use `TokenBucket(8)` to stay safe (same pattern as PowerHub's `TokenBucket(4)`).

### Retry Strategy

Same as PowerHub:
- 429 / 5xx → exponential backoff (500ms × 2^attempt), max 3 retries
- 401 → clear cached token, re-authenticate, retry once
- 403 → immediate failure (log + throw)

### Client Interface

```typescript
export interface EnphaseClient {
  // Fleet discovery
  listSystems(): Promise<EnphaseSystem[]>;

  // Per-system detail
  getSystemSummary(systemId: number): Promise<EnphaseSystemSummary>;
  getSystemDevices(systemId: number): Promise<EnphaseDevices>;

  // Telemetry
  getProductionStats(systemId: number): Promise<EnphaseProductionStats>;
  getConsumptionStats(systemId: number): Promise<EnphaseConsumptionStats>;
  getBatteryTelemetry(systemId: number): Promise<EnphaseBatteryTelemetry>;
  getBatteryLifetime(systemId: number): Promise<EnphaseBatteryLifetime>;
}
```

### Endpoint Mapping

| Method | Path | Purpose |
|--------|------|---------|
| `listSystems` | `GET /api/v4/systems` | Paginated list of all systems visible to installer account |
| `getSystemSummary` | `GET /api/v4/systems/{id}/summary` | Current production/consumption/status snapshot |
| `getSystemDevices` | `GET /api/v4/systems/{id}/devices` | Microinverters, batteries, envoys, meters with serials |
| `getProductionStats` | `GET /api/v4/systems/{id}/telemetry/production_meter` | Production telemetry (15-min intervals) |
| `getConsumptionStats` | `GET /api/v4/systems/{id}/telemetry/consumption_meter` | Consumption telemetry (15-min intervals) |
| `getBatteryTelemetry` | `GET /api/v4/systems/{id}/telemetry/battery` | Battery charge/discharge telemetry |
| `getBatteryLifetime` | `GET /api/v4/systems/{id}/battery_lifetime` | Lifetime battery energy data |

### Key Differences from PowerHub

| Aspect | PowerHub | Enphase |
|--------|----------|---------|
| System IDs | UUIDs | Integers |
| Fleet structure | Hierarchical groups | Flat system list |
| Auth | client_credentials (machine-to-machine) | Authorization code (installer account OAuth) |
| Telemetry cadence | Real-time signals | 5–15 min intervals |
| Device granularity | Site-level (gateway, batteries, inverters, meters) | Per-microinverter (serial + last report per micro) |
| Alerts | Dedicated alerts API with severity levels | No alerts API; `status` field + non-reporting micro counts |
| Portal URL | GridLogic deep-link by site UUID | Enlighten deep-link by system integer ID |

### Portal URL Computation

```typescript
export function computeEnphasePortalUrl(systemId: number): string | null {
  if (!systemId) return null;
  const template =
    process.env.ENPHASE_PORTAL_URL_TEMPLATE ||
    "https://enlighten.enphaseenergy.com/systems/{systemId}";
  return template.replaceAll("{systemId}", String(systemId));
}
```

---

## 2. Database Models

### Enums

```prisma
enum EnphaseLinkMethod {
  PROPERTY       // Linked via property creation flow
  ADDRESS_MATCH  // Auto-linked by address hash
  MANUAL         // Admin manually linked
  GEO            // Geo-proximity match
  UNLINKED       // Not yet linked
}

enum EnphaseLinkConfidence {
  HIGH
  MEDIUM
  LOW
}

// NOTE: EnphaseSite.status is stored as a plain String (not an enum)
// because Enphase returns composite statuses ("meter_micro", etc.)
// that would require constant enum expansion. Known values:
//   "normal", "micro", "power", "comm", "battery", "meter",
//   "storage", "meter_micro", etc.
// The cron status check normalizes unknown values to the string as-is.
```

### EnphaseSite

```prisma
model EnphaseSite {
  id               String  @id @default(cuid())
  systemId         Int     @unique              // Enphase system_id
  systemName       String
  systemPublicName String?

  // Cross-link fields
  portalUrl          String?
  primaryForProperty Boolean @default(false)

  // Address
  address     String
  city        String
  state       String
  zip         String?
  addressHash String?

  // Linkage to HubSpot Property
  propertyId     String?
  property       HubSpotPropertyCache? @relation(fields: [propertyId], references: [id])
  dealId         String?
  linkMethod     EnphaseLinkMethod     @default(UNLINKED)
  linkConfidence EnphaseLinkConfidence @default(LOW)

  // System info
  modules        Int      @default(0)
  systemSizeW    Float?                        // DC capacity in watts
  timezone       String?
  connectionType String?                       // "ethernet", "wifi", "cellular"
  envoySerial    String?
  status         String  @default("normal")  // Plain string — Enphase returns composite statuses
  operationalAt  DateTime?

  // Geo coordinates (for future geo-proximity matching)
  latitude       Float?
  longitude      Float?
  linkDistanceM  Float?  // Distance in meters from matched property at link time

  // Device summary
  devices            Json    @default("[]")
  microinverterCount Int     @default(0)
  batteryCount       Int     @default(0)

  // Sync metadata
  lastAssetSyncAt     DateTime
  lastTelemetrySyncAt DateTime?
  lastStatusCheckAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Back-relations
  telemetrySnapshot EnphaseTelemetrySnapshot?
  telemetryHistory  EnphaseTelemetryHistory[]

  @@index([addressHash])
  @@index([propertyId])
  @@index([dealId])
  @@index([status])
  @@index([latitude, longitude])
}

// Partial unique index (must be created in raw SQL migration, not Prisma schema):
// CREATE UNIQUE INDEX "EnphaseSite_primary_per_property"
//   ON "EnphaseSite" ("propertyId")
//   WHERE "primaryForProperty" = true AND "propertyId" IS NOT NULL;
```

### EnphaseTelemetrySnapshot

One row per system — latest known state, upserted on each telemetry poll.

```prisma
model EnphaseTelemetrySnapshot {
  id       String      @id @default(cuid())
  systemId Int         @unique
  site     EnphaseSite @relation(fields: [systemId], references: [systemId])

  timestamp DateTime

  // Production
  currentProductionW    Float?
  todayProductionWh     Float?
  lifetimeProductionWh  Float?
  lastDayProductionWh   Float?

  // Consumption (requires CT meters)
  currentConsumptionW   Float?
  todayConsumptionWh    Float?
  lifetimeConsumptionWh Float?

  // Battery (requires IQ Battery)
  batteryPercentCharge  Float?
  batteryCapacityWh     Float?
  batteryChargeW        Float?

  // Grid
  gridImportW           Float?
  gridExportW           Float?

  // System health
  systemStatus          String?
  microReportingCount   Int?
  microTotalCount       Int?
  lastReportAt          DateTime?

  raw Json?

  updatedAt DateTime @updatedAt
}
```

### EnphaseTelemetryHistory

Time-series for trending. Only key metrics (production, consumption, battery SoC), not per-micro data.

```prisma
model EnphaseTelemetryHistory {
  id       String      @id @default(cuid())
  systemId Int
  site     EnphaseSite @relation(fields: [systemId], references: [systemId])

  timestamp  DateTime
  signalName String
  value       Float?
  valueString String?  // For non-numeric signals (firmware versions, status transitions) — forward-compat with PowerHub pattern
  source      String   @default("POLL")  // "POLL" (cron) or "BULK" (backfill) — matches PowerHub pattern

  @@index([systemId, signalName, timestamp])
  @@index([systemId, timestamp])
}
```

### HubSpotPropertyCache Additions

New columns on the existing `HubSpotPropertyCache` model:

```prisma
// Enphase Enlighten denormalized fields (populated from primary EnphaseSite)
enphasePortalUrl       String?
enphaseSystemId        String?   // Stored as string for HubSpot property compat
enphaseEnvoySerial     String?
enphaseMicroCount      String?   // e.g. "24"
enphaseBatterySerials  String?   // Semicolon-joined
enphaseBatteryModel    String?
enphaseSystemSize      String?   // e.g. "9.6 kW"
enphaseHardwareSummary String?   // Multi-line formatted summary
```

New relation on `HubSpotPropertyCache`:

```prisma
enphaseSites  EnphaseSite[]
```

---

## 3. Crosslink Module

**File:** `src/lib/enphase-crosslink.ts`

Same three-function cascade as `powerhub-crosslink.ts`:

### `resolvePrimarySite(propertyId: string)`

1. Fetch all `EnphaseSite` rows for the property
2. Pick primary: newest `operationalAt` wins → if `operationalAt` is null for all candidates, fall back to `createdAt` descending → tie-break on `systemName` lexicographic desc → final tie-break on `id` desc
3. Demote all non-primary sites (`primaryForProperty = false`)
4. Promote primary (retry on P2002 unique constraint race)
5. Build device summary from primary site's `devices` JSON
6. Update `enphase_*` columns on `HubSpotPropertyCache`

### `pushToHubSpotForProperty(propertyId: string)`

1. Read denormalized `enphase_*` fields from `HubSpotPropertyCache`
2. Push to HubSpot Property object (custom properties)
3. Push to all linked Deals (`PropertyDealLink`) via `Promise.allSettled`
4. Push to all linked Tickets (`PropertyTicketLink`) via `Promise.allSettled`
5. Log partial failures without aborting batch

### `enqueueCrossSystemPush(propertyId: string)`

Orchestrator: `resolvePrimarySite()` → `pushToHubSpotForProperty()`. The cache update from step 1 bumps `updatedAt`, which the existing `zuper-property-sync` cron picks up on its next 15-min cycle.

**Feature flag:** `ENPHASE_CROSSLINK_ENABLED` — all three functions no-op when `!== "true"`.

### Device Summary Builder

**`buildEnphaseDeviceSummary(devicesJson: unknown): EnphaseDeviceSummary`**

Extracts from the devices JSON returned by Enphase `getSystemDevices()`:

```typescript
export interface EnphaseDeviceSummary {
  envoySerial: string | null;
  envoyModel: string | null;
  microModel: string | null;      // Typically all same model
  microCount: number;
  batterySerials: string | null;  // Semicolon-joined
  batteryModel: string | null;
  meterInfo: string | null;
  formatted: string | null;       // Multi-line for display
}
```

Formatted output example:
```
Envoy: 123456789012 (IQ Combiner 4C)
Microinverters: 24× IQ8PLUS-72-2-US
Battery: ABC123 (ENCHARGE-10T-1P-NA)
Battery: DEF456 (ENCHARGE-10T-1P-NA)
```

---

## 4. HubSpot Custom Properties

Create 8 new custom properties on the HubSpot Property object:

| Internal Name | Label | Type | Group |
|--------------|-------|------|-------|
| `enphase_portal_url` | Enphase Portal URL | string | Monitoring |
| `enphase_system_id` | Enphase System ID | string | Monitoring |
| `enphase_envoy_serial` | Enphase Envoy Serial | string | Monitoring |
| `enphase_micro_count` | Enphase Micro Count | string | Monitoring |
| `enphase_battery_serials` | Enphase Battery Serials | string | Monitoring |
| `enphase_battery_model` | Enphase Battery Model | string | Monitoring |
| `enphase_system_size` | Enphase System Size | string | Monitoring |
| `enphase_hardware_summary` | Enphase Hardware Summary | string | Monitoring |

These are also pushed to Deal and Ticket objects via the crosslink module (same pattern as `tesla_*` properties).

---

## 5. HubSpot UI Extension Card

**File:** `src/app/api/hubspot-card/enphase/route.ts`

Sibling route to the existing PowerHub card. Same auth pattern (HubSpot HMAC-SHA256 v3 signature verification).

### Request/Response

**Request:** `POST { objectType, objectId }` — same as PowerHub card.

**Resolution chain:** objectType → PropertyDealLink/PropertyTicketLink/direct Property → `HubSpotPropertyCache` → primary `EnphaseSite` → `EnphaseTelemetrySnapshot`.

**Response payload:**

```typescript
{
  propertyId: string;
  hubspotPropertyId: string;
  systemName: string;
  systemId: number;
  enphasePortalUrl: string | null;
  pbTechOpsUrl: string;              // https://pbtechops.com/properties/{id}?tab=monitoring
  snapshot: {
    currentProductionW: number | null;
    todayProductionWh: number | null;
    batteryPercentCharge: number | null;
    systemStatus: string;
    microReportingCount: number | null;
    microTotalCount: number | null;
    lastReportAt: string | null;      // ISO 8601
  } | null;
  equipment: {
    envoySerial: string | null;
    envoyModel: string | null;
    microModel: string | null;
    microCount: number;
    batterySerials: string | null;
    batteryModel: string | null;
    batteryCount: number;
    systemSizeKw: number | null;
  };
}
```

The HubSpot extension React component (separate repo: `hubspot-extensions/`) will render:
- Enlighten portal deep-link button
- Current production gauge
- Battery SoC bar (if present)
- Microinverter health indicator (e.g. "24/24 reporting" or "22/24 — 2 micros down")
- System status badge (Normal / Micro Issue / Comm Issue / etc.)
- Equipment summary

---

## 6. Cron Jobs

### `/api/cron/enphase-assets` — Asset Discovery (daily, ~2am)

1. Call `listSystems()` with pagination to get full fleet
2. For each system, upsert `EnphaseSite` row:
   - Create if new `systemId`
   - Update name, address, device counts, status on existing
3. For each site, call `getSystemDevices()` to refresh device inventory JSON
4. Compute `addressHash` for new/changed addresses
5. Auto-link to `HubSpotPropertyCache` rows by `addressHash` match (same logic as PowerHub)
6. For newly linked or device-changed sites, trigger `enqueueCrossSystemPush(propertyId)`

**Rate budget:** ~5 pagination calls for `listSystems()` + ~500 `getSystemDevices()` calls ≈ 505 total calls. At 8 req/sec, completes in ~1 min.

### `/api/cron/enphase-telemetry` — Telemetry Sync (every 15 min)

1. Query ALL active `EnphaseSite` rows (no status filter — handle errors gracefully per-site, same pattern as PowerHub telemetry cron)
2. For each site, call `getSystemSummary()` — lightweight single-call snapshot
3. Upsert `EnphaseTelemetrySnapshot` with production, consumption, battery, grid data
4. Append key metrics to `EnphaseTelemetryHistory` (production_w, consumption_w, battery_soc)
5. Update `EnphaseSite.lastTelemetrySyncAt`
6. If `getSystemSummary()` fails for a site (e.g., envoy offline), log warning and continue to next site — do NOT skip the entire batch

**Rate budget:** ~500 calls per 15-min cycle = ~0.6 req/sec — well within limits.

### `/api/cron/enphase-status-check` — Health Check (every 30 min)

1. Query `EnphaseSite` rows where `status != 'NORMAL'` OR `lastTelemetrySyncAt < 1 hour ago`
2. For flagged sites, call `getSystemDevices()` to identify non-reporting microinverters
3. Update `EnphaseSite.status` based on device reporting
4. If status transitions (e.g. MICRO → NORMAL or NORMAL → COMM), log to `ActivityLog`
5. Update `EnphaseSite.lastStatusCheckAt`

**Rate budget:** ~50 unhealthy sites × 1 call = minimal.

### All Cron Routes

All follow the existing pattern:
- `CRON_SECRET` bearer token auth
- `ENPHASE_ENABLED` guard
- `maxDuration` varies by route: 300 (assets), 120 (telemetry), 120 (status-check) — matching vercel.json functions config
- Return JSON summary `{ success, sitesProcessed, errors }`

---

## 7. One-Time OAuth Setup Flow

### Admin Routes

**`GET /api/admin/enphase/oauth/authorize`**
- Admin-only (role guard)
- Redirects to `https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id={}&redirect_uri={}`
- Redirect URI: `https://pbtechops.com/api/admin/enphase/oauth/callback`

**`GET /api/admin/enphase/oauth/callback`**
- Receives `?code=` from Enphase
- Exchanges code for `access_token` + `refresh_token` via `POST https://api.enphaseenergy.com/oauth/token`
- Stores the refresh token in `SystemConfig` DB row (key: `enphase_refresh_token`) for runtime use
- Also displays the refresh token on the admin page for manual backup to `ENPHASE_REFRESH_TOKEN` env var as a fallback seed

### Alternative: Manual curl

Document the curl commands for manual token exchange as a fallback:
```bash
# Step 1: Visit in browser
https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri

# Step 2: Exchange code
curl -X POST https://api.enphaseenergy.com/oauth/token \
  -d "grant_type=authorization_code&code=CODE&redirect_uri=REDIRECT" \
  -u "CLIENT_ID:CLIENT_SECRET"
```

---

## 8. Property Drawer Integration

Extend the `<PropertyDrawer>` monitoring tab to show Enphase alongside Tesla:

- Query both `PowerhubSite` and `EnphaseSite` for the property
- If Enphase data exists: show current production, battery SoC, micro health, Enlighten portal link
- If Tesla data exists: show existing PowerHub card (unchanged)
- Both can appear if a property has both providers (rare but possible during system transitions)
- Use the same card layout pattern: portal link button, key metrics, equipment summary

---

## 9. Middleware & Route Registration

### Public Routes (no session auth)

Add to `PUBLIC_ROUTES` in `src/middleware.ts`:

```typescript
"/api/cron/enphase-assets",       // Enphase asset sync — CRON_SECRET validated in route
"/api/cron/enphase-telemetry",    // Enphase telemetry poll — CRON_SECRET validated in route
"/api/cron/enphase-status-check", // Enphase status check — CRON_SECRET validated in route
"/api/hubspot-card/enphase",      // HubSpot UI Extension — HubSpot signature v3 validated in route
```

### Admin Routes

The OAuth setup routes live under `/api/admin/enphase/` which is already covered by the `ADMIN_ONLY_ROUTES` prefix check (`/api/admin/*`).

---

## 10. Feature Flags

| Flag | Purpose | Default |
|------|---------|---------|
| `ENPHASE_ENABLED` | Kill switch for API client + cron jobs | `false` |
| `ENPHASE_CROSSLINK_ENABLED` | Kill switch for HubSpot/Zuper propagation | `false` |
| `NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED` | Kill switch for UI surfaces (Property Drawer, cards) | `false` |

All independent from PowerHub flags. Both providers operate in parallel.

---

## 11. Vercel Cron Configuration

Add to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/enphase-assets", "schedule": "0 9 * * *" },
    { "path": "/api/cron/enphase-telemetry", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/enphase-status-check", "schedule": "5,35 * * * *" }
  ],
  "functions": {
    "src/app/api/cron/enphase-assets/route.ts": { "maxDuration": 300 },
    "src/app/api/cron/enphase-telemetry/route.ts": { "maxDuration": 120 },
    "src/app/api/cron/enphase-status-check/route.ts": { "maxDuration": 120 }
  }
}
```

(Times in UTC — `0 9` = 2am MT during MDT.)

---

## 12. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `src/lib/enphase-enlighten.ts` | API client (auth, rate limiter, typed endpoints) |
| `src/lib/enphase-crosslink.ts` | Crosslink propagation (resolvePrimarySite, pushToHubSpot, enqueue) |
| `src/app/api/cron/enphase-assets/route.ts` | Asset discovery cron |
| `src/app/api/cron/enphase-telemetry/route.ts` | Telemetry sync cron |
| `src/app/api/cron/enphase-status-check/route.ts` | Health check cron |
| `src/app/api/hubspot-card/enphase/route.ts` | HubSpot UI Extension card backend |
| `src/app/api/admin/enphase/oauth/authorize/route.ts` | OAuth start (redirect to Enphase) |
| `src/app/api/admin/enphase/oauth/callback/route.ts` | OAuth callback (exchange code for tokens) |
| `prisma/migrations/YYYYMMDD_enphase_models/migration.sql` | Schema migration |

### Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add EnphaseSite, EnphaseTelemetrySnapshot, EnphaseTelemetryHistory models + enums; add `enphase_*` columns and `enphaseSites` relation on HubSpotPropertyCache |
| `src/middleware.ts` | Add 4 routes to `PUBLIC_ROUTES` |
| `.env.example` | Add all `ENPHASE_*` env vars including `ENPHASE_PORTAL_URL_TEMPLATE` with its default value |
| `vercel.json` | Add 3 cron schedules + 3 `functions` maxDuration overrides |
| `src/components/PropertyDrawer.tsx` | Add Enphase monitoring section to monitoring tab |
| `CLAUDE.md` | Document Enphase integration in Major Systems section |

### Files NOT Modified (by design)

| File | Reason |
|------|--------|
| `src/lib/roles.ts` | No changes needed: cron + HubSpot card routes are in `PUBLIC_ROUTES` (no session auth), OAuth routes are under `/api/admin/*` (covered by `ADMIN_ONLY_ROUTES` prefix), Property Drawer fetches through existing `/api/properties/` routes already in role allowlists |

---

## 13. Testing Strategy

- **Unit tests** for `enphase-enlighten.ts`: token caching, rate limiter, retry logic, portal URL computation
- **Unit tests** for `enphase-crosslink.ts`: primary site selection (operationalAt ordering, tie-breaks), device summary builder, partial-failure handling
- **Integration tests** for cron routes: mock Enphase API responses, verify DB upserts
- **Manual E2E**: once API credentials are obtained, run asset sync against real fleet, verify Property linking + HubSpot card rendering

---

## 14. Rollout Plan

1. **Phase 1 — Apply for API access**: Register PB as Enphase Partner developer, get API key + OAuth credentials
2. **Phase 2 — Schema + client**: Ship Prisma migration + API client + OAuth setup routes. Enable `ENPHASE_ENABLED=true` after successful OAuth flow.
3. **Phase 3 — Cron sync**: Enable asset sync cron. Verify site discovery + address matching. Fix any linking issues.
4. **Phase 4 — Crosslink + UI**: Enable `ENPHASE_CROSSLINK_ENABLED=true` + `NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED=true`. Verify HubSpot properties populated, card renders, Property Drawer shows Enphase data.
5. **Phase 5 — Telemetry + status**: Enable telemetry + status check crons. Monitor rate limits and data freshness.

Each phase can be rolled back independently via feature flags.
