# Zuper Status Drift Dashboard — Design Spec

**Date:** 2026-05-12
**Status:** Draft (v2 — incorporates spec review feedback)
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

For every Zuper job across **all three top-level categories** (site_survey,
construction including all four sub-category UIDs, inspection), the cron
fires a drift flag when any of the following are true:

| Drift type | Condition |
|---|---|
| `STATUS` | Zuper job's `current_job_status` doesn't map to the deal's HubSpot stage per `STATUS_MAPPING`, AND HubSpot isn't legitimately ahead (terminal HS status while Zuper is behind, or Zuper Failed → HS post-failure status with matching fail date) |
| `FAIL_DISAGREEMENT` | Inspection-category only: Zuper Failed but HS Passed, or Zuper Passed but HS Failed |
| `COMPLETION_DATE` | Construction sub-category: Zuper terminal-date (from `ZuperJobCache.completedDate`) differs from `construction_complete_date` by >1 day |
| `INSPECTION_PASS_DATE` | Inspection Passed: Zuper `completedDate` differs from `inspections_completion_date` by >1 day |
| `INSPECTION_FAIL_DATE` | Inspection Failed: Zuper `completedDate` differs from `inspections_fail_date` by >1 day (see "Fail-date precision tradeoff" below) |

Survey/construction/inspection **schedule** dates are deliberately excluded — they shift constantly and would generate noise.

#### Fail-date precision tradeoff

The existing admin comparison API computes `failedAt` by hitting the live
Zuper API and walking each job's `job_status` history to find when the
"Failed" entry was first recorded (see `enrichCompletionDates()` in
`src/app/api/zuper/status-comparison/route.ts:448`).

`ZuperJobCache.completedDate` is populated by `zuper-sync.ts` for any
terminal status — `COMPLETED`, `PASSED`, `PARTIAL PASS`, or `FAILED` (see
`zuper-sync.ts:191-211`). For a job with `jobStatus = "Failed"`, the cached
`completedDate` is the `completed_time`/`completed_at` from Zuper, which in
practice equals the fail timestamp.

**Decision:** use `ZuperJobCache.completedDate` for both pass and fail
checks, dispatching on `jobStatus`. This avoids a schema change and
keeps the cron off the live Zuper API path. The precision tradeoff
(history-walked `failedAt` vs. snapshot `completedDate`) is acceptable
for drift detection — we're flagging >1 day diffs, not auditing audit
trails. If precision ever matters, add `failedAt DateTime?` to
`ZuperJobCache` later (purely additive migration; ZuperJobCache is a
cache, no data integrity risk).

### Construction sub-categories — the wrinkle

Construction is not one category — it fans out across **four parallel sub-category UIDs** behind the `CONSTRUCTION_JOB_SPLIT_ENABLED` feature flag (default on, defined in `src/lib/zuper.ts:283`):

- General Construction
- Solar Install
- Battery Install
- EV Install

A single deal can have multiple sibling construction sub-jobs running in
parallel (e.g., Solar + Battery + EV all at once). **HubSpot has only one
deal-level `install_status` property** — no per-sub-type status field.

**Behavior:** the cron evaluates each Zuper sub-job independently against
the deal's single `install_status`. If a deal has Solar in
`Construction Complete` matching `install_status = Construction Complete`,
but Battery still `Scheduled` while `install_status` reads
`Construction Complete`, that produces 1 drift row (for Battery) — Solar
matches and isn't flagged.

**Known UX consequence:** since HubSpot can't represent per-sub-job
status, the PM's "fix" for sub-type drift is usually a **Zuper-side
update** (mark the sibling job's status to match reality), not a HubSpot
update. The dashboard surfaces both deep links (HubSpot deal + Zuper job)
so the PM can pick the right side to correct. The drift row's note panel
documents this in copy.

The cron honors `CONSTRUCTION_JOB_SPLIT_ENABLED`: when false, only
legacy "Construction" is scanned, consistent with the rest of the codebase.

### Category storage and normalization

`ZuperStatusDrift.category` stores the canonical lowercase snake_case
sub-type label so the dashboard can show PMs *which* sibling drifted:

- `site_survey`
- `construction` (general)
- `solar_install`
- `battery_install`
- `ev_install`
- `inspection`

For status-mapping lookup, the cron normalizes these to the three
mapping keys (`site_survey | construction | inspection`) via
`toMappingCategory(category)`. All four construction sub-types map to
`"construction"` for the STATUS_MAPPING lookup; the original sub-type
label is preserved on the drift row.

### Out of scope (intentional)

- **No auto-fix.** Flag-only, like DA drift. PM clicks through and
  corrects in HubSpot or Zuper manually.
- **No schedule-date drift detection.** Schedule dates shift; not
  actionable.
- **No non-core audit, duplicate detection, or linkage coverage views.**
  Those stay on the admin page.
- **No survey or inspection sub-category fan-out.** Only construction
  has sub-categories today.
- **No PM filtering ("just my deals").** PB convention is PMs see all
  deals; match it here.

## Users

| Role | Access | Source of access |
|---|---|---|
| ADMIN, EXECUTIVE | Full | Wildcard `allowedRoutes: ["*"]` in `src/lib/roles.ts` |
| PROJECT_MANAGER | Full — primary audience | Explicit `/dashboards/zuper-drift` + `/api/zuper-drift` entries added to `PROJECT_MANAGER.allowedRoutes` |
| OWNER (legacy) | Full | Normalizes to EXECUTIVE per UserRole enum comment |
| All others | No access | — |

Note on the UserRole enum: `EXECUTIVE` is canonical (renamed from
`OWNER`). The legacy `OWNER` value still exists in the enum for
pre-migration compat but normalizes to EXECUTIVE.

PM suite landing page gets a new card under "Reviews" alongside DA Drift,
Pending Approval, and Design Revisions.

## Architecture

Four pieces, mirroring DA drift:

### 1. Shared mapping lib `src/lib/zuper-status-mapping.ts`

Extract the following from `src/app/api/zuper/status-comparison/route.ts`
(lines noted are pre-extraction):

- `STATUS_MAPPING` (lines 262–290): three-category map of Zuper status → allowed HubSpot statuses
- `HS_TERMINAL_STATUSES` (293), `POST_FAILURE_STATUSES` (320)
- `isStatusMismatch(zuperStatus, hubspotStatus, category)` (298)
- `checkHubspotAhead(zuperStatus, hubspotStatus, deal?, job?)` (326)
- `zuperDateToLocal(dateStr)` (362), `hubspotDateToLocal(dateStr)` (378)
- `compareDates(zuperDate, hubspotDate)` (387), `dateDiffDays(zuperDate, hubspotDate)` (404)
- `markSupersededJobs(jobs)` (514) — dedup helper

Plus three new exports:

- `toMappingCategory(category): "site_survey" | "construction" | "inspection"` — normalize sub-types to top-level mapping keys
- `evaluateJobDrift(job, deal): DriftType[]` — pure function returning the set of drift types that fire for a given job+deal pair. Single source of truth for the cron + backfill.
- `EXPECTED_HS_STATUS_FOR_FAIL_DISAGREEMENT` set — explicit list of HS statuses that count as "Passed" for inspection fail/pass disagreement check

The existing admin comparison API re-imports these from the new lib —
**zero behavior change** in the admin path. The 1,292-line file shrinks
by ~150 lines as shared logic moves out.

### 2. Prisma model `ZuperStatusDrift`

```prisma
model ZuperStatusDrift {
  id                  String              @id @default(cuid())
  zuperJobUid         String              @unique  // one row per Zuper job
  hubspotDealId       String?
  projectNumber       String?
  dealName            String?
  pbLocation          String?
  category            String              // canonical: site_survey | construction | solar_install | battery_install | ev_install | inspection
  zuperJobTitle       String?
  zuperStatus         String              // job's current_job_status at detection
  hubspotStatus       String?             // deal's stage at detection (the right HS property per category)
  driftTypes          ZuperDriftType[]    // STATUS, FAIL_DISAGREEMENT, COMPLETION_DATE, INSPECTION_PASS_DATE, INSPECTION_FAIL_DATE
  zuperCompletedAt    DateTime?           // ZuperJobCache.completedDate at detection
  hubspotCompletionAt DateTime?           // construction_complete_date OR inspections_completion_date, per category
  zuperFailedAt       DateTime?           // populated for inspection FAILED jobs (same value as zuperCompletedAt; kept for display clarity)
  hubspotFailAt       DateTime?           // inspections_fail_date at detection
  detectedAt          DateTime            @default(now())
  status              ZuperDriftStatus    @default(OPEN)  // OPEN | RESOLVED | IGNORED
  resolvedAt          DateTime?
  resolvedBy          String?             // user email OR system marker ("system:healed", "system:superseded")
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

Mirrors `DaStatusDrift` shape. Migration is additive (new tables/enums
only) — safe to apply in advance of code rollout per the
`migration_ordering`/`prisma_migration_before_code` memory rules.

### 3. Cron `GET /api/cron/zuper-status-reconcile`

- Auth: `Bearer ${CRON_SECRET}` (matches other crons).
- Feature flag: `ZUPER_RECONCILE_ENABLED=true` short-circuits when false.
- Public route: added to `PUBLIC_API_ROUTES` in `src/middleware.ts`
  (CRON_SECRET-validated in handler, not session-authed). Note the
  middleware comment style matches the existing pattern.
- Schedule: `*/15 * * * *` in `vercel.json` `crons` array.
- `export const maxDuration = 60;`.

**HubSpot properties read per deal** (authoritative list, verified against
`src/app/api/zuper/status-comparison/route.ts:661-691`):

| Property | Used for |
|---|---|
| `site_survey_status` | survey STATUS check |
| `install_status` | construction (all sub-types) STATUS check |
| `final_inspection_status` | inspection STATUS + FAIL_DISAGREEMENT check |
| `construction_complete_date` | construction COMPLETION_DATE check |
| `inspections_completion_date` | INSPECTION_PASS_DATE check |
| `inspections_fail_date` | INSPECTION_FAIL_DATE check |
| `dealname`, `pb_location`, `pb_project_number` | display |

**Flow per tick:**

1. Read jobs from `ZuperJobCache` modified in the last 90 days
   (configurable). No live Zuper API calls from the cron path.
2. Filter by `jobCategory` to scope to the three categories (using
   `CONSTRUCTION_CATEGORY_NAMES` for the construction filter so the
   feature flag is honored automatically).
3. Group by `(hubspotDealId, normalizedCategory)`. Apply
   `markSupersededJobs()` to skip older jobs whose category has a newer
   sibling for the same deal.
4. For each surviving job: extract dealId via `extractHubspotDealId()`
   (already used by zuper-sync). Skip if no deal linkage (errors[]).
5. Batch-fetch the seven HubSpot deal properties listed above (chunks
   of 100 deal IDs per `crm.deals.batchApi.read`).
6. Call `evaluateJobDrift(job, deal)` → `ZuperDriftType[]`.
7. If empty (in sync): auto-resolve any existing OPEN drift row for
   this `zuperJobUid` with `resolvedBy: "system:healed"`,
   `resolveNote: "Zuper and HubSpot now match"`. Skip.
8. If non-empty: upsert drift row keyed on `zuperJobUid`. On update,
   refresh all fields and re-open the row (a previously
   resolved-but-now-drifting row resurfaces — mirrors DA drift).

Returns JSON summary: `scanned`, `evaluated`, `superseded`, `matched`,
`drifted`, `autoHealed`, `newDriftIds`, `errors`.

### 4. Dashboard + API

**`/api/zuper-drift/route.ts`** (mirrors `/api/da-drift/route.ts`):
- `GET ?status=open|resolved|ignored|all` → list of rows (most recent
  detection first, limit 200)
- `POST {id, action: 'resolve'|'ignore'|'reopen', note?}` → state change
- `ALLOWED_ROLES = ["ADMIN", "EXECUTIVE", "PROJECT_MANAGER"]` const at
  top of file (consistent with DA drift v2 — note: DA drift uses
  `["ADMIN", "OWNER", "EXECUTIVE", "PROJECT_MANAGER"]` — same intent;
  match that list verbatim for consistency, OWNER is legacy)

**`/dashboards/zuper-drift/page.tsx`** (mirrors `/dashboards/da-drift/page.tsx`):
- Same filter chips (Open / Resolved / Ignored / All) with counts
- Table columns: Detected at · Project # / Deal name (links to deal in
  HubSpot) · Category badge (color-coded per sub-type: Survey=blue,
  Construction-general=orange, Solar=yellow, Battery=green, EV=cyan,
  Inspection=purple) · Drift type chips · Zuper status · HubSpot status
  · Date diff (if a date drift) · Action buttons
- Action column: Resolve / Ignore / Reopen + external links to HubSpot
  deal and Zuper job (`getZuperJobUrl(jobUid)` exists in the admin page,
  extract to lib)
- Uses `DashboardShell` with `accentColor="cyan"` (DA drift is orange;
  differentiate)
- Server-side role gate via session, same shape as DA drift page

**Suite card** on `/suites/project-management/page.tsx`, "Reviews"
section, immediately after the DA Status Drift card:

```ts
{
  href: "/dashboards/zuper-drift",
  title: "Zuper Status Drift",
  description: "Zuper jobs whose status, completion date, or inspection result doesn't match HubSpot — backup for the native HubSpot↔Zuper sync.",
  tag: "REVIEW",
  icon: "🔁",
  section: "Reviews",
}
```

**Page directory** entry in `src/lib/page-directory.ts`:
`"/dashboards/zuper-drift"` in alphabetical position.

**DashboardShell parent-suite map** in `src/components/DashboardShell.tsx`:
`"/dashboards/zuper-drift": { href: "/suites/project-management", label: "Project Management" }`.

**Role allowlist** — per the `api_route_role_allowlist` and
`suite_card_implies_route` memory rules, add to
`PROJECT_MANAGER.allowedRoutes` in `src/lib/roles.ts`:
- `"/dashboards/zuper-drift"`
- `"/api/zuper-drift"`

ADMIN/EXECUTIVE already covered by wildcard. The cron route is in
`PUBLIC_API_ROUTES` in middleware, no allowlist entry needed.

## Data flow

```
ZuperJobCache (kept fresh by existing sync paths)
    │
    │  every 15 min
    ▼
GET /api/cron/zuper-status-reconcile
    │  1. Read cache rows for last 90 days, three categories
    │     (CONSTRUCTION_CATEGORY_NAMES honored)
    │  2. Group by (dealId, normalizedCategory) + markSupersededJobs
    │  3. Batch-fetch 7 HubSpot deal properties (chunks of 100)
    │  4. evaluateJobDrift(job, deal) → ZuperDriftType[]
    │  5. Upsert ZuperStatusDrift, auto-heal stale rows
    ▼
ZuperStatusDrift (Postgres)
    │
    │  PM clicks /dashboards/zuper-drift
    ▼
PM resolves / ignores / clicks through to HubSpot or Zuper to fix
```

## Error handling

- HubSpot fetch failures per batch: captured in `errors[]`, jobs in that
  batch skipped this tick. Next tick retries.
- ZuperJobCache empty (sync hasn't run yet): cron returns
  `{status: 'ok', scanned: 0}` quickly.
- Cron timeout (60s): processed jobs are committed; remaining jobs
  picked up next tick. Idempotent on `zuperJobUid`.
- Missing HubSpot deal (job has dealId but deal doesn't exist): logged
  to errors[], no drift row created (not a drift case — it's a data
  quality issue separate from this feature).

## Testing

1. **Unit test `evaluateJobDrift(job, deal)`** with table-driven cases for
   each `ZuperDriftType` × `category` combination. This is the core
   decision function and benefits most from coverage.
2. **Unit test `toMappingCategory()`** — trivial, but a regression here
   would silently break all sub-type evaluations.
3. **Unit test `markSupersededJobs()`** extracted helper — already
   battle-tested in production via the admin page, but the extraction
   could subtly break it.
4. **Backfill script as integration test**: run against prod with
   `WIPE=1`, verify row count is finite and rows look plausible.

## Rollout plan

1. **Migration ships first** (additive, safe to apply early — per memory
   rule `prisma_migration_before_code`):
   - `npx prisma migrate dev --name add-zuper-status-drift` locally
   - Apply to prod via `scripts/migrate-prod.sh` BEFORE the code PR
     merges
2. **Ship PR with flag off** (`ZUPER_RECONCILE_ENABLED` env var unset,
   cron route returns `{status: 'disabled'}`).
3. **Run one-off backfill** against prod:
   `LOOKBACK_DAYS=90 WIPE=1 npx tsx scripts/backfill-zuper-drift.ts`
   to seed the table and validate the drift count is sane.
4. **Set `ZUPER_RECONCILE_ENABLED=true`** in Vercel prod env (via
   `printf '%s' "true" | vercel env add ZUPER_RECONCILE_ENABLED production`,
   per memory rule `vercel_env_no_echo`).
5. **Pull a prod tick log** after 15 min to confirm the cron is working.
6. **Watch for ~24 hours**, then declare GA and add card to PM suite.

Rollback: flip env var to `false` and the cron short-circuits. Existing
rows stay. Suite card can be hidden by removing it from
project-management/page.tsx if needed.

## Open questions

None. All domain questions answered upfront:
- Categories: all three including construction sub-categories ✓
- Drift conditions: A (status) + B (fail/pass disagreement) + C dates
  (completion, pass, fail) — NOT schedule dates ✓
- Audience: PROJECT_MANAGER + admin tiers ✓
- Auto-resolve on heal: yes (mirrors DA drift) ✓
- Flag-only, no auto-fix: yes (mirrors DA drift) ✓
