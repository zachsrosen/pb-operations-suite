# Bottleneck Monitor — Design

**Date:** 2026-07-07
**Status:** Approved design (brainstormed with Zach)
**Origin:** Business Process – Status meeting (7/7): "Bot-Driven Process Monitoring" — use the Tech Ops bot to visualize and track system bottlenecks for accountability. Matt Raichart's requirement: translate the data into actionable visualizations that help the team prioritize. Tracked as Freshservice #918.

## Problem

Deals stall inside pipeline stages (design, permitting, interconnection, construction, inspection, PTO, PE milestones) and nobody is notified until someone happens to look. There is no shared definition of "stuck," no per-team view of what is stuck in *their* queue, and no proactive push. Leadership wants accountability; the team wants a prioritized list, not raw counts.

## Goals

- Compute three bottleneck signals per pipeline stage: **age** (per-deal dwell time past threshold), **volume** (deals in stage vs. historical norm), **flow** (entered vs. exited per week).
- Present them on a dashboard page that answers "which deals need action today, and whose are they."
- Push a proactive digest through the Tech Ops bot (Google Chat DM) — change-driven on weekdays, full digest with flow trends every Monday.
- Support **scoped digests**: the same engine renders an `all` view, a per-team view (stage→team mapping), or a per-person view (deal owner), so distribution can widen without rework.

## Non-goals (v1)

- No new HubSpot data collection: no property-history reads, no transition-log table. Existing date-stamp properties are the source of truth.
- No Chat visibility expansion. The bot DMs Zach only; team/person delivery targets are configured but unsent until the existing visibility restriction (add-on visible to zach@ only) is lifted separately.
- No D&R, roofing, or service-ticket coverage. Service already has its own priority queue.
- No write-backs to HubSpot (no tasks, no property stamps).

## Architecture

```
Deal (existing Prisma mirror: statuses, stage date stamps, owner, PE flag)
        │
   src/lib/bottlenecks.ts  ── engine: dwell, volume, flow, flags
        │                       thresholds from SystemConfig
        ├── /api/bottlenecks/summary ──> /dashboards/bottlenecks page
        └── /api/cron/bottleneck-digest ──> digest builder ──> Tech Ops bot
                                             (change detection vs. last snapshot)
```

All reads come from the existing Prisma `Deal` mirror (the table `deal-property-map.ts` / `deal-sync.ts` maintain, kept fresh by the deal-sync webhook — not the thin legacy `HubSpotProjectCache`). The engine never calls the HubSpot API, so it adds zero rate-limit pressure.

**One prerequisite for the PE stages:** `pe_m1_status`, `pe_m2_status`, and the M1/M2 remittance dates are not currently synced into `Deal`. They are added to `DEAL_SYNC_PROPERTIES` and read from `Deal.rawProperties` (JSON) — a map change only, no new columns, no migration. PE stages report "age unknown" until a full deal re-sync backfills `rawProperties`; the other six stages work day one.

## 1. Engine (`src/lib/bottlenecks.ts`)

### Stage registry

A `StageDefinition[]` constant defines each tracked stage:

```ts
interface StageDefinition {
  key: string;                 // "permitting"
  label: string;               // "Permitting"
  statusColumn: string;        // Deal column holding the stage status
  activeValues: string[];      // status values meaning "deal is in this stage"
  entryDateColumn: string;     // Deal column marking stage entry
  entryFallbackColumns: string[]; // prior-stage stamps, tried in order
  exitDateColumn: string;      // stamp marking stage exit (for flow)
  team: string;                // segmentation key, e.g. "design", "pi", "ops"
}
```

Tracked stages and their markers (`Deal` columns per `deal-property-map.ts`; PE fields via `rawProperties` per the prerequisite above):

| Stage | Active status source | Entry stamp | Exit stamp |
|---|---|---|---|
| Design | `designStatus` | `designStartDate` (fallback `siteSurveyCompletionDate`) | `designCompletionDate` |
| Permitting | `permittingStatus` — active values per `pi-statuses.ts` | `permitSubmitDate` (fallback `designCompletionDate`) | `permitIssueDate` |
| Interconnection | `icStatus` — active values per `pi-statuses.ts` | `icSubmitDate` (fallback `designCompletionDate`) | `icApprovalDate` |
| Construction | `installStatus` | `installScheduleDate` (fallbacks `rtbDate`, `permitIssueDate`) | `constructionCompleteDate` |
| Inspection | `finalInspectionStatus` | `constructionCompleteDate` | `inspectionPassDate` |
| PTO | `ptoStatus` | `ptoStartDate` (fallback `inspectionPassDate`) | `ptoCompletionDate` |
| PE M1 | `pe_m1_status` (deals with `isParticipateEnergy` only) | `inspectionPassDate` | `pe_m1_remittance_date` |
| PE M2 | `pe_m2_status` (deals with `isParticipateEnergy` only) | `ptoCompletionDate` | `pe_m2_remittance_date` |

Active-value sets reuse the existing constants (`pi-statuses.ts`, PE status enums) rather than redefining them. Construction entry prefers `installScheduleDate` over `permitIssueDate` so RTB/scheduling wait isn't billed to construction dwell.

### Signals

- **Age**: `dwellDays = today − entryDate` for every deal currently in an active status. Deals whose entry stamp (and all fallbacks) are null land in an **"age unknown"** bucket — surfaced explicitly, never silently dropped. Unknown-age deals are a data-hygiene signal in their own right.
- **Volume**: current count of deals per stage, shown against the trailing 90-day median count. Historical counts are reconstructed from stamps (a deal was in-stage on day D iff `entryDate ≤ D < exitDate`) — no snapshot table needed. Unknown-entry deals are excluded from the reconstruction (and the dashboard notes this), so the norm can undercount where stamp hygiene is poor.
- **Flow**: per ISO week, `entered = count(entryDate in week)` vs. `exited = count(exitDate in week)`, trailing 8 weeks.

### Flagging

A deal is flagged when `dwellDays > thresholdDays` for its stage. The engine returns, per stage: flagged deals (sorted by dwell, with deal name, PROJ#, owner, location, dwell, threshold), total in stage, unknown-age count, and flow series.

## 2. Thresholds

Stored in a `SystemConfig` JSON row `bottleneck_thresholds`:

```json
{ "permitting": { "medianDays": 18, "p90Days": 41, "thresholdDays": 41, "source": "derived" }, ... }
```

- The weekly cron pass recomputes `medianDays`/`p90Days` from completed transitions in the cache (deals with both entry and exit stamps, trailing 12 months).
- `thresholdDays` defaults to the derived p90. If `source` is `"manual"`, recomputation updates the stats but never overwrites the threshold.
- The dashboard displays the threshold and its source next to every flag, so the rule is never a black box. Editing (flipping a stage to manual) is done via the existing admin SystemConfig tooling in v1; a dedicated edit UI is a follow-up.

## 3. Segmentation

- Each `StageDefinition` carries a `team` key: `design`, `pi` (permitting + interconnection), `ops` (construction/inspection/PTO), `precon` (PE M1/M2).
- The digest builder takes a scope: `all` | `team:<key>` | `person:<hubspotOwnerId>`. Team scope filters stages by team key; person scope filters flagged deals by deal owner across all stages.
- v1 sends only `all` → Zach's existing bot DM space. Scoped delivery targets (space or email per team/person) are a config shape reserved in the same SystemConfig row but unused until bot visibility widens.

## 4. Dashboard — `/dashboards/bottlenecks`

New page in the Operations suite using `DashboardShell` (accent: red), backed by `/api/bottlenecks/summary`:

- **Stage tiles** (MetricCard row): flagged count, total in stage, median dwell vs. threshold, unknown-age count.
- **Stuck-deal table**: grouped by stage, sorted by dwell descending — deal, PROJ#, owner, location, days in stage, threshold. Owner names visible; that is the accountability mechanism.
- **Flow chart**: entered-vs-exited per week per stage (reuses `MonthlyBarChart` patterns), trailing 8 weeks.
- Filters: location (`MultiSelectFilter`), team, "show unknown-age".

Route allowlist: `/dashboards/bottlenecks` and `/api/bottlenecks/*` added to `allowedRoutes` for **every role granted `/suites/operations` in `roles.ts`** (currently including ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS, and any executive roles with Operations access) — a suite card without a matching route allowlist silently 403s. A suite card is added to the Operations suite landing page.

## 5. Bot digest

Extends the existing proactive module (`tech-ops-bot-proactive.ts`), which already owns the Zach DM space.

**Relationship to the existing daily digest:** the proactive module's current digest (`/api/cron/tech-ops-bot-digest`) already opens with a "Stuck deals" section driven by hardcoded `STUCK_THRESHOLDS`. The bottleneck digest **replaces that section**: the hardcoded thresholds are retired, the stuck-deals content moves to the bottleneck engine (config-driven thresholds), and the remaining sections of the daily digest are unchanged. Zach gets one morning DM, not two overlapping ones.

- **Cadence**: weekday mornings via a new `/api/cron/bottleneck-digest` endpoint (Vercel cron, same auth pattern as existing crons). Vercel crons are UTC-fixed, so the send time drifts an hour across DST (8am MDT / 7am MST) — accepted.
- **Change suppression** (Tue–Fri): the digest sends only if, versus the last-sent snapshot, a deal newly crossed its threshold, a flagged deal resolved, or a stage's flagged count grew. Otherwise the run exits silently.
- **Monday**: always sends the full digest including flow trends ("permitting: 22 in, 9 out over 2 weeks"), so Zach walks into the weekly meetings current.
- **Format**: plain text (Google Chat mangles markdown tables) — headline counts per stage, top 3 stuck deals overall with owner + days, "N new / M resolved since yesterday", link to the dashboard.
- **Snapshot**: last-sent state (flagged deal IDs per stage + counts) stored in a `SystemConfig` row `bottleneck_last_digest`; compared at the start of each run.

## 6. Storage & operational notes

- **No schema migration.** Two `SystemConfig` rows (`bottleneck_thresholds`, `bottleneck_last_digest`), an addition to `DEAL_SYNC_PROPERTIES` (PE fields into `Deal.rawProperties`), and code only.
- Threshold recomputation piggybacks on the Monday digest run (one cron endpoint, branch on weekday).
- Known data-quality caveat: some stamps are unreliably populated (e.g., PE ready-to-submit dates). The unknown-age bucket absorbs these visibly; digest counts may undercount until stamp hygiene improves. Accepted for v1.

## Testing

- Unit tests for the engine: dwell computation with entry fallbacks, unknown-age bucketing, threshold flagging, derived-threshold math (median/p90), manual-override preservation, flow bucketing by week, volume reconstruction from stamps — all against fixture `Deal` rows.
- Digest builder tests: change-detection matrix (new flag / resolved flag / count growth / no change), Monday-vs-weekday behavior, scope filtering (`all`, `team`, `person`), plain-text rendering.
- Route tests: summary API shape and role gating.

## Rollout

1. Ship engine + dashboard first (read-only, immediately demoable for the Monday update).
2. Enable the cron digest to Zach's DM after a manual run-through of one real digest.
3. Later, separately: widen bot visibility (Google Group or Marketplace publish), then attach team/person delivery targets that the config shape already supports.
