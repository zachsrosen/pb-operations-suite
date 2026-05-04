# Scheduler Sub-Job Breakdown View — Design

**Status:** Draft
**Author:** Zach (with Claude)
**Date:** 2026-05-03
**Depends on:** [PR #515 — Construction Job Split](https://github.com/zachsrosen/pb-operations-suite/pull/515) ([spec](./2026-05-03-construction-job-split-design.md))

## Background

PR #515 split the single Zuper "Construction" job per deal into up to three sub-jobs — Construction - Solar, Construction - Battery, Construction - EV — created conditionally based on what the deal includes. Each sub-job has its own status, scheduled dates, and crew assignment in Zuper.

The construction-scheduler and master scheduler dashboards decorate project cards with Zuper data via `/api/zuper/jobs/lookup`. That endpoint scores all matching jobs per deal and returns ONE — the "best candidate" — so multi-system deals lose information: ops sees a single status badge that represents only one of the 1–3 sub-jobs.

This spec adds an opt-in **breakdown view** that surfaces every sub-job's status, crew, and schedule on the card.

## Problem

For a deal with all three systems, today's card shows something like:

```
PROJ-12345 — Smith Residence    [STARTED]   Crew: Diaz, Chen
```

That single `STARTED` badge is one sub-job's status. Ops can't tell which system it represents, can't see whether the other two are scheduled, in progress, or complete, and can't see which crew is on which system. The PR #515 spec already documents that different crews handle different systems; the scheduler card hides that fact.

## Decisions (made during brainstorming)

| Decision | Choice |
|---|---|
| Data source | Extend `/api/zuper/jobs/lookup` with optional `subJobs` array per dealId |
| HubSpot `construction_*_status` props | Not read by this feature (props exist, but lookup already has live Zuper data including crew + dates) |
| Toggle UX | Page-level segmented control, **Compact** (default) / **Breakdown**, top-right of each scheduler |
| Toggle persistence | `localStorage` per scheduler (separate key per page); cross-tab sync via `storage` event |
| Per-sub-job data shown | Status badge, assigned crew, scheduled date window |
| System rendering | Only render sub-jobs that exist on the deal — no "EV: not scheduled" placeholder for systems the deal doesn't include |
| Legacy `Construction` jobs | Render as a single "Construction" row in breakdown mode |
| Mobile | Toggle is desktop-only; mobile keeps Compact (matches existing layout split) |
| URL params | None — toggle is personal preference, not shareable state |
| Backwards compat | `jobs` map in lookup response stays exactly as today; `subJobs` is purely additive |

## Architecture

```
/api/zuper/jobs/lookup (extended)
  ├─ existing: jobs[dealId] = bestCandidateJob
  └─ NEW: subJobs[dealId] = SubJobInfo[]   (only for category=construction)
                          │
                          ▼
Scheduler page state
  ├─ ConstructionProject.zuperSubJobs?: SubJobInfo[]
  └─ SchedulerProject.zuperSubJobs?: SubJobInfo[]
                          │
                          ▼
Render branch
  ├─ viewMode === "compact"   → existing badges from zuperJobStatus / zuperAssignedTo
  └─ viewMode === "breakdown" → <SubJobBreakdown subJobs={...} />
                          │
                          ▼
Toggle
  └─ <ViewModeToggle storageKey="scheduler:viewMode:construction" />
```

## Component Design

### 1. Lookup endpoint extension (`src/app/api/zuper/jobs/lookup/route.ts`)

The endpoint already walks every Zuper job and builds candidate matches. Today, after deduping by `job_uid`, it picks ONE candidate per dealId via `(methodScore, statusScore, addressScore)` sort.

For `category=construction` calls, we add a second pass that buckets the deduped candidates by system type and picks one per bucket:

```ts
// After dedupedCandidates is computed, before/alongside picking the single `best`:
if (params.category === "construction") {
  const bySystem = new Map<SystemType, JobMatch[]>();
  for (const c of dedupedCandidates) {
    const sys = categoryToSystemType(c.categoryName);
    if (!bySystem.has(sys)) bySystem.set(sys, []);
    bySystem.get(sys)!.push(c);
  }
  const subJobsForDeal: SubJobInfo[] = [];
  for (const [sys, group] of bySystem) {
    // group already deduped by uid; sort by statusScore desc, then addressScore desc
    group.sort((a, b) => (b.statusScore - a.statusScore) || (b.addressScore - a.addressScore));
    const winner = group[0];
    subJobsForDeal.push({
      systemType: sys,
      jobUid: winner.job.job_uid!,
      status: getJobStatus(winner.job),
      scheduledDate: getScheduledStart(winner.job),
      scheduledEnd: getScheduledEnd(winner.job),
      scheduledDays: computeScheduledDays(winner.job),
      assignedTo: getAssignedUserNames(winner.job),
    });
    if (group.length > 1) {
      Sentry.addBreadcrumb({
        category: "zuper-lookup",
        message: `Multiple ${sys} jobs matched deal ${projectId}; picked ${winner.job.job_uid}`,
        level: "warning",
      });
    }
  }
  // Stable order: solar, battery, ev, legacy
  subJobsForDeal.sort((a, b) => SYSTEM_ORDER.indexOf(a.systemType) - SYSTEM_ORDER.indexOf(b.systemType));
  subJobsMap[projectId] = subJobsForDeal;
}
```

Where:

```ts
const SYSTEM_ORDER: SystemType[] = ["solar", "battery", "ev", "legacy"];

type SubJobInfo = {
  systemType: SystemType;          // from src/lib/zuper-construction.ts
  jobUid: string;
  status: string;
  scheduledDate?: string;
  scheduledEnd?: string;
  scheduledDays?: number;
  assignedTo?: string[];
};
```

The `computeScheduledDays` helper is the existing inline scheduled-days calculation from the same route file — we extract it to a small local function to call it twice (once for `best`, once per sub-job winner).

**Response shape:**

```ts
type LookupResponse = {
  jobs: Record<string, BestCandidateJob>;       // unchanged
  subJobs?: Record<string, SubJobInfo[]>;       // NEW — only set for category=construction
};
```

Both GET (query string) and POST (JSON body) variants of the route emit the same extended shape.

### 2. New helper: `extractSubJobsForCategory`

To keep the route handler readable, factor the bucketing logic into a small helper colocated in `lookup/route.ts` (not a separate file — it's tightly coupled to candidate selection):

```ts
function extractSubJobsForCategory(
  category: string,
  dedupedCandidates: JobMatch[],
  projectId: string,
): SubJobInfo[] {
  if (category !== "construction") return [];
  // ...bucketing logic above...
}
```

### 3. Scheduler type extensions

**`src/app/dashboards/construction-scheduler/page.tsx` — `ConstructionProject` interface:**
```ts
interface ConstructionProject {
  // ...existing fields...
  zuperSubJobs?: SubJobInfo[];
}
```

**`src/app/dashboards/scheduler/page.tsx` — `SchedulerProject` interface:**
```ts
interface SchedulerProject {
  // ...existing fields...
  zuperSubJobs?: SubJobInfo[];
}
```

**Shared type:** `SubJobInfo` lives in a new file `src/lib/scheduler-subjobs.ts` (alongside the bucketing logic the route uses). Both schedulers import from there. The lookup route also imports the type.

The new file exports:
```ts
export type SubJobInfo = { ... };
export const SYSTEM_ORDER: SystemType[] = ["solar", "battery", "ev", "legacy"];
export const SYSTEM_LABELS: Record<SystemType, string> = {
  solar: "Solar",
  battery: "Battery",
  ev: "EV",
  legacy: "Construction",
};
export const SYSTEM_ICONS: Record<SystemType, string> = {
  solar: "☀",
  battery: "🔋",
  ev: "⚡",
  legacy: "🔧",
};
```

### 4. Lookup decoration in scheduler pages

**Construction scheduler** (`src/app/dashboards/construction-scheduler/page.tsx` ~line 432):
```ts
const zuperData = await zuperResponse.json();
if (zuperData.jobs) {
  for (const project of transformed) {
    const zuperJob = zuperData.jobs[project.id];
    if (zuperJob) {
      project.zuperJobUid = zuperJob.jobUid;
      project.zuperJobStatus = zuperJob.status;
      // ...existing assignments unchanged...
    }
    // NEW
    const subJobs = zuperData.subJobs?.[project.id];
    if (subJobs?.length) {
      project.zuperSubJobs = subJobs;
    }
  }
}
```

**Master scheduler** (`src/app/dashboards/scheduler/page.tsx` ~line 1075): same pattern, inside the construction-category branch only. Survey and inspection lookups don't return `subJobs`.

### 5. New component: `<SubJobBreakdown>`

Path: `src/components/scheduler/SubJobBreakdown.tsx`.

```tsx
type Props = {
  subJobs: SubJobInfo[];
  className?: string;
};

export function SubJobBreakdown({ subJobs, className }: Props) {
  if (subJobs.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {subJobs.map((sj) => (
        <SubJobRow key={sj.jobUid} subJob={sj} />
      ))}
    </div>
  );
}

function SubJobRow({ subJob }: { subJob: SubJobInfo }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-4 text-center" aria-hidden>{SYSTEM_ICONS[subJob.systemType]}</span>
      <span className="w-16 text-muted">{SYSTEM_LABELS[subJob.systemType]}</span>
      <ZuperStatusBadge status={subJob.status} />
      <CrewLabel names={subJob.assignedTo} />
      <ScheduleLabel start={subJob.scheduledDate} end={subJob.scheduledEnd} />
    </div>
  );
}
```

`<ZuperStatusBadge>`, `<CrewLabel>`, `<ScheduleLabel>` are tiny presentational helpers in the same file:
- `ZuperStatusBadge` reuses the existing status → tone mapping (find current usage; if no shared helper exists, a small switch on common statuses with theme tokens like `bg-emerald-500/15 text-emerald-300` etc.)
- `CrewLabel` truncates: `["Joe Diaz", "Mike Chen", "Tim Park"]` → "J. Diaz, M. Chen +1"
- `ScheduleLabel` formats `start` / `end` into `M/D` or `M/D–M/D`; em-dash if start is missing

### 6. New component: `<ViewModeToggle>`

Path: `src/components/scheduler/ViewModeToggle.tsx`.

```tsx
type ViewMode = "compact" | "breakdown";

type Props = {
  storageKey: string;             // e.g. "scheduler:viewMode:construction"
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
};

export function ViewModeToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface" role="tablist">
      <button
        role="tab"
        aria-selected={value === "compact"}
        className={cn("px-3 py-1.5 text-xs", value === "compact" && "bg-surface-2 text-foreground")}
        onClick={() => onChange("compact")}
      >
        Compact
      </button>
      <button
        role="tab"
        aria-selected={value === "breakdown"}
        className={cn("px-3 py-1.5 text-xs", value === "breakdown" && "bg-surface-2 text-foreground")}
        onClick={() => onChange("breakdown")}
      >
        Breakdown
      </button>
    </div>
  );
}

export function useViewMode(storageKey: string): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("compact");

  // Hydrate from localStorage after mount (avoid SSR mismatch)
  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "breakdown" || stored === "compact") setMode(stored);
  }, [storageKey]);

  // Cross-tab sync
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === storageKey && (e.newValue === "compact" || e.newValue === "breakdown")) {
        setMode(e.newValue);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [storageKey]);

  const set = useCallback((m: ViewMode) => {
    setMode(m);
    window.localStorage.setItem(storageKey, m);
  }, [storageKey]);

  return [mode, set];
}
```

### 7. Wiring into scheduler pages

**Construction scheduler** — top-of-page toolbar area (where filters/date controls live), insert:
```tsx
const [viewMode, setViewMode] = useViewMode("scheduler:viewMode:construction");
// ...
<ViewModeToggle value={viewMode} onChange={setViewMode} />
```

In the card render block (today's `<ProjectCard>` or inline JSX), branch:
```tsx
{viewMode === "breakdown" && project.zuperSubJobs?.length ? (
  <SubJobBreakdown subJobs={project.zuperSubJobs} />
) : (
  <ExistingCompactBadgeRow project={project} />
)}
```

**Master scheduler** — same pattern, separate localStorage key (`scheduler:viewMode:master`).

### 8. Files changed

**Modified:**
- `src/app/api/zuper/jobs/lookup/route.ts` — add `extractSubJobsForCategory` helper + `subJobs` map in response (both GET and POST handlers).
- `src/app/dashboards/construction-scheduler/page.tsx` — add `zuperSubJobs` field, decorate from lookup response, add toggle + render branch.
- `src/app/dashboards/scheduler/page.tsx` — same pattern.

**New:**
- `src/lib/scheduler-subjobs.ts` — `SubJobInfo` type, `SYSTEM_ORDER`, `SYSTEM_LABELS`, `SYSTEM_ICONS` constants.
- `src/components/scheduler/SubJobBreakdown.tsx` — render component + small inline presentational helpers.
- `src/components/scheduler/ViewModeToggle.tsx` — segmented control + `useViewMode` hook.
- `src/__tests__/api/zuper/jobs/lookup-subjobs.test.ts` — endpoint test.

**Unchanged:**
- `src/lib/zuper-construction.ts` — already exports `categoryToSystemType()` and `SystemType`; we consume as-is.
- `src/lib/deal-property-map.ts`, `src/lib/hubspot.ts` — no HubSpot prop plumbing for this spec.
- HubSpot deal properties `construction_solar_status`, `construction_battery_status`, `construction_ev_status` — exist on deals, not read by this feature.

## Data Flow Examples

### Example 1: Solar + Battery deal in breakdown mode

```
GET /api/zuper/jobs/lookup?projectIds=12345&projectNames=...&category=construction
  → lookup walks Zuper jobs, finds 2 candidates linked to deal 12345:
      - Construction - Solar (status: STARTED, crew: Diaz)
      - Construction - Battery (status: SCHEDULED, crew: Chen)
  → response:
    {
      jobs: { "12345": { jobUid: "solar-uid", status: "STARTED", ... } },  // best candidate
      subJobs: { "12345": [
        { systemType: "solar",   jobUid: "solar-uid",   status: "STARTED",   assignedTo: ["Joe Diaz"], ... },
        { systemType: "battery", jobUid: "battery-uid", status: "SCHEDULED", assignedTo: ["Mike Chen"], ... },
      ]}
    }

scheduler page:
  project.zuperJobStatus = "STARTED"            // existing field
  project.zuperSubJobs = [solar, battery]       // NEW

card render (breakdown):
  ☀ Solar    [STARTED]   J. Diaz   May 12–13
  🔋 Battery [SCHEDULED] M. Chen   May 12

card render (compact):
  [STARTED] Diaz, Chen  (unchanged from today)
```

### Example 2: Legacy `Construction` deal (in-flight, pre-split)

```
lookup finds 1 candidate: Construction (legacy category, status: IN_PROGRESS)
  → subJobs[dealId] = [{ systemType: "legacy", jobUid: "...", status: "IN_PROGRESS", ... }]

card render (breakdown):
  🔧 Construction [IN_PROGRESS] J. Diaz   May 12

card render (compact): unchanged
```

### Example 3: Solar-only deal

```
lookup finds 1 candidate: Construction - Solar (status: COMPLETED)
  → subJobs[dealId] = [{ systemType: "solar", ... }]

card render (breakdown): one ☀ Solar row.
card render (compact): unchanged.
```

### Example 4: No Zuper job matched

```
lookup finds zero candidates for the deal.
  → no entry in jobs[dealId], no entry in subJobs[dealId]

card render: identical in both modes — falls through to existing "No Zuper job" placeholder.
```

## Edge Cases

| Case | Behavior |
|---|---|
| Deal has multiple Zuper jobs in same system bucket (data error) | Pick highest `statusScore`, then `addressScore`. Sentry breadcrumb on duplicate. |
| Sub-job has no `assignedTo` | `CrewLabel` renders em-dash. |
| Sub-job has no scheduled dates | `ScheduleLabel` renders em-dash. |
| Status string unrecognized by `ZuperStatusBadge` | Default neutral tone (gray pill). |
| `zuperSubJobs` array empty after deserialization | Component returns `null` — falls back to compact badge row. |
| User has Breakdown selected but card has no `zuperSubJobs` | Render compact badge row anyway (safer than blank). |
| localStorage unavailable (private browsing edge case) | `useViewMode` falls back to in-memory state for the session. |
| Cross-tab toggle | `storage` event listener syncs both tabs to the new mode. |

## Risks

1. **Render performance.** Master scheduler can have 100+ cards. Breakdown adds 1–3 rows per card (~30px tall each). Layout reflow only — no extra fetch, no extra hooks per row. Acceptable; revisit if Sentry flags layout-shift or long tasks post-deploy.
2. **Crew name parsing.** `getAssignedUserNames` returns full names from Zuper. Truncating to "J. Diaz" relies on naive split-on-space; OK for two-token Anglo names, may render oddly for hyphenated or multi-part names. Acceptable for v1; can refine later.
3. **Status tone divergence.** If `ZuperStatusBadge` here renders different colors than the existing single-status badge elsewhere on the card, ops sees inconsistent colors. Mitigation: extract a single `zuperStatusToTone(status)` helper into `src/lib/scheduler-subjobs.ts` and use it from both badge sites.

## Testing

### Unit (`src/__tests__/api/zuper/jobs/lookup-subjobs.test.ts`)
Fixture-based tests against the new bucketing logic:
- Solar + battery + EV deal → 3 sub-jobs in stable order
- Solar-only deal → 1 sub-job
- Legacy Construction job → 1 legacy sub-job
- No construction match → no `subJobs` entry for that dealId
- Multiple jobs in same bucket (e.g., two Solar jobs from data error) → 1 sub-job picked by statusScore, breadcrumb logged
- Non-construction category call (`survey`, `inspection`) → `subJobs` field absent from response

### Component
No dedicated component tests — `<SubJobBreakdown>` and `<ViewModeToggle>` are thin presentational + hook code. Visual verification on staging suffices.

### Integration / manual
On staging, exercise both schedulers against:
1. A deal with all three sub-jobs (find one in the new construction pipeline)
2. A solar-only deal
3. A legacy `Construction` deal still in flight
4. A deal with no construction Zuper match (e.g., still in design)

For each: toggle Compact ↔ Breakdown, verify rendering matches table above. Confirm localStorage persists across reload. Confirm cross-tab sync (open scheduler in two tabs, toggle one, watch the other).

### Sentry watch
24-hour watch post-deploy on `/api/zuper/jobs/lookup` and the scheduler pages for new errors, especially: type errors on `zuperSubJobs`, breadcrumb spikes from duplicate-job-bucket warnings, layout-shift performance entries.

## Out of Scope

- HubSpot `construction_*_status` property plumbing through `deal-property-map.ts` / `hubspot.ts` (separate need; AI/chat tooling can wire it later)
- Per-system filter chips (filter visible cards to only those with active Battery work, etc.) — defer to a v2 if ops asks
- Mobile breakdown view — mobile uses a different layout entirely; current spec keeps mobile on Compact
- Rendering placeholder rows for missing sub-systems ("EV: not started" on a solar+battery deal)
- Per-system sales-order / line-item rollups on the card
