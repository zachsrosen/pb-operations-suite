# Production Issues Page — Design Suite

**Date:** 2026-04-22
**Author:** Zach Rosen (via Claude)
**Status:** Draft for review

## Problem

Design team members flag projects with suspected production issues via a "Flag for Review" toggle on the Clipping Analytics dashboard ([src/app/dashboards/clipping-analytics/page.tsx:84](src/app/dashboards/clipping-analytics/page.tsx:84)). The flag writes to the HubSpot deal property `system_performance_review` and surfaces as `RawProject.systemPerformanceReview: boolean`.

Today there is no consolidated view of every currently-flagged project. Clipping Analytics mixes flagged rows into a broader clipping-risk table, and a "Flagged Projects by Month" bar chart shows close-date cohorts — but there is no list-first surface that answers "which projects are currently flagged, and what patterns do they share?"

The design team wants a dedicated page in the D&E Suite that answers that question and helps spot patterns (bad equipment batches, specific locations, specific owners).

## Goals

- List every project currently flagged (`system_performance_review = true`) with relevant context per row.
- Surface grouping counts across five dimensions (location, stage, clipping risk, deal owner, equipment) so patterns are visible at a glance.
- Reuse existing data (no new API, no schema changes) to keep scope tight.
- Leave room to evolve the page into a workqueue later (notes, assignee, resolution status) without architectural rework.

## Non-goals (for this spec)

- **No write actions on this page.** Flagging / unflagging stays on Clipping Analytics. A user who wants to change the flag clicks through to the deal or to Clipping Analytics. This prevents action duplication and a "two sources of truth" confusion while the workqueue features are still TBD.
- **No workqueue features yet.** No notes, no assignee, no status, no resolution tracking.
- **No new automated production-issue detection.** The flag remains a manual signal set by the design team. Automated detection (e.g., from monitoring data) is out of scope.
- **No changes to Clipping Analytics.** The existing page stays exactly as it is.

## Audience & access

- **Route:** `/dashboards/production-issues`
- **Suite card placement:** D&E Suite page, `Analytics` section, immediately below the Clipping Analytics card.
- **Role allowlist — match Clipping Analytics exactly.** The new page is a peer to Clipping Analytics and should appear to the same roles. Grepping `src/lib/roles.ts` for `/dashboards/clipping-analytics` shows four roles with an explicit entry:
  - `PROJECT_MANAGER` (line ~328)
  - `TECH_OPS` (line ~612)
  - `DESIGN` (line ~704)
  - `INTELLIGENCE` (line ~901)

  Add `/dashboards/production-issues` to each of those `allowedRoutes` arrays, placed adjacent to the existing `/dashboards/clipping-analytics` entry to keep them visually grouped. `ADMIN` and `EXECUTIVE` have `allowedRoutes: ["*"]` and need no change.

Per repo convention (memory: "new API routes need role allowlist" and "suite card implies route allowlist"), skipping this step causes middleware to return 403 silently.

## Data source

Single client-side data source: `useProjectData<RawProject[]>({ params: { context: "executive" }, transform: ... })` — the same hook Clipping Analytics uses ([src/app/dashboards/clipping-analytics/page.tsx:32](src/app/dashboards/clipping-analytics/page.tsx:32)).

Server endpoint (`/api/projects` with `context=executive`) already returns every field needed:

| Field | Source |
|-------|--------|
| `systemPerformanceReview` | HubSpot `system_performance_review` (bool) |
| `pbLocation` | HubSpot `pb_location` |
| `stage` | HubSpot `dealstage` (mapped) |
| `dealOwner` | HubSpot `hubspot_owner_id` (resolved to name via owner map) |
| Equipment (inverter / module / battery brand & model) | HubSpot equipment properties already used by `analyzeClipping` |
| `closeDate` | HubSpot `closedate` |
| `address`, `projectName`, `id` | existing RawProject fields |

The page filters the full project list to `p.systemPerformanceReview === true` on the client. No new server route, no new Prisma model.

### Type caveats (read before implementing)

- **`RawProject.id` is typed `string` but arrives as `number` at runtime** — use `String(p.id)` when constructing hrefs and keys (memory: "Project.id is a number, not a string").
- **`RawProject.equipment` in `src/lib/types.ts` is narrower than the runtime shape.** The `modules`/`inverter`/etc. declarations currently only include `{ count?: number }`. The real runtime shape — including `brand`, `model`, `wattage`, `sizeKwac` — is declared as `FullEquipment` in `src/lib/clipping.ts:9-15` and is what `analyzeClipping()` and `forecast-ghosts.ts` actually consume. **Implementation must widen `RawProject['equipment']` in `src/lib/types.ts`** to include brand/model at minimum (either by importing `FullEquipment` or adding the fields inline). Without this, the Equipment breakdown card and inverter/module/battery table columns won't typecheck or will silently read `undefined`. Do this as a focused change in the types file — no broader refactor.

## Page layout

Wraps content in `<DashboardShell title="Production Issues" accentColor="red" lastUpdated={lastUpdated} exportData={{ data: rows, filename: "production-issues.csv" }}>`.

### 1. Hero strip — `MiniStat` row

Four stats, left to right. **All hero stats respect the currently applied filters** (section 3). When filters are cleared the values reflect the full flagged set.

- **Total flagged** — count of currently-flagged projects in the filtered view.
- **% of PTO'd projects** — `(flagged projects in filtered view) / (total PTO'd projects in the full dataset)`. Numerator respects filters; denominator is always the full dataset PTO'd count — this is deliberate so the denominator doesn't shrink when a user filters by location, which would mislead. The metric answers "what fraction of our PTO'd fleet is currently flagged (in this slice)?"
- **Median months since close** — median `floor((now - closeDate) / 30 days)` across flagged projects in the filtered view. Projects missing `closeDate` are **excluded from the median calculation** (not treated as zero). If every flagged project in view is missing a close date, show "—".
- **Oldest flag** — project with the greatest `now - closeDate` among flagged projects in the filtered view. Shown as "N months — [Project Name]" with a link to the HubSpot deal URL. When no project has a close date, show "—".

### 2. Breakdown grid — 5 cards, `stagger-grid` animation

Each card: title + small horizontal bar chart + count legend. All counts are computed from the current filtered view (filters from section 3 apply).

1. **By Location** — DTC / Westminster / COSP / California / Camarillo (derived from `pbLocation`). Colors match existing location color convention from Clipping Analytics.
2. **By Current Stage** — grouped to a coarse bucket: `service`, `active`, `pto`, `other`. The existing stage-normalization helper lives at `src/lib/forecast-ghosts.ts:94` exported as `mapStage(stageRaw)` and returns fine-grained buckets (`survey`, `rtb`, `design`, `permitting`, `construction`, `inspection`, etc.). The new `src/lib/production-issues-stage.ts` helper imports `mapStage` and maps its output plus any PTO/service stage strings into the four coarse buckets. Unknown stages fall through to `other`, which is visible (not silent) on the chart.
3. **By Clipping Risk** — high / moderate / low / none. Reuses `analyzeClipping()` from `lib/clipping.ts`. Projects without equipment data (null analysis) go into a separate "unknown" bar.
4. **By Deal Owner** — top 10 owners by flagged count, `dealOwner` string. "Unassigned" bucket when empty.
5. **By Equipment** — tabbed component: `Inverter | Module | Battery`. Each tab shows top 10 brand+model combinations among flagged projects. Battery tab includes a "no battery" bar for projects without batteries.

All five cards use existing `MetricCard` / simple `<div>` primitives — no new chart library. Bars are plain divs with width percentages styled via Tailwind (same approach as existing small in-card charts in the codebase).

### 3. Flagged Projects table

Below the breakdown grid. Columns, in order:

1. **Project name** — rendered as an `<a>` to `RawProject.url` (HubSpot deal URL, `target="_blank"`). This matches how Clipping Analytics links rows today ([src/app/dashboards/clipping-analytics/page.tsx:311](src/app/dashboards/clipping-analytics/page.tsx:311)). No separate link column — the project name is the link.
2. **Address** — plain text.
3. **Location** — `pbLocation`, rendered with the same chip/badge convention used on Clipping Analytics.
4. **Stage** — raw `stage` string (not the coarse bucket — users want the precise HubSpot stage here).
5. **Deal owner** — `dealOwner` string, or "Unassigned" when empty.
6. **Inverter** — `${brand} ${model}` or "—" when missing.
7. **Module** — `${brand} ${model}` or "—" when missing.
8. **Battery** — `${brand} ${model}` when present; explicit **"No battery"** when the equipment payload declares zero batteries (`battery.count === 0` or equivalent); **"—"** only when battery data is genuinely missing/unknown. The distinction matters for pattern-spotting.
9. **Clipping risk** — badge, colors from existing `RISK_COLORS` in Clipping Analytics. "unknown" badge when `analyzeClipping` returns null.
10. **Close date** — formatted `MMM D, YYYY` (match existing date formatting helpers in the codebase — verify during implementation). Projects with no `closeDate` show "—".

Sortable via column headers. Filterable above the table via `MultiSelectFilter`:

- Location
- Stage (coarse bucket)
- Deal owner
- Clipping risk

Row count badge shown above the table: "Showing N of M flagged." Clear-filters button when any filter is active (match Clipping Analytics' pattern).

CSV export via `DashboardShell`'s `exportData` prop — full visible (filtered) rowset with all columns. Filename: `production-issues.csv` (plain filename; `DashboardShell` is the single source of truth for CSV filename formatting — whatever it passes through is what we use). Do **not** construct a custom dated filename inside the page.

### Empty state

Two distinct copies:

- **No flagged projects at all** (dataset loaded, `systemPerformanceReview === true` count is 0): "No projects are currently flagged for production review. Projects are flagged from the Clipping Analytics page."
- **Filters eliminate everything** (flagged count > 0 but filtered view is 0): "No flagged projects match the current filters." Include a "Clear filters" button.

Both use a centered empty-state layout with an icon, matching existing empty-state conventions in the app.

## Files changed

**New:**
- `src/app/dashboards/production-issues/page.tsx` — the page itself (client component, ~300 lines).
- `src/lib/production-issues-aggregations.ts` — pure aggregation helpers: `bucketStage(stageRaw)`, `topByKey(projects, keyFn, limit)` used by all five breakdown cards. Kept pure so they're unit-testable in isolation.
- `src/__tests__/production-issues-aggregations.test.ts` — unit tests for stage bucketing (service, active, PTO, unknown) and top-N grouping (ties, missing keys, limit enforcement).

**Modified:**
- `src/app/suites/design-engineering/page.tsx` — add `SuitePageCard` entry under `Analytics` section.
- `src/lib/roles.ts` — add `/dashboards/production-issues` to `allowedRoutes` for `PROJECT_MANAGER`, `TECH_OPS`, `DESIGN`, `INTELLIGENCE` (the four roles with explicit Clipping Analytics entries). `ADMIN` and `EXECUTIVE` inherit via `["*"]`. Place the new entry adjacent to the existing `clipping-analytics` entry inside each role block.
- `src/lib/page-directory.ts` — **required.** Add a `PageMeta` entry for `/dashboards/production-issues` following the pattern used for Clipping Analytics. Omitting this breaks page enumeration features (global search, page-directory landing content).
- `src/lib/types.ts` — widen `RawProject['equipment']` `modules`/`inverter`/`battery` fields to include `brand?: string`, `model?: string`, `wattage?: number`, `sizeKwac?: number` (subset of `FullEquipment` in `src/lib/clipping.ts`). See "Type caveats" above.
- `src/stores/dashboard-filters.ts` — add a `useProductionIssuesFilters` hook following the existing persistence pattern used by `useClippingAnalyticsFilters` ([src/stores/dashboard-filters.ts:284](src/stores/dashboard-filters.ts:284)). Fields: `locations`, `stages`, `dealOwners`, `clippingRisks` (all `string[]`).

**No DB changes, no migrations, no new API routes, no env vars.**

## Analytics & activity tracking

Reuse `useActivityTracking` → `trackDashboardView("production-issues", { flaggedCount })` on first render. The event-name convention matches Clipping Analytics' `trackDashboardView("clipping-analytics", ...)` — kebab-case dashboard slug with a context payload of current counts. Verify during implementation that no existing `ActivityType` enum change is required (`ActivityLog.action` is free-form; `trackDashboardView` is a wrapper, not an enum add).

## Testing

- **Unit tests** (`src/__tests__/production-issues-aggregations.test.ts`):
  - `bucketStage`: service pipeline names → `service`, project pipeline names → `active`, PTO'd stage strings → `pto`, unknown strings → `other`, empty/null → `other`.
  - `topByKey`: ties broken by natural sort order, missing keys collapse into a single "Unassigned" bucket, limit parameter caps output length.
- **Manual QA checklist** (verified before merging):
  1. Page renders for ADMIN; 403 redirects for VIEWER / SALES (role gating works).
  2. Hero stats match Clipping Analytics' "Flagged Projects by Month" totals for the same dataset.
  3. All five breakdown cards render with non-empty data; clipping-risk card shows "unknown" bar when equipment is missing.
  4. Each filter narrows both the table and the breakdown cards (filters cascade into the aggregation memos).
  5. Clear-filters resets both filter state and breakdowns.
  6. CSV export produces a file with all visible columns, filter-respecting.
  7. Deep link to deal detail works and `String(id)` is applied.
  8. Theme tokens used throughout (no raw `bg-zinc-*` except intentional status colors); dark mode and light mode both render correctly.
  9. Suite card visible on D&E Suite for DESIGN role; not visible for ROOFING.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Confusion with Clipping Analytics — two pages that both show flagged projects | The breakdown grid is deliberately list-of-flagged-only; Clipping Analytics remains the only place to toggle the flag. We add a small inline "Flag is set from the Clipping Analytics page" note at the top of the table to prevent user frustration looking for an action. |
| Performance on large datasets (if flagged set grows) | Same dataset as Clipping Analytics, which already filters thousands of projects client-side. Flagged subset will always be smaller. No server-side pagination needed. |
| Coarse stage mapping drifts from `forecasting.ts` mapping | The bucketing helper reuses `forecasting.ts` exports where they exist, and is covered by a unit test. Any stage-name drift surfaces as "other" — visible, not silent. |
| Future "workqueue" scope (option B) creeps in during implementation | Spec explicitly marks it non-goal. Any per-row action request during implementation gets deferred to a follow-up spec. |

## Future work (explicitly not in this spec)

- **Toggle inline:** add unflag-from-this-page with a confirmation, and an audit trail of who unflagged when.
- **Notes & assignees:** new `ProductionIssueNote` Prisma model, per-project note thread, owner assignment, resolution status (open / investigating / resolved).
- **Automated detection:** integrate with monitoring data (e.g., underproduction vs. guarantee) to auto-suggest flags. Would add a "suggested / manually flagged" split in the table.
- **Cross-linking with Service Suite:** if a flagged project has an open service ticket, show a link. Requires an additional lookup against `service-tickets` data.

These are noted for roadmap visibility and should not influence current implementation.
