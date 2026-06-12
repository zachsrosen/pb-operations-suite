# PE Analytics Dashboard — Design

**Date:** 2026-06-11
**Status:** Approved (Zach, 2026-06-11)

## Purpose

A single dashboard page that answers "how is the Participate Energy program performing?" — payments received, money in flight, how long PE takes, what gets rejected, and where deals are stuck. Replaces ad-hoc scripts (`_pe-payments-by-week.ts`, `_pe-approval-to-payment-timing.ts`) with a permanent page.

## Audience & Access

Accounting suite. Visible to ADMIN, OWNER, ACCOUNTING. Card added to the Accounting suite landing page. (SALES_MANAGER dropped: it has no accounting routes today, so it can't reach the suite page; widen later if wanted.)

Role allowlist changes in `src/lib/roles.ts`:
- ADMIN / OWNER / EXECUTIVE use `allowedRoutes: ["*"]` — no edits needed.
- ACCOUNTING: add `/dashboards/pe-analytics`. Its existing `/api/accounting` prefix entry already covers the API route (middleware matches prefixes).

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

Route specifics:
- `export const maxDuration = 120` (vercel.json glob default is 60s; heavy routes override in-file per repo convention).
- Cache key registered in `CACHE_KEYS` in `src/lib/cache.ts`; use `appCache.getOrFetch(key, fetcher, false, { ttl: 15 * 60 * 1000 })` — pass only `ttl`, no stale-while-error semantics expected.
- React Query: add `peAnalytics` entry to `src/lib/query-keys.ts`.
- Payment amounts: `pe_payment_ic`/`pe_payment_pc` are opportunistically synced and may be null on deals never viewed in pe-deals. Fallback: recompute from `amount` via the lease-factor logic in `src/lib/pricing-calculator.ts` (same as the pe-deals route).

## Reports

### 1. Payments per week
- Source: earliest history entry where `pe_m1_status`/`pe_m2_status` = "Paid"; amount from `pe_payment_ic` (M1) / `pe_payment_pc` (M2).
- Weekly (Mon-start, UTC) stacked totals: M1 $, M2 $, counts.
- UI: stacked bar chart + summary stats.
- Caveat shown in UI: dates are HubSpot status-change dates, not bank-deposit dates.

### 2. Expected revenue pipeline (money in flight)
- Source: current `pe_m1_status`/`pe_m2_status` + amounts.
- Complete status → group mapping (every `VALID_M1M2_VALUES` entry assigned):
  | Group | Statuses |
  |---|---|
  | Onboarding | Waiting on Information, Ready for Onboarding, Onboarding Submitted, Onboarding Rejected, Onboarding Ready to Resubmit, Onboarding Resubmitted |
  | Ready to Submit | Ready to Submit |
  | In Review | Submitted, Resubmitted |
  | Rejected — pending fix | Rejected, Ready to Resubmit |
  | Approved (unpaid) | Approved |
  | Paid (lifetime) | Paid |
  Unknown/other statuses → counted in an "Other" bucket so totals always reconcile.
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
