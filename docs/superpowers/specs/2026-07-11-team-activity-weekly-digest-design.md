# Team Activity: Weekly Report-Card Email Digest — Design

**Date**: 2026-07-11
**Status**: Approved (Zach, 2026-07-11)
**Builds on**: report card (#1405, merged). Reuses adapters, `buildReportCard`,
`sendEmailMessage`, and the `goals-digest` cron pattern.

## Goal

A copy-paste report card lands in zach@'s inbox every Monday 7am MT covering
the prior Mon–Sun (vs the week before, for deltas) — no dashboard visit needed.

## Unit 1: shared orchestration helper

`runTeamActivity(range, roster, opts?)` in a new
`src/lib/team-activity/run.ts`. Lifts the adapter-fan-out + PTO + metrics block
that currently lives inline in `src/app/api/admin/team-activity/route.ts` into
one function both the route and the cron call. Returns:

```ts
{ ran: {source,events,warning?}[]; skipped: {source,reason}[];
  personDays: (PersonDayMetric & {name})[]; summaries: (PersonSummary & {name})[];
  roster: {email,name,ptoWeekdays}[]; totalEvents: number }
```

`opts` = `{ only?: ActivitySource[]; reportsAdmin?: string }`. This is exactly
the shape the route already builds and what `ReportPeriod` needs (plus `range`,
which the caller supplies). The route is refactored to call it and keep its
JSON response identical (no API change). No pending PR touches this route, so
no conflict.

## Unit 2: the cron

`src/app/api/cron/team-activity-digest/route.ts`, mirroring `goals-digest`:

- `CRON_SECRET` bearer auth in-route.
- **Registered in BOTH `vercel.json` (`0 13 * * 1` = Mon 13:00 UTC = 7am MDT)
  AND `PUBLIC_API_ROUTES` in `src/middleware.ts`** — the allowlist step is the
  trap that just killed two other crons; do not skip it.
- Idempotent via `IdempotencyKey` on `(key=isoWeekKey(now), scope=
  "team-activity-digest")`, atomic-claim exactly like goals-digest (create →
  P2002 → bail if already sent/processing).
- Windows (all computed from `now`, a Monday):
  - current = prior Mon 00:00 MT → prior Sun 23:59:59 MT (the week that just
    ended). Denver-local day boundaries; construct via the same
    `${day}T..Z`-with-offset approach used elsewhere, or via a small
    `denverWeekBounds(now)` helper (pure, tested).
  - previous = the Mon–Sun before that (for deltas).
- Runs `runTeamActivity` for both windows with the DEFAULT_ROSTER and the
  reports admin (`getReportsAdminEmail()`), assembles two `ReportPeriod`s,
  calls `buildReportCard(current, previous)`.
- Emails via `sendEmailMessage`: `to: "zach@photonbrothers.com"`,
  `subject: "Team Activity — week of <Mon D>"`, `text` = the card,
  `html` = the card wrapped in `<pre style="font:13px/1.5 monospace">` (HTML
  is required by the signature; the card is plain text). On success, mark the
  idempotency key `completed`; on failure, delete the key so next week
  (or a manual retry) re-runs, and return 500 so Vercel logs it.
- If `buildReportCard` yields the empty-period line, still send (a quiet week
  is signal too).

## Error handling

- Prior-week `runTeamActivity` throwing → catch, pass `previous=null`
  (card omits deltas + adds its caveat), still send current week.
- Any source skipped/warned → already carried into the card's caveat lines.
- Idempotency claim contention (P2002) → exit 200 "already handled".

## Testing

- Pure `denverWeekBounds` + `isoWeekKey`: Monday input → correct prior Mon–Sun
  and the week-before; DST-safe (America/Denver offset via Intl).
- `runTeamActivity` returns the same shape the route previously inlined
  (light unit test with stubbed adapters, or covered by the route's existing
  behavior + a shape assertion).
- Live dry-run: a temp script invokes the cron's core (both windows, real
  adapters) and prints the email `subject` + `text`; eyeball vs a dashboard
  run for the same window; confirm no crash, deltas present, PTO notes.
- Post-deploy: manually hit the endpoint with the CRON_SECRET once, confirm
  the email arrives and the idempotency key blocks a second send.

## Out of scope

Recipients beyond zach@ (forward manually); HTML/branded template; a
configurable schedule or window; unsubscribe. All revisitable later.
