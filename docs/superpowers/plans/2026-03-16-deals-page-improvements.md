# Deals Page Improvements Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix inaccurate "days in stage" data, add missing UI features (PM in detail panel, clear-all button, CSV export, days-in-stage column), and clean up visual noise (hide status columns on non-project pipelines, remove unused import, add owner pill prefix).

**Architecture:** Eight independent improvements to the deals page. The most critical change replaces the broken `days_since_stage_movement` HubSpot property (30-day buckets, capped at 120) with a precise calculation from `hs_v2_date_entered_current_stage`. This is a shared contract change — `daysSinceStageMovement` is consumed by 15+ dashboards — so Task 1 includes a downstream regression checklist. All other changes are localized to the deals page files.

**Tech Stack:** Next.js, React, TypeScript, HubSpot CRM API

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/hubspot.ts` | Modify | Add `hs_v2_date_entered_current_stage` to properties, compute precise days |
| `src/app/dashboards/deals/page.tsx` | Modify | Remove unused import, add clear-all button, wire CSV export, add owner pill prefix |
| `src/app/dashboards/deals/DealsTable.tsx` | Modify | Add days-in-stage column (project), hide status columns (non-project) |
| `src/app/dashboards/deals/DealDetailPanel.tsx` | Modify | Add PM to info section |
| `src/__tests__/days-in-stage.test.ts` | Create | Tests for exported `computeDaysInStage` helper |

---

## Chunk 1: Accurate Days in Stage

### Task 1: Fix daysSinceStageMovement calculation in hubspot.ts

**Files:**
- Modify: `src/lib/hubspot.ts:488-600` (DEAL_PROPERTIES array)
- Modify: `src/lib/hubspot.ts:919` (daysSinceStageMovement assignment)
- Create: `src/__tests__/days-in-stage.test.ts`

**Context:** The HubSpot property `days_since_stage_movement` is a custom field that only increments in 30-day buckets (0, 30, 60, 90, 120) and caps at 120. A deal in its stage for 854 days shows `0`. HubSpot provides `hs_v2_date_entered_current_stage` — a precise datetime timestamp auto-maintained per deal. We extract the calculation into an exported helper so the test exercises the real code path.

**Blast radius:** `daysSinceStageMovement` is consumed by 15+ dashboards. Since we're replacing a coarse approximation with an accurate value, all consumers benefit. However, dashboards with hardcoded thresholds (e.g. `> 30` = red) may surface more deals than before (deals previously bucketed as `0` or `30` might now show `45`). This is correct behavior, not a regression.

**Downstream regression checklist** (verify after deploy — values should be more precise, not broken):
- `dashboards/design-engineering` — sorts/colors by `daysSinceStageMovement > 14 / > 7`
- `dashboards/project-management` — "stuck deals" filter `> 30`, avg days stat
- `dashboards/pi-overview` — sorts by days, colors `> 21 / > 10`
- `dashboards/utility-tracker` — sorts by days, colors `> 21 / > 14`
- `dashboards/ahj-tracker` — sorts by days, colors `> 21 / > 14`
- `dashboards/plan-review` — `daysWaiting` from `daysSinceStageMovement`
- `dashboards/de-overview` — stale-deal filter for D&E stage
- `dashboards/pi-action-queue`, `pi-ic-action-queue`, `pi-permit-action-queue` — days thresholds
- `dashboards/pending-approval` — `daysWaiting`
- Home page `pipelineStageData` — avg days in stage stat

- [ ] **Step 1: Extract helper and write the test**

In `src/lib/hubspot.ts`, add an exported helper after the existing `daysBetween` function (line 687):

```typescript
/** Compute days since a deal entered its current stage from the HubSpot timestamp. */
export function computeDaysInStage(dateEnteredCurrentStage: unknown, now: Date = new Date()): number {
  if (!dateEnteredCurrentStage) return 0;
  const entered = new Date(String(dateEnteredCurrentStage));
  if (isNaN(entered.getTime())) return 0;
  return Math.max(0, daysBetween(entered, now));
}
```

Create `src/__tests__/days-in-stage.test.ts`:

```typescript
/**
 * Tests for precise daysSinceStageMovement calculation.
 * Exercises the real computeDaysInStage helper from hubspot.ts.
 */
import { computeDaysInStage } from "@/lib/hubspot";

describe("computeDaysInStage", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("computes exact days from ISO datetime", () => {
    expect(computeDaysInStage("2026-02-14T12:00:00Z", now)).toBe(30);
  });

  it("returns 0 when value is null", () => {
    expect(computeDaysInStage(null, now)).toBe(0);
  });

  it("returns 0 when value is undefined", () => {
    expect(computeDaysInStage(undefined, now)).toBe(0);
  });

  it("returns 0 when value is empty string", () => {
    expect(computeDaysInStage("", now)).toBe(0);
  });

  it("rounds to nearest day", () => {
    // 6.75 days ago → rounds to 7
    expect(computeDaysInStage("2026-03-09T18:30:00.000Z", now)).toBe(7);
  });

  it("clamps to 0 for future dates (clock skew)", () => {
    expect(computeDaysInStage("2026-03-16T14:00:00.000Z", now)).toBe(0);
  });

  it("handles large values (no 120-day cap)", () => {
    // 928 days ago — the old property would show 120 max
    expect(computeDaysInStage("2023-08-31T19:54:52.223Z", now)).toBe(928);
  });

  it("returns 0 for invalid date strings", () => {
    expect(computeDaysInStage("not-a-date", now)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (helper doesn't exist yet)**

Run: `npx jest src/__tests__/days-in-stage.test.ts --no-coverage`
Expected: FAIL — `computeDaysInStage` is not yet exported from hubspot.ts

- [ ] **Step 3: Add the helper to hubspot.ts**

In `src/lib/hubspot.ts`, after line 687 (end of `daysBetween`), add:

```typescript
/** Compute days since a deal entered its current stage from the HubSpot timestamp. */
export function computeDaysInStage(dateEnteredCurrentStage: unknown, now: Date = new Date()): number {
  if (!dateEnteredCurrentStage) return 0;
  const entered = new Date(String(dateEnteredCurrentStage));
  if (isNaN(entered.getTime())) return 0;
  return Math.max(0, daysBetween(entered, now));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/days-in-stage.test.ts --no-coverage`
Expected: 8/8 pass

- [ ] **Step 5: Swap DEAL_PROPERTIES and update transform**

In `src/lib/hubspot.ts`, in the DEAL_PROPERTIES array near line 592:

```typescript
// Replace:
  // Calculated/tracking
  "days_since_stage_movement",

// With:
  // Stage timing (precise — replaces 30-day-bucket days_since_stage_movement)
  "hs_v2_date_entered_current_stage",
```

Then update the transform at line 919:

```typescript
// Replace:
    daysSinceStageMovement: Number(deal.days_since_stage_movement) || 0,

// With:
    daysSinceStageMovement: computeDaysInStage(deal.hs_v2_date_entered_current_stage, now),
```

Note: `now` is already defined at line 757 as `const now = new Date();`.

- [ ] **Step 6: Verify build compiles and all tests pass**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Run: `npx jest src/__tests__/days-in-stage.test.ts --no-coverage`
Expected: No type errors, 8/8 tests pass

- [ ] **Step 7: Commit**

```bash
git add src/lib/hubspot.ts src/__tests__/days-in-stage.test.ts
git commit -m "fix(hubspot): compute precise daysSinceStageMovement from hs_v2_date_entered_current_stage

The days_since_stage_movement HubSpot property only increments in 30-day
buckets (0/30/60/90/120) and caps at 120. Replaced with a precise
calculation from hs_v2_date_entered_current_stage, a HubSpot-maintained
datetime field. Extracted computeDaysInStage helper for testability."
```

---

## Chunk 2: Detail Panel + Import Cleanup

### Task 2: Add Project Manager to detail panel

**Files:**
- Modify: `src/app/dashboards/deals/DealDetailPanel.tsx:86`

**Context:** The detail panel shows Owner (line 86) but omits Project Manager. Add it directly after the Owner row.

- [ ] **Step 1: Add PM row after Owner row**

In `DealDetailPanel.tsx`, after line 86 (`{isProject && <InfoRow label="Owner" value={deal.dealOwner || "—"} />}`), add:

```tsx
{isProject && <InfoRow label="Project Manager" value={deal.projectManager || "—"} />}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/deals/DealDetailPanel.tsx
git commit -m "fix(deals): add project manager to deal detail panel"
```

### Task 3: Remove unused STATUS_COLUMNS import from page.tsx

**Files:**
- Modify: `src/app/dashboards/deals/page.tsx:10-17`

**Context:** `STATUS_COLUMNS` is imported at line 16 but never referenced in page.tsx (it's only used in DealsTable.tsx).

- [ ] **Step 1: Remove STATUS_COLUMNS from the import**

In `src/app/dashboards/deals/page.tsx`, change the import block:

```typescript
// Replace:
import {
  type TableDeal,
  type SlimDeal,
  projectToTableDeal,
  isProjectPipeline,
  PIPELINE_OPTIONS,
  STATUS_COLUMNS,
} from "./deals-types";

// With:
import {
  type TableDeal,
  type SlimDeal,
  projectToTableDeal,
  isProjectPipeline,
  PIPELINE_OPTIONS,
} from "./deals-types";
```

- [ ] **Step 2: Verify lint passes**

Run: `npx eslint src/app/dashboards/deals/page.tsx --no-warn-ignored 2>&1 | head -10`
Expected: No errors (the existing `react-hooks/refs` warning in useDealsFilters.ts is pre-existing and unrelated)

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/deals/page.tsx
git commit -m "fix(deals): remove unused STATUS_COLUMNS import from page.tsx"
```

---

## Chunk 3: Filter UX Improvements

### Task 4: Add owner filter pill prefix

**Files:**
- Modify: `src/app/dashboards/deals/page.tsx:328-330`

**Context:** PM pills show `PM: name` but Owner pills show just the bare name. Add `Owner: ` prefix for consistency.

- [ ] **Step 1: Add prefix to owner pills**

In `src/app/dashboards/deals/page.tsx`, change the owner filter pill label:

```tsx
// Replace:
          {filters.owners.map((o) => (
            <FilterPill
              key={`owner-${o}`}
              label={o}
              onRemove={() => setFilters({ owners: filters.owners.filter((v) => v !== o) })}
            />
          ))}

// With:
          {filters.owners.map((o) => (
            <FilterPill
              key={`owner-${o}`}
              label={`Owner: ${o}`}
              onRemove={() => setFilters({ owners: filters.owners.filter((v) => v !== o) })}
            />
          ))}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/deals/page.tsx
git commit -m "fix(deals): add 'Owner:' prefix to owner filter pills for consistency"
```

### Task 5: Add "Clear all filters" button

**Files:**
- Modify: `src/app/dashboards/deals/page.tsx:312-343` (filter pills section)
- Modify: `src/app/dashboards/deals/useDealsFilters.ts` (add clearFilters helper)

**Context:** When multiple filters are active, users must remove pills one by one. Add a "Clear all" button at the end of the pills row.

- [ ] **Step 1: Add clearFilters to useDealsFilters**

In `src/app/dashboards/deals/useDealsFilters.ts`, add a `clearFilters` callback after `setStatusFilter` (before the return statement around line 154):

```typescript
  const clearFilters = useCallback(() => {
    setFilters({
      stages: [],
      locations: [],
      owners: [],
      projectManagers: [],
      statusFilters: {},
    });
  }, [setFilters]);

  return { filters, setFilters, setStatusFilter, clearFilters };
```

Update the return type — it's inferred, so just update the return statement.

- [ ] **Step 2: Wire clearFilters in page.tsx**

In `src/app/dashboards/deals/page.tsx`, update the destructuring at line 56:

```typescript
// Replace:
  const { filters, setFilters, setStatusFilter } = useDealsFilters();

// With:
  const { filters, setFilters, setStatusFilter, clearFilters } = useDealsFilters();
```

Then add a "Clear all" button at the end of the filter pills section. The pills section is the `<div>` block starting at line 313. Add inside that div, after the PM pills `map`:

```tsx
          <button
            onClick={clearFilters}
            className="text-[10px] text-muted hover:text-foreground underline ml-1"
          >
            Clear all
          </button>
```

Also need to account for status filters being active in the visibility condition. Update the condition at line 312:

```typescript
// Replace:
      {(filters.stages.length > 0 || filters.locations.length > 0 || filters.owners.length > 0 || filters.projectManagers.length > 0) && (

// With:
      {(filters.stages.length > 0 || filters.locations.length > 0 || filters.owners.length > 0 || filters.projectManagers.length > 0 || Object.values(filters.statusFilters).some(v => v.length > 0)) && (
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/deals/useDealsFilters.ts src/app/dashboards/deals/page.tsx
git commit -m "feat(deals): add 'Clear all' button for active filter pills"
```

---

## Chunk 4: Table Improvements

### Task 6: Hide status columns on non-project pipelines

**Files:**
- Modify: `src/app/dashboards/deals/DealsTable.tsx:109-124` (thead), `160-171` (tbody), `186` (colspan)

**Context:** Non-project pipelines (D&R, Service, Roofing, Sales) show 8 columns of empty `○` dots. These add no information and consume ~290px. Hide them entirely.

- [ ] **Step 1: Remove non-project status column headers**

In `DealsTable.tsx`, remove the non-project status headers block (lines 119-124):

```tsx
// DELETE these lines:
            {!isProject &&
              STATUS_COLUMNS.map((col) => (
                <th key={col.key} className={`${thClass} w-[36px] text-center`} title={col.fullName}>
                  <span className="text-muted/50">{col.abbrev}</span>
                </th>
              ))}
```

- [ ] **Step 2: Remove non-project status column cells**

In DealsTable.tsx, remove the non-project status cells block (lines 166-171):

```tsx
// DELETE these lines:
              {!isProject &&
                STATUS_COLUMNS.map((col) => (
                  <td key={col.key} className={`${tdClass} text-center`}>
                    <StatusDot value={null} unavailable />
                  </td>
                ))}
```

- [ ] **Step 3: Update empty-state colspan**

In DealsTable.tsx, update the colSpan at line 186. The project pipeline has: name + stage + location + amount + 8 status + PM + owner = 14. Non-project now has: name + stage + location + amount = 4.

```tsx
// Replace:
              <td colSpan={isProject ? 14 : 12} className="text-center py-12 text-muted">

// With:
              <td colSpan={isProject ? 14 : 4} className="text-center py-12 text-muted">
```

- [ ] **Step 4: Hide status legend on non-project pipelines**

The legend (lines 194-201) explains status dot colors. With status columns hidden on non-project pipelines, the legend becomes orphaned. Wrap it with `isProject`:

```tsx
// Replace:
      {/* Legend */}
      <div className="flex gap-4 px-4 py-2.5 border-t border-t-border text-xs text-muted">

// With:
      {/* Legend — project pipeline only (status columns hidden for other pipelines) */}
      {isProject && <div className="flex gap-4 px-4 py-2.5 border-t border-t-border text-xs text-muted">
```

And close the conditional after the legend `</div>`:

```tsx
// Replace:
        <span><span style={{ color: "#555" }}>○</span> Not Started</span>
      </div>

// With:
        <span><span style={{ color: "#555" }}>○</span> Not Started</span>
      </div>}
```

- [ ] **Step 5: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/deals/DealsTable.tsx
git commit -m "fix(deals): hide empty status columns and legend on non-project pipelines"
```

### Task 7: Add "Days in Stage" sortable column (project pipeline)

**Files:**
- Modify: `src/app/dashboards/deals/DealsTable.tsx` (thead + tbody, project pipeline only)

**Context:** `daysSinceStageMovement` is available on every project deal (now accurate after Task 1). Show it as a sortable column between Amount and the status dots. Use color coding: >30 red, >14 yellow, else default — matching the pattern used in `design-engineering/page.tsx:710`.

- [ ] **Step 1: Add column header after Amount**

In `DealsTable.tsx`, after the Amount `<th>` (line 106-108), add a project-only header:

```tsx
            {isProject && (
              <th className={`${thClass} w-[50px] text-right`} onClick={() => onSort("daysSinceStageMovement")}>
                Days <SortArrow active={sort === "daysSinceStageMovement"} order={order} />
              </th>
            )}
```

- [ ] **Step 2: Add column cell after Amount cell**

In DealsTable.tsx, after the Amount `<td>` (line 159), add:

```tsx
              {isProject && (
                <td className={`${tdClass} text-right`}>
                  <span className={`font-medium ${(deal.daysSinceStageMovement ?? 0) > 30 ? "text-red-400" : (deal.daysSinceStageMovement ?? 0) > 14 ? "text-yellow-400" : "text-muted"}`}>
                    {deal.daysSinceStageMovement ?? 0}d
                  </span>
                </td>
              )}
```

- [ ] **Step 3: Update colspan**

The project pipeline now has: name + stage + location + amount + days + 8 status + PM + owner = 15.

```tsx
// Replace (from Task 6):
              <td colSpan={isProject ? 14 : 4} className="text-center py-12 text-muted">

// With:
              <td colSpan={isProject ? 15 : 4} className="text-center py-12 text-muted">
```

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/deals/DealsTable.tsx
git commit -m "feat(deals): add sortable 'Days in Stage' column for project pipeline"
```

---

## Chunk 5: CSV Export

### Task 8: Wire CSV export via DashboardShell

**Files:**
- Modify: `src/app/dashboards/deals/page.tsx:224-229` (DashboardShell props)

**Context:** DashboardShell already supports `exportData={{ data, filename }}` which renders an export button and handles CSV generation via `src/lib/export.ts`. The deals page doesn't use it. Wire `filteredDeals` into it. Include relevant fields only — flatten status columns for project pipeline.

- [ ] **Step 1: Build exportData from filteredDeals**

In `src/app/dashboards/deals/page.tsx`, add a `useMemo` after line 206 (`const isProject = isProjectPipeline(filters.pipeline);`):

```typescript
  const exportData = useMemo(() => {
    if (filteredDeals.length === 0) return undefined;
    const rows = filteredDeals.map((d) => {
      const base: Record<string, unknown> = {
        Name: d.name,
        Stage: d.stage,
        Location: d.pbLocation,
        Amount: d.amount,
      };
      if (isProject) {
        base["Days in Stage"] = d.daysSinceStageMovement ?? 0;
        base["Owner"] = d.dealOwner || "";
        base["Project Manager"] = d.projectManager || "";
        base["Site Survey"] = d.siteSurveyStatus || "";
        base["Design"] = d.designStatus || "";
        base["Design Approval"] = d.layoutStatus || "";
        base["Permitting"] = d.permittingStatus || "";
        base["Interconnection"] = d.interconnectionStatus || "";
        base["Construction"] = d.constructionStatus || "";
        base["Inspection"] = d.finalInspectionStatus || "";
        base["PTO"] = d.ptoStatus || "";
      }
      return base;
    });
    return { data: rows, filename: `deals-${filters.pipeline}` };
  }, [filteredDeals, filters.pipeline, isProject]);
```

- [ ] **Step 2: Pass exportData to DashboardShell**

Update the DashboardShell JSX:

```tsx
// Replace:
    <DashboardShell
      title="Active Deals"
      accentColor="orange"
      lastUpdated={lastUpdated}
      fullWidth={true}
    >

// With:
    <DashboardShell
      title="Active Deals"
      accentColor="orange"
      lastUpdated={lastUpdated}
      fullWidth={true}
      exportData={exportData}
    >
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/deals/page.tsx
git commit -m "feat(deals): add CSV export for filtered deals view"
```

---

## Summary of Changes

| # | Type | Description | Files |
|---|------|-------------|-------|
| 1 | Bug fix | Precise days in stage (replace 30-day buckets) | `hubspot.ts`, new test |
| 2 | Bug fix | PM in detail panel | `DealDetailPanel.tsx` |
| 3 | Cleanup | Remove unused `STATUS_COLUMNS` import | `page.tsx` |
| 4 | Cleanup | Owner pill prefix | `page.tsx` |
| 5 | Feature | Clear all filters button | `page.tsx`, `useDealsFilters.ts` |
| 6 | Cleanup | Hide status columns on non-project | `DealsTable.tsx` |
| 7 | Feature | Sortable "Days in Stage" column | `DealsTable.tsx` |
| 8 | Feature | CSV export | `page.tsx` |
