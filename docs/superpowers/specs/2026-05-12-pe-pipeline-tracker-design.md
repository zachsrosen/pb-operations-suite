# PE Pipeline Tracker — Design Spec

## Problem

PE-enrolled deals stuck in Construction and Inspection stages block M1/M2 milestone payments. There's no visibility into how long these deals have been sitting — the general construction dashboard doesn't filter to PE deals, and the pe-docs dashboard focuses on document status, not pipeline velocity. Zach and Ops managers need a focused view to spot stale PE deals and push them forward.

## Solution

A new dashboard page at `/dashboards/pe-pipeline` showing PE deals in Construction and Inspection stages, sorted by days-in-stage descending. The primary metric is time — how long each deal has been in its current stage — with color-coded urgency bands.

## Data Source

**HubSpot Search API** with server-side filters:

- Pipeline: Project pipeline (`6900017`)
- Stage: `20440342` (Construction) OR `22580872` (Inspection)
- `is_participate_energy`: `true`

**Properties fetched per deal:**

| Property | Purpose |
|----------|---------|
| `dealname` | Display name |
| `dealstage` | Current stage ID |
| `pb_location` | Location filter |
| `hs_v2_date_entered_current_stage` | Compute days-in-stage |
| `pe_m1_status` | M1 milestone context |
| `pe_m2_status` | M2 milestone context |
| `amount` | Deal value |

Contact associations resolved via batch-read for primary contact name.

**API route:** `GET /api/deals/pe-pipeline`

Uses `searchWithRetry()` with the standard HubSpot rate-limit retry pattern. Single search call with compound filters — no pagination needed unless PE deal count exceeds 100 (unlikely for construction+inspection subset; add `after` cursor if needed).

Response shape:

```ts
interface PePipelineDeal {
  dealId: string;
  dealName: string;
  stage: "Construction" | "Inspection";
  location: string;
  daysInStage: number;
  m1Status: string | null;
  m2Status: string | null;
  amount: number | null;
  contactName: string | null;
}
```

## UI Layout

Standard `DashboardShell` with `accentColor="orange"`.

### Hero Stats (4 cards)

| Card | Color | Value |
|------|-------|-------|
| In Construction | orange | Count of PE deals in Construction stage |
| In Inspection | blue | Count of PE deals in Inspection stage |
| Avg Days in Stage | purple | Mean days-in-stage across all deals |
| Stale (14+ days) | red | Count of deals with days-in-stage ≥ 14 |

### Filters

- **Location**: `MultiSelectFilter` matching `pb_location` values (same pattern as other dashboards)
- **Stage**: Construction / Inspection / All

### Table

Sortable columns, default sort: days-in-stage descending (stalest first).

| Column | Data | Notes |
|--------|------|-------|
| Deal | Deal name | Linked to HubSpot deal |
| Location | `pb_location` | — |
| Stage | Construction / Inspection | Badge style |
| Days in Stage | Computed integer | Color: green <7d, amber 7–14d, red 14d+ |
| M1 Status | `pe_m1_status` | Badge, nullable |
| M2 Status | `pe_m2_status` | Badge, nullable |
| Contact | Primary contact name | — |
| Amount | Deal value | Formatted currency |

### Empty State

If zero deals match filters: "No PE deals in construction or inspection stages."

## Staleness Thresholds

| Days | Color | Label |
|------|-------|-------|
| 0–6 | green | On track |
| 7–13 | amber | Watch |
| 14+ | red | Stale |

The 14-day threshold for the hero stat matches the red band. These are hardcoded constants (not configurable) — simple enough to adjust in code if the team's expectations shift.

## Route Access

**Suite placement:**
- Accounting suite (alongside pe-docs, pe-deals)
- Operations suite

**Role allowlist** (in `src/lib/roles.ts`):
ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS, ACCOUNTING

## Files

| File | Action |
|------|--------|
| `src/app/api/deals/pe-pipeline/route.ts` | Create — API route |
| `src/app/dashboards/pe-pipeline/page.tsx` | Create — Dashboard page |
| `src/lib/roles.ts` | Modify — Add `/dashboards/pe-pipeline` and `/api/deals/pe-pipeline` to role allowlists |
| `src/lib/suite-nav.ts` | Modify — Add card to Accounting and Operations suites |

## Non-Goals

- No cron or background sync — this is a live HubSpot query on page load
- No database tables — purely HubSpot-sourced
- No export/CSV — table is the view, discussions happen in person
- No drill-down into PE doc status per deal — that's what pe-docs is for
- No write operations — read-only dashboard
