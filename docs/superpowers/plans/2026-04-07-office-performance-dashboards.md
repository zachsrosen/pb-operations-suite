# Office Performance Dashboards Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build per-office ambient display dashboards for all 5 PB locations, showing auto-rotating carousel sections (Pipeline, Surveys, Installs, Inspections) with individual leaderboards, streaks, and real-time updates via SSE.

**Architecture:** New Prisma model (`OfficeGoal`) for monthly targets, a server-side aggregation module (`lib/office-performance.ts`) that joins HubSpot projects + Zuper jobs + QC metrics + scheduling data, a single API endpoint per location, and a client-side carousel page with 4 section components. Full-viewport dark theme for TV ambient display.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Prisma 7.3, React Query v5, SSE via `useSSE`, Zuper API, HubSpot API, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-04-07-office-performance-dashboards-design.md`

---

## Chunk 1: Database, Types, and Location Slug Mapping

### Task 1: Add OfficeGoal Prisma Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add OfficeGoal model to schema**

Open `prisma/schema.prisma` and add the `OfficeGoal` model after the `RevenueGoal` model (around line 1805):

```prisma
model OfficeGoal {
  id        String   @id @default(cuid())
  location  String
  metric    String   // "surveys_completed", "installs_completed", "inspections_completed", "projects_completed"
  target    Int
  month     Int      // 1-12
  year      Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([location, metric, month, year])
  @@index([location, year])
}
```

- [ ] **Step 2: Generate migration**

Run: `npx prisma migrate dev --name add-office-goal`
Expected: Migration created successfully, `src/generated/prisma` regenerated.

- [ ] **Step 3: Verify generated client**

Run: `npx prisma generate`
Expected: Prisma client generated with `OfficeGoal` model available.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add OfficeGoal model for per-office monthly targets"
```

---

### Task 2: Create Types and Location Slug Mapping

**Files:**
- Create: `src/lib/office-performance-types.ts`
- Modify: `src/lib/locations.ts`

- [ ] **Step 1: Write the types file**

Create `src/lib/office-performance-types.ts`:

```typescript
export interface PersonStat {
  name: string;
  count: number;
  avgMetric?: number;
  streak?: { type: string; value: number; label: string };
}

export interface InspectionPersonStat extends PersonStat {
  passRate: number;
  consecutivePasses?: number;
}

export interface StageCount {
  stage: string;
  count: number;
}

export interface PipelineData {
  activeProjects: number;
  completedMtd: number;
  completedGoal: number;
  overdueCount: number;
  avgDaysInStage: number;
  avgDaysInStagePrior: number;
  stageDistribution: StageCount[];
  recentWins: string[];
}

export interface SurveyData {
  completedMtd: number;
  completedGoal: number;
  avgTurnaroundDays: number;
  avgTurnaroundPrior: number;
  scheduledThisWeek: number;
  leaderboard: PersonStat[];
}

export interface InstallData {
  completedMtd: number;
  completedGoal: number;
  avgDaysPerInstall: number;
  avgDaysPerInstallPrior: number;
  capacityUtilization: number;
  scheduledThisWeek: number;
  installerLeaderboard: PersonStat[];
  electricianLeaderboard: PersonStat[];
}

export interface InspectionData {
  completedMtd: number;
  completedGoal: number;
  firstPassRate: number;
  avgConstructionDays: number;
  avgConstructionDaysPrior: number;
  avgCcToPtoDays: number;
  avgCcToPtoDaysPrior: number;
  leaderboard: InspectionPersonStat[];
}

export interface OfficePerformanceData {
  location: string;
  lastUpdated: string;
  pipeline: PipelineData;
  surveys: SurveyData;
  installs: InstallData;
  inspections: InspectionData;
}

export type OfficeMetricName =
  | "surveys_completed"
  | "installs_completed"
  | "inspections_completed"
  | "projects_completed";

/** Carousel section identifiers */
export type CarouselSection = "pipeline" | "surveys" | "installs" | "inspections";

export const CAROUSEL_SECTIONS: CarouselSection[] = [
  "pipeline",
  "surveys",
  "installs",
  "inspections",
];

export const SECTION_COLORS: Record<CarouselSection, string> = {
  pipeline: "#f97316",   // orange
  surveys: "#3b82f6",    // blue
  installs: "#22c55e",   // green
  inspections: "#06b6d4", // cyan
};

export const SECTION_LABELS: Record<CarouselSection, string> = {
  pipeline: "PIPELINE OVERVIEW",
  surveys: "SURVEYS",
  installs: "INSTALLS",
  inspections: "INSPECTIONS & QUALITY",
};
```

- [ ] **Step 2: Add slug mapping to locations.ts**

Open `src/lib/locations.ts` and add these exports at the bottom of the file:

```typescript
/** URL-friendly slug ↔ canonical location mapping for office-performance routes */
export const LOCATION_SLUG_TO_CANONICAL: Record<string, CanonicalLocation> = {
  "westminster": "Westminster",
  "centennial": "Centennial",
  "colorado-springs": "Colorado Springs",
  "san-luis-obispo": "San Luis Obispo",
  "camarillo": "Camarillo",
};

export const CANONICAL_TO_LOCATION_SLUG: Record<CanonicalLocation, string> = {
  "Westminster": "westminster",
  "Centennial": "centennial",
  "Colorado Springs": "colorado-springs",
  "San Luis Obispo": "san-luis-obispo",
  "Camarillo": "camarillo",
};
```

- [ ] **Step 3: Add query key for office-performance**

Open `src/lib/query-keys.ts` and add to the `queryKeys` object:

```typescript
officePerformance: {
  root: ["office-performance"] as const,
  location: (slug: string) =>
    [...queryKeys.officePerformance.root, slug] as const,
},
```

Also update `cacheKeyToQueryKeys()` to handle the new key — add a branch:

```typescript
if (serverKey.startsWith("office-performance")) return [queryKeys.officePerformance.root];
```

- [ ] **Step 4: Add cache key constant**

Open `src/lib/cache.ts` and add to the `CACHE_KEYS` object:

```typescript
OFFICE_PERFORMANCE: (location: string) => `office-performance:${location}`,
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/office-performance-types.ts src/lib/locations.ts src/lib/query-keys.ts src/lib/cache.ts
git commit -m "feat: add office performance types, slug mapping, query keys, cache keys"
```

---

### Task 3: Write Tests for Location Slug Mapping

**Files:**
- Create: `src/__tests__/office-performance-types.test.ts`

- [ ] **Step 1: Write tests**

Create `src/__tests__/office-performance-types.test.ts`:

```typescript
import { LOCATION_SLUG_TO_CANONICAL, CANONICAL_TO_LOCATION_SLUG, CANONICAL_LOCATIONS } from "@/lib/locations";

describe("Office Performance Location Slugs", () => {
  it("maps all 5 slugs to canonical locations", () => {
    expect(Object.keys(LOCATION_SLUG_TO_CANONICAL)).toHaveLength(5);
    expect(LOCATION_SLUG_TO_CANONICAL["westminster"]).toBe("Westminster");
    expect(LOCATION_SLUG_TO_CANONICAL["centennial"]).toBe("Centennial");
    expect(LOCATION_SLUG_TO_CANONICAL["colorado-springs"]).toBe("Colorado Springs");
    expect(LOCATION_SLUG_TO_CANONICAL["san-luis-obispo"]).toBe("San Luis Obispo");
    expect(LOCATION_SLUG_TO_CANONICAL["camarillo"]).toBe("Camarillo");
  });

  it("maps all canonical locations back to slugs", () => {
    expect(Object.keys(CANONICAL_TO_LOCATION_SLUG)).toHaveLength(5);
    expect(CANONICAL_TO_LOCATION_SLUG["Westminster"]).toBe("westminster");
    expect(CANONICAL_TO_LOCATION_SLUG["Colorado Springs"]).toBe("colorado-springs");
  });

  it("covers every canonical location", () => {
    for (const loc of CANONICAL_LOCATIONS) {
      expect(CANONICAL_TO_LOCATION_SLUG[loc]).toBeDefined();
    }
  });

  it("round-trips slug → canonical → slug", () => {
    for (const [slug, canonical] of Object.entries(LOCATION_SLUG_TO_CANONICAL)) {
      expect(CANONICAL_TO_LOCATION_SLUG[canonical as keyof typeof CANONICAL_TO_LOCATION_SLUG]).toBe(slug);
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- --testPathPattern="office-performance-types" --verbose`
Expected: All 4 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/office-performance-types.test.ts
git commit -m "test: add location slug mapping tests for office performance"
```

---

## Chunk 2: Server-Side Data Aggregation

### Task 4: Build the Office Performance Aggregation Module

**Files:**
- Create: `src/lib/office-performance.ts`

This is the core data aggregation module. It pulls from multiple upstream sources and returns a single `OfficePerformanceData` object. This is a large file — it's acceptable because it's a single-responsibility aggregation layer.

- [ ] **Step 1: Create the module with goal-fetching and pipeline aggregation**

Create `src/lib/office-performance.ts`:

```typescript
import { prisma } from "@/lib/db";
import { fetchAllProjects } from "@/lib/hubspot";
import { normalizeLocation } from "@/lib/locations";
import type {
  OfficePerformanceData,
  PipelineData,
  SurveyData,
  InstallData,
  InspectionData,
  PersonStat,
  InspectionPersonStat,
  OfficeMetricName,
} from "@/lib/office-performance-types";

// ---------- Goals ----------

const DEFAULT_GOALS: Record<OfficeMetricName, number> = {
  projects_completed: 15,
  surveys_completed: 25,
  installs_completed: 12,
  inspections_completed: 10,
};

export async function getGoalsForLocation(
  location: string,
  month: number,
  year: number
): Promise<Record<OfficeMetricName, number>> {
  const goals = { ...DEFAULT_GOALS };
  if (!prisma) return goals;

  const rows = await prisma.officeGoal.findMany({
    where: { location, month, year },
  });

  for (const row of rows) {
    if (row.metric in goals) {
      goals[row.metric as OfficeMetricName] = row.target;
    }
  }

  // Fallback: if no goals for this month, try prior month
  if (rows.length === 0) {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const fallback = await prisma.officeGoal.findMany({
      where: { location, month: prevMonth, year: prevYear },
    });
    for (const row of fallback) {
      if (row.metric in goals) {
        goals[row.metric as OfficeMetricName] = row.target;
      }
    }
  }

  return goals;
}

// ---------- Stage Normalization ----------

const STAGE_MAP: Record<string, string> = {
  "site survey": "Survey",
  "survey": "Survey",
  "design": "Design",
  "design approval": "Design",
  "permitting": "Permit",
  "permit": "Permit",
  "ready to build": "RTB",
  "rtb": "RTB",
  "construction": "Install",
  "install": "Install",
  "installation": "Install",
  "inspection": "Inspect",
  "pto": "PTO",
};

function normalizeStage(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return STAGE_MAP[lower] || raw;
}

// ---------- Pipeline Aggregation ----------

// Matches the real RawProject shape from src/lib/types.ts and Project from src/lib/hubspot.ts
interface ProjectForMetrics {
  pbLocation?: string | null;
  stage?: string;
  amount?: number;
  ptoGrantedDate?: string | null;        // NOT "ptoDate" — real field name
  forecastedInstallDate?: string | null;
  forecastedInspectionDate?: string | null;
  forecastedPtoDate?: string | null;
  constructionCompleteDate?: string | null;
  constructionScheduleDate?: string | null;
  inspectionPassDate?: string | null;
  daysSinceStageMovement?: number;        // NOT "daysInCurrentStage" — real field name
  closeDate?: string | null;
  siteSurveyTurnaroundTime?: number | null;  // From Project (hubspot.ts)
  constructionTurnaroundTime?: number | null;
  timeCcToPto?: number | null;
  isFirstTimeInspectionPass?: boolean;
}

export function buildPipelineData(
  projects: ProjectForMetrics[],
  goals: Record<OfficeMetricName, number>,
  now: Date
): PipelineData {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Stage distribution
  const stageCounts: Record<string, number> = {};
  let overdueCount = 0;
  let totalDaysInStage = 0;
  let daysInStageCount = 0;
  // Prior period avg will be enriched from QC metrics in the orchestrator
  let avgDaysInStagePrior = 0;

  for (const p of projects) {
    const stage = normalizeStage(p.stage || "Unknown");
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;

    // Overdue check
    const forecastDates = [
      p.forecastedInstallDate,
      p.forecastedInspectionDate,
      p.forecastedPtoDate,
    ].filter(Boolean);
    for (const d of forecastDates) {
      if (d && new Date(d) < now) {
        overdueCount++;
        break;
      }
    }

    // Days in current stage
    if (p.daysSinceStageMovement != null) {
      totalDaysInStage += p.daysSinceStageMovement;
      daysInStageCount++;
    }
  }

  // Completed MTD = projects with PTO date in current month
  const completedMtd = projects.filter((p) => {
    const ptoDate = p.ptoGrantedDate ? new Date(p.ptoGrantedDate) : null;
    return ptoDate && ptoDate >= mtdStart && ptoDate <= now;
  }).length;

  // Recent wins
  const recentWins: string[] = [];
  const ptosThisWeek = projects.filter((p) => {
    const ptoDate = p.ptoGrantedDate ? new Date(p.ptoGrantedDate) : null;
    return ptoDate && ptoDate >= weekAgo && ptoDate <= now;
  }).length;
  if (ptosThisWeek > 0) {
    recentWins.push(`🎉 ${ptosThisWeek} PTO${ptosThisWeek > 1 ? "s" : ""} granted this week`);
  }

  const stageDistribution = ["Survey", "Design", "Permit", "RTB", "Install", "Inspect"]
    .map((stage) => ({ stage, count: stageCounts[stage] || 0 }));

  return {
    activeProjects: projects.length,
    completedMtd,
    completedGoal: goals.projects_completed,
    overdueCount,
    avgDaysInStage: daysInStageCount > 0 ? Math.round((totalDaysInStage / daysInStageCount) * 10) / 10 : 0,
    avgDaysInStagePrior, // Enriched from QC metrics in orchestrator
    stageDistribution,
    recentWins,
  };
}

// ---------- Zuper Job Aggregation ----------

interface CachedJob {
  jobUid: string;
  jobCategory: string;
  jobStatus: string;
  completedDate: Date | null;
  scheduledStart: Date | null;
  assignedUsers: unknown;
  hubspotDealId: string | null;
}

interface UserJobCount {
  name: string;
  userUid: string;
  count: number;
}

function extractAssignedUsers(assignedUsers: unknown): Array<{ user_uid: string; user_name: string }> {
  if (!Array.isArray(assignedUsers)) return [];
  return assignedUsers
    .filter((u): u is { user_uid: string; user_name: string } =>
      typeof u === "object" && u !== null && "user_uid" in u && "user_name" in u
    );
}

function buildLeaderboard(
  userCounts: UserJobCount[],
  monthlyHistory?: Map<string, UserJobCount[]>
): PersonStat[] {
  return userCounts
    .sort((a, b) => b.count - a.count)
    .map((u) => {
      const stat: PersonStat = { name: u.name, count: u.count };

      // Compute monthly leader streak
      if (monthlyHistory) {
        let streak = 0;
        for (const [, monthUsers] of [...monthlyHistory].reverse()) {
          const leader = monthUsers.sort((a, b) => b.count - a.count)[0];
          if (leader?.userUid === u.userUid) {
            streak++;
          } else {
            break;
          }
        }
        if (streak >= 2) {
          stat.streak = {
            type: "monthly_leader",
            value: streak,
            label: `🔥 ${streak}-mo streak leading`,
          };
        }
      }

      return stat;
    });
}

export async function getZuperJobsByLocation(
  location: string,
  category: string,
  fromDate: Date,
  toDate: Date
): Promise<CachedJob[]> {
  if (!prisma) return [];

  // Query ZuperJobCache, join with HubSpotProjectCache for location
  const jobs = await prisma.zuperJobCache.findMany({
    where: {
      jobCategory: category,
      completedDate: { gte: fromDate, lte: toDate },
      hubspotDealId: { not: null },
    },
    select: {
      jobUid: true,
      jobCategory: true,
      jobStatus: true,
      completedDate: true,
      scheduledStart: true,
      assignedUsers: true,
      hubspotDealId: true,
    },
  });

  // Filter by location via HubSpotProjectCache
  if (jobs.length === 0) return [];

  const dealIds = jobs
    .map((j) => j.hubspotDealId)
    .filter((id): id is string => id !== null);

  const projectCache = await prisma.hubSpotProjectCache.findMany({
    where: { dealId: { in: dealIds } },
    select: { dealId: true, pbLocation: true },
  });

  const dealLocationMap = new Map(
    projectCache.map((p) => [p.dealId, p.pbLocation])
  );

  return jobs.filter((j) => {
    const loc = j.hubspotDealId ? dealLocationMap.get(j.hubspotDealId) : null;
    return normalizeLocation(loc) === location;
  });
}

export async function getScheduledJobsThisWeek(
  location: string,
  category: string,
  now: Date
): Promise<number> {
  if (!prisma) return 0;

  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const jobs = await prisma.zuperJobCache.findMany({
    where: {
      jobCategory: category,
      jobStatus: { in: ["SCHEDULED", "UNSCHEDULED"] },
      scheduledStart: { gte: now, lte: weekEnd },
      hubspotDealId: { not: null },
    },
    select: { hubspotDealId: true },
  });

  const dealIds = jobs
    .map((j) => j.hubspotDealId)
    .filter((id): id is string => id !== null);

  if (dealIds.length === 0) return 0;

  const projectCache = await prisma.hubSpotProjectCache.findMany({
    where: { dealId: { in: dealIds } },
    select: { dealId: true, pbLocation: true },
  });

  const matching = projectCache.filter(
    (p) => normalizeLocation(p.pbLocation) === location
  );
  return matching.length;
}

// ---------- Survey Section ----------

export async function buildSurveyData(
  location: string,
  goals: Record<OfficeMetricName, number>,
  now: Date
): Promise<SurveyData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // MTD completed surveys
  const mtdJobs = await getZuperJobsByLocation(location, "Site Survey", mtdStart, now);

  // Prior period for trend comparison
  const priorStart = new Date(mtdStart);
  priorStart.setMonth(priorStart.getMonth() - 1);
  const priorEnd = new Date(mtdStart);

  // User counts for leaderboard
  const userCounts = new Map<string, UserJobCount>();
  for (const job of mtdJobs) {
    for (const user of extractAssignedUsers(job.assignedUsers)) {
      const existing = userCounts.get(user.user_uid) || {
        name: user.user_name,
        userUid: user.user_uid,
        count: 0,
      };
      existing.count++;
      userCounts.set(user.user_uid, existing);
    }
  }

  // Scheduled this week
  const scheduledThisWeek = await getScheduledJobsThisWeek(location, "Site Survey", now);

  return {
    completedMtd: mtdJobs.length,
    completedGoal: goals.surveys_completed,
    avgTurnaroundDays: 0, // Populated from QC metrics in the orchestrator
    avgTurnaroundPrior: 0,
    scheduledThisWeek,
    leaderboard: buildLeaderboard([...userCounts.values()]),
  };
}

// ---------- Install Section ----------

export async function buildInstallData(
  location: string,
  goals: Record<OfficeMetricName, number>,
  now: Date
): Promise<InstallData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const mtdJobs = await getZuperJobsByLocation(location, "Construction", mtdStart, now);

  // Split by role (installer vs electrician) using CrewMember lookup
  const installerCounts = new Map<string, UserJobCount>();
  const electricianCounts = new Map<string, UserJobCount>();

  // Fetch crew members to determine roles
  const crewMembers = await (prisma?.crewMember.findMany({
    where: { isActive: true, locations: { hasSome: [location] } },
    select: { zuperUserUid: true, role: true, name: true },
  }) ?? []);

  const crewRoleMap = new Map(
    crewMembers.map((c) => [c.zuperUserUid, c.role])
  );

  for (const job of mtdJobs) {
    for (const user of extractAssignedUsers(job.assignedUsers)) {
      const role = crewRoleMap.get(user.user_uid);
      const target = role === "electrician" ? electricianCounts : installerCounts;
      const existing = target.get(user.user_uid) || {
        name: user.user_name,
        userUid: user.user_uid,
        count: 0,
      };
      existing.count++;
      target.set(user.user_uid, existing);
    }
  }

  // Capacity utilization — count distinct crew members with construction availability.
  // CrewAvailability.location stores non-canonical aliases like "DTC" and "SLO",
  // so we query ALL construction availability and filter by normalizing each record's location.
  let capacityUtilization = -1; // -1 means N/A
  const allConstructionAvail = await (prisma?.crewAvailability.findMany({
    where: { jobType: "construction", isActive: true },
    select: { crewMemberId: true, dayOfWeek: true, location: true },
  }) ?? []);
  const availability = allConstructionAvail.filter(
    (slot) => normalizeLocation(slot.location) === location
  );

  if (availability.length > 0) {
    // Count distinct crew members and their available days per week
    const crewDaysPerWeek = new Map<string, number>();
    for (const slot of availability) {
      crewDaysPerWeek.set(
        slot.crewMemberId,
        (crewDaysPerWeek.get(slot.crewMemberId) || 0) + 1
      );
    }
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const weeksInMonth = daysInMonth / 7;
    let totalAvailableDays = 0;
    for (const daysPerWeek of crewDaysPerWeek.values()) {
      totalAvailableDays += daysPerWeek * weeksInMonth;
    }
    if (totalAvailableDays > 0) {
      capacityUtilization = Math.round((mtdJobs.length / totalAvailableDays) * 100);
    }
  }

  const scheduledThisWeek = await getScheduledJobsThisWeek(location, "Construction", now);

  return {
    completedMtd: mtdJobs.length,
    completedGoal: goals.installs_completed,
    avgDaysPerInstall: 0, // Populated from QC metrics in orchestrator
    avgDaysPerInstallPrior: 0,
    capacityUtilization,
    scheduledThisWeek,
    installerLeaderboard: buildLeaderboard([...installerCounts.values()]),
    electricianLeaderboard: buildLeaderboard([...electricianCounts.values()]),
  };
}

// ---------- Inspection Section ----------

export async function buildInspectionData(
  location: string,
  goals: Record<OfficeMetricName, number>,
  now: Date
): Promise<InspectionData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const mtdJobs = await getZuperJobsByLocation(location, "Inspection", mtdStart, now);

  const userCounts = new Map<string, UserJobCount>();
  for (const job of mtdJobs) {
    for (const user of extractAssignedUsers(job.assignedUsers)) {
      const existing = userCounts.get(user.user_uid) || {
        name: user.user_name,
        userUid: user.user_uid,
        count: 0,
      };
      existing.count++;
      userCounts.set(user.user_uid, existing);
    }
  }

  // Build leaderboard with pass rate (placeholder — will be enriched with HubSpot data)
  const leaderboard: InspectionPersonStat[] = [...userCounts.values()]
    .sort((a, b) => b.count - a.count)
    .map((u) => ({
      name: u.name,
      count: u.count,
      passRate: 0, // TODO: Enrich from HubSpot inspection status
    }));

  return {
    completedMtd: mtdJobs.length,
    completedGoal: goals.inspections_completed,
    firstPassRate: 0, // Populated from QC metrics
    avgConstructionDays: 0,
    avgConstructionDaysPrior: 0,
    avgCcToPtoDays: 0,
    avgCcToPtoDaysPrior: 0,
    leaderboard,
  };
}

// ---------- QC Metrics Enrichment ----------

/**
 * Fetches QC turnaround metrics from the same logic as /api/hubspot/qc-metrics
 * and patches the section data objects with rolling averages and trend comparisons.
 */
async function enrichWithQcMetrics(
  location: string,
  pipeline: PipelineData,
  surveys: SurveyData,
  installs: InstallData,
  inspections: InspectionData
): Promise<void> {
  try {
    // Reuse appCache to avoid redundant QC computation
    const { appCache, CACHE_KEYS } = await import("@/lib/cache");

    // Fetch QC data for 60-day and prior 60-day windows
    // Uses the same project data that qc-metrics route.ts computes
    const { data: allProjects } = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false })
    );

    const locProjects = (allProjects || []).filter(
      (p: ProjectForMetrics) => normalizeLocation(p.pbLocation) === location
    );

    // Compute rolling 60-day averages from projects with constructionCompleteDate
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const oneTwentyDaysAgo = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

    const recentProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.constructionCompleteDate && new Date(p.constructionCompleteDate) >= sixtyDaysAgo
    );
    const priorProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.constructionCompleteDate &&
      new Date(p.constructionCompleteDate) >= oneTwentyDaysAgo &&
      new Date(p.constructionCompleteDate) < sixtyDaysAgo
    );

    // Helper to compute average of a numeric field
    function avg(arr: ProjectForMetrics[], field: keyof ProjectForMetrics): number {
      const vals = arr.map((p) => p[field]).filter((v): v is number => typeof v === "number" && v > 0);
      if (vals.length === 0) return 0;
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    }

    // Use the real Project field names (from hubspot.ts):
    //   siteSurveyTurnaroundTime — days from survey schedule to DA ready
    //   constructionTurnaroundTime — days from construction start to complete
    //   timeCcToPto — days from construction complete to PTO
    //   isFirstTimeInspectionPass — boolean, true if inspection passed first try

    // Surveys: turnaround
    surveys.avgTurnaroundDays = avg(recentProjects, "siteSurveyTurnaroundTime");
    surveys.avgTurnaroundPrior = avg(priorProjects, "siteSurveyTurnaroundTime");

    // Installs: construction turnaround
    installs.avgDaysPerInstall = avg(recentProjects, "constructionTurnaroundTime");
    installs.avgDaysPerInstallPrior = avg(priorProjects, "constructionTurnaroundTime");

    // Inspections: construction time, CC→PTO, first-pass rate
    inspections.avgConstructionDays = avg(recentProjects, "constructionTurnaroundTime");
    inspections.avgConstructionDaysPrior = avg(priorProjects, "constructionTurnaroundTime");
    inspections.avgCcToPtoDays = avg(recentProjects, "timeCcToPto");
    inspections.avgCcToPtoDaysPrior = avg(priorProjects, "timeCcToPto");

    // First-pass inspection rate
    const withInspection = recentProjects.filter(
      (p: ProjectForMetrics) => p.inspectionPassDate
    );
    if (withInspection.length > 0) {
      const firstTimePasses = withInspection.filter(
        (p: ProjectForMetrics) => p.isFirstTimeInspectionPass
      ).length;
      inspections.firstPassRate = Math.round(
        (firstTimePasses / withInspection.length) * 100
      );
    }

    // Pipeline: avg days in stage prior period
    pipeline.avgDaysInStagePrior = avg(priorProjects, "daysSinceStageMovement");
  } catch (err) {
    console.error("[office-performance] QC metrics enrichment failed:", err);
    // Non-fatal — sections will show 0/"--" for turnaround metrics
  }
}

// ---------- Main Orchestrator ----------

export async function getOfficePerformanceData(
  location: string
): Promise<OfficePerformanceData> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Fetch goals
  const goals = await getGoalsForLocation(location, month, year);

  // Fetch projects for this location
  const allProjects = await fetchAllProjects({ activeOnly: true });
  const locationProjects = (allProjects || []).filter(
    (p: ProjectForMetrics) => normalizeLocation(p.pbLocation) === location
  );

  // Build pipeline data
  const pipeline = buildPipelineData(locationProjects, goals, now);

  // Build section data in parallel
  const [surveys, installs, inspections] = await Promise.all([
    buildSurveyData(location, goals, now),
    buildInstallData(location, goals, now),
    buildInspectionData(location, goals, now),
  ]);

  // Enrich with QC metrics turnaround times
  await enrichWithQcMetrics(location, pipeline, surveys, installs, inspections);

  return {
    location,
    lastUpdated: now.toISOString(),
    pipeline,
    surveys,
    installs,
    inspections,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors in `office-performance.ts`. Some unrelated errors may appear from other files — that's OK. Focus on the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/office-performance.ts
git commit -m "feat: add office performance data aggregation module

Aggregates pipeline, survey, install, and inspection metrics
per location from HubSpot projects, Zuper job cache, crew
availability, and office goals."
```

---

### Task 5: Build the API Route

**Files:**
- Create: `src/app/api/office-performance/[location]/route.ts`

- [ ] **Step 1: Create the API route handler**

Create directory and file `src/app/api/office-performance/[location]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { LOCATION_SLUG_TO_CANONICAL } from "@/lib/locations";
import { getOfficePerformanceData } from "@/lib/office-performance";
import type { OfficePerformanceData } from "@/lib/office-performance-types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ location: string }> }
) {
  try {
    const { location: slug } = await params;
    const canonicalLocation = LOCATION_SLUG_TO_CANONICAL[slug];

    if (!canonicalLocation) {
      return NextResponse.json(
        { error: `Unknown location: ${slug}` },
        { status: 404 }
      );
    }

    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";
    const cacheKey = CACHE_KEYS.OFFICE_PERFORMANCE(slug);

    const { data, cached, stale, lastUpdated } =
      await appCache.getOrFetch<OfficePerformanceData>(
        cacheKey,
        () => getOfficePerformanceData(canonicalLocation),
        forceRefresh
      );

    return NextResponse.json({
      ...data,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("[office-performance] API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch office performance data" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "office-performance"`
Expected: No errors referencing the new route file.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/office-performance/
git commit -m "feat: add GET /api/office-performance/[location] endpoint

Cached aggregation endpoint returning pipeline, survey, install,
and inspection metrics for a single office location."
```

---

## Chunk 3: Carousel UI Components

### Task 6: Build the Carousel Header Component

**Files:**
- Create: `src/app/dashboards/office-performance/[location]/CarouselHeader.tsx`

- [ ] **Step 1: Create the header component**

```typescript
"use client";

import { useEffect, useState } from "react";
import { CAROUSEL_SECTIONS, SECTION_COLORS, type CarouselSection } from "@/lib/office-performance-types";

interface CarouselHeaderProps {
  location: string;
  currentSection: CarouselSection;
  isPinned: boolean;
  connected: boolean;
  reconnecting: boolean;
  stale: boolean;
  onDotClick: (section: CarouselSection) => void;
}

export default function CarouselHeader({
  location,
  currentSection,
  isPinned,
  connected,
  reconnecting,
  stale,
  onDotClick,
}: CarouselHeaderProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const statusColor = reconnecting
    ? "#eab308"
    : connected
      ? "#22c55e"
      : "#ef4444";

  const statusLabel = reconnecting
    ? "Reconnecting..."
    : stale
      ? "Data may be stale"
      : "";

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
      <div className="flex items-center gap-3">
        <div
          className="w-2.5 h-2.5 rounded-full animate-pulse"
          style={{ backgroundColor: statusColor }}
        />
        <span className="text-lg font-bold tracking-wider text-slate-200 uppercase">
          {location}
        </span>
        {statusLabel && (
          <span className="text-xs text-yellow-500 ml-2">{statusLabel}</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          {CAROUSEL_SECTIONS.map((section) => (
            <button
              key={section}
              onClick={() => onDotClick(section)}
              className="w-2 h-2 rounded-full transition-all duration-200 hover:scale-150"
              style={{
                backgroundColor:
                  section === currentSection
                    ? SECTION_COLORS[section]
                    : "rgba(255,255,255,0.2)",
              }}
              aria-label={`Go to ${section} section${isPinned && section === currentSection ? " (pinned)" : ""}`}
            />
          ))}
          {isPinned && (
            <span className="text-xs text-slate-500 ml-1">📌</span>
          )}
        </div>

        <span className="text-sm text-slate-400">
          {time.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}{" "}
          · {time.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/office-performance/
git commit -m "feat: add CarouselHeader component with live clock and section dots"
```

---

### Task 7: Build the Reusable Leaderboard and GoalProgress Components

**Files:**
- Create: `src/app/dashboards/office-performance/[location]/Leaderboard.tsx`
- Create: `src/app/dashboards/office-performance/[location]/GoalProgress.tsx`

- [ ] **Step 1: Create the Leaderboard component**

```typescript
"use client";

import type { PersonStat, InspectionPersonStat } from "@/lib/office-performance-types";

interface LeaderboardProps {
  title: string;
  icon: string;
  entries: (PersonStat | InspectionPersonStat)[];
  accentColor: string;
  showPassRate?: boolean;
}

const RANK_COLORS = ["#fbbf24", "#d1d5db", "#b45309"];

export default function Leaderboard({
  title,
  icon,
  entries,
  accentColor,
  showPassRate = false,
}: LeaderboardProps) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-4">
      <div className="text-xs font-semibold text-slate-400 tracking-wider mb-3">
        {icon} {title}
      </div>
      <div className="flex flex-col gap-2.5">
        {entries.map((entry, i) => (
          <div
            key={entry.name}
            className="flex items-center gap-2 rounded-md px-3 py-2"
            style={{
              background: i === 0 ? "rgba(251,191,36,0.08)" : "transparent",
              border: i === 0 ? "1px solid rgba(251,191,36,0.15)" : "none",
            }}
          >
            <span
              className="text-lg font-extrabold w-6"
              style={{ color: RANK_COLORS[i] || "#94a3b8" }}
            >
              {i + 1}
            </span>
            <span className="text-sm font-semibold flex-1 text-slate-200">
              {entry.name}
            </span>
            <span
              className="text-xl font-extrabold"
              style={{ color: accentColor }}
            >
              {entry.count}
            </span>
            <span className="text-xs text-slate-400 w-16">
              {entry.count === 1 ? "job" : "jobs"}
            </span>
            {showPassRate && "passRate" in entry && (
              <span
                className="text-xs font-medium"
                style={{
                  color:
                    entry.passRate >= 90
                      ? "#22c55e"
                      : entry.passRate >= 75
                        ? "#eab308"
                        : "#ef4444",
                }}
              >
                {entry.passRate}% pass
              </span>
            )}
            {entry.streak && (
              <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                {entry.streak.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the GoalProgress component**

```typescript
"use client";

import { useEffect, useRef, useState } from "react";

interface GoalProgressProps {
  current: number;
  goal: number;
  label: string;
  accentColor: string;
}

export default function GoalProgress({
  current,
  goal,
  label,
  accentColor,
}: GoalProgressProps) {
  const percentage = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
  const isGoalHit = current >= goal && goal > 0;
  const [showCelebration, setShowCelebration] = useState(false);
  const hasCelebrated = useRef(false);

  useEffect(() => {
    if (isGoalHit && !hasCelebrated.current) {
      hasCelebrated.current = true;
      setShowCelebration(true);
      const timer = setTimeout(() => setShowCelebration(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isGoalHit]);

  return (
    <div className="text-center">
      <div
        className="text-[42px] font-extrabold transition-colors"
        style={{ color: isGoalHit ? "#22c55e" : accentColor }}
        key={String(current)}
      >
        {current}
      </div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
      {goal > 0 && (
        <>
          <div className="text-xs text-slate-500 mt-1">Goal: {goal}</div>
          <div className="h-1 bg-white/10 rounded-full mt-2 mx-4 relative overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${percentage}%`,
                backgroundColor: isGoalHit ? "#22c55e" : accentColor,
              }}
            />
            {showCelebration && (
              <div className="absolute inset-0 bg-yellow-400/30 animate-pulse rounded-full" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/office-performance/[location]/Leaderboard.tsx \
        src/app/dashboards/office-performance/[location]/GoalProgress.tsx
git commit -m "feat: add Leaderboard and GoalProgress reusable components"
```

---

### Task 8: Build the 4 Section Components

**Files:**
- Create: `src/app/dashboards/office-performance/[location]/PipelineSection.tsx`
- Create: `src/app/dashboards/office-performance/[location]/SurveysSection.tsx`
- Create: `src/app/dashboards/office-performance/[location]/InstallsSection.tsx`
- Create: `src/app/dashboards/office-performance/[location]/InspectionsSection.tsx`

- [ ] **Step 1: Create PipelineSection**

```typescript
"use client";

import type { PipelineData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";

interface PipelineSectionProps {
  data: PipelineData;
}

export default function PipelineSection({ data }: PipelineSectionProps) {
  const avgTrend = data.avgDaysInStagePrior > 0
    ? data.avgDaysInStage - data.avgDaysInStagePrior
    : 0;
  const trendImproving = avgTrend < 0;

  return (
    <div className="flex flex-col h-full px-6 py-4">
      <div className="text-sm font-semibold text-orange-500 tracking-widest mb-4">
        PIPELINE OVERVIEW
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-orange-500">{data.activeProjects}</div>
          <div className="text-xs text-slate-400 mt-1">Active Projects</div>
        </div>

        <div className="bg-white/5 rounded-xl p-4">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Completed MTD"
            accentColor="#22c55e"
          />
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div
            className="text-[42px] font-extrabold"
            style={{ color: data.overdueCount > 5 ? "#ef4444" : data.overdueCount > 0 ? "#eab308" : "#22c55e" }}
          >
            {data.overdueCount}
          </div>
          <div className="text-xs text-slate-400 mt-1">Overdue</div>
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-cyan-400">{data.avgDaysInStage}</div>
          <div className="text-xs text-slate-400 mt-1">Avg Days in Stage</div>
          {avgTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendImproving ? "text-green-500" : "text-red-500"}`}>
              {trendImproving ? "▼" : "▲"} {Math.abs(avgTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>
      </div>

      {/* Stage distribution bar chart */}
      <div className="flex gap-1 mb-5 items-end flex-1 min-h-0">
        {data.stageDistribution.map((s) => {
          const maxCount = Math.max(...data.stageDistribution.map((d) => d.count), 1);
          const height = Math.max((s.count / maxCount) * 100, 10);
          const stageColors: Record<string, string> = {
            Survey: "#3b82f6",
            Design: "#8b5cf6",
            Permit: "#f97316",
            RTB: "#22c55e",
            Install: "#06b6d4",
            Inspect: "#ec4899",
          };
          return (
            <div key={s.stage} className="flex-1 text-center">
              <div
                className="rounded-t-md flex items-center justify-center font-bold text-lg mx-auto"
                style={{
                  backgroundColor: stageColors[s.stage] || "#6b7280",
                  height: `${height}%`,
                  minHeight: "24px",
                }}
              >
                {s.count}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">{s.stage}</div>
            </div>
          );
        })}
      </div>

      {/* Recent wins */}
      {data.recentWins.length > 0 && (
        <div className="rounded-lg border border-white/5 bg-white/[0.03] px-4 py-2.5 flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-400 tracking-wider">RECENT WINS</span>
          {data.recentWins.map((win, i) => (
            <span key={i} className="text-sm text-slate-200">{win}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create SurveysSection**

```typescript
"use client";

import type { SurveyData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";
import Leaderboard from "./Leaderboard";

interface SurveysSectionProps {
  data: SurveyData;
}

export default function SurveysSection({ data }: SurveysSectionProps) {
  const turnaroundTrend = data.avgTurnaroundPrior > 0
    ? data.avgTurnaroundDays - data.avgTurnaroundPrior
    : 0;
  const trendImproving = turnaroundTrend < 0;

  return (
    <div className="flex flex-col h-full px-6 py-4">
      <div className="text-sm font-semibold text-blue-500 tracking-widest mb-4">
        SURVEYS
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Completed MTD"
            accentColor="#3b82f6"
          />
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-green-500">
            {data.avgTurnaroundDays > 0 ? data.avgTurnaroundDays.toFixed(1) : "--"}
            {data.avgTurnaroundDays > 0 && <span className="text-xl">d</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">Avg Turnaround</div>
          {turnaroundTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendImproving ? "text-green-500" : "text-red-500"}`}>
              {trendImproving ? "▼" : "▲"} {Math.abs(turnaroundTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-orange-500">{data.scheduledThisWeek}</div>
          <div className="text-xs text-slate-400 mt-1">Scheduled This Week</div>
        </div>
      </div>

      <Leaderboard
        title="SURVEYOR LEADERBOARD — THIS MONTH"
        icon="🏆"
        entries={data.leaderboard}
        accentColor="#3b82f6"
      />
    </div>
  );
}
```

- [ ] **Step 3: Create InstallsSection**

```typescript
"use client";

import type { InstallData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";
import Leaderboard from "./Leaderboard";

interface InstallsSectionProps {
  data: InstallData;
}

export default function InstallsSection({ data }: InstallsSectionProps) {
  const daysTrend = data.avgDaysPerInstallPrior > 0
    ? data.avgDaysPerInstall - data.avgDaysPerInstallPrior
    : 0;
  const trendImproving = daysTrend < 0;

  return (
    <div className="flex flex-col h-full px-6 py-4">
      <div className="text-sm font-semibold text-green-500 tracking-widest mb-4">
        INSTALLS
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Completed MTD"
            accentColor="#22c55e"
          />
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-blue-500">
            {data.avgDaysPerInstall > 0 ? data.avgDaysPerInstall.toFixed(1) : "--"}
            {data.avgDaysPerInstall > 0 && <span className="text-xl">d</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">Avg Days/Install</div>
          {daysTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendImproving ? "text-green-500" : "text-red-500"}`}>
              {trendImproving ? "▼" : "▲"} {Math.abs(daysTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-orange-500">
            {data.capacityUtilization >= 0 ? `${data.capacityUtilization}` : "--"}
            {data.capacityUtilization >= 0 && <span className="text-xl">%</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">Capacity Used</div>
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-cyan-400">{data.scheduledThisWeek}</div>
          <div className="text-xs text-slate-400 mt-1">Scheduled This Week</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Leaderboard
          title="INSTALLERS — THIS MONTH"
          icon="⚡"
          entries={data.installerLeaderboard}
          accentColor="#22c55e"
        />
        <Leaderboard
          title="ELECTRICIANS — THIS MONTH"
          icon="🔌"
          entries={data.electricianLeaderboard}
          accentColor="#22c55e"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create InspectionsSection**

```typescript
"use client";

import type { InspectionData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";
import Leaderboard from "./Leaderboard";

interface InspectionsSectionProps {
  data: InspectionData;
}

export default function InspectionsSection({ data }: InspectionsSectionProps) {
  const constructionTrend = data.avgConstructionDaysPrior > 0
    ? data.avgConstructionDays - data.avgConstructionDaysPrior
    : 0;
  const ccPtoTrend = data.avgCcToPtoDaysPrior > 0
    ? data.avgCcToPtoDays - data.avgCcToPtoDaysPrior
    : 0;

  function trendColor(trend: number): string {
    return trend < 0 ? "text-green-500" : trend > 0 ? "text-red-500" : "text-slate-400";
  }

  function trendArrow(trend: number): string {
    return trend < 0 ? "▼" : trend > 0 ? "▲" : "";
  }

  function passRateColor(rate: number): string {
    if (rate >= 90) return "#22c55e";
    if (rate >= 75) return "#eab308";
    return "#ef4444";
  }

  return (
    <div className="flex flex-col h-full px-6 py-4">
      <div className="text-sm font-semibold text-cyan-400 tracking-widest mb-4">
        INSPECTIONS & QUALITY
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Inspections MTD"
            accentColor="#06b6d4"
          />
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold" style={{ color: passRateColor(data.firstPassRate) }}>
            {data.firstPassRate > 0 ? data.firstPassRate : "--"}
            {data.firstPassRate > 0 && <span className="text-xl">%</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">First-Pass Rate</div>
          <div className="text-xs text-slate-500 mt-0.5">60-day rolling</div>
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-green-500">
            {data.avgConstructionDays > 0 ? data.avgConstructionDays.toFixed(1) : "--"}
            {data.avgConstructionDays > 0 && <span className="text-xl">d</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">Avg Construction Time</div>
          {constructionTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendColor(constructionTrend)}`}>
              {trendArrow(constructionTrend)} {Math.abs(constructionTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div
            className="text-[42px] font-extrabold"
            style={{ color: data.avgCcToPtoDays > 15 ? "#ef4444" : data.avgCcToPtoDays > 10 ? "#eab308" : "#22c55e" }}
          >
            {data.avgCcToPtoDays > 0 ? data.avgCcToPtoDays.toFixed(1) : "--"}
            {data.avgCcToPtoDays > 0 && <span className="text-xl">d</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">CC → PTO</div>
          {ccPtoTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendColor(ccPtoTrend)}`}>
              {trendArrow(ccPtoTrend)} {Math.abs(ccPtoTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>
      </div>

      <Leaderboard
        title="INSPECTION TECHS — THIS MONTH"
        icon="🏆"
        entries={data.leaderboard}
        accentColor="#06b6d4"
        showPassRate
      />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/office-performance/[location]/PipelineSection.tsx \
        src/app/dashboards/office-performance/[location]/SurveysSection.tsx \
        src/app/dashboards/office-performance/[location]/InstallsSection.tsx \
        src/app/dashboards/office-performance/[location]/InspectionsSection.tsx
git commit -m "feat: add 4 carousel section components

PipelineSection, SurveysSection, InstallsSection, InspectionsSection
with leaderboards, goal progress, and trend arrows."
```

---

## Chunk 4: Carousel Container and Page Shell

### Task 9: Build the Carousel Container

**Files:**
- Create: `src/app/dashboards/office-performance/[location]/OfficeCarousel.tsx`

- [ ] **Step 1: Create the carousel with rotation, pinning, and keyboard nav**

```typescript
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CAROUSEL_SECTIONS,
  type CarouselSection,
  type OfficePerformanceData,
} from "@/lib/office-performance-types";
import CarouselHeader from "./CarouselHeader";
import PipelineSection from "./PipelineSection";
import SurveysSection from "./SurveysSection";
import InstallsSection from "./InstallsSection";
import InspectionsSection from "./InspectionsSection";

const ROTATION_INTERVAL = 45_000; // 45 seconds

interface OfficeCarouselProps {
  data: OfficePerformanceData;
  connected: boolean;
  reconnecting: boolean;
  stale: boolean;
}

export default function OfficeCarousel({
  data,
  connected,
  reconnecting,
  stale,
}: OfficeCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPinned, setIsPinned] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [fadeIn, setFadeIn] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentSection = CAROUSEL_SECTIONS[currentIndex];

  // Page Visibility API
  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Auto-rotation
  useEffect(() => {
    if (isPinned || !isVisible) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }

    intervalRef.current = setInterval(() => {
      setFadeIn(false);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % CAROUSEL_SECTIONS.length);
        setFadeIn(true);
      }, 300);
    }, ROTATION_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPinned, isVisible]);

  // Navigate to section
  const goToSection = useCallback(
    (section: CarouselSection) => {
      const index = CAROUSEL_SECTIONS.indexOf(section);
      if (index === currentIndex) {
        setIsPinned((prev) => !prev);
      } else {
        setFadeIn(false);
        setTimeout(() => {
          setCurrentIndex(index);
          setIsPinned(true);
          setFadeIn(true);
        }, 300);
      }
    },
    [currentIndex]
  );

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setFadeIn(false);
        setTimeout(() => {
          setCurrentIndex((prev) => (prev + 1) % CAROUSEL_SECTIONS.length);
          setFadeIn(true);
        }, 300);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setFadeIn(false);
        setTimeout(() => {
          setCurrentIndex(
            (prev) =>
              (prev - 1 + CAROUSEL_SECTIONS.length) % CAROUSEL_SECTIONS.length
          );
          setFadeIn(true);
        }, 300);
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPinned((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const renderSection = () => {
    switch (currentSection) {
      case "pipeline":
        return <PipelineSection data={data.pipeline} />;
      case "surveys":
        return <SurveysSection data={data.surveys} />;
      case "installs":
        return <InstallsSection data={data.installs} />;
      case "inspections":
        return <InspectionsSection data={data.inspections} />;
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col" style={{
      background: "linear-gradient(135deg, #1e293b, #0f172a)",
      fontFamily: "system-ui, sans-serif",
      color: "#e2e8f0",
    }}>
      <CarouselHeader
        location={data.location}
        currentSection={currentSection}
        isPinned={isPinned}
        connected={connected}
        reconnecting={reconnecting}
        stale={stale}
        onDotClick={goToSection}
      />

      <div
        className="flex-1 min-h-0 overflow-hidden transition-opacity duration-300"
        style={{ opacity: fadeIn ? 1 : 0 }}
      >
        {renderSection()}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/office-performance/[location]/OfficeCarousel.tsx
git commit -m "feat: add OfficeCarousel container with rotation, pinning, keyboard nav"
```

---

### Task 10: Build the Dashboard Page

**Files:**
- Create: `src/app/dashboards/office-performance/[location]/page.tsx`

- [ ] **Step 1: Create the page component**

```typescript
"use client";

import { use, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { LOCATION_SLUG_TO_CANONICAL } from "@/lib/locations";
import type { OfficePerformanceData } from "@/lib/office-performance-types";
import OfficeCarousel from "./OfficeCarousel";

/** The API route returns OfficePerformanceData + cache metadata */
interface OfficePerformanceApiResponse extends OfficePerformanceData {
  cached: boolean;
  stale: boolean;
  lastUpdated: string;
}

interface PageProps {
  params: Promise<{ location: string }>;
}

export default function OfficePerformancePage({ params }: PageProps) {
  const { location: slug } = use(params);
  const canonicalLocation = LOCATION_SLUG_TO_CANONICAL[slug];
  const previousDataRef = useRef<OfficePerformanceData | null>(null);

  const {
    data,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.officePerformance.location(slug),
    queryFn: async (): Promise<OfficePerformanceApiResponse> => {
      // Always pass refresh=true so polling bypasses the server's 5-min appCache.
      // Without this, the 2-min poll would return stale cached data for up to 5 min,
      // defeating the purpose of catching Zuper-only updates that don't emit SSE.
      const res = await fetch(`/api/office-performance/${slug}?refresh=true`);
      if (!res.ok) throw new Error("Failed to fetch office performance data");
      return res.json();
    },
    refetchInterval: 120_000, // Fallback polling every 2 minutes
    staleTime: 60_000,
  });

  // Store last good data for stale display on error
  useEffect(() => {
    if (data) previousDataRef.current = data;
  }, [data]);

  // Dual refresh strategy:
  // 1. SSE — useSSE listens for "projects" cache key changes (prefix match).
  //    When HubSpot deal/project data updates, the SSE server emits "projects:*"
  //    events, which match our filter and trigger refetch().
  // 2. React Query polling — refetchInterval: 120_000 (2 minutes) catches
  //    Zuper job completions and other changes that don't emit SSE events.
  //
  // The server-side appCache has a 5-min TTL. The 2-min client poll ensures
  // reasonably fresh data even without SSE triggers. SSE gives instant
  // updates for the project/pipeline data which changes most often.
  const { connected, reconnecting } = useSSE(() => refetch(), {
    url: "/api/stream",
    cacheKeyFilter: "projects",
  });

  // Unknown location
  if (!canonicalLocation) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{
        background: "linear-gradient(135deg, #1e293b, #0f172a)",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div className="text-center">
          <div className="text-2xl font-bold mb-2">Unknown Location</div>
          <div className="text-slate-400">"{slug}" is not a valid office location.</div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading && !previousDataRef.current) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{
        background: "linear-gradient(135deg, #1e293b, #0f172a)",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-lg font-semibold">{canonicalLocation}</div>
          <div className="text-slate-400 text-sm mt-1">Loading performance data...</div>
        </div>
      </div>
    );
  }

  // Use current data, or fall back to previous data on error.
  // isStale is true if: (1) the server says the cache entry is stale (stale-while-revalidate),
  // OR (2) we have no fresh data and are using the previous ref as a fallback.
  const displayData = data || previousDataRef.current;
  const isStale = (data?.stale === true) || (!data && !!previousDataRef.current);

  if (!displayData) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{
        background: "linear-gradient(135deg, #1e293b, #0f172a)",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div className="text-center">
          <div className="text-2xl font-bold mb-2">No Data Available</div>
          <div className="text-slate-400">Unable to load performance data for {canonicalLocation}.</div>
        </div>
      </div>
    );
  }

  return (
    <OfficeCarousel
      data={displayData}
      connected={connected}
      reconnecting={reconnecting}
      stale={isStale}
    />
  );
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "office-performance" | head -20`
Expected: No errors in the office-performance files.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/office-performance/[location]/page.tsx
git commit -m "feat: add office performance dashboard page

Full-viewport ambient display with SSE real-time updates,
React Query data fetching, and stale data fallback on errors."
```

---

## Chunk 5: Executive Suite Integration and Route Access

### Task 11: Add Office Performance Cards to Executive Suite Landing Page

**Files:**
- Modify: `src/app/suites/executive/page.tsx`

- [ ] **Step 1: Read the current executive suite page**

Read `src/app/suites/executive/page.tsx` to understand the current card structure.

- [ ] **Step 2: Add office performance cards to the LINKS array**

Add the following 5 cards to the `LINKS` array, using a new section name `"Office Performance"`:

```typescript
{
  href: "/dashboards/office-performance/westminster",
  title: "Westminster",
  description: "Ambient display — pipeline, surveys, installs, inspections for Westminster.",
  tag: "OFFICE",
  icon: "🏢",
  section: "Office Performance",
},
{
  href: "/dashboards/office-performance/centennial",
  title: "Centennial",
  description: "Ambient display — pipeline, surveys, installs, inspections for Centennial.",
  tag: "OFFICE",
  icon: "🏢",
  section: "Office Performance",
},
{
  href: "/dashboards/office-performance/colorado-springs",
  title: "Colorado Springs",
  description: "Ambient display — pipeline, surveys, installs, inspections for Colorado Springs.",
  tag: "OFFICE",
  icon: "🏢",
  section: "Office Performance",
},
{
  href: "/dashboards/office-performance/san-luis-obispo",
  title: "San Luis Obispo",
  description: "Ambient display — pipeline, surveys, installs, inspections for San Luis Obispo.",
  tag: "OFFICE",
  icon: "🏢",
  section: "Office Performance",
},
{
  href: "/dashboards/office-performance/camarillo",
  title: "Camarillo",
  description: "Ambient display — pipeline, surveys, installs, inspections for Camarillo.",
  tag: "OFFICE",
  icon: "🏢",
  section: "Office Performance",
},
```

- [ ] **Step 3: Commit**

```bash
git add src/app/suites/executive/page.tsx
git commit -m "feat: add office performance links to executive suite landing page"
```

---

### Task 12: Add Route Access for Office Performance Dashboards

**Files:**
- Modify: `src/lib/role-permissions.ts`

The middleware enforces route access via `canAccessRoute()` in `src/lib/role-permissions.ts`. Routes must be explicitly added to each role's `allowedRoutes` array. ADMIN and EXECUTIVE/OWNER roles use `"*"` (wildcard), so they already have access. We need to add the route to **PROJECT_MANAGER** and **OPERATIONS_MANAGER** (and their legacy aliases MANAGER).

- [ ] **Step 1: Add route to PROJECT_MANAGER allowedRoutes**

In `src/lib/role-permissions.ts`, find the `PROJECT_MANAGER` role's `allowedRoutes` array (around line 400). Add the following entry in the "Executive dashboards (read-only visibility)" section, after `/dashboards/command-center`:

```typescript
"/dashboards/office-performance",
```

- [ ] **Step 2: Add route to OPERATIONS_MANAGER allowedRoutes**

Find the `OPERATIONS_MANAGER` role's `allowedRoutes` array (around line 288). Add the same entry in the "Executive dashboards (read-only visibility)" section, after `/dashboards/command-center`:

```typescript
"/dashboards/office-performance",
```

- [ ] **Step 3: Add route to MANAGER allowedRoutes (legacy alias)**

Find the `MANAGER` role's `allowedRoutes` array (around line 84). Add:

```typescript
"/dashboards/office-performance",
```

Note: The MANAGER role normalizes to PROJECT_MANAGER at runtime, but the MANAGER object still has its own explicit allowedRoutes for defense-in-depth.

- [ ] **Step 4: Add API route access**

Also add the API route to the same three roles so the dashboard can fetch data:

```typescript
"/api/office-performance",
```

Add this to PROJECT_MANAGER, OPERATIONS_MANAGER, and MANAGER allowedRoutes arrays.

- [ ] **Step 5: Verify with canAccessRoute check**

Run `npx tsc --noEmit` to make sure no syntax errors in the modified file.

- [ ] **Step 6: Commit**

```bash
git add src/lib/role-permissions.ts
git commit -m "feat: add /dashboards/office-performance route access for PM and Ops Mgr roles"
```

---

### Task 13: Verify End-to-End in Dev

**Files:** None (verification only)

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`

- [ ] **Step 2: Navigate to office performance dashboard**

Open: `http://localhost:3000/dashboards/office-performance/westminster`
Expected: Dashboard loads with carousel. Data may show zeros/empty if no local data — that's fine. Verify:
- Header shows "WESTMINSTER" with live dot and time
- Section dots are visible and clickable
- Carousel rotates after 45 seconds
- Keyboard arrows navigate sections
- Space toggles pinning

- [ ] **Step 3: Navigate to executive suite**

Open: `http://localhost:3000/suites/executive`
Expected: "Office Performance" section visible with 5 office cards.

- [ ] **Step 4: Test unknown location 404**

Open: `http://localhost:3000/dashboards/office-performance/bogus`
Expected: Shows "Unknown Location" message, not a crash.

- [ ] **Step 5: Verify API endpoint**

Run: `curl -s http://localhost:3000/api/office-performance/westminster | jq '.location'`
Expected: `"Westminster"`

- [ ] **Step 6: Run linting and type check**

Run: `npm run lint && npx tsc --noEmit`
Expected: No errors in the new files. Pre-existing warnings in other files are OK.

- [ ] **Step 7: Commit any fixes from verification**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address issues found during office performance dashboard verification"
```

---

## Chunk 6: Tests

### Task 14: Write Tests for Data Aggregation

**Files:**
- Create: `src/__tests__/office-performance.test.ts`

- [ ] **Step 1: Write tests for buildPipelineData**

```typescript
import { buildPipelineData } from "@/lib/office-performance";
import type { OfficeMetricName } from "@/lib/office-performance-types";

const DEFAULT_GOALS: Record<OfficeMetricName, number> = {
  projects_completed: 15,
  surveys_completed: 25,
  installs_completed: 12,
  inspections_completed: 10,
};

describe("buildPipelineData", () => {
  const now = new Date("2026-04-07T12:00:00Z");

  it("counts active projects", () => {
    const projects = [
      { stage: "Design", pbLocation: "Westminster" },
      { stage: "Install", pbLocation: "Westminster" },
      { stage: "RTB", pbLocation: "Westminster" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.activeProjects).toBe(3);
  });

  it("counts MTD completions from ptoGrantedDate", () => {
    const projects = [
      { stage: "PTO", ptoGrantedDate: "2026-04-03" },
      { stage: "PTO", ptoGrantedDate: "2026-03-28" }, // Last month — not MTD
      { stage: "Design" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.completedMtd).toBe(1);
  });

  it("builds stage distribution in correct order", () => {
    const projects = [
      { stage: "survey" },
      { stage: "design" },
      { stage: "design" },
      { stage: "construction" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.stageDistribution[0]).toEqual({ stage: "Survey", count: 1 });
    expect(result.stageDistribution[1]).toEqual({ stage: "Design", count: 2 });
    expect(result.stageDistribution[4]).toEqual({ stage: "Install", count: 1 });
  });

  it("counts overdue projects based on forecasted dates", () => {
    const projects = [
      { stage: "Install", forecastedInstallDate: "2026-04-01" }, // Past = overdue
      { stage: "Inspect", forecastedInspectionDate: "2026-04-10" }, // Future = not overdue
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.overdueCount).toBe(1);
  });

  it("sets completedGoal from goals", () => {
    const result = buildPipelineData([], { ...DEFAULT_GOALS, projects_completed: 20 }, now);
    expect(result.completedGoal).toBe(20);
  });

  it("includes recent wins for PTOs this week", () => {
    const projects = [
      { stage: "PTO", ptoGrantedDate: "2026-04-05" },
      { stage: "PTO", ptoGrantedDate: "2026-04-06" },
    ];
    const result = buildPipelineData(projects, DEFAULT_GOALS, now);
    expect(result.recentWins).toContainEqual(expect.stringContaining("2 PTOs granted this week"));
  });

  it("handles empty project list", () => {
    const result = buildPipelineData([], DEFAULT_GOALS, now);
    expect(result.activeProjects).toBe(0);
    expect(result.completedMtd).toBe(0);
    expect(result.overdueCount).toBe(0);
    expect(result.stageDistribution.every((s) => s.count === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test -- --testPathPattern="office-performance" --verbose`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/office-performance.test.ts
git commit -m "test: add unit tests for office performance pipeline data aggregation"
```

---

### Task 15: Write Tests for Leaderboard Building

**Files:**
- Modify: `src/__tests__/office-performance.test.ts`

- [ ] **Step 1: Export and test buildLeaderboard**

First, make `buildLeaderboard` exported from `src/lib/office-performance.ts` (add `export` keyword).

Then add tests:

```typescript
import { buildLeaderboard } from "@/lib/office-performance";

describe("buildLeaderboard", () => {
  it("sorts by count descending", () => {
    const users = [
      { name: "Alice", userUid: "a", count: 3 },
      { name: "Bob", userUid: "b", count: 7 },
      { name: "Carol", userUid: "c", count: 5 },
    ];
    const result = buildLeaderboard(users);
    expect(result[0].name).toBe("Bob");
    expect(result[1].name).toBe("Carol");
    expect(result[2].name).toBe("Alice");
  });

  it("returns empty array for no users", () => {
    expect(buildLeaderboard([])).toEqual([]);
  });

  it("handles single user", () => {
    const users = [{ name: "Solo", userUid: "s", count: 10 }];
    const result = buildLeaderboard(users);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Solo");
    expect(result[0].count).toBe(10);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test -- --testPathPattern="office-performance" --verbose`
Expected: All tests PASS (both previous and new).

- [ ] **Step 3: Commit**

```bash
git add src/lib/office-performance.ts src/__tests__/office-performance.test.ts
git commit -m "test: add leaderboard sorting tests"
```

---

## Deferred to Phase 2

These features are in the spec but explicitly deferred. The plan delivers a fully functional dashboard without them.

- **Monthly leader streaks:** Requires querying 12 months of historical job data per user per location. The `buildLeaderboard()` function accepts a `monthlyHistory` parameter but it is not populated in phase 1. Leaderboards will show counts only, no streak badges.
- **Quality streaks** (consecutive installs without punch list, consecutive inspection passes): Requires cross-referencing Zuper job data with HubSpot inspection failure fields per installer. Deferred until the data join is proven reliable.
- **Per-person inspection pass rate:** The inspection leaderboard shows job counts but pass rate is hardcoded to 0. Enriching this requires joining each inspection tech's Zuper jobs to HubSpot `isFirstTimeInspectionPass` per deal, which is feasible but adds complexity.
- **Admin UI for goal management:** Goals are seeded via script or direct DB insert. A settings page in the Admin suite can be added later.
- **Scrolling "Recent Wins" ticker:** Phase 1 shows wins as static text. CSS marquee/animation can be added later.
- **Overdue yellow/red threshold split:** Phase 1 counts total overdue. Splitting into 1-7 day (yellow) and 7+ day (red) tiers can be added by computing days past forecast.

## Summary

**Total tasks:** 15
**Total files created:** 11
**Total files modified:** 6

| Task | What It Builds |
|------|----------------|
| 1 | OfficeGoal Prisma model + migration |
| 2 | Types, slug mapping, query keys, cache keys |
| 3 | Location slug mapping tests |
| 4 | Data aggregation module (pipeline, surveys, installs, inspections, QC enrichment) |
| 5 | API route handler with caching |
| 6 | CarouselHeader component |
| 7 | Leaderboard + GoalProgress reusable components |
| 8 | 4 section components (Pipeline, Surveys, Installs, Inspections) |
| 9 | OfficeCarousel container (rotation, pinning, keyboard nav) |
| 10 | Dashboard page (data fetching, SSE + polling, error states) |
| 11 | Executive suite landing page cards |
| 12 | Role-based route access (PM, Ops Mgr, Manager allowedRoutes) |
| 13 | End-to-end dev verification |
| 14 | Pipeline data aggregation tests |
| 15 | Leaderboard sorting tests |
