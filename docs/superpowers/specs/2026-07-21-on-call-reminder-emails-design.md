# On-Call Reminder Emails — Design

**Date:** 2026-07-21
**Status:** Approved (Zach, in-session)

## Problem

On-call shifts land on electricians' Google Calendars silently: calendar events
are created with `sendUpdates=externalOnly`, and every crew member is on the
photonbrothers.com Workspace domain, so nobody receives an invite email. A crew
member can be scheduled (e.g. a first-ever rotation week) without any
notification. Zach wants two reminder emails per rotation week: a week-ahead
heads-up and a week-of reminder.

## Decisions (settled with Zach)

- **Timing:** both emails send Monday morning. Week-ahead goes out the Monday
  one week before the shift week starts; week-of goes out the Monday the shift
  week begins. Rotation weeks run Mon→Sun.
- **Cadence:** fire-and-forget. One Vercel cron, Mondays `0 15 * * 1` (15:00 UTC
  = 8am California / 9am Denver in summer; 7am / 8am in winter). No idempotency
  tracking, no catch-up: if the run fails, that week's reminders are dropped.
  Manual re-trigger of the route re-sends (acceptable duplicate).
- **Recipients:** the on-call electrician only. `suppressConfiguredBcc: true`
  so the global `SCHEDULING_NOTIFICATION_BCC` list is NOT merged in.
- **Rollout gate:** new env var `ON_CALL_REMINDER_EMAILS_ENABLED=true` on top of
  the existing `ON_CALL_ROTATIONS_ENABLED` flag. Ships dark.

## Architecture

Three new files plus three one-line integrations:

### 1. `src/lib/on-call-reminders.ts` (pure logic, unit-tested)

- `groupWeekAssignments(rows)` — group a week's persisted `OnCallAssignment`
  rows by crew member → `{ crewMemberId, name, email, dates[] }[]`. Persisted
  rows are the source of truth, so swaps and split weeks come out right by
  construction: each person is emailed only their actual days.
- `formatDateRanges(dates)` — collapse sorted dates into human ranges
  ("Mon Nov 2 – Sun Nov 8", or "Mon Nov 2 – Wed Nov 4, Sat Nov 7" for split
  weeks).
- `reminderSubject(variant, poolName, dates)` — e.g.
  `You're on call this week — Colorado (Nov 2 – Nov 8)`.
- Reuses `mondayOf`/`addDays` from `on-call-rotation.ts` and `todayInTz` from
  `src/lib/on-call-swap.ts` (already the shared export, consumed by
  `on-call-notifications.ts`) — do NOT write another private copy.

### 2. `src/emails/OnCallReminder.tsx` (React Email template)

Props: member name, pool name, variant (`week-of` | `week-ahead`), formatted
date ranges, weekday shift window, weekend shift window, `coversSundays`,
timezone label, dashboard link (`/dashboards/on-call`, absolute via the
`baseUrl()` pattern from `on-call-notifications.ts`). House style via existing
`src/emails/_components`. When `coversSundays` is false (California) the
weekend window is labeled "Saturday" only — the email must not imply Sunday
coverage that doesn't exist.

### 3. `src/app/api/cron/on-call-reminders/route.ts`

1. `Authorization: Bearer ${CRON_SECRET}` check (same as goals-digest).
2. Gate on both env flags; when either is off, return HTTP 200 with
   `{ skipped: true }` (repo convention for dark-shipped crons, e.g.
   `powerhub-telemetry` — a 503 would show as a failing cron in Vercel every
   Monday until the flag is flipped).
3. For each active pool with `rotationUnit === "weekly"` (daily pools skipped
   with a log — none exist today):
   - `today` in pool tz → `thisMonday = mondayOf(today)`, `nextMonday = +7d`.
   - Fetch persisted rows for [thisMonday, +6] and [nextMonday, +6].
   - Send week-of emails to current-week members, week-ahead to next-week
     members via `sendEmailMessage` (dual-provider: Google Workspace → Resend).
4. Error handling: each send is individually try/caught — one failure doesn't
   abort the rest. Members with no email are skipped with a warn. A week with
   no persisted rows (published horizon exhausted) is a counted no-op, not an
   error — and is the observable signal that a republish is overdue.
5. Response JSON reports per-pool counts: `{ sent, skipped, missingEmail,
   emptyWeeks }` for log-based verification.

### Integrations

- `vercel.json`: cron entry `{ path: "/api/cron/on-call-reminders", schedule: "0 15 * * 1" }`.
- `src/middleware.ts`: add `/api/cron/on-call-reminders` to `PUBLIC_API_ROUTES`
  (CRON_SECRET validated in route) — without this the cron 401s silently.
- `.env.example`: document `ON_CALL_REMINDER_EMAILS_ENABLED`.

## Testing

Jest unit tests for the pure lib: grouping (full week, split week from a swap,
empty week), range formatting (contiguous, gaps, month boundary), subject
lines. Route-level: auth rejection and flag-off short-circuit.

## Rollout

1. PR → review → merge (deploys via GitHub per repo convention).
2. Set `ON_CALL_REMINDER_EMAILS_ENABLED=true` in Vercel prod env (printf, not
   echo) and local `.env`.
3. Verify the first Monday run (July 27) via Vercel logs, cross-checking
   recipients against the published schedule on the on-call dashboard (swaps
   between now and then can change who's on).
