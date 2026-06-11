# PE Analytics Dashboard — Design

**Date:** 2026-06-11
**Status:** Approved (Zach, 2026-06-11)

## Purpose

A single dashboard page that answers "how is the Participate Energy program performing?" — payments received, money in flight, how long PE takes, what gets rejected, and where deals are stuck. Replaces ad-hoc scripts (`_pe-payments-by-week.ts`, `_pe-approval-to-payment-timing.ts`) with a permanent page.

## Audience & Access

Accounting suite. Visible to ADMIN, OWNER, ACCOUNTING, SALES_MANAGER — same roles as the other accounting pages. Card added to the Accounting suite landing page.

Routes added to `allowedRoutes` in `src/lib/roles.ts` for those roles:
- `/dashboards/pe-analytics` (page)
- `/api/accounting/pe-analytics` (data)

## Architecture

```
/dashboards/pe-analytics (client page, DashboardShell, emerald)
  └─ React Query → GET /api/accounting/pe-analytics
       ├─ HubSpot: search PE deals (pipeline 6900017, tag "Participate Energy")
       ├─ HubSpot: batch read w/ propertiesWithHistory (pe_m1_status, pe_m2_status)
       ├─ Prisma: PeDocumentReview (current doc statuses + notes)
       ├─ Prisma: PeDocChangeLog (rejection events over time)
       └─ lib/cache.ts in-memory cache, 15-min TTL, key "pe:analytics"
```

One API route returns all report data in one JSON payload. The expensive part is the property-history batch reads (~470 deals / 50 per batch ≈ 10 calls); one pass feeds reports 1–3 and 5. Rate-limit retry per existing conventions.

## Reports

### 1. Payments per week
- Source: earliest history entry where `pe_m1_status`/`pe_m2_status` = "Paid"; amount from `pe_payment_ic` (M1) / `pe_payment_pc` (M2).
- Weekly (Mon-start, UTC) stacked totals: M1 $, M2 $, counts.
- UI: stacked bar chart + summary stats.
- Caveat shown in UI: dates are HubSpot status-change dates, not bank-deposit dates.

### 2. Expected revenue pipeline (money in flight)
- Source: current `pe_m1_status`/`pe_m2_status` + amounts.
- Status groups, in order: Waiting on Information / Ready for Onboarding cluster → Ready to Submit → Submitted/Resubmitted → Approved (unpaid) → Paid (lifetime).
- Per group: deal-milestone count + summed $ (M1/M2 split).
- UI: horizontal flow of MetricCards.

### 3. Approval & payment timing
- Source: same property history. Per milestone: first submitted → first approved (days), approved → paid (days), rejection count before approval.
- Aggregates: median + p75 for each gap, overall and per milestone; monthly trend of median submission→approval.
- UI: stat cards + small table by month.

### 4. Rejection analysis
- Source: `PeDocumentReview` (current REJECTED / ACTION_REQUIRED rows incl. notes) + `PeDocChangeLog` (historical transitions into rejection states).
- Per doc type: total rejection events, currently-rejected count, rejection rate (rejected events / deals with that doc tracked).
- Recent rejection notes list (doc, deal, PE note, date), latest 20.
- UI: ranked bar list + notes feed.

### 5. Milestone funnel
- Source: current statuses. Counts of deals by M1 status and by M2 status (two funnels), with per-location split.
- UI: two compact funnels with location filter chips.

## Page layout

1. Header StatCards: Total paid (lifetime $), In flight $ (submitted+approved unpaid), Median days approval→payment, Rejection rate.
2. Payments per week (chart).
3. Expected revenue pipeline (cards).
4. Timing (cards + monthly table).
5. Rejection analysis (ranked list + notes).
6. Milestone funnel (two columns).

Conventions: DashboardShell (emerald), theme tokens only, MetricCard/StatCard/MiniStat reuse, React Query with `queryKeys` entry, no new dependencies. Chart rendered with a lightweight inline SVG (same approach as MonthlyBarChart) rather than adding a chart lib.

## Error handling

- HubSpot failures: route returns 502 with message; page shows error state with retry.
- Empty DB tables (PeDocChangeLog empty): rejection-over-time section degrades to current-status-only view.
- Cache: stale-while-error not required; 15-min TTL acceptable for analytics.

## Testing

- `npm run lint` + `npm run build` clean.
- Unit test for week-bucketing (UTC Monday) and status-grouping helpers.
- Manual preview verification with live data (dev login).

## Out of scope

- Writing anything to HubSpot.
- Per-deal drill-down pages (links go to HubSpot/PE portal instead).
- Persisting weekly snapshots to DB (property history is the source of truth; revisit if HubSpot history retention becomes a problem).
