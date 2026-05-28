# Weekend Install Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable true weekend scheduling for installs via a confirmation checkbox in the schedule modal, while keeping all other schedule types weekday-only.

**Architecture:** Add `getCalendarEndDateInclusive`, `getCalendarDatesInSpan`, and `countCalendarDaysInclusive` as calendar-day counterparts to existing business-day functions. Conditionally bypass `getNextWorkday()` and weekend rejection guards when `scheduleType === 'installation' && showWeekends`. Persist the user's choice via `includeWeekendDays` on `ScheduleRecord`.

**Tech Stack:** Next.js 16.1, React 19, TypeScript, Prisma 7.3 on Neon Postgres, Zuper API, Google Calendar API

**Spec:** `docs/superpowers/specs/2026-05-27-weekend-scheduling-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `prisma/schema.prisma` | Modify (line 1309) | Add `includeWeekendDays` column to ScheduleRecord |
| `src/lib/db.ts` | Modify (line 718–765) | Add `includeWeekendDays` to `createScheduleRecord` |
| `src/lib/business-days.ts` | Modify (append) | Add `getCalendarEndDateInclusive` |
| `src/lib/scheduling-utils.ts` | Modify (append + line 156) | Add `getCalendarDatesInSpan`, `countCalendarDaysInclusive`, update `getConstructionSpanDaysFromZuper` |
| `src/app/api/zuper/jobs/schedule/route.ts` | Modify (lines 483, 830, 1085, 1257, 2600) | Conditional weekend rejection, calendar-day end dates, pass through `includeWeekendDays` |
| `src/app/api/zuper/jobs/schedule/confirm/route.ts` | Modify (lines 312, 689, 969, 1474) | Same pattern as schedule route |
| `src/app/api/zuper/jobs/schedule/tentative/route.ts` | Modify (line 147) | Pass `includeWeekendDays` through to `createScheduleRecord` |
| `src/app/dashboards/scheduler/page.tsx` | Modify (lines 509, 931, 1682, 1689, 2368, 2444–2465, 2629, 2703, 3002, 3463, 5173, 5855–6284, 6995–7080) | Weekend confirmation UX, conditional `getNextWorkday`, span rendering |

---

## Chunk 1: Data Model + Utility Functions

### Task 1: Prisma Migration — Add `includeWeekendDays` to ScheduleRecord

**Files:**
- Modify: `prisma/schema.prisma:1309` (before `@@index` block)

- [ ] **Step 1: Add column to schema**

In `prisma/schema.prisma`, inside the `ScheduleRecord` model, add before the `@@index` lines (line 1305):

```prisma
  includeWeekendDays Boolean @default(false)
```

- [ ] **Step 2: Generate migration**

```bash
npx prisma migrate dev --name add_schedule_record_include_weekend_days --create-only
```

- [ ] **Step 3: Verify the migration SQL**

Open the generated migration file and confirm it contains:
```sql
ALTER TABLE "ScheduleRecord" ADD COLUMN "includeWeekendDays" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 4: Apply migration locally**

```bash
npx prisma migrate dev
```

- [ ] **Step 5: Regenerate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add includeWeekendDays to ScheduleRecord"
```

### Task 2: Update `createScheduleRecord` in `db.ts`

**Files:**
- Modify: `src/lib/db.ts:718-765`

- [ ] **Step 1: Add parameter and pass-through**

In the `createScheduleRecord` function signature (line 718), add `includeWeekendDays?: boolean` to the `data` parameter type, after `notes?: string` (line 735):

```ts
  includeWeekendDays?: boolean;
```

In the `prisma.scheduleRecord.create` data object (line 741), add after `notes: data.notes` (line 758):

```ts
        includeWeekendDays: data.includeWeekendDays ?? false,
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(db): pass includeWeekendDays through createScheduleRecord"
```

### Task 3: Add `getCalendarEndDateInclusive` to `business-days.ts`

**Files:**
- Modify: `src/lib/business-days.ts` (append after line 41)

- [ ] **Step 1: Write the function**

Append to `src/lib/business-days.ts`:

```ts
/**
 * Given a start date and N total days, return the inclusive end date
 * counting ALL calendar days (no weekend skip).
 * Examples:
 * - start=2026-05-29 (Fri), totalDays=1  -> 2026-05-29
 * - start=2026-05-29 (Fri), totalDays=2  -> 2026-05-30 (Sat)
 * - start=2026-05-29 (Fri), totalDays=3  -> 2026-05-31 (Sun)
 */
export function getCalendarEndDateInclusive(startDate: string, totalDays: number): string {
  const cursor = parseYmdToUtcDate(startDate);
  const daysToAdd = Math.max(Math.ceil(totalDays), 1) - 1;
  cursor.setUTCDate(cursor.getUTCDate() + daysToAdd);
  return formatUtcDateToYmd(cursor);
}
```

Note: `parseYmdToUtcDate` and `formatUtcDateToYmd` are file-private helpers already defined at lines 1 and 9. No new imports needed.

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/business-days.ts
git commit -m "feat(business-days): add getCalendarEndDateInclusive"
```

### Task 4: Add `getCalendarDatesInSpan` and `countCalendarDaysInclusive` to `scheduling-utils.ts`

**Files:**
- Modify: `src/lib/scheduling-utils.ts` (append + modify line 156)

- [ ] **Step 1: Add the two new functions**

Append to `src/lib/scheduling-utils.ts` (after line 166):

```ts
/**
 * Return all calendar dates in a span (no weekend skip).
 * E.g. startDate="2026-05-29", totalDays=3 → ["2026-05-29", "2026-05-30", "2026-05-31"]
 */
export function getCalendarDatesInSpan(startDate: string, totalDays: number): string[] {
  const days = Math.max(1, Math.ceil(totalDays));
  const dates: string[] = [];
  let cursor = startDate;
  for (let i = 0; i < days; i++) {
    dates.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return dates;
}

/**
 * Count all calendar days between two dates (inclusive).
 * E.g. "2026-05-29" to "2026-05-31" → 3
 */
export function countCalendarDaysInclusive(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 1;
  if (endDate < startDate) return 1;
  let cursor = startDate;
  let count = 0;
  while (cursor <= endDate) {
    count += 1;
    cursor = addDaysYmd(cursor, 1);
  }
  return Math.max(count, 1);
}
```

- [ ] **Step 2: Update `getConstructionSpanDaysFromZuper` to accept `includeWeekendDays`**

Modify the function signature at line 143 and the body at line 156:

```ts
export function getConstructionSpanDaysFromZuper(params: {
  startIso?: string | null;
  endIso?: string | null;
  scheduledDays?: number | null;
  timezone: string;
  includeWeekendDays?: boolean;
}): number | undefined {
  if (params.startIso && params.endIso) {
    const boundaries = normalizeZuperBoundaryDates({
      startIso: params.startIso,
      endIso: params.endIso,
      timezone: params.timezone,
    });
    if (boundaries.startDate && boundaries.endDate) {
      return params.includeWeekendDays
        ? countCalendarDaysInclusive(boundaries.startDate, boundaries.endDate)
        : countBusinessDaysInclusive(boundaries.startDate, boundaries.endDate);
    }
  }

  const scheduledDays = Number(params.scheduledDays);
  if (Number.isFinite(scheduledDays) && scheduledDays > 0) {
    return Math.max(1, Math.ceil(scheduledDays));
  }

  return undefined;
}
```

The new `includeWeekendDays` parameter is optional and defaults to `undefined` (falsy), so all existing callers continue to use business-day counting unchanged.

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/scheduling-utils.ts
git commit -m "feat(scheduling-utils): add calendar-day span functions + weekend-aware getConstructionSpanDaysFromZuper"
```

---

## Chunk 2: API Route Changes

### Task 5: Update Schedule Route (`schedule/route.ts`)

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/route.ts`

- [ ] **Step 1: Make weekend rejection conditional (line 483)**

Replace lines 483–488:

```ts
    if (isWeekendDate(schedule.date)) {
      return NextResponse.json(
        { error: "Cannot schedule on weekends" },
        { status: 400 }
      );
    }
```

With:

```ts
    if (isWeekendDate(schedule.date) && scheduleType !== "installation") {
      return NextResponse.json(
        { error: "Cannot schedule on weekends" },
        { status: 400 }
      );
    }
```

- [ ] **Step 2: Read `includeWeekendDays` from request body**

Find where `schedule` is destructured from the request body (around line 430–440). The body structure is `{ project, schedule, rescheduleOnly }`. After those destructures, add:

```ts
    const includeWeekendDays = schedule.includeWeekendDays === true;
```

- [ ] **Step 3: Update business-day end date calculation (line 830)**

Add import at top (line 28, where `getBusinessEndDateInclusive` is imported):

```ts
import { getBusinessEndDateInclusive, getCalendarEndDateInclusive, isWeekendDate } from "@/lib/business-days";
```

Replace line 830:

```ts
      const endDateStr = getBusinessEndDateInclusive(schedule.date, days);
```

With:

```ts
      const endDateStr = includeWeekendDays
        ? getCalendarEndDateInclusive(schedule.date, days)
        : getBusinessEndDateInclusive(schedule.date, days);
```

- [ ] **Step 4: Update Google Calendar end date calculation (line 2600)**

Replace line 2600:

```ts
          const endDate = getBusinessEndDateInclusive(schedule.date, days);
```

With:

```ts
          const endDate = includeWeekendDays
            ? getCalendarEndDateInclusive(schedule.date, days)
            : getBusinessEndDateInclusive(schedule.date, days);
```

- [ ] **Step 5: Pass `includeWeekendDays` to `createScheduleRecord` (lines 1085, 1257)**

At both `createScheduleRecord` call sites, add `includeWeekendDays` to the data object.

Line 1085 (reschedule path) — add after `notes: schedule.notes,` (line 1101):

```ts
        includeWeekendDays,
```

Line 1257 (create path) — add after `notes: schedule.notes,` (find the matching line near 1269):

```ts
        includeWeekendDays,
```

- [ ] **Step 6: Verify types compile**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/route.ts
git commit -m "feat(schedule-api): allow weekend dates for installs, pass includeWeekendDays"
```

### Task 6: Update Confirm Route (`schedule/confirm/route.ts`)

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/confirm/route.ts`

- [ ] **Step 1: Make weekend rejection conditional (line 312)**

Replace lines 312–317:

```ts
    if (isWeekendDate(record.scheduledDate)) {
      return NextResponse.json(
        { error: "Cannot confirm a weekend schedule. Please move it to a weekday first." },
        { status: 400 }
      );
    }
```

With:

```ts
    if (isWeekendDate(record.scheduledDate) && normalizedScheduleType !== "installation" && normalizedScheduleType !== "construction") {
      return NextResponse.json(
        { error: "Cannot confirm a weekend schedule. Please move it to a weekday first." },
        { status: 400 }
      );
    }
```

Note: `normalizedScheduleType` is defined at line 320. Since we need it before line 312, move the weekend check AFTER line 322 (after `normalizedScheduleType` is computed). Alternatively, compute the schedule type inline: `String(record.scheduleType || "").toLowerCase()`.

Best approach: move the weekend check block to after line 322 (after `normalizedScheduleType` is defined).

- [ ] **Step 2: Read `includeWeekendDays` from request body and record**

The confirm route reads `record` from DB. After the record is fetched, read `includeWeekendDays` from both the request body and the record:

```ts
    const includeWeekendDays = body.includeWeekendDays === true || record.includeWeekendDays === true;
```

- [ ] **Step 3: Add import for `getCalendarEndDateInclusive`**

Update the import at line 23:

```ts
import { getBusinessEndDateInclusive, getCalendarEndDateInclusive, isWeekendDate } from "@/lib/business-days";
```

- [ ] **Step 4: Update three `getBusinessEndDateInclusive` call sites**

Line 689:

```ts
        endDateForSchedule = includeWeekendDays
          ? getCalendarEndDateInclusive(record.scheduledDate, record.scheduledDays || 1)
          : getBusinessEndDateInclusive(record.scheduledDate, record.scheduledDays || 1);
```

Line 969:

```ts
        const sibEndDateForSchedule = scheduleType === "installation"
          ? (includeWeekendDays
            ? getCalendarEndDateInclusive(sibling.scheduledDate, sibling.scheduledDays || 1)
            : getBusinessEndDateInclusive(sibling.scheduledDate, sibling.scheduledDays || 1))
          : sibling.scheduledDate;
```

Line 1474:

```ts
              const endDate = includeWeekendDays
                ? getCalendarEndDateInclusive(record.scheduledDate, days)
                : getBusinessEndDateInclusive(record.scheduledDate, days);
```

- [ ] **Step 5: Verify types compile**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/confirm/route.ts
git commit -m "feat(confirm-api): allow weekend dates for installs, calendar-day end dates"
```

### Task 7: Update Tentative Route (`schedule/tentative/route.ts`)

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/tentative/route.ts:147`

- [ ] **Step 1: Pass `includeWeekendDays` through to `createScheduleRecord`**

The tentative route reads from `schedule` in the request body (line ~100). Extract:

```ts
    const includeWeekendDays = schedule.includeWeekendDays === true;
```

At the `createScheduleRecord` call (line 147), add to the data object:

```ts
      includeWeekendDays,
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/tentative/route.ts
git commit -m "feat(tentative-api): pass includeWeekendDays to ScheduleRecord"
```

---

## Chunk 3: Frontend — Schedule Modal UX

### Task 8: Add Weekend Confirmation UX to Schedule Modal

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx`

This is the largest task. It covers: conditional `getNextWorkday`, weekend confirmation state, banner + checkbox in modal, button disable logic, and passing `includeWeekendDays` to the API.

- [ ] **Step 1: Add imports**

At the top of the file, add to the existing import from `@/lib/business-days` (or add a new import):

```ts
import { getBusinessEndDateInclusive, getCalendarEndDateInclusive, isWeekendDate as isWeekendDateBD } from "@/lib/business-days";
```

Add to the import from `@/lib/scheduling-utils` (line 21 area):

```ts
import {
  getBusinessDatesInSpan as getBusinessDatesInSpanShared,
  getCalendarDatesInSpan,
  isWeekendDateYmd,
} from "@/lib/scheduling-utils";
```

Note: The file already imports `getBusinessDatesInSpan` from scheduling-utils at line 21. Just add `getCalendarDatesInSpan` to that import.

- [ ] **Step 2: Add `weekendConfirmed` state**

Near line 931 (where `showWeekends` is defined), add:

```ts
  const [weekendConfirmed, setWeekendConfirmed] = useState(false);
```

- [ ] **Step 3: Conditional `getNextWorkday` in `openScheduleModal` (line 2465)**

Replace line 2465:

```ts
      const adjustedDate = getNextWorkday(dateStr);
```

With:

```ts
      const isInstall = project.stage !== "survey" && project.stage !== "inspection";
      const adjustedDate = (isInstall && showWeekends) ? dateStr : getNextWorkday(dateStr);
```

Also reset `weekendConfirmed` when opening the modal. After the `setScheduleModal` call (line 2521), add:

```ts
      setWeekendConfirmed(false);
```

- [ ] **Step 4: Conditional `getNextWorkday` in `handleOneClickReschedule` (line 3002)**

Replace line 3002:

```ts
    const adjustedDate = getNextWorkday(newDate);
```

With:

```ts
    const isInstall = scheduleType === "installation";
    const adjustedDate = (isInstall && showWeekends) ? newDate : getNextWorkday(newDate);
```

Note: `scheduleType` is defined at line 3004. Move the scheduleType definition above the adjustedDate line.

- [ ] **Step 5: Conditional `getNextWorkday` in drag-drop handler (line 3463)**

Replace line 3463:

```ts
            toDate: getNextWorkday(dateStr),
```

With:

```ts
            toDate: (project.stage !== "survey" && project.stage !== "inspection" && showWeekends)
              ? dateStr
              : getNextWorkday(dateStr),
```

- [ ] **Step 6: Conditional `getNextWorkday` in reschedule confirm dialog (line 7027)**

Replace lines 7027–7029:

```ts
              const adjusted = getNextWorkday(rescheduleConfirm.toDate);
              if (holidayWarn) return <p className="text-[0.65rem] text-red-400 mb-2">⚠ {holidayWarn} — will schedule on {formatDateShort(adjusted)} instead</p>;
              if (weekendWarn) return <p className="text-[0.65rem] text-red-400 mb-2">⚠ Weekend — will schedule on {formatDateShort(adjusted)} instead</p>;
```

With:

```ts
              const isInstall = rescheduleConfirm.project.stage !== "survey" && rescheduleConfirm.project.stage !== "inspection";
              const adjusted = (isInstall && showWeekends) ? rescheduleConfirm.toDate : getNextWorkday(rescheduleConfirm.toDate);
              if (holidayWarn) return <p className="text-[0.65rem] text-red-400 mb-2">⚠ {holidayWarn} — will schedule on {formatDateShort(adjusted)} instead</p>;
              if (weekendWarn && !(isInstall && showWeekends)) return <p className="text-[0.65rem] text-red-400 mb-2">⚠ Weekend — will schedule on {formatDateShort(adjusted)} instead</p>;
              if (weekendWarn && isInstall && showWeekends) return <p className="text-[0.65rem] text-orange-400 mb-2">⚠ Weekend install — {formatDateShort(rescheduleConfirm.toDate)}</p>;
```

- [ ] **Step 7: Commit the `getNextWorkday` changes**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): conditional getNextWorkday bypass for weekend installs"
```

### Task 9: Weekend Banner, Checkbox, and Button Disable in Modal

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx` (modal JSX at line 5855+)

- [ ] **Step 1: Add weekend banner and checkbox to the schedule modal body**

Inside the schedule modal (after the `<ModalSection title="Schedule">` block which starts at line 6080), add the weekend confirmation UI. Insert BEFORE the `<ModalSection title="Schedule">` line (line 6080):

```tsx
              {/* Weekend confirmation */}
              {(() => {
                const isInstall = scheduleModal.project.stage !== "survey" && scheduleModal.project.stage !== "inspection";
                if (!isInstall || !showWeekends) return null;
                const startIsWeekend = isWeekend(scheduleModal.date);
                const days = Math.max(1, Math.ceil(installDaysInput || scheduleModal.project.daysInstall || 1));
                const businessEnd = getBusinessDatesInSpan(scheduleModal.date, days);
                const calendarEnd = getCalendarDatesInSpan(scheduleModal.date, days);
                const spansIntoWeekend = !startIsWeekend && calendarEnd.some((d) => isWeekend(d)) && calendarEnd.length < businessEnd.length + 2;
                const needsBanner = startIsWeekend || (days > 1 && businessEnd[businessEnd.length - 1] !== calendarEnd[calendarEnd.length - 1]);
                if (!needsBanner) return null;

                const weekendDay = startIsWeekend
                  ? new Date(scheduleModal.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
                  : (() => {
                      const firstWeekendDate = calendarEnd.find((d) => isWeekend(d));
                      return firstWeekendDate
                        ? new Date(firstWeekendDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })
                        : "a weekend day";
                    })();

                const businessEndDate = businessEnd[businessEnd.length - 1];
                const calendarEndDate = calendarEnd[calendarEnd.length - 1];

                return (
                  <div className="mb-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
                    <p className="text-[0.75rem] font-semibold text-orange-400 mb-2">
                      {startIsWeekend
                        ? `Weekend Install — ${weekendDay}`
                        : `This install spans into ${weekendDay}`}
                    </p>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={weekendConfirmed}
                        onChange={(e) => setWeekendConfirmed(e.target.checked)}
                        className="accent-orange-500 w-3.5 h-3.5"
                      />
                      <span className="text-[0.7rem] text-foreground/80">Include weekend days in this install</span>
                    </label>
                    {days > 1 && (
                      <p className="text-[0.6rem] text-muted mt-1.5">
                        {weekendConfirmed
                          ? `${formatDateShort(scheduleModal.date)} → ${formatDateShort(calendarEndDate)} (${days} calendar days)`
                          : `${formatDateShort(scheduleModal.date)} → ${formatDateShort(businessEndDate)} (${days} business days)`}
                      </p>
                    )}
                  </div>
                );
              })()}
```

- [ ] **Step 2: Disable schedule button when start is weekend and not confirmed**

At the Schedule button (line 6270–6272), update the `disabled` prop:

Replace:

```tsx
                disabled={syncingToZuper}
```

With:

```tsx
                disabled={syncingToZuper || (isWeekend(scheduleModal.date) && showWeekends && scheduleModal.project.stage !== "survey" && scheduleModal.project.stage !== "inspection" && !weekendConfirmed)}
```

- [ ] **Step 3: Pass `includeWeekendDays` to the schedule API call (line 2629)**

In the `confirmSchedule` function, at the API call body (line 2632), add `includeWeekendDays` to the `schedule` object:

```ts
              includeWeekendDays: weekendConfirmed,
```

Add it after `installerNotes` (around line 2655).

Also in the tentative API call (line 2706), add to the `schedule` object:

```ts
              includeWeekendDays: weekendConfirmed,
```

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): weekend confirmation banner, checkbox, and button disable in modal"
```

### Task 10: Update Span Rendering for Weekend-Inclusive Events

**Files:**
- Modify: `src/app/dashboards/scheduler/page.tsx`

The calendar views use `getBusinessDatesInSpan` to compute which cells an event spans. For events with `includeWeekendDays`, use `getCalendarDatesInSpan` instead.

- [ ] **Step 1: Add `includeWeekendDays` to `ScheduledEvent` type and update capacity check**

Add `includeWeekendDays?: boolean` to the `ScheduledEvent` interface at line 153:

```ts
interface ScheduledEvent extends SchedulerProject {
  date: string;
  eventType: string;
  days: number;
  isCompleted?: boolean;
  isOverdue?: boolean;
  isInspectionFailed?: boolean;
  isTentative?: boolean;
  tentativeRecordId?: string;
  isForecast?: boolean;
  includeWeekendDays?: boolean;
}
```

Then find where `ScheduledEvent` objects are constructed from schedule data and populate `includeWeekendDays` from the source record's field. (Search for assignments to `date:` and `eventType:` that build `ScheduledEvent` objects.)

Update the capacity check at

For the capacity check at line 1682:

```ts
      const dates = booking.includeWeekendDays
        ? getCalendarDatesInSpan(booking.startDate, booking.days)
        : getBusinessDatesInSpan(booking.startDate, booking.days);
```

For line 1689:

```ts
    const spanDates = weekendConfirmed
      ? getCalendarDatesInSpan(scheduleModal.date, days)
      : getBusinessDatesInSpan(scheduleModal.date, days);
```

- [ ] **Step 2: Update day view event matching (line 2368)**

```ts
      const spanDates = e.includeWeekendDays
        ? getCalendarDatesInSpan(e.date, businessDays)
        : getBusinessDatesInSpan(e.date, businessDays);
```

- [ ] **Step 3: Update week view inline span calculation (line 5165–5181)**

The week view has its own inline span loop. When `e.includeWeekendDays` is true, count all calendar days instead of skipping weekends:

Replace the condition at line 5173:

```ts
                              if (showWeekends || (dow !== 0 && dow !== 6)) {
```

With:

```ts
                              if (e.includeWeekendDays || showWeekends || (dow !== 0 && dow !== 6)) {
```

This ensures weekend-inclusive events always render across weekend cells even when the general `showWeekends` toggle is on.

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/scheduler/page.tsx
git commit -m "feat(scheduler): weekend-inclusive span rendering in month/week/gantt views"
```

---

## Chunk 4: Integration Verification

### Task 11: Full Build Verification

- [ ] **Step 1: Run full type check**

```bash
npx tsc --noEmit --pretty
```

- [ ] **Step 2: Run full build**

```bash
npm run build
```

- [ ] **Step 3: Run tests**

```bash
npm run test 2>&1 | tail -20
```

- [ ] **Step 4: Manual smoke test checklist**

Test these scenarios on the local dev server (`npm run dev`):

1. Open scheduler → turn on weekend toggle → click a Saturday cell for an install project → verify orange banner appears, checkbox unchecked, Schedule button disabled
2. Check the checkbox → verify button enables, span preview updates
3. Schedule the weekend install → verify no API error
4. Turn off weekend toggle → verify the install still exists in data (not visible on grid)
5. Click a Thursday for a 3-day install → verify banner shows "spans into Saturday", unchecked shows Thu→Mon, checked shows Thu→Sat
6. Try scheduling a survey on Saturday → verify it still advances to Monday (no banner)
7. Use drag-drop to move an install to Saturday → verify reschedule confirm dialog shows weekend warning appropriately

- [ ] **Step 5: Final commit with any fixes**

```bash
git add -A
git commit -m "feat(weekend-scheduling): complete weekend install scheduling implementation"
```
