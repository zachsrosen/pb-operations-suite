# Weekly Shop Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-location weekly health dashboard for Shop Directors that surfaces pipeline, scheduling, operations, inspection, and bottleneck metrics — enabling P&L ownership per the leadership framework.

**Architecture:** Extends the existing office-performance system (`getOfficePerformanceData()`) with a new `lib/shop-health.ts` orchestration layer, new API routes at `/api/shop-health/*`, and a new dashboard page at `/dashboards/shop-health`. Persistent bottleneck entries stored in a new Prisma model.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5, Prisma 7, React Query v5, Tailwind v4, HubSpot API

**Spec:** `docs/superpowers/specs/2026-05-16-shop-health-dashboard-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/lib/shop-health-types.ts` | TypeScript interfaces for all API shapes |
| `src/lib/shop-health.ts` | Data orchestration: calls office-performance + augments with week-bounded metrics, health scoring |
| `src/lib/shop-health-bottleneck.ts` | Bottleneck CRUD operations (DB reads/writes) |
| `src/app/api/shop-health/[location]/route.ts` | GET handler for single-location dashboard data |
| `src/app/api/shop-health/overview/route.ts` | GET handler for all-locations comparison |
| `src/app/api/shop-health/bottleneck/route.ts` | GET + POST handler for bottleneck entries |
| `src/hooks/useShopHealthData.ts` | React Query hook for dashboard data + bottleneck mutation |
| `src/app/dashboards/shop-health/page.tsx` | Main dashboard page component |
| `src/app/dashboards/shop-health/HeroMetrics.tsx` | Hero metrics row (6 StatCards) |
| `src/app/dashboards/shop-health/SectionCard.tsx` | Collapsible section card wrapper with health indicator |
| `src/app/dashboards/shop-health/PipelineSection.tsx` | Pipeline Overview section content |
| `src/app/dashboards/shop-health/PreconSection.tsx` | Preconstruction & RTB section content |
| `src/app/dashboards/shop-health/SchedulingSection.tsx` | Scheduling section content |
| `src/app/dashboards/shop-health/OperationsSection.tsx` | Operations section content |
| `src/app/dashboards/shop-health/InspectionsSection.tsx` | Inspections / Closeout section content |
| `src/app/dashboards/shop-health/BottleneckSection.tsx` | Bottleneck & Actions form + diagnostic reference |
| `src/app/dashboards/shop-health/AllLocationsView.tsx` | Comparison table across all 4 location groups |
| `src/app/dashboards/shop-health/WeekSelector.tsx` | Week navigation (prev/next arrows, current week display) |

### Modified Files
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `ShopHealthBottleneck` model + User relation |
| `src/lib/roles.ts` | Add `/dashboards/shop-health` and `/api/shop-health` to OPS_MGR allowedRoutes |
| `src/lib/query-keys.ts` | Add `shopHealth` and `shopHealthBottleneck` key factories |
| `src/app/suites/executive/page.tsx` | Add dashboard card in new "Shop Health" section |

---

## Chunk 1: Foundation (Database, Config, Types)

### Task 1: Add ShopHealthBottleneck Prisma Model

**Files:**
- Modify: `prisma/schema.prisma` (append after line ~4249)

- [ ] **Step 1: Add the model to schema.prisma**

Append after the last model in the file:

```prisma
model ShopHealthBottleneck {
  id         String   @id @default(cuid())
  location   String
  weekStart  DateTime
  constraint String?
  rootCause  String?
  actionPlan String?
  owner      String?
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([location, weekStart])
  @@index([location])
  @@index([weekStart])
}
```

Also add to the `User` model's relations (find the User model, add):
```prisma
shopHealthBottlenecks ShopHealthBottleneck[]
```

- [ ] **Step 2: Generate Prisma client to verify schema**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.claude/worktrees/optimistic-chaplygin-0007f3 && npx prisma generate`
Expected: "Generated Prisma Client" success message.

- [ ] **Step 3: Create migration file**

Run: `npx prisma migrate dev --name add_shop_health_bottleneck --create-only`
Expected: New migration directory created under `prisma/migrations/`.

NOTE: Do NOT run `prisma migrate deploy`. Migration files can be written but execution is orchestrator-only with user approval.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(shop-health): add ShopHealthBottleneck model

Persistent per-location per-week bottleneck entries for Shop Directors.
Unique constraint on (location, weekStart) for upsert semantics."
```

---

### Task 2: Add Types and Interfaces

**Files:**
- Create: `src/lib/shop-health-types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/lib/shop-health-types.ts
// Type definitions for the Weekly Shop Health Dashboard

export type HealthStatus = 'green' | 'yellow' | 'red';

export interface HeroMetric {
  value: number;
  priorWeek: number | null;
  delta: number | null;
  health: HealthStatus;
  target: number | null;
}

export interface PipelineSection {
  contractsSigned: number;
  contractsSignedValue: number;
  totalBacklogCount: number;
  totalBacklogValue: number;
  backlogInWeeks: number;
  cancellationCount: number;
  cancellationRate: number;
}

export interface CustomerExperienceMetrics {
  avgResponseDays: number | null;
  proactiveUpdatePct: number | null;
  avgIssueResolutionDays: number | null;
  changeOrdersPerJob: number | null;
  escalationCount: number | null;
  escalationAvgAgeDays: number | null;
}

export interface PreconstructionSection {
  jobsInDesign: number;
  jobsSubmittedForPermit: number;
  permitsApprovedThisWeek: number;
  avgDaysSaleToPermit: number | null;
  totalReadyJobs: number;
  jobsAgingOver2Weeks: number;
  customerExperience: CustomerExperienceMetrics;
}

export interface SchedulingSection {
  scheduledNext2Weeks: number;
  scheduledNext4Weeks: number;
  scheduleAccuracy: number | null;
  crewCapacityFilledPct: number;
}

export interface OperationsSection {
  installsCompleted: number;
  installsPlanned: number;
  installsActual: number;
  crewUtilizationPct: number;
}

export interface InspectionsSection {
  jobsAwaitingInspection: number;
  inspectionsPassed: number;
  avgDaysInstallToInspection: number | null;
  ptosReceived: number;
}

export interface ShopHealthHeroes {
  leads: HeroMetric | null; // null = deferred
  backlogWeeks: HeroMetric;
  readyToBuild: HeroMetric;
  scheduledInstalls: HeroMetric;
  installsCompleted: HeroMetric;
  ptosReceived: HeroMetric;
}

export interface ShopHealthGoals {
  monthlyInstalls: number;
  weeklyInstalls: number;
  monthlyInspections: number;
  weeklyInspections: number;
}

export interface ShopHealthData {
  location: string;
  weekStart: string;
  weekEnd: string;
  heroes: ShopHealthHeroes;
  pipeline: PipelineSection;
  preconstruction: PreconstructionSection;
  scheduling: SchedulingSection;
  operations: OperationsSection;
  inspections: InspectionsSection;
  bottleneck: ShopHealthBottleneckEntry | null;
  lastUpdated: string;
  goals: ShopHealthGoals;
}

export interface ShopHealthBottleneckEntry {
  id: string;
  location: string;
  weekStart: string;
  constraint: string | null;
  rootCause: string | null;
  actionPlan: string | null;
  owner: string | null;
  userId: string;
  updatedAt: string;
}

export interface ShopHealthOverviewRow {
  location: string;
  backlogWeeks: HeroMetric;
  readyToBuild: HeroMetric;
  scheduledInstalls: HeroMetric;
  installsCompleted: HeroMetric;
  ptosReceived: HeroMetric;
  topBottleneck: string | null;
}

export interface ShopHealthOverviewData {
  rows: ShopHealthOverviewRow[];
  weekStart: string;
  weekEnd: string;
  lastUpdated: string;
}

// Diagnostic framework constants from Tracey's presentation
export const BOTTLENECK_DIAGNOSTICS = [
  { signal: 'No leads', owner: 'Marketing' },
  { signal: 'No backlog', owner: 'Sales' },
  { signal: 'No approvals', owner: 'Preconstruction' },
  { signal: 'No schedule', owner: 'PM' },
  { signal: 'Low installs', owner: 'Ops' },
  { signal: 'No closeout', owner: 'Inspections' },
] as const;
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to shop-health-types.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shop-health-types.ts
git commit -m "feat(shop-health): add TypeScript interfaces for dashboard data"
```

---

### Task 3: Add Query Keys and Route Config

**Files:**
- Modify: `src/lib/query-keys.ts`
- Modify: `src/lib/roles.ts`

- [ ] **Step 1: Add query key factories**

In `src/lib/query-keys.ts`, add to the `queryKeys` object (after the `officePerformance` block):

```typescript
shopHealth: {
  root: ["shop-health"] as const,
  location: (location: string, weekStart: string) =>
    [...queryKeys.shopHealth.root, location, weekStart] as const,
  overview: (weekStart: string) =>
    [...queryKeys.shopHealth.root, "overview", weekStart] as const,
},
shopHealthBottleneck: {
  root: ["shop-health-bottleneck"] as const,
  location: (location: string, weeks?: number) =>
    [...queryKeys.shopHealthBottleneck.root, location, weeks] as const,
},
```

Also add to `cacheKeyToQueryKeys()` function (the switch/if chain that maps server cache keys to RQ keys):

```typescript
if (serverKey.startsWith("shop-health")) {
  return [queryKeys.shopHealth.root];
}
```

- [ ] **Step 2: Add routes to OPERATIONS_MANAGER allowedRoutes**

In `src/lib/roles.ts`, find the OPERATIONS_MANAGER role's `allowedRoutes` array. Add these two entries near the other `/dashboards/` entries:

```typescript
"/dashboards/shop-health",
"/api/shop-health",
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/query-keys.ts src/lib/roles.ts
git commit -m "feat(shop-health): add query keys and OPS_MGR route access"
```

---

### Task 4: Add Executive Suite Card

**Files:**
- Modify: `src/app/suites/executive/page.tsx`

- [ ] **Step 1: Add dashboard card to LINKS array**

Find the `LINKS` array in the executive suite page. Add a new card:

```typescript
{
  href: "/dashboards/shop-health",
  title: "Shop Health",
  description: "Weekly per-location health metrics for Shop Directors — pipeline, scheduling, operations, inspections, and bottleneck tracking.",
  tag: "WEEKLY",
  icon: "🏪",
  section: "Shop Health",
},
```

- [ ] **Step 2: Commit**

```bash
git add src/app/suites/executive/page.tsx
git commit -m "feat(shop-health): add Shop Health card to Executive Suite"
```

---

## Chunk 2: Data Layer

### Task 5: Week Utility Functions

**Files:**
- Create: `src/lib/shop-health.ts` (initial scaffold with week utils)

- [ ] **Step 1: Create shop-health.ts with week utilities**

```typescript
// src/lib/shop-health.ts
// Data orchestration for the Weekly Shop Health Dashboard.
// Extends office-performance data with week-bounded metrics and health scoring.

import { startOfWeek, endOfWeek, subWeeks, format, parseISO, isWithinInterval, differenceInDays, differenceInCalendarDays } from 'date-fns';

/**
 * Get the Monday of the week containing the given date.
 */
export function getWeekStart(date: Date = new Date()): Date {
  return startOfWeek(date, { weekStartsOn: 1 }); // Monday
}

/**
 * Get the Sunday of the week containing the given date.
 */
export function getWeekEnd(date: Date = new Date()): Date {
  return endOfWeek(date, { weekStartsOn: 1 });
}

/**
 * Format a date as ISO date string (YYYY-MM-DD) for API params.
 */
export function formatWeekParam(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Check if a date string falls within the given week (Mon-Sun).
 */
export function isInWeek(dateStr: string | null | undefined, weekStart: Date): boolean {
  if (!dateStr) return false;
  try {
    const date = parseISO(dateStr);
    const weekEnd = getWeekEnd(weekStart);
    return isWithinInterval(date, { start: weekStart, end: weekEnd });
  } catch {
    return false;
  }
}

/**
 * Check if a date string falls within N days from now.
 */
export function isWithinDays(dateStr: string | null | undefined, days: number): boolean {
  if (!dateStr) return false;
  try {
    const date = parseISO(dateStr);
    const now = new Date();
    const diff = differenceInCalendarDays(date, now);
    return diff >= 0 && diff <= days;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit --pretty 2>&1 | grep shop-health`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shop-health.ts
git commit -m "feat(shop-health): add week utility functions"
```

---

### Task 6: Health Scoring Logic

**Files:**
- Modify: `src/lib/shop-health.ts` (add health scoring)

- [ ] **Step 1: Add health scoring functions**

Append to `src/lib/shop-health.ts`:

```typescript
import type { HealthStatus, HeroMetric, ShopHealthGoals } from './shop-health-types';

/**
 * Score backlog-in-weeks against the 4-8 week target band.
 */
export function scoreBacklogWeeks(weeks: number): HealthStatus {
  if (weeks >= 4 && weeks <= 8) return 'green';
  if (weeks === 3 || (weeks > 8 && weeks <= 10)) return 'yellow';
  return 'red';
}

/**
 * Score RTB jobs against weekly install capacity.
 * Green: >= 2x capacity, Yellow: 1-2x, Red: < 1x
 */
export function scoreReadyToBuild(rtbCount: number, weeklyCapacity: number): HealthStatus {
  if (weeklyCapacity <= 0) return 'red';
  const ratio = rtbCount / weeklyCapacity;
  if (ratio >= 2) return 'green';
  if (ratio >= 1) return 'yellow';
  return 'red';
}

/**
 * Score scheduled installs against crew capacity.
 * Green: >= 100%, Yellow: 75-99%, Red: < 75%
 */
export function scoreScheduledInstalls(scheduled: number, capacity: number): HealthStatus {
  if (capacity <= 0) return 'red';
  const pct = (scheduled / capacity) * 100;
  if (pct >= 100) return 'green';
  if (pct >= 75) return 'yellow';
  return 'red';
}

/**
 * Score a count-based metric against a weekly goal.
 * Green: >= goal, Yellow: 80-99%, Red: < 80%
 */
export function scoreAgainstGoal(actual: number, weeklyGoal: number): HealthStatus {
  if (weeklyGoal <= 0) return 'green'; // no goal set = no judgment
  const pct = (actual / weeklyGoal) * 100;
  if (pct >= 100) return 'green';
  if (pct >= 80) return 'yellow';
  return 'red';
}

/**
 * Build a HeroMetric from current and prior week values.
 */
export function buildHeroMetric(
  value: number,
  priorWeek: number | null,
  health: HealthStatus,
  target: number | null = null
): HeroMetric {
  return {
    value,
    priorWeek,
    delta: priorWeek !== null ? value - priorWeek : null,
    health,
    target,
  };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit --pretty 2>&1 | grep shop-health`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shop-health.ts
git commit -m "feat(shop-health): add health scoring and hero metric builders"
```

---

### Task 7: Core getShopHealthData Function

**Files:**
- Modify: `src/lib/shop-health.ts` (add main orchestrator)

This is the heaviest task. The function calls `getOfficePerformanceData()` for the location group, then filters the project list by the selected week to compute all section metrics.

- [ ] **Step 1: Add the main data function**

Append to `src/lib/shop-health.ts`. This function:
1. Resolves the dashboard location group from the slug
2. Calls `getOfficePerformanceData(group)` for live project/install/inspection data
3. Fetches all active projects for the location from `/api/projects` or directly via the office-performance project list
4. Filters by week boundaries to compute per-week metrics
5. Computes hero metrics with health scoring
6. Reads bottleneck entry from DB

```typescript
import { getOfficePerformanceData } from './office-performance';
import { DASHBOARD_LOCATION_GROUPS, resolveDashboardGroup } from './dashboard-location-groups';
import type { DashboardLocationGroup } from './dashboard-location-groups';
import { db } from './db';
import type {
  ShopHealthData,
  ShopHealthHeroes,
  ShopHealthGoals,
  PipelineSection,
  PreconstructionSection,
  SchedulingSection,
  OperationsSection,
  InspectionsSection,
  CustomerExperienceMetrics,
  ShopHealthBottleneckEntry,
} from './shop-health-types';

// Backlog stages (deals not yet at RTB/Construction)
const BACKLOG_STAGES = [
  'Site Survey',
  'Design & Engineering',
  'Permitting & Interconnection',
  'RTB - Blocked',
  'Ready To Build',
];

const PRECON_STAGES = ['Design & Engineering', 'Permitting & Interconnection'];
const RTB_STAGES = ['Ready To Build', 'RTB - Blocked'];

/**
 * Main orchestrator: computes all shop health data for a location and week.
 */
export async function getShopHealthData(
  locationSlug: string,
  weekStart: Date
): Promise<ShopHealthData> {
  const group = resolveDashboardGroup(locationSlug);
  if (!group) {
    throw new Error(`Unknown location slug: ${locationSlug}`);
  }

  const priorWeekStart = subWeeks(weekStart, 1);
  const weekEndDate = getWeekEnd(weekStart);

  // 1. Get office-performance data (projects, installs, inspections, goals)
  const opData = await getOfficePerformanceData(group);

  // 2. Get all active projects for this location
  // office-performance already fetches these — extract from opData
  // We need the raw project list to filter by week. Since getOfficePerformanceData
  // returns aggregated data, we'll need to re-fetch or access the project list.
  // For V1, we query projects separately via the existing calculateStats/search pattern.
  const allProjects = await fetchProjectsForGroup(group);

  // 3. Fetch goals
  const goals = computeGoals(opData);

  // 4. Compute sections
  const pipeline = computePipeline(allProjects, weekStart);
  const preconstruction = computePreconstruction(allProjects, weekStart);
  const scheduling = computeScheduling(allProjects, goals);
  const operations = computeOperations(allProjects, opData, weekStart, goals);
  const inspections = computeInspections(allProjects, opData, weekStart);

  // 5. Compute prior week for deltas
  const priorProjects = allProjects; // same project set, different date filters
  const priorPipeline = computePipeline(priorProjects, priorWeekStart);
  const priorOperations = computeOperations(priorProjects, opData, priorWeekStart, goals);
  const priorInspections = computeInspections(priorProjects, opData, priorWeekStart);

  // 6. Build heroes with health scoring
  const heroes = buildHeroes(
    pipeline, operations, inspections, scheduling,
    priorPipeline, priorOperations, priorInspections,
    goals, opData
  );

  // 7. Read bottleneck
  const bottleneck = await getBottleneckForWeek(group.label, weekStart);

  return {
    location: group.label,
    weekStart: formatWeekParam(weekStart),
    weekEnd: formatWeekParam(weekEndDate),
    heroes,
    pipeline,
    preconstruction,
    scheduling,
    operations,
    inspections,
    bottleneck,
    lastUpdated: new Date().toISOString(),
    goals,
  };
}
```

- [ ] **Step 2: Add helper computation functions**

These are the section-specific computation functions called by `getShopHealthData`. Add them below the main function in the same file.

```typescript
/**
 * Fetch all active projects for a dashboard location group.
 * Uses the HubSpot search with location filter.
 */
async function fetchProjectsForGroup(group: DashboardLocationGroup) {
  // Import the search function used by office-performance
  const { searchProjects } = await import('./hubspot');
  const locationFilter = group.canonicals;

  // Fetch active projects in the project pipeline for these locations
  const projects = await searchProjects({
    pipeline: 'project',
    locations: locationFilter,
    activeOnly: false, // need completed projects for week-bounded counting
    limit: 500,
  });

  return projects;
}

/**
 * Derive weekly goals from office-performance data.
 */
function computeGoals(opData: Awaited<ReturnType<typeof getOfficePerformanceData>>): ShopHealthGoals {
  const monthlyInstalls = opData.installs?.completedGoal ?? 0;
  const monthlyInspections = opData.inspections?.completedGoal ?? 0;
  return {
    monthlyInstalls,
    weeklyInstalls: Math.round(monthlyInstalls / 4.3),
    monthlyInspections,
    weeklyInspections: Math.round(monthlyInspections / 4.3),
  };
}

/**
 * Pipeline Overview: contracts signed, backlog, cancellations.
 */
function computePipeline(projects: any[], weekStart: Date): PipelineSection {
  const contractsSigned = projects.filter(p => isInWeek(p.closedate, weekStart));
  const backlog = projects.filter(p => BACKLOG_STAGES.includes(p.stage) && p.isActive);

  // Backlog in weeks = backlog count / trailing avg weekly completions
  // Use last 8 weeks of completed installs as the denominator
  const eightWeeksAgo = subWeeks(weekStart, 8);
  const completedRecently = projects.filter(p =>
    p.construction_complete_date &&
    new Date(p.construction_complete_date) >= eightWeeksAgo &&
    new Date(p.construction_complete_date) <= getWeekEnd(weekStart)
  );
  const avgWeeklyCompletions = completedRecently.length / 8;
  const backlogInWeeks = avgWeeklyCompletions > 0
    ? Math.round((backlog.length / avgWeeklyCompletions) * 10) / 10
    : 0;

  // Cancellations this week
  const cancelled = projects.filter(p =>
    isInWeek(p.cancelled_date || p.lost_date, weekStart)
  );

  return {
    contractsSigned: contractsSigned.length,
    contractsSignedValue: contractsSigned.reduce((sum, p) => sum + (p.amount || 0), 0),
    totalBacklogCount: backlog.length,
    totalBacklogValue: backlog.reduce((sum, p) => sum + (p.amount || 0), 0),
    backlogInWeeks,
    cancellationCount: cancelled.length,
    cancellationRate: projects.filter(p => p.isActive).length > 0
      ? Math.round((cancelled.length / projects.filter(p => p.isActive).length) * 1000) / 10
      : 0,
  };
}

/**
 * Preconstruction & RTB metrics.
 */
function computePreconstruction(projects: any[], weekStart: Date): PreconstructionSection {
  const active = projects.filter(p => p.isActive);
  const inDesign = active.filter(p => p.stage === 'Design & Engineering');
  const inPermitting = active.filter(p => p.stage === 'Permitting & Interconnection');
  const rtb = active.filter(p => RTB_STAGES.includes(p.stage));

  // Permits approved this week: moved out of Permitting stage this week
  const permitsApproved = projects.filter(p =>
    p.permit_approval_date && isInWeek(p.permit_approval_date, weekStart)
  );

  // Avg days sale to permit
  const daysToPermit = permitsApproved
    .filter(p => p.closedate && p.permit_approval_date)
    .map(p => differenceInDays(new Date(p.permit_approval_date), new Date(p.closedate)));
  const avgDaysSaleToPermit = daysToPermit.length > 0
    ? Math.round(daysToPermit.reduce((a, b) => a + b, 0) / daysToPermit.length)
    : null;

  // Aging > 2 weeks in precon/RTB stages
  const agingProjects = active.filter(p =>
    [...PRECON_STAGES, ...RTB_STAGES].includes(p.stage) &&
    p.daysSinceStageMovement > 14
  );

  // CX metrics — derive what we can from HubSpot data
  const customerExperience = computeCustomerExperience(active);

  return {
    jobsInDesign: inDesign.length,
    jobsSubmittedForPermit: inPermitting.length,
    permitsApprovedThisWeek: permitsApproved.length,
    avgDaysSaleToPermit,
    totalReadyJobs: rtb.length,
    jobsAgingOver2Weeks: agingProjects.length,
    customerExperience,
  };
}

/**
 * Customer experience metrics derived from HubSpot data.
 */
function computeCustomerExperience(activeProjects: any[]): CustomerExperienceMetrics {
  // Avg response time: days since last contact across active projects
  const projectsWithContact = activeProjects.filter(p => p.notes_last_contacted);
  const responseDays = projectsWithContact.map(p =>
    differenceInDays(new Date(), new Date(p.notes_last_contacted))
  );
  const avgResponseDays = responseDays.length > 0
    ? Math.round(responseDays.reduce((a, b) => a + b, 0) / responseDays.length * 10) / 10
    : null;

  // Proactive update cadence: % of active deals contacted in last 7 days
  const contactedRecently = projectsWithContact.filter(p =>
    differenceInDays(new Date(), new Date(p.notes_last_contacted)) <= 7
  );
  const proactiveUpdatePct = activeProjects.length > 0
    ? Math.round((contactedRecently.length / activeProjects.length) * 100)
    : null;

  // Issue resolution and change orders/escalations = null for V1
  // These need new HubSpot custom properties that will be sparse initially
  return {
    avgResponseDays,
    proactiveUpdatePct,
    avgIssueResolutionDays: null,
    changeOrdersPerJob: null,
    escalationCount: null,
    escalationAvgAgeDays: null,
  };
}

/**
 * Scheduling metrics.
 */
function computeScheduling(projects: any[], goals: ShopHealthGoals): SchedulingSection {
  const active = projects.filter(p => p.isActive);

  const scheduledNext2Weeks = active.filter(p => isWithinDays(p.install_date, 14)).length;
  const scheduledNext4Weeks = active.filter(p => isWithinDays(p.install_date, 28)).length;

  // Crew capacity: 2-week scheduled / (weekly capacity * 2)
  const twoWeekCapacity = goals.weeklyInstalls * 2;
  const crewCapacityFilledPct = twoWeekCapacity > 0
    ? Math.round((scheduledNext2Weeks / twoWeekCapacity) * 100)
    : 0;

  return {
    scheduledNext2Weeks,
    scheduledNext4Weeks,
    scheduleAccuracy: null, // V1: requires original vs actual date comparison
    crewCapacityFilledPct,
  };
}

/**
 * Operations metrics.
 */
function computeOperations(
  projects: any[],
  opData: any,
  weekStart: Date,
  goals: ShopHealthGoals
): OperationsSection {
  const completedThisWeek = projects.filter(p =>
    isInWeek(p.construction_complete_date, weekStart)
  );

  // Planned: deals that had install_date in this week
  const plannedThisWeek = projects.filter(p =>
    isInWeek(p.install_date, weekStart)
  );

  const crewUtilizationPct = goals.weeklyInstalls > 0
    ? Math.round((completedThisWeek.length / goals.weeklyInstalls) * 100)
    : 0;

  return {
    installsCompleted: completedThisWeek.length,
    installsPlanned: plannedThisWeek.length,
    installsActual: completedThisWeek.length,
    crewUtilizationPct,
  };
}

/**
 * Inspections / Closeout metrics.
 */
function computeInspections(
  projects: any[],
  opData: any,
  weekStart: Date
): InspectionsSection {
  const active = projects.filter(p => p.isActive);
  const awaitingInspection = active.filter(p => p.stage === 'Inspection');

  const passedThisWeek = projects.filter(p =>
    isInWeek(p.inspectionPassDate || p.inspection_pass_date, weekStart)
  );

  // Avg days from construction complete to inspection pass
  const turnaroundDays = passedThisWeek
    .filter(p => (p.construction_complete_date) && (p.inspectionPassDate || p.inspection_pass_date))
    .map(p => differenceInDays(
      new Date(p.inspectionPassDate || p.inspection_pass_date),
      new Date(p.construction_complete_date)
    ))
    .filter(d => d >= 0);
  const avgDaysInstallToInspection = turnaroundDays.length > 0
    ? Math.round(turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length)
    : null;

  const ptosThisWeek = projects.filter(p =>
    isInWeek(p.ptoGrantedDate || p.pto_granted_date, weekStart)
  );

  return {
    jobsAwaitingInspection: awaitingInspection.length,
    inspectionsPassed: passedThisWeek.length,
    avgDaysInstallToInspection,
    ptosReceived: ptosThisWeek.length,
  };
}

/**
 * Build hero metrics with health scoring and prior-week deltas.
 */
function buildHeroes(
  pipeline: PipelineSection,
  operations: OperationsSection,
  inspections: InspectionsSection,
  scheduling: SchedulingSection,
  priorPipeline: PipelineSection,
  priorOperations: OperationsSection,
  priorInspections: InspectionsSection,
  goals: ShopHealthGoals,
  opData: any
): ShopHealthHeroes {
  return {
    leads: null, // Deferred — Marketing data source TBD
    backlogWeeks: buildHeroMetric(
      pipeline.backlogInWeeks,
      priorPipeline.backlogInWeeks,
      scoreBacklogWeeks(pipeline.backlogInWeeks),
      6 // midpoint of 4-8 target
    ),
    readyToBuild: buildHeroMetric(
      // Use total ready jobs from precon, but we don't have it here — use pipeline
      // Actually we need precon data. We'll pass it in.
      0, // placeholder — will be filled from preconstruction section
      null,
      'green'
    ),
    scheduledInstalls: buildHeroMetric(
      scheduling.scheduledNext2Weeks,
      null, // prior week scheduled doesn't make sense (it's forward-looking)
      scoreScheduledInstalls(scheduling.scheduledNext2Weeks, goals.weeklyInstalls * 2),
      goals.weeklyInstalls * 2
    ),
    installsCompleted: buildHeroMetric(
      operations.installsCompleted,
      priorOperations.installsCompleted,
      scoreAgainstGoal(operations.installsCompleted, goals.weeklyInstalls),
      goals.weeklyInstalls
    ),
    ptosReceived: buildHeroMetric(
      inspections.ptosReceived,
      priorInspections.ptosReceived,
      scoreAgainstGoal(inspections.ptosReceived, goals.weeklyInspections),
      goals.weeklyInspections
    ),
  };
}

/**
 * Read bottleneck entry from DB for a specific location and week.
 */
async function getBottleneckForWeek(
  location: string,
  weekStart: Date
): Promise<ShopHealthBottleneckEntry | null> {
  const entry = await db.shopHealthBottleneck.findUnique({
    where: {
      location_weekStart: {
        location,
        weekStart,
      },
    },
  });

  if (!entry) return null;

  return {
    id: entry.id,
    location: entry.location,
    weekStart: entry.weekStart.toISOString(),
    constraint: entry.constraint,
    rootCause: entry.rootCause,
    actionPlan: entry.actionPlan,
    owner: entry.owner,
    userId: entry.userId,
    updatedAt: entry.updatedAt.toISOString(),
  };
}
```

NOTE: The `fetchProjectsForGroup` function references `searchProjects` from `hubspot.ts`. The implementer should check how `getOfficePerformanceData` fetches its projects and reuse the same pattern. The property names on the project objects (e.g., `construction_complete_date`, `install_date`, `permit_approval_date`, `inspectionPassDate`, `closedate`, `amount`, `stage`, `isActive`, `daysSinceStageMovement`, `notes_last_contacted`) come from the `TransformedProject` / `ExecProject` interfaces. The implementer should verify exact field names against `src/lib/transforms.ts` and `src/lib/executive-shared.ts`.

- [ ] **Step 3: Fix the readyToBuild hero (needs preconstruction data)**

Update `getShopHealthData` to pass preconstruction to `buildHeroes`:

```typescript
// In buildHeroes, replace the readyToBuild placeholder:
readyToBuild: buildHeroMetric(
  preconstruction.totalReadyJobs,
  priorPreconstruction.totalReadyJobs,
  scoreReadyToBuild(preconstruction.totalReadyJobs, goals.weeklyInstalls),
  goals.weeklyInstalls * 2
),
```

Update `getShopHealthData` to also compute `priorPreconstruction` and pass both to `buildHeroes`. Add preconstruction as a parameter to `buildHeroes`.

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i error | head -20`
Expected: No errors (or only pre-existing ones unrelated to shop-health).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop-health.ts
git commit -m "feat(shop-health): add core getShopHealthData orchestrator

Computes pipeline, preconstruction, scheduling, operations,
inspection metrics per location per week. Derives CX metrics
from HubSpot data. Health scoring for hero metrics."
```

---

### Task 8: Bottleneck CRUD Module

**Files:**
- Create: `src/lib/shop-health-bottleneck.ts`

- [ ] **Step 1: Create bottleneck CRUD functions**

```typescript
// src/lib/shop-health-bottleneck.ts
// Database operations for ShopHealthBottleneck entries.

import { db } from './db';
import type { ShopHealthBottleneckEntry } from './shop-health-types';

/**
 * Upsert a bottleneck entry for a location + week.
 * Uses the unique constraint on (location, weekStart).
 */
export async function upsertBottleneck(params: {
  location: string;
  weekStart: Date;
  constraint?: string | null;
  rootCause?: string | null;
  actionPlan?: string | null;
  owner?: string | null;
  userId: string;
}): Promise<ShopHealthBottleneckEntry> {
  const entry = await db.shopHealthBottleneck.upsert({
    where: {
      location_weekStart: {
        location: params.location,
        weekStart: params.weekStart,
      },
    },
    create: {
      location: params.location,
      weekStart: params.weekStart,
      constraint: params.constraint ?? null,
      rootCause: params.rootCause ?? null,
      actionPlan: params.actionPlan ?? null,
      owner: params.owner ?? null,
      userId: params.userId,
    },
    update: {
      constraint: params.constraint ?? undefined,
      rootCause: params.rootCause ?? undefined,
      actionPlan: params.actionPlan ?? undefined,
      owner: params.owner ?? undefined,
      userId: params.userId,
    },
  });

  return serializeBottleneck(entry);
}

/**
 * Get bottleneck history for a location (last N weeks).
 */
export async function getBottleneckHistory(
  location: string,
  weeks: number = 4
): Promise<ShopHealthBottleneckEntry[]> {
  const entries = await db.shopHealthBottleneck.findMany({
    where: { location },
    orderBy: { weekStart: 'desc' },
    take: weeks,
  });

  return entries.map(serializeBottleneck);
}

function serializeBottleneck(entry: {
  id: string;
  location: string;
  weekStart: Date;
  constraint: string | null;
  rootCause: string | null;
  actionPlan: string | null;
  owner: string | null;
  userId: string;
  updatedAt: Date;
}): ShopHealthBottleneckEntry {
  return {
    id: entry.id,
    location: entry.location,
    weekStart: entry.weekStart.toISOString(),
    constraint: entry.constraint,
    rootCause: entry.rootCause,
    actionPlan: entry.actionPlan,
    owner: entry.owner,
    userId: entry.userId,
    updatedAt: entry.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/shop-health-bottleneck.ts
git commit -m "feat(shop-health): add bottleneck CRUD operations"
```

---

## Chunk 3: API Routes

### Task 9: Location Data API

**Files:**
- Create: `src/app/api/shop-health/[location]/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
// src/app/api/shop-health/[location]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getShopHealthData, getWeekStart, formatWeekParam } from '@/lib/shop-health';
import { resolveDashboardGroup } from '@/lib/dashboard-location-groups';
import { parseISO } from 'date-fns';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ location: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { location } = await params;
  const group = resolveDashboardGroup(location);
  if (!group) {
    return NextResponse.json({ error: 'Unknown location' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get('week');
  const weekStart = weekParam ? getWeekStart(parseISO(weekParam)) : getWeekStart();

  try {
    const data = await getShopHealthData(location, weekStart);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[shop-health] Error fetching data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shop health data' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/shop-health/
git commit -m "feat(shop-health): add GET /api/shop-health/[location] route"
```

---

### Task 10: Overview API

**Files:**
- Create: `src/app/api/shop-health/overview/route.ts`

- [ ] **Step 1: Create the overview route**

```typescript
// src/app/api/shop-health/overview/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getShopHealthData, getWeekStart, formatWeekParam } from '@/lib/shop-health';
import { DASHBOARD_LOCATION_GROUPS } from '@/lib/dashboard-location-groups';
import { parseISO } from 'date-fns';
import type { ShopHealthOverviewData, ShopHealthOverviewRow } from '@/lib/shop-health-types';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get('week');
  const weekStart = weekParam ? getWeekStart(parseISO(weekParam)) : getWeekStart();

  try {
    const rows: ShopHealthOverviewRow[] = await Promise.all(
      DASHBOARD_LOCATION_GROUPS.map(async (group) => {
        const data = await getShopHealthData(group.slug, weekStart);
        return {
          location: group.label,
          backlogWeeks: data.heroes.backlogWeeks,
          readyToBuild: data.heroes.readyToBuild,
          scheduledInstalls: data.heroes.scheduledInstalls,
          installsCompleted: data.heroes.installsCompleted,
          ptosReceived: data.heroes.ptosReceived,
          topBottleneck: data.bottleneck?.constraint ?? null,
        };
      })
    );

    const result: ShopHealthOverviewData = {
      rows,
      weekStart: formatWeekParam(weekStart),
      weekEnd: formatWeekParam(new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)),
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('[shop-health] Overview error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch overview data' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/shop-health/overview/
git commit -m "feat(shop-health): add GET /api/shop-health/overview route"
```

---

### Task 11: Bottleneck API

**Files:**
- Create: `src/app/api/shop-health/bottleneck/route.ts`

- [ ] **Step 1: Create bottleneck CRUD route**

```typescript
// src/app/api/shop-health/bottleneck/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { upsertBottleneck, getBottleneckHistory } from '@/lib/shop-health-bottleneck';
import { getWeekStart } from '@/lib/shop-health';
import { parseISO } from 'date-fns';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const location = searchParams.get('location');
  if (!location) {
    return NextResponse.json({ error: 'location param required' }, { status: 400 });
  }

  const weeks = parseInt(searchParams.get('weeks') || '4', 10);
  const entries = await getBottleneckHistory(location, weeks);
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { location, weekStart: weekStartStr, constraint, rootCause, actionPlan, owner } = body;

  if (!location || !weekStartStr) {
    return NextResponse.json(
      { error: 'location and weekStart required' },
      { status: 400 }
    );
  }

  const weekStart = getWeekStart(parseISO(weekStartStr));

  try {
    const entry = await upsertBottleneck({
      location,
      weekStart,
      constraint,
      rootCause,
      actionPlan,
      owner,
      userId: session.user.id,
    });

    return NextResponse.json(entry);
  } catch (error) {
    console.error('[shop-health] Bottleneck upsert error:', error);
    return NextResponse.json(
      { error: 'Failed to save bottleneck' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/shop-health/bottleneck/
git commit -m "feat(shop-health): add bottleneck GET+POST API routes"
```

---

## Chunk 4: Frontend — Hook and Page Components

### Task 12: React Query Hook

**Files:**
- Create: `src/hooks/useShopHealthData.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/useShopHealthData.ts
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type {
  ShopHealthData,
  ShopHealthOverviewData,
  ShopHealthBottleneckEntry,
} from '@/lib/shop-health-types';

async function fetchShopHealthData(location: string, weekStart: string): Promise<ShopHealthData> {
  const res = await fetch(`/api/shop-health/${location}?week=${weekStart}`);
  if (!res.ok) throw new Error(`Shop health fetch failed: ${res.status}`);
  return res.json();
}

async function fetchOverviewData(weekStart: string): Promise<ShopHealthOverviewData> {
  const res = await fetch(`/api/shop-health/overview?week=${weekStart}`);
  if (!res.ok) throw new Error(`Overview fetch failed: ${res.status}`);
  return res.json();
}

async function saveBottleneck(params: {
  location: string;
  weekStart: string;
  constraint?: string | null;
  rootCause?: string | null;
  actionPlan?: string | null;
  owner?: string | null;
}): Promise<ShopHealthBottleneckEntry> {
  const res = await fetch('/api/shop-health/bottleneck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Bottleneck save failed: ${res.status}`);
  return res.json();
}

export function useShopHealthData(location: string, weekStart: string) {
  return useQuery({
    queryKey: queryKeys.shopHealth.location(location, weekStart),
    queryFn: () => fetchShopHealthData(location, weekStart),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
    enabled: !!location && !!weekStart,
  });
}

export function useShopHealthOverview(weekStart: string) {
  return useQuery({
    queryKey: queryKeys.shopHealth.overview(weekStart),
    queryFn: () => fetchOverviewData(weekStart),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useBottleneckMutation(location: string, weekStart: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveBottleneck,
    onSuccess: () => {
      // Invalidate the shop health data to refresh the bottleneck section
      queryClient.invalidateQueries({
        queryKey: queryKeys.shopHealth.location(location, weekStart),
      });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useShopHealthData.ts
git commit -m "feat(shop-health): add React Query hooks for dashboard data and bottleneck mutation"
```

---

### Task 13: Reusable Section Components

**Files:**
- Create: `src/app/dashboards/shop-health/SectionCard.tsx`
- Create: `src/app/dashboards/shop-health/WeekSelector.tsx`
- Create: `src/app/dashboards/shop-health/HeroMetrics.tsx`

- [ ] **Step 1: Create SectionCard wrapper**

A collapsible card with a health indicator dot and section title. Uses existing theme tokens.

```typescript
// src/app/dashboards/shop-health/SectionCard.tsx
'use client';

import { useState, type ReactNode } from 'react';
import type { HealthStatus } from '@/lib/shop-health-types';

const HEALTH_COLORS: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
};

interface SectionCardProps {
  title: string;
  health?: HealthStatus;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function SectionCard({ title, health, children, defaultOpen = true }: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-surface rounded-xl border border-border shadow-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          {health && (
            <span className={`w-2.5 h-2.5 rounded-full ${HEALTH_COLORS[health]}`} />
          )}
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        </div>
        <svg
          className={`w-5 h-5 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-6 pb-6 border-t border-border pt-4">
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create WeekSelector**

```typescript
// src/app/dashboards/shop-health/WeekSelector.tsx
'use client';

import { format, addWeeks, subWeeks, isAfter, startOfWeek } from 'date-fns';

interface WeekSelectorProps {
  weekStart: Date;
  onChange: (newWeekStart: Date) => void;
}

export function WeekSelector({ weekStart, onChange }: WeekSelectorProps) {
  const currentWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
  const isCurrentWeek = weekStart.getTime() === currentWeek.getTime();
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(subWeeks(weekStart, 1))}
        className="p-1.5 rounded-lg hover:bg-surface-2 text-muted hover:text-foreground transition-colors"
        title="Previous week"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <span className="text-sm font-medium text-foreground min-w-[180px] text-center">
        {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
        {isCurrentWeek && (
          <span className="ml-2 text-xs text-muted">(current)</span>
        )}
      </span>

      <button
        onClick={() => onChange(addWeeks(weekStart, 1))}
        disabled={isCurrentWeek}
        className="p-1.5 rounded-lg hover:bg-surface-2 text-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Next week"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create HeroMetrics row**

```typescript
// src/app/dashboards/shop-health/HeroMetrics.tsx
'use client';

import type { ShopHealthHeroes } from '@/lib/shop-health-types';

interface HeroMetricsProps {
  heroes: ShopHealthHeroes;
}

const HEALTH_BORDER: Record<string, string> = {
  green: 'border-emerald-500/30',
  yellow: 'border-yellow-500/30',
  red: 'border-red-500/30',
};

const HEALTH_BG: Record<string, string> = {
  green: 'bg-emerald-500/5',
  yellow: 'bg-yellow-500/5',
  red: 'bg-red-500/5',
};

function HeroCard({
  label,
  metric,
  deferred,
}: {
  label: string;
  metric: { value: number; delta: number | null; health: string; target: number | null } | null;
  deferred?: boolean;
}) {
  if (deferred || !metric) {
    return (
      <div className="bg-surface rounded-xl border border-border p-4 flex flex-col items-center justify-center min-h-[120px] opacity-50">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-xs text-muted mt-1">Coming soon</span>
      </div>
    );
  }

  const borderClass = HEALTH_BORDER[metric.health] || '';
  const bgClass = HEALTH_BG[metric.health] || '';

  return (
    <div
      className={`rounded-xl border-2 ${borderClass} ${bgClass} p-4 flex flex-col items-center justify-center min-h-[120px]`}
      key={String(metric.value)}
    >
      <span className="text-sm text-muted mb-1">{label}</span>
      <span className="text-3xl font-bold text-foreground animate-value-flash">
        {typeof metric.value === 'number' && metric.value % 1 !== 0
          ? metric.value.toFixed(1)
          : metric.value}
      </span>
      {metric.delta !== null && (
        <span className={`text-xs mt-1 ${metric.delta > 0 ? 'text-emerald-500' : metric.delta < 0 ? 'text-red-500' : 'text-muted'}`}>
          {metric.delta > 0 ? '▲' : metric.delta < 0 ? '▼' : '–'}{' '}
          {Math.abs(metric.delta)} vs last week
        </span>
      )}
      {metric.target !== null && (
        <span className="text-xs text-muted">target: {metric.target}</span>
      )}
    </div>
  );
}

export function HeroMetrics({ heroes }: HeroMetricsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <HeroCard label="Leads" metric={null} deferred />
      <HeroCard label="Backlog (weeks)" metric={heroes.backlogWeeks} />
      <HeroCard label="Ready to Build" metric={heroes.readyToBuild} />
      <HeroCard label="Scheduled (2-4 wk)" metric={heroes.scheduledInstalls} />
      <HeroCard label="Installs Completed" metric={heroes.installsCompleted} />
      <HeroCard label="PTOs Received" metric={heroes.ptosReceived} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/shop-health/SectionCard.tsx src/app/dashboards/shop-health/WeekSelector.tsx src/app/dashboards/shop-health/HeroMetrics.tsx
git commit -m "feat(shop-health): add SectionCard, WeekSelector, and HeroMetrics components"
```

---

### Task 14: Section Content Components

**Files:**
- Create: `src/app/dashboards/shop-health/PipelineSection.tsx`
- Create: `src/app/dashboards/shop-health/PreconSection.tsx`
- Create: `src/app/dashboards/shop-health/SchedulingSection.tsx`
- Create: `src/app/dashboards/shop-health/OperationsSection.tsx`
- Create: `src/app/dashboards/shop-health/InspectionsSection.tsx`

Each section renders a grid of `MetricCard` components with the section data. These are straightforward — each takes its section data as props and renders metric cards.

- [ ] **Step 1: Create all 5 section components**

Each follows this pattern (showing PipelineSection as the template):

```typescript
// src/app/dashboards/shop-health/PipelineSection.tsx
'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import type { PipelineSection as PipelineSectionData } from '@/lib/shop-health-types';

interface Props {
  data: PipelineSectionData;
}

export function PipelineSection({ data }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <MetricCard
        label="Contracts Signed"
        value={data.contractsSigned}
        sub={`$${(data.contractsSignedValue / 1000).toFixed(0)}k value`}
        color="orange"
      />
      <MetricCard
        label="Backlog (jobs)"
        value={data.totalBacklogCount}
        sub={`$${(data.totalBacklogValue / 1000).toFixed(0)}k total`}
        color="blue"
      />
      <MetricCard
        label="Backlog (weeks)"
        value={data.backlogInWeeks.toFixed(1)}
        sub="target: 4–8 weeks"
        color={data.backlogInWeeks >= 4 && data.backlogInWeeks <= 8 ? 'emerald' : 'red'}
      />
      <MetricCard
        label="Cancellations"
        value={data.cancellationCount}
        sub={`${data.cancellationRate}% rate`}
        color={data.cancellationCount === 0 ? 'emerald' : 'yellow'}
      />
      {/* Avg System Margin — deferred */}
      <MetricCard
        label="Avg Margin at Sale"
        value="—"
        sub="Coming soon"
        color="blue"
      />
    </div>
  );
}
```

Create similar components for PreconSection, SchedulingSection, OperationsSection, and InspectionsSection. Each maps its section type's fields to MetricCard instances.

**PreconSection** should include a sub-section for Customer Experience metrics.
**OperationsSection** should show "Cost per Install" as a deferred placeholder.

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/shop-health/PipelineSection.tsx src/app/dashboards/shop-health/PreconSection.tsx src/app/dashboards/shop-health/SchedulingSection.tsx src/app/dashboards/shop-health/OperationsSection.tsx src/app/dashboards/shop-health/InspectionsSection.tsx
git commit -m "feat(shop-health): add 5 section content components

Pipeline, Preconstruction, Scheduling, Operations, Inspections.
Each renders a MetricCard grid from section data props."
```

---

### Task 15: Bottleneck Section Component

**Files:**
- Create: `src/app/dashboards/shop-health/BottleneckSection.tsx`

- [ ] **Step 1: Create the bottleneck form with diagnostic reference**

```typescript
// src/app/dashboards/shop-health/BottleneckSection.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useBottleneckMutation } from '@/hooks/useShopHealthData';
import { BOTTLENECK_DIAGNOSTICS } from '@/lib/shop-health-types';
import type { ShopHealthBottleneckEntry } from '@/lib/shop-health-types';

interface Props {
  bottleneck: ShopHealthBottleneckEntry | null;
  location: string;
  weekStart: string;
  isCurrentWeek: boolean;
}

export function BottleneckSection({ bottleneck, location, weekStart, isCurrentWeek }: Props) {
  const [constraint, setConstraint] = useState(bottleneck?.constraint ?? '');
  const [rootCause, setRootCause] = useState(bottleneck?.rootCause ?? '');
  const [actionPlan, setActionPlan] = useState(bottleneck?.actionPlan ?? '');
  const [owner, setOwner] = useState(bottleneck?.owner ?? '');

  const mutation = useBottleneckMutation(location, weekStart);

  // Sync state when bottleneck prop changes (e.g., week navigation)
  useEffect(() => {
    setConstraint(bottleneck?.constraint ?? '');
    setRootCause(bottleneck?.rootCause ?? '');
    setActionPlan(bottleneck?.actionPlan ?? '');
    setOwner(bottleneck?.owner ?? '');
  }, [bottleneck]);

  const handleBlur = useCallback(() => {
    if (!isCurrentWeek) return; // Read-only for past weeks
    mutation.mutate({
      location,
      weekStart,
      constraint: constraint || null,
      rootCause: rootCause || null,
      actionPlan: actionPlan || null,
      owner: owner || null,
    });
  }, [location, weekStart, constraint, rootCause, actionPlan, owner, isCurrentWeek, mutation]);

  const readOnly = !isCurrentWeek;

  return (
    <div className="space-y-6">
      {/* Editable form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Current Constraint
          </label>
          <textarea
            value={constraint}
            onChange={(e) => setConstraint(e.target.value)}
            onBlur={handleBlur}
            readOnly={readOnly}
            placeholder="What's the #1 bottleneck this week?"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted/50 resize-none h-20 read-only:opacity-60"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Root Cause
          </label>
          <textarea
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            onBlur={handleBlur}
            readOnly={readOnly}
            placeholder="Why is this happening?"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted/50 resize-none h-20 read-only:opacity-60"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Action Plan
          </label>
          <textarea
            value={actionPlan}
            onChange={(e) => setActionPlan(e.target.value)}
            onBlur={handleBlur}
            readOnly={readOnly}
            placeholder="What will be done to fix it?"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted/50 resize-none h-20 read-only:opacity-60"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">
            Owner
          </label>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            onBlur={handleBlur}
            readOnly={readOnly}
            placeholder="Who is responsible?"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted/50 read-only:opacity-60"
          />
        </div>
      </div>

      {mutation.isPending && (
        <p className="text-xs text-muted">Saving...</p>
      )}
      {!isCurrentWeek && (
        <p className="text-xs text-muted italic">Past week — read only</p>
      )}

      {/* Diagnostic reference */}
      <div className="border-t border-border pt-4">
        <h4 className="text-sm font-medium text-muted mb-2">Diagnostic Framework</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {BOTTLENECK_DIAGNOSTICS.map((d) => (
            <div
              key={d.signal}
              className="flex items-center gap-2 text-xs text-muted bg-surface-2 rounded-lg px-3 py-2"
            >
              <span className="font-medium text-foreground">{d.signal}</span>
              <span>→</span>
              <span>{d.owner}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/shop-health/BottleneckSection.tsx
git commit -m "feat(shop-health): add BottleneckSection with auto-save form and diagnostic reference"
```

---

### Task 16: All Locations Comparison View

**Files:**
- Create: `src/app/dashboards/shop-health/AllLocationsView.tsx`

- [ ] **Step 1: Create comparison table**

```typescript
// src/app/dashboards/shop-health/AllLocationsView.tsx
'use client';

import { useShopHealthOverview } from '@/hooks/useShopHealthData';
import type { HealthStatus } from '@/lib/shop-health-types';

const HEALTH_DOT: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
};

interface Props {
  weekStart: string;
}

export function AllLocationsView({ weekStart }: Props) {
  const { data, isLoading, error } = useShopHealthOverview(weekStart);

  if (isLoading) {
    return <div className="animate-pulse bg-surface rounded-xl h-64" />;
  }

  if (error || !data) {
    return <p className="text-red-500 text-sm">Failed to load overview data.</p>;
  }

  return (
    <div className="bg-surface rounded-xl border border-border shadow-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-3 text-muted font-medium">Location</th>
            <th className="text-center px-4 py-3 text-muted font-medium">Backlog (wk)</th>
            <th className="text-center px-4 py-3 text-muted font-medium">RTB Jobs</th>
            <th className="text-center px-4 py-3 text-muted font-medium">Scheduled</th>
            <th className="text-center px-4 py-3 text-muted font-medium">Installs</th>
            <th className="text-center px-4 py-3 text-muted font-medium">PTOs</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Top Bottleneck</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.location} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
              <td className="px-4 py-3 font-medium text-foreground">{row.location}</td>
              <td className="px-4 py-3 text-center">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[row.backlogWeeks.health]}`} />
                  {row.backlogWeeks.value.toFixed(1)}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[row.readyToBuild.health]}`} />
                  {row.readyToBuild.value}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[row.scheduledInstalls.health]}`} />
                  {row.scheduledInstalls.value}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[row.installsCompleted.health]}`} />
                  {row.installsCompleted.value}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[row.ptosReceived.health]}`} />
                  {row.ptosReceived.value}
                </span>
              </td>
              <td className="px-4 py-3 text-muted text-xs max-w-[200px] truncate">
                {row.topBottleneck || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/shop-health/AllLocationsView.tsx
git commit -m "feat(shop-health): add AllLocationsView comparison table"
```

---

### Task 17: Main Dashboard Page

**Files:**
- Create: `src/app/dashboards/shop-health/page.tsx`

- [ ] **Step 1: Create the main page component**

This is the orchestrating page. It wires up location tabs, week selector, hero metrics, all section cards, and the bottleneck form.

```typescript
// src/app/dashboards/shop-health/page.tsx
'use client';

import { useState, useMemo } from 'react';
import { startOfWeek } from 'date-fns';
import DashboardShell from '@/components/DashboardShell';
import { useShopHealthData } from '@/hooks/useShopHealthData';
import { useSSE } from '@/hooks/useSSE';
import { DASHBOARD_LOCATION_GROUPS } from '@/lib/dashboard-location-groups';
import { formatWeekParam } from '@/lib/shop-health';
import { HeroMetrics } from './HeroMetrics';
import { SectionCard } from './SectionCard';
import { WeekSelector } from './WeekSelector';
import { PipelineSection } from './PipelineSection';
import { PreconSection } from './PreconSection';
import { SchedulingSection } from './SchedulingSection';
import { OperationsSection } from './OperationsSection';
import { InspectionsSection } from './InspectionsSection';
import { BottleneckSection } from './BottleneckSection';
import { AllLocationsView } from './AllLocationsView';

const LOCATIONS = DASHBOARD_LOCATION_GROUPS;

export default function ShopHealthDashboard() {
  const [selectedSlug, setSelectedSlug] = useState(LOCATIONS[0].slug);
  const [showAllLocations, setShowAllLocations] = useState(false);
  const [weekStart, setWeekStart] = useState(
    () => startOfWeek(new Date(), { weekStartsOn: 1 })
  );

  const weekParam = useMemo(() => formatWeekParam(weekStart), [weekStart]);
  const currentWeekStart = useMemo(
    () => startOfWeek(new Date(), { weekStartsOn: 1 }),
    []
  );
  const isCurrentWeek = weekStart.getTime() === currentWeekStart.getTime();

  const { data, isLoading, error, refetch } = useShopHealthData(selectedSlug, weekParam);

  // SSE real-time invalidation
  const { connected } = useSSE(() => refetch(), {
    cacheKeyFilter: 'shop-health',
  });

  return (
    <DashboardShell
      title="Shop Health"
      accentColor="orange"
      lastUpdated={data?.lastUpdated}
      fullWidth
    >
      {/* Top controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        {/* Location tabs */}
        <div className="flex items-center gap-1 bg-surface rounded-xl p-1 border border-border">
          {LOCATIONS.map((loc) => (
            <button
              key={loc.slug}
              onClick={() => { setSelectedSlug(loc.slug); setShowAllLocations(false); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedSlug === loc.slug && !showAllLocations
                  ? 'bg-orange-500 text-white'
                  : 'text-muted hover:text-foreground hover:bg-surface-2'
              }`}
            >
              {loc.label}
            </button>
          ))}
          <button
            onClick={() => setShowAllLocations(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showAllLocations
                ? 'bg-orange-500 text-white'
                : 'text-muted hover:text-foreground hover:bg-surface-2'
            }`}
          >
            All
          </button>
        </div>

        <WeekSelector weekStart={weekStart} onChange={setWeekStart} />
      </div>

      {/* All Locations comparison view */}
      {showAllLocations ? (
        <AllLocationsView weekStart={weekParam} />
      ) : isLoading ? (
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse bg-surface rounded-xl h-32" />
          ))}
        </div>
      ) : error ? (
        <div className="bg-surface rounded-xl border border-red-500/30 p-6 text-center">
          <p className="text-red-500">Failed to load shop health data.</p>
          <button onClick={() => refetch()} className="mt-2 text-sm text-orange-500 hover:underline">
            Try again
          </button>
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Hero metrics */}
          <HeroMetrics heroes={data.heroes} />

          {/* Section cards */}
          <SectionCard title="Pipeline Overview">
            <PipelineSection data={data.pipeline} />
          </SectionCard>

          <SectionCard title="Preconstruction & RTB">
            <PreconSection data={data.preconstruction} />
          </SectionCard>

          <SectionCard title="Scheduling">
            <SchedulingSection data={data.scheduling} />
          </SectionCard>

          <SectionCard title="Operations">
            <OperationsSection data={data.operations} />
          </SectionCard>

          <SectionCard title="Inspections / Closeout">
            <InspectionsSection data={data.inspections} />
          </SectionCard>

          <SectionCard title="Bottleneck & Actions" defaultOpen>
            <BottleneckSection
              bottleneck={data.bottleneck}
              location={data.location}
              weekStart={weekParam}
              isCurrentWeek={isCurrentWeek}
            />
          </SectionCard>
        </div>
      ) : null}
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i error | head -30`
Expected: No new errors from shop-health files.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/shop-health/page.tsx
git commit -m "feat(shop-health): add main dashboard page

Orchestrates location tabs, week selector, hero metrics,
5 section cards, bottleneck form, and all-locations view."
```

---

## Chunk 5: Integration & Verification

### Task 18: Build Verification

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -30`
Expected: No errors.

- [ ] **Step 2: Run ESLint**

Run: `npx eslint src/app/dashboards/shop-health/ src/lib/shop-health*.ts src/hooks/useShopHealthData.ts --max-warnings=0 2>&1 | tail -20`
Expected: No errors.

- [ ] **Step 3: Run full build**

Run: `npm run build 2>&1 | tail -30`
Expected: Build succeeds. The new page route appears in the build output.

- [ ] **Step 4: Fix any build errors discovered**

Address any type errors, missing imports, or lint issues found in steps 1-3.

- [ ] **Step 5: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix(shop-health): address build errors"
```

---

### Task 19: Manual Smoke Test Checklist

After `npm run dev`, verify:

- [ ] Navigate to `/dashboards/shop-health` — page loads without errors
- [ ] Location tabs switch between Westminster, Centennial, Colorado Springs, California
- [ ] "All" tab shows comparison table
- [ ] Week selector navigates backward, forward button disabled on current week
- [ ] Hero metrics row shows 6 cards (first one deferred placeholder)
- [ ] Each section card expands/collapses
- [ ] Bottleneck form fields are editable on current week, read-only on past weeks
- [ ] Bottleneck auto-saves on field blur
- [ ] No console errors in browser DevTools
- [ ] Access `/suites/executive` — Shop Health card appears
- [ ] Log in as non-OPS_MGR role — `/dashboards/shop-health` returns 403
