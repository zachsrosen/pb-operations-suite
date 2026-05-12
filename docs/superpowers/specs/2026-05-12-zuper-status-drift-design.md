# Zuper Status Drift Dashboard — Design Spec

**Date:** 2026-05-12
**Status:** Draft
**Owner:** Zach
**Pattern reference:** [DA drift dashboard](./../../../src/app/dashboards/da-drift/) (PR #528, #529, #604)

## Problem

Zuper job statuses and HubSpot deal stages routinely drift out of sync. The
existing admin tool at `/dashboards/zuper-status-comparison` provides a
heavyweight audit view (1,728-line page + 1,292-line API: status, dates,
linkage coverage, non-core audit, dedupe). That tool serves admin
investigation, not PM action.

PMs need a focused action queue: a flag list of drift cases requiring their
attention, with one-click navigation to HubSpot to fix, plus resolve/ignore
actions so the list stays clean.

## Scope

### What this builds

A `/dashboards/zuper-drift` dashboard for Project Managers, modeled
**exactly** on `/dashboards/da-drift`. Includes a 15-minute reconcile cron
and a one-off backfill script.

### What it covers — drift conditions

For every Zuper job across **all three categories** (site_survey,
construction including all sub-categories, inspection), the cron fires a
drift flag when any of the following are true:

| Drift type | Condition |
|---|---|
| `STATUS` | Zuper job's `current_job_status` doesn't map to the deal's HubSpot stage per `STATUS_MAPPING`, AND HubSpot isn't legitimately ahead (terminal HS status while Zuper is behind, or Zuper Failed → HS post-failure status with matching fail date) |
| `FAIL_DISAGREEMENT` | Inspection-category only: Zuper Failed but HS Passed, or Zuper Passed but HS Failed |
| `COMPLETION_DATE` | Construction sub-category: Zuper `completed_at` differs from HubSpot's construction completion date by >1 day |
| `INSPECTION_PASS_DATE` | Inspection passed: Zuper `completed_at` differs from HubSpot's inspection-pass date by >1 day |
| `INSPECTION_FAIL_DATE` | Inspection failed: Zuper `failed_at` differs from HubSpot's inspection-fail date by >1 day |

Survey/construction/inspection **schedule** dates are deliberately excluded — they shift constantly and would generate constant noise.

### Construction sub-categories

Construction is not one category — it fans out across **four parallel sub-category UIDs** behind the `CONSTRUCTION_JOB_SPLIT_ENABLED` feature flag (default on):

- General Construction
- Solar Install
- Battery Install
- EV Install

A single deal can have multiple sibling construction sub-jobs running in
parallel (e.g., Solar + Battery + EV all at once). The HubSpot deal has a
single `construction_status` property.

The cron evaluates **each sub-job independently** against the deal's
single construction status. If a deal has Solar in `Construction Complete`
matching HubSpot, but Battery still `Scheduled` while HubSpot reads
`Construction Complete`, that produces 1 drift row (for Battery) — not 0,
not rolled-up. PMs need per-sub-job visibility to act.

The cron honors the feature flag: when `CONSTRUCTION_JOB_SPLIT_ENABLED=false`
the cron scans only legacy "Construction", consistent with the rest of the
codebase.

### Out of scope (intentional)

- **No auto-fix in HubSpot.** Flag-only, like DA drift. PM clicks through
  and corrects manually.
- **No schedule-date drift detection.** Schedule dates shift; not actionable.
- **No non-core audit, duplicate detection, or linkage coverage views.**
  Those stay on the admin page.
- **No survey or inspection sub-category fan-out.** Only construction has
  sub-categories today.
- **No PM filtering ("just my deals").** PB convention is PMs see all deals;
  match it here.

## Users

| Role | Access |
|---|---|
| ADMIN, OWNER, EXECUTIVE | Full (wildcard `allowedRoutes`) |
| PROJECT_MANAGER | Full — primary audience |
| All others | No access |

PM suite landing page gets a new card under "Reviews" alongside DA Drift,
Pending Approval, and Design Revisions.

## Architecture

Four pieces, mirroring DA drift:

### 1. Shared mapping lib `src/lib/zuper-status-mapping.ts`

Extract the following from `src/app/api/zuper/status-comparison/route.ts`:

- `STATUS_MAPPING` (Record<category, Record<zuperStatus, hubspotStatus[]>>)
- `HS_TERMINAL_STATUSES`, `POST_FAILURE_STATUSES` sets
- `isStatusMismatch(zuperStatus, hubspotStatus, category)`
- `checkHubspotAhead(zuperStatus, hubspotStatus, deal?, job?)`
- `zuperDateToLocal(dateStr)`, `hubspotDateToLocal(dateStr)`
- `compareDates(zuperDate, hubspotDate)`, `dateDiffDays(zuperDate, hubspotDate)`

Plus one new export:

- `evaluateJobDrift(job, deal): DriftEval` — pure function returning the
  drift types that fire for a given job+deal pair. Encapsulates the
  per-category date checks (construction completion, inspection pass/fail
  date) and status check. Single source of truth used by cron + backfill.

The existing admin comparison API re-imports these from the new lib —
**zero behavior change** in the admin path. The 1,292-line file shrinks by
~150 lines as shared logic moves out.

### 2. Prisma model `ZuperStatusDrift`

```prisma
model ZuperStatusDrift {
  id                  String              @id @default(cuid())
  zuperJobUid         String              @unique  // one row per Zuper job
  hubspotDealId       String?
  projectNumber       String?
  dealName            String?
  pbLocation          String?
  category            String              // site_survey | construction | solar_install | battery_install | ev_install | inspection
  zuperJobTitle       String?
  zuperStatus         String              // job's current_job_status at detection
  hubspotStatus       String?             // deal's stage at detection
  driftTypes          ZuperDriftType[]    // STATUS, FAIL_DISAGREEMENT, COMPLETION_DATE, INSPECTION_PASS_DATE, INSPECTION_FAIL_DATE
  zuperCompletedAt    DateTime?
  hubspotCompletionAt DateTime?
  zuperFailedAt       DateTime?
  hubspotFailAt       DateTime?
  detectedAt          DateTime            @default(now())
  status              ZuperDriftStatus    @default(OPEN)  // OPEN | RESOLVED | IGNORED
  resolvedAt          DateTime?
  resolvedBy          String?
  resolveNote         String?

  @@index([status])
  @@index([hubspotDealId])
  @@index([category])
}

enum ZuperDriftType {
  STATUS
  FAIL_DISAGREEMENT
  COMPLETION_DATE
  INSPECTION_PASS_DATE
  INSPECTION_FAIL_DATE
}

enum ZuperDriftStatus {
  OPEN
  RESOLVED
  IGNORED
}
```

Mirrors `DaStatusDrift` shape. Migration is additive (new tables only) —
safe to apply in advance of code rollout per the
`migration_ordering`/`prisma_migration_before_code` memory rules.

### 3. Cron `GET /api/cron/zuper-status-reconcile`

- Auth: `Bearer ${CRON_SECRET}` (matches other crons).
- Feature flag: `ZUPER_RECONCILE_ENABLED=true` short-circuits when false.
- Public route in middleware (CRON_SECRET validated in handler).
- Schedule: `*/15 * * * *` in `vercel.json`.
- `maxDuration: 60`.

**Flow per tick:**

1. Read jobs from `ZuperJobCache` (the existing Prisma model that mirrors
   Zuper jobs — kept fresh by other sync paths). No live Zuper API calls
   from the cron path.
2. Group jobs by `(dealId, category)`. Apply `markSupersededJobs()`-style
   logic to skip older jobs whose category has a newer sibling for the
   same deal.
3. For each surviving job, fetch the deal's HubSpot properties
   (`hs_pipeline_stage`, `dealstage`, `construction_status`,
   `inspection_status`, `inspection_pass_date`, `inspection_fail_date`,
   `construction_complete_date`, etc.) via `hubspotClient`. Batch reads.
4. Call `evaluateJobDrift(job, deal)` → set of drift types.
5. If empty (in sync): auto-resolve any existing OPEN drift row for this
   `zuperJobUid` with `resolvedBy: "system:healed"`,
   `resolveNote: "Zuper and HubSpot now match"`.
6. If non-empty: upsert drift row keyed on `zuperJobUid`. On update, refresh
   all fields and re-open the row (mirrors DA drift behavior — a previously
   resolved-but-now-drifting row resurfaces).

Returns JSON summary: `scanned`, `evaluated`, `superseded`, `matched`,
`drifted`, `autoResolved`, `newDriftIds`, `errors`.

### 4. Dashboard + API

**`/api/zuper-drift`** (mirrors `/api/da-drift`):
- `GET ?status=open|resolved|ignored|all` → list of rows
- `POST {id, action: 'resolve'|'ignore'|'reopen', note?}` → state change
- Allowed roles: ADMIN, OWNER, EXECUTIVE, PROJECT_MANAGER

**`/dashboards/zuper-drift`** (mirrors `/dashboards/da-drift`):
- Same filter chips (Open / Resolved / Ignored / All) with counts
- Table columns: Detected at · Project # / Deal name (links to deal) · Category badge (Survey/Construction-Solar/Construction-Battery/Construction-EV/Construction-General/Inspection) · Drift type chip(s) · Zuper status · HubSpot status · Date diff (if a date drift) · Action buttons
- Action column: Resolve / Ignore / Reopen + external links to HubSpot deal and Zuper job
- Uses `DashboardShell` with `accentColor="cyan"` (DA drift is orange; differentiate)
- PROJECT_MANAGER access via `roles.ts` allowlist

**Suite card** on `/suites/project-management` page, "Reviews" section, after
the DA Status Drift card.

**Page directory** entry in `src/lib/page-directory.ts`.

**DashboardShell parent-suite map**: `/dashboards/zuper-drift` →
Project Management.

## Data flow

```
ZuperJobCache (kept fresh by other sync paths)
    │
    │  every 15 min: pandadoc-da-reconcile pattern
    ▼
GET /api/cron/zuper-status-reconcile
    │  1. Read jobs from cache (last 90 days, by modified_at)
    │  2. Group + dedupe (markSupersededJobs)
    │  3. Batch-fetch HubSpot deal properties
    │  4. evaluateJobDrift(job, deal) → DriftType[]
    │  5. Upsert ZuperStatusDrift, auto-heal stale rows
    ▼
ZuperStatusDrift (Postgres)
    │
    │  PM clicks /dashboards/zuper-drift
    ▼
PM resolves / ignores / clicks through to HubSpot to fix
```

## Error handling

- HubSpot fetch failures per deal: captured in `errors[]`, drift row not
  upserted for that deal that tick. Next tick retries.
- ZuperJobCache empty (sync hasn't run yet): cron returns
  `{status: 'ok', scanned: 0}` quickly.
- Cron timeout (60s): processed jobs are committed; remaining jobs picked
  up next tick. Idempotent because we key on `zuperJobUid`.

## Testing

Following the test patterns established by DA drift (which had no
test coverage and shipped fine — the cron is small enough to verify by
running the backfill, but we should be better here):

1. Unit test `evaluateJobDrift(job, deal)` with table-driven cases for
   each `DriftType` × `category` combination. Critical because this is
   the core decision function.
2. Unit test `markSupersededJobs()` extracted helper.
3. Backfill script as integration test: run against prod with `WIPE=1`,
   verify row count is finite and rows look plausible.

## Rollout plan

1. **Migration ships first** (additive, safe to apply early — per memory
   rule `prisma_migration_before_code`):
   `npx prisma migrate dev --name add-zuper-status-drift`. Apply to prod
   via `scripts/migrate-prod.sh` BEFORE the code PR merges.
2. **Ship PR with flag off** (`ZUPER_RECONCILE_ENABLED` env var unset,
   route returns `{status: 'disabled'}`).
3. **Run one-off backfill** against prod:
   `LOOKBACK_DAYS=90 WIPE=1 npx tsx scripts/backfill-zuper-drift.ts` to
   seed the table and validate the drift count is sane.
4. **Set `ZUPER_RECONCILE_ENABLED=true`** in Vercel prod env (via
   `printf '%s' "true" | vercel env add ZUPER_RECONCILE_ENABLED production`,
   per memory rule `vercel_env_no_echo`).
5. **Pull a prod tick log** after 15 min to confirm the cron is working.
6. **Watch for ~24 hours**, then declare GA.

Rollback: flip env var to `false` and the cron short-circuits. Existing
rows stay. Suite card can be hidden by toggling a flag if needed.

## Open questions

None. All domain questions answered upfront:
- Categories: all three including construction sub-categories
- Drift conditions: A (status) + B (fail/pass disagreement) + C dates
  (completion, pass, fail) — NOT schedule dates
- Audience: PROJECT_MANAGER + admin tiers
- Auto-resolve on heal: yes (mirrors DA drift)
- Flag-only, no auto-fix: yes (mirrors DA drift)
