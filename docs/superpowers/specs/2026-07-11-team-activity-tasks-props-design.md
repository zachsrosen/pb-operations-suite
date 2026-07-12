# Team Activity: Tasks/day + Property Updates/day — Design

**Date**: 2026-07-11
**Status**: Approved (Zach, 2026-07-11)
**Builds on**: deals-touched (#1399), PTO (#1392), report card (#1405), integration filter (#1409) — all merged.

## Definitions

- **Tasks completed/day**: HubSpot tasks owned by the person whose
  `hs_task_completion_date` falls in the window (verified live: searchable,
  ms-precision, present exactly on `hs_task_status=COMPLETED`). Bucketed by
  completion time (real activity time — NOT the due-date `hs_timestamp`,
  which is workflow noise). Count of completions, not distinct-deduped: each
  completed task counts once because a task completes once.
- **Property updates/day**: count of the person's audit-log rows with
  `category/action = PROPERTY_VALUE/UPDATE` (already pulled; each edit also
  emits a `CRM_OBJECT/UPDATE` twin row, which is NOT counted — that would
  double-count). Covers all CRM object types, not just deals.

## Changes

### Adapter (`src/lib/team-activity/adapters.ts`, hubspotAdapter)

- New search per owner-chunk on `tasks` with filters `hubspot_owner_id IN
  chunk` + `hs_task_completion_date BETWEEN range` (epoch-ms strings, same
  shape as the engagement search; same 9,800 cap + capped warning path,
  reusing `searchEngagements`'s machinery via a `timestampProperty` parameter
  rather than a copy). Each hit emits ONE event: `source: "hubspot"`,
  `kind: "task_completed"`, `timestamp` = completion date, `objectKey:
  "TASK:<id>"` (dedups against that task's audit rows in interactionCount).
  No `deals` field (deal attribution stays with the existing due-date task
  engagement pull). These events are real-activity-timestamped, so they
  participate in span/active-hours normally (unlike `engagement/tasks`).
- Failure of the completion search degrades into the existing per-type
  warning path (floor values), not a run failure.

### Metrics (`src/lib/team-activity/metrics.ts`, pure)

- `PersonDayMetric` gains `tasksCompleted` (count of hubspot events with
  `kind === "task_completed"`) and `propertyUpdates` (count of hubspot events
  with `kind === "PROPERTY_VALUE/UPDATE"`).
- `PersonSummary` gains `avgTasksCompleted` and `avgPropertyUpdates`
  (weekday averages, consistent with the others).

### Dashboard (`TeamActivityClient.tsx`)

- Main table: `Tasks/day` and `Props/day` columns after `Deals/day`
  (11 → 13 columns; right-align bound 9 → 11; both `colSpan={11}` → 13).
- Per-day detail: `Tasks` and `Props` columns after `Deals`
  (10 → 12 columns; right-align bound 8 → 10; drill `colSpan={10}` → 12).
- CSV export gains `avgTasksCompleted`, `avgPropertyUpdates`.
- Footnote: one sentence defining both (completed-task timing; property
  updates = field changes on any record).

### CLI (`scripts/team-activity-report.ts`)

- Daily CSV: `tasksCompleted`, `propertyUpdates` after `dealsTouchedAll`.
- Summary CSV: `avgTasksCompleted`, `avgPropertyUpdates` after
  `avgDealsTouched`. Console table: `Tasks/d` + `Props/d` after `Deals/d`.

### Report card (`report-card.ts` + tests)

Per-person line becomes:

```
<Name>: <N> deals/day (<delta>), <T> tasks/day, <P> property updates/day, <H>h active/day, <PTO note>
```

Deltas remain on deals/day only (one trend signal per line). Zero values
render as `0 tasks/day` / `0 property updates/day` (consistent width beats
conditional omission). Roster-only lines (full-period PTO / no activity)
unchanged. Metric-definition note gains: "Tasks/day counts tasks completed
that day; property updates counts field changes on any HubSpot record."

## Testing

- Metrics: counts for both kinds (twin `CRM_OBJECT/UPDATE` rows ignored;
  non-hubspot sources ignored); weekday averages.
- Report card: updated line template across existing fixtures; zero-value
  rendering.
- Live: CLI run over the last 14 days; spot-check one person's
  tasksCompleted against a direct `hs_task_completion_date` search count and
  propertyUpdates against their audit-log PROPERTY_VALUE/UPDATE count.

## Out of scope

Tasks-due metric; deltas on the new numbers; distinct-object property-update
counting; drilldown changes (task_completed events render via the generic
event list already).
