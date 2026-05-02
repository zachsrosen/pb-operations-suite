# Aircall Call Analytics

A call analytics layer that ingests Aircall call data, stores it in Postgres, and renders volume + responsiveness + per-user statistics on an Admin sandbox dashboard. Once validated, the same data feeds an Executive rollup card (Phase 2). Zuper Connect is a deferred Phase 3 source against the same schema.

## Goals

- Visibility into call activity at the **per-user** level: volume, talk time, missed calls, answer rate, avg time-to-answer, avg duration, last activity.
- Responsiveness KPIs at the company level: total calls (in/out), missed rate, avg time-to-answer, voicemail rate, total talk time.
- Filterable, fast dashboard with date range, user, direction, and status filters.
- Sandbox-first: ship to `/dashboards/admin/calls` (ADMIN role only) so we can validate data quality before promoting to the Executive suite.

## Non-Goals (MVP)

- HubSpot deal/contact linking by phone number (deferred — captured in `customerNumber` for later association).
- Zuper Connect integration (Phase 3 — same schema, additional `provider` discriminator added when introduced).
- Click-to-call from anywhere in the app.
- Per-location rollup (deferred — Aircall user-to-location is messy per stakeholder; Phase 2 may revisit using Aircall teams or a small admin mapping screen).
- Executive suite dashboard card (Phase 2).
- SMS/WhatsApp call types (Aircall supports these; we only ingest voice for MVP).

## Route

`/dashboards/admin/calls` — client component wrapped in `<DashboardShell title="Call Analytics" accentColor="cyan" fullWidth={true}>`.

Behind feature flag `AIRCALL_DASHBOARD_ENABLED`. When the flag is off, the page returns a simple "Disabled" notice; the link is hidden from the Admin suite landing page.

ADMIN role only. Add `/dashboards/admin/calls` to:
- `allowedRoutes` for `ADMIN` in `src/lib/roles.ts` — middleware enforces this list.
- Suite card on `/suites/admin` (gated on the feature flag).

The middleware already covers the `/dashboards/admin` prefix as part of its admin-only handling — no middleware code change needed for the page route. The new `/api/aircall/*` paths must be added to ADMIN's `allowedRoutes` explicitly (per the project rule that new API routes must be added to every role's allowlist or middleware silently 403s).

## Data Source: Aircall Public API

Aircall provides:

- **REST API**: `https://api.aircall.io/v1` — Basic auth (`Authorization: Basic base64(API_ID:API_TOKEN)`). Rate limit: 60 req/min per integration. Pagination via `per_page` (max 50) and `page` cursor. Key endpoints:
  - `GET /calls` — paginated call list, filterable by `from`/`to` (Unix timestamps), `direction`, `user_id`. Returns ~30 fields per call.
  - `GET /users` — full user roster (id, name, email, available, do_not_disturb).
  - `GET /teams` — team roster (used in Phase 2 for location rollup if viable).
- **Webhooks**: HTTPS POST with `X-Aircall-Signature` HMAC-SHA256 header. Event we care about: `call.ended`. (Other events — `call.answered`, `call.created`, `call.transferred`, `call.commented`, `call.tagged` — ignored for MVP. We only need final state.)

**Authentication** (new env vars):
- `AIRCALL_API_ID` — integration API ID
- `AIRCALL_API_TOKEN` — integration API token
- `AIRCALL_WEBHOOK_TOKEN` — webhook signing secret (provided by Aircall when webhook is created)
- `AIRCALL_DASHBOARD_ENABLED` — feature flag (default `false`)

All four added to `.env.example` with descriptions. Vercel prod env must be populated before flag is flipped.

## Data Model (Prisma)

Two new models in `prisma/schema.prisma`:

```prisma
model AircallCallCache {
  id              String    @id                  // Aircall call ID (string for forward-compat)
  provider        String    @default("aircall")  // discriminator for future Zuper Connect rows
  direction       String                          // "inbound" | "outbound"
  status          String                          // "answered" | "missed" | "voicemail"
  startedAt       DateTime
  answeredAt      DateTime?
  endedAt         DateTime?
  durationSec     Int       @default(0)           // total elapsed
  talkTimeSec     Int       @default(0)           // active conversation time
  timeToAnswerSec Int?                            // null for missed calls
  userAircallId   String?                          // string; nullable for ring-group misses
  userName        String?
  userEmail       String?
  customerNumber  String?                          // E.164
  rawPayload      Json                             // full webhook/API body for forward-compat
  syncedAt        DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([startedAt])
  @@index([userAircallId, startedAt])
  @@index([direction, status, startedAt])
  @@index([provider, startedAt])
}

model AircallUserCache {
  aircallUserId String   @id
  name          String
  email         String?
  available     Boolean  @default(false)
  doNotDisturb  Boolean  @default(false)
  archived      Boolean  @default(false)
  syncedAt      DateTime @default(now())

  @@index([archived, name])
}
```

**Why store, not query live:** matches the existing pattern (`HubSpotProjectCache`, `ZuperJobCache`). Aircall's 60 req/min rate limit and lack of server-side aggregation make live queries unworkable for the dashboard.

**Why `provider` discriminator:** Phase 3 adds Zuper Connect rows to the same table without a schema migration. Indexes are scoped to `provider` for query isolation.

**Migration**: additive only — no destructive changes. Created as `prisma migrate dev --name aircall_cache`. Must land before code per the migration ordering rule.

## Ingestion

### 1. Webhook receiver — `POST /api/webhooks/aircall`

- **Public route**: added to the public routes list in `src/middleware.ts` (alongside other webhook receivers).
- **Signature verification**: HMAC-SHA256 of raw request body against `AIRCALL_WEBHOOK_TOKEN`. Constant-time comparison. Reject 401 on mismatch.
- **Idempotency**: keyed on `event_id` from the payload via the existing `IdempotencyKey` model. Duplicate POSTs return 200 without re-processing.
- **Events handled**: `call.ended`. All other events return 200 with `{ ignored: true }`.
- **Action**: parse payload → upsert `AircallCallCache` row keyed on `data.id`. Store full payload in `rawPayload`.
- **Latency target**: < 500 ms p95. No external API calls in the critical path.

### 2. Backfill script — `scripts/aircall-backfill.ts`

- Manual one-time script. Pulls last 90 days from `GET /v1/calls` paginated, upserts to cache.
- Resumable: stores checkpoint in `SystemConfig` (`aircall.backfill.lastCursor`).
- Respects rate limit with 1.1s sleep between pages (≈ 54 req/min).
- Run via `npm run aircall:backfill` (added to `package.json`).
- Documented in `docs/superpowers/runbooks/aircall-backfill.md`.

### 3. Drift cron — `GET /api/cron/aircall-sync`

- Runs daily at 04:00 UTC via Vercel Cron (added to existing `crons` array in `vercel.json`).
- Pulls last 24 hours of calls, upserts to cache. Catches anything the webhook missed.
- Also refreshes `AircallUserCache` (full roster fetch — small, ~50-100 users).
- Auth: `Authorization: Bearer ${CRON_SECRET}` header check (matches `src/app/api/cron/audit-digest/route.ts`).
- Returns `{ calls: N, users: M, durationMs: ... }` for monitoring.

### 4. Aircall client — `src/lib/aircall.ts`

- Mirrors the shape of `src/lib/hubspot.ts` and `src/lib/zuper.ts`:
  - `AircallClient` class with `listCalls({ from, to, page, perPage, direction, userId })`, `listUsers({ page, perPage })`, `getCall(id)`.
  - `searchWithRetry()` equivalent: exponential backoff on 429, immediate fail on 4xx, retry on 5xx.
  - Pagination helper that auto-iterates pages.
- Pure transport — no DB writes. The webhook handler, cron, and backfill script call it and persist.

## API Routes

All under `/api/aircall/*`. Three GET endpoints power the UI; the webhook is separate.

### `GET /api/aircall/calls`

Filterable, paginated call list for the recent-calls table.

Query params:
- `from` / `to` — ISO date strings (default: last 30 days)
- `userId` — comma-sep list of `aircallUserId` (multi-select filter)
- `direction` — `inbound` | `outbound` (omit for both)
- `status` — comma-sep: `answered`, `missed`, `voicemail`
- `page` — default 1
- `pageSize` — default 50, max 200
- `sort` — `startedAt` (default), `durationSec`, `talkTimeSec`
- `order` — `desc` (default), `asc`

Response: `{ calls: AircallCallSummary[], total, page, pageSize }`.

### `GET /api/aircall/stats`

Aggregated KPIs and per-user table for the current filter.

Query params: same `from`, `to`, `userId`, `direction`, `status` as above.

Response:
```ts
{
  kpis: {
    total: number;
    inbound: number;
    outbound: number;
    missed: number;
    missedRate: number;        // 0..1
    voicemailRate: number;     // 0..1
    avgTimeToAnswerSec: number;
    totalTalkTimeSec: number;
    answerRate: number;        // 0..1
    deltaVsPrior: {
      total: number;           // pct change vs prior period of equal length
      missedRate: number;
      avgTimeToAnswerSec: number;
    };
  };
  perUser: Array<{
    aircallUserId: string;
    name: string;
    email: string | null;
    totalCalls: number;
    inbound: number;
    outbound: number;
    talkTimeSec: number;
    missed: number;
    answerRate: number;
    avgTimeToAnswerSec: number | null;
    avgDurationSec: number;
    lastActivityAt: string | null;
  }>;
  perDay: Array<{ date: string; inbound: number; outbound: number; missed: number; }>;
  hourHeatmap: Array<{ dayOfWeek: number; hour: number; count: number; }>;  // Mon=1..Sun=7, hour 0..23
}
```

All aggregation runs in Postgres via `groupBy` / raw SQL where needed. No in-memory loops over the cache table.

### `GET /api/aircall/users`

Full Aircall user roster from `AircallUserCache`. Used to populate the user filter dropdown.

Response: `{ users: Array<{ aircallUserId, name, email, archived }> }`.

### `POST /api/webhooks/aircall`

Webhook receiver — see Ingestion §1.

### Auth on the data routes

All three GET routes use the existing pattern (matches `src/app/api/admin/users/route.ts`):

```ts
const session = await auth();
if (!session?.user?.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
const user = await getUserByEmail(session.user.email);
if (!user?.roles?.includes("ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

The flag check (`AIRCALL_DASHBOARD_ENABLED`) is enforced server-side too, so a curl with admin cookies still 404s when disabled.

## UI

Single page at `app/dashboards/admin/calls/page.tsx`. Server component for shell, client component for interactivity.

### Layout (top-to-bottom)

1. **Filter bar** (sticky):
   - Date range preset chips: 7d / 30d (default) / 90d / Custom
   - User multi-select (`MultiSelectFilter`)
   - Direction toggle (All / Inbound / Outbound)
   - Status toggle (All / Answered / Missed / Voicemail)
   - All filters serialize to URL search params (deep-linking pattern from existing dashboards).

2. **KPI row** — five `StatCard`s:
   - Total Calls (with inbound/outbound mini-split)
   - Missed Rate (with delta vs prior period)
   - Avg Time-to-Answer (with delta)
   - Voicemail Rate
   - Total Talk Time

3. **Charts row**:
   - **Calls per Day** — stacked bar chart (`MonthlyBarChart` or new component if shape doesn't fit). Stacks: inbound / outbound / missed. Hover shows day total.
   - **Hour-of-Day Heatmap** — 7×24 grid, color intensity = call count (`CapacityHeatmap`-style component, may need a thin variant).

4. **Per-User Table** — sortable on every column:
   - Name | In | Out | Talk Time | Missed | Answer Rate | Avg Time-to-Answer | Avg Duration | Last Activity

5. **Recent Calls Table** (drill-down) — paginated:
   - Time | Direction | User | Customer Number | Duration | Status

### Data Fetching

- React Query keys: `aircall:stats:{filterHash}`, `aircall:calls:{filterHash}:{page}`, `aircall:users`.
- Stale time: 60s (calls move slowly enough; SSE invalidates on webhook).
- SSE: webhook handler calls `appCache.invalidateByPrefix("aircall:")` after upsert. The existing `/api/stream` route subscribes to `appCache` and pushes `cache-invalidate` events; the client's `useSSE` hook with `cacheKeyFilter: "aircall"` triggers React Query refetch. No new SSE infrastructure is needed.

### Empty / loading / error states

- **Loading**: skeleton table + skeleton cards using existing `Skeleton` component.
- **Empty**: "No calls in this date range" with a button to widen the range to 90d.
- **Error**: friendly inline message + retry; the underlying error logged to Sentry.
- **Flag off**: page returns a single card explaining the feature is disabled and how to enable it (env var name).

## Roles & Permissions

- Page route `/dashboards/admin/calls` — covered by `ADMIN_ONLY_ROUTES` middleware prefix; also added to `allowedRoutes` for ADMIN in `src/lib/roles.ts`.
- API routes `/api/aircall/*` (GET) — added to ADMIN's `allowedRoutes` (consistent with the New API routes feedback rule). Other roles get 403 from middleware before the handler runs.
- Webhook `/api/webhooks/aircall` — public, signature-verified. Added to public-routes list in middleware.
- Cron `/api/cron/aircall-sync` — public route + cron-secret check (existing pattern).

## Observability

- Each Aircall API call wrapped with the standard `searchWithRetry`-style logger (`provider=aircall`, `endpoint`, `durationMs`, `status`).
- Webhook handler emits `ActivityLog` rows on signature failure (risk: HIGH) and on successful upsert. New `ActivityType` enum value `WEBHOOK_AIRCALL_CALL_ENDED` added in the same migration as the cache tables (additive, non-destructive).
- Cron run row in `BomPipelineRun`-style table? — No. Use a new `IntegrationSyncRun` table OR a simpler approach: log `SyncRunResult` to `SystemConfig` keyed by `aircall.lastSync.{timestamp,calls,users,error}`. Pick the lighter path (SystemConfig) for MVP; revisit if we need historical sync metrics.
- Sentry breadcrumbs on every Aircall API request and on webhook receipt.

## Testing Strategy

- **Unit**:
  - `src/lib/aircall.ts` — mock `fetch`; cover pagination, 429 retry, signature verify helper.
  - Stats aggregation function — table-driven tests covering edge cases (no calls, all missed, mixed direction, prior-period delta when prior period has zero calls).
- **Integration**:
  - Webhook handler — POST a fixture payload, assert DB upsert + idempotency (second POST is a no-op).
  - Backfill script — replay a recorded paginated response, assert all calls inserted, checkpoint advances.
  - Cron — same pattern; assert drift correction (simulate webhook miss, then cron fills the gap).
- **E2E (manual smoke before flag flip)**:
  - Dev environment: register webhook against an ngrok tunnel, place a test call in Aircall sandbox, confirm row in DB and UI updates within 2s of `call.ended`.
  - Run backfill against last 7 days, spot-check counts against Aircall dashboard.

Tests live in `src/__tests__/aircall/`.

## Rollout Plan

1. **Branch** `feat/aircall-call-analytics`, single PR.
2. **Migration first, mandatory.** `prisma migrate dev --name aircall_cache` locally → commit migration → run `scripts/migrate-prod.sh` (or equivalent `prisma migrate deploy`) against prod **before** the code PR is merged. The new tables and `ActivityType` enum value must exist in prod before any code references them. (Per the project rule that Prisma migrations land before code when adding fields.)
3. **Code merge** to main → Vercel deploys via GitHub.
4. **Env var sync** — populate `AIRCALL_API_ID`, `AIRCALL_API_TOKEN`, `AIRCALL_WEBHOOK_TOKEN` in Vercel **production** before flipping the flag. Verify with `vercel env ls production`. (The flag itself, `AIRCALL_DASHBOARD_ENABLED`, stays `false` initially.)
5. **Webhook registration** — create webhook in Aircall pointing at `https://pbtechops.com/api/webhooks/aircall`, copy signing token into `AIRCALL_WEBHOOK_TOKEN` in Vercel prod.
6. **Backfill** — admin-only API route `POST /api/admin/aircall/backfill` (body: `{ days: number }`) triggers the backfill in a background job. Avoids sharing prod `DATABASE_URL` to a laptop. The same logic also lives in `scripts/aircall-backfill.ts` for local dev-DB use.
7. **Flag flip** — set `AIRCALL_DASHBOARD_ENABLED=true` in Vercel prod.
8. **Validate** — admin opens `/dashboards/admin/calls`, confirms KPIs match Aircall dashboard within ~2% tolerance.
9. **Monitor for 1 week** — watch Sentry for webhook signature failures, cron failures, and stats-query latency.
10. **Phase 2 trigger** — once data quality is validated, follow-up spec for Executive rollup card and per-location mapping.

## Open Questions for Future Phases

- Per-location rollup approach: Aircall teams API vs explicit admin mapping table — defer until exec asks for it.
- Phase numbering and timing for Zuper Connect — depends on Zuper providing API access; tracked separately.
- HubSpot deal/contact linking by phone — desirable for sales, but adds matching ambiguity (multiple deals per phone). Defer to a Phase 4 spec.

## Risk Mitigations

- **Aircall outage**: webhook fails → cron drift correction picks it up next 04:00 UTC. Backfill script can re-run any window if needed.
- **Webhook signature drift**: documented `AIRCALL_WEBHOOK_TOKEN` rotation procedure in the runbook.
- **Schema evolution**: `rawPayload` Json column preserves the full webhook body; new derived fields can be backfilled from it without re-querying Aircall.
- **Rate limit during backfill**: 1.1s sleep + checkpoint resume → safe to interrupt and restart.
- **PII in `rawPayload`**: customer phone numbers are stored. Existing app already stores phone numbers (HubSpot contact cache); same security posture applies. No new compliance work required.

## Files Touched (Summary)

- `prisma/schema.prisma` — add `AircallCallCache`, `AircallUserCache`, run migration.
- `src/lib/aircall.ts` — new client.
- `src/lib/aircall-stats.ts` — new aggregation helpers.
- `src/lib/aircall-webhook.ts` — signature verification + payload parsing.
- `src/app/api/aircall/calls/route.ts`
- `src/app/api/aircall/stats/route.ts`
- `src/app/api/aircall/users/route.ts`
- `src/app/api/webhooks/aircall/route.ts`
- `src/app/api/cron/aircall-sync/route.ts`
- `src/app/dashboards/admin/calls/page.tsx`
- `src/app/dashboards/admin/calls/CallsClient.tsx`
- `src/components/calls/KpiRow.tsx`, `PerUserTable.tsx`, `RecentCallsTable.tsx`, `CallsPerDayChart.tsx`, `HourHeatmap.tsx`
- `src/lib/roles.ts` — add `/api/aircall/*` and `/dashboards/admin/calls` to ADMIN allowlist.
- `src/middleware.ts` — add `/api/webhooks/aircall` to public routes.
- `src/app/suites/admin/page.tsx` — add Call Analytics card (gated on flag).
- `vercel.json` — add cron entry.
- `scripts/aircall-backfill.ts` — backfill runner (local/dev DB use).
- `src/app/api/admin/aircall/backfill/route.ts` — admin-gated backfill trigger for prod.
- `package.json` — add `aircall:backfill` script.
- `.env.example` — four new vars.
- `docs/superpowers/runbooks/aircall-backfill.md` — backfill + token rotation runbook.
- `src/__tests__/aircall/` — tests.
