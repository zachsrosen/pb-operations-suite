# Pipeline Health: RTB Bench, RTB Forecast & Backlog Aging (Project Pipeline)

> Scope grew from the initial "RTB bench metric" to a coherent pipeline-health set, since the pieces share one primitive (average stage duration): RTB bench + weeks-of-backlog, a DA-based RTB inflow forecast, per-deal backlog aging vs the stage average, and on-hold % in the conversion arrows.

**Date**: 2026-06-12
**Author**: Zach Rosen (IT)
**Origin**: P&L Weekly Update 2026-06-11 — leadership flagged the ready-to-build shortage and the $3M target; action item "identify additional ready-to-build projects to address current shortages."
**Status**: Draft — pending approval
**Target surface**: `/dashboards/project-pipeline-funnel`, **Active Pipeline** tab

---

## Purpose

Give Shop Directors and leadership a one-glance answer to *"do we have enough shovel-ready work, and how many weeks of runway is in the pipeline?"* — the exact question the P&L Weekly Operating Rhythm keeps raising. Today the funnel shows where deals sit, but it doesn't translate the ready-to-build count into **weeks of install coverage** or flag when the bench is running thin.

This adds a compact **Capacity & Backlog** hero row to the Active Pipeline tab, filterable by Location / PM / Owner like the rest of the page.

## Key message

> "RTB bench = shovel-ready work. Weeks of backlog = runway. When the bench thins, next month's install calendar has a hole — see it weeks early."

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where it lives | New "Capacity & Backlog" row at the top of the **Active Pipeline** tab only | It's a live-snapshot concept; meaningless on the Sales Funnel (cohort) or Monthly Throughput tabs |
| Compute location | Server-side in `buildProjectFunnelData` (active scope) | Reuses the existing filtered project set so Location/PM/Owner filters apply for free |
| Backlog-weeks formula | **Reuse** `shop-health.ts`'s 8-week trailing formula + `scoreBacklogWeeks` thresholds | One definition across dashboards; already validated |
| Install pace basis | **Trailing-actual** (8-wk avg completions) as the headline; configured capacity as a secondary comparison | Trailing-actual is robust and doesn't depend on `CREWS_CONFIG` being current |
| RTB bench definition | Active deals in **"Ready To Build"** stage (`22580871`) only | "Shovel-ready"; excludes RTB-Blocked, which is surfaced separately as a risk |
| Blocked surfaced separately | RTB-Blocked count + $ + top reason | We now have `rtb_blocked_reason`; the blocked bench is *not* available capacity |
| Forecast basis | **DA Approved** cohort, aged forward by average leg times | Forecasting from permitting buys ~1–2 wks; DA gives the full design→permit→RTB lead time (the window needed to actually feed the bench) |
| Forecast method | Cohort-aging (bottom-up) with a conversion haircut | Grounded in actual WIP position + trailing cycle times; lag-shifted DA throughput is a cross-check, not the headline |
| Stage-duration stat | **Average** (mean), not median | Per request; the aggregation's leg-time stat switches from `median()` to mean. One shared primitive feeds the forecast and the backlog-aging benchmark below |
| On-hold visibility | Carve **on-hold %** out of "pending" in the conversion arrows | On-hold deals are currently hidden inside pending; surfaced as a 4th segment (converted / cancelled / on-hold / pending) colored like the On Hold stage |
| Backlog aging | Compare each waiting deal to the **average** time its stage takes; flag overdue | Turns the backlog from "how many" into "how many are *late*" — the actionable cut |

---

## What we're measuring

Three distinct numbers the row exposes (don't conflate them):

1. **RTB Bench** — active deals currently in **Ready To Build** (permitted, awaiting a construction schedule). The shovel-ready count + dollars. This is the number the 6/11 meeting called "the shortage."
2. **Weeks of RTB coverage** — `rtbBench.count ÷ weeklyInstallRate`. "At our recent install pace, the ready bench covers N weeks before crews run dry."
3. **Weeks of Backlog** — `preconBacklogCount ÷ weeklyInstallRate`, where the pre-construction backlog = active deals in Site Survey → D&E → P&I → RTB-Blocked → Ready To Build. Total runway including work not yet ready. Health-colored.

Plus a risk card:

4. **RTB-Blocked** — count + $ of deals stuck in **RTB - Blocked**, with the single most common `rtbBlockedReason`. These look like bench but aren't — they're capacity that's jammed.

---

## Formulas

```
// Install pace (trailing actual), computed over the filtered active project set
eightWeeksAgo   = today − 56 days
weeklyInstallRate = count(projects with constructionCompleteDate in [eightWeeksAgo, today]) / 8

// RTB bench (shovel-ready)
rtbBench.count  = active deals with stageId === "22580871" (Ready To Build)
rtbBench.amount = Σ amount of those deals
weeksOfRtbCoverage = weeklyInstallRate > 0 ? round1(rtbBench.count / weeklyInstallRate) : null

// Pre-construction backlog runway  (reuses shop-health definition)
preconBacklogCount = active deals in stages:
  ["Site Survey","Design & Engineering","Permitting & Interconnection","RTB - Blocked","Ready To Build"]
weeksOfBacklog = weeklyInstallRate > 0 ? round1(preconBacklogCount / weeklyInstallRate) : null

// Blocked risk
blocked.count   = active deals with stageId === "71052436" (RTB - Blocked)
blocked.amount  = Σ amount
blocked.topReason = mode(rtbBlockedReason) over those deals  // null if none set

// Configured capacity (secondary comparison)
configuredWeeklyCapacity = Σ over selected locations of CREWS_CONFIG[loc].monthly_capacity / 4.33
// no location filter ⇒ sum all five
```

**Thresholds (reuse `shop-health.ts`):**

- `weeksOfBacklog` → `scoreBacklogWeeks`: **green 4–8**, **yellow 3 or 9–10**, **red <3 or >10**.
- `weeksOfRtbCoverage` (mirror shop-health hero #3 "Ready-to-Build Jobs"): **green ≥ 2.0**, **yellow 1.0–2.0**, **red < 1.0**.

> Rationale for the RTB-coverage bands: shop-health scores the RTB hero as green when ready jobs ≥ 2× weekly capacity. Expressed as weeks-of-coverage that's ≥ 2 weeks green, 1–2 yellow, <1 red.

---

## RTB inflow forecast (from DA Approved)

The bench cards above are a now-cast (depletion). This is the **leading indicator**: how many jobs will *arrive* in Ready-to-Build over the coming weeks, so a thinning bench is visible early enough to act on.

**Why DA, not permitting:** forecasting from the permitting step only sees ~1–2 weeks ahead. Anchoring on **DA Approved** captures the full design → permit → RTB chain, giving weeks-to-months of visibility — the horizon you need to chase more work into the bench (the literal 6/11 action item).

**Population:** active deals that have reached **DA Approved** but not yet Ready-to-Build (`hasDaApproved && !hasReachedRtb`), **excluding RTB-Blocked** (their timing is unpredictable; shown separately as upside).

**Method — cohort-aging (bottom-up).** Project each deal's expected RTB date by aging it forward from its furthest milestone using the trailing **average** leg times (the aggregation's leg-time stat, switched from median to mean — exposed as `averageDays`):

```
L1 = averageDays.approvedToDesignComplete
L2 = averageDays.designCompleteToPermitSubmit
L3 = averageDays.permitSubmitToIssued        // reaching permits issued ⇒ enters Ready To Build

remaining(deal) =
    reached permitsIssued       ? 0
  : reached permitsSubmitted     ? L3
  : reached designComplete       ? L2 + L3
  : /* at DA approved */           L1 + L2 + L3

expectedRtbDate = max(today, lastMilestoneDate + remaining)   // overdue vs medians ⇒ buckets as "now"
```

**Conversion haircut:** not every DA-approved deal reaches RTB (some cancel). Weight each projected arrival by the trailing **DA-Approved → Permits-Issued conversion rate** (`summary.permitsIssued.count / summary.daApproved.count`) so the forecast isn't inflated by deals that will die before RTB.

**Buckets:** weekly arrival count + $ for the next ~8 weeks, plus rolled-up next-2-week and next-4-week totals.

**Net flow (the headline):**

```
netFlow(window) = projectedInflow(window) − installPace × weeks(window)
// ▲ bench filling · ▼ shortage worsening
```

If 4-week projected inflow < 4-week install pace, the bench is draining faster than it refills — flag it red weeks before the install calendar shows a hole.

**Chaseable list:** the deals driving the forecast are exactly the Design & Engineering / Permitting drill-downs already on the page — i.e., "the jobs to push to refill RTB."

**Caveats (state on the card):**
- Median-aging assumes typical flow; stalled deals arrive late and bucket as overdue/"now". It's a planning estimate, not a commitment.
- Excludes RTB-Blocked (shown separately as potential upside).
- Cross-check: lag-shifting the DA-approved weekly throughput by the DA→RTB median should roughly track the cohort-aging curve; large divergence = a stalled cohort worth investigating.

**Response addition:**

```ts
export interface RtbForecast {
  weekly: Array<{ weekStart: string; count: number; amount: number }>; // next 8 weeks
  next2wk: { count: number; amount: number };
  next4wk: { count: number; amount: number };
  conversionRate: number;   // DA-approved → permits-issued, trailing
  netFlow4wk: number;       // next4wk.count − installPace × 4
}
// ProjectFunnelResponse.rtbForecast?: RtbForecast  (active scope only)
```

**UI:** a forward mini bar chart — *"Projected RTB arrivals (next 8 weeks)"* — with the install-pace line overlaid, rendered on the Active Pipeline tab directly beneath the Capacity & Backlog row; the **RTB Net Flow** figure also appears as a card in that row (▲/▼ colored).

## Backlog aging vs average

Each backlog bucket already shows the count and the average wait. Add a per-deal **aging-vs-benchmark**: compare a deal's current wait to the average time *that stage* takes, and color it. Turns "how many are waiting" into "how many are *late*."

Bucket → average leg (1:1; `waiting since` is already the drill-down's `daysWaiting` anchor):

| Backlog bucket | waiting since | benchmark (`averageDays`) |
|---|---|---|
| Awaiting Survey Schedule | close date | closedToSurveyScheduled |
| Awaiting Survey Complete | survey scheduled | surveyScheduledToComplete |
| Awaiting DA Send | survey complete | surveyToDaSent |
| Awaiting DA Approval | DA sent | daSentToApproved |
| Awaiting Design Complete | DA approved | approvedToDesignComplete |
| Awaiting Permit Submit | design complete | designCompleteToPermitSubmit |
| **Awaiting Permit Issue** | **permit submitted** | **permitSubmitToIssued** |
| Awaiting Construction Schedule | permit issued | permitIssuedToConstructionScheduled |
| Awaiting Construction Complete | construction scheduled | constructionScheduledToComplete |
| Awaiting Inspection | construction complete | constructionCompleteToInspection |
| Awaiting PTO | inspection passed | inspectionToPto |

Per-deal flag: `ratio = daysWaiting / avgLeg`
- **green** < 1.0× (within normal)
- **amber** 1.0–1.5× (over average)
- **red** > 1.5× (well past — chase now)

Each drill-down row shows `{daysWaiting}d / avg {avgLeg}d` with the days badge colored by band; the bucket header gains `N over average`. No `avgLeg` (too few completions) ⇒ no flag, show days only.

**Permit example (the case you raised):** a deal in Awaiting Permit Issue, submitted 38 days ago, when submit→issue averages 21 days → ratio 1.8 → **red**, "38d / avg 21d". That's the AHJ to call today. (This same per-leg average is exactly what the forecast uses, so the two stay consistent.)

Pure presentation on top of data we already ship (`daysWaiting` per deal + `averageDays.<leg>`).

## On-hold % in the conversion arrows

On-hold deals are active (not cancelled, not complete), so today they sit silently inside **pending** in each transition. Carve them out as a 4th segment.

- `ProjectFunnelStageData` gains `onHoldCount` / `onHoldAmount`, populated parallel to `cancelledCount`: a reached milestone is classified active / cancelled / **on-hold** by current stage id (On Hold = `20440344`).
- Arrow reads **converted · cancelled · on-hold · pending** (= 100%); `pending` shrinks by the on-hold share. On-hold colored like the On Hold stage (yellow); legend updated.
- Backlog consistency (mirrors the cancelled-at-gate treatment shipped in #962): on-hold deals drop out of the live backlog bars and surface as "**N on hold here**" on the row, so card-drop = live backlog + cancelled + on-hold.
- Card totals unchanged (`total = count + cancelledCount + onHoldCount`).

---

## Data sources (grounded)

| Need | Source |
|---|---|
| Ready To Build / RTB-Blocked stage IDs | `src/lib/hubspot.ts:216-217` — `22580871`, `71052436` |
| Blocked reason | `Project.rtbBlockedReason` (added in #968; `rtb_blocked_reason`) |
| Construction completions | `Project.constructionCompleteDate` (binned in `monthlyActivity.constructionsComplete`) |
| Active filtering | `buildProjectFunnelData` active scope (`isActiveDeal`) + Location/PM/Owner filters |
| Crew capacity | `src/lib/executive-shared.ts:111` `CREWS_CONFIG[loc].monthly_capacity` (canonical location keys) |
| Monthly install target (future) | `OfficeGoal` model, `metric="installs_completed"` (`prisma/schema.prisma:2694`) |
| Existing weeks-of-backlog logic | `src/lib/shop-health.ts:745-758` + `scoreBacklogWeeks` (`:134-138`) |
| Canonical locations | `src/lib/locations.ts` `CANONICAL_LOCATIONS`, `normalizeLocation` |

---

## API / response shape

Extend `ProjectFunnelResponse` (in `src/lib/project-funnel-aggregation.ts`) with one optional block, populated only for **active scope**:

```ts
export interface RtbBench {
  ready: { count: number; amount: number };          // Ready To Build
  blocked: { count: number; amount: number; topReason: string | null };
  weeklyInstallRate: number;                          // trailing 8-wk completions / 8
  weeksOfRtbCoverage: number | null;
  preconBacklogCount: number;
  preconBacklogAmount: number;
  weeksOfBacklog: number | null;
  configuredWeeklyCapacity: number;
}
// ProjectFunnelResponse.rtbBench?: RtbBench
// (per-location variant rtbBenchByLocation deferred to a follow-up for the "By location" matrix)
```

No new API route or query params — it rides the existing `/api/deals/project-funnel?scope=active` call the Active Pipeline tab already makes.

---

## UI

A compact `Capacity & Backlog` row rendered **above** the 12-stage funnel hero, only when `tab === "funnel"` (Active Pipeline) and `rtbBench` is present. Four `FunnelStatCard`/`StatCard`-style cards:

| Card | Value | Subtitle | Accent |
|---|---|---|---|
| **RTB Bench** | `ready.count` | `$ready.amount · {weeksOfRtbCoverage}w coverage` | cyan, health-tinted by coverage band |
| **Weeks of Backlog** | `weeksOfBacklog` | `{preconBacklogCount} jobs · {weeklyInstallRate}/wk pace` | health-colored (green/yellow/red) |
| **Install Pace** | `weeklyInstallRate`/wk | `vs {configuredWeeklyCapacity} capacity` | blue |
| **RTB-Blocked** | `blocked.count` | `$blocked.amount · {blocked.topReason ?? "no reason set"}` | red |

Notes:
- Cards stay in the existing compact two-rows-of-cards visual language; clicking **RTB Bench** / **RTB-Blocked** deep-links to the matching backlog (`drillDown.awaitingConstructionSchedule`) / the RTB-Blocked stage drill-down already shipped in #968.
- Hidden when `weeklyInstallRate === 0` would make weeks `null` — show "—" with a "no recent installs" tooltip rather than a misleading number.

---

## Edge cases

- **No recent completions** (`weeklyInstallRate === 0`): weeks-of-* are `null`; render "—" + tooltip. Don't divide by zero, don't show ∞.
- **Location filter with no `CREWS_CONFIG` entry** (e.g. an unmapped location): `configuredWeeklyCapacity` contribution is 0; trailing-actual pace still works, so the headline remains valid.
- **Small windows**: pace is always trailing-8-weeks regardless of the tab timeframe (it's an active-snapshot concept), matching how the Bottlenecks tab self-fetches.
- **California grouping**: funnel uses the 5 canonical locations 1:1 with `CREWS_CONFIG` keys, so no SLO+Camarillo merging needed here (unlike office-performance).

---

## Out of scope (follow-ups)

- Per-location `rtbBenchByLocation` / per-location forecast for the "By location" matrix.
- Goal pacing against `OfficeGoal` `installs_completed` (separate "are we on track for the month/$3M" metric).
- Predicting when RTB-Blocked jobs unblock (depends on blocker reason; shown as upside, not forecast).
- Refining expected-RTB dates with `forecastedInstallDate` / explicit scheduled dates where present, instead of pure median-aging.

---

## Rollout

Independent chunks — can ship as separate PRs to limit blast radius:

1. **Aggregation primitives**: rename `medianDays`→`averageDays` (`median()`→mean()); add `onHoldCount`/`onHoldAmount` to `ProjectFunnelStageData` (classify each reached milestone active / cancelled / on-hold by stage id).
2. **Conversion arrows**: on-hold segment in `transitionStats` / `ConvNumbers` / `ConversionLegend`; on-hold-at-gate on backlog rows (parallel to the cancelled-at-gate from #962).
3. **Backlog aging**: per-deal `daysWaiting` vs `averageDays[bucket]` coloring + "N over average" header.
4. **RTB bench + forecast**: `RtbBench` + `RtbForecast` in `buildProjectFunnelData` (active scope); `CapacityBacklogRow` + arrivals chart, gated on `tab === "funnel" && data.rtbBench`. Reuse `shop-health` `scoreBacklogWeeks` thresholds.
5. No migration, no new env, no new route — data/label only. **Run the FULL-project `tsc` (not filtered)** for chunks 1/4: they change shared response types, and `deal-reader.ts` builds the same `Project`/response shapes (this is the exact gap that broke the build in #968 → #969).

## Open questions

1. **Pace basis** — headline on trailing-actual (recommended) or on `CREWS_CONFIG` capacity? (Spec assumes trailing-actual, capacity as secondary.)
2. **Bench definition** — Ready To Build only (recommended), or Ready To Build + RTB-Blocked-without-blocker? The latter counts "could be ready if unblocked."
3. **Coverage bands** — confirm green ≥ 2w / yellow 1–2w / red < 1w, or set PB-specific targets.
4. **Forecast conversion haircut** — apply the historical DA-Approved → Permits-Issued attrition (recommended, avoids overpromising) or show gross projected arrivals?
5. **Forecast horizon** — 8 weeks (default) sufficient, or extend (e.g. 12) given some DA→RTB chains run longer?
