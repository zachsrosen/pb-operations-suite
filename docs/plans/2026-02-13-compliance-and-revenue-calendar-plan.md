# Zuper Compliance Dashboard & Executive Revenue Calendar — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build two new dashboards: (1) per-user compliance scorecards for Zuper field techs, (2) monthly revenue calendar showing daily deal value of scheduled construction/D&R/service work.

**Architecture:** Two independent features — each gets its own API route and dashboard page. Compliance is Zuper-only data. Revenue calendar joins Zuper jobs with HubSpot deal amounts via `hubspot-{dealId}` job tags and custom fields.

**Tech Stack:** Next.js API routes, Zuper REST API, HubSpot batch API (`@hubspot/api-client`), React client components with `DashboardShell`.

---

## Task 1: Compliance API Route

**Files:**
- Create: `src/app/api/zuper/compliance/route.ts`

**Step 1: Create the compliance API route**

This route fetches Zuper jobs across all field categories, groups by assigned user, and computes compliance metrics.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper, JOB_CATEGORY_UIDS } from "@/lib/zuper";

// All category UIDs to scan
const ALL_CATEGORIES = [
  { uid: JOB_CATEGORY_UIDS.SITE_SURVEY, name: "Site Survey" },
  { uid: JOB_CATEGORY_UIDS.CONSTRUCTION, name: "Construction" },
  { uid: JOB_CATEGORY_UIDS.INSPECTION, name: "Inspection" },
  { uid: JOB_CATEGORY_UIDS.SERVICE_VISIT, name: "Service Visit" },
  { uid: JOB_CATEGORY_UIDS.SERVICE_REVISIT, name: "Service Revisit" },
  { uid: JOB_CATEGORY_UIDS.DETACH, name: "Detach" },
  { uid: JOB_CATEGORY_UIDS.RESET, name: "Reset" },
  { uid: JOB_CATEGORY_UIDS.DNR_INSPECTION, name: "D&R Inspection" },
  { uid: JOB_CATEGORY_UIDS.ADDITIONAL_VISIT, name: "Additional Visit" },
];

// Statuses that indicate "stale" — job should have progressed past these
const STALE_ACTIVE_STATUSES = ["on our way", "started", "in progress"];
// Statuses that indicate "never started" — job was scheduled but never began
const NEVER_STARTED_STATUSES = ["new", "scheduled", "unassigned", "ready to schedule", "ready to build", "ready for inspection"];

interface JobRecord {
  jobUid: string;
  title: string;
  category: string;
  statusName: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedTime: string | null;
  assignedUser: string;
  assignedUserUid: string;
  teamName: string;
}

interface UserMetrics {
  userName: string;
  userUid: string;
  teamName: string;
  totalJobs: number;
  completedJobs: number;
  onTimeCompletions: number;
  lateCompletions: number;
  staleJobs: number;
  neverStartedJobs: number;
  avgDaysToComplete: number;
  onTimePercent: number;
  complianceScore: number;
  grade: string;
  byCategory: Record<string, number>;
  staleJobsList: { jobUid: string; title: string; status: string; scheduledEnd: string | null; category: string }[];
}

function getGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!zuper.isConfigured()) {
      return NextResponse.json({ error: "Zuper integration not configured" }, { status: 503 });
    }

    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get("days") || "30");
    const teamFilter = searchParams.get("team") || null;
    const categoryFilter = searchParams.get("category") || null;

    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - days);
    const fromStr = fromDate.toISOString().split("T")[0];
    const toStr = now.toISOString().split("T")[0];

    // Fetch all jobs in parallel across categories
    const allJobs: JobRecord[] = [];
    const MAX_PAGES = 20;

    for (const cat of ALL_CATEGORIES) {
      if (categoryFilter && cat.name.toLowerCase() !== categoryFilter.toLowerCase()) continue;

      let page = 1;
      let hasMore = true;
      while (hasMore && page <= MAX_PAGES) {
        const result = await zuper.searchJobs({
          category: cat.uid,
          from_date: fromStr,
          to_date: toStr,
          page,
          limit: 100,
        });

        if (result.type === "error" || !result.data?.jobs?.length) break;

        for (const job of result.data.jobs) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = job as any;
          const jobCatUid = typeof job.job_category === "string"
            ? job.job_category
            : job.job_category?.category_uid;
          if (jobCatUid && jobCatUid !== cat.uid) continue;

          // Extract assigned user
          let assignedUser = "";
          let assignedUserUid = "";
          if (Array.isArray(job.assigned_to)) {
            for (const a of job.assigned_to) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const entry = a as any;
              const user = entry.user || entry;
              if (user?.first_name || user?.last_name) {
                assignedUser = `${user.first_name || ""} ${user.last_name || ""}`.trim();
                assignedUserUid = user.user_uid || entry.user_uid || "";
                break;
              }
            }
          }
          if (!assignedUser) continue; // Skip unassigned jobs

          // Extract team
          let teamName = "";
          if (Array.isArray(raw.assigned_to_team)) {
            const tm = raw.assigned_to_team[0]?.team;
            if (tm?.team_name) teamName = tm.team_name;
          }

          if (teamFilter && teamName.toLowerCase() !== teamFilter.toLowerCase()) continue;

          const statusName = raw.current_job_status?.status_name || raw.status || "Unknown";

          allJobs.push({
            jobUid: job.job_uid || "",
            title: job.job_title || "",
            category: cat.name,
            statusName,
            scheduledStart: job.scheduled_start_time || null,
            scheduledEnd: job.scheduled_end_time || null,
            completedTime: raw.completed_time || raw.completed_at || null,
            assignedUser,
            assignedUserUid,
            teamName,
          });
        }

        if (result.data.jobs.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    // Group by user
    const userMap = new Map<string, JobRecord[]>();
    for (const job of allJobs) {
      const key = job.assignedUserUid || job.assignedUser;
      if (!userMap.has(key)) userMap.set(key, []);
      userMap.get(key)!.push(job);
    }

    // Compute per-user metrics
    const nowMs = now.getTime();
    const GRACE_DAYS = 1;
    const graceMs = GRACE_DAYS * 24 * 60 * 60 * 1000;

    const users: UserMetrics[] = [];
    for (const [, jobs] of userMap) {
      const first = jobs[0];
      let completedJobs = 0;
      let onTime = 0;
      let late = 0;
      let stale = 0;
      let neverStarted = 0;
      let totalCompletionDays = 0;
      let completionCount = 0;
      const byCategory: Record<string, number> = {};
      const staleJobsList: UserMetrics["staleJobsList"] = [];

      for (const job of jobs) {
        // Category count
        byCategory[job.category] = (byCategory[job.category] || 0) + 1;

        const statusLower = job.statusName.toLowerCase();
        const isCompleted = statusLower.includes("complete") || statusLower.includes("passed") ||
          statusLower.includes("construction complete") || statusLower.includes("loose ends");
        const scheduledEndMs = job.scheduledEnd ? new Date(job.scheduledEnd).getTime() : null;
        const completedMs = job.completedTime ? new Date(job.completedTime).getTime() : null;
        const scheduledStartMs = job.scheduledStart ? new Date(job.scheduledStart).getTime() : null;

        if (isCompleted) {
          completedJobs++;
          if (completedMs && scheduledEndMs) {
            if (completedMs <= scheduledEndMs + graceMs) {
              onTime++;
            } else {
              late++;
            }
            // Avg days to complete
            if (scheduledStartMs && completedMs > scheduledStartMs) {
              totalCompletionDays += (completedMs - scheduledStartMs) / (24 * 60 * 60 * 1000);
              completionCount++;
            }
          } else {
            // No dates to compare — count as on-time (benefit of doubt)
            onTime++;
          }
        } else {
          // Not completed — check if stale or never started
          if (STALE_ACTIVE_STATUSES.includes(statusLower) && scheduledEndMs && scheduledEndMs < nowMs) {
            stale++;
            staleJobsList.push({
              jobUid: job.jobUid,
              title: job.title,
              status: job.statusName,
              scheduledEnd: job.scheduledEnd,
              category: job.category,
            });
          } else if (NEVER_STARTED_STATUSES.includes(statusLower) && scheduledStartMs && scheduledStartMs < nowMs) {
            neverStarted++;
          }
        }
      }

      const total = jobs.length;
      const onTimePercent = completedJobs > 0 ? Math.round((onTime / completedJobs) * 100) : 100;
      const staleRate = total > 0 ? stale / total : 0;
      const neverStartedRate = total > 0 ? neverStarted / total : 0;
      const complianceScore = Math.round(
        onTimePercent * 0.5 +
        (1 - staleRate) * 100 * 0.3 +
        (1 - neverStartedRate) * 100 * 0.2
      );

      users.push({
        userName: first.assignedUser,
        userUid: first.assignedUserUid,
        teamName: first.teamName,
        totalJobs: total,
        completedJobs,
        onTimeCompletions: onTime,
        lateCompletions: late,
        staleJobs: stale,
        neverStartedJobs: neverStarted,
        avgDaysToComplete: completionCount > 0 ? Math.round((totalCompletionDays / completionCount) * 10) / 10 : 0,
        onTimePercent,
        complianceScore,
        grade: getGrade(complianceScore),
        byCategory,
        staleJobsList,
      });
    }

    // Sort by compliance score ascending (worst first)
    users.sort((a, b) => a.complianceScore - b.complianceScore);

    // Collect unique team names for filter options
    const teams = [...new Set(allJobs.map(j => j.teamName).filter(Boolean))].sort();
    const categories = [...new Set(allJobs.map(j => j.category))].sort();

    // Summary stats
    const totalJobs = allJobs.length;
    const totalCompleted = users.reduce((s, u) => s + u.completedJobs, 0);
    const totalOnTime = users.reduce((s, u) => s + u.onTimeCompletions, 0);
    const totalStale = users.reduce((s, u) => s + u.staleJobs, 0);
    const totalNeverStarted = users.reduce((s, u) => s + u.neverStartedJobs, 0);
    const overallOnTimePercent = totalCompleted > 0 ? Math.round((totalOnTime / totalCompleted) * 100) : 100;
    const avgCompletionDays = users.length > 0
      ? Math.round(users.filter(u => u.avgDaysToComplete > 0).reduce((s, u) => s + u.avgDaysToComplete, 0) /
        Math.max(users.filter(u => u.avgDaysToComplete > 0).length, 1) * 10) / 10
      : 0;

    return NextResponse.json({
      users,
      summary: {
        totalJobs,
        totalCompleted,
        overallOnTimePercent,
        totalStale,
        totalNeverStarted,
        avgCompletionDays,
        userCount: users.length,
      },
      filters: { teams, categories },
      dateRange: { from: fromStr, to: toStr, days },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[zuper-compliance] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch compliance data", details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Verify the route compiles**

Run: `npx next build 2>&1 | head -40`
Expected: No TypeScript errors for the new route.

**Step 3: Commit**

```bash
git add src/app/api/zuper/compliance/route.ts
git commit -m "feat: add Zuper compliance API route with per-user scoring"
```

---

## Task 2: Compliance Dashboard Page

**Files:**
- Create: `src/app/dashboards/zuper-compliance/page.tsx`

**Step 1: Build the compliance dashboard page**

Use `DashboardShell` with `accentColor="red"`. Include:
- Date range selector (7d/14d/30d/60d/90d buttons)
- Team and category filters
- Summary stat cards row (total jobs, on-time %, stale, never-started, avg days)
- User scorecard table (sortable columns, color-coded grades, expandable rows showing per-category breakdown and stale jobs list)
- Grade colors: green (A/B), yellow (C), red (D/F)
- Each stale job row links to Zuper (`https://us-west-1c.zuperpro.com/app/job/{jobUid}`)

**Key patterns to follow:**
- Fetch via `fetch("/api/zuper/compliance?days=30&team=X&category=Y")`
- Loading spinner pattern from `zuper-status-comparison/page.tsx`
- Filter components: `MultiSelectFilter` from `@/components/ui/MultiSelectFilter`
- Stat cards: inline div pattern from `equipment-backlog/page.tsx` (bg-surface/50, border, etc.)
- Sortable table pattern from equipment backlog (handleSort + SortIcon)
- Export via DashboardShell `exportData` prop

**Step 2: Verify it compiles**

Run: `npx next build 2>&1 | head -40`

**Step 3: Commit**

```bash
git add src/app/dashboards/zuper-compliance/page.tsx
git commit -m "feat: add Zuper compliance dashboard with user scorecards"
```

---

## Task 3: Revenue Calendar API Route

**Files:**
- Create: `src/app/api/zuper/revenue-calendar/route.ts`

**Step 1: Create the revenue calendar API route**

Fetches Zuper jobs for Construction, Detach, Reset, Service Visit categories for a given month, then batch-fetches HubSpot deals for amounts.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { Client } from "@hubspot/api-client";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

const REVENUE_CATEGORIES = [
  { uid: JOB_CATEGORY_UIDS.CONSTRUCTION, name: "Construction", key: "construction" },
  { uid: JOB_CATEGORY_UIDS.DETACH, name: "Detach", key: "detach" },
  { uid: JOB_CATEGORY_UIDS.RESET, name: "Reset", key: "reset" },
  { uid: JOB_CATEGORY_UIDS.SERVICE_VISIT, name: "Service Visit", key: "service" },
];

interface CalendarJob {
  jobUid: string;
  title: string;
  category: string;
  categoryKey: string;
  date: string; // YYYY-MM-DD (from scheduled_start)
  endDate: string | null; // YYYY-MM-DD (from scheduled_end, for multi-day)
  statusName: string;
  assignedUser: string;
  teamName: string;
  dealId: string | null;
  dealName: string | null;
  dealValue: number;
  projectNumber: string | null;
}

// Extract HubSpot deal ID from Zuper job (tags, custom fields, external_id)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDealId(job: any): string | null {
  // 1. external_id.hubspot_deal
  if (job.external_id?.hubspot_deal) return String(job.external_id.hubspot_deal);

  // 2. job_tags: "hubspot-{id}"
  if (Array.isArray(job.job_tags)) {
    for (const tag of job.job_tags) {
      const match = String(tag).match(/^hubspot-(\d+)$/i);
      if (match?.[1]) return match[1];
    }
  }

  // 3. custom_fields: hubspot_deal_id
  const cf = job.custom_fields;
  if (Array.isArray(cf)) {
    const field = cf.find((f: { label?: string; name?: string }) => {
      const label = String(f?.label || "").toLowerCase();
      const name = String(f?.name || "").toLowerCase();
      return label === "hubspot deal id" || label === "hubspot_deal_id" ||
        name === "hubspot_deal_id" || name === "hubspot deal id";
    });
    if (field?.value) {
      const numMatch = String(field.value).match(/\b\d{6,}\b/);
      if (numMatch) return numMatch[0];
    }
  } else if (cf && typeof cf === "object") {
    const val = (cf as Record<string, unknown>).hubspot_deal_id;
    if (val) {
      const numMatch = String(val).match(/\b\d{6,}\b/);
      if (numMatch) return numMatch[0];
    }
  }

  return null;
}

// Extract PROJ-XXXX from job title
function extractProjectNumber(title: string): string | null {
  const match = title.match(/PROJ-(\d+)/i);
  return match ? `PROJ-${match[1]}` : null;
}

// Batch fetch HubSpot deals for amounts
async function fetchDealAmounts(dealIds: string[]): Promise<Map<string, { name: string; amount: number }>> {
  const map = new Map<string, { name: string; amount: number }>();
  if (dealIds.length === 0) return map;

  const batchSize = 100;
  for (let i = 0; i < dealIds.length; i += batchSize) {
    const batch = dealIds.slice(i, i + batchSize);
    try {
      const response = await hubspotClient.crm.deals.batchApi.read({
        inputs: batch.map(id => ({ id })),
        properties: ["dealname", "amount", "project_number"],
        propertiesWithHistory: [],
      });
      for (const deal of response.results) {
        map.set(deal.id, {
          name: deal.properties.dealname || "",
          amount: parseFloat(deal.properties.amount || "0") || 0,
        });
      }
    } catch (err) {
      console.error(`[revenue-calendar] HubSpot batch error at offset ${i}:`, err);
    }
    if (i + batchSize < dealIds.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return map;
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!zuper.isConfigured()) {
      return NextResponse.json({ error: "Zuper integration not configured" }, { status: 503 });
    }

    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
    const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
    const teamFilter = searchParams.get("team") || null;
    const categoryFilter = searchParams.get("category") || null;

    // Date range: target month with 1 week buffer on each side (for multi-day jobs)
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // last day of month
    const bufferStart = new Date(monthStart);
    bufferStart.setDate(bufferStart.getDate() - 7);
    const bufferEnd = new Date(monthEnd);
    bufferEnd.setDate(bufferEnd.getDate() + 7);

    const fromStr = bufferStart.toISOString().split("T")[0];
    const toStr = bufferEnd.toISOString().split("T")[0];

    // Fetch Zuper jobs for all revenue categories
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawJobs: { job: any; cat: typeof REVENUE_CATEGORIES[number] }[] = [];
    const MAX_PAGES = 20;

    for (const cat of REVENUE_CATEGORIES) {
      if (categoryFilter && cat.key !== categoryFilter) continue;

      let page = 1;
      let hasMore = true;
      while (hasMore && page <= MAX_PAGES) {
        const result = await zuper.searchJobs({
          category: cat.uid,
          from_date: fromStr,
          to_date: toStr,
          page,
          limit: 100,
        });
        if (result.type === "error" || !result.data?.jobs?.length) break;

        for (const job of result.data.jobs) {
          const jobCatUid = typeof job.job_category === "string"
            ? job.job_category
            : job.job_category?.category_uid;
          if (jobCatUid && jobCatUid !== cat.uid) continue;
          rawJobs.push({ job, cat });
        }

        if (result.data.jobs.length < 100) hasMore = false;
        else page++;
      }
    }

    // Extract deal IDs and fetch HubSpot amounts
    const dealIdSet = new Set<string>();
    for (const { job } of rawJobs) {
      const dealId = extractDealId(job);
      if (dealId) dealIdSet.add(dealId);
    }
    const dealMap = await fetchDealAmounts([...dealIdSet]);

    // Build calendar jobs
    const jobs: CalendarJob[] = [];
    for (const { job, cat } of rawJobs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = job as any;

      // Extract assigned user
      let assignedUser = "";
      if (Array.isArray(job.assigned_to)) {
        for (const a of job.assigned_to) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const entry = a as any;
          const user = entry.user || entry;
          if (user?.first_name || user?.last_name) {
            assignedUser = `${user.first_name || ""} ${user.last_name || ""}`.trim();
            break;
          }
        }
      }

      // Extract team
      let teamName = "";
      if (Array.isArray(raw.assigned_to_team)) {
        const tm = raw.assigned_to_team[0]?.team;
        if (tm?.team_name) teamName = tm.team_name;
      }
      if (teamFilter && teamName.toLowerCase() !== teamFilter.toLowerCase()) continue;

      const scheduledStart = job.scheduled_start_time || null;
      const scheduledEnd = job.scheduled_end_time || null;
      if (!scheduledStart) continue; // Skip unscheduled jobs

      const date = scheduledStart.split("T")[0] || scheduledStart.split(" ")[0];
      const endDate = scheduledEnd ? (scheduledEnd.split("T")[0] || scheduledEnd.split(" ")[0]) : null;

      const dealId = extractDealId(raw);
      const deal = dealId ? dealMap.get(dealId) : null;
      const statusName = raw.current_job_status?.status_name || raw.status || "Unknown";

      jobs.push({
        jobUid: job.job_uid || "",
        title: job.job_title || "",
        category: cat.name,
        categoryKey: cat.key,
        date,
        endDate: endDate !== date ? endDate : null,
        statusName,
        assignedUser,
        teamName,
        dealId,
        dealName: deal?.name || null,
        dealValue: deal?.amount || 0,
        projectNumber: extractProjectNumber(job.job_title || ""),
      });
    }

    // Filter to only jobs whose date falls within the target month
    const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;

    const monthJobs = jobs.filter(j => j.date >= monthStartStr && j.date <= monthEndStr);

    // Build daily totals
    const dailyTotals: Record<string, {
      totalValue: number;
      construction: { count: number; value: number };
      detach: { count: number; value: number };
      reset: { count: number; value: number };
      service: { count: number; value: number };
    }> = {};

    for (const job of monthJobs) {
      if (!dailyTotals[job.date]) {
        dailyTotals[job.date] = {
          totalValue: 0,
          construction: { count: 0, value: 0 },
          detach: { count: 0, value: 0 },
          reset: { count: 0, value: 0 },
          service: { count: 0, value: 0 },
        };
      }
      const day = dailyTotals[job.date];
      day.totalValue += job.dealValue;
      const catBucket = day[job.categoryKey as keyof typeof day];
      if (catBucket && typeof catBucket === "object" && "count" in catBucket) {
        catBucket.count += 1;
        catBucket.value += job.dealValue;
      }
    }

    // Month totals
    const monthTotals = {
      totalValue: monthJobs.reduce((s, j) => s + j.dealValue, 0),
      totalJobs: monthJobs.length,
      byCategory: {
        construction: { count: 0, value: 0 },
        detach: { count: 0, value: 0 },
        reset: { count: 0, value: 0 },
        service: { count: 0, value: 0 },
      },
    };
    for (const job of monthJobs) {
      const cat = monthTotals.byCategory[job.categoryKey as keyof typeof monthTotals.byCategory];
      if (cat) {
        cat.count += 1;
        cat.value += job.dealValue;
      }
    }

    // Collect filter options
    const teams = [...new Set(monthJobs.map(j => j.teamName).filter(Boolean))].sort();

    return NextResponse.json({
      dailyTotals,
      jobs: monthJobs,
      monthTotals,
      filters: { teams },
      month: { year, month, startDate: monthStartStr, endDate: monthEndStr },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[revenue-calendar] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revenue calendar data", details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Verify it compiles**

Run: `npx next build 2>&1 | head -40`

**Step 3: Commit**

```bash
git add src/app/api/zuper/revenue-calendar/route.ts
git commit -m "feat: add revenue calendar API joining Zuper jobs with HubSpot deal values"
```

---

## Task 4: Executive Revenue Calendar Page

**Files:**
- Create: `src/app/dashboards/executive-calendar/page.tsx`

**Step 1: Build the executive revenue calendar page**

Use `DashboardShell` with `accentColor="green"` (revenue theme). This is the largest UI piece.

**Layout structure:**
1. Month navigation bar (prev/next arrows, "February 2026" label, today button)
2. Category filter toggle buttons (Construction/Detach/Reset/Service — all on by default)
3. Team filter dropdown
4. Top stat cards: Total Revenue | Construction $ | D&R $ | Service $ | Total Jobs
5. Calendar grid: 7-column (Sun–Sat), 5–6 rows
   - Each day cell: bold dollar total (formatted compact: "$347K"), colored category indicator dots, job count text
   - Click a day → sets `selectedDate` state
   - Today has accent border (`border-green-500`)
   - Days outside current month are muted
6. Selected day detail panel (below calendar): table of jobs for that day
   - Columns: Project | Category | Deal Value | Crew | Status
   - Category column uses colored badge (blue/purple/orange/emerald)
   - Each row has Zuper link icon
7. Weekly revenue bar chart at bottom (optional — skip if page is already complex enough, can add later)

**Key patterns:**
- Fetch: `fetch(\`/api/zuper/revenue-calendar?year=${year}&month=${month}&team=${team}&category=${cat}\`)`
- Month nav: `useState` for year/month, prev/next buttons adjust
- Calendar grid: compute `firstDayOfWeek`, `daysInMonth`, pad leading/trailing cells
- `formatMoney` from `@/lib/format` for compact currency
- Category colors: Construction=blue-500, Detach=purple-500, Reset=orange-500, Service=emerald-500
- Export: DashboardShell `exportData` with job list flattened

**Step 2: Verify it compiles**

Run: `npx next build 2>&1 | head -40`

**Step 3: Commit**

```bash
git add src/app/dashboards/executive-calendar/page.tsx
git commit -m "feat: add executive revenue calendar with monthly grid and deal values"
```

---

## Task 5: Add Navigation Links

**Files:**
- Modify: `src/app/page.tsx` or sidebar navigation (wherever dashboard links are listed)

**Step 1: Add links to both new dashboards**

Find the dashboard navigation/link list and add entries:
- "Zuper Compliance" → `/dashboards/zuper-compliance` (icon: shield/check)
- "Revenue Calendar" → `/dashboards/executive-calendar` (icon: calendar/dollar)

**Step 2: Commit**

```bash
git add src/app/page.tsx  # or whichever nav file was modified
git commit -m "feat: add nav links for compliance dashboard and revenue calendar"
```

---

## Task 6: Build & Verify

**Step 1: Run full build**

Run: `npx next build`
Expected: Clean build, no TypeScript errors.

**Step 2: Final commit with all fixes if needed**

```bash
git add -A
git commit -m "fix: resolve any build issues from new dashboards"
```
