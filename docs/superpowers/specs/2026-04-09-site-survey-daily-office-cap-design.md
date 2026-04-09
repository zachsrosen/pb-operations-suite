# Site Survey Scheduler — Per-Office Daily Cap

**Date:** 2026-04-09
**Status:** Draft
**Scope:** Internal site-survey-scheduler (`/dashboards/site-survey-scheduler`) only. Customer portal (`portal-availability.ts`) is out of scope.

## Problem

Survey capacity at DTC and Westminster is being expanded — the daily shift window for those offices is moving to 10:00 AM–4:00 PM (six one-hour slots). Expanding the window alone would let sales book up to 6 surveys per office per day, which exceeds real crew throughput. We need to cap each office at **3 scheduled surveys per day**. Once the cap is hit, the remaining unbooked slots for that office/date should disappear from the scheduler, and the UI should explicitly communicate "day full" so ops aren't confused about why slots are missing.

Only DTC and Westminster need the cap at launch. Other offices (Colorado Springs, California/SLO, Camarillo) are unaffected and retain their existing per-crew `maxDailyJobs` behavior.

## Non-Goals

- No changes to the customer portal (`src/lib/portal-availability.ts`).
- No database schema changes. No new Prisma models, no migrations.
- No admin UI for editing caps — the cap values live as a code constant. Changing a cap requires a code edit + deploy.
- No "force book past the cap" override UI. (The API response will carry enough information to add one later without schema changes.)
- No changes to the expanded shift window itself — that's a data/config change the user is handling separately.
- No changes to the customer-portal booking flow, BookedSlot Prisma table, or any other scheduling surface.

## Current Architecture (what we're building on)

The internal site-survey-scheduler page (`src/app/dashboards/site-survey-scheduler/page.tsx`) fetches availability via `GET /api/zuper/availability?location=<office>&...`. That route:

1. Uses a hardcoded crew list defined in-file (`CREW_SCHEDULES`, roughly lines 161–296), with each crew entry carrying their shifts, location, and timezone.
2. Queries Zuper live to find which surveyors are already busy on which dates ("busy-check").
3. Maintains an in-memory `Map<string, BookedSlot>` (`const bookedSlots`) for app-side tentative bookings. This map is ephemeral — it does not persist across server restarts and is not the Prisma `BookedSlot` table.
4. Merges (1)–(3) into a per-date availability response that the scheduler page consumes.

The merged response groups entries by date. Each date's list contains both "already scheduled" entries (with an attached Zuper job or project) and "available" entries (empty slots the user could click to book).

**Critical implication:** the source of truth for "how many surveys are scheduled at this office on this date" is Zuper (+ the in-memory tentative map), not the Prisma `BookedSlot` table. Counting Prisma `BookedSlot` rows would be incorrect for this surface.

**Multi-jobType reuse:** `/api/zuper/availability` is shared across schedulers — it serves not just the site-survey-scheduler but also install, inspection, and roofing schedulers via a `jobType` query parameter. This spec's cap applies **only** to survey scheduling. See "Scoping to surveys only" below.

## Design

### High-level

After the route has (a) filtered `availableSlots` against Zuper and app bookings, (b) attached the merged `bookedSlots` array to each day, and (c) computed `hasAvailability`, but **before** the final `isFullyBooked` pass (lines ~1038–1044) and the `NextResponse.json(...)` return (line ~1046), run a post-process pass that:

1. For each date in `availabilityByDate`, reads `day.bookedSlots.length` (the already-merged count of real bookings — Zuper + app-booked).
2. If that count meets or exceeds the office cap for the requested `location` query param, clears `day.availableSlots` to `[]` and sets `day.dayCapped = true` and `day.capLimit = cap`.
3. If the office is configured with a cap but the count is below it, sets `day.dayCapped = false` and `day.capLimit = cap`. Nothing else changes.
4. Leaves both fields untouched (no `dayCapped`, no `capLimit`) when the request is not a survey request or the office has no configured cap.

The existing `isFullyBooked` pass must run **after** this helper so it re-derives correctly from the (possibly cleared) `availableSlots` array. The `hasAvailability` recompute (line 999) currently runs before this helper, so the helper must also update `day.hasAvailability = false` when it clears `availableSlots` — otherwise the scheduler would see `hasAvailability: true` and zero available slots.

The front-end reads `dayCapped` and renders a visible "Full" state on capped dates.

### Config

New constant in `src/lib/scheduling-policy.ts`:

```ts
/**
 * Per-office daily cap for scheduled site surveys.
 * When a date reaches this count at the given office, additional unbooked
 * slots are hidden from the site-survey-scheduler UI for that date.
 *
 * Keys must match the office display names used by the hardcoded crew list
 * in `src/app/api/zuper/availability/route.ts` (e.g. "DTC", "Westminster").
 * Offices missing from this map have no office-level cap — existing
 * per-crew `maxDailyJobs` behavior still applies.
 */
export const OFFICE_DAILY_SURVEY_CAPS: Record<string, number> = {
  DTC: 3,
  Westminster: 3,
};
```

### Post-process helper

New helper, colocated in the availability route. Operates in-place on the existing day object (matches how the rest of the route mutates `availabilityByDate`):

```ts
// Minimal structural type of the day object the route already builds.
// (Actual type in-file uses `any` in places; the helper only touches these fields.)
interface DayForCap {
  availableSlots: unknown[];
  bookedSlots: unknown[];
  hasAvailability: boolean;
  dayCapped?: boolean; // NEW
  capLimit?: number;   // NEW
}

function applyOfficeDailyCap(
  day: DayForCap,
  office: string | undefined,
): void {
  if (!office) return; // no location filter on the request — leave day untouched
  const cap = OFFICE_DAILY_SURVEY_CAPS[office];
  if (cap === undefined) return; // office not configured — leave day untouched

  day.capLimit = cap;

  if (day.bookedSlots.length >= cap) {
    day.availableSlots = [];
    day.hasAvailability = false;
    day.dayCapped = true;
  } else {
    day.dayCapped = false;
  }
}
```

No `isBookedEntry` predicate is needed — the route has already separated bookings from available slots by the time the helper runs. `day.bookedSlots.length` is the count of currently-scheduled surveys (Zuper + app-booked, already merged at lines ~890–996).

The route calls `applyOfficeDailyCap` once per date, after the merge/recompute block (line ~1000), before the `isFullyBooked` pass (line ~1038). That ordering is important — `isFullyBooked` will then automatically become `true` on capped days since the helper empties `availableSlots` first.

The helper only runs when the request is a survey request. See "Scoping to surveys only" below.

### Scoping to surveys only

The availability route is shared by multiple schedulers (survey, install, inspection, roofing). This cap must apply **only when the request is for survey scheduling** — install and inspection capacity is governed by separate rules (existing per-crew `maxDailyJobs`, etc.).

Implementation: the helper is only invoked when the incoming request's `jobType` indicates a survey (the route already inspects `jobType` for alias resolution — see the `getLocationMatches(location, jobType)` call). For non-survey requests, the response passes through unchanged. The constant's name (`OFFICE_DAILY_SURVEY_CAPS`) reinforces this at the call site.

If install or inspection schedulers ever need their own per-office caps, add sibling constants (`OFFICE_DAILY_INSTALL_CAPS`, etc.) and gate on `jobType` the same way. Out of scope for this spec.

### API response shape changes

Additive and non-breaking. The route already returns `availabilityByDate` keyed by date, where each day carries `availableSlots`, `bookedSlots`, `hasAvailability`, `isFullyBooked`, and `timeOffs`. The helper adds two optional fields per day:

```ts
{
  "2026-04-14": {
    availableSlots: [],                // EXISTING — cleared by helper when capped
    bookedSlots: [ /* 3 merged bookings */ ],  // EXISTING — untouched
    hasAvailability: false,            // EXISTING — forced to false by helper when capped
    isFullyBooked: true,               // EXISTING — becomes true naturally after cleared availableSlots
    timeOffs: [ /* ... */ ],           // EXISTING — untouched
    dayCapped: true,                   // NEW
    capLimit: 3                        // NEW
  }
}
```

**Contract for the new fields (resolves ambiguity about uncapped offices):**

- **Survey requests, office has a configured cap:** Every day in the response carries `dayCapped: true | false` and `capLimit: <number>`. Exactly one rule, no undefined values.
- **Survey requests, office has no configured cap** (COSP, California, SLO, Camarillo): Neither field is set. The helper returns early. Front-end treats missing `dayCapped` as `false`.
- **Non-survey requests** (install, inspection, roofing): Helper does not run. Neither field is set. Identical to today's behavior.

Existing consumers that don't read `dayCapped`/`capLimit` continue to work — a day with `availableSlots: []`, `hasAvailability: false`, `isFullyBooked: true` is already a valid "no availability" state that today's scheduler handles. The new fields are purely additive signal for the "Full" UI treatment.

### Front-end changes

In `src/app/dashboards/site-survey-scheduler/page.tsx`:

1. Extend the `DayAvailability` TypeScript interface to include `dayCapped?: boolean` and `capLimit?: number`.
2. Date chip/cell in the calendar: when `dayCapped === true`, render a "Full" pill (gray background, smaller text) next to or under the date. Use the existing theme tokens (`bg-surface-2`, `text-muted`) to stay consistent with the rest of the scheduler chrome.
3. When a capped date is selected and the slot panel is shown, render a banner at the top of the slot list:
   > "<Office> has reached its daily limit of <capLimit> scheduled surveys for this date."
4. Banner uses the same theme-token styling as existing info banners in the scheduler. No new component needed.

No new user actions — the banner is purely informational. If a "request override" workflow is added later, the banner is the natural host for that button.

### Counting rule and cancellation semantics

A date's "currently scheduled" count is computed over the date's slot list after the existing Zuper busy-check merge. It includes every slot the route would already render with a project/job attached. Cancellations self-heal automatically: once Zuper no longer returns the job in the busy-check, the corresponding entry drops from the next response, the count decreases, and if it falls below the cap the date flips back to `dayCapped: false` with its full available-slot list.

This means no explicit cancellation hook is needed — the cap state is derived per request, not stored.

### Edge cases

| Case | Behavior |
|------|----------|
| Office not in `OFFICE_DAILY_SURVEY_CAPS` | Helper returns early; `dayCapped` and `capLimit` are **not set** on any day; response identical to today |
| Office has 4+ jobs in Zuper (force-booked externally) | All 4+ entries remain in `bookedSlots` (helper never touches `bookedSlots`); `availableSlots` cleared; `dayCapped: true`; `isFullyBooked: true` |
| Surveyor serves multiple offices in one day | Cap is per office keyed by the `location` query param, not per surveyor. A surveyor could theoretically have 3 DTC + 3 Westminster on the same day. Acceptable — that's already how the crew list behaves. |
| `location` query param missing | Route already has a code path for "no location filter." Helper receives `undefined` for office, returns early (no lookup, no fields set). Behavior identical to today. |
| Multiple crews at the same office with overlapping shifts | Cap is per-office-per-date on the merged `bookedSlots` list. Crew assignment/dedup is upstream of the helper. |
| Cap value changes mid-day | Next request applies the new cap. No cache to invalidate. |
| Zuper API flakes during busy-check | Existing route-level error handling applies. The helper runs over whatever the route produces — if Zuper returned zero jobs, `bookedSlots.length` is 0, day is not capped, matching existing behavior. |
| Day has 3 bookings + an `all_day` time-off | `bookedSlots.length` is 3 → helper sets `dayCapped: true` and clears `availableSlots`. `isFullyBooked` was already `true` from the time-off. No conflict. |

## Testing

Unit tests for `applyOfficeDailyCap` (new test file, Jest). Each test builds a minimal fixture day object with `availableSlots`, `bookedSlots`, and `hasAvailability`, calls the helper, and asserts the mutated state.

1. **DTC day, 2 booked + 4 available** → `dayCapped: false`, `capLimit: 3`, `availableSlots.length === 4`, `bookedSlots.length === 2`, `hasAvailability: true` (unchanged).
2. **DTC day, 3 booked + 3 available** → `dayCapped: true`, `capLimit: 3`, `availableSlots.length === 0`, `bookedSlots.length === 3` (unchanged), `hasAvailability: false`.
3. **DTC day, 4 booked + 2 available** (force-booked externally) → `dayCapped: true`, `capLimit: 3`, `availableSlots.length === 0`, `bookedSlots.length === 4` (all preserved), `hasAvailability: false`.
4. **Colorado Springs day, 3 booked + 3 available** → `dayCapped` NOT set, `capLimit` NOT set, `availableSlots.length === 3` (untouched), `hasAvailability: true`.
5. **Westminster day, 0 booked + 6 available** → `dayCapped: false`, `capLimit: 3`, `availableSlots.length === 6` (untouched), `hasAvailability: true`.
6. **Unknown office string (`"FakeOffice"`)** → helper returns early, `dayCapped` NOT set, `capLimit` NOT set, day untouched.
7. **DTC day, 3 booked + 0 available** (already zero available) → `dayCapped: true`, `capLimit: 3`, `availableSlots.length === 0`, `hasAvailability: false`. Confirms idempotency.
8. **Helper called with `office: undefined`** (simulates route with no `location` query param) → helper returns early, day untouched, `dayCapped` and `capLimit` NOT set.

Integration smoke test (optional, defer if costly to set up):
- Hit `GET /api/zuper/availability?location=DTC` against a test fixture / mocked Zuper client, assert `dayCapped` is present and consistent with the booked count.

Manual QA checklist:
- Book 3 surveys at DTC for the same day via the scheduler → reload → verify the day shows "Full", no available slots render, banner appears on the day view.
- Cancel one of the 3 in Zuper → reload → day un-caps, available slots reappear.
- Book 3 at Colorado Springs → day still shows available slots (no cap).
- Book 3 at DTC and 3 at Westminster on the same day → both independently show as full.

## File-by-file change summary

| File | Change | Est. LOC |
|------|--------|----------|
| `src/lib/scheduling-policy.ts` | Add `OFFICE_DAILY_SURVEY_CAPS` constant + JSDoc | ~15 |
| `src/app/api/zuper/availability/route.ts` | Import constant, add `applyOfficeDailyCap` helper (mutates day in place — operates on `availableSlots`/`bookedSlots`/`hasAvailability`), gate on `jobType` resolving to survey, insert call after the merge loop (~line 1000) and before the `isFullyBooked` pass (~line 1038) | ~35 |
| `src/app/dashboards/site-survey-scheduler/page.tsx` | Extend `DayAvailability` interface, render "Full" pill on date chip, render info banner on selected-day panel | ~30 |
| `src/__tests__/office-daily-survey-cap.test.ts` (new) | Unit tests for the helper | ~80 |

Total: ~4 files touched, ~160 LOC. No schema changes, no new API routes, no new dependencies.

## Risks & open items

- **Helper placement ordering.** The helper must run after the merge block that populates `day.bookedSlots` and recomputes `day.hasAvailability` (~line 1000), but before the `isFullyBooked` pass (~line 1038). Getting this order wrong would leave `isFullyBooked` stale on capped days. The plan phase will reference these line anchors explicitly.
- **Cap constant drift.** The keys in `OFFICE_DAILY_SURVEY_CAPS` must match the office display names used by the hardcoded crew list. A rename in one without the other silently disables the cap. Mitigation: the unit tests should reference both sources, so a future refactor will break the tests loudly. (Noted as a plan-phase consideration.)
- **Expanded shift window for DTC/Westminster.** Out of scope for this spec — the user is changing the shift windows directly (data/config edit). This spec assumes that change has already landed when the cap ships.

## Out-of-scope extensions (future work, not this spec)

- Admin UI to edit per-office caps without deploying.
- Override role/permission allowing privileged users to book past the cap.
- Applying the same cap to the customer portal (`portal-availability.ts`).
- Applying an equivalent cap to install/inspection/roofing schedulers.
- Historical reporting on "how often do we hit the cap?" — would inform whether 3 is the right number.
