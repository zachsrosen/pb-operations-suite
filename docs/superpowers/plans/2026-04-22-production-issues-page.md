# Production Issues Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new Design Suite page at `/dashboards/production-issues` that lists every project currently flagged with `system_performance_review = true`, with five breakdown cards (location, stage, clipping risk, deal owner, equipment) for pattern-spotting. Read-only — flag toggle stays on Clipping Analytics.

**Architecture:** Client component reusing `useProjectData` (same executive dataset Clipping Analytics consumes). All filtering and aggregation happens client-side against the flagged subset (`systemPerformanceReview === true`). Pure aggregation helpers live in `src/lib/production-issues-aggregations.ts` and are unit-tested in isolation. No new API routes, no DB changes, no migrations. One typing change (widen `RawProject.equipment`) to match runtime shape.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Tailwind v4, React Query v5, Jest. Existing project primitives: `DashboardShell`, `MiniStat`, `MultiSelectFilter`, `analyzeClipping()`.

**Spec reference:** `docs/superpowers/specs/2026-04-22-production-issues-page-design.md`

---

## Chunk 1: Foundations — types, helpers, filters, plumbing

### Task 1: Widen `RawProject.equipment` type to match runtime shape

**Files:**
- Modify: `src/lib/types.ts:54-60`

The runtime shape (`FullEquipment` in `src/lib/clipping.ts:9-15`) is richer than the declared type — brand, model, wattage, and sizeKwac all exist at runtime but are not in the type. This blocks the Equipment breakdown card and Inverter/Module/Battery columns from typechecking.

- [ ] **Step 1: Read current declaration**

Open `src/lib/types.ts`, confirm lines 54-60 match the spec.

- [ ] **Step 2: Widen the equipment sub-fields**

Replace the current `equipment?` block (lines 54-60) with:

```ts
  equipment?: {
    systemSizeKwdc?: number;
    systemSizeKwac?: number;
    modules?: { count?: number; brand?: string; model?: string; wattage?: number };
    inverter?: { count?: number; brand?: string; model?: string; sizeKwac?: number };
    battery?: {
      count?: number;
      expansionCount?: number;
      brand?: string;
      model?: string;
      sizeKwh?: number;
    };
    evCount?: number;
  };
```

Rationale: mirrors `FullEquipment` from `src/lib/clipping.ts:9-15` so `analyzeClipping()` and downstream consumers typecheck without `as FullEquipment` casts. All additions are optional — no runtime behavior change.

- [ ] **Step 3: Typecheck project-wide**

Run: `npx tsc --noEmit`
Expected: PASS. If any new error surfaces, it's a consumer that was relying on the narrow shape — fix in place.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "types(project): widen RawProject.equipment to match runtime (FullEquipment)"
```

---

### Task 2: Aggregation helpers (TDD)

**Files:**
- Create: `src/lib/production-issues-aggregations.ts`
- Create: `src/__tests__/production-issues-aggregations.test.ts`

Pure functions used by the page. Keeping them pure + unit-tested makes regressions cheap to catch.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/production-issues-aggregations.test.ts`:

```ts
import { bucketStage, topByKey } from "@/lib/production-issues-aggregations";

describe("bucketStage", () => {
  it.each([
    ["PTO'd", "pto"],
    ["PTO Received", "pto"],
    ["Permission to Operate", "pto"],
    ["Complete", "pto"],
    ["Operating", "pto"],
    ["Service Ticket Open", "service"],
    ["In Progress", "service"],
    ["Open", "service"],
    ["Site Survey", "active"],
    ["Ready to Build", "active"],
    ["Design", "active"],
    ["Permitting", "active"],
    ["Interconnection Submitted", "active"],
    ["Construction", "active"],
    ["Inspection", "active"],
    ["Install Scheduled", "active"],
    ["RTB - Blocked", "active"],
    ["Closed Lost", "other"],
    ["Some Weird Stage", "other"],
    ["", "other"],
  ])("maps %s → %s", (input, expected) => {
    expect(bucketStage(input)).toBe(expected);
  });

  it("treats null/undefined as 'other'", () => {
    expect(bucketStage(null)).toBe("other");
    expect(bucketStage(undefined)).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(bucketStage("pto")).toBe("pto");
    expect(bucketStage("PTO")).toBe("pto");
    expect(bucketStage("construction")).toBe("active");
  });
});

describe("topByKey", () => {
  const rows = [
    { owner: "Alice" },
    { owner: "Alice" },
    { owner: "Bob" },
    { owner: "Bob" },
    { owner: "Bob" },
    { owner: "" },
    { owner: undefined },
  ] as { owner?: string }[];

  it("counts and sorts descending", () => {
    const result = topByKey(rows, (r) => r.owner, 10);
    expect(result).toEqual([
      { key: "Bob", count: 3 },
      { key: "Alice", count: 2 },
      { key: "Unassigned", count: 2 },
    ]);
  });

  it("limits output length", () => {
    const result = topByKey(rows, (r) => r.owner, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ key: "Bob", count: 3 });
  });

  it("breaks ties by key natural order", () => {
    const tied = [{ k: "b" }, { k: "a" }, { k: "c" }];
    const result = topByKey(tied, (r) => r.k, 10);
    expect(result.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("collapses missing keys into Unassigned", () => {
    const only = [{ k: "" }, { k: null }, { k: undefined }] as { k?: string | null }[];
    const result = topByKey(only, (r) => r.k, 10);
    expect(result).toEqual([{ key: "Unassigned", count: 3 }]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx jest src/__tests__/production-issues-aggregations.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement helpers**

Create `src/lib/production-issues-aggregations.ts`:

```ts
/**
 * Pure aggregation helpers for the Production Issues dashboard.
 * Standalone of forecast-ghosts.ts:mapStage because that helper does not
 * recognize PTO or service-pipeline stage names (spec decision).
 */

export type StageBucket = "pto" | "service" | "active" | "other";

// First-match-wins. Order matters — keep most-specific buckets first.
const BUCKET_RULES: Array<{ bucket: StageBucket; needles: string[] }> = [
  { bucket: "pto", needles: ["pto", "permission to operate", "operating", "complete"] },
  { bucket: "service", needles: ["service", "ticket", "in progress", "open"] },
  {
    bucket: "active",
    needles: [
      "survey", "rtb", "ready to build", "design", "permit", "interconnect",
      "construction", "inspection", "install", "blocked",
    ],
  },
];

export function bucketStage(stageRaw: string | null | undefined): StageBucket {
  const stage = (stageRaw || "").trim().toLowerCase();
  if (!stage) return "other";
  for (const rule of BUCKET_RULES) {
    if (rule.needles.some((n) => stage.includes(n))) return rule.bucket;
  }
  return "other";
}

export interface TopEntry {
  key: string;
  count: number;
}

/**
 * Count by key function and return the top-N entries sorted by count desc,
 * ties broken by natural key order. Missing/empty keys collapse into "Unassigned".
 */
export function topByKey<T>(
  rows: T[],
  keyFn: (row: T) => string | null | undefined,
  limit: number
): TopEntry[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = keyFn(row);
    const key = raw && raw.trim() ? raw.trim() : "Unassigned";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key))
    .slice(0, limit);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx jest src/__tests__/production-issues-aggregations.test.ts`
Expected: PASS (all 4+ describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/production-issues-aggregations.ts src/__tests__/production-issues-aggregations.test.ts
git commit -m "feat(lib): add bucketStage + topByKey aggregation helpers for production-issues page"
```

---

### Task 3: Filters persistence hook

**Files:**
- Modify: `src/stores/dashboard-filters.ts` (append new hook)

Mirrors `useClippingAnalyticsFilters` at `src/stores/dashboard-filters.ts:284-295`.

- [ ] **Step 1: Open `src/stores/dashboard-filters.ts`**

Locate the `useClippingAnalyticsFilters` block at line 284 to use as a template.

- [ ] **Step 2: Append the new filter hook**

Below `useClippingAnalyticsFilters` (after line 295) and before the next section, add:

```ts
// ===== Production Issues filters =====

export interface ProductionIssuesFilters {
  locations: string[];
  stages: string[]; // coarse buckets: "pto" | "service" | "active" | "other"
  dealOwners: string[];
  clippingRisks: string[]; // "none" | "low" | "moderate" | "high" | "unknown"
}

const defaultProductionIssuesFilters: ProductionIssuesFilters = {
  locations: [],
  stages: [],
  dealOwners: [],
  clippingRisks: [],
};

export function useProductionIssuesFilters() {
  const raw = useDashboardFilters(
    (s) => s.filters["production-issues"]
  ) as ProductionIssuesFilters | undefined;
  const setFilters = useDashboardFilters((s) => s.setFilters);
  return {
    filters: raw ?? defaultProductionIssuesFilters,
    setFilters: (f: ProductionIssuesFilters) => setFilters("production-issues", f),
    clearFilters: () =>
      useDashboardFilters.getState().clearFilters("production-issues"),
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/stores/dashboard-filters.ts
git commit -m "feat(stores): add useProductionIssuesFilters persistence hook"
```

---

### Task 4: Role allowlist + page-directory entry + DashboardShell suite map

**Files:**
- Modify: `src/lib/roles.ts` (four role blocks)
- Modify: `src/lib/page-directory.ts` (one array insert)
- Modify: `src/components/DashboardShell.tsx` (one entry in SUITE_MAP)

Per repo memory ("suite card implies route allowlist"), skipping any role entry causes middleware to 403 silently.

- [ ] **Step 1: Add to `page-directory.ts`**

In `src/lib/page-directory.ts`, inside `APP_PAGE_ROUTES`, insert `"/dashboards/production-issues",` alphabetically — between `"/dashboards/product-comparison"` and `"/dashboards/project-management"`. Verify alphabetical ordering is preserved around it.

- [ ] **Step 2: Add to each of the four role blocks**

In `src/lib/roles.ts`, find the four occurrences of `/dashboards/clipping-analytics`:

```bash
grep -n "/dashboards/clipping-analytics" src/lib/roles.ts
```

Expected lines (approximate, verify before editing): 328, 612, 704, 901. The four roles are PROJECT_MANAGER, TECH_OPS, DESIGN, INTELLIGENCE.

For each occurrence, insert `"/dashboards/production-issues",` on the line immediately below, keeping the block visually grouped with its Clipping Analytics peer.

- [ ] **Step 3: Add to `DashboardShell`'s `SUITE_MAP`**

In `src/components/DashboardShell.tsx`, find the D&E block (around line 42-49 — the one with `/dashboards/clipping-analytics`). Add below the clipping-analytics entry:

```ts
  "/dashboards/production-issues": { href: "/suites/design-engineering", label: "D&E" },
```

This drives the breadcrumb back-link at the top of the page. Omitting it breaks the breadcrumb silently.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/page-directory.ts src/components/DashboardShell.tsx
git commit -m "feat(routes): register /dashboards/production-issues (roles, page-directory, breadcrumb)"
```

---

## Chunk 2: Page scaffold — data + hero + empty states

### Task 5: Scaffold page component with data fetch, hero strip, and empty states

**Files:**
- Create: `src/app/dashboards/production-issues/page.tsx`

Hero stats render, filters exist but do nothing yet (table and breakdowns come in Tasks 6–7). Both empty-state copies wired up.

- [ ] **Step 1: Create directory + skeleton page**

Create `src/app/dashboards/production-issues/page.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useProductionIssuesFilters } from "@/stores/dashboard-filters";

function monthsBetween(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const ms = now.getTime() - then.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 30));
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export default function ProductionIssuesPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  const { filters, clearFilters } = useProductionIssuesFilters();

  // Flagged subset — canonical source for every calc on this page.
  const flagged = useMemo(
    () => safeProjects.filter((p) => p.systemPerformanceReview === true),
    [safeProjects]
  );

  // TODO(Task 6): narrow to filteredFlagged once filters are wired.
  const filteredFlagged = flagged;

  const hasActiveFilters =
    filters.locations.length > 0 ||
    filters.stages.length > 0 ||
    filters.dealOwners.length > 0 ||
    filters.clippingRisks.length > 0;

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("production-issues", { flaggedCount: flagged.length });
    }
  }, [loading, flagged.length, trackDashboardView]);

  // Hero computations
  const now = new Date();
  const totalFlagged = filteredFlagged.length;

  const totalPtod = useMemo(() => {
    // Denominator is always full dataset — see spec.
    return safeProjects.filter((p) => {
      const s = (p.stage || "").toLowerCase();
      return s.includes("pto") || s.includes("permission to operate") || s.includes("operating") || s.includes("complete");
    }).length;
  }, [safeProjects]);

  const pctOfPtod = totalPtod > 0 ? Math.round((totalFlagged / totalPtod) * 100) : null;

  const monthsSinceClose = useMemo(
    () =>
      filteredFlagged
        .map((p) => monthsBetween(p.closeDate, now))
        .filter((n): n is number => n !== null),
    [filteredFlagged, now]
  );

  const medianMonths = median(monthsSinceClose);

  const oldest = useMemo(() => {
    let bestMonths = -1;
    let bestProject: RawProject | null = null;
    for (const p of filteredFlagged) {
      const m = monthsBetween(p.closeDate, now);
      if (m !== null && m > bestMonths) {
        bestMonths = m;
        bestProject = p;
      }
    }
    return bestProject ? { project: bestProject, months: bestMonths } : null;
  }, [filteredFlagged, now]);

  return (
    <DashboardShell
      title="Production Issues"
      accentColor="red"
      lastUpdated={lastUpdated}
    >
      {/* Hero strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MiniStat label="Total flagged" value={loading ? null : totalFlagged} />
        <MiniStat
          label="% of PTO'd fleet"
          value={loading ? null : pctOfPtod !== null ? `${pctOfPtod}%` : "—"}
        />
        <MiniStat
          label="Median months since close"
          value={loading ? null : medianMonths !== null ? medianMonths : "—"}
        />
        <MiniStat
          label="Oldest flag"
          value={
            loading
              ? null
              : oldest
              ? `${oldest.months} mo`
              : "—"
          }
          subtitle={oldest ? oldest.project.name : undefined}
        />
      </div>

      {/* Empty states */}
      {!loading && flagged.length === 0 && (
        <div className="rounded-xl border border-t-border bg-surface p-12 text-center">
          <div className="text-4xl mb-3">🎉</div>
          <div className="text-lg font-medium text-foreground mb-2">
            No projects are currently flagged for production review
          </div>
          <div className="text-sm text-muted">
            Projects are flagged from the Clipping Analytics page.
          </div>
        </div>
      )}
      {!loading && flagged.length > 0 && filteredFlagged.length === 0 && (
        <div className="rounded-xl border border-t-border bg-surface p-12 text-center">
          <div className="text-lg font-medium text-foreground mb-2">
            No flagged projects match the current filters
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-3 text-sm text-orange-500 hover:text-orange-400 underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* TODO(Task 6): filter bar + table */}
      {/* TODO(Task 7): breakdown cards */}
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Start dev server and smoke-check**

Run: `npm run dev`
Navigate to `http://localhost:3000/dashboards/production-issues`. Expect the page to render with hero stats populated from current data, or the "No projects are currently flagged" empty state if the dataset is empty.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/production-issues/page.tsx
git commit -m "feat(design-suite): scaffold Production Issues page (hero + empty states)"
```

---

## Chunk 3: Filter bar + flagged projects table

### Task 6: Add filter bar and projects table

**Files:**
- Modify: `src/app/dashboards/production-issues/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `page.tsx`, add:

```tsx
import { useCallback, useState } from "react";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { analyzeClipping } from "@/lib/clipping";
import { bucketStage } from "@/lib/production-issues-aggregations";
```

Merge `useCallback`, `useState` into the existing React import.

- [ ] **Step 2: Add risk-color constants (reused from Clipping Analytics)**

Below the helper fns (`monthsBetween`, `median`) add:

```ts
const RISK_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  moderate: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  none: "bg-green-500/20 text-green-400 border-green-500/30",
  unknown: "bg-zinc-500/20 text-muted border-zinc-500/30",
};

function riskOf(project: RawProject): keyof typeof RISK_COLORS {
  const a = analyzeClipping({
    id: String(project.id),
    name: project.name,
    url: project.url,
    stage: project.stage,
    equipment: project.equipment as Record<string, unknown>,
  });
  return a ? a.riskLevel : "unknown";
}

function formatCloseDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function equipmentLabel(eq?: { brand?: string; model?: string }): string {
  if (!eq || (!eq.brand && !eq.model)) return "—";
  return `${eq.brand ?? ""} ${eq.model ?? ""}`.trim();
}
```

- [ ] **Step 3: Replace the `// TODO(Task 6)` with filters + rows + table**

Inside the component (replace `const filteredFlagged = flagged;` and the TODO comment), add filter state and derived rows:

```tsx
  const { filters, setFilters, clearFilters } = useProductionIssuesFilters();

  // Precompute per-row metadata once — used by filters, breakdowns, table.
  const flaggedWithMeta = useMemo(
    () =>
      flagged.map((p) => ({
        project: p,
        risk: riskOf(p),
        bucket: bucketStage(p.stage),
      })),
    [flagged]
  );

  const filteredFlagged = useMemo(() => {
    return flaggedWithMeta.filter(({ project, risk, bucket }) => {
      if (filters.locations.length && !filters.locations.includes(project.pbLocation ?? "")) return false;
      if (filters.stages.length && !filters.stages.includes(bucket)) return false;
      if (filters.dealOwners.length && !filters.dealOwners.includes(project.dealOwner ?? "Unassigned")) return false;
      if (filters.clippingRisks.length && !filters.clippingRisks.includes(risk)) return false;
      return true;
    });
  }, [flaggedWithMeta, filters]);

  // Filter option lists (from full flagged set — so options stay stable as filters narrow results).
  const locationOptions: FilterOption[] = useMemo(
    () =>
      Array.from(new Set(flagged.map((p) => p.pbLocation || ""))).filter(Boolean).sort().map((v) => ({ value: v, label: v })),
    [flagged]
  );
  const stageOptions: FilterOption[] = [
    { value: "pto", label: "PTO'd" },
    { value: "active", label: "Active (pre-PTO)" },
    { value: "service", label: "Service" },
    { value: "other", label: "Other" },
  ];
  const ownerOptions: FilterOption[] = useMemo(
    () =>
      Array.from(new Set(flagged.map((p) => p.dealOwner || "Unassigned"))).sort().map((v) => ({ value: v, label: v })),
    [flagged]
  );
  const riskOptions: FilterOption[] = [
    { value: "high", label: "High clipping risk" },
    { value: "moderate", label: "Moderate" },
    { value: "low", label: "Low" },
    { value: "none", label: "None" },
    { value: "unknown", label: "Unknown (no equipment data)" },
  ];

  const exportRows = useMemo(
    () =>
      filteredFlagged.map(({ project, risk, bucket }) => ({
        project: project.name,
        address: "", // TODO if RawProject gains address field; omit otherwise
        location: project.pbLocation ?? "",
        stage: project.stage,
        bucket,
        dealOwner: project.dealOwner ?? "Unassigned",
        inverter: equipmentLabel(project.equipment?.inverter),
        module: equipmentLabel(project.equipment?.modules),
        battery:
          project.equipment?.battery?.count === 0
            ? "No battery"
            : equipmentLabel(project.equipment?.battery),
        clippingRisk: risk,
        closeDate: project.closeDate ?? "",
      })),
    [filteredFlagged]
  );
```

Then inside the `DashboardShell` JSX, replace the TODO comments with:

```tsx
      {/* Filter bar */}
      {!loading && flagged.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <MultiSelectFilter
            label="Location"
            options={locationOptions}
            selected={filters.locations}
            onChange={(v) => setFilters({ ...filters, locations: v })}
          />
          <MultiSelectFilter
            label="Stage"
            options={stageOptions}
            selected={filters.stages}
            onChange={(v) => setFilters({ ...filters, stages: v })}
          />
          <MultiSelectFilter
            label="Deal owner"
            options={ownerOptions}
            selected={filters.dealOwners}
            onChange={(v) => setFilters({ ...filters, dealOwners: v })}
          />
          <MultiSelectFilter
            label="Clipping risk"
            options={riskOptions}
            selected={filters.clippingRisks}
            onChange={(v) => setFilters({ ...filters, clippingRisks: v })}
          />
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-muted hover:text-foreground underline px-2"
            >
              Clear filters
            </button>
          )}
          <div className="ml-auto text-xs text-muted">
            Showing {filteredFlagged.length} of {flagged.length} flagged
          </div>
        </div>
      )}

      {/* Table */}
      {!loading && filteredFlagged.length > 0 && (
        <div className="rounded-xl border border-t-border bg-surface overflow-x-auto mb-6">
          <div className="px-4 py-2 text-xs text-muted border-b border-t-border">
            Flag is set from the Clipping Analytics page.
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="text-left p-3">Project</th>
                <th className="text-left p-3">Location</th>
                <th className="text-left p-3">Stage</th>
                <th className="text-left p-3">Deal owner</th>
                <th className="text-left p-3">Inverter</th>
                <th className="text-left p-3">Module</th>
                <th className="text-left p-3">Battery</th>
                <th className="text-left p-3">Clipping risk</th>
                <th className="text-left p-3">Close date</th>
              </tr>
            </thead>
            <tbody>
              {filteredFlagged.map(({ project, risk }) => (
                <tr key={String(project.id)} className="border-t border-t-border hover:bg-surface-2">
                  <td className="p-3">
                    {project.url ? (
                      <a
                        href={project.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-500 hover:text-orange-400 underline"
                      >
                        {project.name}
                      </a>
                    ) : (
                      project.name
                    )}
                  </td>
                  <td className="p-3">{project.pbLocation ?? "—"}</td>
                  <td className="p-3">{project.stage}</td>
                  <td className="p-3">{project.dealOwner ?? "Unassigned"}</td>
                  <td className="p-3">{equipmentLabel(project.equipment?.inverter)}</td>
                  <td className="p-3">{equipmentLabel(project.equipment?.modules)}</td>
                  <td className="p-3">
                    {project.equipment?.battery?.count === 0
                      ? "No battery"
                      : equipmentLabel(project.equipment?.battery)}
                  </td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs border ${RISK_COLORS[risk]}`}>
                      {risk}
                    </span>
                  </td>
                  <td className="p-3">{formatCloseDate(project.closeDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
```

Finally add `exportData` to `DashboardShell`:

```tsx
    <DashboardShell
      title="Production Issues"
      accentColor="red"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "production-issues.csv" }}
    >
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `DashboardShell`'s `exportData` type does not accept the row shape, adjust the `exportRows` mapping (string coercion) to match the existing shape used by Clipping Analytics (see `src/app/dashboards/clipping-analytics/page.tsx` for reference).

- [ ] **Step 5: Smoke test in browser**

Refresh `/dashboards/production-issues`. Verify:
- Filter bar renders.
- Each filter narrows both the table and the "Showing N of M flagged" count.
- Clear filters restores full view.
- CSV export button produces a file with all visible columns.
- Clicking a project name opens the HubSpot deal in a new tab.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/production-issues/page.tsx
git commit -m "feat(design-suite): add filter bar + flagged projects table"
```

---

## Chunk 4: Breakdown cards + suite card + final verification

### Task 7: Five breakdown cards

**Files:**
- Modify: `src/app/dashboards/production-issues/page.tsx`

Each card is a small horizontal bar chart (title + rows of `[label] [bar] [count]`), built with plain divs.

- [ ] **Step 1: Add a small bar-row primitive inside the page file**

Above the `export default function`, add:

```tsx
function BarCard({ title, rows }: { title: string; rows: { key: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-xl border border-t-border bg-surface p-4">
      <div className="text-sm font-medium text-foreground mb-3">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted">No data.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2 text-xs">
              <div className="w-28 truncate text-muted" title={r.key}>{r.key}</div>
              <div className="flex-1 h-2 rounded bg-surface-2 overflow-hidden">
                <div className="h-full bg-orange-500/60" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
              <div className="w-8 text-right text-foreground tabular-nums">{r.count}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Import `topByKey` and add an equipment tab state**

Add to imports: `import { topByKey } from "@/lib/production-issues-aggregations";`

Inside the component, add:

```tsx
  const [equipTab, setEquipTab] = useState<"inverter" | "module" | "battery">("inverter");
```

- [ ] **Step 3: Compute breakdowns from `filteredFlagged`**

```tsx
  const byLocation = useMemo(
    () => topByKey(filteredFlagged, (r) => r.project.pbLocation, 10),
    [filteredFlagged]
  );
  const byBucket = useMemo(() => {
    const rows = topByKey(filteredFlagged, (r) => r.bucket, 10);
    const labelFor = (k: string) =>
      k === "pto" ? "PTO'd" : k === "service" ? "Service" : k === "active" ? "Active" : "Other";
    return rows.map((r) => ({ ...r, key: labelFor(r.key) }));
  }, [filteredFlagged]);
  const byRisk = useMemo(() => topByKey(filteredFlagged, (r) => r.risk, 10), [filteredFlagged]);
  const byOwner = useMemo(
    () => topByKey(filteredFlagged, (r) => r.project.dealOwner, 10),
    [filteredFlagged]
  );
  const byEquipment = useMemo(() => {
    if (equipTab === "inverter") {
      return topByKey(filteredFlagged, (r) => equipmentLabel(r.project.equipment?.inverter), 10);
    }
    if (equipTab === "module") {
      return topByKey(filteredFlagged, (r) => equipmentLabel(r.project.equipment?.modules), 10);
    }
    // battery: distinguish "No battery" vs missing
    return topByKey(filteredFlagged, (r) => {
      if (r.project.equipment?.battery?.count === 0) return "No battery";
      return equipmentLabel(r.project.equipment?.battery);
    }, 10);
  }, [filteredFlagged, equipTab]);
```

- [ ] **Step 4: Render the breakdown grid**

Insert before the table (inside `DashboardShell`, after the filter bar):

```tsx
      {!loading && filteredFlagged.length > 0 && (
        <div className="stagger-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <BarCard title="By location" rows={byLocation} />
          <BarCard title="By stage" rows={byBucket} />
          <BarCard title="By clipping risk" rows={byRisk} />
          <BarCard title="By deal owner (top 10)" rows={byOwner} />
          <div className="rounded-xl border border-t-border bg-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-foreground">By equipment (top 10)</div>
              <div className="flex gap-1 text-xs">
                {(["inverter", "module", "battery"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setEquipTab(tab)}
                    className={`px-2 py-0.5 rounded ${
                      equipTab === tab
                        ? "bg-orange-500/20 text-orange-400"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <BarCard title="" rows={byEquipment} />
          </div>
        </div>
      )}
```

- [ ] **Step 5: Typecheck + smoke test**

Run: `npx tsc --noEmit` → PASS.
Refresh page → verify all five cards render with data; the equipment tab switches between inverter/module/battery.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/production-issues/page.tsx
git commit -m "feat(design-suite): add 5 breakdown cards (location, stage, risk, owner, equipment)"
```

---

### Task 8: Add suite card + final QA pass

**Files:**
- Modify: `src/app/suites/design-engineering/page.tsx`

- [ ] **Step 1: Add a card to the D&E suite page**

In `src/app/suites/design-engineering/page.tsx`, inside the `LINKS` array, insert after the `clipping-analytics` entry (roughly line 60):

```tsx
  {
    href: "/dashboards/production-issues",
    title: "Production Issues",
    description: "Every project currently flagged for production review, grouped by location, stage, risk, owner, and equipment.",
    tag: "FLAGGED",
    icon: "🚩",
    section: "Analytics",
  },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 3: Full lint + test + build**

Run in parallel:
- `npm run lint` → PASS.
- `npm run test` → PASS (all suites, including new aggregations test).
- `npx tsc --noEmit` → PASS.

If build is desired as a final gate: `npm run build`. Expect clean compile. (Skip if it's too slow for the iteration loop; CI will gate it.)

- [ ] **Step 4: Manual QA checklist**

Cross-reference the spec's "Testing → Manual QA checklist" section. Walk through all 9 items in the browser.

- [ ] **Step 5: Commit the suite card entry**

```bash
git add src/app/suites/design-engineering/page.tsx
git commit -m "feat(design-suite): add Production Issues card to D&E suite"
```

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(design-suite): Production Issues dashboard" --body "$(cat <<'EOF'
## Summary
- New `/dashboards/production-issues` page in the D&E Suite
- Lists every project currently flagged (`system_performance_review = true`)
- Five breakdown cards for pattern-spotting (location, stage, clipping risk, deal owner, equipment)
- Filters for all 4 dimensions, CSV export, HubSpot deal linkout
- Read-only — flag toggle stays on Clipping Analytics

## Changes
- New page + pure aggregation helpers (`bucketStage`, `topByKey`) with unit tests
- Widened `RawProject.equipment` type to match runtime (`FullEquipment` in `lib/clipping.ts`)
- Persistence hook `useProductionIssuesFilters` mirroring the Clipping Analytics pattern
- Route registered in `page-directory.ts`, `roles.ts` (PM, TECH_OPS, DESIGN, INTELLIGENCE), and `DashboardShell` breadcrumb map

## Spec
`docs/superpowers/specs/2026-04-22-production-issues-page-design.md`

## Test plan
- [ ] Page renders for ADMIN / DESIGN / TECH_OPS / PROJECT_MANAGER; 403 for ROOFING / SALES
- [ ] Hero stats populate; empty-state copy distinguishes "none flagged" from "filters eliminate"
- [ ] Filters narrow both table and breakdowns
- [ ] CSV export matches filtered view
- [ ] HubSpot deal link opens in new tab
- [ ] Dark mode + light mode both render without theme-token regressions

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL from the output; the orchestrator will reference it.

---

## Non-goals / defer-list

- **No unflag-from-page action.** Toggle remains on Clipping Analytics only.
- **No notes / assignees / resolution status.** Future "workqueue" scope; explicitly deferred.
- **No cross-reference with Service Suite tickets.** Future enhancement.
- **No new automated production-issue detection.** Manual flag only.
