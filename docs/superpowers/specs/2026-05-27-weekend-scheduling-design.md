# Weekend Scheduling for Installs

**Date:** 2026-05-27
**Status:** Draft
**Reporter:** Alexis Severson (INC-661 "Weekend Days Toggle Button")

## Problem

Ops occasionally runs weekend install crews but the scheduler physically excludes
Saturday and Sunday from every view. There is no way to see or schedule weekend
dates. A visibility toggle was added (this session) but downstream code silently
advances any weekend date to Monday, so true weekend scheduling is blocked.

## Scope

- **Installs only** — surveys, inspections, service, D&R, roofing remain
  weekday-only.
- **No crew availability check** on weekends — ops manually assigns weekend
  crews and knows who is working.
- **Weekend days count in multi-day spans** when the user opts in via a
  confirmation checkbox in the schedule modal.

## Design

### UX: Confirmation Checkbox in Schedule Modal

When a schedule date falls on or spans into a weekend, the modal shows:

1. **Orange banner** at the top of the modal body:
   - Start date IS a weekend: `"Weekend Install — Saturday, May 30"`
   - Start date is weekday but span reaches a weekend:
     `"This install spans into Saturday"`

2. **Checkbox** (unchecked by default):
   `"Include weekend days in this install"`

3. **Span preview** updates live based on checkbox state:
   - Unchecked (default): `"Thu May 28 → Mon Jun 1"` (weekday-skip)
   - Checked: `"Thu May 28 → Sat May 30"` (weekend-inclusive)

4. **Schedule button** behavior:
   - If start date is a weekday and span reaches a weekend: button is always
     enabled. Unchecked = skip weekends (existing behavior). Checked = include
     weekend days.
   - If start date IS a Saturday or Sunday: button is **disabled** until the
     checkbox is checked. There is no sensible weekday fallback when the user
     explicitly clicked a weekend cell.

5. **Non-install schedule types**: If the user somehow selects a weekend date
   for a survey/inspection/service, `getNextWorkday()` advances to Monday as
   before. No banner, no checkbox.

| Scenario | Default (unchecked) | With checkbox checked |
|---|---|---|
| 3-day starting Thu | Thu, Fri, Mon | Thu, Fri, Sat |
| 2-day starting Fri | Fri, Mon | Fri, Sat |
| 1-day starting Sat | Blocked until checked | Sat |
| 2-day starting Sat | Blocked until checked | Sat, Sun |
| 3-day starting Mon | Mon, Tue, Wed (no checkbox) | n/a |

### Layer 1: Schedule Modal (`page.tsx`)

- Remove `getNextWorkday()` calls for install types when `showWeekends`
  is true. There are four call sites in `page.tsx`:
  1. `openScheduleModal` (cell click handler, line ~2465) — pass raw date
  2. Drag-drop handler (line ~3002) — pass raw dropped date
  3. Reschedule flow (line ~3463) — pass raw target date
  4. Reschedule confirm dialog (line ~7027) — pass raw date
  All four must be conditioned on
  `scheduleType === 'installation' && showWeekends`; non-install types
  continue to use `getNextWorkday()` as before.
- Add state: `weekendConfirmed: boolean` (default false), reset on modal open.
- Compute `spansIntoWeekend` from start date + construction days.
- Compute `displayEndDate` using either `getBusinessEndDateInclusive` (unchecked)
  or new `getCalendarEndDateInclusive` (checked).
- Show banner + checkbox when `isWeekend(startDate) || spansIntoWeekend`.
- Disable Schedule button when `isWeekend(startDate) && !weekendConfirmed`.
- Pass `includeWeekendDays: boolean` to the schedule API call.

### Layer 2: Zuper Schedule API (`schedule/route.ts`)

- Remove the hard `isWeekendDate` → 400 rejection (line ~483).
- Replace with: reject if `isWeekendDate(date) && scheduleType !== 'installation'`.
- Accept a new body field: `includeWeekendDays?: boolean`.
- When computing end date:
  - `includeWeekendDays === true`: use `getCalendarEndDateInclusive` (counts
    all calendar days).
  - Otherwise: use existing `getBusinessEndDateInclusive` (skips weekends).

### Layer 3: Tentative Schedule API (`schedule/tentative/route.ts`)

- The tentative route currently contains no weekend date guards, no
  `isWeekendDate` rejection, and no `getBusinessEndDateInclusive` calls.
  It stores to the DB without date validation.
- **No code changes needed.** The route already accepts any date and
  persists it. Just ensure the `includeWeekendDays` field is passed
  through to the `ScheduleRecord` write when the schema column is added.

### Layer 3b: Confirm Route (`schedule/confirm/route.ts`)

The confirm route has its own weekend rejection and business-day calculations
independent of the schedule route.

- Remove the hard weekend date rejection at line ~312 for install types
  (same conditional: reject only if `scheduleType !== 'installation'`).
- Accept `includeWeekendDays?: boolean` in the request body.
- Three `getBusinessEndDateInclusive` call sites (lines ~689, ~969,
  ~1474) must switch to `getCalendarEndDateInclusive` when
  `includeWeekendDays` is true.
- Pass `includeWeekendDays` through to Google Calendar event creation and
  the `ScheduleRecord` write.

### Layer 4: Business Day Calculations (`business-days.ts`)

Add one new function:

```ts
/**
 * Given a start date and N total work days, return the end date
 * counting ALL calendar days (no weekend skip).
 */
export function getCalendarEndDateInclusive(
  startDate: string,
  totalDays: number
): string
```

Existing `getBusinessEndDateInclusive` stays untouched.

### Layer 5: Calendar Span Rendering (`scheduling-utils.ts` / `page.tsx`)

Add a parallel function:

```ts
/**
 * Return all calendar dates in a span (no weekend skip).
 */
export function getCalendarDatesInSpan(
  startDate: string,
  totalDays: number
): string[]
```

The month/week/gantt view event placement already conditionally includes
weekend cells (from the toggle). The span data source switches between
`getBusinessDatesInSpan` and `getCalendarDatesInSpan` based on whether the
event's `includeWeekendDays` flag is set.

Additionally, `getConstructionSpanDaysFromZuper` in `scheduling-utils.ts`
(line ~143) unconditionally calls `countBusinessDaysInclusive` to derive
span length from Zuper job dates. When `includeWeekendDays` is true on
the `ScheduleRecord`, this must switch to a calendar-day count
(`countCalendarDaysInclusive`) so that spans render correctly after page
reload. Add:

```ts
export function countCalendarDaysInclusive(
  startDate: string,
  endDate: string
): number
```

And branch inside `getConstructionSpanDaysFromZuper` based on the
record's `includeWeekendDays` flag.

### Layer 6: Data Model

Add `includeWeekendDays` to `ScheduleRecord` (the table the schedule and
confirm routes write to, and the calendar reads from) so the calendar
knows how to render multi-day spans that include weekends after page
reload. This is a boolean column, default `false`.

```prisma
model ScheduleRecord {
  // ... existing fields ...
  includeWeekendDays Boolean @default(false)
}
```

### Layers That Do NOT Change

- **Google Calendar sync** — accepts any date, no guards.
- **Crew availability** — skipped entirely for weekend installs (ops assigns
  manually).
- **Scheduling notifications / emails** — date formatting handles any day.
- **Scheduling policy** (`scheduling-policy.ts`) — no weekend guards.
- **`isWeekendDateYmd` / `addBusinessDaysYmd`** in `scheduling-utils.ts` —
  shared utilities stay untouched.
- **Construction sub-scheduler components** (`ConstructionWeekView.tsx` etc.)
  — already render weekend cells grayed out.
- **Reschedule confirm dialog** — keeps weekend warning label, allows for
  installs.

### Edge Cases

- **Holiday + weekend**: PB holiday check takes precedence. If Saturday is
  also Memorial Day, the holiday block fires and the day is unschedulable.
- **Drag-drop to weekend**: allowed for installs (shows confirmation in the
  reschedule confirm dialog), blocked for other types.
- **One-click reschedule to weekend**: same — allowed for installs, weekend
  warning shown.
- **Toggle off after scheduling**: weekend-scheduled installs remain on
  their weekend dates in the DB and Zuper/Google Calendar. They just won't
  be visible on the calendar grid until the toggle is turned back on.
  Consider showing a small indicator on Friday cells: "1 weekend install
  follows" — follow-up enhancement, not required for v1.
