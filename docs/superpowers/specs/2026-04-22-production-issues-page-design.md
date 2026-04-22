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

- **Role visibility:** Matches D&E Suite visibility in `src/lib/suite-nav.ts` — ADMIN, OWNER, PROJECT_MANAGER, TECH_OPS, DESIGN.
- **Route:** `/dashboards/production-issues`
- **Suite card placement:** D&E Suite page, `Analytics` section, immediately below the Clipping Analytics card.

Per repo convention (memory: "new API routes need role allowlist" and "suite card implies route allowlist"), the route must be added to the `allowedRoutes` list in `src/lib/roles.ts` for every role that sees the D&E Suite card. Otherwise middleware returns 403 silently.

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

**Caveat:** `RawProject.id` is typed `string` but arrives as `number` at runtime — use `String(p.id)` when constructing hrefs and keys (memory: "Project.id is a number, not a string").

## Page layout

Wraps content in `<DashboardShell title="Production Issues" accentColor="red" lastUpdated={lastUpdated} exportData={{ data: rows, filename: "production-issues.csv" }}>`.

### 1. Hero strip — `MiniStat` row

Four stats, left to right:

- **Total flagged** — count of currently-flagged projects in the filtered view.
- **% of PTO'd projects** — flagged / total PTO'd projects in the dataset. Uses the existing PTO stage detection (same stage normalization as forecast system).
- **Median months since close** — median `(now - closeDate)` across flagged projects, in whole months. Uses `closeDate` only (no PTO date required).
- **Oldest flag** — project with the greatest `now - closeDate` among flagged projects. Shown as "N months — [Project Name]" with a link to the deal.

### 2. Breakdown grid — 5 cards, `stagger-grid` animation

Each card: title + small horizontal bar chart + count legend. All counts are computed from the current filtered view (filters from section 3 apply).

1. **By Location** — DTC / Westminster / COSP / California / Camarillo (derived from `pbLocation`). Colors match existing location color convention from Clipping Analytics.
2. **By Current Stage** — grouped to a coarse bucket: `service`, `active`, `pto`, `other`. Mapping lives in a small helper (`lib/production-issues-stage.ts`) that reuses existing stage-normalization patterns from `lib/forecasting.ts` where possible.
3. **By Clipping Risk** — high / moderate / low / none. Reuses `analyzeClipping()` from `lib/clipping.ts`. Projects without equipment data (null analysis) go into a separate "unknown" bar.
4. **By Deal Owner** — top 10 owners by flagged count, `dealOwner` string. "Unassigned" bucket when empty.
5. **By Equipment** — tabbed component: `Inverter | Module | Battery`. Each tab shows top 10 brand+model combinations among flagged projects. Battery tab includes a "no battery" bar for projects without batteries.

All five cards use existing `MetricCard` / simple `<div>` primitives — no new chart library. Bars are plain divs with width percentages styled via Tailwind (same approach as existing small in-card charts in the codebase).

### 3. Flagged Projects table

Below the breakdown grid. Columns, in order:

1. Project name → link to `/dashboards/project/${id}` (or equivalent existing deal detail route — verify during implementation)
2. Address
3. Location
4. Stage
5. Deal owner
6. Inverter (brand + model, or "—")
7. Module (brand + model, or "—")
8. Battery (brand + model, or "—" / "No battery")
9. Clipping risk (badge, colors from existing `RISK_COLORS` in Clipping Analytics)
10. Close date (formatted)
11. Link icon → HubSpot deal URL

Sortable via column headers. Filterable above the table via `MultiSelectFilter`:

- Location
- Stage (coarse bucket)
- Deal owner
- Clipping risk

Row count badge shown above the table: "Showing N of M flagged." Clear-filters button when any filter is active (match Clipping Analytics' pattern).

CSV export via `DashboardShell`'s `exportData` prop — full visible (filtered) rowset with all columns. Filename: `production-issues-YYYY-MM-DD.csv`.

### Empty state

When no projects match (either no flagged projects at all, or filters eliminate everything): centered empty-state component with icon, "No flagged projects match the current filters," and a "Clear filters" button if filters are active.

## Files changed

**New:**
- `src/app/dashboards/production-issues/page.tsx` — the page itself (client component, ~300 lines).
- `src/lib/production-issues-stage.ts` — coarse stage bucketing helper (~30 lines + small test).
- `src/__tests__/production-issues-stage.test.ts` — unit test for the bucketing helper.

**Modified:**
- `src/app/suites/design-engineering/page.tsx` — add `SuitePageCard` entry under `Analytics` section.
- `src/lib/roles.ts` — add `/dashboards/production-issues` to `allowedRoutes` for ADMIN, OWNER, PROJECT_MANAGER, TECH_OPS, DESIGN. Also add to any shared allowlist base if one exists.
- `src/lib/page-directory.ts` — add the new route if that file enumerates pages (verify during implementation).
- `src/stores/dashboard-filters.ts` — add a `useProductionIssuesFilters` hook following the existing persistence pattern used by `useClippingAnalyticsFilters`.

**No DB changes, no migrations, no new API routes, no env vars.**

## Analytics & activity tracking

Reuse `useActivityTracking` → `trackDashboardView("production-issues", { flaggedCount })` on first render, mirroring Clipping Analytics.

## Testing

- **Unit test:** the stage-bucketing helper — covers service pipeline stage names, project pipeline stage names, PTO'd projects, unknown stages.
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
