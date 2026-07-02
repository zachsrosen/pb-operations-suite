# Team Activity Report — Design

**Date:** 2026-07-02
**Author:** Zach Rosen (with Claude)
**Status:** Approved design, pre-implementation

## Problem

We need a repeatable way to measure how much each Ops team member is actually
working, across every system they touch — not a one-off analysis from manual
exports. A prior session (May 2026) reconstructed this by hand from HubSpot
audit-log exports + PB Tech Ops + Zuper + Google Workspace exports and reached a
clear conclusion (everyone works full days; people who looked "light" in HubSpot
just do their work in Google). That analysis lived only in temp scripts that were
deleted. This turns it into a durable, re-runnable tool.

## Goal

A single on-demand script that produces a combined per-employee activity report
over a date range, pulling automatically from every source we can, and degrading
gracefully for sources that need a permission grant not yet in place.

Non-goals for v1 (YAGNI): in-app dashboard page, historical DB persistence,
Aircall/Google backfill cron jobs. Script first; promote to a page later if
wanted.

## Data sources

| Source | Access | Auto today? | Signal quality |
|---|---|---|---|
| PB Tech Ops (`ActivityLog`) | Our Neon DB | Yes | High — every app action, per user, timestamped |
| Aircall (`AircallCallCache`) | Our Neon DB | Yes | High — **real talk-minutes**, not a click proxy |
| Zuper (`ZuperJobCache`) | Our Neon DB | Yes | Low for precon (schedule/complete dates only, no click stream) |
| HubSpot audit + login | `account-info/v3/activity/*` REST | **After scope** `account-info.security.read` on the private app | High — login/logout span + audit events |
| Google Workspace activity | Admin SDK Reports API | **After scope** `admin.reports.audit.readonly` on domain-wide delegation | High — full cross-service activity span (Gmail/Drive/Docs/Calendar) |

Confirmed 2026-07-02: the HubSpot login/audit endpoints return HTTP 403 with
`requiredGranularScopes: ["account-info.security.read"]` — the API works, the
token just lacks the scope. Google Reports scope is not in the service account's
delegated scope set (we have gmail.readonly, calendar.events, chat.bot,
spreadsheets, directory.user.readonly).

**Degrade rule:** each adapter self-detects capability. DB adapters always run.
HubSpot/Google adapters attempt their call; on a scope/permission error they emit
a one-line `SKIPPED — needs scope X` warning and contribute no events. No crash,
no partial-garbage. When the scopes are granted later, the same code starts
returning data with zero changes.

## Architecture — 3-layer pipeline

Each layer is independently testable with a well-defined interface.

### 1. Source adapters
One module per system. Common output type:

```ts
interface ActivityEvent {
  email: string;        // normalized lowercase photonbrothers.com address
  timestamp: Date;
  source: "pbops" | "aircall" | "zuper" | "hubspot" | "google";
  objectKey?: string;   // e.g. "deal:123" — for interaction dedup; omit if N/A
  kind?: string;        // e.g. "task_update", "call", "login" — for per-source breakdown
}
```

Aircall additionally yields talk-time, carried on a parallel channel keyed by
(email, day) rather than shoehorned into `ActivityEvent`, because talk-minutes are
a duration, not a point event:

```ts
interface TalkTimeRecord { email: string; day: string; talkSec: number; calls: number; }
```

Adapter contract: `collect(range, roster): Promise<{ events: ActivityEvent[]; talk?: TalkTimeRecord[]; skipped?: string }>`.

- **pbops** — `prisma.activityLog.findMany` filtered by `createdAt` range and
  `userEmail IN roster`. `objectKey = entityType:entityId`. `kind = type`.
  `ActivityLog.userEmail` is nullable; rows with a null `userEmail` are resolved
  via the `userId` → `User.email` relation when possible, and dropped if still
  unresolved. All emails normalized lowercase before roster matching.
- **aircall** — `prisma.aircallCallCache.findMany` by `startedAt` range. Real
  columns: user id is `AircallCallCache.userAircallId` (string), email is
  `userEmail` (nullable). When `userEmail` is null, resolve via
  `AircallUserCache.aircallUserId (PK) → email`. One event per call at
  `startedAt`; talk-time summed per (email, Denver-local day) from `talkTimeSec`.
- **zuper** — `prisma.zuperJobCache` rows whose `assignedUsers` JSON
  (`[{ user_uid, user_name }]`, no email) include a roster member. Because the
  roster keys on email, matching is by `zuperUserId` when present on the roster
  entry, else fuzzy `user_name` match. Emit an event at `completedDate` (and
  `scheduledStart` if in range). Marked explicitly low-signal in output; name
  mismatches are acceptable given that caveat.
- **hubspot** — GET `account-info/v3/activity/login` (+ audit-logs) paginated over
  range. These APIs key on the HubSpot **actor/user id**, not email, so the
  adapter maps `roster.hubspotOwnerId ↔ actor id` (falling back to matching the
  actor email field the API returns, lowercased). Login/logout → span-defining
  events; audit entries → interaction events with `objectKey` from the entry's
  object.
- **google** — Admin SDK `activities.list` (application=login and, if available,
  drive/token) per roster user via service-account impersonation (keyed by
  `roster.email`); each activity → one event. First/last of day define the Google
  span.

### Identity resolution (per source)

The roster keys on `email`. Each adapter joins to its system on a different key,
so the resolution is stated explicitly to remove implementer guesswork:

| Source | Join key | Fallback |
|---|---|---|
| pbops | `ActivityLog.userEmail` (lowercased) | `userId → User.email`, else drop |
| aircall | `AircallCallCache.userEmail` (lowercased) | `userAircallId → AircallUserCache.aircallUserId → email` |
| zuper | roster `zuperUserId` → `assignedUsers[].user_uid` | fuzzy `user_name`, else skip row |
| hubspot | roster `hubspotOwnerId` → API actor id | API actor email (lowercased) |
| google | roster `email` → impersonation subject | n/a (email is the key) |

Roster entries gain optional `zuperUserId?` alongside `aircallId?` and
`hubspotOwnerId?`. All are optional — a source simply skips a person it can't
resolve, noted in the run header.

### 2. Metrics engine
Pure functions over `ActivityEvent[]` + `TalkTimeRecord[]`, grouped by
`(email, localDay)` in America/Denver (Layla's FL tz is acknowledged as a known
skew, same as last time). Day bucketing is **America/Denver local day everywhere** — both the metrics
engine and each adapter's talk-time summation — so late-night calls/events land
in the correct day rather than splitting on UTC midnight.

Per person-day:

- `firstEvent`, `lastEvent`, `spanHours = last − first`
- `activeHours` — sum of consecutive-event gaps, **each gap capped at 60 min**
- `interactions` — count of events after **dedup by `objectKey` within a 10-min
  window** (events without an objectKey are never deduped)
- `eventCount` — raw
- `perSource` — event counts split by source
- `talkMinutes`, `callCount` — from TalkTimeRecord
- `googleSpanHours` — span computed from google-source events only, when present

Per person (rollup over the range):
- `activeDays`, `weekdayActiveDays`
- `avgActiveHoursPerActiveDay`, `avgWeekdayActiveHours`
- `avgSpanHours`, `avgInteractionsPerDay`, `totalTalkMinutes`
- `avgStart`, `avgEnd` (clock times)
- `verdict` — heuristic label: `marathon` (avg span ≥ 12h), `full-day`
  (avg active ≥ 6h OR google span ≥ 7h), `full-day / light-HS` (google/other
  span full but HS active < 4h), `light` (nothing clears full-day). Verdict is a
  convenience label, not a judgment; the numbers are the source of truth.

### 3. Reporter
- `team-activity-daily-<start>_<end>.csv` — one row per person-day, all metrics.
- `team-activity-summary-<start>_<end>.csv` — one row per person, rollups.
- Console: the markdown summary table (person, active days, avg active/day, avg
  span, interactions/day, talk-min/day, google span, verdict) sorted by avg
  active hours, plus a header line listing which sources ran vs were skipped.

Output dir defaults to `./tmp/reports/` (under the already-gitignored `/tmp`),
overridable via `--out`.

## Config

`scripts/team-activity-report.config.ts` (or inline const): the roster as an
array of `{ email, name, aircallId?, hubspotOwnerId? }`. Default = the 9 from last
time (Zach + Alexis, Peter, Kaitlyn, Jacob, Layla, Kat, Kristofer, Elliott).
Caleb & Patrick excluded (IT, not Ops). Roster is easy to edit; a future
enhancement can derive it from the `User` table by role.

## CLI

```
npx tsx scripts/team-activity-report.ts --from 2026-05-01 --to 2026-07-01 [--out DIR] [--only pbops,aircall]
```

Defaults: `--from` = 60 days ago, `--to` = today. `--only` restricts adapters
(useful for testing a single source).

## Error handling

- Missing `DATABASE_URL` → hard exit with message (matches existing scripts).
- Per-adapter failure is isolated: a thrown adapter is caught, logged as
  `SKIPPED — <reason>`, and the report is produced from the surviving sources.
- Empty roster match for a source → that source contributes nothing, noted in the
  run header, not an error.

## Testing

Metrics engine is pure and unit-tested (Jest) with synthetic event fixtures:
- span/active/gap-cap math (the worked example from last session)
- interaction dedup within/outside the 10-min window
- weekday filtering and rollups
- verdict thresholds
Adapters are thin I/O and validated by a live dry-run against a short date range,
not unit-tested against live APIs.

## Rollout / unlocking all 5 sources

Ships working with 3/5 sources immediately. Two parallel one-time grants unlock
the rest with no code change:
1. **HubSpot** (Zach, self-serve): add `account-info.security.read` scope to the
   private app, regenerate/re-authorize. ~1 min.
2. **Google** (IT): add `admin.reports.audit.readonly` to the service account's
   domain-wide delegation in Admin → Security → API Controls. Drafted ticket.
