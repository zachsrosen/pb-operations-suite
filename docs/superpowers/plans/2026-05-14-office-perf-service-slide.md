# Office Performance — Service Carousel Slide

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Service" slide to the per-location office performance carousel showing service ticket stats, service deal pipeline, Zuper service job compliance, and a tech leaderboard.

**Architecture:** The existing carousel has 10 slides (teamResults, goals, pipeline, calendar×3, surveys, installs, inspections, allLocations). We add an 11th — `service`. Data flows through the same pattern: `getOfficePerformanceData()` calls a new `buildServiceData()` that fetches service-pipeline deals + service tickets from HubSpot filtered by location, then a `computeLocationCompliance("Service Visit", ...)` call adds Zuper compliance. A new `ServiceSection.tsx` renders the slide using the same metric card / compliance block / leaderboard components the other slides use.

**Tech Stack:** Next.js API routes, HubSpot CRM search API, Zuper compliance engine, React (ambient carousel UI)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/lib/office-performance-types.ts` | Add `ServiceData` interface, `service` to `CarouselSection` union, colors/labels |
| Modify | `src/lib/compliance-compute.ts` | Add `"Service Visit"` and `"Service Revisit"` to `CATEGORY_NAME_TO_UID` |
| Modify | `src/lib/office-performance.ts` | Add `buildServiceData()`, call it from `getOfficePerformanceData()`, add service compliance |
| Create | `src/app/dashboards/office-performance/[location]/ServiceSection.tsx` | Carousel slide UI |
| Modify | `src/app/dashboards/office-performance/[location]/OfficeCarousel.tsx` | Import + render `ServiceSection`, add to switch |

---

## Chunk 1: Types and Compliance Wiring

### Task 1: Add ServiceData type and carousel section

**Files:**
- Modify: `src/lib/office-performance-types.ts`

- [ ] **Step 1: Add the `ServiceData` interface**

Add after the `InspectionData` interface (around line 167):

```typescript
export interface ServiceData {
  /** Open service tickets at this location */
  openTickets: number;
  /** Service tickets resolved/closed this month */
  resolvedMtd: number;
  /** Average days from ticket create to resolution (MTD resolved tickets) */
  avgDaysToResolve: number;
  /** Service-pipeline deals by stage (active only) */
  dealsByStage: StageCount[];
  /** Total active service deals at this location */
  activeDeals: number;
  /** Zuper service job compliance (Service Visit + Service Revisit combined) */
  compliance?: SectionCompliance;
  /** Tech leaderboard — service jobs completed this month */
  leaderboard: EnrichedPersonStat[];
  /** Deal rows for the deal list */
  deals: DealRow[];
  /** Total deal count (before truncation) */
  totalCount: number;
}
```

- [ ] **Step 2: Add `service` to the `OfficePerformanceData` interface**

Update the interface (around line 197) to include:

```typescript
export interface OfficePerformanceData {
  location: string;
  lastUpdated: string;
  teamResults: TeamResultsData;
  surveys: SurveyData;
  installs: InstallData;
  inspections: InspectionData;
  service?: ServiceData;  // optional so existing caches don't break
}
```

- [ ] **Step 3: Add `service` to `CarouselSection` and configuration arrays**

Update the type union (line 213):
```typescript
export type CarouselSection = "teamResults" | "surveys" | "installs" | "inspections" | "service" | "allLocations" | "goals" | "pipeline" | "calendar" | "calendarWeek" | "calendarDay";
```

Add `"service"` to `CAROUSEL_SECTIONS` array — insert it after `"inspections"` (before `"allLocations"`):
```typescript
export const CAROUSEL_SECTIONS: CarouselSection[] = [
  "teamResults",
  "goals",
  "pipeline",
  "calendar",
  "calendarWeek",
  "calendarDay",
  "surveys",
  "installs",
  "inspections",
  "service",       // ← new
  "allLocations",
];
```

Add to `SECTION_COLORS`:
```typescript
service: "#ef4444",    // red — distinct from all existing section colors
```

Add to `SECTION_LABELS`:
```typescript
service: "SERVICE",
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: Type errors in `OfficeCarousel.tsx` (missing switch case for `"service"`) — that's fine, we'll fix it in Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/office-performance-types.ts
git commit -m "feat(office-perf): add ServiceData type and carousel section config"
```

### Task 2: Register service categories in compliance engine

**Files:**
- Modify: `src/lib/compliance-compute.ts:109-116`

- [ ] **Step 1: Add Service Visit and Service Revisit to CATEGORY_NAME_TO_UID**

In the `CATEGORY_NAME_TO_UID` map (line 109), add two entries:

```typescript
const CATEGORY_NAME_TO_UID: Record<string, string> = {
  "Site Survey": JOB_CATEGORY_UIDS.SITE_SURVEY,
  Construction: JOB_CATEGORY_UIDS.CONSTRUCTION,
  "Construction - Solar": JOB_CATEGORY_UIDS.SOLAR_INSTALL,
  "Construction - Battery": JOB_CATEGORY_UIDS.BATTERY_INSTALL,
  "Construction - EV": JOB_CATEGORY_UIDS.EV_INSTALL,
  Inspection: JOB_CATEGORY_UIDS.INSPECTION,
  "Service Visit": JOB_CATEGORY_UIDS.SERVICE_VISIT,       // ← new
  "Service Revisit": JOB_CATEGORY_UIDS.SERVICE_REVISIT,   // ← new
};
```

- [ ] **Step 2: Verify the UIDs resolve**

Run: `node -e "const z = require('./src/lib/zuper'); console.log(z.JOB_CATEGORY_UIDS.SERVICE_VISIT, z.JOB_CATEGORY_UIDS.SERVICE_REVISIT)"`
Expected: Two UUID strings (cff6f839-... and 8a29a1c0-...)

If this doesn't work due to ESM/TS, just verify the constants exist:
Run: `grep -n 'SERVICE_VISIT\|SERVICE_REVISIT' src/lib/zuper.ts | head -4`
Expected: Lines 241-242 with the UIDs.

- [ ] **Step 3: Commit**

```bash
git add src/lib/compliance-compute.ts
git commit -m "feat(compliance): register Service Visit and Service Revisit job categories"
```

---

## Chunk 2: API — Build Service Data

### Task 3: Add buildServiceData function

**Files:**
- Modify: `src/lib/office-performance.ts`

- [ ] **Step 1: Add ServiceData to the imports**

At the top of the file (around line 8), add `ServiceData` to the type imports:

```typescript
import type {
  OfficePerformanceData,
  PipelineData,
  SurveyData,
  InstallData,
  InspectionData,
  ServiceData,           // ← add
  PersonStat,
  // ... rest unchanged
} from "@/lib/office-performance-types";
```

- [ ] **Step 2: Add service ticket + deal fetching helpers**

Add these imports at the top of the file:

```typescript
import { fetchServiceTickets, searchTicketsWithRetry } from "@/lib/hubspot-tickets";
import { STAGE_MAPS, PIPELINE_IDS, ACTIVE_STAGES } from "@/lib/deals-pipeline";
```

Check which of these are already imported and only add the missing ones. Note: `searchWithRetry` (deals) is already imported — do NOT use it for tickets. Use `searchTicketsWithRetry` from `hubspot-tickets.ts` for ticket queries.

- [ ] **Step 3: Write buildServiceData function**

Add before `getOfficePerformanceData()` (around line 1870):

```typescript
export async function buildServiceData(
  group: DashboardLocationGroup,
  now: Date,
  locationDealIds?: Set<string>,
): Promise<ServiceData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const primaryCanonical = group.canonicals[0];
  const canonicalSet = new Set(group.canonicals);

  // 1. Fetch all open service tickets (already resolved with locations)
  const allTickets = await fetchServiceTickets();
  const locationTickets = allTickets.filter((t) => {
    const loc = normalizeLocation(t.location);
    return loc !== null && canonicalSet.has(loc);
  });

  const openTickets = locationTickets.length;

  // 2. Fetch service pipeline deals for this location
  //    Re-use the same HubSpot search pattern as other sections
  const servicePipelineId = PIPELINE_IDS.service;
  const stageMap = STAGE_MAPS.service;
  const activeStages = ACTIVE_STAGES.service;
  const activeStageIds = Object.entries(stageMap)
    .filter(([, label]) => activeStages.includes(label))
    .map(([id]) => id);

  let serviceDeals: Array<{ id: string; properties: Record<string, string> }> = [];
  let after: string | undefined;

  do {
    const response = await searchWithRetry({
      filterGroups: [{
        filters: [
          { propertyName: "pipeline", operator: "EQ", value: servicePipelineId },
          { propertyName: "dealstage", operator: "IN", values: activeStageIds },
        ],
      }],
      properties: [
        "dealname", "dealstage", "pb_location", "amount",
        "createdate", "hs_lastmodifieddate", "service_type",
      ],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    });
    serviceDeals = serviceDeals.concat(
      (response.results || []).map((d: { id: string; properties: Record<string, string> }) => ({
        id: d.id,
        properties: d.properties,
      }))
    );
    after = response.paging?.next?.after;
  } while (after);

  // Filter to this location
  const locationServiceDeals = serviceDeals.filter((d) => {
    const loc = normalizeLocation(d.properties.pb_location);
    return loc !== null && canonicalSet.has(loc);
  });

  // Stage distribution
  const stageCounts = new Map<string, number>();
  for (const deal of locationServiceDeals) {
    const stageName = stageMap[deal.properties.dealstage] || "Unknown";
    stageCounts.set(stageName, (stageCounts.get(stageName) || 0) + 1);
  }
  const dealsByStage = Array.from(stageCounts.entries())
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => {
      const order = activeStages;
      return order.indexOf(a.stage) - order.indexOf(b.stage);
    });

  // 3. Resolved tickets this month — fetch from HubSpot with closed-date filter
  //    We approximate by counting tickets with close_date in current month.
  //    Since fetchServiceTickets only returns open tickets, we need a separate
  //    lightweight query for resolved MTD count.
  let resolvedMtd = 0;
  let totalResolutionDays = 0;

  try {
    const closedResponse = await searchTicketsWithRetry({
      filterGroups: [{
        filters: [
          { propertyName: "hs_pipeline", operator: "EQ", value: process.env.HUBSPOT_SERVICE_TICKET_PIPELINE_ID || "0" },
          { propertyName: "closed_date", operator: "GTE", value: mtdStart.getTime().toString() },
          { propertyName: "closed_date", operator: "LTE", value: now.getTime().toString() },
        ],
      }],
      properties: ["closed_date", "createdate", "hs_pipeline_stage"],
      limit: 100,
    });

    const closedTickets = closedResponse.results || [];
    // Filter to location would require association resolution which is expensive.
    // For now, use unfiltered count — service tickets are company-wide.
    // TODO: Add location filtering if ticket volume grows large enough to matter.
    resolvedMtd = closedTickets.length;

    for (const t of closedTickets) {
      const created = t.properties?.createdate ? new Date(t.properties.createdate).getTime() : 0;
      const closed = t.properties?.closed_date ? new Date(t.properties.closed_date).getTime() : 0;
      if (created > 0 && closed > 0) {
        totalResolutionDays += (closed - created) / (1000 * 60 * 60 * 24);
      }
    }
  } catch (err) {
    console.warn("[office-performance] Service ticket resolution fetch failed:", err);
  }

  const avgDaysToResolve = resolvedMtd > 0 ? Math.round((totalResolutionDays / resolvedMtd) * 10) / 10 : 0;

  // 4. Zuper service job leaderboard (MTD completions)
  const mtdJobs = await getZuperJobsByLocation(primaryCanonical, "Service Visit", mtdStart, now, locationDealIds);
  const revisitJobs = await getZuperJobsByLocation(primaryCanonical, "Service Revisit", mtdStart, now, locationDealIds);
  const allServiceJobs = [...mtdJobs, ...revisitJobs];

  const userCounts = new Map<string, { name: string; userUid: string; count: number }>();
  for (const job of allServiceJobs) {
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

  const leaderboard: EnrichedPersonStat[] = Array.from(userCounts.values())
    .sort((a, b) => b.count - a.count)
    .map((u) => ({ name: u.name, count: u.count, userUid: u.userUid }));

  // 5. Deal rows for the deal list
  const deals: DealRow[] = locationServiceDeals
    .slice(0, 20)
    .map((d) => ({
      name: d.properties.dealname || "Untitled",
      stage: stageMap[d.properties.dealstage] || "Unknown",
      daysInStage: Math.floor(
        (now.getTime() - new Date(d.properties.hs_lastmodifieddate || d.properties.createdate).getTime()) /
        (1000 * 60 * 60 * 24)
      ),
      overdue: false,
      daysOverdue: 0,
      amount: d.properties.amount ? parseFloat(d.properties.amount) : undefined,
    }));

  return {
    openTickets,
    resolvedMtd,
    avgDaysToResolve,
    dealsByStage,
    activeDeals: locationServiceDeals.length,
    leaderboard,
    deals,
    totalCount: locationServiceDeals.length,
  };
}
```

Note: `extractAssignedUsers` and `getZuperJobsByLocation` are already defined in this file. `normalizeLocation` is already imported. `PIPELINE_IDS`, `STAGE_MAPS`, and `ACTIVE_STAGES` come from `@/lib/deals-pipeline` — check if they're already imported, add if not.

The `searchWithRetry` function is already imported — but it only works for deals. For ticket searches, use the HubSpot client directly. Check if there's a `searchTicketsWithRetry` export from `hubspot-tickets.ts` — if so, use that for the resolved-ticket query. If the ticket search requires `objectType: "tickets"`, you may need to use the HubSpot client's `apiRequest` method or adapt `searchWithRetry` to accept an object type parameter. Inspect `searchWithRetry` to confirm.

- [ ] **Step 4: Wire buildServiceData into getOfficePerformanceData**

In `getOfficePerformanceData()` (line 1952), add `buildServiceData` to the parallel Promise.all:

```typescript
const [teamResults, surveys, installs, inspections, service] = await Promise.all([
  buildTeamResultsData(group, now, locationProjects, locationDealIds),
  buildSurveyData(group, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
  buildInstallData(group, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
  buildInspectionData(group, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
  buildServiceData(group, now, locationDealIds),
]);
```

- [ ] **Step 5: Add service compliance call**

In the compliance Promise.all block (around line 1965), add two more calls for Service Visit and Service Revisit:

```typescript
const [, surveyCompliance, installCompliance, inspectionCompliance, serviceVisitCompliance, serviceRevisitCompliance] = await Promise.all([
  enrichWithQcMetrics(group, null, surveys, installs, inspections),
  computeLocationCompliance("Site Survey", primaryCanonical, 30, locationDealIds).catch((err) => {
    console.warn("[office-performance] Survey compliance fetch failed:", err);
    return null;
  }),
  computeLocationCompliance("Construction", primaryCanonical, 30, locationDealIds).catch((err) => {
    console.warn("[office-performance] Install compliance fetch failed:", err);
    return null;
  }),
  computeLocationCompliance("Inspection", primaryCanonical, 30, locationDealIds).catch((err) => {
    console.warn("[office-performance] Inspection compliance fetch failed:", err);
    return null;
  }),
  computeLocationCompliance("Service Visit", primaryCanonical, 30, locationDealIds).catch((err) => {
    console.warn("[office-performance] Service Visit compliance fetch failed:", err);
    return null;
  }),
  computeLocationCompliance("Service Revisit", primaryCanonical, 30, locationDealIds).catch((err) => {
    console.warn("[office-performance] Service Revisit compliance fetch failed:", err);
    return null;
  }),
]);
```

- [ ] **Step 6: Merge service compliance and patch onto ServiceData**

After the existing compliance patching block (after line 2029), add:

```typescript
// Merge Service Visit + Service Revisit compliance into a single SectionCompliance
if (service && (serviceVisitCompliance || serviceRevisitCompliance)) {
  const primary = serviceVisitCompliance || serviceRevisitCompliance;
  const secondary = serviceVisitCompliance ? serviceRevisitCompliance : null;

  if (primary) {
    const mergedEmployees = [...primary.byEmployee];
    if (secondary) {
      // Merge employee stats: combine counts for employees who appear in both categories
      for (const emp of secondary.byEmployee) {
        const existing = mergedEmployees.find((e) => e.userUid === emp.userUid || e.name === emp.name);
        if (existing) {
          existing.totalJobs += emp.totalJobs;
          existing.completedJobs += emp.completedJobs;
        } else {
          mergedEmployees.push(emp);
        }
      }
    }

    service.compliance = {
      totalJobs: primary.summary.totalJobs + (secondary?.summary.totalJobs || 0),
      completedJobs: primary.summary.completedJobs + (secondary?.summary.completedJobs || 0),
      onTimePercent: primary.summary.onTimePercent, // Use primary (Service Visit) as dominant
      stuckJobs: [...primary.stuckJobs, ...(secondary?.stuckJobs || [])],
      neverStartedCount: primary.summary.neverStartedCount + (secondary?.summary.neverStartedCount || 0),
      avgDaysToComplete: primary.summary.avgDaysToComplete,
      avgDaysLate: primary.summary.avgDaysLate,
      oowUsagePercent: primary.summary.oowUsagePercent,
      oowOnTimePercent: primary.summary.oowOnTimePercent,
      aggregateGrade: primary.summary.aggregateGrade,
      aggregateScore: primary.summary.aggregateScore,
      byEmployee: mergedEmployees,
    };
  }
}
```

- [ ] **Step 7: Add service to the return object**

Update the return statement (around line 2031):

```typescript
return {
  location: group.label,
  lastUpdated: now.toISOString(),
  teamResults,
  surveys,
  installs,
  inspections,
  service,   // ← add
};
```

- [ ] **Step 8: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`
Expected: May still have errors in OfficeCarousel.tsx (switch case) — that's expected. No errors in office-performance.ts or types.

- [ ] **Step 9: Commit**

```bash
git add src/lib/office-performance.ts
git commit -m "feat(office-perf): build service data with tickets, deals, and compliance"
```

---

## Chunk 3: Carousel UI

### Task 4: Add service variant to DealList

**Files:**
- Modify: `src/app/dashboards/office-performance/[location]/DealList.tsx:6`

- [ ] **Step 1: Add `"service"` to the DealListVariant union**

Change line 6:
```typescript
type DealListVariant = "survey" | "install" | "inspection" | "service";
```

Service deals should show amount (like surveys) but not PE flag. The existing logic at lines 49-50 already handles this correctly since `"service"` won't match either `"install"` or `"inspection"`:
- `showAmount` is true when `variant === "survey"` — update this to also include `"service"`:
  ```typescript
  const showAmount = variant === "survey" || variant === "service";
  ```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/office-performance/\[location\]/DealList.tsx
git commit -m "feat(office-perf): add service variant to DealList"
```

### Task 5: Create ServiceSection component

**Files:**
- Create: `src/app/dashboards/office-performance/[location]/ServiceSection.tsx`

- [ ] **Step 1: Create the ServiceSection component**

Follow the exact same layout pattern as `SurveysSection.tsx`: 4 top metric cards → deal list → compliance block → leaderboard.

```tsx
"use client";

import type { ServiceData } from "@/lib/office-performance-types";
import CountUp from "./CountUp";
import Leaderboard from "./Leaderboard";
import DealList from "./DealList";
import ComplianceBlock from "./ComplianceBlock";

interface ServiceSectionProps {
  data: ServiceData;
}

function stageBarColor(stage: string): string {
  switch (stage) {
    case "Project Preparation": return "#3b82f6";
    case "Site Visit Scheduling": return "#f59e0b";
    case "Work In Progress": return "#22c55e";
    case "Inspection": return "#06b6d4";
    case "Invoicing": return "#a855f7";
    default: return "#64748b";
  }
}

export default function ServiceSection({ data }: ServiceSectionProps) {
  const maxStageCount = Math.max(...data.dealsByStage.map((s) => s.count), 1);

  return (
    <div className="flex flex-col h-full px-8 py-5 overflow-hidden">
      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-4 mb-4 flex-shrink-0">
        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.openTickets}
            className="text-[64px] font-extrabold text-red-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Open Service Tickets</div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.resolvedMtd}
            className="text-[64px] font-extrabold text-green-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Resolved This Month</div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.avgDaysToResolve}
            decimals={1}
            suffix="d"
            className="text-[64px] font-extrabold text-amber-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Avg Days to Resolve</div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.activeDeals}
            className="text-[64px] font-extrabold text-blue-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Active Service Deals</div>
        </div>
      </div>

      {/* Stage distribution bar chart */}
      {data.dealsByStage.length > 0 && (
        <div className="bg-white/[0.04] rounded-2xl p-4 border border-white/5 mb-3 flex-shrink-0">
          <div className="text-xs font-semibold text-slate-400 tracking-wider mb-3">
            SERVICE PIPELINE BY STAGE
          </div>
          <div className="flex gap-2 items-end h-16">
            {data.dealsByStage.map((s) => (
              <div key={s.stage} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-xs font-bold text-slate-300">{s.count}</div>
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${Math.max((s.count / maxStageCount) * 48, 4)}px`,
                    backgroundColor: stageBarColor(s.stage),
                  }}
                />
                <div className="text-[10px] text-slate-500 truncate max-w-full" title={s.stage}>
                  {s.stage.replace("Project Preparation", "Prep").replace("Site Visit Scheduling", "Scheduling").replace("Work In Progress", "WIP")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deal list */}
      <div className="mb-2 flex-shrink-0 overflow-hidden">
        <DealList deals={data.deals} variant="service" />
      </div>

      {/* Compliance block */}
      <div className="mb-3 flex-shrink-0">
        <ComplianceBlock compliance={data.compliance} />
      </div>

      {/* Tech leaderboard */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Leaderboard
          title="SERVICE TECH LEADERBOARD — THIS MONTH"
          icon="🔧"
          entries={data.leaderboard}
          accentColor="#ef4444"
          metricLabel="jobs"
        />
      </div>
    </div>
  );
}
```

Note: Task 4 already added `"service"` to the `DealListVariant` type, so `variant="service"` will compile.

- [ ] **Step 2: Verify the component compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i 'ServiceSection\|service' | head -10`

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/office-performance/\[location\]/ServiceSection.tsx
git commit -m "feat(office-perf): add ServiceSection carousel slide component"
```

### Task 6: Wire ServiceSection into the carousel

**Files:**
- Modify: `src/app/dashboards/office-performance/[location]/OfficeCarousel.tsx`

- [ ] **Step 1: Import ServiceSection**

Add to the imports (around line 19):

```typescript
import ServiceSection from "./ServiceSection";
```

- [ ] **Step 2: Add the render case**

In the `renderSection()` switch statement (around line 162), add a case for `"service"`:

```typescript
case "service":
  return data.service ? (
    <ServiceSection data={data.service} />
  ) : (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-slate-400 text-sm">No service data available</div>
      </div>
    </div>
  );
```

- [ ] **Step 3: Verify everything compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/office-performance/\[location\]/OfficeCarousel.tsx
git commit -m "feat(office-perf): wire ServiceSection into carousel rotation"
```

---

## Chunk 4: All-Locations Overview Integration

### Task 7: Add service stats to the all-locations overview (optional — defer)

The all-locations overview page (`AllLocationsSection.tsx`) shows a summary grid of surveys/installs/inspections per location. Adding a service column would be a natural extension but may be deferred. This task is optional.

**Files:**
- Modify: `src/lib/office-performance-types.ts` — add service field to `LocationOverview`
- Modify: `src/app/api/office-performance/all/route.ts` — include service data in aggregation
- Modify: `src/app/dashboards/office-performance/[location]/AllLocationsSection.tsx` — render service column
- Modify: `src/app/dashboards/office-performance/[location]/AllLocationsCategorySection.tsx` — add service category

This is left as a follow-up since the per-location carousel is the primary deliverable.

---

## Implementation Notes

1. **Ticket search for resolved MTD**: `searchWithRetry` in `hubspot.ts` is deals-only. Use `searchTicketsWithRetry` from `hubspot-tickets.ts` for ticket queries. If `searchTicketsWithRetry` is not exported, you'll need to export it — it's defined at line 123 of `hubspot-tickets.ts`.

2. **Location filtering for resolved tickets**: The current plan counts resolved tickets company-wide (not per-location) because resolving ticket→deal→location associations for closed tickets is expensive. This is acceptable for now since service ticket volume is low. Add a TODO comment noting this limitation.

3. **Service Visit vs Service Revisit compliance**: We fetch both categories separately and merge them into a single SectionCompliance. Service Visit is treated as the "primary" for aggregate metrics (grade, score) since it has higher volume.

4. **Cache invalidation**: The service data piggybacks on the existing office-performance cache key. The `complianceVersionTag()` already handles compliance flag changes. No additional cache configuration needed.

5. **Performance**: Adding `buildServiceData` to the existing `Promise.all` keeps it parallel. The two extra compliance calls (`Service Visit` + `Service Revisit`) add ~2-4s to cold-cache requests. This is within the 120s maxDuration budget.
