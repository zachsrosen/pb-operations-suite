# Office Calendar Carousel Slide — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-month calendar slide to the per-location office-performance TV carousel showing all scheduled events (surveys, installs, inspections, service, D&R) filtered by location.

**Architecture:** A shared `calendar-events.ts` utility extracts event-generation and overdue-check logic from the master scheduler into testable pure functions. A new `CalendarSection.tsx` carousel component fetches projects + Zuper jobs client-side, filters by location, and renders events in a CSS Grid month view with per-day repeated pills for multi-day installs.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5, Tailwind v4, React Query v5, existing `/api/projects` and `/api/zuper/jobs/by-category` endpoints.

**Spec:** `docs/superpowers/specs/2026-04-10-office-calendar-slide-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/calendar-events.ts` | Pure utility: types (`CalendarEvent`, `RawApiProject`, `ZuperCategoryJob`), `toCalendarProject` transform (API→clean shape), event generation from projects, event generation from Zuper jobs, overdue check, customer name extraction, assignee formatting, multi-day expansion to per-day pills |
| Create | `src/__tests__/calendar-events.test.ts` | Unit tests for all `calendar-events.ts` exports |
| Create | `src/app/dashboards/office-performance/[location]/CalendarSection.tsx` | Carousel slide component: fetches data, filters by location, renders month grid + event pills + legend |
| Modify | `src/lib/office-performance-types.ts:182` | Add `"calendar"` to `CarouselSection` union, `CAROUSEL_SECTIONS`, `SECTION_COLORS`, `SECTION_LABELS` |
| Modify | `src/lib/query-keys.ts:98` | Add `officeCalendar` query key namespace after `goalsPipeline` |
| Modify | `src/app/dashboards/office-performance/[location]/OfficeCarousel.tsx:21-24,159-213` | Import `CalendarSection`, add `"calendar"` render case |

---

## Chunk 1: Calendar Events Utility + Tests

### Task 1: Types and constants in `calendar-events.ts`

**Files:**
- Create: `src/lib/calendar-events.ts`

- [ ] **Step 1: Create the types file with all exports stubbed**

Create `src/lib/calendar-events.ts` with these types and constants. All functions are stubbed as `throw new Error("not implemented")` — they get filled in by subsequent tasks.

```typescript
// src/lib/calendar-events.ts
//
// Shared calendar-event generation logic extracted from the master scheduler.
// Used by the office-performance calendar carousel slide and potentially
// by any future calendar views.

import { normalizeLocation } from "@/lib/locations";
import type { CanonicalLocation } from "@/lib/locations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event types matching the master scheduler's event taxonomy */
export type CalendarEventType =
  | "survey"
  | "survey-complete"
  | "construction"
  | "construction-complete"
  | "inspection"
  | "inspection-pass"
  | "inspection-fail"
  | "rtb"
  | "blocked"
  | "service"
  | "dnr";

/** A single calendar event positioned on a date */
export interface CalendarEvent {
  id: string;
  projectId: string;
  name: string;
  date: string;           // YYYY-MM-DD start date
  days: number;           // Duration (1 for single-day, N for multi-day construction)
  eventType: CalendarEventType;
  assignee: string;
  isCompleted: boolean;
  isOverdue: boolean;
  isFailed: boolean;
  amount: number;
}

/**
 * A CalendarEvent expanded into per-day pills for rendering.
 * Multi-day events become multiple DayPill entries (one per day).
 */
export interface DayPill extends CalendarEvent {
  /** 1-indexed day within the multi-day span (e.g., 1 for D1/3) */
  dayIndex: number;
  /** Total days in the span (e.g., 3 for D1/3) */
  totalDays: number;
  /** True for day 1 (shows full info), false for continuation pills */
  isFirstDay: boolean;
}

/** Minimal project shape for event generation (clean, testable interface) */
export interface CalendarProject {
  id: string;
  name: string;
  location: string;
  amount: number;
  stage: string;
  crew: string | null;
  daysInstall: number;
  scheduleDate: string | null;
  constructionScheduleDate: string | null;
  inspectionScheduleDate: string | null;
  surveyScheduleDate: string | null;
  surveyCompleted: string | null;
  constructionCompleted: string | null;
  inspectionCompleted: string | null;
  inspectionStatus: string | null;
  zuperScheduledStart?: string | null;
  zuperScheduledEnd?: string | null;
  zuperJobCategory?: string | null;
}

/**
 * Shape of projects as returned by /api/projects?context=scheduling.
 * This is the `Project` type from hubspot.ts — camelCase field names.
 * Only the fields we actually use are listed here; the API returns more.
 */
export interface RawApiProject {
  id: number | string;
  name: string;
  pbLocation: string;
  amount: number;
  stage: string;
  installCrew: string;
  expectedDaysForInstall: number;
  daysForInstallers: number;
  constructionScheduleDate: string | null;
  inspectionScheduleDate: string | null;
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  constructionCompleteDate: string | null;
  inspectionPassDate: string | null;
  finalInspectionStatus: string | null;
  // Zuper-linked fields (may not be present on all projects)
  zuperScheduledStart?: string | null;
  zuperScheduledEnd?: string | null;
  zuperJobCategory?: string | null;
}

/** Map the raw API project to the clean CalendarProject interface */
export function toCalendarProject(p: RawApiProject): CalendarProject {
  // Derive scheduleDate (same logic as scheduler's transformProject)
  const stage = (p.stage || "").toLowerCase();
  let scheduleDate: string | null = null;
  if (stage.includes("survey")) {
    scheduleDate = p.siteSurveyScheduleDate || null;
  } else if (stage.includes("inspection")) {
    scheduleDate = p.inspectionScheduleDate || null;
  } else {
    scheduleDate = p.constructionScheduleDate || null;
  }

  return {
    id: String(p.id),
    name: p.name || "",
    location: p.pbLocation || "",
    amount: p.amount || 0,
    stage: p.stage || "",
    crew: p.installCrew || null,
    daysInstall: p.daysForInstallers || p.expectedDaysForInstall || 1,
    scheduleDate,
    constructionScheduleDate: p.constructionScheduleDate || null,
    inspectionScheduleDate: p.inspectionScheduleDate || null,
    surveyScheduleDate: p.siteSurveyScheduleDate || null,
    surveyCompleted: p.siteSurveyCompletionDate || null,
    constructionCompleted: p.constructionCompleteDate || null,
    inspectionCompleted: p.inspectionPassDate || null,
    inspectionStatus: p.finalInspectionStatus || null,
    zuperScheduledStart: p.zuperScheduledStart || null,
    zuperScheduledEnd: p.zuperScheduledEnd || null,
    zuperJobCategory: p.zuperJobCategory || null,
  };
}

/** Zuper job shape from /api/zuper/jobs/by-category response */
export interface ZuperCategoryJob {
  jobUid: string;
  title: string;
  categoryName: string;
  categoryUid: string;
  statusName: string;
  statusColor: string;
  dueDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  customerName: string;
  address: string;
  city: string;
  state: string;
  assignedUser: string;
  assignedUsers?: string[];
  teamName: string;
  hubspotDealId: string;
  jobTotal: number;
  createdAt: string;
  workOrderNumber: string;
}

// ---------------------------------------------------------------------------
// Color constants (matching master scheduler exactly)
// ---------------------------------------------------------------------------

export const EVENT_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  survey:                  { border: "border-l-cyan-500",    bg: "bg-cyan-500/15",    text: "text-cyan-300" },
  "survey-complete":       { border: "border-l-cyan-500",    bg: "bg-cyan-500/15",    text: "text-cyan-300" },
  construction:            { border: "border-l-blue-500",    bg: "bg-blue-500/15",    text: "text-blue-300" },
  "construction-complete": { border: "border-l-blue-500",    bg: "bg-blue-500/15",    text: "text-blue-300" },
  inspection:              { border: "border-l-violet-500",  bg: "bg-violet-500/15",  text: "text-violet-300" },
  "inspection-pass":       { border: "border-l-violet-500",  bg: "bg-violet-500/15",  text: "text-violet-300" },
  "inspection-fail":       { border: "border-l-amber-500",   bg: "bg-amber-900/70",   text: "text-amber-200" },
  rtb:                     { border: "border-l-emerald-500", bg: "bg-emerald-500/15", text: "text-emerald-300" },
  blocked:                 { border: "border-l-yellow-500",  bg: "bg-yellow-500/15",  text: "text-yellow-300" },
  service:                 { border: "border-l-purple-500",  bg: "bg-purple-500/15",  text: "text-purple-300" },
  dnr:                     { border: "border-l-amber-500",   bg: "bg-amber-500/15",   text: "text-amber-300" },
};

/** Legend items for the bottom of the calendar slide */
export const LEGEND_ITEMS: { label: string; dotColor: string }[] = [
  { label: "Survey",     dotColor: "bg-cyan-500" },
  { label: "Install",    dotColor: "bg-blue-500" },
  { label: "Inspection", dotColor: "bg-violet-500" },
  { label: "RTB",        dotColor: "bg-emerald-500" },
  { label: "Blocked",    dotColor: "bg-yellow-500" },
  { label: "Service",    dotColor: "bg-purple-500" },
  { label: "D&R",        dotColor: "bg-amber-500" },
];

/** Zuper category UIDs — same constants as master scheduler (scheduler/page.tsx:267-276) */
export const SERVICE_CATEGORY_UIDS = [
  "cff6f839-c043-46ee-a09f-8d0e9f363437", // Service Visit
  "8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de", // Service Revisit
].join(",");

export const DNR_CATEGORY_UIDS = [
  "d9d888a1-efc3-4f01-a8d6-c9e867374d71", // Detach
  "43df49e9-3835-48f2-80ca-cc77ad7c3f0d", // Reset
  "a5e54b76-8b79-4cd7-a960-bad53d24e1c5", // D&R Inspection
].join(",");

// ---------------------------------------------------------------------------
// Public API (stubs — implemented in subsequent tasks)
// ---------------------------------------------------------------------------

export function getCustomerName(fullName: string): string {
  throw new Error("not implemented");
}

export function formatAssignee(
  assigneeName: string | null | undefined
): string {
  throw new Error("not implemented");
}

export function isOverdue(
  dateStr: string,
  days: number,
  isCompleted: boolean,
  isConstruction: boolean,
  today?: Date
): boolean {
  throw new Error("not implemented");
}

export function generateProjectEvents(
  projects: CalendarProject[],
  location: CanonicalLocation
): CalendarEvent[] {
  throw new Error("not implemented");
}

export function generateZuperEvents(
  jobs: ZuperCategoryJob[],
  eventType: "service" | "dnr",
  location: CanonicalLocation
): CalendarEvent[] {
  throw new Error("not implemented");
}

export function expandToDayPills(
  events: CalendarEvent[],
  year: number,
  month: number
): Map<string, DayPill[]> {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/calendar-events.ts 2>&1 | head -20`

If there are import errors (e.g., the `CanonicalLocation` type isn't exported from locations), fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/lib/calendar-events.ts
git commit -m "feat(calendar): add calendar-events.ts types, constants, and function stubs"
```

---

### Task 2: Pure helper functions — `getCustomerName`, `formatAssignee`, `isOverdue`, `toCalendarProject`

**Files:**
- Modify: `src/lib/calendar-events.ts` (replace the three stubs)
- Create: `src/__tests__/calendar-events.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/calendar-events.test.ts`:

```typescript
import {
  getCustomerName,
  formatAssignee,
  isOverdue,
  toCalendarProject,
  type RawApiProject,
} from "@/lib/calendar-events";

describe("getCustomerName", () => {
  it("extracts customer name from pipe-delimited string", () => {
    expect(getCustomerName("PROJ-001 | Smith")).toBe("Smith");
  });

  it("returns full name when no pipe delimiter", () => {
    expect(getCustomerName("John Smith")).toBe("John Smith");
  });

  it("handles empty string", () => {
    expect(getCustomerName("")).toBe("");
  });

  it("handles multiple pipes — takes second segment only", () => {
    expect(getCustomerName("A | B | C")).toBe("B");
  });
});

describe("formatAssignee", () => {
  it("formats first name + last initial", () => {
    expect(formatAssignee("John Doe")).toBe("John D.");
  });

  it("returns single name as-is", () => {
    expect(formatAssignee("John")).toBe("John");
  });

  it("handles null/undefined as empty string", () => {
    expect(formatAssignee(null)).toBe("");
    expect(formatAssignee(undefined)).toBe("");
  });

  it("formats multi-word names (crew names use p.crew directly, not this function)", () => {
    expect(formatAssignee("DTC Alpha")).toBe("DTC A.");
  });

  it("trims whitespace", () => {
    expect(formatAssignee("  Jane Smith  ")).toBe("Jane S.");
  });
});

describe("isOverdue", () => {
  // Fix "today" to 2026-04-11 for deterministic tests
  const today = new Date(2026, 3, 11); // April 11, 2026
  today.setHours(0, 0, 0, 0);

  it("returns false for completed events", () => {
    expect(isOverdue("2026-04-01", 1, true, false, today)).toBe(false);
  });

  it("survey: not overdue on its scheduled day", () => {
    expect(isOverdue("2026-04-11", 1, false, false, today)).toBe(false);
  });

  it("survey: overdue the day after", () => {
    expect(isOverdue("2026-04-10", 1, false, false, today)).toBe(true);
  });

  it("construction 3-day: not overdue during the span", () => {
    // Starts Apr 9, 3 days → end date = Apr 9 + ceil(3) = Apr 12
    // Apr 12 < Apr 11? No → not overdue
    expect(isOverdue("2026-04-09", 3, false, true, today)).toBe(false);
  });

  it("construction 3-day: overdue the day after span ends", () => {
    // Starts Apr 7, 3 days → end date = Apr 7 + 3 = Apr 10
    // Apr 10 < Apr 11? Yes → overdue
    expect(isOverdue("2026-04-07", 3, false, true, today)).toBe(true);
  });

  it("construction 1-day: not overdue same day", () => {
    // Starts Apr 10, 1 day → end date = Apr 10 + 1 = Apr 11
    // Apr 11 < Apr 11? No → not overdue
    expect(isOverdue("2026-04-10", 1, false, true, today)).toBe(false);
  });

  it("construction 1-day: overdue the next day", () => {
    // Starts Apr 9, 1 day → end date = Apr 9 + 1 = Apr 10
    // Apr 10 < Apr 11? Yes → overdue
    expect(isOverdue("2026-04-09", 1, false, true, today)).toBe(true);
  });
});

describe("toCalendarProject", () => {
  const baseRaw: RawApiProject = {
    id: 12345,
    name: "PB-001 | Smith Residence",
    pbLocation: "Westminster",
    amount: 45000,
    stage: "Construction",
    installCrew: "DTC Alpha",
    expectedDaysForInstall: 3,
    daysForInstallers: 2,
    constructionScheduleDate: "2026-04-14",
    inspectionScheduleDate: null,
    siteSurveyScheduleDate: "2026-04-07",
    siteSurveyCompletionDate: "2026-04-07",
    constructionCompleteDate: null,
    inspectionPassDate: null,
    finalInspectionStatus: null,
  };

  it("maps API Project fields to CalendarProject fields", () => {
    const result = toCalendarProject(baseRaw);
    expect(result.id).toBe("12345");
    expect(result.location).toBe("Westminster");
    expect(result.crew).toBe("DTC Alpha");
    expect(result.surveyScheduleDate).toBe("2026-04-07");
    expect(result.surveyCompleted).toBe("2026-04-07");
    expect(result.constructionScheduleDate).toBe("2026-04-14");
    expect(result.constructionCompleted).toBeNull();
    expect(result.daysInstall).toBe(2); // prefers daysForInstallers
  });

  it("derives scheduleDate from stage — construction stage uses constructionScheduleDate", () => {
    const result = toCalendarProject(baseRaw);
    expect(result.scheduleDate).toBe("2026-04-14");
  });

  it("derives scheduleDate from stage — survey stage uses siteSurveyScheduleDate", () => {
    const raw: RawApiProject = { ...baseRaw, stage: "Site Survey" };
    const result = toCalendarProject(raw);
    expect(result.scheduleDate).toBe("2026-04-07");
  });

  it("derives scheduleDate from stage — inspection stage uses inspectionScheduleDate", () => {
    const raw: RawApiProject = {
      ...baseRaw,
      stage: "Inspection",
      inspectionScheduleDate: "2026-04-20",
    };
    const result = toCalendarProject(raw);
    expect(result.scheduleDate).toBe("2026-04-20");
  });

  it("maps inspectionPassDate to inspectionCompleted", () => {
    const raw: RawApiProject = {
      ...baseRaw,
      inspectionPassDate: "2026-04-20",
    };
    const result = toCalendarProject(raw);
    expect(result.inspectionCompleted).toBe("2026-04-20");
  });

  it("maps finalInspectionStatus to inspectionStatus", () => {
    const raw: RawApiProject = {
      ...baseRaw,
      finalInspectionStatus: "Fail",
    };
    const result = toCalendarProject(raw);
    expect(result.inspectionStatus).toBe("Fail");
  });

  it("falls back to expectedDaysForInstall when daysForInstallers is 0", () => {
    const raw: RawApiProject = {
      ...baseRaw,
      daysForInstallers: 0,
      expectedDaysForInstall: 4,
    };
    const result = toCalendarProject(raw);
    expect(result.daysInstall).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/calendar-events.test.ts --no-coverage 2>&1 | tail -15`

Expected: `getCustomerName`, `formatAssignee`, and `isOverdue` tests FAIL with "not implemented". `toCalendarProject` tests should PASS (it's already implemented in the types file, not a stub).

- [ ] **Step 3: Implement the three stub functions**

Replace the three stubs in `src/lib/calendar-events.ts`:

```typescript
export function getCustomerName(fullName: string): string {
  return fullName.split(" | ")[1] || fullName;
}

export function formatAssignee(
  assigneeName: string | null | undefined
): string {
  if (!assigneeName) return "";
  const trimmed = assigneeName.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function isOverdue(
  dateStr: string,
  days: number,
  isCompleted: boolean,
  isConstruction: boolean,
  today?: Date
): boolean {
  if (isCompleted) return false;
  const todayMidnight = today ? new Date(today) : new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  // Parse YYYY-MM-DD to local midnight
  const [y, m, d] = dateStr.split("-").map(Number);
  const schedMidnight = new Date(y, m - 1, d);
  schedMidnight.setHours(0, 0, 0, 0);

  if (isConstruction) {
    const endDate = new Date(schedMidnight);
    endDate.setDate(schedMidnight.getDate() + Math.ceil(days));
    return endDate < todayMidnight;
  }
  return schedMidnight < todayMidnight;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/calendar-events.test.ts --no-coverage 2>&1 | tail -15`

Expected: All 18 tests PASS (11 helper + 7 toCalendarProject).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-events.ts src/__tests__/calendar-events.test.ts
git commit -m "feat(calendar): implement getCustomerName, formatAssignee, isOverdue, toCalendarProject with tests"
```

---

### Task 3: `generateProjectEvents` — project → CalendarEvent[]

**Files:**
- Modify: `src/lib/calendar-events.ts` (replace the `generateProjectEvents` stub)
- Modify: `src/__tests__/calendar-events.test.ts` (add test suite)

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/calendar-events.test.ts`:

```typescript
import {
  getCustomerName,
  formatAssignee,
  isOverdue,
  generateProjectEvents,
  type CalendarProject,
} from "@/lib/calendar-events";

// ... existing tests ...

describe("generateProjectEvents", () => {
  const baseProject: CalendarProject = {
    id: "deal-1",
    name: "PB-001 | Smith Residence",
    location: "Westminster",
    amount: 45000,
    stage: "construction",
    crew: "DTC Alpha",
    daysInstall: 3,
    scheduleDate: null,
    constructionScheduleDate: "2026-04-14",
    inspectionScheduleDate: null,
    surveyScheduleDate: "2026-04-07",
    surveyCompleted: "2026-04-07",
    constructionCompleted: null,
    inspectionCompleted: null,
    inspectionStatus: null,
    zuperScheduledStart: null,
    zuperScheduledEnd: null,
    zuperJobCategory: null,
  };

  it("generates survey-complete + construction events", () => {
    const events = generateProjectEvents([baseProject], "Westminster");
    expect(events).toHaveLength(2);

    const survey = events.find(e => e.eventType === "survey-complete");
    expect(survey).toBeDefined();
    expect(survey!.date).toBe("2026-04-07");
    expect(survey!.days).toBe(1);
    expect(survey!.isCompleted).toBe(true);
    expect(survey!.name).toBe("Smith Residence");

    const construction = events.find(e => e.eventType === "construction");
    expect(construction).toBeDefined();
    expect(construction!.date).toBe("2026-04-14");
    expect(construction!.days).toBe(3);
    expect(construction!.assignee).toBe("DTC Alpha");
  });

  it("filters by location — excludes non-matching projects", () => {
    const events = generateProjectEvents([baseProject], "Centennial");
    expect(events).toHaveLength(0);
  });

  it("prefers Zuper start date for construction when zuperJobCategory is construction", () => {
    const withZuper: CalendarProject = {
      ...baseProject,
      zuperScheduledStart: "2026-04-15T07:00:00Z",
      zuperJobCategory: "construction",
    };
    const events = generateProjectEvents([withZuper], "Westminster");
    const construction = events.find(e => e.eventType === "construction");
    expect(construction!.date).toBe("2026-04-15");
  });

  it("ignores Zuper date when zuperJobCategory is not construction", () => {
    const withZuper: CalendarProject = {
      ...baseProject,
      zuperScheduledStart: "2026-04-15T07:00:00Z",
      zuperJobCategory: "survey",
    };
    const events = generateProjectEvents([withZuper], "Westminster");
    const construction = events.find(e => e.eventType === "construction");
    expect(construction!.date).toBe("2026-04-14"); // HubSpot date
  });

  it("generates inspection-fail event", () => {
    const proj: CalendarProject = {
      ...baseProject,
      inspectionScheduleDate: "2026-04-20",
      inspectionCompleted: "2026-04-20",
      inspectionStatus: "Fail",
    };
    const events = generateProjectEvents([proj], "Westminster");
    const insp = events.find(e => e.eventType === "inspection-fail");
    expect(insp).toBeDefined();
    expect(insp!.isFailed).toBe(true);
  });

  it("generates rtb fallback when stage is rtb with scheduleDate but no constructionScheduleDate", () => {
    const proj: CalendarProject = {
      ...baseProject,
      stage: "rtb",
      constructionScheduleDate: null,
      scheduleDate: "2026-04-21",
    };
    const events = generateProjectEvents([proj], "Westminster");
    const rtb = events.find(e => e.eventType === "rtb");
    expect(rtb).toBeDefined();
    expect(rtb!.date).toBe("2026-04-21");
  });

  it("normalizes DTC location to Centennial", () => {
    const proj: CalendarProject = {
      ...baseProject,
      location: "DTC",
    };
    const events = generateProjectEvents([proj], "Centennial");
    expect(events.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx jest src/__tests__/calendar-events.test.ts --no-coverage --testNamePattern="generateProjectEvents" 2>&1 | tail -15`

Expected: All new tests FAIL with "not implemented".

- [ ] **Step 3: Implement `generateProjectEvents`**

Replace the `generateProjectEvents` stub in `src/lib/calendar-events.ts`:

```typescript
export function generateProjectEvents(
  projects: CalendarProject[],
  location: CanonicalLocation
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const seenKeys = new Set<string>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const p of projects) {
    // Filter by location
    const projLocation = normalizeLocation(p.location);
    if (projLocation !== location) continue;

    const customerName = getCustomerName(p.name);

    // -- Construction --
    const zuperIsConstruction = p.zuperJobCategory === "construction";
    const zuperStartDate = zuperIsConstruction && p.zuperScheduledStart
      ? p.zuperScheduledStart.slice(0, 10)
      : null;
    const constructionDate = zuperStartDate || p.constructionScheduleDate;
    if (constructionDate) {
      const done = !!p.constructionCompleted;
      const days = p.daysInstall || 1;
      const key = `${p.id}-construction`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        events.push({
          id: key,
          projectId: p.id,
          name: customerName,
          date: constructionDate,
          days,
          eventType: done ? "construction-complete" : "construction",
          assignee: p.crew || "",
          isCompleted: done,
          isOverdue: isOverdue(constructionDate, days, done, true, today),
          isFailed: false,
          amount: p.amount,
        });
      }
    }

    // -- Inspection --
    if (p.inspectionScheduleDate) {
      const done = !!p.inspectionCompleted;
      const failed = !!(p.inspectionStatus && p.inspectionStatus.toLowerCase().includes("fail"));
      const key = `${p.id}-inspection`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        events.push({
          id: key,
          projectId: p.id,
          name: customerName,
          date: p.inspectionScheduleDate,
          days: 1,
          eventType: done ? (failed ? "inspection-fail" : "inspection-pass") : "inspection",
          assignee: "",
          isCompleted: done,
          isOverdue: isOverdue(p.inspectionScheduleDate, 1, done, false, today),
          isFailed: failed,
          amount: p.amount,
        });
      }
    }

    // -- Survey --
    if (p.surveyScheduleDate) {
      const done = !!p.surveyCompleted;
      const key = `${p.id}-survey`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        events.push({
          id: key,
          projectId: p.id,
          name: customerName,
          date: p.surveyScheduleDate,
          days: 1,
          eventType: done ? "survey-complete" : "survey",
          assignee: "",
          isCompleted: done,
          isOverdue: isOverdue(p.surveyScheduleDate, 1, done, false, today),
          isFailed: false,
          amount: p.amount,
        });
      }
    }

    // -- RTB/Blocked fallback --
    const normalizedStage = p.stage?.toLowerCase();
    if (
      p.scheduleDate &&
      (normalizedStage === "rtb" || normalizedStage === "blocked" ||
       normalizedStage === "ready to build" || normalizedStage === "rtb - blocked") &&
      !seenKeys.has(`${p.id}-construction`)
    ) {
      const done = !!p.constructionCompleted;
      const days = p.daysInstall || 1;
      const key = `${p.id}-construction`;
      seenKeys.add(key);
      const stage = (normalizedStage === "blocked" || normalizedStage === "rtb - blocked")
        ? "blocked" : "rtb";
      events.push({
        id: key,
        projectId: p.id,
        name: customerName,
        date: p.scheduleDate,
        days,
        eventType: done ? "construction-complete" : stage,
        assignee: p.crew || "",
        isCompleted: done,
        isOverdue: isOverdue(p.scheduleDate, days, done, true, today),
        isFailed: false,
        amount: p.amount,
      });
    }
  }

  return events;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/calendar-events.test.ts --no-coverage 2>&1 | tail -20`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-events.ts src/__tests__/calendar-events.test.ts
git commit -m "feat(calendar): implement generateProjectEvents with location filtering and overdue checks"
```

---

### Task 4: `generateZuperEvents` — Zuper jobs → CalendarEvent[]

**Files:**
- Modify: `src/lib/calendar-events.ts` (replace stub)
- Modify: `src/__tests__/calendar-events.test.ts` (add test suite)

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/calendar-events.test.ts`:

```typescript
import {
  // ... existing imports ...
  generateZuperEvents,
  type ZuperCategoryJob,
} from "@/lib/calendar-events";

// ... existing tests ...

describe("generateZuperEvents", () => {
  const baseJob: ZuperCategoryJob = {
    jobUid: "zuper-1",
    title: "Service Visit — Jones",
    categoryName: "Service Visit",
    categoryUid: "cff6f839-c043-46ee-a09f-8d0e9f363437",
    statusName: "Started",
    statusColor: "#00ff00",
    dueDate: "2026-04-15",
    scheduledStart: "2026-04-15T14:00:00Z",
    scheduledEnd: "2026-04-15T16:00:00Z",
    customerName: "Jones",
    address: "123 Main St, Westminster, CO",
    city: "Westminster",
    state: "CO",
    assignedUser: "Mike Thompson",
    assignedUsers: ["Mike Thompson"],
    teamName: "Westminster Team",
    hubspotDealId: "12345",
    jobTotal: 500,
    createdAt: "2026-04-10T10:00:00Z",
    workOrderNumber: "WO-001",
  };

  it("generates a service event from a Zuper job", () => {
    const events = generateZuperEvents([baseJob], "service", "Westminster");
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("service");
    expect(events[0].date).toBe("2026-04-15");
    expect(events[0].name).toBe("Jones");
    expect(events[0].assignee).toBe("Mike T.");
  });

  it("filters by location — uses teamName normalization", () => {
    const events = generateZuperEvents([baseJob], "service", "Centennial");
    expect(events).toHaveLength(0);
  });

  it("uses dueDate when scheduledStart is null", () => {
    const job: ZuperCategoryJob = {
      ...baseJob,
      scheduledStart: null,
      scheduledEnd: null,
    };
    const events = generateZuperEvents([job], "service", "Westminster");
    expect(events[0].date).toBe("2026-04-15");
  });

  it("skips jobs with no date", () => {
    const job: ZuperCategoryJob = {
      ...baseJob,
      scheduledStart: null,
      scheduledEnd: null,
      dueDate: "",
    };
    const events = generateZuperEvents([job], "service", "Westminster");
    expect(events).toHaveLength(0);
  });

  it("generates dnr events with correct eventType", () => {
    const events = generateZuperEvents([baseJob], "dnr", "Westminster");
    expect(events[0].eventType).toBe("dnr");
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx jest src/__tests__/calendar-events.test.ts --no-coverage --testNamePattern="generateZuperEvents" 2>&1 | tail -15`

Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement `generateZuperEvents`**

Replace the `generateZuperEvents` stub in `src/lib/calendar-events.ts`:

```typescript
export function generateZuperEvents(
  jobs: ZuperCategoryJob[],
  eventType: "service" | "dnr",
  location: CanonicalLocation
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const job of jobs) {
    // Derive date: prefer scheduledStart, fall back to dueDate
    const dateStr = job.scheduledStart
      ? job.scheduledStart.slice(0, 10)
      : job.dueDate
        ? job.dueDate.slice(0, 10)
        : null;
    if (!dateStr) continue;

    // Filter by location: check teamName then city
    const jobLocation =
      normalizeLocation(job.teamName) ||
      normalizeLocation(job.city);
    if (jobLocation !== location) continue;

    // Resolve assignee
    const rawAssignee =
      (Array.isArray(job.assignedUsers) && job.assignedUsers.length > 0)
        ? job.assignedUsers[0]
        : job.assignedUser || "";

    events.push({
      id: `zuper-${job.jobUid}`,
      projectId: job.hubspotDealId || job.jobUid,
      name: job.customerName || job.title || "Untitled",
      date: dateStr,
      days: 1,
      eventType,
      assignee: formatAssignee(rawAssignee),
      isCompleted: false, // Zuper status parsing is out of scope — always show as active
      isOverdue: false,
      isFailed: false,
      amount: job.jobTotal || 0,
    });
  }

  return events;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/calendar-events.test.ts --no-coverage 2>&1 | tail -20`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-events.ts src/__tests__/calendar-events.test.ts
git commit -m "feat(calendar): implement generateZuperEvents for service and D&R jobs"
```

---

### Task 5: `expandToDayPills` — multi-day expansion + month grid bucketing

**Files:**
- Modify: `src/lib/calendar-events.ts` (replace stub)
- Modify: `src/__tests__/calendar-events.test.ts` (add test suite)

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/calendar-events.test.ts`:

```typescript
import {
  // ... existing imports ...
  expandToDayPills,
  type CalendarEvent,
  type DayPill,
} from "@/lib/calendar-events";

// ... existing tests ...

describe("expandToDayPills", () => {
  const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: "deal-1-construction",
    projectId: "deal-1",
    name: "Smith Residence",
    date: "2026-04-14",
    days: 3,
    eventType: "construction",
    assignee: "DTC Alpha",
    isCompleted: false,
    isOverdue: false,
    isFailed: false,
    amount: 45000,
    ...overrides,
  });

  it("expands a 3-day event into 3 pills on consecutive days", () => {
    const result = expandToDayPills([makeEvent()], 2026, 4);
    // April 14, 15, 16
    const apr14 = result.get("2026-04-14") || [];
    const apr15 = result.get("2026-04-15") || [];
    const apr16 = result.get("2026-04-16") || [];

    expect(apr14).toHaveLength(1);
    expect(apr14[0].dayIndex).toBe(1);
    expect(apr14[0].totalDays).toBe(3);
    expect(apr14[0].isFirstDay).toBe(true);

    expect(apr15).toHaveLength(1);
    expect(apr15[0].dayIndex).toBe(2);
    expect(apr15[0].isFirstDay).toBe(false);

    expect(apr16).toHaveLength(1);
    expect(apr16[0].dayIndex).toBe(3);
    expect(apr16[0].isFirstDay).toBe(false);
  });

  it("clips pills that fall outside the visible month", () => {
    // Event starts April 29, 5 days → Apr 29, 30, May 1, 2, 3
    const event = makeEvent({ date: "2026-04-29", days: 5 });
    const result = expandToDayPills([event], 2026, 4);
    // Only April 29, 30 should appear
    expect(result.get("2026-04-29")).toHaveLength(1);
    expect(result.get("2026-04-30")).toHaveLength(1);
    expect(result.has("2026-05-01")).toBe(false);
  });

  it("includes continuation days from events starting in previous month", () => {
    // Event starts March 30, 4 days → Mar 30, 31, Apr 1, 2
    const event = makeEvent({ date: "2026-03-30", days: 4 });
    const result = expandToDayPills([event], 2026, 4);
    // Only April 1, 2 should appear (visible month)
    expect(result.has("2026-03-30")).toBe(false);
    expect(result.has("2026-03-31")).toBe(false);
    expect(result.get("2026-04-01")).toHaveLength(1);
    expect(result.get("2026-04-01")![0].dayIndex).toBe(3);
    expect(result.get("2026-04-02")).toHaveLength(1);
    expect(result.get("2026-04-02")![0].dayIndex).toBe(4);
  });

  it("single-day event produces one pill with dayIndex=1, totalDays=1", () => {
    const event = makeEvent({ days: 1 });
    const result = expandToDayPills([event], 2026, 4);
    const pills = result.get("2026-04-14") || [];
    expect(pills).toHaveLength(1);
    expect(pills[0].dayIndex).toBe(1);
    expect(pills[0].totalDays).toBe(1);
    expect(pills[0].isFirstDay).toBe(true);
  });

  it("multiple events on same day stack in the map", () => {
    const event1 = makeEvent({ id: "a", date: "2026-04-14", days: 1 });
    const event2 = makeEvent({
      id: "b",
      date: "2026-04-14",
      days: 1,
      eventType: "survey",
      name: "Jones",
    });
    const result = expandToDayPills([event1, event2], 2026, 4);
    expect(result.get("2026-04-14")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx jest src/__tests__/calendar-events.test.ts --no-coverage --testNamePattern="expandToDayPills" 2>&1 | tail -15`

Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement `expandToDayPills`**

Replace the `expandToDayPills` stub in `src/lib/calendar-events.ts`. Add this helper at the top of the file (before the public functions):

```typescript
/** Add N calendar days to a YYYY-MM-DD string */
function addCalendarDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
```

Then the implementation:

```typescript
export function expandToDayPills(
  events: CalendarEvent[],
  year: number,
  month: number
): Map<string, DayPill[]> {
  const map = new Map<string, DayPill[]>();

  // Visible month boundaries (1-indexed month)
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDate = new Date(year, month, 0); // last day of month
  const lastOfMonth = `${year}-${String(month).padStart(2, "0")}-${String(lastDate.getDate()).padStart(2, "0")}`;

  for (const event of events) {
    const totalDays = Math.max(event.days, 1);

    for (let i = 0; i < totalDays; i++) {
      const dayStr = addCalendarDays(event.date, i);

      // Skip days outside the visible month
      if (dayStr < firstOfMonth || dayStr > lastOfMonth) continue;

      const pill: DayPill = {
        ...event,
        dayIndex: i + 1,
        totalDays,
        isFirstDay: i === 0,
      };

      const existing = map.get(dayStr);
      if (existing) {
        existing.push(pill);
      } else {
        map.set(dayStr, [pill]);
      }
    }
  }

  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/calendar-events.test.ts --no-coverage 2>&1 | tail -20`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-events.ts src/__tests__/calendar-events.test.ts
git commit -m "feat(calendar): implement expandToDayPills for multi-day event rendering"
```

---

## Chunk 2: Carousel Integration + Calendar Component

### Task 6: Wire `"calendar"` into carousel types and query keys

**Files:**
- Modify: `src/lib/office-performance-types.ts:182,184,194,204`
- Modify: `src/lib/query-keys.ts:98`

- [ ] **Step 1: Add `"calendar"` to `CarouselSection` type union**

In `src/lib/office-performance-types.ts`, line 182:

Replace:
```typescript
export type CarouselSection = "teamResults" | "surveys" | "installs" | "inspections" | "allLocations" | "goals" | "pipeline";
```

With:
```typescript
export type CarouselSection = "teamResults" | "surveys" | "installs" | "inspections" | "allLocations" | "goals" | "pipeline" | "calendar";
```

- [ ] **Step 2: Add `"calendar"` to `CAROUSEL_SECTIONS` array (after pipeline, before surveys)**

Replace:
```typescript
export const CAROUSEL_SECTIONS: CarouselSection[] = [
  "teamResults",
  "goals",
  "pipeline",
  "surveys",
  "installs",
  "inspections",
  "allLocations",
];
```

With:
```typescript
export const CAROUSEL_SECTIONS: CarouselSection[] = [
  "teamResults",
  "goals",
  "pipeline",
  "calendar",
  "surveys",
  "installs",
  "inspections",
  "allLocations",
];
```

- [ ] **Step 3: Add `calendar` to `SECTION_COLORS`**

In `SECTION_COLORS`, add `calendar` entry after `pipeline`:

Replace:
```typescript
export const SECTION_COLORS: Record<CarouselSection, string> = {
  teamResults: "#f97316",  // orange
  goals: "#eab308",        // yellow
  pipeline: "#ec4899",     // pink
  surveys: "#3b82f6",      // blue
  installs: "#22c55e",     // green
  inspections: "#06b6d4",  // cyan
  allLocations: "#a855f7", // purple
};
```

With:
```typescript
export const SECTION_COLORS: Record<CarouselSection, string> = {
  teamResults: "#f97316",  // orange
  goals: "#eab308",        // yellow
  pipeline: "#ec4899",     // pink
  calendar: "#14b8a6",     // teal (calendar accent)
  surveys: "#3b82f6",      // blue
  installs: "#22c55e",     // green
  inspections: "#06b6d4",  // cyan
  allLocations: "#a855f7", // purple
};
```

- [ ] **Step 4: Add `calendar` to `SECTION_LABELS`**

Replace:
```typescript
export const SECTION_LABELS: Record<CarouselSection, string> = {
  teamResults: "TEAM RESULTS",
  goals: "MONTHLY GOALS",
  pipeline: "PIPELINE",
  surveys: "SURVEYS",
  installs: "INSTALLS",
  inspections: "INSPECTIONS & QUALITY",
  allLocations: "ALL LOCATIONS",
};
```

With:
```typescript
export const SECTION_LABELS: Record<CarouselSection, string> = {
  teamResults: "TEAM RESULTS",
  goals: "MONTHLY GOALS",
  pipeline: "PIPELINE",
  calendar: "CALENDAR",
  surveys: "SURVEYS",
  installs: "INSTALLS",
  inspections: "INSPECTIONS & QUALITY",
  allLocations: "ALL LOCATIONS",
};
```

- [ ] **Step 5: Add `officeCalendar` query key namespace**

In `src/lib/query-keys.ts`, after the `goalsPipeline` entry (line 98), add:

```typescript
  officeCalendar: {
    root: ["office-calendar"] as const,
    projects: (location: string, month: number, year: number) =>
      [...queryKeys.officeCalendar.root, "projects", location, year, month] as const,
    serviceJobs: (location: string, from: string, to: string) =>
      [...queryKeys.officeCalendar.root, "service-jobs", location, from, to] as const,
    dnrJobs: (location: string, from: string, to: string) =>
      [...queryKeys.officeCalendar.root, "dnr-jobs", location, from, to] as const,
  },
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | grep -i "error" | head -10`

Expected: No type errors from these files. The `OfficeCarousel.tsx` switch has no exhaustive check, so the missing `"calendar"` case won't cause a TS error — it just returns `undefined` for that case until Task 8 adds the handler.

- [ ] **Step 7: Commit**

```bash
git add src/lib/office-performance-types.ts src/lib/query-keys.ts
git commit -m "feat(calendar): add calendar to carousel types, sections, and query keys"
```

---

### Task 7: Build the `CalendarSection` component

**Files:**
- Create: `src/app/dashboards/office-performance/[location]/CalendarSection.tsx`

This is the main rendering component. It fetches data, generates events, and renders the month grid.

- [ ] **Step 1: Create the full component**

Create `src/app/dashboards/office-performance/[location]/CalendarSection.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  generateProjectEvents,
  generateZuperEvents,
  expandToDayPills,
  toCalendarProject,
  EVENT_COLORS,
  LEGEND_ITEMS,
  SERVICE_CATEGORY_UIDS,
  DNR_CATEGORY_UIDS,
  type RawApiProject,
  type ZuperCategoryJob,
  type DayPill,
} from "@/lib/calendar-events";
import type { CanonicalLocation } from "@/lib/locations";

interface CalendarSectionProps {
  location: string; // Canonical location name
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Max visible pills per day cell before showing "+N more" */
const MAX_VISIBLE_PILLS = 3;

// ---------------------------------------------------------------------------
// Data fetching hooks
// ---------------------------------------------------------------------------

function useCalendarData(location: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed

  // Buffered date range for Zuper: prev month start → next month end
  // (wider than visible month so multi-day jobs crossing month boundaries render correctly)
  const fromDate = new Date(year, month - 2, 1); // first of prev month
  const toDate = new Date(year, month + 1, 0);   // last of next month (month is 1-indexed, so month+1 with day 0 = last day of month index `month`)
  const fromStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}-01`;
  const toStr = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}`;

  const projectsQuery = useQuery<{ projects?: RawApiProject[] }>({
    queryKey: queryKeys.officeCalendar.projects(location, month, year),
    queryFn: async () => {
      const res = await fetch("/api/projects?context=scheduling&refresh=true");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const serviceQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.serviceJobs(location, fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: SERVICE_CATEGORY_UIDS,
        from_date: fromStr,
        to_date: toStr,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const dnrQuery = useQuery<{ jobs: ZuperCategoryJob[] }>({
    queryKey: queryKeys.officeCalendar.dnrJobs(location, fromStr, toStr),
    queryFn: async () => {
      const params = new URLSearchParams({
        categories: DNR_CATEGORY_UIDS,
        from_date: fromStr,
        to_date: toStr,
      });
      const res = await fetch(`/api/zuper/jobs/by-category?${params}`);
      if (!res.ok) return { jobs: [] };
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  return { projectsQuery, serviceQuery, dnrQuery, year, month };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventPill({ pill }: { pill: DayPill }) {
  const baseType = pill.eventType.replace(/-complete$/, "").replace(/-pass$/, "").replace(/-fail$/, "");
  const colors = EVENT_COLORS[pill.eventType] || EVENT_COLORS[baseType] || EVENT_COLORS.survey;

  const isCompleted = pill.isCompleted;
  const isFailed = pill.isFailed;
  const isOverdue = pill.isOverdue;

  // Continuation pill for multi-day events (day 2+)
  if (!pill.isFirstDay) {
    return (
      <div
        className={`
          h-5 rounded-sm border-l-2 flex items-center px-1.5
          ${colors.border} ${colors.bg}
          ${isCompleted ? "opacity-30" : ""}
        `}
      >
        <span className={`text-[10px] font-medium ${colors.text} ${isCompleted ? "opacity-70" : ""}`}>
          D{pill.dayIndex}/{pill.totalDays}
        </span>
      </div>
    );
  }

  // Day label for multi-day first day
  const dayLabel = pill.totalDays > 1 ? ` D1/${pill.totalDays}` : "";

  return (
    <div
      className={`
        rounded-sm border-l-2 px-1.5 py-0.5 min-h-[28px]
        ${colors.border} ${colors.bg}
        ${isCompleted ? "opacity-30" : ""}
        ${isOverdue ? "opacity-60 ring-1 ring-red-500" : ""}
        ${isFailed ? "ring-1 ring-amber-500" : ""}
      `}
    >
      <div className={`text-[11px] font-medium leading-tight truncate ${colors.text} ${isCompleted ? "opacity-70" : ""} ${isFailed ? "line-through" : ""}`}>
        {pill.name} — {formatEventLabel(pill.eventType)}{dayLabel}
      </div>
      {pill.assignee && (
        <div className="text-[9px] text-slate-400 leading-tight truncate">
          {pill.assignee}
        </div>
      )}
    </div>
  );
}

function formatEventLabel(eventType: string): string {
  switch (eventType) {
    case "survey": case "survey-complete": return "Survey";
    case "construction": case "construction-complete": return "Install";
    case "inspection": case "inspection-pass": return "Inspection";
    case "inspection-fail": return "Insp Fail";
    case "rtb": return "RTB";
    case "blocked": return "Blocked";
    case "service": return "Service";
    case "dnr": return "D&R";
    default: return eventType;
  }
}

function DayCell({
  dateStr,
  dayNum,
  isToday,
  isWeekend,
  isOutsideMonth,
  pills,
}: {
  dateStr: string;
  dayNum: number;
  isToday: boolean;
  isWeekend: boolean;
  isOutsideMonth: boolean;
  pills: DayPill[];
}) {
  if (isOutsideMonth) {
    return <div className="min-h-[80px] bg-white/[0.01] rounded" />;
  }

  const visible = pills.slice(0, MAX_VISIBLE_PILLS);
  const overflow = pills.length - MAX_VISIBLE_PILLS;

  return (
    <div className={`min-h-[80px] p-1 rounded border border-white/5 overflow-hidden ${isToday ? "bg-orange-500/10 ring-1 ring-orange-500/50" : "bg-white/[0.02]"}`}>
      <div className={`text-[10px] font-semibold mb-0.5 ${isToday ? "text-orange-400" : isWeekend ? "text-slate-600" : "text-slate-400"}`}>
        {dayNum}
      </div>
      <div className="flex flex-col gap-0.5">
        {visible.map((pill, i) => (
          <EventPill key={`${pill.id}-${pill.dayIndex}-${i}`} pill={pill} />
        ))}
        {overflow > 0 && (
          <div className="text-[9px] text-slate-500 pl-1">+{overflow} more</div>
        )}
      </div>
    </div>
  );
}

function SummaryBar({ pills }: { pills: Map<string, DayPill[]> }) {
  // Count unique events by base type (dedupe by event ID)
  const counts = new Map<string, Set<string>>();
  for (const dayPills of pills.values()) {
    for (const pill of dayPills) {
      if (pill.isFirstDay || pill.totalDays === 1) {
        const base = pill.eventType.replace(/-complete$/, "").replace(/-pass$/, "").replace(/-fail$/, "");
        if (!counts.has(base)) counts.set(base, new Set());
        counts.get(base)!.add(pill.id);
      }
    }
  }

  const items: { label: string; count: number; dotColor: string }[] = [];
  for (const legend of LEGEND_ITEMS) {
    const key = legend.label.toLowerCase().replace("install", "construction").replace("d&r", "dnr");
    const count = counts.get(key)?.size || 0;
    if (count > 0) {
      items.push({ label: legend.label, count, dotColor: legend.dotColor });
    }
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-sm text-slate-300">
          <span className={`w-2 h-2 rounded-full ${item.dotColor}`} />
          {item.count} {item.label}{item.count !== 1 ? "s" : ""}
        </span>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {LEGEND_ITEMS.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className={`w-2 h-2 rounded-full ${item.dotColor}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CalendarSection({ location }: CalendarSectionProps) {
  const { projectsQuery, serviceQuery, dnrQuery, year, month } = useCalendarData(location);

  const isLoading = projectsQuery.isLoading;

  // Generate all events
  const allPills = useMemo(() => {
    const rawProjects = projectsQuery.data?.projects || [];
    const projects = rawProjects.map(toCalendarProject);
    const serviceJobs = serviceQuery.data?.jobs || [];
    const dnrJobs = dnrQuery.data?.jobs || [];

    const loc = location as CanonicalLocation;
    const projectEvents = generateProjectEvents(projects, loc);
    const serviceEvents = generateZuperEvents(serviceJobs, "service", loc);
    const dnrEvents = generateZuperEvents(dnrJobs, "dnr", loc);

    const allEvents = [...projectEvents, ...serviceEvents, ...dnrEvents];
    return expandToDayPills(allEvents, year, month);
  }, [projectsQuery.data, serviceQuery.data, dnrQuery.data, location, year, month]);

  // Build the month grid
  const grid = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const startDow = firstDay.getDay(); // 0=Sun
    const daysInMonth = new Date(year, month, 0).getDate();

    const cells: {
      dateStr: string;
      dayNum: number;
      isToday: boolean;
      isWeekend: boolean;
      isOutsideMonth: boolean;
    }[] = [];

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Leading empty cells for days before the 1st
    for (let i = 0; i < startDow; i++) {
      cells.push({
        dateStr: "",
        dayNum: 0,
        isToday: false,
        isWeekend: i === 0 || i === 6,
        isOutsideMonth: true,
      });
    }

    // Actual month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = (startDow + d - 1) % 7;
      cells.push({
        dateStr,
        dayNum: d,
        isToday: dateStr === todayStr,
        isWeekend: dow === 0 || dow === 6,
        isOutsideMonth: false,
      });
    }

    // Trailing empty cells to complete the last week
    const trailing = (7 - (cells.length % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      const dow = (cells.length) % 7;
      cells.push({
        dateStr: "",
        dayNum: 0,
        isToday: false,
        isWeekend: dow === 0 || dow === 6,
        isOutsideMonth: true,
      });
    }

    return cells;
  }, [year, month]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-slate-400 text-sm">Loading calendar...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col px-6 py-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">
          {MONTH_NAMES[month]} {year}
        </h2>
        <SummaryBar pills={allPills} />
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1">
        {DAY_HEADERS.map((day) => (
          <div key={day} className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-1 flex-1">
        {grid.map((cell, i) => (
          <DayCell
            key={cell.dateStr || `empty-${i}`}
            dateStr={cell.dateStr}
            dayNum={cell.dayNum}
            isToday={cell.isToday}
            isWeekend={cell.isWeekend}
            isOutsideMonth={cell.isOutsideMonth}
            pills={cell.dateStr ? (allPills.get(cell.dateStr) || []) : []}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="pt-1">
        <Legend />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i "error" | head -10`

Expected: May still show the `OfficeCarousel.tsx` switch exhaustiveness error for the missing `"calendar"` case. No errors from `CalendarSection.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/office-performance/\[location\]/CalendarSection.tsx
git commit -m "feat(calendar): add CalendarSection component with month grid, event pills, and legend"
```

---

### Task 8: Wire `CalendarSection` into `OfficeCarousel.tsx`

**Files:**
- Modify: `src/app/dashboards/office-performance/[location]/OfficeCarousel.tsx`

- [ ] **Step 1: Add import**

In `src/app/dashboards/office-performance/[location]/OfficeCarousel.tsx`, after line 21 (`import PipelineBarsSection`), add:

```typescript
import CalendarSection from "./CalendarSection";
```

- [ ] **Step 2: Add the `"calendar"` case to `renderSection()`**

In the `renderSection()` function (starts at line 159), add a new case after the `"pipeline"` case (after line 200, before `case "allLocations"`):

```typescript
      case "calendar":
        return <CalendarSection location={data.location} />;
```

- [ ] **Step 3: Verify full type-check passes**

Run: `npx tsc --noEmit 2>&1 | grep -i "error" | head -10`

Expected: No errors. The switch statement now covers all `CarouselSection` variants.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/office-performance/\[location\]/OfficeCarousel.tsx
git commit -m "feat(calendar): wire CalendarSection into OfficeCarousel renderSection"
```

---

### Task 9: Build verification and final type-check

**Files:** None new — verification only.

- [ ] **Step 1: Run all calendar event tests**

Run: `npx jest src/__tests__/calendar-events.test.ts --no-coverage 2>&1 | tail -20`

Expected: All tests PASS.

- [ ] **Step 2: Run the full build**

Run: `npm run build 2>&1 | tail -30`

Expected: Build succeeds with no errors related to calendar-events, CalendarSection, or office-performance-types.

- [ ] **Step 3: Run lint**

Run: `npm run lint 2>&1 | tail -20`

Expected: No new lint errors.

- [ ] **Step 4: Commit if any autofix changes**

If the linter or build process modified any files:

```bash
git add -A
git commit -m "fix(calendar): lint/build autofix"
```

---

## Summary

| Task | Description | Files | Tests |
|------|-------------|-------|-------|
| 1 | Types + constants + stubs | `calendar-events.ts` | — |
| 2 | `getCustomerName`, `formatAssignee`, `isOverdue`, `toCalendarProject` | `calendar-events.ts` | 18 tests |
| 3 | `generateProjectEvents` | `calendar-events.ts` | 7 tests |
| 4 | `generateZuperEvents` | `calendar-events.ts` | 5 tests |
| 5 | `expandToDayPills` | `calendar-events.ts` | 5 tests |
| 6 | Carousel types + query keys | `office-performance-types.ts`, `query-keys.ts` | — |
| 7 | `CalendarSection` component | `CalendarSection.tsx` | — |
| 8 | Wire into `OfficeCarousel` | `OfficeCarousel.tsx` | — |
| 9 | Build verification | — | — |

Total: 3 new files, 3 modified files, 35+ unit tests, 9 commits.
