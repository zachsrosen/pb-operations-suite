# Forecast Timeline Dashboard — Design Spec

**Date:** 2026-03-15
**Suite:** Executive
**Route:** `/dashboards/forecast-timeline`

## Purpose

A dashboard showing all 10 milestone forecasts for every active project, with portfolio-level filtering and per-project drill-down. Answers: "Where is each project expected to be and when?" and "Which projects are running late?"

## Architecture

### Single API Route

**`/api/forecasting/timeline`** — endpoint returning all active projects with their full forecast data.

- Fetches active projects via `appCache.getOrFetch(CACHE_KEYS.PROJECTS_ACTIVE, () => fetchAllProjects({ activeOnly: true }))` (uses cached project data, avoids redundant HubSpot calls)
- Gets baseline table via `const { data: baselineTable } = await getBaselineTable()` (returns cache wrapper — extract `.data`)
- Computes `computeProjectForecasts()` for each project (original + live)
- Derives variance (live PTO forecast vs original PTO forecast)
- Does NOT use its own cache key — relies on underlying project and baseline caches for speed, ensuring SSE-triggered refetches always return fresh forecast computations
- `export const maxDuration = 120` safety net

**Field mappings from `Project` interface:**
- `dealId` ← `String(project.id)` (Project.id is `number`)
- `customerName` ← `project.name`
- `nextMilestone` ← first milestone in `MILESTONE_CHAIN` without an actual date

**Response shape:**
```typescript
interface TimelineResponse {
  projects: TimelineProject[];
  summary: {
    total: number;
    onTrack: number;     // variance <= 7d (includes negative/ahead)
    atRisk: number;      // variance 8-14d
    behind: number;      // variance > 14d
    noForecast: number;  // varianceDays is null (insufficient data)
  };
  lastUpdated: string;
}

interface TimelineProject {
  dealId: string;           // String(project.id)
  projectNumber: string;
  customerName: string;     // project.name
  location: string;
  currentStage: string;
  nextMilestone: {
    name: string;
    forecastDate: string | null;
  };
  forecastPto: string | null;
  varianceDays: number | null;  // live PTO - original PTO in days
  milestones: MilestoneDetail[];
}

interface MilestoneDetail {
  name: string;           // "Close", "Design Complete", etc.
  key: MilestoneKey;
  originalForecast: string | null;
  liveForecast: string | null;
  actual: string | null;
  varianceDays: number | null;  // live - original in days
  basis: ForecastBasis;         // "actual" | "segment" | "location" | "global" | "insufficient"
}
```

### Client Page

**`/dashboards/forecast-timeline/page.tsx`** — client component wrapped in `<DashboardShell>`.

**Data fetching:** react-query calling `/api/forecasting/timeline`, consistent with existing dashboard pattern.

**Layout (top to bottom):**

1. **Hero stats row** (4 StatCards + optional 5th)
   - Active Projects (total count)
   - On Track (variance ≤ 7d including negative/ahead, green)
   - At Risk (variance 8-14d, amber)
   - Behind (variance > 14d, red)
   - No Forecast (insufficient data, gray — only shown if count > 0)

2. **Filter bar**
   - Text search (project number / customer name)
   - Location dropdown (dynamically derived from project data, not hardcoded)
   - Current stage dropdown
   - Forecasted PTO month dropdown
   - Variance filter (All, On Track, At Risk, Behind)
   - Result count label

3. **Overview table** — sortable columns:
   - Project (number + customer name)
   - Location
   - Current Stage (colored pill)
   - Next Milestone (name + forecast date)
   - Forecast PTO
   - Variance (colored: green ≤ 0d, green "On Track" ≤ 7d, amber 8-14d, red > 14d)

4. **Inline expand** — clicking a row expands a detail panel below showing:
   - Basis legend (colored dots: actual, segment, location, global)
   - Full milestone table with columns: Milestone, Basis, Original Forecast, Live Forecast, Actual, Variance
   - Current/next milestone highlighted (orange)
   - Completed milestones in green
   - Future milestones in muted gray

**All filtering and sorting is client-side** — the API returns the full dataset once.

## Integration Points

- **DashboardShell:** `accentColor="blue"`, `fullWidth={true}`, suite mapped to `/suites/executive`
- **SUITE_MAP:** Add `"/dashboards/forecast-timeline"` → `{ href: "/suites/executive", label: "Executive" }`
- **Export:** CSV via DashboardShell `exportData` prop (project, location, stage, forecast PTO, variance)
- **SSE:** `useSSE(() => refetch(), { url: "/api/stream", cacheKeyFilter: "projects" })` — when project data changes, SSE fires and triggers react-query refetch, which re-calls the API route to compute fresh forecasts from updated cached project/baseline data
- **Activity tracking:** `useActivityTracking` hook
- **Loading/error states:** Use `<LoadingSpinner>` and error fallback consistent with forecast-accuracy page

## Styling

- Theme tokens only (`bg-surface`, `text-foreground`, `border-t-border`, etc.)
- `stagger-grid` on hero stats
- Stage pills use `STAGE_COLORS` from `src/lib/constants.ts` (provides `.tw` class + `.hex`)
- Variance colors: `text-green-500` (on track/early), `text-amber-500` (at risk), `text-red-500` (behind)
- Expanded row: darker background (`bg-surface-2`), bordered detail panel

## Variance Calculation

Variance = live forecast PTO date − original forecast PTO date (in days).

- **Negative** = project running ahead of original prediction → **On Track** bucket
- **0 to 7d** = on track → **On Track** bucket
- **8-14d** = at risk → **At Risk** bucket
- **> 14d** = behind → **Behind** bucket
- **null** (insufficient forecast data) → **No Forecast** bucket

Per-milestone variance in the detail view: live forecast date − original forecast date for each milestone.

## Next Milestone Determination

Walk `MILESTONE_CHAIN` in order. The first milestone where the project has no actual date is the "next milestone." Its live forecast date is shown in the overview table.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/app/api/forecasting/timeline/route.ts` | Create — API route |
| `src/app/dashboards/forecast-timeline/page.tsx` | Create — Dashboard page |
| `src/components/DashboardShell.tsx` | Edit — Add SUITE_MAP entry |
