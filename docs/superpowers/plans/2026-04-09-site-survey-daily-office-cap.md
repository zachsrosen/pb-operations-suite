# Site Survey Scheduler — Per-Office Daily Cap Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap DTC and Westminster at 3 scheduled surveys per day so their expanded 10 AM–4 PM shift windows don't over-book real crew throughput. Once a day is capped, the remaining unbooked slots disappear from the site-survey-scheduler and the UI explains why.

**Architecture:** Add a pure helper `applyOfficeDailyCap(day, office)` in `src/lib/scheduling-policy.ts` that mutates a day's `availableSlots`/`hasAvailability` in place when `bookedSlots.length >= cap`. Invoke the helper from `/api/zuper/availability` for survey requests only, after the existing Zuper/app booking merge and before the `isFullyBooked` pass. Surface a new `dayCapped`/`capLimit` signal on the response so the scheduler UI can render a distinct "Full" pill on the calendar and an explanatory banner in the schedule modal.

**Tech Stack:** TypeScript, Next.js 16 App Router, Jest + ts-jest, Tailwind v4, React 19.

**Spec:** `docs/superpowers/specs/2026-04-09-site-survey-daily-office-cap-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/lib/scheduling-policy.ts` | Central home for scheduling policy rules. Adds the `OFFICE_DAILY_SURVEY_CAPS` constant and the pure `applyOfficeDailyCap` helper so it can be unit-tested without dragging in route-handler imports. | Modify |
| `src/__tests__/office-daily-survey-cap.test.ts` | Jest unit tests for the helper (8 cases) and the config constant. | Create |
| `src/app/api/zuper/availability/route.ts` | Internal site-survey-scheduler's GET handler. Calls the helper once per date for survey requests, extends the per-day type definition with `dayCapped?`/`capLimit?`. | Modify |
| `src/app/dashboards/site-survey-scheduler/page.tsx` | Scheduler UI. Extends its local `DayAvailability` TS interface, adds a gray "Full" pill variant on the calendar cell when `dayCapped`, and renders an explanatory banner in the schedule modal when a capped day is selected. | Modify |

No schema changes, no new API routes, no new dependencies.

**Commit scope convention** (matches recent repo history like `docs(office-perf): ...`): use `site-survey-scheduler` as the scope.

---

## Chunk 1: Config constant, helper, and unit tests

### Task 1: Scaffold the failing test file

**Files:**
- Create: `src/__tests__/office-daily-survey-cap.test.ts`

- [ ] **Step 1.1: Create the test file with all fixture cases**

Create `src/__tests__/office-daily-survey-cap.test.ts` with this exact content:

```ts
/**
 * Unit tests for applyOfficeDailyCap and OFFICE_DAILY_SURVEY_CAPS.
 *
 * The helper is a pure function over a structural day object. It mutates
 * the passed-in day so the tests assert on the same reference after the
 * call.
 */

import { applyOfficeDailyCap, OFFICE_DAILY_SURVEY_CAPS } from "@/lib/scheduling-policy";

type DayFixture = {
  availableSlots: unknown[];
  bookedSlots: unknown[];
  hasAvailability: boolean;
  dayCapped?: boolean;
  capLimit?: number;
};

function makeDay(bookedCount: number, availableCount: number): DayFixture {
  return {
    availableSlots: Array.from({ length: availableCount }, (_, i) => ({ slot: i })),
    bookedSlots: Array.from({ length: bookedCount }, (_, i) => ({ booking: i })),
    hasAvailability: availableCount > 0,
  };
}

describe("OFFICE_DAILY_SURVEY_CAPS", () => {
  it("configures DTC with a cap of 3", () => {
    expect(OFFICE_DAILY_SURVEY_CAPS.DTC).toBe(3);
  });

  it("configures Westminster with a cap of 3", () => {
    expect(OFFICE_DAILY_SURVEY_CAPS.Westminster).toBe(3);
  });

  it("does NOT configure Colorado Springs", () => {
    expect(OFFICE_DAILY_SURVEY_CAPS["Colorado Springs"]).toBeUndefined();
  });
});

describe("applyOfficeDailyCap", () => {
  it("DTC day with 2 booked + 4 available → not capped, all slots retained", () => {
    const day = makeDay(2, 4);
    applyOfficeDailyCap(day, "DTC");
    expect(day.dayCapped).toBe(false);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots).toHaveLength(4);
    expect(day.bookedSlots).toHaveLength(2);
    expect(day.hasAvailability).toBe(true);
  });

  it("DTC day with 3 booked + 3 available → capped, availableSlots cleared", () => {
    const day = makeDay(3, 3);
    applyOfficeDailyCap(day, "DTC");
    expect(day.dayCapped).toBe(true);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots).toHaveLength(0);
    expect(day.bookedSlots).toHaveLength(3);
    expect(day.hasAvailability).toBe(false);
  });

  it("DTC day with 4 booked + 2 available (force-booked externally) → capped, all bookings preserved", () => {
    const day = makeDay(4, 2);
    applyOfficeDailyCap(day, "DTC");
    expect(day.dayCapped).toBe(true);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots).toHaveLength(0);
    expect(day.bookedSlots).toHaveLength(4);
    expect(day.hasAvailability).toBe(false);
  });

  it("Colorado Springs day with 3 booked + 3 available → untouched", () => {
    const day = makeDay(3, 3);
    applyOfficeDailyCap(day, "Colorado Springs");
    expect(day.dayCapped).toBeUndefined();
    expect(day.capLimit).toBeUndefined();
    expect(day.availableSlots).toHaveLength(3);
    expect(day.bookedSlots).toHaveLength(3);
    expect(day.hasAvailability).toBe(true);
  });

  it("Westminster day with 0 booked + 6 available → not capped, all slots retained", () => {
    const day = makeDay(0, 6);
    applyOfficeDailyCap(day, "Westminster");
    expect(day.dayCapped).toBe(false);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots).toHaveLength(6);
    expect(day.hasAvailability).toBe(true);
  });

  it("unknown office string → helper returns early, day untouched", () => {
    const day = makeDay(3, 3);
    applyOfficeDailyCap(day, "FakeOffice");
    expect(day.dayCapped).toBeUndefined();
    expect(day.capLimit).toBeUndefined();
    expect(day.availableSlots).toHaveLength(3);
    expect(day.hasAvailability).toBe(true);
  });

  it("DTC day with 3 booked + 0 available → capped, idempotent", () => {
    const day = makeDay(3, 0);
    day.hasAvailability = false;
    applyOfficeDailyCap(day, "DTC");
    expect(day.dayCapped).toBe(true);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots).toHaveLength(0);
    expect(day.hasAvailability).toBe(false);
  });

  it("office undefined (no location query param) → helper returns early, day untouched", () => {
    const day = makeDay(3, 3);
    applyOfficeDailyCap(day, undefined);
    expect(day.dayCapped).toBeUndefined();
    expect(day.capLimit).toBeUndefined();
    expect(day.availableSlots).toHaveLength(3);
    expect(day.hasAvailability).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run the new test file and verify it fails for the right reason**

Run: `npx jest src/__tests__/office-daily-survey-cap.test.ts --no-coverage`

Expected: FAIL with a TypeScript/module error about `applyOfficeDailyCap` or `OFFICE_DAILY_SURVEY_CAPS` not being exported from `@/lib/scheduling-policy`. This is the expected RED state.

### Task 2: Implement the config constant and helper

**Files:**
- Modify: `src/lib/scheduling-policy.ts` — append to end of file

- [ ] **Step 2.1: Append the constant, type, and helper to scheduling-policy.ts**

Append the following block at the very end of `src/lib/scheduling-policy.ts` (after the closing brace of `getSalesSurveyLeadTimeError`):

```ts

/* ------------------------------------------------------------------ */
/*  Per-office daily survey cap                                        */
/* ------------------------------------------------------------------ */

/**
 * Per-office daily cap for scheduled site surveys.
 *
 * When the count of scheduled surveys at a given office on a given date
 * meets or exceeds this cap, `applyOfficeDailyCap` empties the day's
 * `availableSlots` and marks it capped. Offices not present in this map
 * have no office-level cap — existing per-crew `maxDailyJobs` behavior
 * still applies.
 *
 * Keys must match the office display names used by the hardcoded
 * `CREW_SCHEDULES` list in `src/app/api/zuper/availability/route.ts`
 * (e.g., "DTC", "Westminster"). Renaming one without the other will
 * silently disable the cap — the unit tests guard against this by
 * asserting on exact key names.
 */
export const OFFICE_DAILY_SURVEY_CAPS: Record<string, number> = {
  DTC: 3,
  Westminster: 3,
};

/**
 * Minimal structural type of the per-day object used by the Zuper
 * availability route. `applyOfficeDailyCap` only reads and writes the
 * fields below; the full day type in the route includes additional
 * fields (timeOffs, scheduledJobs, isFullyBooked, etc.) that the helper
 * does not touch.
 */
export interface DayForOfficeCap {
  availableSlots: unknown[];
  bookedSlots?: unknown[];
  hasAvailability: boolean;
  dayCapped?: boolean;
  capLimit?: number;
}

/**
 * Apply the per-office daily survey cap to a single day in place.
 *
 * Mutates `day` to match the rest of the availability route's
 * mutation-based style. When the office has a configured cap:
 *   - Always sets `day.capLimit` to the cap value.
 *   - If `day.bookedSlots.length >= cap`, clears `availableSlots`,
 *     sets `hasAvailability = false`, and sets `dayCapped = true`.
 *   - Otherwise sets `dayCapped = false`.
 *
 * When `office` is undefined (no `location` query param) or the office
 * has no configured cap, the helper returns early and does not touch
 * the day object — existing behavior is preserved.
 *
 * The caller is responsible for gating invocation to survey-type
 * requests (`type === "survey"`). This helper has no knowledge of
 * jobType.
 */
export function applyOfficeDailyCap(
  day: DayForOfficeCap,
  office: string | undefined,
): void {
  if (!office) return;
  const cap = OFFICE_DAILY_SURVEY_CAPS[office];
  if (cap === undefined) return;

  day.capLimit = cap;

  const bookedCount = day.bookedSlots?.length ?? 0;
  if (bookedCount >= cap) {
    day.availableSlots = [];
    day.hasAvailability = false;
    day.dayCapped = true;
  } else {
    day.dayCapped = false;
  }
}
```

- [ ] **Step 2.2: Run the tests and verify they all pass**

Run: `npx jest src/__tests__/office-daily-survey-cap.test.ts --no-coverage`

Expected: PASS — 11 tests passing (3 config assertions + 8 helper behaviors).

- [ ] **Step 2.3: Commit chunk 1**

```bash
git add src/lib/scheduling-policy.ts src/__tests__/office-daily-survey-cap.test.ts
git commit -m "$(cat <<'EOF'
feat(site-survey-scheduler): add applyOfficeDailyCap helper + unit tests

Introduce OFFICE_DAILY_SURVEY_CAPS { DTC: 3, Westminster: 3 } and a
pure applyOfficeDailyCap helper in scheduling-policy.ts. The helper
mutates a day object in place: clears availableSlots and marks
dayCapped when bookedSlots.length >= the office cap. Unit tests cover
8 behavioral cases plus 3 config assertions.

Wiring into /api/zuper/availability and the scheduler UI follow in
the next chunks.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 2: Wire the helper into the Zuper availability route

### Task 3: Extend the per-day type in the route

**Files:**
- Modify: `src/app/api/zuper/availability/route.ts` (around lines 372–399)

Context: the route defines `availabilityByDate` with an inline type literal. We need to add two optional fields so TypeScript is happy when the helper assigns them.

> **Note on `bookedSlots`:** the route's inline type does NOT declare `bookedSlots` — that field is attached out-of-band at line ~996 with an `@ts-expect-error` comment. That's why the helper's `DayForOfficeCap` type (from chunk 1) declares `bookedSlots?: unknown[]` as optional: at runtime the merge loop always sets it, but the route's declared type doesn't include it. Do NOT add `bookedSlots` to the route's inline type in this chunk — that's a pre-existing pattern and is out of scope.

- [ ] **Step 3.1: Add `dayCapped` and `capLimit` to the inline day type**

Find the `availabilityByDate` declaration (starts around line 372 with `const availabilityByDate: Record<`). Locate these two lines inside the day object type (around lines 397–398):

```ts
      hasAvailability: boolean;
      isFullyBooked: boolean;
```

Replace them with:

```ts
      hasAvailability: boolean;
      isFullyBooked: boolean;
      dayCapped?: boolean; // Set when office has a configured OFFICE_DAILY_SURVEY_CAPS entry (survey requests only)
      capLimit?: number;   // Office cap value when configured
```

- [ ] **Step 3.2: Type-check the file**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "availability/route|scheduling-policy" || echo "clean"`

Expected: `clean` (no errors in these two files). Other pre-existing errors in the repo are out of scope.

### Task 4: Import and invoke the helper

**Files:**
- Modify: `src/app/api/zuper/availability/route.ts`

- [ ] **Step 4.1: Add the import**

Near the top of `src/app/api/zuper/availability/route.ts`, with the other `@/lib/...` imports, add:

```ts
import { applyOfficeDailyCap } from "@/lib/scheduling-policy";
```

(If `scheduling-policy` is already imported for another symbol, extend the existing import instead of adding a new line.)

- [ ] **Step 4.2: Invoke the helper after the merge loop, before `isFullyBooked`**

Find this existing block (around line 1000) — it's the end of the for-loop that populates `day.bookedSlots` and recomputes `day.hasAvailability`:

```ts
    // Recheck availability after filtering
    day.hasAvailability = day.availableSlots.length > 0;
  }
```

Immediately after that closing `}` and BEFORE the next section (which is either the travel-time annotation block starting with `// --- Travel-time annotation` or, if that block isn't present in your local copy, the `// Determine if dates are fully booked` block around line 1038), insert:

```ts

  // ── Per-office daily survey cap ──
  // Only applies to survey requests. When the requested office has a
  // configured cap in OFFICE_DAILY_SURVEY_CAPS and the day already has
  // >= cap bookings, clear availableSlots + hasAvailability and flag
  // dayCapped so the scheduler UI can render a "Full" banner. The
  // subsequent isFullyBooked pass re-derives correctly from the
  // (possibly cleared) availableSlots.
  if (type === "survey") {
    for (const dateStr in availabilityByDate) {
      applyOfficeDailyCap(availabilityByDate[dateStr], location ?? undefined);
    }
  }
```

**Placement order is important:** this block MUST run after the merge for-loop (which produces `bookedSlots` and updates `hasAvailability`) and BEFORE the `// Determine if dates are fully booked` block (around line 1038), so `isFullyBooked` naturally becomes `true` on capped days. The travel-time annotation block (lines ~1002–1035) may sit between the merge and `isFullyBooked` in your copy — insert the cap block either before or after the travel block, both are acceptable because the travel block only reads `availableSlots` and does not depend on `dayCapped`. Inserting **before** the travel block is slightly preferred because it avoids any travel-time work on already-capped days.

- [ ] **Step 4.3: Type-check the route file again**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "availability/route|scheduling-policy" || echo "clean"`

Expected: `clean`.

- [ ] **Step 4.4: Re-run the helper unit tests as a sanity check (no new tests, just confirming nothing regressed)**

Run: `npx jest src/__tests__/office-daily-survey-cap.test.ts --no-coverage`

Expected: PASS — 11 tests passing.

- [ ] **Step 4.5: Commit chunk 2**

```bash
git add src/app/api/zuper/availability/route.ts
git commit -m "$(cat <<'EOF'
feat(site-survey-scheduler): enforce per-office daily cap in availability route

Invoke applyOfficeDailyCap on every day in the response when the
request is for survey scheduling. Extend the inline day type with
dayCapped?/capLimit?. Helper runs after the Zuper/app booking merge
so isFullyBooked re-derives correctly on capped days.

Only DTC and Westminster are configured. Other offices are untouched.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: Scheduler UI — "Full" pill variant and cap banner

### Task 5: Extend the frontend `DayAvailability` interface

**Files:**
- Modify: `src/app/dashboards/site-survey-scheduler/page.tsx` (around lines 100–144)

- [ ] **Step 5.1: Add `dayCapped` and `capLimit` to the TypeScript interface**

Find the `DayAvailability` interface (starts around line 100). Locate these two lines near the end of the interface (around lines 142–143):

```ts
  hasAvailability: boolean;
  isFullyBooked: boolean;
}
```

Replace with:

```ts
  hasAvailability: boolean;
  isFullyBooked: boolean;
  dayCapped?: boolean;  // NEW — true when the office has hit its configured daily survey cap
  capLimit?: number;    // NEW — the office's configured daily survey cap value
}
```

### Task 6: Add a distinct "Full" pill for capped days

**Files:**
- Modify: `src/app/dashboards/site-survey-scheduler/page.tsx` (around lines 2192–2212, inside the calendar cell render loop)

Context: the calendar cell already renders one of four states — loading, available (green), full (red), limited (yellow dot). We want a fifth: **capped** (gray pill), which should take precedence over the generic "full" state so ops can immediately distinguish "office hit its daily limit" from "all crews happen to be booked."

- [ ] **Step 6.1: Insert the dayCapped branch before the isFullyBooked branch**

Find the pill-rendering block (starts around line 2192). It looks like:

```tsx
{showAvailability && zuperConfigured && isCurrentMonth && !weekend && (
  <div className="flex items-center">
    {loadingSlots ? (
      <div className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" />
    ) : hasAvailability ? (
      <div
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30"
        title={`${slotCount} surveyor slot${slotCount !== 1 ? "s" : ""} available`}
      >
        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
        <span className="text-[0.6rem] font-medium text-emerald-400">{slotCount}</span>
      </div>
    ) : isFullyBooked ? (
      <div className="px-1.5 py-0.5 rounded-full bg-red-500/20 border border-red-500/30" title="Fully booked">
        <span className="text-[0.6rem] font-medium text-red-400">Full</span>
      </div>
    ) : dayAvailability ? (
      <div className="w-2 h-2 bg-yellow-500/60 rounded-full" title="Limited availability" />
    ) : null}
  </div>
)}
```

Insert a new branch between `hasAvailability ? (...)` and `isFullyBooked ? (...)`. The updated ternary should be:

```tsx
{showAvailability && zuperConfigured && isCurrentMonth && !weekend && (
  <div className="flex items-center">
    {loadingSlots ? (
      <div className="w-2 h-2 bg-zinc-600 rounded-full animate-pulse" />
    ) : hasAvailability ? (
      <div
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30"
        title={`${slotCount} surveyor slot${slotCount !== 1 ? "s" : ""} available`}
      >
        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
        <span className="text-[0.6rem] font-medium text-emerald-400">{slotCount}</span>
      </div>
    ) : dayAvailability?.dayCapped ? (
      <div
        className="px-1.5 py-0.5 rounded-full bg-zinc-500/20 border border-zinc-500/40"
        title={`Office daily cap reached (${dayAvailability.capLimit ?? 3} surveys)`}
      >
        <span className="text-[0.6rem] font-medium text-zinc-300">Full</span>
      </div>
    ) : isFullyBooked ? (
      <div className="px-1.5 py-0.5 rounded-full bg-red-500/20 border border-red-500/30" title="Fully booked">
        <span className="text-[0.6rem] font-medium text-red-400">Full</span>
      </div>
    ) : dayAvailability ? (
      <div className="w-2 h-2 bg-yellow-500/60 rounded-full" title="Limited availability" />
    ) : null}
  </div>
)}
```

The new branch's gray pill is visually distinct from the existing red "naturally full" pill, and it's ordered before `isFullyBooked` so it wins when both are true (which is always the case when `dayCapped` is set, since the helper also clears `availableSlots`).

### Task 7: Add the cap banner to the schedule modal

**Files:**
- Modify: `src/app/dashboards/site-survey-scheduler/page.tsx` (around lines 2727–2733, inside the schedule modal's "Select Time Slot" picker branch)

Context: when ops clicks a date, a schedule modal opens. If the day is capped, the "Select Time Slot" picker falls through to its empty state ("No available slots for this location on this date"). That text is misleading on a capped day — ops should see an explicit "office daily cap reached" message.

- [ ] **Step 7.1: Insert a cap-aware banner in the picker branch**

Find this existing block (around lines 2727–2733) inside the `scheduleModal.slot ? ... : (/* picker */)` ternary:

```tsx
              ) : (
                /* Time slot picker for new scheduling or rescheduling */
                <div>
                  <span className="text-xs text-muted">
                    {scheduleModal.isRescheduling ? "Select New Time Slot" : "Select Time Slot"}
                  </span>
                  <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
```

Replace it with:

```tsx
              ) : (
                /* Time slot picker for new scheduling or rescheduling */
                <div>
                  {availabilityByDate[scheduleModal.date]?.dayCapped && (
                    <div className="mb-2 px-3 py-2 rounded-lg bg-zinc-500/15 border border-zinc-500/40">
                      <p className="text-xs font-medium text-zinc-200">
                        {scheduleModal.project.location} has reached its daily limit of{" "}
                        {availabilityByDate[scheduleModal.date]?.capLimit ?? 3} scheduled surveys for this date.
                      </p>
                      <p className="text-[0.65rem] text-muted mt-0.5">
                        Pick another date, or contact ops if you need to override.
                      </p>
                    </div>
                  )}
                  <span className="text-xs text-muted">
                    {scheduleModal.isRescheduling ? "Select New Time Slot" : "Select Time Slot"}
                  </span>
                  <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
```

On capped days the banner renders above the picker; the picker itself still falls through to its existing "No available slots" empty state, which is fine — the banner provides the reason.

### Task 8: Type check and lint the scheduler page

- [ ] **Step 8.1: Type-check the scheduler page**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "site-survey-scheduler/page" || echo "clean"`

Expected: `clean` (no errors in the scheduler page file).

- [ ] **Step 8.2: Lint the modified files**

Run: `npx eslint src/lib/scheduling-policy.ts src/app/api/zuper/availability/route.ts src/app/dashboards/site-survey-scheduler/page.tsx src/__tests__/office-daily-survey-cap.test.ts`

Expected: zero errors. Warnings about pre-existing issues in large files are acceptable only if they also appeared before your edits — use `git stash` + re-lint if unsure.

- [ ] **Step 8.3: Run the full test suite to confirm no regressions**

Run: `npm run test -- --no-coverage`

Expected: all tests pass. If any pre-existing tests fail for reasons unrelated to this work, flag them but do not attempt to fix them in this plan.

- [ ] **Step 8.4: Commit chunk 3**

```bash
git add src/app/dashboards/site-survey-scheduler/page.tsx
git commit -m "$(cat <<'EOF'
feat(site-survey-scheduler): render dayCapped pill + banner in scheduler UI

Extend DayAvailability with dayCapped?/capLimit?. When an office hits
its daily survey cap, the calendar cell shows a gray "Full" pill
(distinct from the red "naturally full" pill) and the schedule modal
renders an explanatory banner above the time-slot picker.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Manual QA

These checks require a running dev server and real Zuper data, so they are a manual pass, not automated tests.

- [ ] **Step 9.1: Start the dev server**

Run: `npm run dev`

Expected: server starts on the usual port; no compile errors.

- [ ] **Step 9.2: Scenario — DTC fills up**

1. Log in as an ops user with scheduler access.
2. Open the site-survey-scheduler dashboard.
3. Filter / select a DTC project and confirm DTC availability is loaded.
4. Pick an upcoming weekday with 0 existing DTC surveys. Confirm all 6 slots (10 AM–4 PM) are visible.
5. Book 3 surveys on that day via the scheduler (drag-drop or modal).
6. Re-open the calendar. The day should now show the gray "Full" pill.
7. Click that day. The schedule modal should show the cap banner: "DTC has reached its daily limit of 3 scheduled surveys for this date."
8. Verify the time-slot picker is empty (no clickable slots) and the 3 booked entries render as events in the cell.

- [ ] **Step 9.3: Scenario — Cancel frees a slot**

1. Cancel one of the 3 bookings from Step 9.2 (either via the scheduler or directly in Zuper).
2. Reload the scheduler page.
3. The day should now show the green slot-count pill again (3 available).
4. The cap banner should no longer appear when the day is selected.

- [ ] **Step 9.4: Scenario — Colorado Springs is uncapped**

1. Filter / select a Colorado Springs project.
2. Pick a weekday and book 3 surveys for COSP on that day.
3. The day should continue to show available slots — no gray pill, no banner.
4. This confirms the cap is per-office and COSP remains unaffected.

- [ ] **Step 9.5: Scenario — Both offices cap independently**

1. Book 3 surveys at DTC on a day and 3 at Westminster on the same day.
2. Both offices should show the gray "Full" pill for that date when their respective projects are selected.
3. Neither office's cap should leak into the other's view.

---

## Risks & rollback

- **Cap constant drift:** if anyone renames the office display strings used by `CREW_SCHEDULES` in the availability route without updating `OFFICE_DAILY_SURVEY_CAPS`, the cap silently disables. The unit tests assert on the literal keys `"DTC"` and `"Westminster"` to catch this, but a reviewer should check that crew list naming stays consistent.
- **Travel-time block interaction:** the availability route has a travel-time annotation block (lines ~1002–1035) that iterates over `availableSlots`. If you insert the cap block **after** travel-time annotation, the travel code still runs on slots that will then be cleared — wasted work but not incorrect. If you insert **before**, capped days skip travel annotation entirely. Either is fine; prefer "before" for efficiency.
- **Rollback:** all three chunks are independent commits. Reverting chunk 3 leaves the API change intact (UI just ignores `dayCapped`, which is equivalent to silent removal of empty slots). Reverting chunk 2 leaves the helper and tests in place unused. Reverting chunk 1 removes everything. No DB changes to unwind.

## Out of scope (future work)

- Admin UI for editing per-office caps.
- Override role/permission for booking past the cap.
- Applying the same cap to the customer portal (`portal-availability.ts`).
- Equivalent caps on install/inspection/roofing schedulers.
- Historical reporting on how often the cap is hit.
