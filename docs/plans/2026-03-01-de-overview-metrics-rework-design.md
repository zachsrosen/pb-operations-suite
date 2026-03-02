# D&E Overview + Metrics Rework — Design

**Date:** 2026-03-01
**Status:** Approved

## Problem

1. Approval rate formula is wrong — should be design approved / design approval sent (same cohort)
2. Design Status funnel on de-overview shows only current D&E-stage projects (12) — correct behavior after stage-only fix, but users expected more
3. No DA Status funnel on de-overview
4. Design turnaround uses wrong date range (close → design complete instead of design start → date returned from designers)
5. No design approval turnaround metric (DA sent → approved)
6. Rate and turnaround metrics should be filterable by 30/60/90 day windows
7. de-overview hero stats should be pipeline snapshot counts, not historical metrics

## Design

### 1. de-overview: Replace hero cards with pipeline snapshot

**Remove:** Avg Design Turnaround, Approval Rate, Flagged for Review
**Keep:** Active D&E Projects
**Add:** Ready for Design, Ready for Review, Pending DA

| Card | Computation |
|------|-------------|
| Active D&E Projects | `stage === "Design & Engineering"` count |
| Ready for Design | `designStatus === "Ready for Design"` count |
| Ready for Review | `designStatus === "Ready For Review"` count |
| Pending DA | `layoutStatus` in pending-approval statuses AND not approved |

### 2. de-overview: Add DA Status funnel

Below existing Design Status funnel. Same horizontal bar visual. Shows count per raw `layoutStatus` value for filtered D&E projects. Predefined ordered array of known statuses:

```ts
const DA_STATUS_FUNNEL = [
  { key: "Draft Created", label: "Draft Created", color: "bg-slate-500" },
  { key: "Draft Complete", label: "Draft Complete", color: "bg-blue-500" },
  { key: "Sent For Approval", label: "Sent For Approval", color: "bg-yellow-500" },
  { key: "Resent For Approval", label: "Resent For Approval", color: "bg-orange-500" },
  { key: "Review In Progress", label: "Review In Progress", color: "bg-purple-500" },
  { key: "Approved", label: "Approved", color: "bg-emerald-500" },
];
```

Only shows statuses with count > 0. Unknown statuses appended at end.

### 3. de-metrics: Add 30/60/90d time-windowed performance section

New section at top with segmented control toggle (30d / 60d / 90d, default 30d). Persisted in filter store.

**Approval Stats row (3 MetricCards):**

| Card | Formula |
|------|---------|
| DA Sent | Count where `designApprovalSentDate` falls within window |
| DA Approved | Count where `designApprovalDate` falls within window (independent cohort) |
| Approval Rate | Same-cohort: of projects with `designApprovalSentDate` in window, % that have `designApprovalDate`. Capped at 100%. |

**Turnaround Stats row (2 MetricCards):**

| Card | Formula |
|------|---------|
| Avg Design Turnaround | Mean of (`dateReturnedFromDesigners` − `designStartDate`) in days, for projects where both exist AND `dateReturnedFromDesigners` in window. Subtitle: "Start → Returned" |
| Avg DA Turnaround | Mean of (`designApprovalDate` − `designApprovalSentDate`) in days, for projects where both exist AND `designApprovalDate` in window. Subtitle: "Sent → Approved" |

### 4. Data model: add `dateReturnedFromDesigners`

New HubSpot property `date_returned_from_designers` (date type) must be added to:
- `DEAL_PROPERTIES` in hubspot.ts
- `Project` interface in hubspot.ts
- Deal transform in hubspot.ts
- `RawProject` interface in types.ts

All other required properties already exist: `designStartDate`, `designDraftDate`, `designApprovalSentDate`, `designApprovalDate`, `layoutStatus`, `designStatus`, `stage`.

### 5. Files changed

- `src/app/dashboards/de-overview/page.tsx` — replace hero cards, add DA Status funnel
- `src/app/dashboards/de-metrics/page.tsx` — add 30/60/90d toggle + windowed performance section
- `src/stores/dashboard-filters.ts` — add `timeWindow` to DE metrics filter state (if persisting toggle)
