# Weekly Compliance Email — Design

**Date:** 2026-02-26
**Status:** Approved

## Summary

Extend the existing weekly compliance email to include dual-period comparison (week-over-week + 30-day baseline) and per-user growth tracking with outlier threshold. Add a `POST /api/compliance/email` route for triggering test sends.

## Data Layer

### Extended `ComplianceDigest` Interface

Add two new fields:

```typescript
baseline30Day: {
  completedJobs: number;
  onTimePercent: number;
  oowUsagePercent: number;
  stuckJobs: number;
};

userGrowth: {
  improvers: UserGrowthEntry[];
  decliners: UserGrowthEntry[];
  threshold: number;
};
```

Where `UserGrowthEntry`:
```typescript
{
  name: string;
  team: string;
  currentScore: number;
  currentGrade: string;
  currentOnTimePercent: number;
  priorScore: number;
  priorGrade: string;
  priorOnTimePercent: number;
  scoreDelta: number;
}
```

### `getComplianceDigest()` Changes

- Fetch 3 windows in parallel: 7-day current, 7-day prior, 30-day
- Compute per-user metrics for current and prior 7-day windows
- Match users across windows by UID, calculate score/grade/on-time deltas
- Filter: `|scoreDelta| >= threshold` AND `minJobs >= 3` in both periods
- Sort improvers descending by delta, decliners ascending, cap 10 each
- 30-day window only needs summary-level aggregates (no per-user breakdown needed)

## Email Template Changes

### Metric Cards — Dual Trends

Each of the 4 metric cards gets a second comparison line:
```
On-Time Completion: 81.2%
▲ +9.2 vs last week
↑ +5.1 vs 30-day avg
```
- Week-over-week: green/red arrow (existing style)
- 30-day baseline: smaller secondary line, muted color

### New "User Growth" Section

Placed after callouts, before the dashboard CTA button.

Two sub-tables:
- **Most Improved**: Name, Team, Grade (prior → current), On-Time % (prior → current), Score Delta
- **Biggest Declines**: Same shape, negative deltas in red

Rules:
- Only users with `|scoreDelta| >= 5` and `minJobs >= 3` in both periods
- Cap 10 rows each, sorted by magnitude
- "No significant changes this period" if empty

Plain text version gets equivalent sections.

## API Route

**`POST /api/compliance/email`**

```typescript
// Request body
{
  to: string;          // required, recipient email
  days?: number;       // optional, default 7
  threshold?: number;  // optional, score delta threshold, default 5
}

// Response
{
  success: boolean;
  error?: string;
  period: { from, to, days };
  summary: { ... };
}
```

Auth: next-auth session, ADMIN or OWNER role. Returns 401/403 otherwise.

## Files Modified

1. `src/lib/compliance-digest.ts` — extend interface + fetch 3 windows + user growth
2. `src/lib/email.ts` — extend HTML/text templates with 30-day baseline + user growth section
3. `src/app/api/compliance/email/route.ts` — new API route (POST)

## Test Plan

- Send test email to `zach@photonbrothers.com` via the API route
- Verify metric cards show dual trends
- Verify user growth section appears with real data
- Verify auth gate works (401 without session)
