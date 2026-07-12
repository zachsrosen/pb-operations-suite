# Team Activity: Filter Integration-App Drive Events — Design

**Date**: 2026-07-11
**Status**: Approved (Zach via task chip, 2026-07-11)
**Origin**: patrick@ (IT integration identity) showed 11k+ Drive events in 4
days on the team-activity dashboard — nearly all OAuth apps acting as him
(Zuper GDrive Integration, Read AI, Tray.ai Drive connector, PE Worklist
Automation) from AWS IPs. Machine traffic must not count as human activity.

## Change

One unit: `googleAdapter` in `src/lib/team-activity/adapters.ts`.

- New named constant next to the adapter:

```ts
/**
 * OAuth integrations that act AS a user on Drive around the clock (verified
 * 2026-07-11 via Admin Reports drive+token logs — AWS IPs, mass
 * move/rename/ACL churn). Their events are machine traffic, not human
 * activity, and are dropped from the google source. Keys are the Google
 * Cloud project numbers the drive audit log reports as `originating_app_id`.
 */
const INTEGRATION_APP_IDS = new Set([
  "654020450961", // Zuper GDrive Integration (job attachments -> Drive; AWS ap-south-1)
  "766098389391", // Read AI (meeting recordings/notes -> Drive)
  "346384273333", // Tray.ai - Drive connector (Caleb's Tray workflows)
  "344106271962", // PE Worklist Automation
]);
```

- In the drive branch of the item loop: skip the item when
  `paramOf(ev, "originating_app_id")` is in the set. Only `app === "drive"`
  events are affected (login/meet/chat events have no originating app).
- Metrics layer untouched; no API/UI change. Set lookup only, so no separate
  pure helper (per the task's own threshold).

## Verification

Live pull via `googleAdapter` (impersonating the Reports admin) for a recent
window, before vs after counts:
- patrick@: Google event count should collapse (>90% drop expected).
- kaitlyn@: should barely change (human web activity has no denylisted
  originating_app_id).
tsc/lint clean; existing Jest suites unaffected (adapter has no unit tests).

## Out of scope

Filtering by IP or user-agent; a config/DB-driven denylist (revisit if the
list churns); marking rather than dropping (nothing consumes machine events
today).
