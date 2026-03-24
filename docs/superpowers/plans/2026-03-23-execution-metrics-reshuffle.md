# Execution / Metrics Table Reshuffle — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move actionable tables (past-due surveys, upcoming surveys, failed inspections, CC-pending inspections) from metrics pages to execution pages, remove the AHJ breakdown card from inspections execution, and extract shared components to avoid duplication.

**Architecture:** Extract `useSort`, `sortRows`, `SortHeader`, `DealLinks`, and formatting helpers into shared files. Add a `scope=pipeline` fast path to the inspection-metrics API. Wire the new tables into execution pages with client-side filter integration. Remove the migrated sections from their source pages.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript 5, Tailwind v4, React Query v5, Jest + @testing-library/react

**Spec:** `docs/superpowers/specs/2026-03-23-execution-metrics-reshuffle-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/hooks/useSort.ts` | **Create** | Shared `useSort` hook + `sortRows` helper |
| `src/components/ui/SortHeader.tsx` | **Create** | Shared sortable table header component |
| `src/components/ui/DealLinks.tsx` | **Create** | HubSpot + Zuper link pair using `external-links.ts` |
| `src/lib/format-helpers.ts` | **Create** | Shared `fmtAmount`, `fmtDateShort` formatters |
| `src/__tests__/hooks/useSort.test.ts` | **Create** | Tests for `useSort` + `sortRows` |
| `src/__tests__/lib/format-helpers.test.ts` | **Create** | Tests for formatters |
| `src/app/api/hubspot/inspection-metrics/route.ts` | **Modify** | Add `scope=pipeline` fast path |
| `src/app/dashboards/inspections/page.tsx` | **Modify** | Add failed/pending tables, remove AHJ card |
| `src/app/dashboards/inspection-metrics/page.tsx` | **Modify** | Remove failed/pending tables, use shared imports |
| `src/app/dashboards/site-survey/page.tsx` | **Modify** | Add past-due/upcoming tables |
| `src/app/dashboards/survey-metrics/page.tsx` | **Modify** | Remove past-due/upcoming tables, use shared imports |

---

## Chunk 1: Shared Components

### Task 1: Extract `useSort` hook and `sortRows` helper

**Files:**
- Create: `src/hooks/useSort.ts`
- Test: `src/__tests__/hooks/useSort.test.ts`

**Context:** Two divergent implementations exist:
- `survey-metrics/page.tsx:70-90` — `sortRows` accepts nullable key, `useSort` defaults new-key direction to `"desc"`
- `inspection-metrics/page.tsx:183-211` — `sortRows` handles booleans, `useSort` defaults new-key direction to `"asc"`

The shared version takes the superset: nullable key from survey-metrics + boolean handling from inspection-metrics + configurable `defaultDir`.

- [ ] **Step 1: Write failing tests for `useSort`**

```typescript
// src/__tests__/hooks/useSort.test.ts
/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useSort, sortRows } from "@/hooks/useSort";

describe("useSort", () => {
  it("initializes with provided defaults", () => {
    const { result } = renderHook(() => useSort("name", "desc"));
    expect(result.current.sortKey).toBe("name");
    expect(result.current.sortDir).toBe("desc");
  });

  it("defaults to null key and asc direction", () => {
    const { result } = renderHook(() => useSort());
    expect(result.current.sortKey).toBeNull();
    expect(result.current.sortDir).toBe("asc");
  });

  it("sets new key with provided defaultDir", () => {
    const { result } = renderHook(() => useSort("name", "asc"));
    act(() => result.current.toggle("amount"));
    expect(result.current.sortKey).toBe("amount");
    expect(result.current.sortDir).toBe("asc");
  });

  it("toggles direction on same key", () => {
    const { result } = renderHook(() => useSort("name", "asc"));
    act(() => result.current.toggle("name"));
    expect(result.current.sortDir).toBe("desc");
    act(() => result.current.toggle("name"));
    expect(result.current.sortDir).toBe("asc");
  });

  it("respects custom defaultDir when switching keys", () => {
    const { result } = renderHook(() => useSort("name", "desc"));
    act(() => result.current.toggle("amount"));
    expect(result.current.sortDir).toBe("desc");
  });
});

describe("sortRows", () => {
  const rows = [
    { name: "Charlie", amount: 300, active: true },
    { name: "Alice", amount: 100, active: false },
    { name: "Bob", amount: 200, active: true },
  ];

  it("returns rows unchanged when key is null", () => {
    expect(sortRows(rows, null, "asc")).toEqual(rows);
  });

  it("sorts strings ascending", () => {
    const sorted = sortRows(rows, "name", "asc");
    expect(sorted.map((r) => r.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("sorts strings descending", () => {
    const sorted = sortRows(rows, "name", "desc");
    expect(sorted.map((r) => r.name)).toEqual(["Charlie", "Bob", "Alice"]);
  });

  it("sorts numbers ascending", () => {
    const sorted = sortRows(rows, "amount", "asc");
    expect(sorted.map((r) => r.amount)).toEqual([100, 200, 300]);
  });

  it("sorts numbers descending", () => {
    const sorted = sortRows(rows, "amount", "desc");
    expect(sorted.map((r) => r.amount)).toEqual([300, 200, 100]);
  });

  it("sorts booleans (true first in ascending)", () => {
    const sorted = sortRows(rows, "active", "asc");
    expect(sorted.map((r) => r.active)).toEqual([true, true, false]);
  });

  it("pushes null values to end regardless of direction", () => {
    const withNull = [...rows, { name: null as unknown as string, amount: 50, active: false }];
    const asc = sortRows(withNull, "name", "asc");
    expect(asc[asc.length - 1].name).toBeNull();
    const desc = sortRows(withNull, "name", "desc");
    expect(desc[desc.length - 1].name).toBeNull();
  });

  it("does not mutate the original array", () => {
    const original = [...rows];
    sortRows(rows, "name", "asc");
    expect(rows).toEqual(original);
  });
});

describe("useSort + sortRows integration", () => {
  it("toggles direction after switching to a new key", () => {
    const { result } = renderHook(() => useSort("name", "asc"));
    act(() => result.current.toggle("amount")); // switch to amount, dir = asc
    act(() => result.current.toggle("amount")); // same key, should flip to desc
    expect(result.current.sortDir).toBe("desc");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="useSort" --verbose`
Expected: FAIL — module `@/hooks/useSort` not found

- [ ] **Step 3: Implement `useSort` and `sortRows`**

```typescript
// src/hooks/useSort.ts
"use client";

import { useState, useCallback } from "react";

export type SortDir = "asc" | "desc";

/**
 * Shared hook for sortable table state.
 *
 * @param defaultKey  Initial sort column (null = unsorted)
 * @param defaultDir  Direction used on init AND when switching to a new column
 */
export function useSort(defaultKey: string | null = null, defaultDir: SortDir = "asc") {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggle = useCallback(
    (key: string) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(defaultDir);
      }
    },
    [sortKey, defaultDir],
  );

  return { sortKey, sortDir, toggle } as const;
}

/**
 * Sort an array of objects by a given key. Handles strings, numbers, booleans,
 * and null/undefined (pushed to end). Does not mutate the input.
 */
export function sortRows<T>(rows: T[], key: string | null, dir: SortDir): T[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number")
      return dir === "asc" ? av - bv : bv - av;
    if (typeof av === "boolean" && typeof bv === "boolean")
      return dir === "asc"
        ? av === bv ? 0 : av ? -1 : 1
        : av === bv ? 0 : av ? 1 : -1;
    return dir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="useSort" --verbose`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSort.ts src/__tests__/hooks/useSort.test.ts
git commit -m "feat: extract shared useSort hook and sortRows helper"
```

---

### Task 2: Extract `SortHeader`, `DealLinks`, and format helpers

**Files:**
- Create: `src/components/ui/SortHeader.tsx`
- Create: `src/components/ui/DealLinks.tsx`
- Create: `src/lib/format-helpers.ts`
- Test: `src/__tests__/lib/format-helpers.test.ts`

**Context:**
- `SortHeader` has two variants: survey-metrics uses `px-4 py-3 font-semibold` with green hover; inspection-metrics uses `px-3 py-2 text-xs font-medium` with neutral hover. Shared version uses a `compact` prop.
- `DealLinks` in inspection-metrics hardcodes portal ID `21710069`. Shared version uses `getHubSpotDealUrl()` and `getZuperJobUrl()` from `src/lib/external-links.ts`.
- Formatters `fmtAmount` and `fmtDateShort` are defined identically in inspection-metrics at lines 168-179.

- [ ] **Step 1: Write failing tests for format helpers**

```typescript
// src/__tests__/lib/format-helpers.test.ts
import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";

describe("fmtAmount", () => {
  it("formats a positive number as USD with no decimals", () => {
    expect(fmtAmount(52247)).toBe("$52,247");
  });

  it("formats zero", () => {
    expect(fmtAmount(0)).toBe("$0");
  });

  it("returns -- for null", () => {
    expect(fmtAmount(null)).toBe("--");
  });

  it("returns -- for undefined", () => {
    expect(fmtAmount(undefined)).toBe("--");
  });
});

describe("fmtDateShort", () => {
  it("formats a date string as short US date", () => {
    expect(fmtDateShort("2026-03-15")).toBe("Mar 15, 2026");
  });

  it("returns -- for null", () => {
    expect(fmtDateShort(null)).toBe("--");
  });

  it("returns -- for undefined", () => {
    expect(fmtDateShort(undefined)).toBe("--");
  });

  it("returns -- for empty string", () => {
    expect(fmtDateShort("")).toBe("--");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="format-helpers" --verbose`
Expected: FAIL — module `@/lib/format-helpers` not found

- [ ] **Step 3: Implement format helpers**

```typescript
// src/lib/format-helpers.ts

/** Format a number as USD with no decimal places, or "--" for nullish values. */
export function fmtAmount(v: number | null | undefined): string {
  if (v === null || v === undefined) return "--";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Format a YYYY-MM-DD string as "Mon DD, YYYY", or "--" for nullish/empty values. */
export function fmtDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="format-helpers" --verbose`
Expected: All 8 tests PASS

- [ ] **Step 5: Implement `SortHeader`**

```tsx
// src/components/ui/SortHeader.tsx
"use client";

import type { SortDir } from "@/hooks/useSort";

/**
 * Clickable table header cell with sort indicator.
 *
 * @param compact  If true, uses smaller padding and muted text (inspection style).
 *                 Default is larger padding with foreground text (survey style).
 */
export function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className = "",
  compact = false,
  title,
}: {
  label: string;
  sortKey: string;
  currentKey: string | null;
  currentDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
  compact?: boolean;
  title?: string;
}) {
  const active = currentKey === sortKey;
  const base = compact
    ? "px-3 py-2 text-xs font-medium text-muted"
    : "px-4 py-3 font-semibold text-foreground";
  return (
    <th
      className={`${base} cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
      onClick={() => onSort(sortKey)}
      title={title}
    >
      {label}{" "}
      <span className="ml-1 text-xs">
        {active ? (currentDir === "asc" ? "▲" : "▼") : "⇅"}
      </span>
    </th>
  );
}
```

- [ ] **Step 6: Implement `DealLinks`**

```tsx
// src/components/ui/DealLinks.tsx
"use client";

import { getHubSpotDealUrl, getZuperJobUrl } from "@/lib/external-links";

/**
 * HubSpot + Zuper link pair for deal tables.
 * Uses external-links.ts helpers (portal ID from env, not hardcoded).
 */
export function DealLinks({
  dealId,
  zuperJobUid,
}: {
  dealId: string;
  zuperJobUid?: string | null;
}) {
  const hubspotUrl = getHubSpotDealUrl(dealId);
  const zuperUrl = getZuperJobUrl(zuperJobUid);

  return (
    <div className="flex items-center justify-center gap-2">
      <a
        href={hubspotUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-400 hover:text-emerald-300 underline text-xs"
      >
        HubSpot ↗
      </a>
      {zuperUrl && (
        <a
          href={zuperUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:text-cyan-300 underline text-xs"
        >
          Zuper ↗
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/SortHeader.tsx src/components/ui/DealLinks.tsx \
  src/lib/format-helpers.ts src/__tests__/lib/format-helpers.test.ts
git commit -m "feat: extract shared SortHeader, DealLinks, and format helpers"
```

---

## Chunk 2: Inspection Side

### Task 3: Add `scope=pipeline` fast path to inspection-metrics API

**Files:**
- Modify: `src/app/api/hubspot/inspection-metrics/route.ts:317-322`

**Context:** The full handler fetches projects, locations, AHJs, computes group metrics, and builds drill-down tables — all unnecessary when the inspections execution page only needs the `outstandingFailed` and `ccPendingInspection` arrays. The fast path short-circuits after fetching projects + Zuper jobs.

- [ ] **Step 1: Add `scope` param parsing and fast path**

In `src/app/api/hubspot/inspection-metrics/route.ts`, insert a `scope` parameter check right after line 321 (`const forceRefresh = ...`). When `scope=pipeline`, fetch only projects + Zuper jobs and return the two pipeline arrays.

```typescript
// After line 321: const forceRefresh = searchParams.get("refresh") === "true";
// Add:
const scope = searchParams.get("scope");

// Fast path: return only action queue data for execution pages
if (scope === "pipeline") {
  const { data: allProjects, lastUpdated } = await appCache.getOrFetch<Project[]>(
    CACHE_KEYS.PROJECTS_ALL,
    () => fetchAllProjects({ activeOnly: false }),
    forceRefresh,
  );
  const projects = allProjects || [];

  // Only fetch Zuper jobs for active pipeline-relevant deals
  const pipelineIds: string[] = [];
  for (const p of projects) {
    if (p.isActive && (p.constructionCompleteDate || p.hasInspectionFailed)) {
      pipelineIds.push(String(p.id));
    }
  }
  const zuperJobs = await getCachedZuperJobsByDealIds(pipelineIds, "Construction");
  const zuperByDeal = new Map<string, string>();
  for (const job of zuperJobs) {
    if (job.hubspotDealId) zuperByDeal.set(job.hubspotDealId, job.jobUid);
  }

  const ccPendingInspection = projects
    .filter((p) => p.constructionCompleteDate && !p.inspectionPassDate && p.isActive)
    .map((p) => buildPipelineDeal(p, zuperByDeal))
    .sort((a, b) => (b.daysSinceCc ?? 0) - (a.daysSinceCc ?? 0));

  const outstandingFailed = projects
    .filter((p) => p.hasInspectionFailed && !p.inspectionPassDate && p.isActive)
    .map((p) => buildPipelineDeal(p, zuperByDeal))
    .sort((a, b) => (b.daysSinceLastFail ?? 0) - (a.daysSinceLastFail ?? 0));

  return NextResponse.json({
    ccPendingInspection,
    outstandingFailed,
    lastUpdated: lastUpdated || new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in `inspection-metrics/route.ts`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/hubspot/inspection-metrics/route.ts
git commit -m "feat: add scope=pipeline fast path to inspection-metrics API"
```

---

### Task 4: Add failed/pending tables to inspections execution page + remove AHJ card

**Files:**
- Modify: `src/app/dashboards/inspections/page.tsx`

**Context:** This task has three sub-changes:
1. Add a secondary fetch to `/api/hubspot/inspection-metrics?scope=pipeline`
2. Add the Outstanding Failed and CC Pending tables after the main project listing
3. Remove the AHJ breakdown card (lines 588-628) and its `ahjStats` computation (lines 338-362), and convert the 2-col grid to single-column since only the status breakdown card remains

**Critical: Keep** `filterAhjs` state, the AHJ `MultiSelectFilter` dropdown, and all `filterAhjs` references in `filteredProjects` / `hasActiveFilters` / `clearAllFilters`.

- [ ] **Step 1: Add imports for shared components**

At the top of `src/app/dashboards/inspections/page.tsx`, add:

```typescript
import { useSort, sortRows } from "@/hooks/useSort";
import { SortHeader } from "@/components/ui/SortHeader";
import { DealLinks } from "@/components/ui/DealLinks";
import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";
```

Also add `useQuery` import if not already present (the page currently uses `useProjectData`, but we need a second query):

```typescript
import { useQuery } from "@tanstack/react-query";
```

- [ ] **Step 2: Add secondary data fetch for pipeline data**

After the existing `useProjectData` call (around line 133), add:

```typescript
const { data: pipelineData, refetch: refetchPipeline } = useQuery({
  queryKey: ["inspection-pipeline"],
  queryFn: async () => {
    const res = await fetch("/api/hubspot/inspection-metrics?scope=pipeline");
    if (!res.ok) throw new Error("Failed to fetch pipeline data");
    return res.json() as Promise<{
      outstandingFailed: Array<{
        dealId: string; projectNumber: string; name: string; url: string;
        pbLocation: string; ahj: string; stage: string; amount: number;
        inspectionFailDate: string | null; inspectionFailCount: number | null;
        inspectionFailureReason: string | null; daysSinceLastFail: number | null;
        constructionCompleteDate: string | null; daysSinceCc: number | null;
        inspectionScheduleDate: string | null; inspectionBookedDate: string | null;
        readyForInspection: string | null; zuperJobUid: string | null;
      }>;
      ccPendingInspection: Array<{
        dealId: string; projectNumber: string; name: string; url: string;
        pbLocation: string; ahj: string; stage: string; amount: number;
        constructionCompleteDate: string | null; daysSinceCc: number | null;
        inspectionScheduleDate: string | null; inspectionBookedDate: string | null;
        readyForInspection: string | null; zuperJobUid: string | null;
        inspectionFailDate: string | null; inspectionFailCount: number | null;
        inspectionFailureReason: string | null; daysSinceLastFail: number | null;
      }>;
    }>;
  },
  staleTime: 5 * 60 * 1000,
});
```

- [ ] **Step 3: Wire the Refresh action to refetch both queries**

Find the existing Refresh button or `refetch` usage on the page. In the `DashboardShell` or wherever `refetch` is called, replace `refetch()` with:

```typescript
const handleRefresh = () => {
  refetch();
  refetchPipeline();
};
```

Wire this into the DashboardShell or wherever the refresh trigger is.

- [ ] **Step 4: Add filtered pipeline memos**

After the existing `filteredProjects` memo, add computed arrays that apply the page's active filters to the pipeline data:

```typescript
const filteredFailed = useMemo(() => {
  if (!pipelineData?.outstandingFailed) return [];
  return pipelineData.outstandingFailed.filter((r) => {
    if (filterLocations.length > 0 && !filterLocations.includes(r.pbLocation)) return false;
    if (filterAhjs.length > 0 && !filterAhjs.includes(r.ahj)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !(r.projectNumber || "").toLowerCase().includes(q) &&
        !(r.name || "").toLowerCase().includes(q) &&
        !(r.pbLocation || "").toLowerCase().includes(q) &&
        !(r.ahj || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });
}, [pipelineData, filterLocations, filterAhjs, searchQuery]);

const filteredPending = useMemo(() => {
  if (!pipelineData?.ccPendingInspection) return [];
  return pipelineData.ccPendingInspection.filter((r) => {
    if (filterLocations.length > 0 && !filterLocations.includes(r.pbLocation)) return false;
    if (filterAhjs.length > 0 && !filterAhjs.includes(r.ahj)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !(r.projectNumber || "").toLowerCase().includes(q) &&
        !(r.name || "").toLowerCase().includes(q) &&
        !(r.pbLocation || "").toLowerCase().includes(q) &&
        !(r.ahj || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });
}, [pipelineData, filterLocations, filterAhjs, searchQuery]);
```

**Note:** `filterInspectionStatuses` is deliberately NOT applied here — these tables span multiple stages by definition.

- [ ] **Step 5: Add sort state for both tables**

After the pipeline memos, add:

```typescript
const failedSort = useSort("daysSinceLastFail", "desc");
const pendingSort = useSort("daysSinceCc", "desc");
```

- [ ] **Step 6: Remove AHJ breakdown card from the 2-col grid**

In `src/app/dashboards/inspections/page.tsx`, find the 2-column grid (line 551-629):

1. Delete the entire AHJ Breakdown card block (lines 588-628, from `{/* AHJ Breakdown */}` through its closing `</div>`)
2. Change the grid from `grid grid-cols-1 md:grid-cols-2` to just remove the grid wrapper entirely — the status breakdown card can be a standalone `<div>` with a `mb-6` class. Or keep the grid but change to `grid-cols-1`:

```tsx
{/* Status Breakdown */}
<div className="mb-6">
  <div className="bg-surface rounded-xl border border-t-border p-4">
    {/* ... existing status breakdown content stays exactly as-is ... */}
  </div>
</div>
```

- [ ] **Step 7: Remove `ahjStats` from the `stats` useMemo**

In the `stats` useMemo (lines 286-376):

1. Delete the entire "Group by AHJ" block (lines 338-362)
2. Remove `ahjStats` from the return object (line 374)

The `stats` useMemo should now return:

```typescript
return {
  total: filteredProjects.length,
  totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
  inspectionPending,
  inspectionPassed,
  inspectionFailed,
  avgDaysInInspection,
  avgTurnaround,
  passRate,
  inspectionStatusStats,
};
```

- [ ] **Step 8: Add Outstanding Failed Inspections table JSX**

After the Projects Table section (after line 974, before `</DashboardShell>`), add:

```tsx
{/* Outstanding Failed Inspections */}
{filteredFailed.length > 0 && (
  <div className="bg-surface border border-t-border rounded-xl overflow-hidden mt-6 border-l-4 border-l-red-500">
    <div className="px-5 py-4 border-b border-t-border">
      <h2 className="text-lg font-semibold text-foreground">Outstanding Failed Inspections</h2>
      <p className="text-sm text-muted mt-0.5">
        {filteredFailed.length} project{filteredFailed.length !== 1 ? "s" : ""} with failed inspection awaiting reinspection
      </p>
    </div>
    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-t-border bg-surface-2/50">
            <SortHeader compact label="Project" sortKey="projectNumber" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
            <SortHeader compact label="Customer" sortKey="name" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
            <SortHeader compact label="PB Location" sortKey="pbLocation" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
            <SortHeader compact label="AHJ" sortKey="ahj" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
            <SortHeader compact label="Stage" sortKey="stage" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
            <SortHeader compact label="Amount" sortKey="amount" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} className="text-right" />
            <SortHeader compact label="Fail Date" sortKey="inspectionFailDate" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
            <SortHeader compact label="Fail Count" sortKey="inspectionFailCount" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} className="text-center" />
            <SortHeader compact label="Failure Reason" sortKey="inspectionFailureReason" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
            <SortHeader compact label="Days Since Fail" sortKey="daysSinceLastFail" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} className="text-center" />
            <th className="px-3 py-2 text-center text-xs font-medium text-muted">Links</th>
          </tr>
        </thead>
        <tbody>
          {sortRows(filteredFailed, failedSort.sortKey, failedSort.sortDir).map((row, i) => (
            <tr key={row.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
              <td className="px-3 py-2.5 font-mono text-foreground">{row.projectNumber}</td>
              <td className="px-3 py-2.5 text-foreground truncate max-w-[180px]">{row.name}</td>
              <td className="px-3 py-2.5 text-muted">{row.pbLocation}</td>
              <td className="px-3 py-2.5 text-muted">{row.ahj}</td>
              <td className="px-3 py-2.5 text-muted">{row.stage}</td>
              <td className="px-3 py-2.5 text-right text-muted">{fmtAmount(row.amount)}</td>
              <td className="px-3 py-2.5 text-muted">{fmtDateShort(row.inspectionFailDate)}</td>
              <td className={`px-3 py-2.5 text-center font-mono ${(row.inspectionFailCount ?? 0) > 0 ? "text-red-400" : "text-muted"}`}>
                {row.inspectionFailCount ?? 0}
              </td>
              <td className="px-3 py-2.5 text-muted truncate max-w-[200px]">{row.inspectionFailureReason || "--"}</td>
              <td className={`px-3 py-2.5 text-center font-mono font-medium ${
                (row.daysSinceLastFail ?? 0) > 14 ? "text-red-400" :
                (row.daysSinceLastFail ?? 0) > 7 ? "text-orange-400" : "text-yellow-400"
              }`}>
                {row.daysSinceLastFail ?? "--"}d
              </td>
              <td className="px-3 py-2.5"><DealLinks dealId={row.dealId} zuperJobUid={row.zuperJobUid} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 9: Add CC Pending Inspection table JSX**

Immediately after the failed inspections table, add:

```tsx
{/* CC Pending Inspection */}
{filteredPending.length > 0 && (
  <div className="bg-surface border border-t-border rounded-xl overflow-hidden mt-6">
    <div className="px-5 py-4 border-b border-t-border">
      <h2 className="text-lg font-semibold text-foreground">CC Pending Inspection</h2>
      <p className="text-sm text-muted mt-0.5">
        {filteredPending.length} project{filteredPending.length !== 1 ? "s" : ""} construction-complete awaiting inspection
      </p>
    </div>
    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-t-border bg-surface-2/50">
            <SortHeader compact label="Project" sortKey="projectNumber" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
            <SortHeader compact label="Customer" sortKey="name" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
            <SortHeader compact label="PB Location" sortKey="pbLocation" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
            <SortHeader compact label="AHJ" sortKey="ahj" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
            <SortHeader compact label="Stage" sortKey="stage" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
            <SortHeader compact label="Amount" sortKey="amount" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-right" />
            <SortHeader compact label="CC Date" sortKey="constructionCompleteDate" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
            <SortHeader compact label="Days Since CC" sortKey="daysSinceCc" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-center" />
            <SortHeader compact label="Insp Scheduled" sortKey="inspectionScheduleDate" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
            <SortHeader compact label="Booked Date" sortKey="inspectionBookedDate" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
            <SortHeader compact label="Ready" sortKey="readyForInspection" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-center" />
            <th className="px-3 py-2 text-center text-xs font-medium text-muted">Links</th>
          </tr>
        </thead>
        <tbody>
          {sortRows(filteredPending, pendingSort.sortKey, pendingSort.sortDir).map((row, i) => (
            <tr key={row.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
              <td className="px-3 py-2.5 font-mono text-foreground">{row.projectNumber}</td>
              <td className="px-3 py-2.5 text-foreground truncate max-w-[180px]">{row.name}</td>
              <td className="px-3 py-2.5 text-muted">{row.pbLocation}</td>
              <td className="px-3 py-2.5 text-muted">{row.ahj}</td>
              <td className="px-3 py-2.5 text-muted">{row.stage}</td>
              <td className="px-3 py-2.5 text-right text-muted">{fmtAmount(row.amount)}</td>
              <td className="px-3 py-2.5 text-muted">{fmtDateShort(row.constructionCompleteDate)}</td>
              <td className={`px-3 py-2.5 text-center font-mono font-medium ${
                (row.daysSinceCc ?? 0) > 30 ? "text-red-400" :
                (row.daysSinceCc ?? 0) > 14 ? "text-orange-400" :
                (row.daysSinceCc ?? 0) > 7 ? "text-yellow-400" : "text-emerald-400"
              }`}>
                {row.daysSinceCc ?? "--"}d
              </td>
              <td className="px-3 py-2.5 text-muted">{fmtDateShort(row.inspectionScheduleDate)}</td>
              <td className="px-3 py-2.5 text-muted">{fmtDateShort(row.inspectionBookedDate)}</td>
              <td className="px-3 py-2.5 text-center">
                {row.readyForInspection ? (
                  <span className="text-emerald-400" title="Ready">&#10003;</span>
                ) : (
                  <span className="text-muted" title="Not ready">&#10007;</span>
                )}
              </td>
              <td className="px-3 py-2.5"><DealLinks dealId={row.dealId} zuperJobUid={row.zuperJobUid} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 10: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add src/app/dashboards/inspections/page.tsx
git commit -m "feat: add failed/pending tables to inspections, remove AHJ card"
```

---

### Task 5: Remove failed/pending tables from inspection-metrics page

**Files:**
- Modify: `src/app/dashboards/inspection-metrics/page.tsx`

**Context:** The Outstanding Failed Inspections (lines 978-1050) and CC Pending Inspection (lines 1051-1131) sections now live on the inspections execution page. Remove them along with:
- `failedRows` memo (lines 382-388)
- `pendingRows` memo (lines 390-397)
- `failedSort` state (line 283)
- `pendingSort` state (line 284)

The local `SortHeader`, `useSort`, `sortRows`, `DealLinks`, `fmtAmount`, `fmtDateShort` can be replaced with shared imports. However, the same page's **AHJ Performance table** and **Location Performance table** also use these helpers. Replace local definitions with shared imports.

- [ ] **Step 1: Replace local helpers with shared imports**

At the top of `src/app/dashboards/inspection-metrics/page.tsx`:

1. Add imports:
```typescript
import { useSort, sortRows } from "@/hooks/useSort";
import { SortHeader } from "@/components/ui/SortHeader";
import { DealLinks } from "@/components/ui/DealLinks";
import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";
```

2. Delete the local definitions:
   - `type SortDir` and local `useSort` function (lines 183-198)
   - Local `sortRows` function (lines 199-211)
   - Local `SortHeader` component (lines 213-240)
   - Local `DealLinks` component (lines 242-265)
   - Local `fmtAmount` function (lines 168-171)
   - Local `fmtDateShort` function (lines 173-179)

**API differences to handle during migration:**
- The local `SortHeader` uses `onToggle` prop. The shared version uses `onSort`. Update all `SortHeader` usages in the remaining tables (AHJ Performance, Location Performance) from `onToggle={sort.toggle}` to `onSort={sort.toggle}`.
- The local `SortHeader` uses non-nullable `currentKey: string`. The shared version uses `currentKey: string | null`. No changes needed — `string` is assignable to `string | null`.
- The local version uses standard styling. Add `compact` prop to match the existing small style: all existing `SortHeader` usages on this page should get `compact` since they use the smaller padding.

- [ ] **Step 2: Remove failed/pending tables and their state**

1. Delete `failedSort` and `pendingSort` declarations (lines 283-284)
2. Delete `failedRows`, `sortedFailedRows`, `pendingRows`, and `sortedPendingRows` memos (lines 382-406)
3. Delete the "Outstanding Failed Inspections" JSX section (lines 978-1050)
4. Delete the "CC Pending Inspection" JSX section (lines 1051-1131)
5. Delete the now-dead `HUBSPOT_BASE` and `ZUPER_BASE_URL` constants (lines 108-109) — they were only used by the local `DealLinks` being removed

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Verify the page loads correctly**

Run: `npm run dev` (if not already running)
Navigate to `/dashboards/inspection-metrics` — verify:
- Stat cards render
- Location Performance table renders with sorting
- AHJ Performance table renders with drill-down
- No failed/pending tables visible
- No console errors

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/inspection-metrics/page.tsx
git commit -m "refactor: remove failed/pending tables from inspection-metrics, use shared imports"
```

---

## Chunk 3: Survey Side

### Task 6: Add past-due and upcoming survey tables to site-survey execution page

**Files:**
- Modify: `src/app/dashboards/site-survey/page.tsx`

**Context:** The site-survey page uses `useProjectData` with `context: "executive"` to get all projects. It currently filters out completed surveys at line 96 (`if (p.siteSurveyCompletionDate) return false`). The past-due and upcoming tables must be computed from the **unfiltered** projects array (before the completion filter), then have the page's active filters (location, stage, search) applied.

The `RawProject` interface (from `src/lib/types.ts`) has `siteSurveyor` (line 114), `siteSurveyScheduleDate`, `siteSurveyCompletionDate`, `url`, and `id` (already a `string`). It does **not** have a `projectNumber` field — the project number is embedded in `name` as `"PROJ-XXXX | Customer Name"` and must be extracted via `name.split('|')[0].trim()`. The `zuperJobUid` field is not on `RawProject` — the `DealLinks` component will use only the HubSpot URL.

- [ ] **Step 1: Add imports for shared components**

At the top of `src/app/dashboards/site-survey/page.tsx`, add:

```typescript
import { useSort, sortRows } from "@/hooks/useSort";
import { SortHeader } from "@/components/ui/SortHeader";
import { DealLinks } from "@/components/ui/DealLinks";
import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";
```

- [ ] **Step 2: Add past-due and upcoming computed arrays**

After the existing `filteredProjects` memo (around line 118), add the survey classification logic. This computes from the **raw** `rawProjects` array before the completion filter:

```typescript
const surveyClassification = useMemo(() => {
  if (!rawProjects) return { pastDue: [], upcoming: [] };

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const pastDue: Array<typeof rawProjects[number] & { daysUntil: number }> = [];
  const upcoming: Array<typeof rawProjects[number] & { daysUntil: number }> = [];

  for (const p of rawProjects) {
    // Must have a scheduled date and no completion date
    if (!p.siteSurveyScheduleDate || p.siteSurveyCompletionDate) continue;
    // Must be in a site-survey-relevant phase
    if (!isInSiteSurveyPhase(p)) continue;

    const schedDate = new Date(p.siteSurveyScheduleDate + "T00:00:00");
    const daysUntil = Math.floor((schedDate.getTime() - todayMidnight.getTime()) / 86400000);

    const augmented = { ...p, daysUntil };
    if (daysUntil < 0) {
      pastDue.push(augmented);
    } else {
      upcoming.push(augmented);
    }
  }

  return { pastDue, upcoming };
}, [rawProjects]);
```

- [ ] **Step 3: Add filtered versions that respect page filters**

After the classification memo, add filtered versions applying the page's active location, stage, and search filters (but NOT status filter — these tables define their own status criteria):

```typescript
const filteredPastDue = useMemo(() => {
  return surveyClassification.pastDue.filter((p) => {
    if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
    if (filterStages.length > 0 && !filterStages.includes(p.stage || "")) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !(p.name || "").toLowerCase().includes(q) &&
        !(p.pbLocation || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });
}, [surveyClassification.pastDue, filterLocations, filterStages, searchQuery]);

const filteredUpcoming = useMemo(() => {
  return surveyClassification.upcoming.filter((p) => {
    if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
    if (filterStages.length > 0 && !filterStages.includes(p.stage || "")) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !(p.name || "").toLowerCase().includes(q) &&
        !(p.pbLocation || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });
}, [surveyClassification.upcoming, filterLocations, filterStages, searchQuery]);
```

- [ ] **Step 4: Add sort state**

```typescript
const pastDueSort = useSort("daysUntil", "asc");
const upcomingSort = useSort("daysUntil", "asc");
```

- [ ] **Step 5: Add Past Due Surveys table JSX**

Insert after the main Projects Table closing `</div>` (line 474), before `</DashboardShell>` (line 475):

```tsx
{/* Past Due Surveys */}
{filteredPastDue.length > 0 && (
  <div className="bg-surface border border-red-500/30 rounded-xl overflow-hidden mt-6">
    <div className="px-5 py-4 border-b border-t-border">
      <h2 className="text-lg font-semibold text-foreground">Past Due Surveys</h2>
      <p className="text-sm text-muted mt-0.5">
        {filteredPastDue.length} survey{filteredPastDue.length !== 1 ? "s" : ""} where the scheduled date has passed but survey is not complete
      </p>
    </div>
    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-t-border bg-surface-2/50">
            <SortHeader label="Project" sortKey="name" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
            <SortHeader label="Customer" sortKey="name" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
            <SortHeader label="Location" sortKey="pbLocation" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
            <SortHeader label="Surveyor" sortKey="siteSurveyor" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
            <SortHeader label="Stage" sortKey="stage" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
            <SortHeader label="Amount" sortKey="amount" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-right" />
            <SortHeader label="Scheduled" sortKey="siteSurveyScheduleDate" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-center" />
            <SortHeader label="Days Overdue" sortKey="daysUntil" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-center" />
            <th className="text-center px-4 py-3 font-semibold text-foreground">Links</th>
          </tr>
        </thead>
        <tbody>
          {sortRows(filteredPastDue, pastDueSort.sortKey, pastDueSort.sortDir).map((p, i) => (
            <tr key={p.id} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
              <td className="px-4 py-3 font-mono text-foreground">{p.name.split("|")[0].trim()}</td>
              <td className="px-4 py-3 text-foreground truncate max-w-[180px]">{p.name.split("|")[1]?.trim() || ""}</td>
              <td className="px-4 py-3 text-muted">{p.pbLocation}</td>
              <td className="px-4 py-3 text-muted">{p.siteSurveyor || "--"}</td>
              <td className="px-4 py-3 text-muted">{p.stage}</td>
              <td className="px-4 py-3 text-right text-muted">{fmtAmount(p.amount)}</td>
              <td className="text-center px-4 py-3 text-muted">{fmtDateShort(p.siteSurveyScheduleDate)}</td>
              <td className={`text-center px-4 py-3 font-mono font-medium ${
                Math.abs(p.daysUntil) > 7 ? "text-red-400" :
                Math.abs(p.daysUntil) > 3 ? "text-orange-400" : "text-yellow-400"
              }`}>
                {Math.abs(p.daysUntil)}d overdue
              </td>
              <td className="text-center px-4 py-3">
                <DealLinks dealId={p.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 6: Add Upcoming Surveys table JSX**

Immediately after the past-due table:

```tsx
{/* Upcoming Surveys */}
{filteredUpcoming.length > 0 && (
  <div className="bg-surface border border-t-border rounded-xl overflow-hidden mt-6">
    <div className="px-5 py-4 border-b border-t-border">
      <h2 className="text-lg font-semibold text-foreground">Upcoming Surveys</h2>
      <p className="text-sm text-muted mt-0.5">
        {filteredUpcoming.length} survey{filteredUpcoming.length !== 1 ? "s" : ""} scheduled for a future date
      </p>
    </div>
    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-t-border bg-surface-2/50">
            <SortHeader label="Project" sortKey="name" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
            <SortHeader label="Customer" sortKey="name" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
            <SortHeader label="Location" sortKey="pbLocation" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
            <SortHeader label="Surveyor" sortKey="siteSurveyor" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
            <SortHeader label="Stage" sortKey="stage" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
            <SortHeader label="Amount" sortKey="amount" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-right" />
            <SortHeader label="Scheduled" sortKey="siteSurveyScheduleDate" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-center" />
            <SortHeader label="Days Until" sortKey="daysUntil" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-center" />
            <th className="text-center px-4 py-3 font-semibold text-foreground">Links</th>
          </tr>
        </thead>
        <tbody>
          {sortRows(filteredUpcoming, upcomingSort.sortKey, upcomingSort.sortDir).map((p, i) => (
            <tr key={p.id} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
              <td className="px-4 py-3 font-mono text-foreground">{p.name.split("|")[0].trim()}</td>
              <td className="px-4 py-3 text-foreground truncate max-w-[180px]">{p.name.split("|")[1]?.trim() || ""}</td>
              <td className="px-4 py-3 text-muted">{p.pbLocation}</td>
              <td className="px-4 py-3 text-muted">{p.siteSurveyor || "--"}</td>
              <td className="px-4 py-3 text-muted">{p.stage}</td>
              <td className="px-4 py-3 text-right text-muted">{fmtAmount(p.amount)}</td>
              <td className="text-center px-4 py-3 text-muted">{fmtDateShort(p.siteSurveyScheduleDate)}</td>
              <td className={`text-center px-4 py-3 font-mono font-medium ${
                p.daysUntil <= 1 ? "text-emerald-400" :
                p.daysUntil <= 3 ? "text-yellow-400" : "text-muted"
              }`}>
                {p.daysUntil}d
              </td>
              <td className="text-center px-4 py-3">
                <DealLinks dealId={p.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 7: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboards/site-survey/page.tsx
git commit -m "feat: add past-due and upcoming survey tables to site-survey execution"
```

---

### Task 7: Remove past-due and upcoming tables from survey-metrics page

**Files:**
- Modify: `src/app/dashboards/survey-metrics/page.tsx`

**Context:** The past-due and upcoming tables now live on the site-survey execution page. Remove them along with:
- `renderAwaitingTable()` helper (lines 348-413)
- `pastDueSort` and `upcomingSort` state (lines 162-163)
- `filteredPastDue` and `filteredUpcoming` memos (lines 212-222)
- `sortedPastDue` and `sortedUpcoming` computed rows (lines 280-281)
- The "Past Due Surveys" JSX section (lines 605-618)
- The "Upcoming Surveys" JSX section (lines 620-633)

**Note:** Line numbers below are from the current baseline. Earlier tasks in this plan don't modify this file, so they should be accurate. If they've drifted, search for the function/variable names.

The local `SortHeader`, `useSort`, `sortRows` remain on this page — they're still used by the Location and Surveyor drill-down tables. They can optionally be migrated to shared imports in a follow-up, but this is not required for the current scope.

The stat cards for "Upcoming Surveys" count and "Past Due" count (lines 495-508) **stay** — they show summary counts. After removal, update them to use the data directly from the API response rather than the deleted `filteredUpcoming`/`filteredPastDue`:

```typescript
// Replace filteredUpcoming.length with:
data?.upcomingSurveys?.length ?? 0

// Replace filteredPastDue.length with:
data?.pastDueSurveys?.length ?? 0
```

- [ ] **Step 1: Delete the `renderAwaitingTable` helper**

Delete lines 348-413 (the entire `renderAwaitingTable` function).

- [ ] **Step 2: Delete sort state and computed arrays**

1. Delete `pastDueSort` and `upcomingSort` declarations (lines 162-163, but leave `drillSort` at line 161)
2. Delete `filteredPastDue` and `filteredUpcoming` memos (lines 212-222)
3. Delete `sortedPastDue` and `sortedUpcoming` (lines 280-281)

- [ ] **Step 3: Delete table JSX sections**

1. Delete the "Past Due Surveys" section (lines 605-618)
2. Delete the "Upcoming Surveys" section (lines 620-633)

- [ ] **Step 4: Update stat cards to use API data directly**

The "Upcoming Surveys" stat card (around line 497) currently uses `filteredUpcoming.length`. Replace with `data?.upcomingSurveys?.length ?? 0`.

The "Past Due" stat card (around line 504) currently uses `filteredPastDue.length`. Replace with `data?.pastDueSurveys?.length ?? 0`. Also update the conditional color: `${(data?.pastDueSurveys?.length ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}`.

- [ ] **Step 5: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/survey-metrics/page.tsx
git commit -m "refactor: remove past-due/upcoming tables from survey-metrics"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --verbose 2>&1 | tail -30`
Expected: All tests pass, including the new `useSort.test.ts` and `format-helpers.test.ts`

- [ ] **Step 2: Run the type checker**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Commit any lint fixes if needed**

```bash
git add -u
git commit -m "chore: lint fixes"
```
