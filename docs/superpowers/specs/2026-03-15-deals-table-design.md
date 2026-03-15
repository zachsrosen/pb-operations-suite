# Deals Table Dashboard

A filterable, sortable HubSpot deals table with status columns, URL-based deep-linking from the main page, and a slide-out detail panel.

## Route

`/dashboards/deals` — client component, uses `DashboardShell` with `fullWidth={true}`.

Add `/dashboards/deals` to `SUITE_MAP` in `DashboardShell.tsx` under Operations Suite for breadcrumb navigation.

## Data Source

**Project Pipeline (`pipeline=project`):** Fetches from `/api/projects` to get the full `Project` shape including all 8 status fields, `dealOwner`, `daysSinceStageMovement`, and milestone dates. The `pipeline=project` value is a UI-only sentinel — it is never forwarded to any API. Instead, the page branches to `/api/projects` when this value is selected.

**Other pipelines (Sales, D&R, Service, Roofing):** Fetches from `/api/deals?pipeline={name}` (valid values: `sales`, `dnr`, `service`, `roofing`). Returns a slimmer deal shape that lacks status fields, `dealOwner`, `daysSinceStageMovement`, and milestone dates. When a non-project pipeline is selected:
- Status columns (SS through PTO) show gray `○` (unavailable)
- Status column header filters are disabled
- Owner/PM filter is hidden (field not available)
- "Avg days in stage" stat is hidden
- Detail panel omits Status and Dates sections; shows only Info section with available fields

Pipeline switching resets stage filter and status column filters.

**API params for `/api/projects`:** `locations` (comma-sep multi), `stage` (single value only), `search`, `sort`, `order`, `limit`

**API params for `/api/deals`:** `pipeline`, `location` (single value only), `stage`, `search`, `sort`, `order`, `limit`, `page`

Note: The `stage` param on both endpoints only supports single-value exact match. Multi-stage filtering is handled client-side (fetch all with `limit=0`, filter in browser).

### Multi-location normalization

The URL uses a single `location` param with comma-separated values (e.g., `location=Westminster,Centennial`). The page normalizes this per endpoint:
- **`/api/projects`:** sends as `locations=Westminster,Centennial` (plural param, comma-sep)
- **`/api/deals`:** if multiple locations selected, fetches with no `location` param (gets all) and filters client-side. If single location, sends `location=Westminster`.

## URL Parameters (Deep-Linking)

All filters are synced to URL search params for shareable/bookmarkable URLs. The main page links here with pre-applied filters.

| Param | Type | Example |
|-------|------|---------|
| `pipeline` | string | `project` (default), `sales`, `dnr`, `service`, `roofing` |
| `stage` | string (comma-sep for multi) | `Construction`, `Construction,Inspection` |
| `location` | string (comma-sep for multi) | `Westminster`, `Westminster,Centennial` |
| `owner` | string (comma-sep for multi) | Owner names or IDs |
| `search` | string | `Johnson` |
| `sort` | string | `amount`, `stage`, `name` |
| `order` | `asc` \| `desc` | `desc` |

Filters read from URL on mount. Changing a filter updates the URL via `router.replace()` (no history push for filter changes).

## Main Page Integration

Two changes to `src/app/page.tsx`:

1. **Stage bars** — each `<StageBar>` becomes a link. Clicking it navigates to `/dashboards/deals?stage={stage}`. If locations are currently selected on the main page, they are appended: `?stage={stage}&location={selectedLocations.join(",")}`.

2. **Location buttons** — add a small link icon or secondary action on each location card. Clicking it navigates to `/dashboards/deals?location={location}`. The existing click-to-filter behavior on the main page is preserved (the location button still toggles the local filter). The navigation to deals is a separate click target (e.g., a small arrow icon in the corner of the card).

## Table Layout

Full-width table inside `DashboardShell`. No horizontal scrolling — abbreviated column headers with tooltips for full names.

### Columns (left to right)

| Header | Field | Width | Notes |
|--------|-------|-------|-------|
| Deal Name | `name` | flex | Left-aligned, font-weight 500, truncate with ellipsis |
| Stage | `stage` | ~100px | Color-coded badge using `STAGE_COLORS` |
| Location | `pbLocation` | ~90px | Text |
| Amount | `amount` | ~80px | Right-aligned, formatted with `formatMoney()` |
| SS | `siteSurveyStatus` | ~36px | Status dot, tooltip: "Site Survey" |
| Dsgn | `designStatus` | ~36px | Status dot, tooltip: "Design" |
| DA | `layoutStatus` | ~36px | Status dot, tooltip: "Design Approval" |
| Perm | `permittingStatus` | ~36px | Status dot, tooltip: "Permitting" |
| IC | `interconnectionStatus` | ~36px | Status dot, tooltip: "Interconnection" |
| Const | `constructionStatus` | ~36px | Status dot, tooltip: "Construction" |
| Insp | `finalInspectionStatus` | ~36px | Status dot, tooltip: "Final Inspection" |
| PTO | `ptoStatus` | ~36px | Status dot, tooltip: "Permission to Operate" |
| Owner | `dealOwner` | ~80px | Truncated name, font-size 11px |

### Status Dot Color Mapping

Map status string values to dot colors. The implementation should enumerate the actual HubSpot enum values for each status field and map them to colors. During implementation, fetch a sample of deals and inspect the distinct status values to build the complete mapping.

General color scheme:

- **Green** (`#4ade80`) — Complete / Approved / Passed / Done
- **Blue** (`#38bdf8`) — In Progress / Submitted / Scheduled / Active
- **Yellow** (`#facc15`) — Pending / Waiting / Needs Review / On Hold
- **Red** (`#f87171`) — Issue / Failed / Rejected / Blocked / Denied
- **Gray** (`#555` hollow `○`) — Not Started / null / empty

Any unmapped status values default to **Yellow** (needs review) to surface them for mapping.

Legend row below the table showing the color meanings.

### Sortable Headers

All columns sortable by clicking the header. Active sort shows an arrow indicator. Default sort: by stage (using `STAGE_ORDER` for custom ordering).

### Clickable Status Column Headers (Filtering)

Clicking a status column header (SS, Dsgn, DA, etc.) opens a small dropdown popover showing the unique status values for that column with checkboxes. Selecting values filters the table to only show deals matching those status values. Active column filters show a small dot indicator on the header.

This filtering is client-side only (post-fetch filter) since the API doesn't support status field filtering.

## Filter Bar

Positioned between DashboardShell header and the table.

### Components (left to right)

1. **Pipeline selector** — `<select>` dropdown. Changes pipeline, resets stage filter and status column filters (stages and statuses differ per pipeline). Default: "Project Pipeline".

2. **Stage filter** — Multi-select dropdown (checkbox list). Options populated from `STAGE_ORDER` / pipeline-specific stage maps. Active selections shown as dismissible orange pills.

3. **Location filter** — Multi-select dropdown. Options: all PB locations. Active selections as dismissible pills.

4. **Owner/PM filter** — Multi-select dropdown. Options populated from deal data (unique `dealOwner` values in current result set). Hidden when viewing non-project pipelines (field not available on deal shape).

5. **Search input** — Text field with debounce (300ms). Searches deal name and address.

6. **Deal count** — Right-aligned, shows "N deals" reflecting current filter state.

### Summary Stats Row

Below filters, above table. Shows filtered aggregate metrics:

- **Deal count** (orange accent)
- **Total value** (green accent, formatted as currency)
- **Avg days in current stage** (blue accent) — computed as average of `daysSinceStageMovement` across all filtered deals. Hidden for non-project pipelines (field not available).

## Detail Panel (Slide-Out)

Clicking a table row opens a right-side slide-out panel (~400px wide) with backdrop overlay.

### Panel Contents

- **Header:** Deal name + stage badge + close button (×)
- **Quick actions:** "Open in HubSpot" button (external link, new tab) using the deal's `url` field
- **Info section:** Full address, city/state/zip, project type, `dealOwner` (project pipeline only), amount, create date, close date, days since created
- **Status section** (project pipeline only): All 8 statuses with full names and actual status text values (not dots), color-coded:
  - Site Survey Status
  - Design Status
  - DA Status (from `layoutStatus`)
  - Permitting Status
  - Interconnection Status
  - Construction Status
  - Final Inspection Status
  - PTO Status
- **Dates section** (project pipeline only): Key milestone dates (design completion, permit submit, construction start, etc.)

For non-project pipelines, the detail panel shows only the Info section with available fields (name, stage, location, amount, dates).

Panel closes on: clicking ×, clicking backdrop, pressing Escape.

## Data Flow

1. Page loads → reads URL search params
2. If pipeline is `project` (Project Pipeline): fetches `/api/projects?limit=0&locations={locations}&search={search}&sort={sort}&order={order}`. If other pipeline: fetches `/api/deals?pipeline={name}&limit=0&search={search}&sort={sort}&order={order}` (location filtered client-side if multi-value, or `&location={single}` if single).
3. Client-side filters applied: stage multi-select, owner filter, status column filters
4. Client-side sorting applied (since we fetch all and sort locally for custom stage ordering)
5. Table renders filtered/sorted results
6. Filter change → updates URL params via `router.replace()` → re-fetches if data source param changed (pipeline, location, search) or re-filters client-side (stage, owner, status columns)
7. Row click → opens detail panel (no additional fetch needed, data already loaded)

## Pagination

Load all deals (`limit=0`) since the project pipeline has <500 deals. Client-side filtering/sorting is fast enough. Expected max: ~500 deals for Project Pipeline, ~200 for other pipelines.

## Component Structure

```
src/app/dashboards/deals/
  page.tsx            — Main page component (client), DashboardShell wrapper,
                        filter state management, URL param sync
  DealsTable.tsx      — Table component with sortable headers, status dots,
                        column header filter popovers
  DealDetailPanel.tsx — Slide-out panel component
  StatusDot.tsx       — Reusable status dot component (value → color mapping)
  useDealsFilters.ts  — Hook: reads/writes URL search params, manages filter state
```

## Existing Code Reuse

- `DashboardShell` — page wrapper with breadcrumbs, export, last-updated (add to `SUITE_MAP`)
- `STAGE_COLORS`, `STAGE_ORDER` from `src/lib/constants.ts` — stage badge colors and sort order
- `PIPELINE_IDS`, `STAGE_MAPS` from `src/lib/deals-pipeline.ts` — pipeline config
- `formatMoney()` from `src/lib/format.ts` — currency formatting
- `MultiSelectFilter` from `src/components/` — existing multi-select dropdown (compatible: accepts `options`, `selected`, `onChange`)
- `useSSE` hook — real-time updates when deal data changes
- Theme tokens (`bg-surface`, `text-foreground`, etc.) — consistent styling
