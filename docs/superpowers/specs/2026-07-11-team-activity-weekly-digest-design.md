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
which the caller supplies). The route is refactored to call it and keep its JSON response identical (no
API change). PTO (`googlePtoAdapter`) runs ALWAYS inside the helper, ungated by
`opts.only` — exactly as the route does today — or PTO-day exclusion silently
breaks when `only` is passed. No pending PR touches this route, so no conflict.

## Unit 2: the cron

`src/app/api/cron/team-activity-digest/route.ts`, mirroring `goals-digest`:

- `CRON_SECRET` bearer auth in-route.
- **Registered in BOTH `vercel.json` AND `PUBLIC_API_ROUTES` in
  `src/middleware.ts`** — the allowlist step is the trap that just killed two
  other crons; do not skip it. Schedule `0 13 * * 1,2` (Mon + Tue 13:00 UTC).
  Tue is a free retry day; idempotency prevents a double-send once Monday
  succeeds. Note: 13:00 UTC = 7am MDT in summer but 6am MST in winter (fixed
  UTC drifts); acceptable for an internal single-inbox digest.
- `export const maxDuration = 300` — the multi-source fan-out runs TWICE
  (current + previous windows), well over the 60s default.
- Idempotent via `IdempotencyKey` on `(key=isoWeekKey(now), scope=
  "team-activity-digest")`, atomic-claim exactly like goals-digest (create →
  P2002 → bail if already sent/processing).
- Windows via a new pure `denverWeekBounds(now)` in
  `src/lib/team-activity/week.ts` (NOT the route's UTC-day approach — that is
  not Denver-local). Returns current = prior Mon 00:00 MT → prior Sun 23:59:59
  MT and previous = the Mon–Sun before it. Compute the America/Denver UTC
  offset PER boundary date via `Intl` (a DST transition can fall on the window
  edge, so start and end need independent offsets). `isoWeekKey` also moves
  here (hoisted from goals-digest's local copy) so both are unit-testable.
- Runs `runTeamActivity` for both windows with the DEFAULT_ROSTER and the
  reports admin (`getReportsAdminEmail()`), assembles two `ReportPeriod`s,
  calls `buildReportCard(current, previous)`.
- Emails via `sendEmailMessage`: `to: "zach@photonbrothers.com"`,
  `subject: "Team Activity: week of <Mon D>"` (no em dash; matches the card
  header style), `text` = the card, `html` = the card wrapped in
  `<pre style="font:13px/1.5 monospace">`, and the two REQUIRED debug fields
  (`debugFallbackTitle`, `debugFallbackBody`).
- **PRIVACY — suppress the configured BCC.** `SCHEDULING_NOTIFICATION_BCC` IS
  set in prod and `sendEmailMessage` merges it into EVERY send. This digest is
  per-person productivity data scoped to zach@ only, so it must not go to that
  list. Add an optional `suppressConfiguredBcc?: boolean` param to
  `sendEmailMessage` (additive, backward-compatible: default false keeps
  current behavior for all existing callers) and set it true here.
- On success mark the idempotency key `completed`; on failure **delete** the
  key (deliberate deviation from goals-digest, which marks `failed` and blocks
  same-week retries) so the Tuesday re-fire or a manual re-hit can retry, and
  return 500 so Vercel logs it.
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
