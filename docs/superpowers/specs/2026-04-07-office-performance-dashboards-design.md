# Office Performance Dashboards — Design Spec

## Overview

Per-office ambient display dashboards for all 5 Photon Brothers locations. Each office has a dedicated URL showing an auto-rotating carousel of field operations metrics, streamed live on a TV screen. Leadership can view any office. Part of the Executive suite.

## User Stories

- **Office teams** glance at their TV and instantly see how their location is performing — surveys completed, installs in progress, inspection pass rates, and who's leading the leaderboard this month.
- **Leadership** opens any office's dashboard from the Executive suite to check field ops health without digging through multiple dashboards.

## Architecture

### Routes

```
/dashboards/office-performance/westminster
/dashboards/office-performance/centennial
/dashboards/office-performance/colorado-springs
/dashboards/office-performance/san-luis-obispo
/dashboards/office-performance/camarillo
```

URL slugs map to canonical location names via a lookup:

```typescript
const SLUG_TO_LOCATION: Record<string, string> = {
  "westminster": "Westminster",
  "centennial": "Centennial",
  "colorado-springs": "Colorado Springs",
  "san-luis-obispo": "San Luis Obispo",
  "camarillo": "Camarillo",
};
```

Each page is a Next.js dynamic route at `src/app/dashboards/office-performance/[location]/page.tsx`.

### Suite Navigation

Add all 5 office links to the Executive suite in `src/lib/suite-nav.ts` as a grouped section. Each links directly to its location's dashboard URL.

### Access Control

No location-based restrictions — all authenticated users with Executive suite access can view any office. The dashboard pages respect existing role-based route access (ADMIN, OWNER roles via suite-nav; PM and OPS_MGR via direct URL access per the known divergence).

## Carousel System

### Behavior

- 4 sections rotate every 45 seconds by default.
- Section indicator dots in the header bar show current position.
- Clicking a dot pins that section (stops rotation). Clicking again resumes.
- Keyboard: arrow keys to navigate, space to toggle pin.
- Auto-rotation pauses if the browser tab is not visible (Page Visibility API).

### Sections

#### 1. Pipeline Overview

High-level office health snapshot.

**Metrics (goal-based):**
- Active projects (count of projects in pipeline for this location)
- Completed MTD vs. monthly goal (progress bar)
- Overdue projects (count, yellow/red threshold)
- Avg days in current stage (rolling, with trend arrow vs. prior month)

**Visualization:**
- Stage distribution bar chart (Survey → Design → Permit → RTB → Install → Inspect) with project counts
- "Recent Wins" ticker — PTOs granted this week, streak callouts

**Data source:** `/api/projects?location={name}` → group by stage, calculate MTD completions from `ptoDate` or stage transitions.

#### 2. Surveys

Surveyor performance for this office.

**Metrics:**
- Surveys completed MTD vs. goal
- Avg survey turnaround time (rolling 60-day, with trend arrow)
- Surveys scheduled this week (upcoming count)

**Leaderboard:** Surveyors ranked by surveys completed this month. Each row shows:
- Rank (gold/silver/bronze styling for top 3)
- Name
- Survey count
- Avg turnaround time
- Streak badge if applicable (e.g., "🔥 5-mo streak leading")

**Data source:** Zuper jobs with category "Site Survey", status "COMPLETED", filtered by location + date range. Assigned user extracted from `assigned_to[].user_uid`. Survey turnaround from QC metrics API `byLocation[location].avg_surveyTurnaroundTime`.

#### 3. Installs

Installer and electrician performance for this office.

**Metrics:**
- Installs completed MTD vs. goal
- Avg days per install (rolling 60-day, with trend arrow)
- Capacity utilization % (install days used vs. available from scheduling system)
- Installs scheduled this week

**Leaderboard:** Split into two side-by-side panels:
- **Installers** — ranked by install count this month
- **Electricians** — ranked by jobs completed this month

Each row: rank, name, count. Bottom streak bar for notable achievements (e.g., "6 installs with zero punch list").

**Data source:** Zuper jobs with category "Construction", status "COMPLETED", filtered by location + date range. Capacity from `CrewAvailability` model filtered by location + jobType "construction". Installer vs. electrician distinguished by CrewMember role field.

#### 4. Inspections & Quality

Inspection tech performance and overall quality health.

**Metrics:**
- Inspections completed MTD
- First-pass inspection rate (rolling 60-day, green/yellow/red thresholds)
- Avg construction turnaround time (rolling 60-day, with trend arrow)
- CC → PTO time (rolling 60-day, with trend arrow)

**Leaderboard:** Inspection techs ranked by inspections completed this month. Each row shows:
- Rank, name, inspection count, individual pass rate
- Streak badge for consecutive passes

**Data source:** Zuper jobs with category "Inspection", filtered by location. Pass/fail derived from HubSpot inspection status fields. QC turnaround metrics from `/api/hubspot/qc-metrics?days=60` → `byLocation[location]`.

### Gamification Elements

Applied within each section, not as a separate section:

- **Leaderboards:** Top performers by job count within each role category. Gold (#fbbf24), silver (#d1d5db), bronze (#b45309) rank styling for positions 1-3.
- **Streaks:** Consecutive months leading a category, consecutive jobs without punch list, consecutive inspection passes. Displayed as fire emoji + count badge.
- **Trend arrows:** Green down-arrow for improving metrics (faster turnaround), red up-arrow for worsening. Compared to prior 30-day period.
- **Goal progress bars:** MTD completions shown as progress toward monthly target. Celebration animation (confetti or flash) when goal is hit.
- **"Recent Wins" ticker:** Notable achievements scroll in the Pipeline Overview section footer.

### Monthly Goals

Goals per office need to be configurable. Options (in order of preference):

1. **Database-driven:** `OfficeGoal` model with location, metric name, target value, month/year. Editable via admin UI.
2. **Fallback:** Hardcoded defaults per location based on historical averages, overridable by #1.

```prisma
model OfficeGoal {
  id        String   @id @default(cuid())
  location  String   // Canonical location name
  metric    String   // "surveys_completed", "installs_completed", "inspections_completed", "projects_completed"
  target    Int
  month     Int      // 1-12
  year      Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([location, metric, month, year])
}
```

## Visual Design

### Layout

Full-viewport dark theme optimized for TV display at distance. No `DashboardShell` wrapper — this is a standalone ambient display page.

- **Header bar** (persistent across all sections): Live indicator dot, office name (uppercase, bold), section indicator dots, current date/time (auto-updating).
- **Content area:** Section-specific content fills remaining viewport.
- **No scrolling** — all content must fit in viewport.

### Theme

Dark background: `linear-gradient(135deg, #1e293b, #0f172a)` (slate-800 to slate-900).

Metric cards: `rgba(255,255,255,0.05)` background, 12px border-radius. Large numbers (42px font, 800 weight) in accent colors. Labels in `#94a3b8` (slate-400).

Color coding:
- Green (#22c55e): healthy / improving / on-target
- Yellow (#eab308): warning / slightly off
- Red (#ef4444): critical / worsening
- Orange (#f97316): accent / streaks / section 1 identity
- Blue (#3b82f6): section 2 (surveys) identity
- Green (#22c55e): section 3 (installs) identity
- Cyan (#06b6d4): section 4 (inspections) identity

Each section has its own accent color for the section label, maintaining visual distinction during rotation.

### Typography

System font stack (`system-ui, sans-serif`). Key sizes:
- Office name: 18px, 700 weight
- Section label: 13px, 600 weight, uppercase, 1px letter-spacing
- Big metric numbers: 42px, 800 weight
- Metric labels: 12px, normal weight
- Leaderboard names: 14-15px, 600 weight
- Leaderboard stats: 18-22px, 800 weight
- Streaks/badges: 11px

### Animations

- Section transitions: CSS fade (opacity 0→1, 300ms ease-in-out)
- Value changes: `animate-value-flash` (existing pattern from MetricCard)
- Live indicator: pulsing green dot (2s infinite)
- Goal hit celebration: brief confetti burst or golden flash on the progress bar
- Leaderboard position changes: subtle slide animation

## Data Flow

### API Endpoint

New endpoint: `GET /api/office-performance/[location]`

Returns all data needed for the 4 carousel sections in a single response to minimize client-side fetching:

```typescript
interface OfficePerformanceData {
  location: string;
  lastUpdated: string;

  pipeline: {
    activeProjects: number;
    completedMtd: number;
    completedGoal: number;
    overdueCount: number;
    avgDaysInStage: number;
    avgDaysInStagePrior: number; // Prior 30-day for trend
    stageDistribution: { stage: string; count: number }[];
    recentWins: string[]; // Pre-formatted win strings
  };

  surveys: {
    completedMtd: number;
    completedGoal: number;
    avgTurnaroundDays: number;
    avgTurnaroundPrior: number;
    scheduledThisWeek: number;
    leaderboard: PersonStat[];
  };

  installs: {
    completedMtd: number;
    completedGoal: number;
    avgDaysPerInstall: number;
    avgDaysPerInstallPrior: number;
    capacityUtilization: number; // 0-100
    scheduledThisWeek: number;
    installerLeaderboard: PersonStat[];
    electricianLeaderboard: PersonStat[];
  };

  inspections: {
    completedMtd: number;
    firstPassRate: number; // 0-100
    avgConstructionDays: number;
    avgConstructionDaysPrior: number;
    avgCcToPtoDays: number;
    avgCcToPtoDaysPrior: number;
    surveyTurnaroundDays: number;
    leaderboard: InspectionPersonStat[];
  };
}

interface PersonStat {
  name: string;
  count: number;
  avgMetric?: number; // Turnaround time, days/job, etc.
  streak?: { type: string; value: number; label: string };
}

interface InspectionPersonStat extends PersonStat {
  passRate: number; // 0-100
  consecutivePasses?: number;
}
```

### Data Aggregation

The API endpoint aggregates from multiple sources:

1. **Projects API** (`fetchAllProjects`) → filter by `pbLocation`, calculate pipeline and completion metrics
2. **QC Metrics** (reuse `qc-metrics` logic) → turnaround times by location
3. **Zuper Jobs** (`searchJobs` with location + date filters) → job completions by assigned user, grouped by category
4. **Scheduling** (`CrewAvailability` queries) → capacity utilization
5. **Office Goals** (new `OfficeGoal` model) → monthly targets

Cache the response with a 2-minute TTL. Invalidate via SSE on upstream data changes (project updates, job completions).

### Real-time Updates

Use existing SSE infrastructure (`useSSE` hook):

```typescript
const { connected } = useSSE(() => refetchData(), {
  url: "/api/stream",
  cacheKeyFilter: "office-performance",
});
```

The API endpoint emits `office-performance:{location}` cache keys on data changes. Client reconnects with exponential backoff per existing pattern.

## Streak Tracking

Streaks require historical state. Two approaches:

**Approach chosen: Computed on read.** Query historical job data to calculate streaks at API response time. For "consecutive months leading," query last N months of job data grouped by user. For "consecutive jobs without punch list," query recent jobs for each installer. This avoids new database models but adds query cost — acceptable given the 2-minute cache TTL.

Streak types:
- **Monthly leader streak:** Consecutive months a person had the highest count in their category at this location
- **Quality streak:** Consecutive installs without punch list items, consecutive inspection passes
- **Goal streak:** Consecutive months the office hit its completion target

## File Structure

```
src/app/dashboards/office-performance/
  [location]/
    page.tsx              # Main dashboard page
    OfficeCarousel.tsx     # Carousel container with rotation logic
    PipelineSection.tsx    # Section 1
    SurveysSection.tsx     # Section 2
    InstallsSection.tsx    # Section 3
    InspectionsSection.tsx # Section 4
    CarouselHeader.tsx     # Persistent header with dots + clock
    Leaderboard.tsx        # Reusable leaderboard component
    GoalProgress.tsx       # Progress bar with celebration animation

src/app/api/office-performance/
  [location]/
    route.ts              # Aggregation endpoint

src/lib/
  office-performance.ts   # Data aggregation logic (keeps route handler thin)

prisma/schema.prisma      # Add OfficeGoal model
```

## Edge Cases

- **No data for a metric:** Show "--" with muted styling. Don't show a leaderboard section if zero jobs exist for that category at the location.
- **Single person in leaderboard:** Still show the leaderboard — it's recognition, not just competition.
- **Location with no crews:** Capacity utilization shows "N/A" instead of 0%.
- **Goal not set for a month:** Fall back to prior month's goal, or show count without progress bar.
- **SSE disconnect:** Show a yellow "reconnecting" indicator replacing the green live dot. Data stays visible (stale but still useful for ambient display).
- **Browser tab hidden:** Pause carousel rotation via Page Visibility API. Resume on tab focus.

## Out of Scope

- Office-vs-office comparison/rankings
- Sales or deal closer metrics
- PM throughput metrics
- Design approval or permitting turnaround
- Crew team names (Godzilla, Mothman, etc.)
- Admin UI for managing goals (phase 2 — initially seed via script or direct DB)
- Mobile-optimized layout (these are TV displays)
