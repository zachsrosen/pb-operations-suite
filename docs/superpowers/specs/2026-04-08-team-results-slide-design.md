# Team Results Slide — Design Spec

**Date**: 2026-04-08
**Replaces**: Pipeline Overview (first carousel slide)
**Placement**: Office Performance TV Dashboard Carousel (`/dashboards/office-performance/[location]`)

## Purpose

Replace the Pipeline Overview slide (management-focused data the field crews don't use) with a **Team Results** slide that shows the real-world impact of the crew's work: homes powered, kW installed, batteries installed, revenue earned, and a per-person breakdown.

---

## Data Sources

| Metric | HubSpot Property | Logic |
|--------|-----------------|-------|
| Homes Powered | `construction_complete_date` | Count of deals with `construction_complete_date` in current year, filtered by location |
| kW Installed | `calculated_system_size__kwdc_` | Sum of system size for deals with `construction_complete_date` in current year |
| Batteries Installed | `total_battery_count` | Sum of battery count for deals with `construction_complete_date` in current year |
| Revenue Earned | Existing `revenue-goals.ts` | YTD actual for the location's revenue group |
| Revenue Target | Existing `revenue-groups-config.ts` | Annual target for the location's revenue group |

### Crew Breakdown

Per-person YTD stats, built by cross-referencing:
- **Zuper job completions** (via `ZuperJobCache` or `handleLookup`) — who was assigned to each completed job
- **HubSpot deal properties** — system size and battery count on the linked deal

For each crew member with completed jobs this year:
- **Surveys**: count of completed Site Survey jobs assigned to them
- **Installs**: count of completed Construction jobs assigned to them
- **Inspections**: count of completed Inspection jobs assigned to them
- **kW**: sum of `calculated_system_size__kwdc_` from deals they installed
- **Batteries**: sum of `total_battery_count` from deals they installed

### Location → Revenue Group Mapping

| Location | Revenue Group Key |
|----------|------------------|
| Westminster | `westminster` |
| Centennial (DTC) | `dtc` |
| Colorado Springs | `colorado_springs` |
| San Luis Obispo / Camarillo | `california` |

---

## UI Layout

### Header
Same as other carousel slides: location name + "TEAM RESULTS" label in orange.

### Impact Cards (4-column grid)
| Card | Color | Value | Subtitle |
|------|-------|-------|----------|
| Homes Powered | Orange gradient | Count | "in 2026" |
| kW Installed | Green gradient | Sum | "in 2026" |
| Batteries Installed | Purple gradient | Count | "in 2026" |
| Revenue Earned | Blue gradient | Dollar amount | "in 2026" |

Each card uses a subtle gradient background matching its accent color (same style as the approved mockup).

### Crew Breakdown Table
- Header: "⚡ CREW BREAKDOWN — 2026"
- Columns: NAME, SURVEYS, INSTALLS, INSPECTIONS, kW, BATTERIES
- Rows sorted by total activity (most active first)
- Cells show colored values for the person's active categories, "—" for categories they don't work in
- Capped at 8 rows to fit on screen

### Recent Wins Ticker
- Bottom bar showing recent completed projects with customer name and deal amount
- Format: "🎉 LastName — $XXK"
- Shows deals with `construction_complete_date` in the last 7 days
- No PTO references

---

## Type Changes

### New type: `TeamResultsData`

```typescript
interface TeamResultsData {
  homesPowered: number;        // YTD count
  kwInstalled: number;         // YTD sum
  batteriesInstalled: number;  // YTD count
  revenueEarned: number;       // YTD dollars
  revenueTarget: number;       // Annual target
  crewBreakdown: CrewMember[]; // Per-person stats
  recentWins: RecentWin[];     // Last 7 days
}

interface CrewMemberStats {
  name: string;
  surveys: number;
  installs: number;
  inspections: number;
  kwInstalled: number;
  batteriesInstalled: number;
}

interface RecentWin {
  customerName: string;
  amount: number;
}
```

### Updated `OfficePerformanceData`

```typescript
interface OfficePerformanceData {
  location: string;
  lastUpdated: string;
  teamResults: TeamResultsData;  // Replaces pipeline
  surveys: SurveyData;
  installs: InstallData;
  inspections: InspectionData;
}
```

### Updated `CarouselSection`

```typescript
type CarouselSection = "teamResults" | "surveys" | "installs" | "inspections";
```

---

## Data Fetching

### New HubSpot Properties to Fetch

Add to the `fetchAllProjects` property list (or a separate fetch):
- `calculated_system_size__kwdc_`
- `total_battery_count`

These are already calculated properties in HubSpot (computed from line items).

### Revenue Data

Call `fetchRevenueDeals(year)` from `revenue-goals.ts` and `aggregateRevenue()` from `revenue-groups-config.ts` to get the location's YTD actual. This avoids duplicating revenue logic.

Alternatively, since we already have `construction_complete_date` and `amount` on deals, we can compute a simpler location-only sum directly from `locationProjects` without the full revenue pipeline. This is faster and avoids the Zuper revenue fetch for service/roofing.

**Recommended**: Simple sum of `amount` for deals with `construction_complete_date` in current year, filtered by location. Use annual target from `REVENUE_GROUPS` config.

### Crew Breakdown

Use existing `getZuperJobsByLocation()` which queries `ZuperJobCache` for completed jobs. Cross-reference `hubspotDealId` on each cached job with the deal's `calculated_system_size__kwdc_` and `total_battery_count`.

Build a map: `dealId → { systemSize, batteryCount }` from `locationProjects`, then for each completed install job, attribute the deal's kW and batteries to the assigned users.

---

## Files to Create/Modify

### New Files
- `src/app/dashboards/office-performance/[location]/TeamResultsSection.tsx` — New carousel section component

### Modified Files
- `src/lib/office-performance-types.ts` — Add `TeamResultsData`, `CrewMemberStats`, `RecentWin` types; update `OfficePerformanceData`, `CarouselSection`
- `src/lib/office-performance.ts` — Add `buildTeamResultsData()` function; update `getOfficePerformanceData()` orchestrator; add new HubSpot properties to `ProjectForMetrics`
- `src/app/dashboards/office-performance/[location]/OfficeCarousel.tsx` — Replace `PipelineSection` with `TeamResultsSection` in render switch

### Removed
- Pipeline section is no longer rendered (keep `PipelineSection.tsx` file for now — may be useful for admin view later)

---

## Out of Scope

- Monthly crew breakdown on individual section pages (future enhancement — user mentioned "maybe a version on the other pages for last month")
- Company-wide aggregation across all locations
- Per-deal drill-down from crew table
- Historical comparison (YTD vs prior year)
