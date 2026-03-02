# D&E Overview + Metrics Rework — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix D&E metrics formulas, redistribute stats between overview (pipeline snapshot) and metrics (time-windowed performance), add DA Status funnel.

**Architecture:** Two page edits + one data model addition. de-overview becomes a pipeline snapshot (counts of current states). de-metrics gains a 30/60/90d toggle controlling approval rate, turnaround times, and volume stats. New `dateReturnedFromDesigners` property added to HubSpot pipeline.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript, Tailwind v4

**Design doc:** `docs/plans/2026-03-01-de-overview-metrics-rework-design.md`

---

### Task 0: Add `dateReturnedFromDesigners` to data pipeline

**Files:**
- Modify: `src/lib/hubspot.ts` — DEAL_PROPERTIES (~line 510), Project interface (~line 305), transform (~line 875)
- Modify: `src/lib/types.ts` — RawProject interface (~line 54)

**Step 1: Add to DEAL_PROPERTIES**

In `src/lib/hubspot.ts`, find the design dates block (after `"design_start_date"`). Add:

```ts
  "date_returned_from_designers",
```

**Step 2: Add to Project interface**

In `src/lib/hubspot.ts`, find the Design section of the `Project` interface (after `designStartDate`). Add:

```ts
  dateReturnedFromDesigners: string | null;
```

**Step 3: Add to deal transform**

In `src/lib/hubspot.ts`, find the design section of the transform (after `designStartDate: parseDate(...)`). Add:

```ts
    dateReturnedFromDesigners: parseDate(deal.date_returned_from_designers),
```

**Step 4: Add to RawProject**

In `src/lib/types.ts`, in the `// Design & Engineering` section (after `designStartDate`). Add:

```ts
  dateReturnedFromDesigners?: string;
```

**Step 5: Build and verify**

```bash
npm run build
```

Expected: Clean build, no type errors.

**Step 6: Commit**

```bash
git add src/lib/hubspot.ts src/lib/types.ts
git commit -m "feat: add dateReturnedFromDesigners to HubSpot data pipeline"
```

---

### Task 1: Rework de-overview hero cards to pipeline snapshot

**Files:**
- Modify: `src/app/dashboards/de-overview/page.tsx`

**Context:** Current hero cards show: Active D&E Projects, Avg Design Turnaround, Approval Rate, Flagged for Review. Replace with pipeline snapshot counts.

**Step 1: Replace heroMetrics computation**

Find the `heroMetrics` useMemo block (~line 124-153). Replace the entire block with:

```tsx
  const heroMetrics = useMemo(() => {
    const activeCount = filteredProjects.length;
    const readyForDesign = filteredProjects.filter(
      (p) => p.designStatus === "Ready for Design"
    ).length;
    const readyForReview = filteredProjects.filter(
      (p) => p.designStatus === "Ready For Review"
    ).length;

    // Pending DA: layoutStatus is a pending-approval status and not yet approved
    const PENDING_DA_STATUSES = [
      "Draft Created", "Draft Complete", "Sent For Approval",
      "Resent For Approval", "Sent to Customer", "Review In Progress",
      "Pending Review", "Ready For Review", "Ready",
    ];
    const pendingDA = filteredProjects.filter(
      (p) => p.layoutStatus && PENDING_DA_STATUSES.includes(p.layoutStatus)
    ).length;

    return { activeCount, readyForDesign, readyForReview, pendingDA };
  }, [filteredProjects]);
```

**Step 2: Update hero StatCard JSX**

Find the hero metrics grid (~line 300-323). Replace all 4 StatCards with:

```tsx
      <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid">
        <StatCard
          label="Active D&E Projects"
          value={loading ? null : heroMetrics.activeCount}
          color="purple"
        />
        <StatCard
          label="Ready for Design"
          value={loading ? null : heroMetrics.readyForDesign}
          color="purple"
        />
        <StatCard
          label="Ready for Review"
          value={loading ? null : heroMetrics.readyForReview}
          color="purple"
        />
        <StatCard
          label="Pending DA"
          value={loading ? null : heroMetrics.pendingDA}
          color="purple"
        />
      </div>
```

**Step 3: Remove unused imports if any**

The old heroMetrics used `designCompletionDate`, `designDraftDate`, `designApprovalDate`, `systemPerformanceReview`. These may still be used elsewhere on the page (stale table), so don't remove from `RawProject` import. Just verify no dead code remains.

**Step 4: Build and verify**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/app/dashboards/de-overview/page.tsx
git commit -m "feat: replace de-overview hero stats with pipeline snapshot counts"
```

---

### Task 2: Add DA Status funnel to de-overview

**Files:**
- Modify: `src/app/dashboards/de-overview/page.tsx`

**Step 1: Add DA_STATUS_FUNNEL constant**

After the existing `STATUS_FUNNEL` constant (~line 15-24), add:

```tsx
const DA_STATUS_FUNNEL = [
  { key: "Draft Created", label: "Draft Created", color: "bg-slate-500" },
  { key: "Draft Complete", label: "Draft Complete", color: "bg-blue-500" },
  { key: "Sent For Approval", label: "Sent For Approval", color: "bg-yellow-500" },
  { key: "Resent For Approval", label: "Resent For Approval", color: "bg-orange-500" },
  { key: "Review In Progress", label: "Review In Progress", color: "bg-purple-500" },
  { key: "Approved", label: "Approved", color: "bg-emerald-500" },
];
```

**Step 2: Add daFunnelData computation**

After the existing `funnelData` useMemo, add:

```tsx
  const daFunnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredProjects.forEach((p) => {
      if (p.layoutStatus) {
        counts[p.layoutStatus] = (counts[p.layoutStatus] || 0) + 1;
      }
    });

    // Build ordered list: known statuses first, then unknowns
    const knownKeys = new Set(DA_STATUS_FUNNEL.map((s) => s.key));
    const known = DA_STATUS_FUNNEL
      .map((s) => ({ ...s, count: counts[s.key] || 0 }))
      .filter((s) => s.count > 0);
    const unknown = Object.entries(counts)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, count]) => ({ key, label: key, color: "bg-zinc-500", count }));
    const all = [...known, ...unknown];

    const maxCount = Math.max(1, ...all.map((s) => s.count));
    return all.map((s) => ({ ...s, pct: (s.count / maxCount) * 100 }));
  }, [filteredProjects]);
```

**Step 3: Add DA Status funnel JSX**

After the existing Status Funnel closing `</div>` (~after the CO vs CA split section makes more sense, but place it right after the Design Status Funnel for visual grouping). Find the closing `</div>` of the "Design Status Funnel" section. After it, add:

```tsx
      {/* DA Status Funnel */}
      <div className="mb-6 bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">DA Status Funnel</h2>
        <div className="space-y-3">
          {daFunnelData.length === 0 ? (
            <p className="text-sm text-muted italic">No DA status data for current filters.</p>
          ) : (
            daFunnelData.map((s) => (
              <div key={s.key} className="flex items-center gap-3">
                <div className="w-44 text-sm text-muted truncate">{s.label}</div>
                <div className="flex-1 h-7 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${s.color} rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
                    style={{ width: `${Math.max(s.pct, s.count > 0 ? 8 : 0)}%` }}
                  >
                    {s.count > 0 && (
                      <span className="text-xs font-semibold text-white">{s.count}</span>
                    )}
                  </div>
                </div>
                <div className="w-10 text-right text-sm font-medium text-foreground">{s.count}</div>
              </div>
            ))
          )}
        </div>
      </div>
```

**Step 4: Build and verify**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/app/dashboards/de-overview/page.tsx
git commit -m "feat: add DA Status funnel to de-overview"
```

---

### Task 3: Add 30/60/90d time-windowed performance section to de-metrics

**Files:**
- Modify: `src/app/dashboards/de-metrics/page.tsx`

**Context:** Current de-metrics has: Design Approvals (sent/approved/pending), Design Pipeline (active/engineering/complete/revision), Monthly Trends, Status Breakdown, Designer Productivity. We add a new **Performance** section at the top with a time window toggle.

**Step 1: Add time window state and helper**

After the existing state declarations (~line 71-75), add:

```tsx
  const [timeWindow, setTimeWindow] = useState<30 | 60 | 90>(30);

  // Helper: is date within the last N days?
  const isInWindow = useCallback((dateStr: string | undefined | null, days: number) => {
    if (!dateStr) return false;
    const d = new Date(dateStr + "T12:00:00");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return d >= cutoff;
  }, []);
```

**Step 2: Add windowed performance metrics**

After the existing `approvalMetrics` useMemo (~line 150-163), add:

```tsx
  // ---- Time-windowed performance metrics ----
  const windowedMetrics = useMemo(() => {
    // Approval volume (independent cohorts)
    const sentInWindow = designProjects.filter((p) =>
      isInWindow(p.designApprovalSentDate, timeWindow)
    );
    const approvedInWindow = designProjects.filter((p) =>
      isInWindow(p.designApprovalDate, timeWindow)
    );

    // Approval rate (same cohort: sent in window, of those how many approved)
    const sentAndApproved = sentInWindow.filter((p) => p.designApprovalDate);
    const approvalRate = sentInWindow.length > 0
      ? Math.round((sentAndApproved.length / sentInWindow.length) * 100)
      : 0;

    // Design turnaround: designStartDate → dateReturnedFromDesigners
    const designTurnarounds = designProjects
      .filter((p) => p.designStartDate && p.dateReturnedFromDesigners && isInWindow(p.dateReturnedFromDesigners, timeWindow))
      .map((p) => {
        const start = new Date(p.designStartDate! + "T12:00:00");
        const end = new Date(p.dateReturnedFromDesigners! + "T12:00:00");
        return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter((d) => d >= 0);
    const avgDesignTurnaround = designTurnarounds.length > 0
      ? Math.round(designTurnarounds.reduce((a, b) => a + b, 0) / designTurnarounds.length)
      : 0;

    // DA turnaround: designApprovalSentDate → designApprovalDate
    const daTurnarounds = designProjects
      .filter((p) => p.designApprovalSentDate && p.designApprovalDate && isInWindow(p.designApprovalDate, timeWindow))
      .map((p) => {
        const start = new Date(p.designApprovalSentDate! + "T12:00:00");
        const end = new Date(p.designApprovalDate! + "T12:00:00");
        return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter((d) => d >= 0);
    const avgDATurnaround = daTurnarounds.length > 0
      ? Math.round(daTurnarounds.reduce((a, b) => a + b, 0) / daTurnarounds.length)
      : 0;

    return {
      sentCount: sentInWindow.length,
      approvedCount: approvedInWindow.length,
      approvalRate,
      avgDesignTurnaround,
      designTurnaroundN: designTurnarounds.length,
      avgDATurnaround,
      daTurnaroundN: daTurnarounds.length,
    };
  }, [designProjects, timeWindow, isInWindow]);
```

**Step 3: Add Performance section JSX**

Inside the `return` block, after the filter row and before the existing "Design Approvals" section, add:

```tsx
      {/* Time-Windowed Performance */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">Performance</h2>
          <div className="flex bg-surface-2 rounded-lg p-0.5 border border-t-border">
            {([30, 60, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => setTimeWindow(d)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  timeWindow === d
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Approval stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 stagger-grid">
          <MetricCard
            label="DA Sent"
            value={loading ? "—" : String(windowedMetrics.sentCount)}
            sub={`Last ${timeWindow} days`}
            border="border-l-4 border-l-blue-500"
          />
          <MetricCard
            label="DA Approved"
            value={loading ? "—" : String(windowedMetrics.approvedCount)}
            sub={`Last ${timeWindow} days`}
            border="border-l-4 border-l-emerald-500"
            valueColor="text-emerald-400"
          />
          <MetricCard
            label="Approval Rate"
            value={loading ? "—" : `${windowedMetrics.approvalRate}%`}
            sub={`Sent in window → approved (n=${windowedMetrics.sentCount})`}
            border="border-l-4 border-l-indigo-500"
          />
        </div>

        {/* Turnaround stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-grid">
          <MetricCard
            label="Avg Design Turnaround"
            value={loading ? "—" : `${windowedMetrics.avgDesignTurnaround}d`}
            sub={`Start → Returned (n=${windowedMetrics.designTurnaroundN})`}
            border="border-l-4 border-l-purple-500"
          />
          <MetricCard
            label="Avg DA Turnaround"
            value={loading ? "—" : `${windowedMetrics.avgDATurnaround}d`}
            sub={`Sent → Approved (n=${windowedMetrics.daTurnaroundN})`}
            border="border-l-4 border-l-cyan-500"
          />
        </div>
      </div>
```

**Step 4: Build and verify**

```bash
npm run build
```

Note: This will fail if `dateReturnedFromDesigners` isn't on `RawProject`. Task 0 must be done first.

**Step 5: Commit**

```bash
git add src/app/dashboards/de-metrics/page.tsx
git commit -m "feat: add 30/60/90d windowed performance section to de-metrics"
```

---

### Task 4: Final cleanup — remove old turnaround/rate from de-overview heroMetrics

**Files:**
- Modify: `src/app/dashboards/de-overview/page.tsx`

**Step 1: Verify no dead code**

Check that the old `heroMetrics` references to `avgTurnaround`, `approvalRate`, `flagged` are fully removed from both the computation and the JSX. If Task 1 was done correctly, this is a no-op verification.

**Step 2: Final build**

```bash
npm run build
```

**Step 3: Commit (if changes)**

```bash
git add -A && git commit -m "chore: clean up dead code from de-overview hero stats rework"
```

---

## Execution Notes

- Tasks are sequential: 0 → 1 → 2 → 3 → 4
- Task 0 is a prerequisite for Task 3 (`dateReturnedFromDesigners` must exist)
- Tasks 1 and 2 can be done independently of Task 3
- Task 4 is a verification pass
