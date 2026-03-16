# Pipeline Selector & Deals Sorting Fix — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix deals table stage sorting for non-project pipelines, and add a pipeline dropdown to the main dashboard's "Pipeline by Stage" section.

**Architecture:** Two independent changes in two files. Task 1 updates `DealsTable.tsx` to use per-pipeline stage ordering via `ACTIVE_STAGES`. Task 2 adds a pipeline dropdown and lazy-loaded data fetching to `page.tsx` (home). Both consume `ACTIVE_STAGES` from `deals-pipeline.ts` as the single source of truth for non-project stage order.

**Tech Stack:** React 19, Next.js 16, TypeScript 5, TanStack React Query

**Reviewer notes:**
- Sorting uses `ACTIVE_STAGES` which only covers active stages. If an inactive/closed toggle is ever added, full stage order from `STAGE_MAPS` would be needed — this is out of scope.
- Non-project pipeline data is session-cached without SSE/refresh. The stage chart for non-project pipelines is **not** real-time — this is intentional for v1.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/dashboards/deals/DealsTable.tsx` | Modify | Update `stageSort()` to accept pipeline and use per-pipeline stage order |
| `src/app/page.tsx` | Modify | Add pipeline dropdown to "Pipeline by Stage", lazy-load non-project data |

---

## Chunk 1: Implementation

### Task 1: Fix deals table stage sorting for non-project pipelines

**Files:**
- Modify: `src/app/dashboards/deals/DealsTable.tsx:31-70`

**Context:** The `stageSort()` function (line 32) only uses `STAGE_ORDER` from `constants.ts`, which contains project pipeline stages. For D&R/Sales/Service/Roofing, all stages get index -1 → position 999 → random sort order. The fix: accept a `pipeline` param and look up the correct stage array.

- [ ] **Step 1: Add `ACTIVE_STAGES` import**

In `DealsTable.tsx`, add the import alongside the existing `STAGE_ORDER` import:

```typescript
// Line 11 — add ACTIVE_STAGES import
import { STAGE_COLORS, STAGE_ORDER } from "@/lib/constants";
import { ACTIVE_STAGES } from "@/lib/deals-pipeline";
```

- [ ] **Step 2: Update `stageSort()` to accept pipeline param**

Replace the current `stageSort` function (lines 31-38) with a pipeline-aware version:

```typescript
/** Custom stage sort — uses STAGE_ORDER for project, ACTIVE_STAGES for others */
function stageSort(a: string, b: string, order: "asc" | "desc", pipeline: string): number {
  const stageList: readonly string[] =
    pipeline === "project" ? STAGE_ORDER : (ACTIVE_STAGES[pipeline] || []);
  const aPos = stageList.indexOf(a);
  const bPos = stageList.indexOf(b);
  const aPosN = aPos === -1 ? 999 : aPos;
  const bPosN = bPos === -1 ? 999 : bPos;
  return order === "asc" ? aPosN - bPosN : bPosN - aPosN;
}
```

- [ ] **Step 3: Pass `pipeline` to `stageSort` and update dependency array**

Update the `sorted` useMemo (lines 53-70) to pass `pipeline` and include it in deps:

```typescript
  // Sort deals
  const sorted = useMemo(() => {
    const copy = [...deals];
    if (sort === "stage") {
      copy.sort((a, b) => stageSort(a.stage, b.stage, order, pipeline));
    } else {
      copy.sort((a, b) => {
        const aVal = a[sort as keyof TableDeal];
        const bVal = b[sort as keyof TableDeal];
        if (typeof aVal === "number" && typeof bVal === "number") {
          return order === "desc" ? bVal - aVal : aVal - bVal;
        }
        const aStr = String(aVal ?? "");
        const bStr = String(bVal ?? "");
        return order === "desc" ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
      });
    }
    return copy;
  }, [deals, sort, order, pipeline]);
```

- [ ] **Step 4: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Manual verification**

Run: `npm run dev`
Navigate to `/dashboards/deals`, select "D&R Pipeline", click the Stage column header.
Expected: Stages sort in D&R progression order (Kickoff → Site Survey → Design → ... → Closeout), not randomly.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/deals/DealsTable.tsx
git commit -m "fix(deals): use per-pipeline stage order for table sorting

ACTIVE_STAGES from deals-pipeline.ts provides stage progression
order for D&R, Sales, Service, and Roofing pipelines. Previously
all non-project stages sorted randomly (position 999)."
```

---

### Task 2: Add pipeline dropdown to main dashboard "Pipeline by Stage"

**Files:**
- Modify: `src/app/page.tsx:1-18` (imports), `610-671` (Pipeline by Stage section)

**Context:** The "Pipeline by Stage" section (line 610) is hardcoded to project pipeline data. We're adding a dropdown to switch between pipelines, with lazy-loaded data for non-project pipelines. The top stat cards and location filter remain project-only. The API at `/api/deals?pipeline={key}` already returns `{ deals, stats: { totalValue, stageCounts } }` with `active=true` by default.

- [ ] **Step 1: Add imports**

Add these imports to `page.tsx` (around line 10):

```typescript
import { STAGE_COLORS, STAGE_ORDER } from "@/lib/constants";
import { ACTIVE_STAGES } from "@/lib/deals-pipeline";
import { PIPELINE_OPTIONS } from "@/app/dashboards/deals/deals-types";
```

Note: `STAGE_COLORS` is already imported. Just add the `STAGE_ORDER` to that import and add the two new imports.

- [ ] **Step 2: Add pipeline state and cache type**

Inside the `Home` component (after `selectedLocations` state, around line 212), add:

```typescript
  const [selectedPipeline, setSelectedPipeline] = useState("project");
  const [pipelineCache, setPipelineCache] = useState<
    Record<string, { stageCounts: Record<string, number>; stageValues: Record<string, number>; total: number; totalValue: number }>
  >({});
  const [pipelineLoading, setPipelineLoading] = useState(false);
```

- [ ] **Step 3: Add pipeline data fetch function**

After the `clearLocations` callback (around line 330), add:

```typescript
  // Fetch non-project pipeline data (lazy, cached in state)
  const fetchPipelineData = useCallback(async (pipelineKey: string) => {
    // Cache check uses functional state to avoid stale closure on pipelineCache
    setPipelineCache((prev) => {
      if (prev[pipelineKey]) return prev; // already cached — no-op
      // Trigger the actual fetch outside this setter
      (async () => {
        setPipelineLoading(true);
        try {
          // active=true is the API default; explicit here to lock the contract
          const res = await fetch(`/api/deals?pipeline=${pipelineKey}&active=true`);
          if (!res.ok) throw new Error("Failed to fetch pipeline data");
          const data = await res.json();
          const deals: { stage: string; amount: number }[] = data.deals || [];
          // Compute stage values (API returns stageCounts but not stageValues)
          const stageValues: Record<string, number> = {};
          for (const deal of deals) {
            stageValues[deal.stage] = (stageValues[deal.stage] || 0) + deal.amount;
          }
          setPipelineCache((p) => ({
            ...p,
            [pipelineKey]: {
              stageCounts: data.stats?.stageCounts || {},
              stageValues,
              total: data.totalCount || deals.length,
              totalValue: data.stats?.totalValue || 0,
            },
          }));
        } catch (err) {
          console.error(`Failed to fetch ${pipelineKey} pipeline data:`, err);
        } finally {
          setPipelineLoading(false);
        }
      })();
      return prev; // return unchanged — the async IIFE updates later
    });
  }, []);
```

- [ ] **Step 4: Add pipeline switch handler**

Right after `fetchPipelineData`:

```typescript
  const handlePipelineChange = useCallback((pipelineKey: string) => {
    setSelectedPipeline(pipelineKey);
    if (pipelineKey !== "project") {
      fetchPipelineData(pipelineKey);
    }
  }, [fetchPipelineData]);
```

- [ ] **Step 5: Compute active stage data for the selected pipeline**

Add a memo that resolves the stage data and ordering for whichever pipeline is selected:

```typescript
  // Resolve stage data for the selected pipeline
  const pipelineStageData = useMemo(() => {
    if (selectedPipeline === "project") {
      return {
        stageCounts: stats?.stageCounts || {},
        stageValues: stats?.stageValues || {},
        total: stats?.totalProjects || 0,
        stageOrder: STAGE_ORDER as readonly string[],
      };
    }
    const cached = pipelineCache[selectedPipeline];
    if (!cached) return null;
    return {
      stageCounts: cached.stageCounts,
      stageValues: cached.stageValues,
      total: cached.total,
      stageOrder: ACTIVE_STAGES[selectedPipeline] || [],
    };
  }, [selectedPipeline, stats, pipelineCache]);
```

- [ ] **Step 6: Replace the "Pipeline by Stage" section**

Replace lines 610-671 (the entire Pipeline by Stage block) with:

```tsx
        {/* Pipeline by Stage */}
        {loading && selectedPipeline === "project" ? (
          <SkeletonSection />
        ) : (
          <div className="bg-gradient-to-br from-surface-elevated/85 via-surface/70 to-surface-2/55 border border-t-border/80 rounded-xl p-6 mb-8 animate-fadeIn shadow-card backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">Pipeline by Stage</h2>
                <select
                  value={selectedPipeline}
                  onChange={(e) => handlePipelineChange(e.target.value)}
                  className="text-sm bg-surface-2 border border-t-border rounded-lg px-2.5 py-1 text-foreground cursor-pointer hover:border-muted transition-colors focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                >
                  {PIPELINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <Link
                href={
                  selectedPipeline === "project"
                    ? "/dashboards/deals"
                    : `/dashboards/deals?pipeline=${selectedPipeline}`
                }
                className="text-sm text-muted hover:text-orange-400 transition-colors"
              >
                View All Deals →
              </Link>
            </div>
            {selectedPipeline !== "project" && !pipelineStageData && !pipelineLoading && (
              <div className="text-center py-8 text-muted text-sm">
                Failed to load pipeline data.
              </div>
            )}
            {pipelineLoading ? (
              <SkeletonSection />
            ) : pipelineStageData && Object.keys(pipelineStageData.stageCounts).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(pipelineStageData.stageCounts)
                  .sort((a, b) => {
                    const order = pipelineStageData.stageOrder;
                    const aIdx = order.indexOf(a[0]);
                    const bIdx = order.indexOf(b[0]);
                    if (aIdx === -1 && bIdx === -1) return a[0].localeCompare(b[0]);
                    if (aIdx === -1) return 1;
                    if (bIdx === -1) return -1;
                    return aIdx - bIdx;
                  })
                  .map(([stage, count]) => {
                    const dealsUrl =
                      selectedPipeline === "project"
                        ? `/dashboards/deals?stage=${encodeURIComponent(stage)}${
                            selectedLocations.length > 0
                              ? `&location=${selectedLocations.map(encodeURIComponent).join(",")}`
                              : ""
                          }`
                        : `/dashboards/deals?pipeline=${selectedPipeline}&stage=${encodeURIComponent(stage)}`;
                    return (
                      <StageBar
                        key={stage}
                        stage={stage}
                        count={count as number}
                        total={pipelineStageData.total}
                        value={pipelineStageData.stageValues[stage]}
                        linkHref={dealsUrl}
                      />
                    );
                  })}
              </div>
            ) : !pipelineLoading && pipelineStageData ? (
              <div className="text-center py-8 text-muted text-sm">
                No active deals in this pipeline.
              </div>
            ) : null}
          </div>
        )}
```

- [ ] **Step 7: Verify the build passes**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Manual verification**

Run: `npm run dev`
Navigate to `/` (home page).
1. Verify "Pipeline by Stage" shows a dropdown defaulting to "Project Pipeline" with the same bars as before.
2. Switch to "D&R Pipeline" — should show a loading skeleton briefly, then D&R stage bars in progression order (Kickoff → ... → Closeout).
3. Switch to "Sales Pipeline" — same pattern.
4. Switch back to "Project Pipeline" — instant (project data from existing query), location filter still works.
5. Switch back to "D&R Pipeline" — instant (cached from step 2).
6. Click "View All Deals →" while on D&R — should navigate to `/dashboards/deals?pipeline=dnr`.
7. Verify stat cards (Active Projects, Pipeline Value, etc.) do NOT change when switching pipelines.
8. Verify location filter does NOT affect non-project pipeline stage charts.

- [ ] **Step 9: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(home): add pipeline selector to Pipeline by Stage section

Dropdown next to title lets users switch between Project, D&R,
Sales, Service, and Roofing pipeline stage breakdowns. Non-project
data is lazy-loaded from /api/deals and cached for the session.
Stat cards and location filter remain project-pipeline-only."
```

---

## Post-Implementation

- [ ] **Run full lint check:** `npm run lint`
- [ ] **Run full type check:** `npx tsc --noEmit`
- [ ] **Run tests:** `npm run test`
