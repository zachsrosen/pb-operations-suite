# Shop Health: Service + D&R/Roofing Sections — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Service and combined D&R+Roofing sections to the Weekly Shop Health dashboard, plus 2 new hero metrics and 3 new All-Locations comparison columns.

**Architecture:** New pure-computation files (`shop-health-service.ts`, `shop-health-dnr-roofing.ts`) called by the existing orchestrator (`shop-health.ts`). A new pipeline-agnostic deal fetcher (`fetchDealsByPipelines`) is added next to `fetchAllProjects` to avoid corrupting Project-only callers. A new ticket fetcher (`fetchClosedTicketsSince`) feeds closed-ticket metrics. Stage bucketing uses raw HubSpot stage IDs (stable, globally unique) rather than labels, since `transformDealToProject` only resolves Project-pipeline labels.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5, Jest, HubSpot client v8, React Query v5, Tailwind v4. Existing pattern: `appCache.getOrFetch` for caching, `searchWithRetry` for HubSpot API rate-limit retry, `DASHBOARD_LOCATION_GROUPS` for location filtering.

**Spec:** `docs/superpowers/specs/2026-05-26-shop-health-service-dnr-roofing-design.md`

**Branch:** `feat/shop-health-service-dnr-roofing` (already created from `origin/main`)

---

## File Structure

```
NEW
  src/lib/shop-health-service.ts             ~400 lines — pure compute fn for Service section
  src/lib/shop-health-dnr-roofing.ts         ~500 lines — pure compute fn for D&R+Roofing section + stage bucketing
  src/app/dashboards/shop-health/ServiceSection.tsx     ~150 lines
  src/app/dashboards/shop-health/DnrRoofingSection.tsx  ~220 lines
  src/__tests__/lib/shop-health-service.test.ts
  src/__tests__/lib/shop-health-dnr-roofing.test.ts
  src/__tests__/lib/bucket-stages.test.ts    — exhaustive bucketing coverage

MODIFY
  src/lib/hubspot.ts             — add pipelineId field, fetchDealsByPipelines()
  src/lib/hubspot-tickets.ts     — add hs_lastclosedate property, fetchClosedTicketsSince()
  src/lib/deal-reader.ts         — pipelineId default
  src/lib/shop-health.ts         — call new fetcher, partition, delegate, merge
  src/lib/shop-health-types.ts   — new section types, hero keys, drilldown keys, DrilldownTicket, 3 overview row fields
  src/lib/cache.ts               — add DEALS_ALL_PIPELINES_ACTIVE key
  src/app/dashboards/shop-health/page.tsx          — render two new SectionCards
  src/app/dashboards/shop-health/HeroMetrics.tsx   — render 2 new hero cards, adjust grid
  src/app/dashboards/shop-health/AllLocationsView.tsx — add 3 new columns
  src/app/api/shop-health/overview/route.ts        — populate new row fields
  src/components/ui/DrilldownMetricCard.tsx        — accept tickets prop alongside deals
```

---

## Chunk 1: Type Foundations

Lay down all the new types first so subsequent code has stable signatures to write against. No behavior yet — pure type plumbing.

### Task 1: Add `pipelineId` to `Project` interface

**Files:**
- Modify: `src/lib/hubspot.ts:254-431` (the `Project` interface), `src/lib/hubspot.ts:1027` (the transform)
- Modify: `src/lib/deal-reader.ts` (add default)

- [ ] **Step 1: Add field to interface**

In `src/lib/hubspot.ts`, find the `Project` interface (around line 254). Locate the "Project details" block (currently ending with `url: string;` near line 273). Add `pipelineId` immediately after `stageId`:

```typescript
  stage: string;
  stageId: string;
  pipelineId: string;  // NEW — HubSpot pipeline ID this deal belongs to
  amount: number;
```

- [ ] **Step 2: Populate in transform**

In `src/lib/hubspot.ts`, find `transformDealToProject` (around line 848). Use grep to find the **returned object literal** (not the computation block):

```bash
grep -n "stageId: stageId\|stageName: stageName" src/lib/hubspot.ts
```

Insert `pipelineId: String(deal.pipeline || ""),` adjacent to the line that sets `stageId: stageId,` inside the returned object literal. **Do NOT** insert near line 1027 — that's a `daysSinceStageMovement` computation, not the return object.

The `pipeline` raw property is already fetched (it's listed at `hubspot.ts:540` inside `DEAL_PROPERTIES`).

- [ ] **Step 3: Add default to deal-reader.ts**

In `src/lib/deal-reader.ts`, find the default Project object literal (search for `noSameDayResponse: 0,` which was the last similar addition). Add:

```typescript
  pipelineId: "",
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "(hubspot|deal-reader)\.ts" | head -20`
Expected: no errors in `hubspot.ts` or `deal-reader.ts`. Pre-existing errors in unrelated files (e.g. `pe-scraper-sync`, `catalog-expire-pending`) can be ignored.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hubspot.ts src/lib/deal-reader.ts
git commit -m "feat(shop-health): add pipelineId field to Project type"
```

### Task 2: Add new section + drill-down + hero types

**Files:**
- Modify: `src/lib/shop-health-types.ts`

- [ ] **Step 1: Add `ServiceSection` interface**

Append to `src/lib/shop-health-types.ts` (after the existing section interfaces, before `ShopHealthOverviewRow`):

```typescript
export interface ServiceSection {
  // Job pipeline
  activeJobs: number;
  awaitingSiteVisit: number;
  workInProgress: number;
  awaitingInspection: number;

  // Ticket activity
  openTickets: number;
  ticketsCreatedThisWeek: number;
  ticketsClosedThisWeek: number;
  netTicketChange: number;

  // Ticket health
  avgTicketAgeDays: number | null;
  avgResolutionHours: number | null;
  stuckTicketsOver7d: number;
}
```

- [ ] **Step 2: Add `DnrRoofingSection` interface**

Append directly after `ServiceSection`:

```typescript
export interface DnrRoofingSection {
  // Throughput summary
  dnrActive: number;
  dnrCompletedThisWeek: number;
  roofingActive: number;
  roofingCompletedThisWeek: number;

  // D&R stage breakdown
  dnrPreDetach: number;
  dnrDetachInProgress: number;
  dnrRoofingPhase: number;
  dnrResetBlocked: number;
  dnrResetPhase: number;
  dnrCloseout: number;

  // Roofing stage breakdown
  roofPreProduction: number;
  roofInProduction: number;
  roofPostProduction: number;

  // Aging
  stuckDnrJobs: number;
  stuckRoofingJobs: number;

  // Diagnostic
  unknownDnrStageCount: number;
  unknownRoofingStageCount: number;
}
```

- [ ] **Step 3: Add `DrilldownTicket` interface**

After `DrilldownDeal` (search for `export interface DrilldownDeal`):

```typescript
export interface DrilldownTicket {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  createDate: string | null;
  lastModified: string | null;
  ageDays: number | null;
  dealName: string | null;
}
```

- [ ] **Step 4: Extend `ShopHealthDrilldown`**

Find `export interface ShopHealthDrilldown` and add new keys at the end:

```typescript
  // Service section
  serviceActiveJobs: DrilldownDeal[];
  serviceAwaitingSiteVisit: DrilldownDeal[];
  serviceWorkInProgress: DrilldownDeal[];
  serviceAwaitingInspection: DrilldownDeal[];
  serviceOpenTickets: DrilldownTicket[];
  serviceTicketsCreated: DrilldownTicket[];
  serviceTicketsClosed: DrilldownTicket[];
  serviceStuckTickets: DrilldownTicket[];

  // D&R + Roofing section
  dnrActive: DrilldownDeal[];
  dnrCompleted: DrilldownDeal[];
  dnrPreDetach: DrilldownDeal[];
  dnrDetachInProgress: DrilldownDeal[];
  dnrRoofingPhase: DrilldownDeal[];
  dnrResetBlocked: DrilldownDeal[];
  dnrResetPhase: DrilldownDeal[];
  dnrCloseout: DrilldownDeal[];
  dnrStuck: DrilldownDeal[];
  roofingActive: DrilldownDeal[];
  roofingCompleted: DrilldownDeal[];
  roofingPreProduction: DrilldownDeal[];
  roofingInProduction: DrilldownDeal[];
  roofingPostProduction: DrilldownDeal[];
  roofingStuck: DrilldownDeal[];
```

- [ ] **Step 5: Add hero keys to `ShopHealthHeroes`**

Find `export interface ShopHealthHeroes` and add at the end:

```typescript
  openTickets: HeroMetric;
  dnrRoofingActive: HeroMetric;
```

- [ ] **Step 6: Extend `ShopHealthOverviewRow`**

Find `export interface ShopHealthOverviewRow` (currently at line 197) and add at the end:

```typescript
  openTickets: HeroMetric;
  dnrActive: HeroMetric;
  roofActive: HeroMetric;
```

- [ ] **Step 7: Add `service` and `dnrRoofing` to `ShopHealthData` and `SectionHealth`**

Find `export interface ShopHealthData` and add:

```typescript
  service: ServiceSection;
  dnrRoofing: DnrRoofingSection;
```

Find `export interface SectionHealth` (around line 113) and add:

```typescript
  service: HealthStatus;
  dnrRoofing: HealthStatus;
```

This unblocks the `<SectionCard health={data.sectionHealth.service}>` and `<SectionCard health={data.sectionHealth.dnrRoofing}>` wiring in Task 13.

- [ ] **Step 8: Verify TypeScript compiles for the type file alone**

Run: `npx tsc --noEmit 2>&1 | grep "shop-health-types\.ts"`
Expected: no errors. (Implementations will fail compile in other files — that's expected and gets fixed in subsequent tasks.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/shop-health-types.ts
git commit -m "feat(shop-health): add Service, DnrRoofing types + ticket drilldown + heroes"
```

### Task 3: Add new cache key

**Files:**
- Modify: `src/lib/cache.ts:270-294` (the `CACHE_KEYS` object)

- [ ] **Step 1: Add the key**

In `src/lib/cache.ts`, find `export const CACHE_KEYS = {` (line 270). Add after `PROJECTS_ACTIVE`:

```typescript
  DEALS_ALL_PIPELINES_ACTIVE: "deals:all-pipelines:active",
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/cache.ts
git commit -m "feat(shop-health): add DEALS_ALL_PIPELINES_ACTIVE cache key"
```

---

## Chunk 2: Data Layer

Build the new fetchers. These are pure data-layer additions — no orchestration changes yet.

### Task 4: Build `fetchDealsByPipelines` (TDD)

**Files:**
- Create: `src/__tests__/lib/fetch-deals-by-pipelines.test.ts`
- Modify: `src/lib/hubspot.ts` (add new exported function near `fetchAllProjects` at line 1153)

- [ ] **Step 1: Read existing fetcher for reference**

Read `src/lib/hubspot.ts` lines 1153-1280 to see the two-phase pattern: (1) search for deal IDs with minimal properties, (2) batch-read full properties. Mirror this pattern exactly for the new fetcher.

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/lib/fetch-deals-by-pipelines.test.ts`:

```typescript
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

// Mock hubspotClient
const mockSearch = jest.fn();
const mockBatchRead = jest.fn();
jest.mock("@/lib/hubspot", () => {
  const actual = jest.requireActual("@/lib/hubspot");
  return {
    ...actual,
    hubspotClient: {
      crm: {
        deals: {
          searchApi: { doSearch: mockSearch },
          batchApi: { read: mockBatchRead },
        },
      },
    },
  };
});

import { fetchDealsByPipelines } from "@/lib/hubspot";

describe("fetchDealsByPipelines", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockBatchRead.mockReset();
  });

  it("queries HubSpot with IN filter on multiple pipeline IDs", async () => {
    mockSearch.mockResolvedValueOnce({ results: [], paging: undefined });

    await fetchDealsByPipelines(["6900017", "23928924"], false);

    expect(mockSearch).toHaveBeenCalled();
    const callArg = mockSearch.mock.calls[0][0];
    const pipelineFilter = callArg.filterGroups[0].filters.find(
      (f: { propertyName: string }) => f.propertyName === "pipeline"
    );
    expect(pipelineFilter).toBeDefined();
    expect(pipelineFilter.operator).toBe(FilterOperatorEnum.In);
    expect(pipelineFilter.values).toEqual(["6900017", "23928924"]);
  });

  it("returns empty array when no deals match", async () => {
    mockSearch.mockResolvedValueOnce({ results: [], paging: undefined });
    const result = await fetchDealsByPipelines(["6900017"], true);
    expect(result).toEqual([]);
  });

  it("excludes terminal stages when activeOnly=true", async () => {
    mockSearch.mockResolvedValueOnce({ results: [], paging: undefined });
    await fetchDealsByPipelines(["21997330"], true); // D&R

    const callArg = mockSearch.mock.calls[0][0];
    const stageFilters = callArg.filterGroups[0].filters.filter(
      (f: { propertyName: string }) => f.propertyName === "dealstage"
    );
    // D&R terminal stages: Complete (68245827), Cancelled (52474745), On-hold (72700977)
    expect(stageFilters.length).toBeGreaterThanOrEqual(3);
    expect(stageFilters.every((f: { operator: string }) => f.operator === FilterOperatorEnum.Neq)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx jest src/__tests__/lib/fetch-deals-by-pipelines.test.ts --no-coverage`
Expected: `fetchDealsByPipelines is not a function` or compile error.

- [ ] **Step 4: Implement `fetchDealsByPipelines`**

In `src/lib/hubspot.ts`, immediately after `fetchAllProjects` (after its closing brace, around line 1300), add:

```typescript
/**
 * Pipeline-agnostic deal fetcher. Unlike fetchAllProjects (Project pipeline only),
 * this accepts arbitrary pipeline IDs and computes per-pipeline terminal stage
 * filters from STAGE_MAPS in deals-pipeline.ts when activeOnly=true.
 *
 * Used by shop-health to fetch Project + Service + D&R + Roofing in one call.
 */
export async function fetchDealsByPipelines(
  pipelineIds: string[],
  activeOnly: boolean
): Promise<Project[]> {
  if (pipelineIds.length === 0) return [];

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  // Import lazily to avoid circular dep
  const { STAGE_MAPS, ACTIVE_STAGES, PIPELINE_IDS } = await import("./deals-pipeline");

  // Build terminal stage ID list from STAGE_MAPS when activeOnly
  const terminalStageIds: string[] = [];
  if (activeOnly) {
    // Slug lookup: pipelineId → pipeline slug (e.g. "21997330" → "dnr")
    const idToSlug: Record<string, string> = {};
    for (const [slug, id] of Object.entries(PIPELINE_IDS)) {
      idToSlug[id] = slug;
    }

    for (const pipelineId of pipelineIds) {
      const slug = idToSlug[pipelineId];
      if (!slug) continue;
      const stageMap = STAGE_MAPS[slug] || {};
      const activeStageNames = new Set(ACTIVE_STAGES[slug] || []);
      // Stage IDs whose label is NOT in the active list are terminal
      for (const [stageId, stageName] of Object.entries(stageMap)) {
        if (!activeStageNames.has(stageName)) {
          terminalStageIds.push(stageId);
        }
      }
    }
  }

  const filters: Array<
    | { propertyName: string; operator: typeof FilterOperatorEnum.In; values: string[] }
    | { propertyName: string; operator: typeof FilterOperatorEnum.Neq; value: string }
  > = [
    {
      propertyName: "pipeline",
      operator: FilterOperatorEnum.In,
      values: pipelineIds,
    },
  ];

  for (const stageId of terminalStageIds) {
    filters.push({
      propertyName: "dealstage",
      operator: FilterOperatorEnum.Neq,
      value: stageId,
    });
  }

  // ── Phase 1: Collect deal IDs ──
  const allDealIds: string[] = [];
  let after: string | undefined;
  const MAX_PAGINATION_PAGES = 100;
  for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
    const response = await searchWithRetry({
      filterGroups: [{ filters }],
      properties: ["hs_object_id"],
      limit: 100,
      after,
    });
    for (const deal of response.results || []) {
      allDealIds.push(deal.id);
    }
    after = response.paging?.next?.after;
    if (!after) break;
  }

  if (allDealIds.length === 0) return [];

  // ── Phase 2: Batch-read full properties ──
  const ownerMap = await getOwnerMap();
  const surveyorMap = await getSurveyorMap();
  const allDeals: Project[] = [];

  const BATCH_SIZE = 100;
  for (const batch of chunk(allDealIds, BATCH_SIZE)) {
    const batchResponse = await hubspotClient.crm.deals.batchApi.read({
      inputs: batch.map((id) => ({ id })),
      properties: DEAL_PROPERTIES,
      propertiesWithHistory: [],
    });
    for (const deal of batchResponse.results || []) {
      allDeals.push(transformDealToProject(deal.properties, portalId, ownerMap, surveyorMap));
    }
  }

  return allDeals;
}
```

Note: the `FilterOperatorEnum.In` type was previously not in the local filter type. The type annotation above explicitly allows both `In` (with `values`) and `Neq` (with `value`).

- [ ] **Step 5: Run tests, verify pass**

Run: `npx jest src/__tests__/lib/fetch-deals-by-pipelines.test.ts --no-coverage`
Expected: 3 tests pass.

- [ ] **Step 6: Verify whole-file compile**

Run: `npx tsc --noEmit 2>&1 | grep "src/lib/hubspot.ts"`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/hubspot.ts src/__tests__/lib/fetch-deals-by-pipelines.test.ts
git commit -m "feat(shop-health): add fetchDealsByPipelines for multi-pipeline queries"
```

### Task 5: Add `hs_lastclosedate` to TICKET_PROPERTIES + `fetchClosedTicketsSince`

**Files:**
- Modify: `src/lib/hubspot-tickets.ts:99` (TICKET_PROPERTIES) and append new function
- Modify: `src/lib/hubspot-tickets.ts:34-46` (HubSpotTicket / EnrichedTicketItem) to surface the close date
- Create: `src/__tests__/lib/fetch-closed-tickets.test.ts`

- [ ] **Step 1: Add property to fetch list**

In `src/lib/hubspot-tickets.ts`, find `const TICKET_PROPERTIES = [` (around line 99). Add at the end of the array:

```typescript
  "hs_lastclosedate",
```

- [ ] **Step 2: Surface the close date on the interface**

Find `export interface HubSpotTicket` (around line 34) and add a string field for the raw close date. Then in the place that builds the `EnrichedTicketItem` (search for `transformTicketToPriorityItem` around line 175), add a `closedDate: string | null` field to the priority item if it isn't already there — or, simpler: expose `closedDate` only on a new shape used by the close fetcher.

For minimal blast radius, define a NEW return type for `fetchClosedTicketsSince` rather than threading `closedDate` through the existing `EnrichedTicketItem`:

```typescript
export interface ClosedTicketItem {
  id: string;
  subject: string;
  createDate: string;
  closedDate: string;  // hs_lastclosedate
  stageName: string;
  _derivedLocation: string | null;
  resolutionHours: number;  // computed: (closedDate − createDate) / 3600s
}
```

- [ ] **Step 3: Write failing test**

Create `src/__tests__/lib/fetch-closed-tickets.test.ts`:

```typescript
const mockSearch = jest.fn();
const mockBatchRead = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      tickets: {
        searchApi: { doSearch: mockSearch },
        batchApi: { read: mockBatchRead },
      },
    },
  },
}));

import { fetchClosedTicketsSince } from "@/lib/hubspot-tickets";

describe("fetchClosedTicketsSince", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockBatchRead.mockReset();
  });

  it("filters by hs_lastclosedate >= sinceIso", async () => {
    mockSearch.mockResolvedValueOnce({ results: [], paging: undefined });
    await fetchClosedTicketsSince("2026-05-19T00:00:00Z");

    const callArg = mockSearch.mock.calls[0][0];
    const closeDateFilter = callArg.filterGroups[0].filters.find(
      (f: { propertyName: string }) => f.propertyName === "hs_lastclosedate"
    );
    expect(closeDateFilter).toBeDefined();
    expect(closeDateFilter.operator).toBe("GTE");
    expect(closeDateFilter.value).toBe("2026-05-19T00:00:00Z");
  });

  it("computes resolutionHours from createDate and closedDate", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [{ id: "T1" }],
      paging: undefined,
    });
    mockBatchRead.mockResolvedValueOnce({
      results: [
        {
          id: "T1",
          properties: {
            hs_object_id: "T1",
            subject: "X",
            createdate: "2026-05-20T00:00:00Z",
            hs_lastclosedate: "2026-05-20T06:00:00Z",
            hs_pipeline_stage: "closed-stage-id",
          },
        },
      ],
    });

    // Stub getTicketStageMap to identify the stage as "closed"
    jest.spyOn(await import("@/lib/hubspot-tickets"), "getTicketStageMap").mockResolvedValueOnce({
      stageMap: { "closed-stage-id": "Closed" },
    } as never);

    const result = await fetchClosedTicketsSince("2026-05-19T00:00:00Z");
    expect(result).toHaveLength(1);
    expect(result[0].resolutionHours).toBe(6);
  });
});
```

- [ ] **Step 4: Run test, verify it fails**

Run: `npx jest src/__tests__/lib/fetch-closed-tickets.test.ts --no-coverage`
Expected: `fetchClosedTicketsSince is not a function`.

- [ ] **Step 5: Implement `fetchClosedTicketsSince`**

Append to `src/lib/hubspot-tickets.ts` (after `fetchServiceTickets`):

```typescript
/**
 * Fetch tickets that were closed since the given ISO date.
 * Used by shop-health for "tickets closed this week" + avg resolution time.
 *
 * Filters server-side on hs_lastclosedate >= sinceIso, then post-filters to
 * stages whose label matches /closed|done|resolved|completed/i to ensure
 * we only count truly-closed tickets (not just stage moves into a closed stage).
 */
export async function fetchClosedTicketsSince(sinceIso: string): Promise<ClosedTicketItem[]> {
  const { stageMap } = await getTicketStageMap();

  const closedStageIds = Object.entries(stageMap)
    .filter(([, label]) => /closed|done|resolved|completed/i.test(label))
    .map(([id]) => id);

  if (closedStageIds.length === 0) return [];

  const filters: Array<{ propertyName: string; operator: string; value?: string; values?: string[] }> = [
    {
      propertyName: "hs_lastclosedate",
      operator: "GTE",
      value: sinceIso,
    },
    {
      propertyName: "hs_pipeline_stage",
      operator: "IN",
      values: closedStageIds,
    },
  ];

  // Phase 1: collect IDs
  const allTicketIds: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const response = await searchTicketsWithRetry({
      filterGroups: [{ filters }],
      properties: ["hs_object_id"],
      limit: 100,
      after,
    });
    for (const t of response.results || []) {
      allTicketIds.push(t.id);
    }
    after = response.paging?.next?.after;
    if (!after) break;
  }

  if (allTicketIds.length === 0) return [];

  // Phase 2: batch-read
  const out: ClosedTicketItem[] = [];
  for (const batch of chunk(allTicketIds, 100)) {
    const batchResp = await hubspotClient.crm.tickets.batchApi.read({
      inputs: batch.map((id) => ({ id })),
      properties: TICKET_PROPERTIES,
      propertiesWithHistory: [],
    });
    for (const t of batchResp.results || []) {
      const props = t.properties as Record<string, string | null>;
      const createDate = props.createdate || "";
      const closedDate = props.hs_lastclosedate || "";
      if (!createDate || !closedDate) continue;
      const resolutionHours =
        (new Date(closedDate).getTime() - new Date(createDate).getTime()) / 3_600_000;
      out.push({
        id: t.id,
        subject: props.subject || "",
        createDate,
        closedDate,
        stageName: stageMap[props.hs_pipeline_stage || ""] || "",
        _derivedLocation: null, // resolved later if needed
        resolutionHours,
      });
    }
  }

  return out;
}
```

Note: `chunk` and `searchTicketsWithRetry` are already imported/defined in `hubspot-tickets.ts`. Use them as-is.

- [ ] **Step 6: Run tests, verify pass**

Run: `npx jest src/__tests__/lib/fetch-closed-tickets.test.ts --no-coverage`
Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/hubspot-tickets.ts src/__tests__/lib/fetch-closed-tickets.test.ts
git commit -m "feat(shop-health): add fetchClosedTicketsSince for resolution metrics"
```

---

## Chunk 3: Stage Bucketing

Pure functions for mapping HubSpot stage IDs to dashboard buckets. Tested exhaustively because they are the single source of truth for the dashboard's stage-level breakdowns.

### Task 6: Build `bucketDnrStages` and `bucketRoofingStages` (TDD)

**Files:**
- Create: `src/__tests__/lib/bucket-stages.test.ts`
- Create: `src/lib/shop-health-dnr-roofing.ts` (start with bucketing helpers only)

- [ ] **Step 1: Write failing test for D&R bucketing**

Create `src/__tests__/lib/bucket-stages.test.ts`:

```typescript
import { bucketDnrStages, bucketRoofingStages } from "@/lib/shop-health-dnr-roofing";

describe("bucketDnrStages", () => {
  const cases: Array<[string, string, ReturnType<typeof bucketDnrStages>]> = [
    ["Kickoff", "52474739", "preDetach"],
    ["Site Survey", "52474740", "preDetach"],
    ["Design", "52474741", "preDetach"],
    ["Permit", "52474742", "preDetach"],
    ["Ready for Detach", "78437201", "preDetach"],
    ["Detach", "52474743", "detachInProgress"],
    ["Detach Complete - Roofing In Progress", "78453339", "roofingPhase"],
    ["Reset Blocked - Waiting on Payment", "78412639", "resetBlocked"],
    ["Ready for Reset", "78412640", "resetPhase"],
    ["Reset", "52474744", "resetPhase"],
    ["Inspection", "55098156", "closeout"],
    ["Closeout", "52498440", "closeout"],
    ["Complete", "68245827", "terminal"],
    ["Cancelled", "52474745", "terminal"],
    ["On-hold", "72700977", "terminal"],
  ];

  it.each(cases)("buckets %s (%s) → %s", (_label, id, expected) => {
    expect(bucketDnrStages(id)).toBe(expected);
  });

  it("returns 'unknown' for an unmapped stage ID", () => {
    expect(bucketDnrStages("99999999")).toBe("unknown");
  });
});

describe("bucketRoofingStages", () => {
  const cases: Array<[string, string, ReturnType<typeof bucketRoofingStages>]> = [
    ["On Hold", "1117662745", "preProduction"],
    ["Color Selection", "1117662746", "preProduction"],
    ["Material & Labor Order", "1215078279", "preProduction"],
    ["Confirm Dates", "1117662747", "preProduction"],
    ["Staged", "1215078280", "preProduction"],
    ["Production", "1215078281", "inProduction"],
    ["Post Production", "1215078282", "postProduction"],
    ["Invoice/Collections", "1215078283", "postProduction"],
    ["Job Close Out Paperwork", "1215078284", "postProduction"],
    ["Job Completed", "1215078285", "terminal"],
  ];

  it.each(cases)("buckets %s (%s) → %s", (_label, id, expected) => {
    expect(bucketRoofingStages(id)).toBe(expected);
  });

  it("returns 'unknown' for an unmapped stage ID", () => {
    expect(bucketRoofingStages("99999999")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest src/__tests__/lib/bucket-stages.test.ts --no-coverage`
Expected: `Cannot find module '@/lib/shop-health-dnr-roofing'`.

- [ ] **Step 3: Create the bucketing helpers**

Create `src/lib/shop-health-dnr-roofing.ts`:

```typescript
/**
 * D&R + Roofing shop-health computation.
 *
 * Pure functions over the deals + goals passed in by the orchestrator.
 * No DB or HubSpot API calls.
 */

// ── Stage bucketing ────────────────────────────────────────────────────────
//
// Bucket by HubSpot stage ID, not label.
// transformDealToProject only resolves Project pipeline labels, so non-project
// deals have stageName = raw stageId. Stage IDs are globally unique in HubSpot.

export type DnrBucket =
  | "preDetach"
  | "detachInProgress"
  | "roofingPhase"
  | "resetBlocked"
  | "resetPhase"
  | "closeout"
  | "terminal"
  | "unknown";

const DNR_STAGE_BUCKETS: Record<string, DnrBucket> = {
  "52474739": "preDetach",         // Kickoff
  "52474740": "preDetach",         // Site Survey
  "52474741": "preDetach",         // Design
  "52474742": "preDetach",         // Permit
  "78437201": "preDetach",         // Ready for Detach
  "52474743": "detachInProgress",  // Detach
  "78453339": "roofingPhase",      // Detach Complete - Roofing In Progress
  "78412639": "resetBlocked",      // Reset Blocked - Waiting on Payment
  "78412640": "resetPhase",        // Ready for Reset
  "52474744": "resetPhase",        // Reset
  "55098156": "closeout",          // Inspection
  "52498440": "closeout",          // Closeout
  "68245827": "terminal",          // Complete
  "52474745": "terminal",          // Cancelled
  "72700977": "terminal",          // On-hold
};

export function bucketDnrStages(stageId: string): DnrBucket {
  return DNR_STAGE_BUCKETS[stageId] ?? "unknown";
}

export type RoofingBucket =
  | "preProduction"
  | "inProduction"
  | "postProduction"
  | "terminal"
  | "unknown";

const ROOFING_STAGE_BUCKETS: Record<string, RoofingBucket> = {
  "1117662745": "preProduction",   // On Hold
  "1117662746": "preProduction",   // Color Selection
  "1215078279": "preProduction",   // Material & Labor Order
  "1117662747": "preProduction",   // Confirm Dates
  "1215078280": "preProduction",   // Staged
  "1215078281": "inProduction",    // Production
  "1215078282": "postProduction",  // Post Production
  "1215078283": "postProduction",  // Invoice/Collections
  "1215078284": "postProduction",  // Job Close Out Paperwork
  "1215078285": "terminal",        // Job Completed
};

export function bucketRoofingStages(stageId: string): RoofingBucket {
  return ROOFING_STAGE_BUCKETS[stageId] ?? "unknown";
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest src/__tests__/lib/bucket-stages.test.ts --no-coverage`
Expected: all 26 cases pass + 2 unknown tests pass = 28 total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop-health-dnr-roofing.ts src/__tests__/lib/bucket-stages.test.ts
git commit -m "feat(shop-health): stage bucketing for D&R and Roofing pipelines"
```

---

## Chunk 4: Compute Functions (Service + D&R/Roofing)

The heart of the work. Pure functions that produce section data + drilldowns from input deals/tickets/goals.

### Task 7: Build `computeServiceHealth` (TDD)

**Files:**
- Create: `src/lib/shop-health-service.ts`
- Create: `src/__tests__/lib/shop-health-service.test.ts`

- [ ] **Step 1: Write the test scaffold**

Create `src/__tests__/lib/shop-health-service.test.ts`:

```typescript
import { computeServiceHealth } from "@/lib/shop-health-service";
import type { Project } from "@/lib/hubspot";

function makeDeal(over: Partial<Project>): Project {
  return {
    id: 1, name: "Test", projectNumber: "P1",
    pbLocation: "Westminster", ahj: "", utility: "", address: "", city: "", state: "", postalCode: "",
    projectType: "", stage: "", stageId: "", pipelineId: "23928924", amount: 1000, url: "",
    tags: [], isParticipateEnergy: false, participateEnergyStatus: null,
    isSiteSurveyScheduled: false, isSiteSurveyCompleted: false, isDASent: false,
    isDesignApproved: false, isDesignDrafted: false, isDesignCompleted: false,
    isPermitSubmitted: false, isPermitIssued: false, isInterconnectionSubmitted: false,
    isInterconnectionApproved: false,
    threeceEvStatus: null, threeceBatteryStatus: null, sgipStatus: null, pbsrStatus: null, cpaStatus: null,
    // ... add ALL Project fields with sensible zero/null defaults
    // (full version goes here — copy from src/lib/deal-reader.ts default factory)
    ...over,
  } as Project;
}

describe("computeServiceHealth", () => {
  const weekStart = new Date("2026-05-25T00:00:00Z");

  it("returns zero counts when no deals or tickets", () => {
    const { section } = computeServiceHealth([], [], [], weekStart);
    expect(section.activeJobs).toBe(0);
    expect(section.openTickets).toBe(0);
    expect(section.avgTicketAgeDays).toBeNull();
    expect(section.avgResolutionHours).toBeNull();
  });

  it("counts deals by stage", () => {
    const deals = [
      makeDeal({ id: 1, stageId: "1058924076" }), // Site Visit Scheduling
      makeDeal({ id: 2, stageId: "1058924076" }),
      makeDeal({ id: 3, stageId: "171758480" }),  // Work In Progress
      makeDeal({ id: 4, stageId: "1058924077" }), // Inspection
      makeDeal({ id: 5, stageId: "76979603" }),   // Completed — should NOT count active
    ];
    const { section } = computeServiceHealth(deals, [], [], weekStart);
    expect(section.activeJobs).toBe(4);
    expect(section.awaitingSiteVisit).toBe(2);
    expect(section.workInProgress).toBe(1);
    expect(section.awaitingInspection).toBe(1);
  });

  // Helper to build a valid EnrichedTicketItem (extends PriorityItem)
  function makeTicket(over: { id: string; createDate: string; lastModified?: string }): EnrichedTicketItem {
    return {
      id: over.id,
      type: "ticket",
      title: `Ticket ${over.id}`,
      stage: "Open",
      createDate: over.createDate,
      lastModified: over.lastModified ?? over.createDate,
      lastContactDate: null,
      location: "Westminster",
    } as EnrichedTicketItem;
  }

  it("counts open tickets and stuck >7d", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const tickets = [
      makeTicket({ id: "T1", createDate: tenDaysAgo }),
      makeTicket({ id: "T2", createDate: oneDayAgo }),
    ];
    const { section } = computeServiceHealth([], tickets, [], weekStart);
    expect(section.openTickets).toBe(2);
    expect(section.stuckTicketsOver7d).toBe(1);
    expect(section.avgTicketAgeDays).toBeGreaterThan(4);
  });

  it("computes ticketsCreatedThisWeek, ticketsClosedThisWeek, netTicketChange, avgResolutionHours", () => {
    const inWeek = new Date(weekStart.getTime() + 86_400_000).toISOString();
    const beforeWeek = new Date(weekStart.getTime() - 10 * 86_400_000).toISOString();
    const openTickets = [
      makeTicket({ id: "O1", createDate: inWeek }),
      makeTicket({ id: "O2", createDate: beforeWeek }),
    ];
    const closedTickets = [
      {
        id: "C1",
        subject: "z",
        createDate: beforeWeek,
        closedDate: inWeek,
        stageName: "Closed",
        _derivedLocation: "Westminster",
        resolutionHours: 240,
      },
    ];
    const { section } = computeServiceHealth([], openTickets, closedTickets, weekStart);
    expect(section.ticketsCreatedThisWeek).toBe(1); // O1 was created in-week
    expect(section.ticketsClosedThisWeek).toBe(1);
    expect(section.netTicketChange).toBe(0);
    expect(section.avgResolutionHours).toBe(240);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest src/__tests__/lib/shop-health-service.test.ts --no-coverage`
Expected: module-not-found.

- [ ] **Step 3: Implement `computeServiceHealth`**

Create `src/lib/shop-health-service.ts`:

```typescript
/**
 * Service section computation for the Weekly Shop Health dashboard.
 *
 * Pure function over deals + tickets + goals passed in by the orchestrator.
 * No DB or HubSpot API calls.
 */

import type { Project } from "@/lib/hubspot";
import type { EnrichedTicketItem, ClosedTicketItem } from "@/lib/hubspot-tickets";
import type { ServiceSection, DrilldownDeal, DrilldownTicket } from "@/lib/shop-health-types";

// Stage IDs (from STAGE_MAPS.service in deals-pipeline.ts)
const STAGE_SITE_VISIT = "1058924076";
const STAGE_WORK_IN_PROGRESS = "171758480";
const STAGE_INSPECTION = "1058924077";
const STAGE_INVOICING = "1058924078";
const TERMINAL_SERVICE_STAGES = new Set(["76979603", "56217769"]); // Completed, Cancelled

export interface ServiceDrilldownBundle {
  activeJobs: DrilldownDeal[];
  awaitingSiteVisit: DrilldownDeal[];
  workInProgress: DrilldownDeal[];
  awaitingInspection: DrilldownDeal[];
  openTickets: DrilldownTicket[];
  ticketsCreated: DrilldownTicket[];
  ticketsClosed: DrilldownTicket[];
  stuckTickets: DrilldownTicket[];
}

function toDealDrilldown(d: Project): DrilldownDeal {
  return {
    id: String(d.id),
    name: d.name,
    projectNumber: d.projectNumber,
    amount: d.amount,
    stage: d.stage,
    pm: "", // Service deals don't carry PM on Project type by default
    date: null,
  };
}

// EnrichedTicketItem extends PriorityItem (src/lib/service-priority.ts):
//   id, type, title, stage, createDate, lastModified, location, ...
// Map title→subject and stage→status for the DrilldownTicket display contract.
function toTicketDrilldown(t: EnrichedTicketItem): DrilldownTicket {
  const createDate = t.createDate ?? null;
  const ageDays = createDate ? Math.floor((Date.now() - new Date(createDate).getTime()) / 86_400_000) : null;
  return {
    id: t.id,
    subject: t.title ?? "",
    status: t.stage ?? "",
    priority: null,  // PriorityItem doesn't carry HubSpot priority; tier comes from priority-score, not ticket
    createDate,
    lastModified: t.lastModified ?? null,
    ageDays,
    dealName: null,
  };
}

export function computeServiceHealth(
  serviceDeals: Project[],
  openTickets: EnrichedTicketItem[],
  closedTickets: ClosedTicketItem[],
  weekStart: Date
): { section: ServiceSection; drilldown: ServiceDrilldownBundle } {
  const weekStartMs = weekStart.getTime();

  // Active deals = service-pipeline deals not in a terminal stage
  const activeDeals = serviceDeals.filter((d) => !TERMINAL_SERVICE_STAGES.has(d.stageId));
  const siteVisitDeals = activeDeals.filter((d) => d.stageId === STAGE_SITE_VISIT);
  const wipDeals = activeDeals.filter((d) => d.stageId === STAGE_WORK_IN_PROGRESS);
  const inspectionDeals = activeDeals.filter((d) => d.stageId === STAGE_INSPECTION);

  // Tickets — EnrichedTicketItem fields: id, title, stage, createDate, lastModified
  const openCount = openTickets.length;
  const ticketsCreatedThisWeek = openTickets.filter(
    (t) => t.createDate && new Date(t.createDate).getTime() >= weekStartMs
  );
  const ticketsClosedThisWeek = closedTickets.filter(
    (t) => new Date(t.closedDate).getTime() >= weekStartMs
  );

  // Ages
  const ages: number[] = [];
  const stuckTickets: EnrichedTicketItem[] = [];
  for (const t of openTickets) {
    if (!t.createDate) continue;
    const ageDays = (Date.now() - new Date(t.createDate).getTime()) / 86_400_000;
    ages.push(ageDays);
    if (ageDays > 7) stuckTickets.push(t);
  }
  const avgTicketAgeDays = ages.length > 0
    ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10
    : null;

  // Resolution time
  const avgResolutionHours = ticketsClosedThisWeek.length > 0
    ? Math.round(
        (ticketsClosedThisWeek.reduce((a, t) => a + t.resolutionHours, 0) /
          ticketsClosedThisWeek.length) * 10
      ) / 10
    : null;

  const section: ServiceSection = {
    activeJobs: activeDeals.length,
    awaitingSiteVisit: siteVisitDeals.length,
    workInProgress: wipDeals.length,
    awaitingInspection: inspectionDeals.length,
    openTickets: openCount,
    ticketsCreatedThisWeek: ticketsCreatedThisWeek.length,
    ticketsClosedThisWeek: ticketsClosedThisWeek.length,
    netTicketChange: ticketsCreatedThisWeek.length - ticketsClosedThisWeek.length,
    avgTicketAgeDays,
    avgResolutionHours,
    stuckTicketsOver7d: stuckTickets.length,
  };

  const drilldown: ServiceDrilldownBundle = {
    activeJobs: activeDeals.map(toDealDrilldown),
    awaitingSiteVisit: siteVisitDeals.map(toDealDrilldown),
    workInProgress: wipDeals.map(toDealDrilldown),
    awaitingInspection: inspectionDeals.map(toDealDrilldown),
    openTickets: openTickets.map(toTicketDrilldown),
    ticketsCreated: ticketsCreatedThisWeek.map(toTicketDrilldown),
    ticketsClosed: ticketsClosedThisWeek.map((t): DrilldownTicket => ({
      id: t.id,
      subject: t.subject ?? "",
      status: t.stageName || "Closed",
      priority: null,
      createDate: t.createDate,
      lastModified: t.closedDate,
      ageDays: Math.floor(t.resolutionHours / 24),
      dealName: null,
    })),
    stuckTickets: stuckTickets.map(toTicketDrilldown),
  };

  return { section, drilldown };
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/__tests__/lib/shop-health-service.test.ts --no-coverage`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop-health-service.ts src/__tests__/lib/shop-health-service.test.ts
git commit -m "feat(shop-health): computeServiceHealth pure function with tests"
```

### Task 8: Build `computeDnrRoofingHealth` (TDD)

**Files:**
- Modify: `src/lib/shop-health-dnr-roofing.ts` (append after the bucketing helpers from Task 6)
- Create: `src/__tests__/lib/shop-health-dnr-roofing.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/lib/shop-health-dnr-roofing.test.ts`:

```typescript
import { computeDnrRoofingHealth } from "@/lib/shop-health-dnr-roofing";
import type { Project } from "@/lib/hubspot";

function makeDeal(over: Partial<Project>): Project {
  return {
    id: 0, name: "Test", projectNumber: "P", pbLocation: "Westminster",
    ahj: "", utility: "", address: "", city: "", state: "", postalCode: "",
    projectType: "", stage: "", stageId: "", pipelineId: "21997330", amount: 0, url: "",
    tags: [], isParticipateEnergy: false, participateEnergyStatus: null,
    isSiteSurveyScheduled: false, isSiteSurveyCompleted: false, isDASent: false,
    isDesignApproved: false, isDesignDrafted: false, isDesignCompleted: false,
    isPermitSubmitted: false, isPermitIssued: false, isInterconnectionSubmitted: false,
    isInterconnectionApproved: false,
    threeceEvStatus: null, threeceBatteryStatus: null, sgipStatus: null, pbsrStatus: null, cpaStatus: null,
    daysSinceStageMovement: 0,
    // ... full defaults
    ...over,
  } as Project;
}

describe("computeDnrRoofingHealth", () => {
  const weekStart = new Date("2026-05-25T00:00:00Z");

  it("returns zeros for empty inputs", () => {
    const { section } = computeDnrRoofingHealth([], [], weekStart);
    expect(section.dnrActive).toBe(0);
    expect(section.roofingActive).toBe(0);
    expect(section.unknownDnrStageCount).toBe(0);
  });

  it("buckets D&R deals by stage", () => {
    const dnrDeals = [
      makeDeal({ id: 1, stageId: "52474739" }), // Kickoff → preDetach
      makeDeal({ id: 2, stageId: "52474743" }), // Detach → detachInProgress
      makeDeal({ id: 3, stageId: "78412639" }), // Reset Blocked
      makeDeal({ id: 4, stageId: "68245827" }), // Complete → terminal
    ];
    const { section } = computeDnrRoofingHealth(dnrDeals, [], weekStart);
    expect(section.dnrPreDetach).toBe(1);
    expect(section.dnrDetachInProgress).toBe(1);
    expect(section.dnrResetBlocked).toBe(1);
    expect(section.dnrActive).toBe(3); // excludes terminal
  });

  it("buckets Roofing deals by stage", () => {
    const roofingDeals = [
      makeDeal({ id: 10, stageId: "1117662745", pipelineId: "765928545" }), // On Hold
      makeDeal({ id: 11, stageId: "1215078281", pipelineId: "765928545" }), // Production
      makeDeal({ id: 12, stageId: "1215078285", pipelineId: "765928545" }), // Completed
    ];
    const { section } = computeDnrRoofingHealth([], roofingDeals, weekStart);
    expect(section.roofPreProduction).toBe(1);
    expect(section.roofInProduction).toBe(1);
    expect(section.roofingActive).toBe(2);
  });

  it("counts stuck deals >14 days in current stage", () => {
    const dnrDeals = [
      makeDeal({ id: 1, stageId: "52474743", daysSinceStageMovement: 20 }),
      makeDeal({ id: 2, stageId: "52474743", daysSinceStageMovement: 5 }),
    ];
    const { section } = computeDnrRoofingHealth(dnrDeals, [], weekStart);
    expect(section.stuckDnrJobs).toBe(1);
  });

  it("tracks unknown stage IDs separately", () => {
    const dnrDeals = [makeDeal({ id: 1, stageId: "99999999" })];
    const { section } = computeDnrRoofingHealth(dnrDeals, [], weekStart);
    expect(section.unknownDnrStageCount).toBe(1);
    expect(section.dnrActive).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest src/__tests__/lib/shop-health-dnr-roofing.test.ts --no-coverage`
Expected: `computeDnrRoofingHealth is not exported`.

- [ ] **Step 3: Implement computeDnrRoofingHealth**

Append to `src/lib/shop-health-dnr-roofing.ts`:

```typescript
import type { Project } from "@/lib/hubspot";
import type { DnrRoofingSection, DrilldownDeal } from "@/lib/shop-health-types";

const STUCK_DAYS_THRESHOLD = 14;

// Terminal D&R stage IDs
const DNR_TERMINAL_IDS = new Set(["68245827", "52474745", "72700977"]);
// Terminal Roofing stage IDs
const ROOF_TERMINAL_IDS = new Set(["1215078285"]);

export interface DnrRoofingDrilldownBundle {
  dnrActive: DrilldownDeal[];
  dnrCompleted: DrilldownDeal[];
  dnrPreDetach: DrilldownDeal[];
  dnrDetachInProgress: DrilldownDeal[];
  dnrRoofingPhase: DrilldownDeal[];
  dnrResetBlocked: DrilldownDeal[];
  dnrResetPhase: DrilldownDeal[];
  dnrCloseout: DrilldownDeal[];
  dnrStuck: DrilldownDeal[];
  roofingActive: DrilldownDeal[];
  roofingCompleted: DrilldownDeal[];
  roofingPreProduction: DrilldownDeal[];
  roofingInProduction: DrilldownDeal[];
  roofingPostProduction: DrilldownDeal[];
  roofingStuck: DrilldownDeal[];
}

function toDealDrilldown(d: Project): DrilldownDeal {
  return {
    id: String(d.id),
    name: d.name,
    projectNumber: d.projectNumber,
    amount: d.amount,
    stage: d.stage,
    pm: "",
    date: null,
  };
}

export function computeDnrRoofingHealth(
  dnrDeals: Project[],
  roofingDeals: Project[],
  weekStart: Date
): { section: DnrRoofingSection; drilldown: DnrRoofingDrilldownBundle } {
  const weekStartMs = weekStart.getTime();

  // ── D&R ──
  const dnrByBucket = {
    preDetach: [] as Project[],
    detachInProgress: [] as Project[],
    roofingPhase: [] as Project[],
    resetBlocked: [] as Project[],
    resetPhase: [] as Project[],
    closeout: [] as Project[],
  };
  const dnrCompleted: Project[] = [];
  const dnrStuck: Project[] = [];
  let unknownDnrStageCount = 0;

  for (const d of dnrDeals) {
    const bucket = bucketDnrStages(d.stageId);
    if (bucket === "terminal") {
      // Track completed-this-week (Complete only, not Cancelled or On-hold)
      if (d.stageId === "68245827") {
        // Use closeDate or lastModified — Project type's closeDate field
        const closeMs = d.closeDate ? new Date(d.closeDate).getTime() : 0;
        if (closeMs >= weekStartMs) dnrCompleted.push(d);
      }
      continue;
    }
    if (bucket === "unknown") {
      unknownDnrStageCount++;
      console.warn(`[shop-health] Unknown D&R stage ID: ${d.stageId} (deal ${d.id})`);
      continue;
    }
    dnrByBucket[bucket].push(d);
    if ((d.daysSinceStageMovement ?? 0) > STUCK_DAYS_THRESHOLD) {
      dnrStuck.push(d);
    }
  }

  const dnrActive =
    dnrByBucket.preDetach.length +
    dnrByBucket.detachInProgress.length +
    dnrByBucket.roofingPhase.length +
    dnrByBucket.resetBlocked.length +
    dnrByBucket.resetPhase.length +
    dnrByBucket.closeout.length;
  const dnrActiveDeals = [
    ...dnrByBucket.preDetach,
    ...dnrByBucket.detachInProgress,
    ...dnrByBucket.roofingPhase,
    ...dnrByBucket.resetBlocked,
    ...dnrByBucket.resetPhase,
    ...dnrByBucket.closeout,
  ];

  // ── Roofing ──
  const roofingByBucket = {
    preProduction: [] as Project[],
    inProduction: [] as Project[],
    postProduction: [] as Project[],
  };
  const roofingCompleted: Project[] = [];
  const roofingStuck: Project[] = [];
  let unknownRoofingStageCount = 0;

  for (const r of roofingDeals) {
    const bucket = bucketRoofingStages(r.stageId);
    if (bucket === "terminal") {
      const closeMs = r.closeDate ? new Date(r.closeDate).getTime() : 0;
      if (closeMs >= weekStartMs) roofingCompleted.push(r);
      continue;
    }
    if (bucket === "unknown") {
      unknownRoofingStageCount++;
      console.warn(`[shop-health] Unknown Roofing stage ID: ${r.stageId} (deal ${r.id})`);
      continue;
    }
    roofingByBucket[bucket].push(r);
    if ((r.daysSinceStageMovement ?? 0) > STUCK_DAYS_THRESHOLD) {
      roofingStuck.push(r);
    }
  }

  const roofingActive =
    roofingByBucket.preProduction.length +
    roofingByBucket.inProduction.length +
    roofingByBucket.postProduction.length;
  const roofingActiveDeals = [
    ...roofingByBucket.preProduction,
    ...roofingByBucket.inProduction,
    ...roofingByBucket.postProduction,
  ];

  const section: DnrRoofingSection = {
    dnrActive,
    dnrCompletedThisWeek: dnrCompleted.length,
    roofingActive,
    roofingCompletedThisWeek: roofingCompleted.length,
    dnrPreDetach: dnrByBucket.preDetach.length,
    dnrDetachInProgress: dnrByBucket.detachInProgress.length,
    dnrRoofingPhase: dnrByBucket.roofingPhase.length,
    dnrResetBlocked: dnrByBucket.resetBlocked.length,
    dnrResetPhase: dnrByBucket.resetPhase.length,
    dnrCloseout: dnrByBucket.closeout.length,
    roofPreProduction: roofingByBucket.preProduction.length,
    roofInProduction: roofingByBucket.inProduction.length,
    roofPostProduction: roofingByBucket.postProduction.length,
    stuckDnrJobs: dnrStuck.length,
    stuckRoofingJobs: roofingStuck.length,
    unknownDnrStageCount,
    unknownRoofingStageCount,
  };

  const drilldown: DnrRoofingDrilldownBundle = {
    dnrActive: dnrActiveDeals.map(toDealDrilldown),
    dnrCompleted: dnrCompleted.map(toDealDrilldown),
    dnrPreDetach: dnrByBucket.preDetach.map(toDealDrilldown),
    dnrDetachInProgress: dnrByBucket.detachInProgress.map(toDealDrilldown),
    dnrRoofingPhase: dnrByBucket.roofingPhase.map(toDealDrilldown),
    dnrResetBlocked: dnrByBucket.resetBlocked.map(toDealDrilldown),
    dnrResetPhase: dnrByBucket.resetPhase.map(toDealDrilldown),
    dnrCloseout: dnrByBucket.closeout.map(toDealDrilldown),
    dnrStuck: dnrStuck.map(toDealDrilldown),
    roofingActive: roofingActiveDeals.map(toDealDrilldown),
    roofingCompleted: roofingCompleted.map(toDealDrilldown),
    roofingPreProduction: roofingByBucket.preProduction.map(toDealDrilldown),
    roofingInProduction: roofingByBucket.inProduction.map(toDealDrilldown),
    roofingPostProduction: roofingByBucket.postProduction.map(toDealDrilldown),
    roofingStuck: roofingStuck.map(toDealDrilldown),
  };

  return { section, drilldown };
}
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/__tests__/lib/shop-health-dnr-roofing.test.ts --no-coverage`
Expected: all 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shop-health-dnr-roofing.ts src/__tests__/lib/shop-health-dnr-roofing.test.ts
git commit -m "feat(shop-health): computeDnrRoofingHealth pure function with tests"
```

---

## Chunk 5: Orchestrator Integration

Wire the new compute functions into the existing `shop-health.ts` orchestrator.

### Task 9: Integrate into shop-health.ts orchestrator

**Files:**
- Modify: `src/lib/shop-health.ts`

- [ ] **Step 1: Update the data fetch**

Find the main `getShopHealthData` function in `src/lib/shop-health.ts`. Locate the existing call to `fetchAllProjects()` (or the cache wrapper around it).

**Important: `appCache.getOrFetch` signature** (verified at `cache.ts:87`):

```typescript
appCache.getOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  forceRefresh = false,
  opts?: { ttl?: number; staleTtl?: number }
): Promise<{ data: T; cached: boolean; stale: boolean; lastUpdated: string }>
```

Returns a wrapper object — must destructure `.data`. Add the new fetch in parallel with the existing fetches:

```typescript
const { PIPELINE_IDS } = await import("./deals-pipeline");
const [allDealsResult, openTickets, closedTickets] = await Promise.all([
  appCache.getOrFetch(
    CACHE_KEYS.DEALS_ALL_PIPELINES_ACTIVE,
    () =>
      fetchDealsByPipelines(
        [PIPELINE_IDS.project, PIPELINE_IDS.service, PIPELINE_IDS.dnr, PIPELINE_IDS.roofing],
        true
      ),
    false,
    { ttl: 10 * 60 * 1000 }
  ),
  fetchServiceTickets(),
  fetchClosedTicketsSince(weekStart.toISOString()),
]);
const allDeals = allDealsResult.data;

// Partition by pipelineId
const projectDeals = allDeals.filter((d) => d.pipelineId === PIPELINE_IDS.project);
const serviceDeals = allDeals.filter((d) => d.pipelineId === PIPELINE_IDS.service);
const dnrDeals = allDeals.filter((d) => d.pipelineId === PIPELINE_IDS.dnr);
const roofingDeals = allDeals.filter((d) => d.pipelineId === PIPELINE_IDS.roofing);
```

Replace any `allProjects` variable downstream with `projectDeals` so the existing flow keeps working unchanged.

**Alternative**: if the existing code uses `fetchAllProjects` via the appCache wrapper and the project flow expects a plain array, you can keep the existing fetch in place and ADD the new `fetchDealsByPipelines` fetch only for the new sections (avoid touching project flow). Up to the implementer based on what's easier to reason about.

- [ ] **Step 2: Filter tickets by location**

**Important: `resolveDashboardGroup().canonicals` is a `CanonicalLocation[]` array, NOT a Set.** The existing orchestrator at `shop-health.ts:246` wraps it: `const canonicalSet = new Set<string>(group.canonicals);`. Reuse the same `canonicalSet` variable that already exists in the function — do NOT redefine.

```typescript
// canonicalSet already exists in scope from the existing project flow
const locationFilteredOpenTickets =
  locationSlug === "all"
    ? openTickets
    : openTickets.filter((t) => t._derivedLocation && canonicalSet.has(t._derivedLocation));
const locationFilteredClosedTickets =
  locationSlug === "all"
    ? closedTickets
    : closedTickets.filter((t) => t._derivedLocation && canonicalSet.has(t._derivedLocation));
```

- [ ] **Step 3: Filter D&R/Roofing/Service deals by location**

```typescript
const locationFilteredDnr =
  locationSlug === "all"
    ? dnrDeals
    : dnrDeals.filter((d) => canonicalSet.has(d.pbLocation));
const locationFilteredRoofing =
  locationSlug === "all"
    ? roofingDeals
    : roofingDeals.filter((d) => canonicalSet.has(d.pbLocation));
const locationFilteredService =
  locationSlug === "all"
    ? serviceDeals
    : serviceDeals.filter((d) => canonicalSet.has(d.pbLocation));
```

- [ ] **Step 4: Call new compute functions**

After all existing sections are computed:

```typescript
const { computeServiceHealth } = await import("./shop-health-service");
const { computeDnrRoofingHealth } = await import("./shop-health-dnr-roofing");

const serviceResult = computeServiceHealth(
  locationFilteredService,
  locationFilteredOpenTickets,
  locationFilteredClosedTickets,
  weekStart
);
const dnrRoofingResult = computeDnrRoofingHealth(
  locationFilteredDnr,
  locationFilteredRoofing,
  weekStart
);
```

- [ ] **Step 5: Merge into return payload**

Add to the `ShopHealthData` return object:

```typescript
return {
  // ... existing fields
  service: serviceResult.section,
  dnrRoofing: dnrRoofingResult.section,
  // ... existing drilldown merge gets new fields:
  drilldown: {
    ...existingDrilldown,
    serviceActiveJobs: serviceResult.drilldown.activeJobs,
    serviceAwaitingSiteVisit: serviceResult.drilldown.awaitingSiteVisit,
    serviceWorkInProgress: serviceResult.drilldown.workInProgress,
    serviceAwaitingInspection: serviceResult.drilldown.awaitingInspection,
    serviceOpenTickets: serviceResult.drilldown.openTickets,
    serviceTicketsCreated: serviceResult.drilldown.ticketsCreated,
    serviceTicketsClosed: serviceResult.drilldown.ticketsClosed,
    serviceStuckTickets: serviceResult.drilldown.stuckTickets,
    dnrActive: dnrRoofingResult.drilldown.dnrActive,
    dnrCompleted: dnrRoofingResult.drilldown.dnrCompleted,
    dnrPreDetach: dnrRoofingResult.drilldown.dnrPreDetach,
    dnrDetachInProgress: dnrRoofingResult.drilldown.dnrDetachInProgress,
    dnrRoofingPhase: dnrRoofingResult.drilldown.dnrRoofingPhase,
    dnrResetBlocked: dnrRoofingResult.drilldown.dnrResetBlocked,
    dnrResetPhase: dnrRoofingResult.drilldown.dnrResetPhase,
    dnrCloseout: dnrRoofingResult.drilldown.dnrCloseout,
    dnrStuck: dnrRoofingResult.drilldown.dnrStuck,
    roofingActive: dnrRoofingResult.drilldown.roofingActive,
    roofingCompleted: dnrRoofingResult.drilldown.roofingCompleted,
    roofingPreProduction: dnrRoofingResult.drilldown.roofingPreProduction,
    roofingInProduction: dnrRoofingResult.drilldown.roofingInProduction,
    roofingPostProduction: dnrRoofingResult.drilldown.roofingPostProduction,
    roofingStuck: dnrRoofingResult.drilldown.roofingStuck,
  },
};
```

- [ ] **Step 6: Add hero metrics**

Locate where the existing `heroes` object is built (search for `heroes: {`). Add:

```typescript
openTickets: buildHeroMetric(
  serviceResult.section.openTickets,
  priorServiceSection?.openTickets ?? serviceResult.section.openTickets,
  serviceResult.section.openTickets <= 3 ? "green" : serviceResult.section.openTickets <= 10 ? "yellow" : "red",
  10
),
dnrRoofingActive: buildHeroMetric(
  dnrRoofingResult.section.dnrActive + dnrRoofingResult.section.roofingActive,
  (priorDnrRoofingSection?.dnrActive ?? 0) + (priorDnrRoofingSection?.roofingActive ?? 0),
  "green",
  null
),
```

For prior-week comparison: the existing flow already computes prior-week data via a parallel `getShopHealthData(locationSlug, priorWeekStart)` recursive call or equivalent. If that's the case, also compute `priorServiceSection` and `priorDnrRoofingSection` the same way. If no prior-week pattern exists, pass current value as prior (delta = 0) and add a TODO.

- [ ] **Step 7: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep "shop-health.ts" | head -20`
Expected: no errors.

- [ ] **Step 8: Run existing shop-health tests, ensure nothing broke**

Run: `npx jest src/__tests__/ --testPathPattern="shop-health" --no-coverage`
Expected: all tests pass (including the new ones).

- [ ] **Step 9: Commit**

```bash
git add src/lib/shop-health.ts
git commit -m "feat(shop-health): orchestrator partitions deals + computes new sections"
```

---

## Chunk 6: UI — DrilldownMetricCard Tickets Support + New Sections

### Task 10: Add tickets prop to DrilldownMetricCard

**Files:**
- Modify: `src/components/ui/DrilldownMetricCard.tsx`
- Possibly: a small test file `src/__tests__/components/DrilldownMetricCard.test.tsx`

- [ ] **Step 1: Read current component**

Read `src/components/ui/DrilldownMetricCard.tsx` to understand the existing modal/table structure.

- [ ] **Step 2: Add tickets prop**

Add `tickets?: DrilldownTicket[]` to the component props next to `deals?`. Update the prop interface and the modal's table-rendering block so that:

- If `tickets` is provided (and non-empty), render a ticket table with columns: Subject, Status, Priority, Age, Deal (if dealName).
- If `deals` is provided (and non-empty), render the existing deal table.
- Empty state unchanged.
- Card chrome unchanged.

Use a small inline helper to keep the render functions side-by-side rather than splitting into separate components.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit 2>&1 | grep "DrilldownMetricCard"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/DrilldownMetricCard.tsx
git commit -m "feat(shop-health): DrilldownMetricCard supports tickets alongside deals"
```

### Task 11: Build ServiceSection component

**Files:**
- Create: `src/app/dashboards/shop-health/ServiceSection.tsx`

- [ ] **Step 1: Read an existing section for reference**

Read `src/app/dashboards/shop-health/CustomerSuccessSection.tsx` as a template — it has the closest pattern (grid rows with subs and color-coded metrics).

- [ ] **Step 2: Create ServiceSection.tsx**

```tsx
'use client';

import { DrilldownMetricCard } from '@/components/ui/DrilldownMetricCard';
import type { ServiceSection as ServiceSectionData, ShopHealthDrilldown } from '@/lib/shop-health-types';

export function ServiceSectionContent({
  data,
  drilldown,
}: {
  data: ServiceSectionData;
  drilldown: ShopHealthDrilldown;
}) {
  const netChangeColor =
    data.netTicketChange > 0 ? 'text-red-400' :
    data.netTicketChange < 0 ? 'text-emerald-400' : 'text-muted';
  const openTicketsColor =
    data.openTickets <= 3 ? 'text-emerald-400' :
    data.openTickets <= 10 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-6">
      {/* Row 1: Service Job Pipeline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DrilldownMetricCard
          label="Active Service Jobs" value={data.activeJobs}
          sub="non-terminal deals" deals={drilldown.serviceActiveJobs} dateLabel="" />
        <DrilldownMetricCard
          label="Awaiting Site Visit" value={data.awaitingSiteVisit}
          sub="Site Visit Scheduling" deals={drilldown.serviceAwaitingSiteVisit} dateLabel="" />
        <DrilldownMetricCard
          label="Work In Progress" value={data.workInProgress}
          sub="active service work" deals={drilldown.serviceWorkInProgress} dateLabel="" />
        <DrilldownMetricCard
          label="Awaiting Inspection" value={data.awaitingInspection}
          sub="ready for inspection" deals={drilldown.serviceAwaitingInspection} dateLabel="" />
      </div>

      {/* Row 2: Ticket Activity */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DrilldownMetricCard
          label="Open Tickets" value={data.openTickets} valueColor={openTicketsColor}
          sub="currently unresolved" tickets={drilldown.serviceOpenTickets} dateLabel="" />
        <DrilldownMetricCard
          label="Tickets Created This Wk" value={data.ticketsCreatedThisWeek}
          sub="fresh tickets" tickets={drilldown.serviceTicketsCreated} dateLabel="" />
        <DrilldownMetricCard
          label="Tickets Closed This Wk" value={data.ticketsClosedThisWeek}
          sub="resolved this week" tickets={drilldown.serviceTicketsClosed} dateLabel="" />
        <DrilldownMetricCard
          label="Net Change" value={data.netTicketChange > 0 ? `+${data.netTicketChange}` : data.netTicketChange}
          valueColor={netChangeColor} sub="created − closed" />
      </div>

      {/* Row 3: Ticket Response Health */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <DrilldownMetricCard
          label="Avg Ticket Age" value={data.avgTicketAgeDays !== null ? `${data.avgTicketAgeDays}d` : '—'}
          sub="days since createdate · open tickets" />
        <DrilldownMetricCard
          label="Avg Resolution Time" value={data.avgResolutionHours !== null ? `${data.avgResolutionHours}h` : '—'}
          sub="hours to close · tickets closed this wk" />
        <DrilldownMetricCard
          label="Stuck >7d" value={data.stuckTicketsOver7d}
          valueColor={data.stuckTicketsOver7d === 0 ? 'text-emerald-400' : 'text-red-400'}
          sub="open tickets older than 7 days"
          tickets={drilldown.serviceStuckTickets} dateLabel="" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/shop-health/ServiceSection.tsx
git commit -m "feat(shop-health): ServiceSection component (3 rows, 11 metrics)"
```

### Task 12: Build DnrRoofingSection component

**Files:**
- Create: `src/app/dashboards/shop-health/DnrRoofingSection.tsx`

- [ ] **Step 1: Create file**

Mirror the ServiceSection pattern but with 4 rows + sub-headers. Each card sources value from `data.*` and drilldown deals from `drilldown.*`. The `Reset Blocked` card is `text-red-400` when > 0. Aging cards are `text-amber-400` when > 0. Each stage card has a `sub` that names the underlying HubSpot stages.

```tsx
'use client';

import { DrilldownMetricCard } from '@/components/ui/DrilldownMetricCard';
import type { DnrRoofingSection as DnrRoofingData, ShopHealthDrilldown } from '@/lib/shop-health-types';

export function DnrRoofingSectionContent({
  data,
  drilldown,
}: {
  data: DnrRoofingData;
  drilldown: ShopHealthDrilldown;
}) {
  return (
    <div className="space-y-6">
      {/* Row 1: Throughput summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DrilldownMetricCard label="D&R Active" value={data.dnrActive}
          sub="active jobs across all D&R stages" deals={drilldown.dnrActive} dateLabel="" />
        <DrilldownMetricCard label="D&R Completed This Wk" value={data.dnrCompletedThisWeek}
          sub="moved to Complete this week" deals={drilldown.dnrCompleted} dateLabel="Close" />
        <DrilldownMetricCard label="Roof Active" value={data.roofingActive}
          sub="active roofing jobs" deals={drilldown.roofingActive} dateLabel="" />
        <DrilldownMetricCard label="Roof Completed This Wk" value={data.roofingCompletedThisWeek}
          sub="moved to Job Completed this week" deals={drilldown.roofingCompleted} dateLabel="Close" />
      </div>

      {/* Row 2: D&R Stage Breakdown */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">
          D&amp;R workflow <span className="font-normal opacity-70">· active jobs by stage</span>
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <DrilldownMetricCard label="Pre-Detach" value={data.dnrPreDetach}
            sub="Kickoff / Survey / Design / Permit / Ready" deals={drilldown.dnrPreDetach} dateLabel="" />
          <DrilldownMetricCard label="Detach In Progress" value={data.dnrDetachInProgress}
            sub="active detach" deals={drilldown.dnrDetachInProgress} dateLabel="" />
          <DrilldownMetricCard label="Roofing Phase" value={data.dnrRoofingPhase}
            sub="detach complete, roofing in progress" deals={drilldown.dnrRoofingPhase} dateLabel="" />
          <DrilldownMetricCard label="Reset Blocked" value={data.dnrResetBlocked}
            valueColor={data.dnrResetBlocked > 0 ? 'text-red-400' : 'text-emerald-400'}
            sub="waiting on payment" deals={drilldown.dnrResetBlocked} dateLabel="" />
          <DrilldownMetricCard label="Reset Phase" value={data.dnrResetPhase}
            sub="Ready for Reset + Reset" deals={drilldown.dnrResetPhase} dateLabel="" />
          <DrilldownMetricCard label="Closeout" value={data.dnrCloseout}
            sub="Inspection + Closeout" deals={drilldown.dnrCloseout} dateLabel="" />
        </div>
      </div>

      {/* Row 3: Roofing Stage Breakdown */}
      <div>
        <h4 className="text-sm font-medium text-muted mb-3">
          Roofing workflow <span className="font-normal opacity-70">· active jobs by stage</span>
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <DrilldownMetricCard label="Pre-Production" value={data.roofPreProduction}
            sub="On Hold / Color / Material / Confirm / Staged" deals={drilldown.roofingPreProduction} dateLabel="" />
          <DrilldownMetricCard label="In Production" value={data.roofInProduction}
            sub="active install" deals={drilldown.roofingInProduction} dateLabel="" />
          <DrilldownMetricCard label="Post-Production" value={data.roofPostProduction}
            sub="Post / Invoice / Closeout Paperwork" deals={drilldown.roofingPostProduction} dateLabel="" />
        </div>
      </div>

      {/* Row 4: Aging */}
      <div className="grid grid-cols-2 gap-4">
        <DrilldownMetricCard label="Stuck D&R Jobs" value={data.stuckDnrJobs}
          valueColor={data.stuckDnrJobs === 0 ? 'text-emerald-400' : 'text-amber-400'}
          sub=">14 days in current stage" deals={drilldown.dnrStuck} dateLabel="" />
        <DrilldownMetricCard label="Stuck Roofing Jobs" value={data.stuckRoofingJobs}
          valueColor={data.stuckRoofingJobs === 0 ? 'text-emerald-400' : 'text-amber-400'}
          sub=">14 days in current stage" deals={drilldown.roofingStuck} dateLabel="" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/shop-health/DnrRoofingSection.tsx
git commit -m "feat(shop-health): DnrRoofingSection component (4 rows, ~15 metrics)"
```

### Task 13: Wire sections into page.tsx, update HeroMetrics, AllLocationsView, overview route

**Files:**
- Modify: `src/app/dashboards/shop-health/page.tsx`
- Modify: `src/app/dashboards/shop-health/HeroMetrics.tsx`
- Modify: `src/app/dashboards/shop-health/AllLocationsView.tsx`
- Modify: `src/app/api/shop-health/overview/route.ts`

- [ ] **Step 1: Add new sections to page.tsx**

**`SectionCard` actual props** (verified at `src/app/dashboards/shop-health/SectionCard.tsx:26`): `title, health, children, defaultOpen=true, icon`. There is NO `accent` prop. Match the existing pattern:

```tsx
<SectionCard title="Service" icon="🛠️" health={data.sectionHealth.service}>
  <ServiceSectionContent data={data.service} drilldown={data.drilldown} />
</SectionCard>

<SectionCard title="D&R + Roofing" icon="🏠" health={data.sectionHealth.dnrRoofing}>
  <DnrRoofingSectionContent data={data.dnrRoofing} drilldown={data.drilldown} />
</SectionCard>
```

Insert these after the Customer Success `<SectionCard>` block (page.tsx:176) and before the Bottlenecks `<SectionCard>` (page.tsx:181).

Add imports at top:

```tsx
import { ServiceSectionContent } from './ServiceSection';
import { DnrRoofingSectionContent } from './DnrRoofingSection';
```

The `data.sectionHealth.service` and `data.sectionHealth.dnrRoofing` fields require populating in the orchestrator. In Task 9 Step 5 (merge into return payload), also add:

```typescript
sectionHealth: {
  ...existingSectionHealth,
  service: serviceResult.section.openTickets > 10 ? "red" : serviceResult.section.openTickets > 3 ? "yellow" : "green",
  dnrRoofing: (dnrRoofingResult.section.dnrResetBlocked > 0 || dnrRoofingResult.section.stuckDnrJobs > 5)
    ? "yellow"
    : "green",
},
```

- [ ] **Step 2: Update HeroMetrics.tsx**

In `src/app/dashboards/shop-health/HeroMetrics.tsx`:
- Change `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` → `grid-cols-2 md:grid-cols-4 xl:grid-cols-8`
- Add 2 new hero cards at the end of the grid, sourcing from `heroes.openTickets` and `heroes.dnrRoofingActive`
- Use the same `HeroCard` component the rest use

- [ ] **Step 3: Update overview route**

In `src/app/api/shop-health/overview/route.ts:17-27`, add to the returned row:

```typescript
openTickets: data.heroes.openTickets,
dnrActive: toHeroMetric(data.dnrRoofing.dnrActive),
roofActive: toHeroMetric(data.dnrRoofing.roofingActive),
```

Define `toHeroMetric` at the top of the file:

```typescript
function toHeroMetric(value: number): import("@/lib/shop-health-types").HeroMetric {
  return { value, priorWeek: value, delta: 0, health: "green", target: null };
}
```

(Match the actual HeroMetric shape from `shop-health-types.ts`. If `target` doesn't exist on the type, omit it.)

- [ ] **Step 4: Update AllLocationsView.tsx**

Add 3 columns to the table after the existing Customer Success columns:

```tsx
<th>Open Tickets</th>
<th>D&R Active</th>
<th>Roof Active</th>
```

And in the row map:

```tsx
<td>{row.openTickets.value}</td>
<td>{row.dnrActive.value}</td>
<td>{row.roofActive.value}</td>
```

Match the existing color-coding pattern (e.g. red if > 10 for openTickets).

- [ ] **Step 5: Run TypeScript + Jest**

```bash
npx tsc --noEmit 2>&1 | grep -E "shop-health|ServiceSection|DnrRoofingSection|HeroMetrics|AllLocations|overview" | head -20
npx jest --testPathPattern="shop-health" --no-coverage
```

Expected: no TS errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/shop-health/ src/app/api/shop-health/overview/route.ts
git commit -m "feat(shop-health): wire ServiceSection + DnrRoofingSection into page, heroes, overview"
```

---

## Chunk 7: SSE Cache Invalidation + Verification

### Task 14: Hook D&R/Roofing/ticket invalidation into shop-health cache cascade

**Files:**
- Modify: `src/lib/cache.ts` (cascade subscriptions at the bottom of the file, around line 327-339)

**Pattern**: `cache.ts` uses `appCache.subscribe((key) => { ... appCache.invalidateByPrefix(...) })` blocks at the end of the file. Existing examples are at lines 327-339 (revenue-goals cascade, funnel cascade). The shop-health response is cached server-side via the route handler — verify by greping for `appCache.getOrFetch.*shop-health` first.

- [ ] **Step 1: Verify shop-health cache key prefix**

Run: `grep -n "shop-health" src/lib/cache.ts src/lib/shop-health.ts src/app/api/shop-health/ -r | head -10`

Identify the cache key prefix used to wrap the `ShopHealthData` payload (e.g. `shop-health:` or wherever the SWR/appCache wrapping happens).

- [ ] **Step 2: Add cascade subscription**

Append to `src/lib/cache.ts` after the existing cascades (after line 339):

```typescript
// Shop Health cache cascade: invalidate when deals or tickets change
appCache.subscribe((key) => {
  if (
    key.startsWith("deals:") ||
    key.startsWith("projects:") ||
    key.startsWith("service-tickets") ||
    key === CACHE_KEYS.DEALS_ALL_PIPELINES_ACTIVE
  ) {
    appCache.invalidateByPrefix("shop-health:");
  }
});
```

If the shop-health cache key uses a different prefix (e.g. just `shop-health`), adjust accordingly.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "cache.ts"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cache.ts
git commit -m "feat(shop-health): cascade-invalidate shop-health cache on deal/ticket changes"
```

### Task 15: Full local verification

- [ ] **Step 1: Build**

Run: `npm run build 2>&1 | tail -30`
Expected: Next.js build succeeds. Address any errors specific to new files (pre-existing errors in unrelated routes can be ignored).

- [ ] **Step 2: Run lint**

Run: `npm run lint 2>&1 | tail -20`
Expected: no new lint warnings on files I created/modified.

- [ ] **Step 3: Run full Jest**

Run: `npx jest --no-coverage 2>&1 | tail -20`
Expected: all tests pass.

- [ ] **Step 4: Spin up dev server, click through every section**

```bash
npm run dev
```

Open http://localhost:3000/dashboards/shop-health and verify per Success Criteria in the spec.

- [ ] **Step 5: Final commit, push**

```bash
git push -u origin feat/shop-health-service-dnr-roofing
gh pr create --base main --title "Shop Health: Service + D&R/Roofing sections" --body "..."
```
