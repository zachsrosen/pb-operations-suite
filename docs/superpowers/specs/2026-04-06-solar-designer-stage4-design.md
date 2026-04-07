# Solar Designer Stage 4 — Production Analysis, Timeseries, Inverter Configuration

**Date:** 2026-04-06
**Status:** Draft
**Depends on:** Stage 3 (Visualizer + Stringing)

## Overview

Stage 4 wires three analysis tabs (Production, 30-Min Series, Inverters) to the existing v12-engine. The engine, worker protocol, and all computation modules already exist — this stage is purely UI + state integration.

A "Run Analysis" button triggers `runCoreAnalysis()` via Web Worker. Results populate three new tabs. Inverter MPPT assignment is auto-generated on run, with manual reassignment available post-analysis.

## 1. Run Analysis — Trigger + Worker Integration

### Trigger

A `RunAnalysisButton` component in the sidebar, below `SystemSummaryBar`. Three visual states:

- **Disabled**: panels, equipment, or strings missing. Grayed out with helper text.
- **Ready**: all prerequisites met. Orange primary button.
- **Running**: progress bar with percent + stage label. Button disabled.

### Prerequisites

The button is enabled when all three conditions are met:
- `state.panels.length > 0`
- `state.selectedPanel !== null && state.selectedInverter !== null`
- `state.strings.length > 0`

### Worker Flow

1. User clicks Run → dispatch `RUN_ANALYSIS_START`
2. Component builds `CoreSolarDesignerInput`:
   - Bridge `UIStringConfig[]` → `StringConfig[]` (panel IDs → panel indices)
   - Auto-assign `InverterConfig[]` (see below)
   - Copy equipment keys, site conditions, loss profile, shade data
3. Create Web Worker from `v12-engine/worker.ts`, post `{type: 'RUN_SIMULATION', payload: input}`
4. Worker posts `SIMULATION_PROGRESS` → dispatch `SET_ANALYSIS_PROGRESS`
5. Worker posts `SIMULATION_RESULT` → dispatch `SET_RESULT`
6. Worker posts `SIMULATION_ERROR` → dispatch `SET_ANALYSIS_ERROR`
7. Terminate worker after result or error

### Auto-Assign Inverter Config

Before sending to the worker, distribute strings across MPPT channels:

```
channelsPerInverter = selectedInverter.channels
inverterCount = ceil(strings.length / channelsPerInverter)

For each inverter i (0..inverterCount-1):
  channels = []
  For each channel j (0..channelsPerInverter-1):
    stringIndex = i * channelsPerInverter + j
    if stringIndex < strings.length:
      channels.push({ strings: [stringIndex] })
    else:
      channels.push({ strings: [] })
  inverters.push({ inverterKey, channels })
```

The generated `InverterConfig[]` is stored in `state.inverters` alongside the result so the Inverters tab can display and modify it.

### Tab Unlock

`ENABLED_TABS` becomes dynamic:
- Always enabled: `['visualizer', 'stringing']`
- Enabled when `state.result !== null`: `['production', 'timeseries', 'inverters']`

## 2. Production Tab

Layout: summary cards → monthly bar chart → per-panel table. All visible simultaneously.

### Summary Cards

Four `MetricCard` components in a row:

| Card | Source | Accent |
|------|--------|--------|
| Annual Production (kWh) | `result.production.stringLevelAnnual` | orange |
| Specific Yield (kWh/kWp) | `result.specificYield` | cyan |
| Mismatch Loss (%) | `result.mismatchLossPct` | red |
| System TSRF | `result.systemTsrf` | green |

### Monthly Bar Chart

Native SVG paired bar chart. 12 month groups, each with two bars:

- **Model A** (orange): independent panel production. Derived from `aggregateTimeseries(sumTimeseries(result.independentTimeseries), 'year')`.
- **Model B** (cyan): string-level production. Derived from `aggregateTimeseries(sumTimeseries(result.stringTimeseries), 'year')`.

Y-axis: kWh. Hover tooltip showing month name + both values + delta.

Implemented as a standalone `ProductionChart` component accepting `modelA: TimeseriesView` and `modelB: TimeseriesView` props.

### Per-Panel Table

Scrollable table below the chart. Columns:

| Column | Source | Notes |
|--------|--------|-------|
| Panel | panel ID from `state.panels[i].id` | |
| TSRF | `result.panelStats[i].tsrf` | |
| Independent (kWh) | sum of `result.independentTimeseries[i]` | Model A |
| String (kWh) | panel's share of string output | Derived from string timeseries |
| Δ Loss (%) | `(independent - string) / independent * 100` | Red if > 2%, yellow if > 1% |

Default sort: Δ Loss descending (worst-performing panels first). Clickable column headers for re-sorting.

### Empty State

When `state.result` is null: centered message "Run analysis to see production results" with muted styling.

## 3. 30-Min Series Tab

Layout: period toggle → chart → string selector.

### Period Toggle

Row of 4 buttons: Day, Week, Month, Year. Default: Year.

Maps directly to `aggregateTimeseries()` periods:
- **Day**: 48 half-hour bars (Wh per interval)
- **Week**: 7 daily bars (kWh per day)
- **Month**: ~28-31 daily bars (kWh per day)
- **Year**: 12 monthly values (kWh per month), displayed as area chart

### Date Navigator

For Day, Week, and Month views: `← [date label] →` buttons to scrub through the year.

- Day view: shows day of year (e.g., "June 21"), range 1-365
- Week view: shows week number (e.g., "Week 25"), range 1-52
- Month view: shows month name (e.g., "June"), range 1-12

The `startDay` parameter of `aggregateTimeseries()` controls which slice is shown.

### Chart

Native SVG chart. `TimeseriesChart` component.

**Year view**: Area chart with two overlaid series:
- Model A (orange, solid fill) — `sumTimeseries(result.independentTimeseries)`
- Model B (cyan, dashed line) — `sumTimeseries(result.stringTimeseries)`

**Day/Week/Month views**: Bar chart with the same two series as paired bars (same pattern as `ProductionChart`).

X-axis labels from `TimeseriesView.labels`. Y-axis: kWh (or Wh for half-hourly Day view).

### String Selector

Dropdown below the chart:
- "System Total" (default) — `sumTimeseries()` across all panels/strings
- "String N (X panels)" — shows `result.stringTimeseries[i]` for a single string

When a specific string is selected, only Model B (string-level) series is shown (Model A doesn't apply to individual strings).

### Empty State

Same pattern: "Run analysis to see timeseries data."

## 4. Inverters Tab

Layout: per-inverter cards → MPPT reassignment → clipping summary + event log.

### Inverter Cards

One card per inverter in `state.inverters`. Each card shows:

**Header row:**
- Inverter name + model from `state.selectedInverter`
- DC/AC ratio badge: green (< 1.2), yellow (1.2–1.5), red (> 1.5)
- MPPT channel count

**MPPT channel list:**
- Each channel shows its assigned strings as colored chips (same color palette as StringList/PanelCanvas)
- Empty channels show "— empty —" in muted italic
- Panel count per string shown on the chip

**DC input summary:**
- Total DC input power: sum of (panels × Vmp × Imp) across all assigned strings
- AC rated power from inverter spec
- DC/AC ratio = DC input / AC rated

### Manual MPPT Reassignment

Click a string chip to select it, then click a different MPPT channel (on the same inverter) to move it there. Dispatches `REASSIGN_STRING_TO_CHANNEL` action with `{ inverterId, stringIndex, fromChannel, toChannel }`.

Reassignment sets `state.resultStale = true` and shows a yellow banner: "Inverter config changed — re-run analysis to update results." The Run button in the sidebar shows a pulsing indicator.

### Clipping Summary (per inverter)

Below the MPPT channels on each card:
- Total clipped energy (kWh/year) from `result.clippingEvents` filtered by inverter ID
- Peak clipping power (W)
- Number of clipping events

**Stage 1 limitation**: The engine currently returns empty clipping events (no dispatch module). When `result.clippingEvents` is empty, show: "Clipping analysis available after dispatch module (Stage 5)." The UI structure is built and ready for when the data populates.

### Clipping Event Log

Expandable table below the inverter cards. Only shown when `result.clippingEvents.length > 0`.

Columns: Date, Start Time, End Time, Duration, Peak Clipped (W), Total Clipped (Wh).

All values directly from `ClippingEvent` fields.

### Stale Result Indicator

When `state.resultStale` is true:
- Yellow banner at the top of the Inverters tab
- "Re-run" button in the banner that dispatches `RUN_ANALYSIS_START`
- The sidebar `RunAnalysisButton` shows a pulsing orange dot

## 5. State Changes

### New State Fields

```typescript
// Add to SolarDesignerState
isAnalyzing: boolean;
analysisProgress: { percent: number; stage: string } | null;
analysisError: string | null;
resultStale: boolean;
```

### New Actions

```typescript
// Add to SolarDesignerAction
| { type: 'RUN_ANALYSIS_START' }
| { type: 'SET_ANALYSIS_PROGRESS'; percent: number; stage: string }
| { type: 'SET_RESULT'; result: CoreSolarDesignerResult; inverters: InverterConfig[] }
| { type: 'SET_ANALYSIS_ERROR'; error: string }
| { type: 'REASSIGN_STRING_TO_CHANNEL'; inverterId: number; stringIndex: number; fromChannel: number; toChannel: number }
```

### Reducer Cases

- `RUN_ANALYSIS_START`: sets `isAnalyzing: true`, clears `analysisError`, `analysisProgress`
- `SET_ANALYSIS_PROGRESS`: updates `analysisProgress`
- `SET_RESULT`: stores `result` and `inverters`, sets `isAnalyzing: false`, `resultStale: false`
- `SET_ANALYSIS_ERROR`: stores `analysisError`, sets `isAnalyzing: false`
- `REASSIGN_STRING_TO_CHANNEL`: updates `state.inverters` channel assignment, sets `resultStale: true`

### Existing Action Modifications

- `SET_STRINGS`, `AUTO_STRING`, `ASSIGN_PANEL`, `UNASSIGN_PANEL`, `CREATE_STRING`, `DELETE_STRING`: should set `resultStale: true` if `state.result !== null` (string config changed → results are stale)

## 6. New Components

| Component | Purpose |
|-----------|---------|
| `RunAnalysisButton.tsx` | Sidebar button with progress bar, worker lifecycle management |
| `ProductionTab.tsx` | Composes summary cards + ProductionChart + panel table |
| `ProductionChart.tsx` | Native SVG monthly paired bar chart (Model A vs B) |
| `TimeseriesTab.tsx` | Composes period toggle + TimeseriesChart + string selector + date navigator |
| `TimeseriesChart.tsx` | Native SVG chart — area mode (year) and bar mode (day/week/month) |
| `InvertersTab.tsx` | Inverter cards + MPPT channel display + reassignment + clipping log |

All components created in `src/components/solar-designer/`.

## 7. Dependencies

No new npm dependencies. All charts are native SVG, consistent with existing `MonthlyBarChart` and `PanelCanvas` patterns. Worker module already exists.

## 8. Acceptance Criteria

1. Run button disabled when prerequisites not met (panels, equipment, strings)
2. Run button shows progress bar with stage label during analysis
3. Production tab shows 4 summary metric cards with correct values
4. Monthly bar chart renders 12 paired bars (Model A orange, Model B cyan)
5. Per-panel table shows TSRF, independent kWh, string kWh, Δ loss %
6. Panel table sorts by Δ loss descending by default
7. Timeseries tab has working Day/Week/Month/Year toggle
8. Day view shows 48 half-hour bars with date navigator
9. Year view shows area chart with dual series overlay
10. String selector dropdown filters to individual string timeseries
11. Inverter cards show MPPT channels with assigned string chips
12. Click-to-reassign moves strings between MPPT channels
13. Reassignment sets resultStale and shows yellow banner
14. Clipping section shows Stage 5 placeholder when events are empty
15. Tabs only enabled after successful analysis run
16. Error state shown when worker reports failure
17. Modifying strings/equipment after analysis marks result as stale
