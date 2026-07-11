# Team Activity: Deals-Touched Metric — Design

**Date**: 2026-07-10
**Status**: Approved (Zach, 2026-07-10)
**Origin**: Tracey asked how many deals the PMs touch each day. An ad-hoc HubSpot
analysis (engagements + audit-log edits → distinct deals per person per day)
answered it once; this feature makes it a standing metric on the team-activity
dashboard.

## Problem

The team-activity dashboard (`/dashboards/admin/team-activity`) measures *how
much* someone works (active hours, interactions) but not *how many deals* their
work spans. "Distinct deals touched per day" is the number leadership asked
for, and it needs the same repeatability as the rest of the dashboard.

## Definitions

**A deal touch** is either:
1. An **engagement** (note, call, email, meeting, task, communication) owned by
   the person (`hubspot_owner_id`) with `hs_timestamp` in the window, associated
   to the deal — directly, or recovered via the engagement's contact when the
   engagement has no direct deal association (email→contact→contact's deals).
2. A **record edit** from the HubSpot audit log (`subCategory=DEAL`,
   `actingUserId` = the person) — property updates, association changes.

**Deals touched (headline)** = distinct deals per Denver-local day where the
deal was **active at touch time with a 3-day grace period**: the deal's current
stage is not terminal, OR the touch happened less than 3 days after the deal
entered its terminal stage (`hs_v2_date_entered_<stageId>`).

**Terminal stages** are matched by label (case-insensitive): `Cancelled`,
`On-Hold`/`On-hold`, `Project Complete`, `Complete`, `Completed`, `Closed lost`,
`Closed won` (a Sales-pipeline deal that closed won either graduates to the
Project Pipeline or is done). Deals in the `Test Pipeline` never count. Stage
`metadata.isClosed` is *not* usable — every post-sale pipeline stage in PB's
portal has `isClosed=true`.

**Deals touched (all)** = same distinct count with no stage/age exclusions
(surfaced in the per-day detail, not the headline).

Both counts consider **only hubspot-source events**. The Zuper and PE adapters
also emit `DEAL:<id>` objectKeys; those represent field/document activity, not
the person working the deal in HubSpot, and are excluded from both counts (they
continue to feed the existing interaction/per-source metrics unchanged).

Validated against the 2026-07-10 ad-hoc run: PMs ≈ 12–40 active deals/day each;
~90% of orphaned PM emails are notification noise (noreply@notifications.hubspot.com,
documents@system.photonbrothers.com) whose contacts have no deals, so the
via-contact hop drops them naturally.

## Architecture

All changes ride the existing 3-layer pipeline (adapters → pure metrics →
UI/CLI). No new tables, no cron, no schema change.

### 1. Adapter (`src/lib/team-activity/adapters.ts` — `hubspotAdapter`)

Today it pulls per-member audit logs + login history. Add:

**a. Owner resolution.** Resolve each roster member's HubSpot **owner id**
(engagements filter on `hubspot_owner_id`, which is NOT the user id the audit
log uses) via `GET /crm/v3/owners?email=` per member, with the same
alias-fallback used for user ids. Members without an owner simply contribute no
engagement events.

**b. Engagement pull.** For each of the 6 engagement types (`notes`, `calls`,
`emails`, `meetings`, `tasks`, `communications`): CRM search with
`hubspot_owner_id IN (owner-id chunk of ≤5)` + `hs_timestamp BETWEEN` the
range, paginated, sorted ascending. Chunking keeps each search under the API's
10k result cap; log a warning if a chunk hits the cap.

**c. Deal association.** Batch v4 association read `<type>→deals` (100/call).
For engagements with no deal, batch `<type>→contacts` then `contacts→deals` and
attribute to all of the contact's deals. Engagements that still resolve to no
deal are dropped (they are noise or non-deal work — the audit log and other
sources already capture non-deal activity).

**d. Deal-active stamping.** Collect distinct touched deal ids (from engagement
touches *and* audit `DEAL` rows). Batch-read `dealstage` + `pipeline`; fetch
pipelines once for stage labels; for terminal-stage deals batch-read
`hs_v2_date_entered_<stageId>`. Classification is a pure helper (see §2) so the
adapter only orchestrates I/O.

**e. Event emission.** Each engagement emits **one** `ActivityEvent`
(`source: "hubspot"`, `kind: "engagement/<type>"`, `label` for the drilldown),
regardless of how many deals it attributes to — so `interactions` and
`eventCount` see one real-world action, not a fan-out. Deal attribution rides a
new optional field `deals?: { id: string; active: boolean }[]` listing every
attributed deal with its active-at-touch-time verdict. `objectKey` is set to
`DEAL:<first attributed deal>` so the existing 10-minute `interactionCount`
dedup collapses an engagement with its own audit rows instead of
double-counting. Audit `DEAL` rows keep their current shape and gain the same
single-element `deals` field.

**Accepted baseline shift:** engagement events are new rows in the shared
event stream, so `interactions`, `avgEvents`, `activeHours`, and
`perSource.hubspot` will read higher for everyone than before this change.
That is real activity that was previously invisible (audit logs only), not
noise; no compensation is attempted.

### 2. Metrics (`src/lib/team-activity/metrics.ts` — pure, Jest-covered)

- `ActivityEvent` gains optional `deals?: { id: string; active: boolean }[]`
  (set only by the hubspot adapter; other adapters never populate it).
- New pure helper `isTouchOnActiveDeal(stageLabel, pipelineLabel, enteredTerminalAt, touchAt, bufferDays=3)`
  used by the adapter for stamping — lives here so the terminal-label set and
  buffer logic are unit-testable without I/O.
- `PersonDayMetric` gains `dealsTouched: number` (distinct `deals[].id` among
  that day's `source === "hubspot"` events where `active === true`) and
  `dealsTouchedAll: number` (same, regardless of `active`).
- `PersonSummary` gains `avgDealsTouched: number` (mean of `dealsTouched` over
  active weekdays, consistent with the other averages).

The counts read ONLY the `deals` field on hubspot-source events. Events without
it (all other adapters, hubspot logins, non-DEAL audit rows) never affect the
new counts, even though Zuper/PE events carry `DEAL:` objectKeys.

### 3. UI (`src/app/dashboards/admin/team-activity/TeamActivityClient.tsx`)

- Ranked table: new **Deals/day** column showing `avgDealsTouched` (rounded to
  1 decimal).
- Expandable per-day detail: `dealsTouched` per day, with `dealsTouchedAll` in
  parentheses when it differs (e.g. `14 (16)`).
- Day drilldown: engagement events appear as labeled rows (the events endpoint
  passes adapter events through generically — no endpoint change). Note the
  drilldown route re-runs the hubspot adapter for one person/day, so each click
  now also performs the engagement pull + stamping (~2–4s added; acceptable).
- CSV export: the dashboard's existing export is a single summary CSV — it
  gains an `avgDealsTouched` column. Per-day columns are NOT added to the
  dashboard export.

The CLI report (`scripts/team-activity-report.ts`) shares adapters + metrics
but hardcodes its console table and CSV header lists — it needs explicit edits:
`avgDealsTouched` in the console table + summary CSV, `dealsTouched` +
`dealsTouchedAll` in the daily CSV (and add the missing `pe` per-source column
there in passing).

### 4. Roster (`src/lib/team-activity/roster.ts`)

Add Wes Benscoter (`wes.benscoter@photonbrothers.com`) — the only
PROJECT_MANAGER-role user not already on `DEFAULT_ROSTER`. (Decision: extend
the default roster rather than add a role-picker.)

## Performance

Default roster (11 members), 14-day window, measured against the ad-hoc run:
- Engagement searches: 6 types × 3 owner-chunks ≈ 18 searches + pagination
  (~30 pages total at PM volume).
- Association reads: ~2.6k engagements → ~30 batch calls + orphan
  contact/deal hops (~20 calls).
- Deal stage + entered-date reads: ~500 deals → ~8 batch calls.

≈ 100 extra HubSpot calls per run, all through the existing 429-retry wrapper
with the current `mapPool` concurrency (5). Expected added wall time ~10–15s on
a 14-day run (current full run ~24s over 30 days). Acceptable for an on-demand
ADMIN dashboard; no caching added until it hurts.

## Error handling

- Owner-resolution failure for one member → that member has engagement count 0;
  the run proceeds (matches existing per-member audit-log behavior).
- Missing `hs_v2_date_entered_*` for a terminal-stage deal → treat touches on
  it as **not** active (conservative), count in `dealsTouchedAll`.
- Engagement search chunk hitting the 10k cap → surfaced via a new optional
  `warning?: string` on `AdapterResult` (today it only supports `skipped`);
  the API response and the dashboard source-status banner pass it through as a
  yellow "ran with warning" state. Counts for that chunk are floor values.
- Any systemic scope error keeps the existing `skipped` reporting path.

## Testing

Jest (pure layer):
- `isTouchOnActiveDeal`: active stage; terminal within buffer; terminal past
  buffer; missing entered date; Test Pipeline; label case/hyphen variants.
- `computePersonDays`: `dealsTouched` distinct-count vs `dealsTouchedAll`;
  multiple touches on one deal in a day count once; a multi-deal engagement
  counts each attributed deal once but stays one event/interaction; events
  without a `deals` field (incl. Zuper/PE `DEAL:`-keyed events) affect neither
  count.
- `rollupByPerson`: `avgDealsTouched` weekday averaging.

Verification: CLI run against live HubSpot for the default roster + Wes;
cross-check PM numbers against the 2026-07-10 ad-hoc results (expect close
match; small drift from window boundaries is fine). tsc + lint + full Jest
suite green before PR.

## Out of scope

- Role-based roster picker (revisit if the roster outgrows one list).
- Counting Zuper/field touches toward deals-touched (field roles live in
  Zuper; their HubSpot number will read near-zero — the dashboard's per-source
  breakdown already tells that story).
- Backfill/history beyond the queried window; caching layer.
