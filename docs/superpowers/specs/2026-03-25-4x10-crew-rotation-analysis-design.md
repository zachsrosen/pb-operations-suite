# 4x10 Crew Rotation Analysis

**Date:** 2026-03-25
**Type:** Analysis / Business Case Model
**Status:** Draft

## Problem

Photon Brothers runs 5 install crews across 3 Colorado locations on a standard Mon-Fri, 8-hour day schedule (25 crew-days/week, 200 crew-hours/week). The goal is to evaluate a 6-day operating window (Mon-Sat) where each crew works only 4 x 10-hour days, giving crews 3-day weekends while maintaining or improving install throughput.

## Crew Baseline

| Location | Crews | Current (5x8) | Proposed (4x10) |
|----------|-------|----------------|-----------------|
| Westminster | 2 | 10 crew-days, 80 hrs | 8 crew-days, 80 hrs |
| Centennial/DTC | 2 | 10 crew-days, 80 hrs | 8 crew-days, 80 hrs |
| Colorado Springs | 1 | 5 crew-days, 40 hrs | 4 crew-days, 40 hrs |
| **Total** | **5** | **25 crew-days, 200 hrs** | **20 crew-days, 200 hrs** |

Hours are identical. Crew-days drop by 5 but each day is 25% longer.

## Rotation Model

Two fixed groups with a 2-day overlap:

| | Mon | Tue | Wed | Thu | Fri | Sat |
|---|---|---|---|---|---|---|
| **Group A** (Mon-Thu) | ON | ON | ON | ON | off | off |
| **Group B** (Wed-Sat) | off | off | ON | ON | ON | ON |

- **Wed-Thu:** Both groups working (full capacity, handoff window)
- **Mon-Tue:** Group A only
- **Fri-Sat:** Group B only
- Each crew gets a 3-day weekend (Fri-Sun or Sun-Tue)

### Location Assignment

**2-crew locations** (Westminster, Centennial/DTC): One crew per group. Location is covered 6 days/week with double capacity on Wed-Thu.

**Colorado Springs** (1 crew): Assigned to either Group A or Group B. TBD based on demand analysis. Location is covered 4 days/week.

### Install Continuity Policy

1. **Primary:** Each install stays with its assigned crew within their 4-day block
2. **Overlap leverage:** Wed-Thu overlap allows same-crew continuation across the week's midpoint
3. **Handoff fallback:** For rare long-duration installs, the other crew at the same location can pick up during overlap days

## Data Foundation

### Source
HubSpot project pipeline deals for the 3 Colorado locations, last 6 months of completed installs.

### Key Metrics

| Metric | Source | Calculation |
|--------|--------|-------------|
| Actual install duration | `install_schedule_date` to `construction_complete_date` | Business days between (excludes weekends) |
| Installs per location/month | Project pipeline deals | Count by `pb_location` + `install_schedule_date` |
| Revenue per install | `deal.amount` | Sum and average by location |
| Crew utilization | Actual install days vs. capacity | `total_install_days / (crews x working_days)` |
| Day-of-week distribution | `install_schedule_date` | Which days installs currently start |

### Construction Turnaround Time

Two distinct metrics are derived from each historical install:

**HubSpot property mapping:** The raw HubSpot property is `install_schedule_date` (transformed to `constructionScheduleDate` in app code). `construction_complete_date` is the raw property name as-is.

#### Metric 1: Historical Crew-Days Required
Count Mon-Fri business days from `install_schedule_date` to `construction_complete_date` (the current 5x8 calendar). This is the ground-truth measure of how many work days each install actually consumed under the current schedule. This metric is used for Tab 1 (Current State) and as the input to the simulation.

#### Metric 2: Simulated Completion Under 4x10
For each historical install, simulate how it would play out on the A/B rotation calendar:

1. Take the install's **crew-days required** (from Metric 1)
2. Pick a **start day** (the historical day-of-week from `install_schedule_date`)
3. Assign it to a **group** (A or B, based on the crew assignment controls)
4. Walk the group's working calendar forward, consuming one crew-day per ON day, skipping OFF days
5. Record: **calendar days to complete**, whether it **stays within one block**, **spans into overlap**, or **requires a handoff**

This simulation is the engine behind Tab 2, Tab 3, and the playground. It never redefines what a "business day" means for historical data — it replays real durations onto the new calendar.

### Install Fit Classification

Fit is determined by the simulation (Metric 2), NOT by duration alone. It depends on three inputs: crew-days required, start day-of-week, and assigned group.

**Simulation rules per install:**

Given a crew in Group X starting on day D with N crew-days of work:
1. Walk group X's ON days forward from D, counting N working days
2. If the last working day falls within the crew's current 4-day block (same week): **fits in block**
3. If the last working day falls on a Wed or Thu AND the crew is working those days (overlap window), allowing same-crew continuation into the next block: **needs overlap**
4. If the work cannot be completed by the same crew even with overlap (remaining days fall on the crew's OFF days with no path to continue): **needs handoff**

**Examples (Group A = Mon-Thu):**
- 2-day install starting Monday → uses Mon, Tue → **fits in block**
- 3-day install starting Wednesday → uses Wed, Thu, then crew is OFF Fri-Sun. If pause is allowed, crew resumes Mon → **fits in block** (same crew, with weekend gap). If no pause allowed → **needs handoff** to Group B on Friday.
- 5-day install starting Monday → uses Mon-Thu (4 days), OFF Fri-Sun, resumes Mon (1 day) → **fits in block with pause**. If no pause allowed → **needs handoff** for the 5th day on Fri.

**Pause policy:** An install can pause over a crew's OFF days and resume in their next block. The simulation counts this as "fits in block" (same crew, no handoff) but flags the calendar gap. A handoff is only needed when the gap is unacceptable (e.g., open roof, weather-sensitive work) — modeled as a toggle in the playground.

## Deliverable A: Spreadsheet Model (xlsx)

### Tab 1 - Current State (5x8)
- Monthly install count by location
- Avg construction turnaround (business days) by location
- Revenue by location (total and per install)
- Crew utilization rate: actual install days / available crew-days
- Day-of-week heatmap: which days installs currently start
- Total crew-hours/week and revenue capacity

### Tab 2 - Proposed Model (4x10, Group A/B)
- Coverage calendar: which crews are on which days per location
- Simulated completion: each historical install replayed on the A/B calendar (using Metric 2), showing calendar days to complete and fit classification
- Install fit distribution: % that fit in block (with or without pause) vs. need handoff, broken down by location
- Avg simulated calendar span vs. current calendar span
- Net change in capacity, utilization, revenue throughput

### Tab 3 - Scenarios
- **COSP Group A vs. Group B:** Compare coverage patterns, what demand looks like on each side
- **6th crew impact:** Model all 3 placement options side-by-side (add to Westminster, Centennial, or COSP), each assigned to both Group A and B variants — show what each unlocks for capacity
- **Turnaround compression:** What if 10-hour days reduce avg turnaround by 1 day (e.g., 3-day install becomes 2-day on 10-hr days)

### Tab 4 - Executive Summary
- Side-by-side: current vs. proposed headline numbers
- Pros / cons / risks
- Recommendation

## Deliverable B: Interactive Playground (HTML)

Self-contained single-file HTML simulator. No server needed.

### Left Panel - Controls
- **Schedule toggle:** Current (5x8) vs. Proposed (4x10)
- **Crew assignment:** Dropdown per crew to assign Group A or Group B (pre-populated: 1 per group per 2-crew location). Free-form — users can assign both crews to the same group as a what-if scenario (shows the coverage gap that creates)
- **COSP group selector:** Group A or Group B
- **6th crew toggle:** Add a crew to a chosen location + group
- **Turnaround compression slider:** 0 to -2 days (model 10-hr day efficiency gain)
- **Pause tolerance toggle:** Allow installs to pause over OFF days (default on) vs. require continuous work (forces handoff for any install that spans OFF days)

### Right Panel - Live Visualizations
- **Weekly calendar grid:** Mon-Sat columns, rows per location, cells show active crews color-coded by group (A = one color, B = another)
- **Capacity comparison bars:** Crew-days/week and crew-hours/week, current vs. proposed side-by-side
- **Install fit donut chart:** % of installs fitting in block vs. pause-and-resume vs. handoff (driven by simulation engine, respects pause toggle)
- **Weighted score gauge:** Shows the decision rubric score for the current configuration
- **Key metrics row:** Operating days, crew-hours/week, revenue capacity, avg crew weekend length

All visualizations update live as controls change. Real install data (turnaround distribution, volume by location) baked into the HTML as inline JS data. Charts rendered with plain SVG (no external dependencies). Expected data volume is ~100-200 completed installs over 6 months, small enough to embed directly.

## Data Extraction Plan

1. Query HubSpot for project pipeline deals with `install_schedule_date` in the last 6 months
2. Filter to Colorado locations using canonical `pb_location` values: `Westminster`, `Centennial`, `Colorado Springs` (DTC normalizes to Centennial)
3. Require both `install_schedule_date` and `construction_complete_date` to be set (completed installs only)
4. Calculate business-day turnaround for each
5. Aggregate by location, month, and day-of-week
6. Feed aggregated data into both the spreadsheet and the playground

## Decision Rubric

All scenario comparisons (COSP group, 6th crew placement, compression) use a single weighted score so the spreadsheet and playground tell the same story:

| Factor | Weight | Measure |
|--------|--------|---------|
| **Install coverage** | 40% | % of historical installs that complete without handoff (fit-in-block + pause, no handoff needed) |
| **Handoff rate** | 25% | Inverse of % requiring handoff (lower is better) |
| **Revenue-weighted capacity** | 20% | Total revenue of coverable installs per week (installs that fit × their deal value) |
| **Location dark days** | 15% | Fewer days with zero crew coverage is better (primarily affects COSP) |

**How it's applied:**
- **COSP group choice:** Score Group A vs. Group B using COSP's historical installs against each calendar. Winner = higher weighted score.
- **6th crew placement:** Score each of the 3 location options (Westminster, Centennial, COSP) × 2 group assignments. Winner = highest marginal improvement to the weighted score over the 5-crew baseline.
- **Executive recommendation (Tab 4):** Present the top-scoring configuration with its score breakdown, plus the runner-up for comparison.

Both the spreadsheet and the playground compute the same weighted score so findings are consistent across deliverables.

## Success Criteria

The analysis should clearly answer:
1. Does 4x10 maintain the same crew-hours? (Yes, by design)
2. What % of current installs fit within a 4-day crew block without handoff?
3. How often would handoffs be needed, and on which day-of-week patterns?
4. What's the revenue capacity impact?
5. Which group should COSP join? (scored by rubric)
6. Is a 6th crew needed, and where? (scored by rubric)

## Out of Scope

- System changes to the scheduling tools (CrewAvailability, schedule-optimizer, dashboards)
- Survey, inspection, or service crew scheduling
- California locations (SLO, Camarillo)
- Actual implementation of the rotation
