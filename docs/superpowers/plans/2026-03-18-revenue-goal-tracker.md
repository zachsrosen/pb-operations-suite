# Revenue Goal Tracker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a revenue goal tracker on the executive suite landing page that shows per-shop progress toward a $52.5M annual target, with fireworks on monthly goal hits and auto-redistribution of misses.

**Architecture:** New `RevenueGoal` Prisma model stores per-group per-month base targets. A `/api/revenue-goals` route queries HubSpot for deals with completion dates in the target year, groups by revenue group config, computes effective targets via redistribution, and returns the full payload. The executive suite landing page renders a hero section (two UI variants for A/B comparison) + monthly breakdown chart via a client component injected through a new `heroContent` prop on `SuitePageShell`.

**Tech Stack:** Next.js 16, React 19, Prisma 7.3, HubSpot CRM API, Tailwind v4, React Query v5, SSE

**Spec:** `docs/superpowers/specs/2026-03-18-revenue-goal-tracker-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/lib/revenue-groups-config.ts` | Group config constants, types, and pure computation functions (client-safe, no server imports) |
| `src/lib/revenue-goals.ts` | HubSpot queries, aggregation, response builder (server-only, imports hubspot.ts) |
| `src/app/api/revenue-goals/route.ts` | GET handler — actuals + targets + computed fields |
| `src/app/api/revenue-goals/config/route.ts` | GET + PUT handlers for admin target editing |
| `src/components/RevenueGoalTracker.tsx` | Client component: hero section (rings + bars variants), monthly chart, fireworks |
| `src/components/RevenueGoalRings.tsx` | Variant A: circular SVG progress rings |
| `src/components/RevenueGoalBars.tsx` | Variant B: horizontal thermometer bars with pace marker |
| `src/components/RevenueGoalMonthlyChart.tsx` | Monthly breakdown bar chart with hit/miss indicators |
| `src/components/RevenueGoalFireworks.tsx` | Canvas confetti animation component |
| `src/app/dashboards/revenue-goals/page.tsx` | Admin config page for editing targets |
| `src/__tests__/lib/revenue-goals.test.ts` | Tests for aggregation, effective targets, pace, edge cases |

### Modified Files
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `RevenueGoal` model + `REVENUE_GOAL_UPDATED` to `ActivityType` enum |
| `src/components/SuitePageShell.tsx` | Add optional `heroContent?: ReactNode` prop, render between switcher and cards |
| `src/app/suites/executive/page.tsx` | Pass `RevenueGoalTracker` as `heroContent` |
| `src/lib/cache.ts` | Add `REVENUE_GOALS` to `CACHE_KEYS` |
| `src/lib/query-keys.ts` | Add `revenueGoals` key + `cacheKeyToQueryKeys` mapping |
| `src/app/suites/admin/page.tsx` | Add revenue-goals config card to admin suite tools |

---

## Chunk 1: Database, Config, and Core Logic

### Task 1: Prisma Schema — RevenueGoal model and ActivityType

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add RevenueGoal model to schema**

Add after the last model in `prisma/schema.prisma`:

```prisma
model RevenueGoal {
  id        String   @id @default(cuid())
  year      Int
  groupKey  String
  month     Int
  target    Decimal

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  updatedBy String?

  @@unique([year, groupKey, month])
  @@index([year])
}
```

- [ ] **Step 2: Add REVENUE_GOAL_UPDATED to ActivityType enum**

In the `ActivityType` enum, add `REVENUE_GOAL_UPDATED` at the end of the existing entries (before the closing brace).

- [ ] **Step 3: Generate Prisma client and create migration**

Run:
```bash
npx prisma migrate dev --name add-revenue-goal
```

Expected: Migration created successfully, client regenerated.

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(revenue): add RevenueGoal model and REVENUE_GOAL_UPDATED activity type"
```

---

### Task 2: Revenue Goals Core Logic

**Files:**
- Create: `src/lib/revenue-groups-config.ts` (client-safe: group config, types, pure computations)
- Create: `src/lib/revenue-goals.ts` (server-only: HubSpot queries, aggregation, response builder)
- Create: `src/__tests__/lib/revenue-goals.test.ts`

> **Important split**: `revenue-groups-config.ts` must NOT import anything from `hubspot.ts`, `db.ts`, or other server-only modules. Client components (RevenueGoalTracker, admin page) import from this file. `revenue-goals.ts` imports from both `revenue-groups-config.ts` and `hubspot.ts` and is only used by API routes.

- [ ] **Step 1: Write tests for group config, effective target computation, and pace**

Create `src/__tests__/lib/revenue-goals.test.ts`:

```typescript
import {
  REVENUE_GROUPS,
  computeEffectiveTargets,
  computePaceStatus,
  aggregateRevenue,
  getClosedMonthCount,
} from "@/lib/revenue-groups-config";

describe("REVENUE_GROUPS", () => {
  it("defines exactly 6 groups", () => {
    expect(REVENUE_GROUPS).toHaveLength(6);
  });

  it("has unique groupKeys", () => {
    const keys = REVENUE_GROUPS.map((g) => g.groupKey);
    expect(new Set(keys).size).toBe(6);
  });

  it("annual targets sum to 52.5M", () => {
    const total = REVENUE_GROUPS.reduce((s, g) => s + g.annualTarget, 0);
    expect(total).toBe(52_500_000);
  });

  it("maps dtc to Centennial location filter", () => {
    const dtc = REVENUE_GROUPS.find((g) => g.groupKey === "dtc");
    expect(dtc?.locationFilters).toEqual(["Centennial"]);
    expect(dtc?.displayName).toBe("DTC");
  });

  it("california combines SLO and Camarillo", () => {
    const ca = REVENUE_GROUPS.find((g) => g.groupKey === "california");
    expect(ca?.locationFilters).toEqual(["San Luis Obispo", "Camarillo"]);
  });

  it("roofing_dnr has multi-strategy with D&R ready and Roofing gated", () => {
    const rd = REVENUE_GROUPS.find((g) => g.groupKey === "roofing_dnr");
    expect(rd?.recognitionStrategies).toHaveLength(3);
    const ready = rd?.recognitionStrategies.filter((s) => s.status === "ready");
    const gated = rd?.recognitionStrategies.filter((s) => s.status === "discovery-gated");
    expect(ready).toHaveLength(2);
    expect(gated).toHaveLength(1);
  });
});

describe("getClosedMonthCount", () => {
  it("returns 0 in January", () => {
    expect(getClosedMonthCount(new Date(2026, 0, 15))).toBe(0); // Jan 15
  });

  it("returns 2 in March (Jan+Feb closed)", () => {
    expect(getClosedMonthCount(new Date(2026, 2, 18))).toBe(2); // Mar 18
  });

  it("returns 11 in December", () => {
    expect(getClosedMonthCount(new Date(2026, 11, 1))).toBe(11); // Dec 1
  });
});

describe("computeEffectiveTargets", () => {
  const baseTargets = Array(12).fill(1_000_000); // $1M/month

  it("returns base targets when no shortfall", () => {
    const actuals = [1_000_000, 1_000_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const result = computeEffectiveTargets(baseTargets, actuals, 2); // 2 closed months
    // Closed months: frozen at base
    expect(result[0]).toBe(1_000_000);
    expect(result[1]).toBe(1_000_000);
    // Open months: no shortfall, so effective = base + 0
    expect(result[2]).toBe(1_000_000);
  });

  it("redistributes shortfall to remaining months", () => {
    const actuals = [800_000, 700_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const result = computeEffectiveTargets(baseTargets, actuals, 2);
    // Shortfall: (1M + 1M) - (800K + 700K) = 500K
    // Remaining months: 10
    // Each remaining: 1M + (500K / 10) = 1,050,000
    expect(result[0]).toBe(1_000_000); // closed, frozen
    expect(result[1]).toBe(1_000_000); // closed, frozen
    expect(result[2]).toBe(1_050_000); // current month
    expect(result[11]).toBe(1_050_000); // future month
  });

  it("reduces effective when ahead of pace", () => {
    const actuals = [1_500_000, 1_300_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const result = computeEffectiveTargets(baseTargets, actuals, 2);
    // Surplus: (1.5M + 1.3M) - (1M + 1M) = 800K
    // Each remaining: 1M + (-800K / 10) = 920,000
    expect(result[2]).toBe(920_000);
  });

  it("handles all months closed (December, no redistribution)", () => {
    const actuals = Array(12).fill(900_000);
    const result = computeEffectiveTargets(baseTargets, actuals, 12);
    // All frozen at base
    result.forEach((t) => expect(t).toBe(1_000_000));
  });
});

describe("computePaceStatus", () => {
  it("returns ahead when > 105% of expected", () => {
    expect(computePaceStatus(1_100_000, 1_000_000)).toBe("ahead");
  });

  it("returns on_pace within 5% band", () => {
    expect(computePaceStatus(1_000_000, 1_000_000)).toBe("on_pace");
    expect(computePaceStatus(1_040_000, 1_000_000)).toBe("on_pace");
    expect(computePaceStatus(960_000, 1_000_000)).toBe("on_pace");
  });

  it("returns behind when < 95% of expected", () => {
    expect(computePaceStatus(900_000, 1_000_000)).toBe("behind");
  });

  it("returns on_pace when expected is 0 and actual is 0", () => {
    expect(computePaceStatus(0, 0)).toBe("on_pace");
  });
});

describe("aggregateRevenue", () => {
  const deals = [
    { amount: 50_000, pipeline: "6900017", pb_location: "Westminster", construction_complete_date: "2026-03-15", dealstage: "20440343" },
    { amount: 30_000, pipeline: "6900017", pb_location: "Centennial", construction_complete_date: "2026-02-10", dealstage: "20440343" },
    { amount: 40_000, pipeline: "21997330", pb_location: "Westminster", detach_completion_date: "2026-01-20", reset_completion_date: "2026-03-05", dealstage: "68245827" },
    { amount: 25_000, pipeline: "6900017", pb_location: "Westminster", construction_complete_date: "2026-01-10", dealstage: "68229433" }, // Cancelled — excluded
  ];

  it("assigns solar deals to correct groups by location", () => {
    const result = aggregateRevenue(deals, 2026);
    expect(result.westminster[2]).toBe(50_000); // March
    expect(result.dtc[1]).toBe(30_000); // February
  });

  it("splits D&R 50/50 between detach and reset months", () => {
    const result = aggregateRevenue(deals, 2026);
    expect(result.roofing_dnr[0]).toBe(20_000); // Jan: 50% of 40K
    expect(result.roofing_dnr[2]).toBe(20_000); // Mar: 50% of 40K
  });

  it("excludes cancelled deals", () => {
    const result = aggregateRevenue(deals, 2026);
    // The $25K cancelled Westminster deal should NOT appear
    expect(result.westminster[0]).toBe(0); // Jan for westminster
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/revenue-goals.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement revenue-groups-config.ts (client-safe)**

Create `src/lib/revenue-groups-config.ts`:

```typescript
// Client-safe: NO imports from hubspot.ts, db.ts, or other server-only modules

// --- Types ---

export interface RecognitionStrategy {
  field: string;
  amountFraction: number;
  status: "ready" | "discovery-gated";
  pipelineId: string;
}

export interface RevenueGroupConfig {
  groupKey: string;
  displayName: string;
  pipelineIds: string[];
  locationFilters: string[];
  recognitionStrategies: RecognitionStrategy[];
  annualTarget: number;
  color: string;
  excludedStages: string[];
}

export type PaceStatus = "ahead" | "on_pace" | "behind";

export interface MonthResult {
  month: number;
  baseTarget: number;
  effectiveTarget: number;
  actual: number;
  closed: boolean;
  hit: boolean;
  missed: boolean;
  currentMonthOnTarget: boolean;
}

export interface RevenueGroupResult {
  groupKey: string;
  displayName: string;
  color: string;
  annualTarget: number;
  ytdActual: number;
  ytdPaceExpected: number;
  paceStatus: PaceStatus;
  discoveryGated: boolean;
  months: MonthResult[];
}

export interface RevenueGoalResponse {
  year: number;
  groups: RevenueGroupResult[];
  companyTotal: {
    annualTarget: number;
    ytdActual: number;
    ytdPaceExpected: number;
    paceStatus: PaceStatus;
  };
  lastUpdated: string;
}

// --- Group Config ---

const PIPELINE_IDS = {
  PROJECT: process.env.HUBSPOT_PIPELINE_PROJECT || "6900017",
  DNR: process.env.HUBSPOT_PIPELINE_DNR || "21997330",
  ROOFING: process.env.HUBSPOT_PIPELINE_ROOFING || "765928545",
  SERVICE: process.env.HUBSPOT_PIPELINE_SERVICE || "23928924",
};

export const REVENUE_GROUPS: RevenueGroupConfig[] = [
  {
    groupKey: "westminster",
    displayName: "Westminster",
    pipelineIds: [PIPELINE_IDS.PROJECT],
    locationFilters: ["Westminster"],
    recognitionStrategies: [
      { field: "construction_complete_date", amountFraction: 1.0, status: "ready", pipelineId: PIPELINE_IDS.PROJECT },
    ],
    annualTarget: 15_000_000,
    color: "#3B82F6",
    excludedStages: ["68229433"],
  },
  {
    groupKey: "dtc",
    displayName: "DTC",
    pipelineIds: [PIPELINE_IDS.PROJECT],
    locationFilters: ["Centennial"],
    recognitionStrategies: [
      { field: "construction_complete_date", amountFraction: 1.0, status: "ready", pipelineId: PIPELINE_IDS.PROJECT },
    ],
    annualTarget: 15_000_000,
    color: "#10B981",
    excludedStages: ["68229433"],
  },
  {
    groupKey: "colorado_springs",
    displayName: "CO Springs",
    pipelineIds: [PIPELINE_IDS.PROJECT],
    locationFilters: ["Colorado Springs"],
    recognitionStrategies: [
      { field: "construction_complete_date", amountFraction: 1.0, status: "ready", pipelineId: PIPELINE_IDS.PROJECT },
    ],
    annualTarget: 7_000_000,
    color: "#F59E0B",
    excludedStages: ["68229433"],
  },
  {
    groupKey: "california",
    displayName: "California",
    pipelineIds: [PIPELINE_IDS.PROJECT],
    locationFilters: ["San Luis Obispo", "Camarillo"],
    recognitionStrategies: [
      { field: "construction_complete_date", amountFraction: 1.0, status: "ready", pipelineId: PIPELINE_IDS.PROJECT },
    ],
    annualTarget: 7_000_000,
    color: "#8B5CF6",
    excludedStages: ["68229433"],
  },
  {
    groupKey: "roofing_dnr",
    displayName: "Roofing + D&R",
    pipelineIds: [PIPELINE_IDS.DNR, PIPELINE_IDS.ROOFING],
    locationFilters: [],
    recognitionStrategies: [
      { field: "detach_completion_date", amountFraction: 0.5, status: "ready", pipelineId: PIPELINE_IDS.DNR },
      { field: "reset_completion_date", amountFraction: 0.5, status: "ready", pipelineId: PIPELINE_IDS.DNR },
      { field: "TBD", amountFraction: 1.0, status: "discovery-gated", pipelineId: PIPELINE_IDS.ROOFING },
    ],
    annualTarget: 7_000_000,
    color: "#EC4899",
    excludedStages: ["52474745"],
  },
  {
    groupKey: "service",
    displayName: "Service",
    pipelineIds: [PIPELINE_IDS.SERVICE],
    locationFilters: [],
    recognitionStrategies: [
      { field: "TBD", amountFraction: 1.0, status: "discovery-gated", pipelineId: PIPELINE_IDS.SERVICE },
    ],
    annualTarget: 1_500_000,
    color: "#06B6D4",
    excludedStages: ["56217769"],
  },
];

// --- Pure computation functions ---

export function getClosedMonthCount(now: Date): number {
  // Current month index (0-based). Months before current are closed.
  return now.getMonth(); // Jan=0 → 0 closed, Feb=1 → 1 closed, etc.
}

export function computeEffectiveTargets(
  baseTargets: number[],
  actuals: number[],
  closedMonths: number
): number[] {
  if (closedMonths >= 12) return [...baseTargets]; // All frozen

  const closedBaseSum = baseTargets.slice(0, closedMonths).reduce((s, t) => s + t, 0);
  const closedActualSum = actuals.slice(0, closedMonths).reduce((s, a) => s + a, 0);
  const shortfall = closedBaseSum - closedActualSum;
  const remainingCount = 12 - closedMonths;
  const perMonthRedistribution = shortfall / remainingCount;

  return baseTargets.map((base, i) => {
    if (i < closedMonths) return base; // Frozen
    return base + perMonthRedistribution;
  });
}

export function computePaceStatus(actual: number, expected: number): PaceStatus {
  if (expected === 0 && actual === 0) return "on_pace";
  if (expected === 0) return "ahead";
  if (actual > 1.05 * expected) return "ahead";
  if (actual < 0.95 * expected) return "behind";
  return "on_pace";
}

// --- Revenue aggregation ---

interface DealLike {
  amount: number;
  pipeline: string;
  pb_location?: string;
  dealstage: string;
  [key: string]: string | number | undefined;
}

export function aggregateRevenue(
  deals: DealLike[],
  year: number
): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const group of REVENUE_GROUPS) {
    result[group.groupKey] = Array(12).fill(0);
  }

  for (const deal of deals) {
    for (const group of REVENUE_GROUPS) {
      // Check pipeline match
      if (!group.pipelineIds.includes(deal.pipeline)) continue;

      // Check location filter (empty = all locations)
      if (
        group.locationFilters.length > 0 &&
        !group.locationFilters.includes(deal.pb_location || "")
      ) continue;

      // Check excluded stages
      if (group.excludedStages.includes(deal.dealstage)) continue;

      // Apply each ready recognition strategy
      for (const strategy of group.recognitionStrategies) {
        if (strategy.status === "discovery-gated") continue;
        if (strategy.pipelineId !== deal.pipeline) continue;

        const dateStr = deal[strategy.field] as string | undefined;
        if (!dateStr) continue;

        const date = new Date(dateStr);
        if (date.getFullYear() !== year) continue;

        const month = date.getMonth(); // 0-indexed
        result[group.groupKey][month] += deal.amount * strategy.amountFraction;
      }
    }
  }

  return result;
}

```

- [ ] **Step 3b: Implement revenue-goals.ts (server-only)**

Create `src/lib/revenue-goals.ts`:

```typescript
import { searchWithRetry } from "./hubspot";
import {
  REVENUE_GROUPS,
  computeEffectiveTargets,
  computePaceStatus,
  aggregateRevenue,
  getClosedMonthCount,
  type RevenueGoalResponse,
  type RevenueGroupResult,
  type MonthResult,
  type DealLike,
} from "./revenue-groups-config";

export { REVENUE_GROUPS, type RevenueGoalResponse };

// --- HubSpot fetching ---

const REVENUE_DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "pb_location",
  "construction_complete_date",
  "detach_completion_date",
  "reset_completion_date",
];

export async function fetchRevenueDeals(year: number): Promise<DealLike[]> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // Collect unique pipeline IDs from all groups with ready strategies
  const pipelineIds = new Set<string>();
  for (const group of REVENUE_GROUPS) {
    for (const strategy of group.recognitionStrategies) {
      if (strategy.status === "ready") {
        pipelineIds.add(strategy.pipelineId);
      }
    }
  }

  const allDeals: DealLike[] = [];

  for (const pipelineId of pipelineIds) {
    // Find all recognition fields for this pipeline
    const fields = new Set<string>();
    for (const group of REVENUE_GROUPS) {
      for (const strategy of group.recognitionStrategies) {
        if (strategy.status === "ready" && strategy.pipelineId === pipelineId) {
          fields.add(strategy.field);
        }
      }
    }

    // Search for deals with any completion date in the year range
    // We use OR filter groups — one per recognition field
    const filterGroups = Array.from(fields).map((field) => ({
      filters: [
        { propertyName: "pipeline", operator: "EQ", value: pipelineId },
        { propertyName: field, operator: "GTE", value: startDate },
        { propertyName: field, operator: "LTE", value: endDate },
      ],
    }));

    let after: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const response = await searchWithRetry({
        filterGroups,
        properties: REVENUE_DEAL_PROPERTIES,
        limit: 100,
        after,
        sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
      });

      for (const deal of response.results) {
        allDeals.push({
          amount: parseFloat(deal.properties.amount || "0"),
          pipeline: deal.properties.pipeline || "",
          pb_location: deal.properties.pb_location || "",
          dealstage: deal.properties.dealstage || "",
          construction_complete_date: deal.properties.construction_complete_date,
          detach_completion_date: deal.properties.detach_completion_date,
          reset_completion_date: deal.properties.reset_completion_date,
        });
      }

      after = response.paging?.next?.after;
      hasMore = !!after;
    }
  }

  return allDeals;
}

// --- Full response builder ---

export function buildRevenueGoalResponse(
  year: number,
  deals: DealLike[],
  baseTargetsMap: Record<string, number[]>, // groupKey → 12 monthly base targets
  now: Date = new Date()
): RevenueGoalResponse {
  const closedMonths = getClosedMonthCount(now);
  const currentMonth = now.getMonth(); // 0-indexed
  const revenueByGroup = aggregateRevenue(deals, year);

  const groups: RevenueGroupResult[] = REVENUE_GROUPS.map((group) => {
    const actuals = revenueByGroup[group.groupKey];
    const baseTargets = baseTargetsMap[group.groupKey] || Array(12).fill(group.annualTarget / 12);
    const effectiveTargets = computeEffectiveTargets(baseTargets, actuals, closedMonths);

    const ytdActual = actuals.slice(0, closedMonths + 1).reduce((s, a) => s + a, 0);
    const ytdPaceExpected = (closedMonths / 12) * group.annualTarget;
    const discoveryGated = group.recognitionStrategies.some((s) => s.status === "discovery-gated");

    const months: MonthResult[] = Array.from({ length: 12 }, (_, i) => {
      const closed = i < closedMonths;
      const isCurrentMonth = i === currentMonth;
      return {
        month: i + 1,
        baseTarget: baseTargets[i],
        effectiveTarget: effectiveTargets[i],
        actual: actuals[i],
        closed,
        hit: closed && actuals[i] >= effectiveTargets[i],
        missed: closed && actuals[i] < effectiveTargets[i],
        currentMonthOnTarget: isCurrentMonth && !closed && actuals[i] >= effectiveTargets[i],
      };
    });

    return {
      groupKey: group.groupKey,
      displayName: group.displayName,
      color: group.color,
      annualTarget: group.annualTarget,
      ytdActual,
      ytdPaceExpected,
      paceStatus: computePaceStatus(ytdActual, ytdPaceExpected),
      discoveryGated,
      months,
    };
  });

  const companyAnnual = groups.reduce((s, g) => s + g.annualTarget, 0);
  const companyActual = groups.reduce((s, g) => s + g.ytdActual, 0);
  const companyExpected = (closedMonths / 12) * companyAnnual;

  return {
    year,
    groups,
    companyTotal: {
      annualTarget: companyAnnual,
      ytdActual: companyActual,
      ytdPaceExpected: companyExpected,
      paceStatus: computePaceStatus(companyActual, companyExpected),
    },
    lastUpdated: now.toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/revenue-goals.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/revenue-groups-config.ts src/lib/revenue-goals.ts src/__tests__/lib/revenue-goals.test.ts
git commit -m "feat(revenue): core logic — group config, aggregation, effective targets, pace"
```

---

### Task 3: Cache and Query Key Infrastructure

**Files:**
- Modify: `src/lib/cache.ts`
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add REVENUE_GOALS to CACHE_KEYS in cache.ts**

In `src/lib/cache.ts`, add to the `CACHE_KEYS` object:

```typescript
REVENUE_GOALS: (year: number) => `revenue-goals:${year}` as const,
```

- [ ] **Step 2: Add revenueGoals to queryKeys in query-keys.ts**

In `src/lib/query-keys.ts`, add to the `queryKeys` object:

```typescript
revenueGoals: {
  root: ["revenue-goals"] as const,
  byYear: (year: number) => ["revenue-goals", year] as const,
},
```

- [ ] **Step 3: Add mapping in cacheKeyToQueryKeys function**

In `src/lib/query-keys.ts`, in the `cacheKeyToQueryKeys` function, add before the fallback `return []`:

```typescript
if (serverKey.startsWith("revenue-goals")) return [queryKeys.revenueGoals.root];
```

- [ ] **Step 4: Register SSE cascade listener**

In `src/lib/cache.ts`, add at the bottom of the file after the `CACHE_KEYS` export:

```typescript
// Revenue goals cache cascade: invalidate when deals change
appCache.subscribe((key) => {
  if (key.startsWith("deals:")) {
    appCache.invalidateByPrefix("revenue-goals");
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts src/lib/query-keys.ts
git commit -m "feat(revenue): cache keys, query keys, and SSE cascade for revenue goals"
```

---

## Chunk 2: API Routes

### Task 4: GET /api/revenue-goals route

**Files:**
- Create: `src/app/api/revenue-goals/route.ts`

- [ ] **Step 1: Create the revenue-goals GET handler**

Create `src/app/api/revenue-goals/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  REVENUE_GROUPS,
  fetchRevenueDeals,
  buildRevenueGoalResponse,
} from "@/lib/revenue-goals";
import { prisma } from "@/lib/db";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!ALLOWED_ROLES.includes(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()), 10);
  const forceRefresh = searchParams.get("refresh") === "true";

  if (isNaN(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  try {
    // Note: getOrFetch returns { data, cached, stale, lastUpdated }
    const { data, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEYS.REVENUE_GOALS(year),
      async () => {
        // Fetch base targets from DB
        const goals = await prisma.revenueGoal.findMany({
          where: { year },
          orderBy: [{ groupKey: "asc" }, { month: "asc" }],
        });

        // Auto-seed if no rows exist for this year
        if (goals.length === 0) {
          const seedRows = REVENUE_GROUPS.flatMap((group) =>
            Array.from({ length: 12 }, (_, i) => ({
              year,
              groupKey: group.groupKey,
              month: i + 1,
              target: String(Math.round((group.annualTarget / 12) * 100) / 100), // String for Decimal
            }))
          );
          await prisma.revenueGoal.createMany({ data: seedRows });
          // Re-fetch after seed
          const seeded = await prisma.revenueGoal.findMany({
            where: { year },
            orderBy: [{ groupKey: "asc" }, { month: "asc" }],
          });
          return await buildResponse(year, seeded);
        }

        return await buildResponse(year, goals);
      },
      forceRefresh
    );

    return NextResponse.json({ ...data, lastUpdated });
  } catch (error) {
    console.error("[RevenueGoals] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revenue goals" },
      { status: 500 }
    );
  }
}

async function buildResponse(
  year: number,
  goals: { groupKey: string; month: number; target: unknown }[]
) {
  // Convert DB rows to baseTargetsMap
  const baseTargetsMap: Record<string, number[]> = {};
  for (const group of REVENUE_GROUPS) {
    baseTargetsMap[group.groupKey] = Array(12).fill(group.annualTarget / 12);
  }
  for (const goal of goals) {
    if (!baseTargetsMap[goal.groupKey]) continue;
    baseTargetsMap[goal.groupKey][goal.month - 1] = Number(goal.target);
  }

  const deals = await fetchRevenueDeals(year);
  return buildRevenueGoalResponse(year, deals, baseTargetsMap);
}
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit src/app/api/revenue-goals/route.ts`
Expected: No errors (or only existing project-wide errors)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/revenue-goals/route.ts
git commit -m "feat(revenue): GET /api/revenue-goals with caching and auto-seed"
```

---

### Task 5: Admin Config API Routes

**Files:**
- Create: `src/app/api/revenue-goals/config/route.ts`

- [ ] **Step 1: Create config GET + PUT handlers**

Create `src/app/api/revenue-goals/config/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { REVENUE_GROUPS } from "@/lib/revenue-goals";

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()), 10);

  const goals = await prisma.revenueGoal.findMany({
    where: { year },
    orderBy: [{ groupKey: "asc" }, { month: "asc" }],
  });

  // Build structured response
  const config: Record<string, { month: number; target: number }[]> = {};
  for (const group of REVENUE_GROUPS) {
    config[group.groupKey] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      target: group.annualTarget / 12,
    }));
  }
  for (const goal of goals) {
    if (config[goal.groupKey]) {
      const idx = config[goal.groupKey].findIndex((m) => m.month === goal.month);
      if (idx >= 0) config[goal.groupKey][idx].target = Number(goal.target);
    }
  }

  return NextResponse.json({ year, groups: config });
}

export async function PUT(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json();
  const { year, targets } = body as {
    year: number;
    targets: { groupKey: string; month: number; target: number }[];
  };

  if (!year || !targets || !Array.isArray(targets)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Validate group keys
  const validKeys = new Set(REVENUE_GROUPS.map((g) => g.groupKey));
  for (const t of targets) {
    if (!validKeys.has(t.groupKey)) {
      return NextResponse.json({ error: `Invalid group: ${t.groupKey}` }, { status: 400 });
    }
    if (t.month < 1 || t.month > 12) {
      return NextResponse.json({ error: `Invalid month: ${t.month}` }, { status: 400 });
    }
  }

  // Upsert all targets
  await prisma.$transaction(
    targets.map((t) =>
      prisma.revenueGoal.upsert({
        where: { year_groupKey_month: { year, groupKey: t.groupKey, month: t.month } },
        update: { target: t.target, updatedBy: auth.email },
        create: { year, groupKey: t.groupKey, month: t.month, target: t.target, updatedBy: auth.email },
      })
    )
  );

  // Audit log — use userEmail (not userId which expects a cuid)
  await prisma.activityLog.create({
    data: {
      type: "REVENUE_GOAL_UPDATED",
      userEmail: auth.email,
      description: `Updated ${targets.length} revenue goal targets for ${year}`,
      metadata: { year, targetCount: targets.length },
    },
  });

  // Invalidate cache
  appCache.invalidateByPrefix("revenue-goals");

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/revenue-goals/config/route.ts
git commit -m "feat(revenue): admin config GET/PUT for revenue goal targets"
```

---

## Chunk 3: SuitePageShell Integration and Hero Components

### Task 6: Add heroContent Prop to SuitePageShell

**Files:**
- Modify: `src/components/SuitePageShell.tsx`

- [ ] **Step 1: Add heroContent to props interface**

In `src/components/SuitePageShell.tsx`, first add the import at the top of the file:

```typescript
import type { ReactNode } from "react";
```

Then add to the props interface (around line 16-25):

```typescript
heroContent?: ReactNode;
```

- [ ] **Step 2: Add heroContent to destructured props**

In the component function signature, add `heroContent` to the destructured props.

- [ ] **Step 3: Render heroContent between suite switcher and sections**

After the suite switcher block and before the sections loop (around line 138), add:

```tsx
{heroContent && (
  <div className="mb-8">{heroContent}</div>
)}
```

- [ ] **Step 4: Verify no visual regression**

Run: `npm run build`
Expected: Build succeeds with no errors. Existing suite pages unaffected (they don't pass heroContent).

- [ ] **Step 5: Commit**

```bash
git add src/components/SuitePageShell.tsx
git commit -m "feat(shell): add heroContent prop to SuitePageShell"
```

---

### Task 7: Revenue Goal Tracker — Main Container Component

**Files:**
- Create: `src/components/RevenueGoalTracker.tsx`

- [ ] **Step 1: Create the main tracker client component**

Create `src/components/RevenueGoalTracker.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import { RevenueGoalRings } from "./RevenueGoalRings";
import { RevenueGoalBars } from "./RevenueGoalBars";
import { RevenueGoalMonthlyChart } from "./RevenueGoalMonthlyChart";
import { RevenueGoalFireworks } from "./RevenueGoalFireworks";
import type { RevenueGoalResponse } from "@/lib/revenue-goals";

type Variant = "rings" | "bars";

export function RevenueGoalTracker() {
  const [variant, setVariant] = useState<Variant>("bars");
  const year = new Date().getFullYear();

  const { data, isLoading, error, refetch } = useQuery<RevenueGoalResponse>({
    queryKey: queryKeys.revenueGoals.byYear(year),
    queryFn: async () => {
      const res = await fetch(`/api/revenue-goals?year=${year}`);
      if (!res.ok) throw new Error("Failed to fetch revenue goals");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  // SSE auto-invalidates via cacheKeyToQueryKeys mapping — no manual refetch needed
  useSSE(null, { cacheKeyFilter: "revenue-goals" });

  if (error) return null; // Fail silently on the suite page
  if (isLoading || !data) {
    return (
      <div className="bg-surface rounded-xl border border-t-border p-6 animate-pulse">
        <div className="h-8 w-48 bg-surface-2 rounded mb-4" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-24 bg-surface-2 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // Find groups with currentMonthOnTarget for fireworks
  const fireworkGroups = data.groups.filter((g) =>
    g.months.some((m) => m.currentMonthOnTarget)
  );

  return (
    <div className="bg-surface rounded-xl border border-t-border p-6 relative overflow-hidden">
      {/* Fireworks layer */}
      {fireworkGroups.length > 0 && (
        <RevenueGoalFireworks groups={fireworkGroups} year={year} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            {year} Revenue Goals
          </h2>
          <p className="text-sm text-muted">
            ${(data.companyTotal.ytdActual / 1_000_000).toFixed(1)}M of $
            {(data.companyTotal.annualTarget / 1_000_000).toFixed(1)}M
          </p>
        </div>

        {/* Variant toggle */}
        <div className="flex items-center gap-2 bg-surface-2 rounded-lg p-1">
          <button
            onClick={() => setVariant("rings")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              variant === "rings"
                ? "bg-surface-elevated text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Rings
          </button>
          <button
            onClick={() => setVariant("bars")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              variant === "bars"
                ? "bg-surface-elevated text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Bars
          </button>
        </div>
      </div>

      {/* Hero section */}
      {variant === "rings" ? (
        <RevenueGoalRings groups={data.groups} />
      ) : (
        <RevenueGoalBars
          groups={data.groups}
          companyTotal={data.companyTotal}
        />
      )}

      {/* Monthly chart */}
      <RevenueGoalMonthlyChart groups={data.groups} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RevenueGoalTracker.tsx
git commit -m "feat(revenue): main RevenueGoalTracker container component"
```

---

### Task 8: Variant A — Progress Rings

**Files:**
- Create: `src/components/RevenueGoalRings.tsx`

- [ ] **Step 1: Create the rings component**

Create `src/components/RevenueGoalRings.tsx`:

```tsx
"use client";

import type { RevenueGroupResult } from "@/lib/revenue-goals";

interface Props {
  groups: RevenueGroupResult[];
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

function PaceIndicator({ status, deficit }: { status: string; deficit?: number }) {
  if (status === "ahead") {
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Ahead of pace" />;
  }
  if (status === "behind") {
    return (
      <span className="text-xs text-amber-400" title="Behind pace">
        behind by {deficit ? formatCurrency(deficit) : "—"}
      </span>
    );
  }
  return null;
}

export function RevenueGoalRings({ groups }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
      {groups.map((group) => {
        const pct = group.annualTarget > 0
          ? Math.min((group.ytdActual / group.annualTarget) * 100, 100)
          : 0;
        const circumference = 2 * Math.PI * 34;
        const strokeDash = (pct / 100) * circumference;
        const deficit = group.paceStatus === "behind"
          ? group.ytdPaceExpected - group.ytdActual
          : undefined;

        return (
          <div
            key={group.groupKey}
            className="flex flex-col items-center bg-surface-2 rounded-xl p-4"
          >
            <svg width="80" height="80" viewBox="0 0 80 80" className="mb-2">
              {/* Background circle */}
              <circle
                cx="40" cy="40" r="34"
                fill="none"
                stroke="currentColor"
                className="text-surface"
                strokeWidth="6"
              />
              {/* Progress arc */}
              <circle
                cx="40" cy="40" r="34"
                fill="none"
                stroke={group.color}
                strokeWidth="6"
                strokeDasharray={`${strokeDash} ${circumference - strokeDash}`}
                strokeDashoffset={circumference * 0.25}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
              {/* Center text */}
              <text
                x="40" y="37"
                textAnchor="middle"
                className="fill-foreground text-sm font-bold"
                fontSize="14"
              >
                {pct.toFixed(0)}%
              </text>
              <text
                x="40" y="50"
                textAnchor="middle"
                className="fill-muted"
                fontSize="9"
              >
                {formatCurrency(group.ytdActual)}
              </text>
            </svg>

            <div className="text-center">
              <div className="flex items-center gap-1.5 justify-center">
                <span
                  className="font-semibold text-sm"
                  style={{ color: group.color }}
                >
                  {group.displayName}
                </span>
                <PaceIndicator status={group.paceStatus} deficit={deficit} />
              </div>
              <div className="text-xs text-muted">
                {formatCurrency(group.annualTarget)} goal
              </div>
              {group.discoveryGated && (
                <div className="text-[10px] text-amber-500/70 mt-0.5">
                  recognition field not configured
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RevenueGoalRings.tsx
git commit -m "feat(revenue): Variant A — progress rings hero component"
```

---

### Task 9: Variant B — Thermometer Bars

**Files:**
- Create: `src/components/RevenueGoalBars.tsx`

- [ ] **Step 1: Create the bars component**

Create `src/components/RevenueGoalBars.tsx`:

```tsx
"use client";

import type { RevenueGroupResult, RevenueGoalResponse } from "@/lib/revenue-goals";

interface Props {
  groups: RevenueGroupResult[];
  companyTotal: RevenueGoalResponse["companyTotal"];
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

export function RevenueGoalBars({ groups, companyTotal }: Props) {
  const companyPct = companyTotal.annualTarget > 0
    ? (companyTotal.ytdActual / companyTotal.annualTarget) * 100
    : 0;
  const pacePct = companyTotal.annualTarget > 0
    ? (companyTotal.ytdPaceExpected / companyTotal.annualTarget) * 100
    : 0;

  return (
    <div className="mb-6">
      {/* Company-wide hero bar */}
      <div className="bg-surface-2 rounded-xl p-4 mb-4">
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-foreground font-semibold">Company Total</span>
          <span className="text-orange-400 font-bold text-sm">
            {formatCurrency(companyTotal.ytdActual)} / {formatCurrency(companyTotal.annualTarget)}
            {" "}({companyPct.toFixed(0)}%)
          </span>
        </div>
        <div className="relative bg-surface rounded-full h-5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-1000 ease-out"
            style={{ width: `${Math.min(companyPct, 100)}%` }}
          />
          {/* Pace marker */}
          {pacePct > 0 && (
            <div
              className="absolute top-0 h-full w-0.5 bg-white/30"
              style={{ left: `${Math.min(pacePct, 100)}%` }}
              title={`Expected pace: ${pacePct.toFixed(0)}%`}
            />
          )}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-muted">Jan</span>
          <span className="text-[10px] text-muted">
            Expected pace ({pacePct.toFixed(0)}%)
          </span>
          <span className="text-[10px] text-muted">Dec</span>
        </div>
      </div>

      {/* Per-group bars */}
      <div className="flex flex-col gap-3">
        {groups.map((group) => {
          const pct = group.annualTarget > 0
            ? (group.ytdActual / group.annualTarget) * 100
            : 0;
          const deficit = group.paceStatus === "behind"
            ? group.ytdPaceExpected - group.ytdActual
            : undefined;

          return (
            <div key={group.groupKey}>
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className="font-semibold text-sm"
                    style={{ color: group.color }}
                  >
                    {group.displayName}
                  </span>
                  {group.paceStatus === "ahead" && (
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Ahead of pace" />
                  )}
                  {group.paceStatus === "behind" && deficit && (
                    <span className="text-[10px] text-amber-400">
                      behind by {formatCurrency(deficit)}
                    </span>
                  )}
                  {group.discoveryGated && (
                    <span className="text-[10px] text-amber-500/70">
                      not configured
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted">
                  {formatCurrency(group.ytdActual)} / {formatCurrency(group.annualTarget)}
                </span>
              </div>
              <div className="bg-surface rounded-full h-3 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{
                    width: `${Math.min(pct, 100)}%`,
                    backgroundColor: group.color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RevenueGoalBars.tsx
git commit -m "feat(revenue): Variant B — thermometer bars hero component"
```

---

## Chunk 4: Monthly Chart, Fireworks, and Admin Page

### Task 10: Monthly Breakdown Chart

**Files:**
- Create: `src/components/RevenueGoalMonthlyChart.tsx`

- [ ] **Step 1: Create the monthly chart component**

Create `src/components/RevenueGoalMonthlyChart.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { RevenueGroupResult } from "@/lib/revenue-goals";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Props {
  groups: RevenueGroupResult[];
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

export function RevenueGoalMonthlyChart({ groups }: Props) {
  const [selectedGroup, setSelectedGroup] = useState<string | "all">("all");
  const currentMonth = new Date().getMonth(); // 0-indexed

  const displayGroups = selectedGroup === "all"
    ? groups
    : groups.filter((g) => g.groupKey === selectedGroup);

  // Find the max monthly value across all groups for scaling
  const maxMonthly = Math.max(
    ...displayGroups.flatMap((g) =>
      g.months.map((m) => Math.max(m.actual, m.effectiveTarget))
    ),
    1 // prevent division by zero
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Monthly Breakdown</h3>
        <select
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
          className="bg-surface-2 text-foreground text-xs rounded-lg px-2 py-1 border border-t-border"
        >
          <option value="all">All Groups</option>
          {groups.map((g) => (
            <option key={g.groupKey} value={g.groupKey}>
              {g.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-12 gap-1">
        {MONTH_LABELS.map((label, monthIdx) => {
          const isFuture = monthIdx > currentMonth;
          const isCurrent = monthIdx === currentMonth;

          return (
            <div key={label} className="flex flex-col items-center">
              {/* Bars for each group in this month */}
              <div className="relative w-full h-24 flex items-end justify-center gap-px">
                {displayGroups.map((group) => {
                  const monthData = group.months[monthIdx];
                  const barHeight = maxMonthly > 0
                    ? (monthData.actual / maxMonthly) * 100
                    : 0;
                  const targetHeight = maxMonthly > 0
                    ? (monthData.effectiveTarget / maxMonthly) * 100
                    : 0;

                  return (
                    <div
                      key={group.groupKey}
                      className="relative flex-1 flex items-end"
                      title={`${group.displayName}: ${formatCurrency(monthData.actual)} / ${formatCurrency(monthData.effectiveTarget)}`}
                    >
                      {/* Target line */}
                      <div
                        className="absolute w-full border-t border-dashed border-white/20"
                        style={{ bottom: `${targetHeight}%` }}
                      />
                      {/* Actual bar */}
                      <div
                        className={`w-full rounded-t transition-all duration-500 ${
                          monthData.hit ? "ring-1 ring-emerald-400/50" :
                          monthData.missed ? "opacity-70" :
                          isFuture ? "opacity-30" : ""
                        }`}
                        style={{
                          height: `${barHeight}%`,
                          backgroundColor: monthData.missed
                            ? `${group.color}88`
                            : group.color,
                          minHeight: monthData.actual > 0 ? "2px" : "0px",
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Month label */}
              <span className={`text-[9px] mt-1 ${
                isCurrent ? "text-orange-400 font-bold" :
                isFuture ? "text-muted/50" : "text-muted"
              }`}>
                {label}
              </span>

              {/* Hit/miss indicators */}
              <div className="h-3 flex items-center">
                {displayGroups.some((g) => g.months[monthIdx].hit) && (
                  <span className="text-[8px] text-emerald-400">&#10003;</span>
                )}
                {displayGroups.some((g) => g.months[monthIdx].missed) && (
                  <span className="text-[8px] text-red-400">&#10007;</span>
                )}
                {displayGroups.some((g) => g.months[monthIdx].currentMonthOnTarget) && (
                  <span className="text-[8px] text-emerald-400">&#9733;</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RevenueGoalMonthlyChart.tsx
git commit -m "feat(revenue): monthly breakdown chart with hit/miss indicators"
```

---

### Task 11: Fireworks Animation Component

**Files:**
- Create: `src/components/RevenueGoalFireworks.tsx`

- [ ] **Step 1: Create the fireworks canvas component**

Create `src/components/RevenueGoalFireworks.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { RevenueGroupResult } from "@/lib/revenue-goals";

interface Props {
  groups: RevenueGroupResult[];
  year: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

export function RevenueGoalFireworks({ groups, year }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    // Check sessionStorage for already-fired fireworks
    const month = new Date().getMonth() + 1;
    const unfired = groups.filter((g) => {
      const key = `fireworks:${g.groupKey}:${year}-${month}`;
      return !sessionStorage.getItem(key);
    });

    if (unfired.length === 0) return;

    // Mark as fired
    for (const g of unfired) {
      const key = `fireworks:${g.groupKey}:${year}-${month}`;
      sessionStorage.setItem(key, "1");
    }

    setShouldAnimate(true);
  }, [groups, year]);

  useEffect(() => {
    if (!shouldAnimate || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const particles: Particle[] = [];
    const colors = groups.map((g) => g.color);

    // Create burst of particles
    for (let i = 0; i < 80; i++) {
      const angle = (Math.PI * 2 * i) / 80 + Math.random() * 0.3;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0,
        maxLife: 60 + Math.random() * 40,
        size: 2 + Math.random() * 3,
      });
    }

    let frame = 0;
    const maxFrames = 120; // ~2 seconds at 60fps

    function animate() {
      if (frame >= maxFrames || !ctx) {
        setShouldAnimate(false);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05; // gravity
        p.life++;

        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }

      frame++;
      requestAnimationFrame(animate);
    }

    animate();
  }, [shouldAnimate, groups]);

  if (!shouldAnimate) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RevenueGoalFireworks.tsx
git commit -m "feat(revenue): canvas fireworks animation for monthly goal hits"
```

---

### Task 12: Admin Config Page

**Files:**
- Create: `src/app/dashboards/revenue-goals/page.tsx`
- Modify: `src/lib/suite-nav.ts`

- [ ] **Step 1: Create the admin config page**

Create `src/app/dashboards/revenue-goals/page.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { REVENUE_GROUPS } from "@/lib/revenue-groups-config"; // Client-safe import (NOT revenue-goals.ts which has server deps)
import { useToast } from "@/contexts/ToastContext";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface ConfigResponse {
  year: number;
  groups: Record<string, { month: number; target: number }[]>;
}

export default function RevenueGoalsConfigPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [edits, setEdits] = useState<Record<string, number[]>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ["revenue-goals-config", year],
    queryFn: async () => {
      const res = await fetch(`/api/revenue-goals/config?year=${year}`);
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  // Sync fetched data into edits
  useEffect(() => {
    if (!data) return;
    const initial: Record<string, number[]> = {};
    for (const group of REVENUE_GROUPS) {
      const months = data.groups[group.groupKey] || [];
      initial[group.groupKey] = months.map((m) => m.target);
    }
    setEdits(initial);
    setHasChanges(false);
  }, [data]);

  const updateCell = useCallback((groupKey: string, monthIdx: number, value: number) => {
    setEdits((prev) => {
      const next = { ...prev };
      next[groupKey] = [...(next[groupKey] || [])];
      next[groupKey][monthIdx] = value;
      return next;
    });
    setHasChanges(true);
  }, []);

  const resetToEven = useCallback((groupKey: string) => {
    const group = REVENUE_GROUPS.find((g) => g.groupKey === groupKey);
    if (!group) return;
    const even = group.annualTarget / 12;
    setEdits((prev) => ({
      ...prev,
      [groupKey]: Array(12).fill(Math.round(even * 100) / 100),
    }));
    setHasChanges(true);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const targets: { groupKey: string; month: number; target: number }[] = [];
      for (const [groupKey, months] of Object.entries(edits)) {
        months.forEach((target, i) => {
          targets.push({ groupKey, month: i + 1, target });
        });
      }
      const res = await fetch("/api/revenue-goals/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, targets }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      showToast("Revenue goals saved", "success");
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.revenueGoals.root });
      queryClient.invalidateQueries({ queryKey: ["revenue-goals-config", year] });
    },
    onError: () => showToast("Failed to save revenue goals", "error"),
  });

  return (
    <DashboardShell title="Revenue Goal Config" accentColor="orange">
      <div className="flex items-center gap-4 mb-6">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="bg-surface-2 text-foreground rounded-lg px-3 py-2 border border-t-border"
        >
          {[2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg font-medium text-sm disabled:opacity-50 hover:bg-orange-600 transition-colors"
        >
          {saveMutation.isPending ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-64 bg-surface-2 rounded-xl" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border">
                <th className="text-left py-2 px-2 text-muted font-medium">Group</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="text-center py-2 px-1 text-muted font-medium text-xs">{m}</th>
                ))}
                <th className="text-center py-2 px-2 text-muted font-medium">Annual</th>
                <th className="py-2 px-2" />
              </tr>
            </thead>
            <tbody>
              {REVENUE_GROUPS.map((group) => {
                const months = edits[group.groupKey] || Array(12).fill(0);
                const annual = months.reduce((s, t) => s + t, 0);

                return (
                  <tr key={group.groupKey} className="border-b border-t-border/50">
                    <td className="py-2 px-2 font-medium" style={{ color: group.color }}>
                      {group.displayName}
                    </td>
                    {months.map((target, i) => (
                      <td key={i} className="py-1 px-0.5">
                        <input
                          type="number"
                          value={Math.round(target)}
                          onChange={(e) => updateCell(group.groupKey, i, Number(e.target.value))}
                          className="w-full bg-surface-2 text-foreground text-center text-xs rounded px-1 py-1 border border-t-border/50 focus:border-orange-500 focus:outline-none"
                        />
                      </td>
                    ))}
                    <td className="py-2 px-2 text-center text-xs text-muted font-medium">
                      ${(annual / 1_000_000).toFixed(2)}M
                    </td>
                    <td className="py-2 px-2">
                      <button
                        onClick={() => resetToEven(group.groupKey)}
                        className="text-[10px] text-muted hover:text-foreground"
                        title="Reset to even monthly split"
                      >
                        Reset
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Add config page link to admin suite**

In `src/app/suites/admin/page.tsx`, add a card to the tools array (admin suite cards are defined in the page file, not suite-nav.ts). Use the codebase tag color format:

```typescript
{
  href: "/dashboards/revenue-goals",
  title: "Revenue Goal Config",
  description: "Set annual and monthly revenue targets per shop group.",
  tag: "Config",
  tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  section: "System",
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/revenue-goals/page.tsx src/app/suites/admin/page.tsx
git commit -m "feat(revenue): admin config page for editing revenue goal targets"
```

---

## Chunk 5: Executive Suite Integration and Final Wiring

### Task 13: Wire Revenue Tracker into Executive Suite Page

**Files:**
- Modify: `src/app/suites/executive/page.tsx`

- [ ] **Step 1: Import and pass RevenueGoalTracker as heroContent**

The executive suite page is a server component. We need to import the client component and pass it:

```tsx
import { RevenueGoalTracker } from "@/components/RevenueGoalTracker";
```

Then in the return statement, add the `heroContent` prop to `SuitePageShell`:

```tsx
<SuitePageShell
  // ...existing props
  heroContent={<RevenueGoalTracker />}
/>
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/suites/executive/page.tsx
git commit -m "feat(revenue): wire tracker into executive suite landing page"
```

---

### Task 14: Visual Verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Navigate to executive suite**

Open `http://localhost:3000/suites/executive` (must be logged in as ADMIN or OWNER).

Verify:
- Revenue goal tracker appears above the dashboard cards
- Rings/Bars toggle works
- Loading skeleton shows briefly
- Data loads (may show $0 actuals if no construction_complete_date deals in current year)
- Monthly chart renders 12 months
- Admin can navigate to `/dashboards/revenue-goals` for config

- [ ] **Step 3: Test admin config page**

Open `/dashboards/revenue-goals`:
- Year selector works
- Table populates with even-split defaults
- Editing a cell and saving works
- "Reset" button resets to even split
- Refreshing shows saved values

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(revenue): revenue goal tracker — complete implementation"
```
