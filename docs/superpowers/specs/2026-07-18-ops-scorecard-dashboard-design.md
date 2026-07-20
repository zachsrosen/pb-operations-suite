# Ops Scorecard Dashboard — Design Spec

**Date:** 2026-07-18
**Route:** `/dashboards/ops-scorecard`
**Requested by:** Matt Raichart (via Zach) — a living version of the Operations Scorecard artifact he can refer to from time to time.
**Reference implementation:** the published artifact (claude.ai/code/artifact/7c22c290-06cb-41ba-9dc6-7c9fd96f1fc6), built and challenge-tested with Zach on 7/17–7/18. Every metric definition below was ratified in that session.

## Purpose

One self-updating page answering four standing questions:
1. Projected run rate per office (net sales) and CC delivery capacity ("how much CC can we hit").
2. Month-over-month operational efficiency.
3. The full funnel: leads → appointments → sales → DAs → CCs → inspections → PTO.
4. Quarter-over-quarter and year-over-year trends.

## Data source

Local **Deal mirror** (`prisma.deal`, pipeline=PROJECT) via the same `dealToProject` mapping used by `/api/projects` — NOT live HubSpot search (rate limits; the mirror already carries every field needed). Leads (Sales Pipeline deal creates) come from the Deal mirror if SALES pipeline is mirrored, else phase 2. Appointments (meetings) are **phase 2** — requires a meetings sync or live HubSpot call; do not block phase 1.

## Ratified metric conventions (do not deviate without Zach)

- **Gross sales** = all Project-pipeline deals by `closedate`, incl. later cancelled. Denominator for cancellation rates.
- **Net** = gross minus deals *currently* in Cancelled (68229433), Project Rejected – Needs Review (20461935), On-Hold (20440344). Matches Revenue Breakdowns dashboard exactly (verified: 2026 net 431/$14.8M). Net is a now-snapshot; label it as such.
- **Cancellation cohort** = sold in-year (`closedate`) AND cancelled same year (`cancellation_date`). Show BOTH same-age rate and eventual rate; 2024's same-age rate is understated (cancels processed late that year — 16 of 47 stamped in 2025).
- **Time metrics exclude Cancelled-stage deals.** Spans <0 or >400 days dropped. Deals missing either date excluded (audited: true data gaps ≈0% DA, 2–3% permit, ~8–10% survey-schedule; the rest is attrition/in-flight).
- **Monthly/quarterly turnarounds: medians**, bucketed by when the step *completed*. **By-office table: means** (1 decimal), sold Jan–mid-July cohorts, with the tail-sensitivity note. Show same-day DA share (sent==approved calendar day) as its own stat, framed positively.
- **Pueblo = Colorado Springs** (rename mid-rollout; Sales Pipeline says Pueblo).
- **Offices:** Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo (+CO/CA/Company rollups). Camarillo opened 2025.
- **CC capacity model:** backlog = active-stage deals (Survey→Construction) with no `construction_complete_date`; conversion = share of sold $ reaching CC from the last fully-baked cohort (sold Jan–Sep prior year; 2025 cohort: 81% of $, median 84d); burn = trailing-3-month CC $/mo; sustain sales = burn ÷ conversion.
- **Run rate:** two paces side by side — YTD annualized and trailing-3-month annualized — never a single number.
- Throughput stages are independent volume measures (milestone reached in window), not one cohort flowing; say so on the page.

## Page sections (mirror the artifact, in order)

1. Hero: projected FY CC revenue (range) + sustain-sales number vs actual pace.
2. Engine cells: backlog $ / conversion % + lag / burn $/mo.
3. CC by month (bars, gross) + DA by month (bars, net) + backlog-drain note.
4. By-office: fuel, conversion, CC pace, cover months, projected CC, sustain vs selling.
5. Net sales run rate by office (2 prior FY actuals, YTD, both paces).
6. Throughput by office: sales/DAs/CCs, counts + revenue, 3 years.
7. Cancellations by location: count/sold · $ rate, 3 years, same-age + eventual note, 2026 $ lost.
8. Funnel: H1 YoY (3 yrs), 2026 monthly, H2 actuals + H2 projection (model outputs, labeled).
9. Efficiency: 2026 monthly medians, quarterly medians (10 quarters), turnarounds by office (6 legs incl. survey→DA-sent and sale→permit-issued), same-day DA stat.
10. Method footnote (verbatim conventions from the artifact footer).

## Architecture

- **API:** `GET /api/ops-scorecard` — one endpoint, server-computed JSON of every section. `appCache` TTL 30 min (`CACHE_KEYS.OPS_SCORECARD`). No client-side computation beyond formatting.
- **Middleware:** add route to `allowedRoutes` for ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER (memory: new API routes 403 silently without allowlist). Page + API both.
- **Page:** `DashboardShell`, accentColor orange, `useProjectData({endpoint:"/api/ops-scorecard"})`, calm-UI conventions (stable ordering, keepPreviousData).
- **Suite cards:** Operations + Executive suites (suite card implies route allowlist per role — update both).
- **Tests:** unit-test the pure computation module (`src/lib/ops-scorecard.ts`) with fixture deals: net trio exclusion, cohort windows, median/mean legs, Pueblo merge, span clipping.

## Build order

1. `src/lib/ops-scorecard.ts` — pure functions over `Project[]` (computations + types). Unit tests.
2. `/api/ops-scorecard` route + cache + allowlist entries.
3. Page UI (sections 1–10) reusing StatCard/MonthlyBarChart/MultiSelectFilter patterns.
4. Suite cards + roles. Preflight, PR.
5. Phase 2: appointments (meetings sync), leads if SALES pipeline unmirrored, goal-input overlay.

## Non-goals (phase 1)

Appointments/leads if data source absent; per-rep breakdowns; editable goals; PDF export.
