# Pipeline Selector & Deals Sorting Fix

**Date:** 2026-03-15
**Status:** Draft

## Summary

Two changes:
1. Fix deals table stage sorting for non-project pipelines (D&R, Sales, Service, Roofing)
2. Add a pipeline dropdown to the main dashboard's "Pipeline by Stage" section

## 1. Fix Deals Table Stage Sorting

### Problem

`stageSort()` in `DealsTable.tsx` uses `STAGE_ORDER` from `constants.ts`, which only contains project pipeline stages. When viewing D&R, Sales, Service, or Roofing pipelines, all stages get position 999 and sort in arbitrary order.

### Solution

Use `ACTIVE_STAGES` from `deals-pipeline.ts` as the source of truth for non-project pipeline stage ordering. These arrays are already in pipeline progression order.

**Files changed:**
- `src/app/dashboards/deals/DealsTable.tsx` — update `stageSort()` to accept a `pipeline` param and look up the correct stage order from `ACTIVE_STAGES` (non-project) or `STAGE_ORDER` (project)
- No new constants or duplicate arrays

**Implementation detail:** The `pipeline` prop is already available on the `DealsTable` component (line 20 of props interface). Pass it through to `stageSort()` from the `sorted` useMemo (line 53), and add `pipeline` to the useMemo dependency array.

**Logic:**
```
function stageSort(a, b, order, pipeline):
  if pipeline === "project":
    stageList = STAGE_ORDER  // from constants.ts (canonical project stage order)
  else:
    stageList = ACTIVE_STAGES[pipeline] || []  // from deals-pipeline.ts

  aPos = stageList.indexOf(a), default 999
  bPos = stageList.indexOf(b), default 999
  return order === "asc" ? aPos - bPos : bPos - aPos
```

## 2. Pipeline Dropdown on Main Dashboard

### Design Decisions

- **Selector style:** Dropdown next to "Pipeline by Stage" title (not tabs)
- **Stat cards:** Stay fixed as project pipeline — not affected by pipeline switch
- **Location filter:** Only affects project pipeline view. Non-project stage breakdowns ignore the home location filter entirely.
- **Data loading:** Lazy load non-project pipeline data on first switch, cache in state for instant re-switching
- **Active stages only:** Non-project pipeline breakdowns count only active-stage deals (using `ACTIVE_STAGES[pipeline]` as the filter), matching the project pipeline behavior

### UI Changes

**`src/app/page.tsx` — "Pipeline by Stage" section (lines 610-671):**

Add `selectedPipeline` state (default `"project"`). Add a dropdown element next to the `<h2>Pipeline by Stage</h2>` heading. Reuse `PIPELINE_OPTIONS` from `deals-types.ts` for consistent labels:
- `"project"` → "Project Pipeline" (default)
- `"dnr"` → "D&R Pipeline"
- `"sales"` → "Sales Pipeline"
- `"service"` → "Service Pipeline"
- `"roofing"` → "Roofing Pipeline"

When `selectedPipeline === "project"`:
- Current behavior — uses `stats.stageCounts` / `stats.stageValues` from project data
- Respects `selectedLocations` filter
- Replace the hardcoded `stageOrder` array (lines 627-639) with imported `STAGE_ORDER` from `constants.ts`

When `selectedPipeline !== "project"`:
- Fetch deals from `/api/deals?pipeline={key}` (lazy, one-time per pipeline per session)
- Compute `stageCounts` and `stageValues` client-side from returned deals, counting only deals whose stage is in `ACTIVE_STAGES[pipeline]`
- Use `ACTIVE_STAGES[pipeline]` for stage ordering
- Ignore `selectedLocations` filter (location filter is project-specific)
- Cache result in a `Record<string, { stageCounts, stageValues, total, totalValue }>` state
- Show a loading skeleton in the stage bar area while fetching

**"View All Deals →" link:** When `selectedPipeline === "project"`, link to `/dashboards/deals` (no param, defaults to project). When non-project, link to `/dashboards/deals?pipeline={selectedPipeline}`.

**Stage bar colors:** Reuse `STAGE_COLORS` where stage names match (e.g., "Inspection", "On Hold" appear across pipelines). For v1, stages without a color entry fall back to neutral gray (`#71717A`). Most non-project pipeline stages will be gray — this is acceptable for the initial release. Adding per-pipeline color maps is a future enhancement.

### Data Flow

```
selectedPipeline === "project"
  → use existing stats from projectsQuery (filtered by selectedLocations)
  → stage order: STAGE_ORDER

selectedPipeline !== "project"
  → check pipelineCache[pipeline]
    → if cached: use cached stageCounts/stageValues
    → if not cached:
      → show loading skeleton
      → fetch /api/deals?pipeline={key}
      → filter to active stages only
      → compute stageCounts/stageValues from deals
      → store in pipelineCache
  → stage order: ACTIVE_STAGES[pipeline]
  → ignore selectedLocations
```

### Cache Behavior

- Pipeline data cached in component state (`Record<string, PipelineStageData>`)
- Cache lives for the duration of the page session — no TTL or background refresh for non-project pipelines
- Project pipeline continues to auto-refresh via `refetchInterval` and SSE as before
- This is acceptable for v1; non-project pipeline data changes less frequently

### What Doesn't Change

- Top stat cards (always project pipeline)
- Location filter cards (always project pipeline)
- Header, suite links, role-based dashboard cards
- `/api/deals` endpoint (already supports `?pipeline=` param)

## Non-Goals

- Per-pipeline stat cards (future enhancement)
- Per-pipeline color maps for stage bars (future enhancement)
- New API endpoints
- Changes to the location filter behavior for project pipeline
- Cache invalidation / auto-refresh for non-project pipeline data
