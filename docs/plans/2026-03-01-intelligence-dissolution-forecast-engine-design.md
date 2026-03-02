# Intelligence Suite Dissolution + Forecast Engine Design

**Date:** 2026-03-01
**Status:** Approved
**Approach:** Build forecasting engine first, then dissolve Intelligence Suite

---

## Problem Statement

The Intelligence Suite has 13 dashboards that suffer from three issues:
1. **Low usage** — most dashboards aren't actively used by the team
2. **Identity crisis** — "Intelligence" is too vague; dashboards range from PM workload to sales funnels
3. **Weak forecast data** — 7 of 13 dashboards depend on forecasted dates that default to `closeDate + 90/120/150 days` when missing, making risk scores, timelines, and capacity views unreliable

Additionally, the Admin Suite contains operational dashboards (Zuper Compliance, Mobile) that belong elsewhere.

## Solution Overview

**Phase 1:** Build a QC-data-driven forecasting engine as a shared service
**Phase 2:** Retrofit all forecast-dependent dashboards to use the new engine
**Phase 3a:** Move obvious-fit dashboards to their natural suites
**Phase 3b:** Evaluate forecast-dependent dashboards with real data, then move or cut
**Phase 4:** Build Forecast Accuracy dashboard, remove Intelligence Suite from nav

---

## Phase 1: Forecasting Engine

### Architecture

New shared module: `src/lib/forecasting.ts`

Computes milestone forecasts for any project using historical QC data, segmented by location, AHJ, and utility.

### Milestone Chain (in order)

```
Close → Design Complete → Permit Submit → Permit Approval → IC Submit → IC Approval → RTB → Install → Inspection → PTO
```

Priority milestones ("big three"): Install, Inspection, PTO. All 9 are forecasted but the big three drive risk/alerting.

### Components

#### 1. QC Baseline Builder

- Queries completed projects from the last 12 months
- Computes **median** days between each consecutive milestone pair
- Segmented by `(location, AHJ, utility)` with fallback hierarchy:
  - `(location, AHJ, utility)` — best, requires >= 5 data points
  - `(location)` — fallback, requires >= 5 data points
  - `(global)` — last resort
- Stored as a lookup table in `appCache` with daily refresh
- Each segment includes: median days, sample count, p25/p75 for confidence bands

#### 2. Forecast Calculator

For a given project at deal close:
- Looks up its `(location, AHJ, utility)` segment
- Chains median durations forward from `closeDate` to produce forecast dates for all 9 milestones
- Produces two forecast sets:
  - `original_forecast` — locked at first computation, never changes
  - `live_forecast` — starts as a copy of original, updated as milestones complete
- Each forecasted date includes a `basis` field:
  - `"segment"` — derived from location+AHJ+utility (best confidence)
  - `"location"` — fell back to location-only data
  - `"global"` — fell back to global averages (weakest)
  - `"actual"` — milestone already completed (date is real)

#### 3. Live Recalculation

When a milestone completes (detected via HubSpot date field becoming non-null):
- Lock that milestone to its actual completion date
- Recompute all remaining milestones from the new "current position" using QC segment data
- Update `live_forecast` only; `original_forecast` stays frozen
- Example: permit approved faster than expected → remaining forecasts (RTB, Install, Inspection, PTO) all pull in

#### 4. Remove Old Fallbacks

Kill `FORECAST_OFFSETS` constant (`+90/120/150 days`) entirely. If QC data can't produce an estimate (brand new location, no historical data), the forecast shows "Insufficient data" instead of a fake date.

### Storage

Forecasts are computed fields on `TransformedProject` at transform time, not persisted to DB. The QC baseline lookup table is cached in `appCache` with daily refresh cycle.

### API Surface

- `GET /api/forecasting/baselines` — returns current QC baseline table (for debugging/transparency)
- Forecasts are embedded in the existing `/api/projects` response as new fields on each project

---

## Phase 2: Retrofit Existing Dashboards

Replace all `closeDate + 90/120/150` fallback logic with the forecasting engine output. Affected dashboards:

| Dashboard | Current Fallback | Change |
|---|---|---|
| At-Risk Projects | `closeDate + 90/120/150` for risk scoring | Use `live_forecast.*` dates; show `basis` indicator |
| Timeline View | Static offset bars | Use `live_forecast.*` for Gantt bar endpoints |
| Pipeline Overview | `closeDate + 90/120/150` for overdue counts | Use `live_forecast.*` dates |
| Pipeline Optimizer | Fabricated `forecastPto` | Use `live_forecast.*`; show "Insufficient data" if no forecast |
| Capacity Planning | `estimated_install_days` defaults to 2 | Use `live_forecast.install` for monthly bucketing |
| PE Dashboard | Forecast fallbacks for PE milestones | Use `live_forecast.*` with PE-specific milestone tracking |
| Alerts | `days_to_install < -7` using fallback dates | Use `live_forecast.install` with `basis` check |

All retrofitted dashboards should visually distinguish forecast basis:
- Segment-based forecasts: shown normally
- Location-based: shown with subtle indicator
- Global fallback: shown with warning indicator
- Insufficient data: shown as "—" with tooltip

---

## Phase 3a: Move Obvious-Fit Dashboards

These dashboards move immediately after forecasting retrofit (or can move before if desired — they don't depend on forecasts):

### To D&E Suite
| Dashboard | Section | Notes |
|---|---|---|
| D&E Dept Analytics | Analytics | Ops queue + DA backlog complement D&E Overview |

### To P&I Suite
| Dashboard | Section | Notes |
|---|---|---|
| P&I Dept Analytics | Analytics | Location gaps + utility turnarounds fill real P&I gaps |
| Incentives | Programs | Incentive tracking tied to IC/PTO workflows |

### To Executive Suite
| Dashboard | Section | Notes |
|---|---|---|
| Sales Pipeline | Sales | Sales funnel alongside Revenue, Executive Summary |
| PE Dashboard | Programs | PE is a program-level concern for leadership |
| Zuper Compliance | Field Performance | Leadership visibility into crew compliance (moved from Admin) |

### Admin Suite Changes
| Dashboard | Action |
|---|---|
| Zuper Compliance | Remove from Admin (moved to Executive) |
| Mobile Dashboard | Keep standalone — field-optimized, doesn't belong in a suite |
| Zuper Status Comparison | Keep in Admin — data quality audit, correct home |

---

## Phase 3b: Evaluate Forecast-Dependent Dashboards

These dashboards stay in a slimmed Intelligence Suite until forecasting engine is live and we can assess their value with real data:

| Dashboard | Tentative Destination | Evaluation Criteria |
|---|---|---|
| At-Risk Projects | Operations | Are risk scores reliable with real forecasts? |
| QC Metrics | Operations | Does it remain useful or become redundant? |
| Pipeline Overview | Executive | Does it overlap too much with Sales Pipeline? Merge or keep? |
| Timeline View | Executive | Are Gantt bars meaningful with real forecast dates? |
| Pipeline Optimizer | Operations | Can it actually optimize scheduling with real data? |
| Alerts | Merge into At-Risk | Is the capacity heatmap worth keeping as a standalone section? |

### Cut List
| Dashboard | Reason |
|---|---|
| Capacity Planning | WEAK — gap counter labeled "AI Optimizer." Rebuild later if needed. |

---

## Phase 4: Forecast Accuracy Dashboard + Final Cleanup

### New Dashboard: Forecast Accuracy (Executive Suite)

Shows how well the forecasting model predicts reality:

- **Overall accuracy** — For completed projects: original forecast vs. actual date for each milestone. Median absolute error in days.
- **By segment** — Accuracy broken down by location, AHJ, utility. Reveals which segments the model handles well vs. poorly.
- **Drift tracking** — How much did the live estimate change from the original forecast? Large drift = project had surprises.
- **Confidence distribution** — What % of forecasts used `segment` vs. `location` vs. `global` basis? More `global` = less reliable.
- **Improvement over time** — Is the model getting better as more data accumulates? Monthly accuracy trend.

### Remove Intelligence Suite

- Delete `src/app/suites/intelligence/page.tsx`
- Remove from `SUITE_NAV_ENTRIES` in `suite-nav.ts`
- Remove from all `SUITE_SWITCHER_ALLOWLIST` entries
- Update `DashboardShell` SUITE_MAP breadcrumbs for all moved dashboards
- Add redirect from `/suites/intelligence` to `/suites/operations` for bookmarks

---

## Final Suite Layout

### Operations Suite
**Scheduling:** Master Schedule, Site Survey Schedule, Construction Schedule, Inspection Schedule
**Field Execution:** Site Survey, Construction, Inspections (from Tech Ops dissolution)
**Inventory & Equipment:** Equipment Backlog, Inventory Hub, Planset BOM, BOM History, Equipment Catalog, Product Catalog
**Risk & Quality (from Phase 3b):** At-Risk Projects, QC Metrics
**Scheduling Intelligence (from Phase 3b):** Pipeline Optimizer
**Alerts (from Phase 3b):** Merged into At-Risk

### Executive Suite
**Revenue:** Revenue, Revenue Calendar
**Leadership:** Executive Summary, Location Comparison
**Sales:** Sales Pipeline
**Programs:** PE Dashboard, Incentives (if moved from P&I later)
**Field Performance:** Zuper Compliance
**Forecasting (from Phase 3b):** Pipeline Overview, Timeline View
**Meta:** Forecast Accuracy (new)

### D&E Suite
**Design Pipeline:** D&E Overview, Plan Review Queue, Pending Approval, Design Revisions
**Analytics:** D&E Metrics, Clipping & System Analytics, D&E Dept Analytics
**Reference:** AHJ Design Requirements, Utility Design Requirements
**Tools:** Solar Surveyor
**Legacy:** Design (from Tech Ops)

### P&I Suite
**Pipeline:** P&I Overview, P&I Metrics, Action Queue
**Tracking:** AHJ Tracker, Utility Tracker
**Analytics:** Timeline & SLA, P&I Dept Analytics
**Programs:** Incentives
**Legacy:** Permitting, Interconnection (from Tech Ops)

### Service + D&R Suite (unchanged)
### Admin Suite (minus Zuper Compliance and Mobile)

---

## Dashboard Audit Summary (Reference)

| Dashboard | Rating | Forecast-Dependent | Unique Value |
|---|---|---|---|
| At-Risk Projects | STRONG | Yes (heavy) | Risk scoring, triage alerting |
| QC Metrics | DECENT | No (uses actuals) | Stage turnaround times by location/utility |
| Alerts | DECENT | Yes (heavy) | Capacity heatmap is good; rules simplistic |
| Timeline View | DECENT | Yes (heavy) | Gantt bars decorative without real dates |
| Pipeline Overview | DECENT | Yes (moderate) | Good UI, AI search, shallow priority scoring |
| Pipeline Optimizer | DECENT | Yes (critical) | Zuper sync works, "optimizer" is misnomer |
| Capacity Planning | WEAK | Yes (critical) | Gap counter labeled "AI Optimizer" |
| PE Dashboard | DECENT | Yes (heavy) | PE milestones, basis fields never shown |
| Sales Pipeline | DECENT | No | Basic funnel, no conversion rates |
| Project Management | STRONG | Low | PM workload, stuck deals, DA backlog |
| D&E Dept Analytics | DECENT | No | Ops queue + DA backlog unique |
| P&I Dept Analytics | STRONG | No | Location gaps + utility turnarounds |
| Incentives | WEAK (keep) | No | Status lookup; needs rebate $ tracking later |
| Zuper Compliance | STRONG | No | Per-user compliance scores, crew analysis |
| Zuper Status Comparison | DECENT | No | Data quality audit |
| Mobile Dashboard | STRONG | No | Field-optimized mobile view |
