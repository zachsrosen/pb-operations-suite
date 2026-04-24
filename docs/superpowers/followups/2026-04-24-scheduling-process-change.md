# Schedule via the Photon app, not directly in Zuper

**Date:** 2026-04-24
**Driver:** Compliance score fairness investigation (see `docs/superpowers/specs/2026-04-23-compliance-score-fairness-design.md` and PR #369/#372). Discovered that 5 of 6 CA Construction jobs in a 30-day window had **no `ScheduleRecord` row** — they were scheduled directly in Zuper, bypassing our app's scheduler UI. Zuper's API only exposes the current `scheduled_end_time`, so once a job is rescheduled we lose the original commitment date. That breaks fair "original crew against original date" scoring.

## What we built (this PR)

`ScheduleEventLog` — an append-only table in our DB. Every time `cacheZuperJob` sees a changed `scheduledStart` / `scheduledEnd` / crew list, a new row is appended. Going forward, we can recover:

- The **original commitment** (earliest row per `zuperJobUid`)
- Every subsequent **reschedule** (all later rows)
- The **crew assigned** at each point in time

This works regardless of where the scheduling happened — Photon app, direct Zuper edit, CSV import, etc. — because it's triggered by any cache write.

## What ops needs to change

**Primary request: schedule through the Photon scheduler UI whenever possible.** The Photon UI:

1. Writes a `ScheduleRecord` row with the `scheduledBy` user, notes, and who confirmed the booking.
2. Sends the crew-assignment email automatically.
3. Runs travel-time validation for survey slots.
4. Keeps HubSpot deal properties in sync (site_survey_schedule_date, construction_schedule_date, etc.).
5. Logs an `ActivityType.SURVEY_SCHEDULED` / `INSTALL_SCHEDULED` entry for audit.

Direct Zuper edits skip all of the above. The `ScheduleEventLog` this PR introduces catches the *event* but not the *reason* or the *scheduler's identity*.

## Enforcement options (not implementing yet — picking one is a follow-up)

- **Soft**: daily report of jobs where `ZuperJobCache.scheduledEnd` is set but `ScheduleRecord` has no row — a "scheduled in Zuper without Photon" list. Tag dispatchers.
- **Medium**: banner in the Zuper web UI reminding dispatchers to use the Photon app (requires Zuper custom field or webhook-based hint).
- **Hard**: strip scheduler permissions in Zuper for non-admin users so all scheduling must go through the app. Would require a Zuper permission audit and might break rare edge-case flows.

Recommend starting at **soft** — measure the gap, then escalate if ops continues bypassing.

## Verifying this works after rollout

1. Apply the migration (`prisma migrate deploy`) — creates `ScheduleEventLog` table.
2. Normal sync traffic (`syncZuperServiceJobs`, scheduling routes) will start writing baseline rows for every job it sees.
3. After 7 days, query:
   ```sql
   SELECT "zuperJobUid", COUNT(*) AS events
   FROM "ScheduleEventLog"
   GROUP BY "zuperJobUid"
   HAVING COUNT(*) > 1
   ORDER BY events DESC;
   ```
4. Rows with > 1 events = observed reschedules. The compliance scoring follow-up (next PR) will use the earliest row's `scheduledEnd` and `crewUserUids` as the "original commitment" for attribution.

## Out of scope for this PR

- Rewriting compliance-v2 scoring to use `ScheduleEventLog` for original-date attribution (requires the table to exist and accumulate data first).
- UI for viewing schedule history per job.
- Zuper webhook to capture reschedules in real-time (we'll catch them via `cacheZuperJob` calls from `syncZuperServiceJobs` on the existing cadence; webhook would reduce latency but isn't required).
- Backfilling historical reschedules (impossible without Zuper audit data; accept the gap).
