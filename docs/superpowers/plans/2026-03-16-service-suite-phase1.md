# Service Suite Phase 1: Suite Split + Service Overview + Roofing

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the combined Service + D&R Suite into two independent suites (Service Suite + D&R+Roofing Suite), build the Service Overview priority queue command center, and add Roofing Pipeline + Scheduler dashboards.

**Architecture:** Phase 1 splits the navigation/permissions layer first, then builds the Service Overview as a new dashboard backed by a priority scoring engine that reads service deals from the existing `/api/deals` endpoint. Roofing Pipeline and Scheduler clone the D&R equivalents, pointing at the existing roofing pipeline constants and Zuper job categories. A new Prisma model (`ServicePriorityOverride`) supports manual priority overrides. A singleton cache cascade listener watches `deals:service` for priority queue freshness.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5, Prisma 7.3 (Neon Postgres), Tailwind v4, HubSpot API, Zuper API, SSE via `useSSE` hook

**Spec:** `docs/superpowers/specs/2026-03-16-service-suite-design.md`

---

## Chunk 1: Database Schema + Suite Navigation Split

### Task 1: Add ServicePriorityOverride Prisma Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add ServicePriorityOverride model to schema**

Add at the end of `prisma/schema.prisma`:

```prisma
model ServicePriorityOverride {
  id               String    @id @default(cuid())
  itemId           String
  itemType         String    // "deal" | "ticket"
  overridePriority String    // "critical" | "high" | "medium" | "low"
  setBy            String
  reason           String?
  expiresAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([itemId, itemType])
}
```

- [ ] **Step 2: Generate Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" with no errors

- [ ] **Step 3: Create migration**

Run: `npx prisma migrate dev --name add_service_priority_override`
Expected: Migration created successfully

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(service): add ServicePriorityOverride model for priority queue"
```

---

### Task 2: Split Suite Navigation — `suite-nav.ts`

**Files:**
- Modify: `src/lib/suite-nav.ts` (lines 36-40: combined entry, lines 55-82: allowlist)

- [ ] **Step 1: Read the current file to confirm line numbers**

Run: Read `src/lib/suite-nav.ts` in full

- [ ] **Step 2: Split the combined Service + D&R entry in SUITE_NAV_ENTRIES**

In `SUITE_NAV_ENTRIES`, find the entry with `href: "/suites/service"` and `title: "Service + D&R Suite"`. Replace it with TWO entries:

**Important:** The `SuiteNavEntry` interface only has `href`, `title`, `shortLabel`, and `description` — no `icon` or `color` fields. Do NOT add fields that don't exist on the interface.

```typescript
{
  href: "/suites/service",
  title: "Service Suite",
  shortLabel: "Service",
  description: "Service scheduling, equipment tracking, priority queue, and pipelines.",
},
{
  href: "/suites/dnr-roofing",
  title: "D&R + Roofing Suite",
  shortLabel: "D&R + Roofing",
  description: "Detach & reset and roofing scheduling, pipelines, and tracking.",
},
```

- [ ] **Step 3: Update SUITE_SWITCHER_ALLOWLIST**

For every role that currently includes `"/suites/service"` in their allowlist array, add `"/suites/dnr-roofing"` next to it. The roles to update are:
- ADMIN
- OWNER
- MANAGER
- PROJECT_MANAGER
- OPERATIONS
- OPERATIONS_MANAGER

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/suite-nav.ts
git commit -m "feat(nav): split Service+D&R into Service Suite and D&R+Roofing Suite"
```

---

### Task 3: Update Role Permissions — `role-permissions.ts`

**Files:**
- Modify: `src/lib/role-permissions.ts`

- [ ] **Step 1: Read the file to locate all allowedRoutes arrays**

Read `src/lib/role-permissions.ts` in full. Identify every role's `allowedRoutes` array that contains `/suites/service`.

- [ ] **Step 2: Add `/suites/dnr-roofing` to each applicable role**

For each role that has `/suites/service` in `allowedRoutes`, add `"/suites/dnr-roofing"` to the same array.

- [ ] **Step 3: Add new dashboard routes to applicable roles**

For roles that currently have `/dashboards/dnr` and `/dashboards/dnr-scheduler`, also add:
- `"/dashboards/roofing"`
- `"/dashboards/roofing-scheduler"`

For roles that currently have `/dashboards/service`, also add:
- `"/dashboards/service-overview"`

Check TECH_OPS specifically — it has `/dashboards/service-scheduler`, `/dashboards/dnr-scheduler`, `/dashboards/service-backlog`, `/dashboards/service`, `/dashboards/dnr`. Add roofing routes (`/dashboards/roofing`, `/dashboards/roofing-scheduler`) to TECH_OPS to maintain parity with existing D&R/service access. Do NOT add `/dashboards/service-overview` to TECH_OPS — the spec only grants overview to suite-level access roles.

- [ ] **Step 4: Add API route permissions**

For roles that have suite-level access (ADMIN, OWNER, MANAGER, PROJECT_MANAGER, OPERATIONS, OPERATIONS_MANAGER), add the priority queue API routes to their `allowedRoutes`:
- `"/api/service/priority-queue"`
- `"/api/service/priority-queue/overrides"`

Check whether API routes need explicit permission entries in this codebase — if API routes are not gated by `allowedRoutes` (some apps only gate page routes), skip this step. Read `role-permissions.ts` to confirm.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/role-permissions.ts
git commit -m "feat(auth): add D&R+Roofing suite and new dashboard routes to role permissions"
```

---

### Task 4: Update Page Directory — `page-directory.ts`

**Files:**
- Modify: `src/lib/page-directory.ts`

- [ ] **Step 1: Read the file**

Read `src/lib/page-directory.ts` in full.

- [ ] **Step 2: Add new routes to APP_PAGE_ROUTES**

Add these entries to the `APP_PAGE_ROUTES` array:
```typescript
"/suites/dnr-roofing",
"/dashboards/service-overview",
"/dashboards/roofing",
"/dashboards/roofing-scheduler",
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/page-directory.ts
git commit -m "feat(nav): register new suite and dashboard routes in page directory"
```

---

### Task 5: Update Home Page Suite Cards — `page.tsx`

**Files:**
- Modify: `src/app/page.tsx` (lines 96-103: combined suite card, lines 464-502: role visibility)

- [ ] **Step 1: Read the file to find the SUITE_LINKS entry and role visibility**

Read `src/app/page.tsx` focusing on lines 55-120 (SUITE_LINKS) and lines 460-510 (role visibility).

- [ ] **Step 2: Split the combined suite card into two**

Find the entry with `title: "Service + D&R Suite"` in the SUITE_LINKS array. Replace with two entries:

```typescript
{
  href: "/suites/service",
  title: "Service Suite",
  description: "Service scheduling, equipment tracking, priority queue, and pipelines.",
  tag: "SERVICE",
  tagColor: "cyan",
  visibility: "admin",
},
{
  href: "/suites/dnr-roofing",
  title: "D&R + Roofing Suite",
  description: "Detach & reset and roofing scheduling, pipelines, and tracking.",
  tag: "D&R + ROOFING",
  tagColor: "purple",
  visibility: "admin",
},
```

- [ ] **Step 3: Update role-based visibleSuites logic**

In the role-based visibility section (~lines 460-510), find every `visibleSuites` array. Each role has its own explicit suite set. For EACH role that includes `"/suites/service"`, add `"/suites/dnr-roofing"` to the same array. Pay special attention to `OPERATIONS_MANAGER` and `PROJECT_MANAGER` — they may have custom suite sets that differ from the default. Check each named role block individually rather than relying on find-and-replace.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(home): split Service+D&R suite card into two separate suite entries"
```

---

### Task 6: Update DashboardShell Breadcrumbs — `DashboardShell.tsx`

**Files:**
- Modify: `src/components/DashboardShell.tsx` (lines 81-85: SUITE_MAP)

- [ ] **Step 1: Read SUITE_MAP entries**

Read `src/components/DashboardShell.tsx` focusing on the SUITE_MAP object.

- [ ] **Step 2: Split breadcrumb mappings**

Find the 5 entries that map service/D&R dashboards to `"/suites/service"` with label `"Service + D&R"`. Replace with:

```typescript
// Service Suite dashboards
"/dashboards/service-scheduler": { href: "/suites/service", label: "Service" },
"/dashboards/service-backlog": { href: "/suites/service", label: "Service" },
"/dashboards/service": { href: "/suites/service", label: "Service" },
"/dashboards/service-overview": { href: "/suites/service", label: "Service" },
// Future phases — add now so breadcrumbs work when these dashboards are created:
"/dashboards/service-tickets": { href: "/suites/service", label: "Service" },
"/dashboards/service-customers": { href: "/suites/service", label: "Service" },
"/dashboards/service-warranty": { href: "/suites/service", label: "Service" },
"/dashboards/service-catalog": { href: "/suites/service", label: "Service" },

// D&R + Roofing Suite dashboards
"/dashboards/dnr-scheduler": { href: "/suites/dnr-roofing", label: "D&R + Roofing" },
"/dashboards/dnr": { href: "/suites/dnr-roofing", label: "D&R + Roofing" },
"/dashboards/roofing": { href: "/suites/dnr-roofing", label: "D&R + Roofing" },
"/dashboards/roofing-scheduler": { href: "/suites/dnr-roofing", label: "D&R + Roofing" },
```

- [ ] **Step 3: Commit**

```bash
git add src/components/DashboardShell.tsx
git commit -m "feat(nav): update breadcrumb mappings for split suites"
```

---

### Task 7: Update Service Suite Landing Page — `suites/service/page.tsx`

**Files:**
- Modify: `src/app/suites/service/page.tsx`

- [ ] **Step 1: Read the current file**

Read `src/app/suites/service/page.tsx` in full.

- [ ] **Step 2: Remove D&R section from LINKS array**

Remove the entries with `section: "D&R"` from the LINKS array (the dnr-scheduler and dnr entries). Keep only the Service section entries.

- [ ] **Step 3: Add Service Overview to LINKS**

Add a new entry at the beginning of the LINKS array for the Service Overview dashboard:

```typescript
{
  href: "/dashboards/service-overview",
  title: "Service Overview",
  description: "Priority queue command center — see what needs attention now.",
  section: "Service",
},
```

- [ ] **Step 4: Update SuitePageShell props**

Update the component props:
- `title` → `"Service Suite"`
- `subtitle` → `"Service scheduling, equipment tracking, priority queue, and pipelines."`
- `tagColorClass` → change from purple to cyan: `"bg-cyan-500/20 text-cyan-400 border-cyan-500/30"`
- `hoverBorderClass` → change from `"hover:border-purple-500/50"` to `"hover:border-cyan-500/50"` (check prop name in `SuitePageShell` — may be `hoverBorder` or similar)

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/app/suites/service/page.tsx
git commit -m "feat(service): update service suite landing page with overview link and cyan theme"
```

---

### Task 8: Create D&R + Roofing Suite Landing Page

**Files:**
- Create: `src/app/suites/dnr-roofing/page.tsx`

- [ ] **Step 1: Create the D&R + Roofing suite landing page**

Create `src/app/suites/dnr-roofing/page.tsx` by cloning the service suite page structure. Use `SuitePageShell` with purple accent.

LINKS array should contain:
1. D&R Pipeline — `/dashboards/dnr` — "Detach & Reset project tracking through pipeline stages."
2. D&R Scheduler — `/dashboards/dnr-scheduler` — "Calendar view of Zuper detach, reset, and D&R inspection jobs."
3. Roofing Pipeline — `/dashboards/roofing` — "Roofing project tracking through pipeline stages."
4. Roofing Scheduler — `/dashboards/roofing-scheduler` — "Calendar view of Zuper roofing jobs."

SuitePageShell props:
- `title`: `"D&R + Roofing Suite"`
- `subtitle`: `"Detach & reset and roofing scheduling, pipelines, and tracking."`
- `tagColorClass`: `"bg-purple-500/20 text-purple-400 border-purple-500/30"`
- `currentSuiteHref`: `"/suites/dnr-roofing"`

Reference `src/app/suites/service/page.tsx` for the exact pattern — match imports, layout, and component usage.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/app/suites/dnr-roofing/page.tsx
git commit -m "feat(dnr-roofing): create D&R + Roofing suite landing page"
```

---

### Task 9: Fix Scheduler Back Links

**Files:**
- Modify: `src/app/dashboards/dnr-scheduler/page.tsx` (line ~239)
- Modify: `src/app/dashboards/service-scheduler/page.tsx` (line ~242)

- [ ] **Step 1: Read both scheduler files to find back links**

Read both files focusing on the `<Link>` components with "Back" text.

- [ ] **Step 2: Update D&R scheduler back link**

In `dnr-scheduler/page.tsx`, find the `<Link href="/suites/service"` back link (from the old combined suite). Change it to:
```tsx
<Link href="/suites/dnr-roofing" ...>
```

- [ ] **Step 3: Update service scheduler back link**

In `service-scheduler/page.tsx`, find the `<Link href="/suites/service"` back link. Confirm it already points to `/suites/service` — if so, no change needed. If it points elsewhere, update to:
```tsx
<Link href="/suites/service" ...>
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/dnr-scheduler/page.tsx src/app/dashboards/service-scheduler/page.tsx
git commit -m "fix(nav): update scheduler back links to point to correct suites"
```

---

### Task 10: Verify Suite Split End-to-End

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No new lint errors

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: All existing tests pass

- [ ] **Step 4: Manual verification checklist**

Start dev server (`npm run dev`) and verify:
1. Home page shows two separate suite cards (Service Suite + D&R+Roofing Suite)
2. `/suites/service` shows Service dashboards only (no D&R entries), with cyan accent
3. `/suites/dnr-roofing` shows D&R + Roofing dashboards, with purple accent
4. Suite switcher in navbar shows both suites
5. Breadcrumbs from service dashboards link to `/suites/service`
6. Breadcrumbs from D&R dashboards link to `/suites/dnr-roofing`
7. Service scheduler back button goes to `/suites/service`
8. D&R scheduler back button goes to `/suites/dnr-roofing`

---

## Chunk 2: Service Overview — Priority Queue Command Center

### Task 11: Create Priority Scoring Engine — `service-priority.ts`

**Files:**
- Create: `src/lib/service-priority.ts`
- Create: `src/__tests__/lib/service-priority.test.ts`

- [ ] **Step 1: Write failing tests for the priority scoring engine**

Create `src/__tests__/lib/service-priority.test.ts`:

```typescript
import { scorePriorityItem, buildPriorityQueue, type PriorityItem, type PriorityScore } from "@/lib/service-priority";

describe("scorePriorityItem", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("scores a deal with warranty expiring + no contact as critical priority", () => {
    const item: PriorityItem = {
      id: "deal-0",
      type: "deal",
      title: "Service — Critical Test",
      stage: "Work In Progress",
      lastModified: new Date("2026-03-06T12:00:00Z").toISOString(), // 10 days ago
      lastContactDate: new Date("2026-03-06T12:00:00Z").toISOString(), // 10 days, no contact >7 days (+35)
      createDate: new Date("2026-03-01T12:00:00Z").toISOString(),
      amount: 15000, // >$10k (+10)
      location: "Denver",
      url: "https://app.hubspot.com/deals/0",
      warrantyExpiry: new Date("2026-03-19T12:00:00Z").toISOString(), // 3 days from now (+40)
    };
    const result = scorePriorityItem(item, now);
    // 40 (warranty) + 35 (no contact) + 20 (stage 10d) + 10 (value) + 10 (active overdue) = 100 (capped)
    expect(result.tier).toBe("critical");
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("scores a deal stuck in stage >3 days as medium priority", () => {
    const item: PriorityItem = {
      id: "deal-1",
      type: "deal",
      title: "Service — Smith",
      stage: "Site Visit Scheduling",
      lastModified: new Date("2026-03-10T12:00:00Z").toISOString(), // 6 days ago
      lastContactDate: new Date("2026-03-14T12:00:00Z").toISOString(), // 2 days ago
      createDate: new Date("2026-03-01T12:00:00Z").toISOString(),
      amount: 5000,
      location: "Denver",
      url: "https://app.hubspot.com/deals/1",
    };
    const result = scorePriorityItem(item, now);
    expect(result.tier).toBe("medium");
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.score).toBeLessThan(50);
  });

  it("scores a deal with no contact >7 days + stuck in stage as high priority", () => {
    const item: PriorityItem = {
      id: "deal-2",
      type: "deal",
      title: "Service — Garcia",
      stage: "Work In Progress",
      lastModified: new Date("2026-03-06T12:00:00Z").toISOString(), // 10 days ago (+20 stage)
      lastContactDate: new Date("2026-03-08T12:00:00Z").toISOString(), // 8 days ago (+35 no contact >7d)
      createDate: new Date("2026-03-01T12:00:00Z").toISOString(),
      amount: 8000, // +5
      location: "CO Springs",
      url: "https://app.hubspot.com/deals/2",
    };
    const result = scorePriorityItem(item, now);
    // 35 (no contact >7d) + 20 (stage 10d) + 5 (amount) + 10 (active overdue) = 70 → High
    expect(result.tier).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(75);
  });

  it("scores a recently contacted on-track deal as low priority", () => {
    const item: PriorityItem = {
      id: "deal-3",
      type: "deal",
      title: "Service — Williams",
      stage: "Work In Progress",
      lastModified: new Date("2026-03-16T10:00:00Z").toISOString(), // 2 hours ago
      lastContactDate: new Date("2026-03-15T12:00:00Z").toISOString(), // 1 day ago
      createDate: new Date("2026-03-10T12:00:00Z").toISOString(),
      amount: 3000,
      location: "Denver",
      url: "https://app.hubspot.com/deals/3",
    };
    const result = scorePriorityItem(item, now);
    expect(result.tier).toBe("low");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThan(25);
  });

  it("returns reasons array explaining the score", () => {
    const item: PriorityItem = {
      id: "deal-4",
      type: "deal",
      title: "Service — Test",
      stage: "Inspection",
      lastModified: new Date("2026-03-10T12:00:00Z").toISOString(),
      lastContactDate: new Date("2026-03-10T12:00:00Z").toISOString(),
      createDate: new Date("2026-03-01T12:00:00Z").toISOString(),
      amount: 10000,
      location: "Denver",
      url: "https://app.hubspot.com/deals/4",
    };
    const result = scorePriorityItem(item, now);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toBeTruthy();
  });
});

describe("buildPriorityQueue", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("applies manual override to change a low-scored item to critical", () => {
    const lowItem: PriorityItem = {
      id: "deal-low",
      type: "deal",
      title: "Service — Override Test",
      stage: "Work In Progress",
      lastModified: new Date("2026-03-16T10:00:00Z").toISOString(),
      lastContactDate: new Date("2026-03-15T12:00:00Z").toISOString(),
      createDate: new Date("2026-03-10T12:00:00Z").toISOString(),
      amount: 1000,
      location: "Denver",
    };

    const overrides = [
      { itemId: "deal-low", itemType: "deal", overridePriority: "critical" as const },
    ];

    const queue = buildPriorityQueue([lowItem], overrides, now);
    expect(queue).toHaveLength(1);
    expect(queue[0].tier).toBe("critical");
    expect(queue[0].overridden).toBe(true);
    expect(queue[0].reasons[0]).toContain("Manually set to critical");
  });

  it("sorts items by score descending", () => {
    const items: PriorityItem[] = [
      {
        id: "low", type: "deal", title: "Low", stage: "Work In Progress",
        lastModified: now.toISOString(), lastContactDate: now.toISOString(),
        createDate: now.toISOString(), amount: 1000, location: "Denver",
      },
      {
        id: "high", type: "deal", title: "High", stage: "Work In Progress",
        lastModified: new Date("2026-03-06T12:00:00Z").toISOString(),
        lastContactDate: new Date("2026-03-06T12:00:00Z").toISOString(),
        createDate: now.toISOString(), amount: 15000, location: "Denver",
      },
    ];

    const queue = buildPriorityQueue(items, [], now);
    expect(queue[0].item.id).toBe("high");
    expect(queue[1].item.id).toBe("low");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/service-priority.test.ts --no-cache`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the priority scoring engine**

Create `src/lib/service-priority.ts`:

```typescript
/**
 * Service Priority Scoring Engine
 *
 * Scores service deals (and later tickets) 0-100 for the priority queue.
 * Buckets: Critical (75-100), High (50-74), Medium (25-49), Low (0-24).
 */

export interface PriorityItem {
  id: string;
  type: "deal" | "ticket";
  title: string;
  stage: string;
  lastModified: string;
  lastContactDate?: string | null;
  createDate: string;
  amount?: number | null;
  location?: string | null;
  url?: string;
  warrantyExpiry?: string | null;
}

export type PriorityTier = "critical" | "high" | "medium" | "low";

export interface PriorityScore {
  item: PriorityItem;
  score: number;
  tier: PriorityTier;
  reasons: string[];
  overridden?: boolean;
}

function daysBetween(dateStr: string, now: Date): number {
  const date = new Date(dateStr);
  return Math.max(0, (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function tierFromScore(score: number): PriorityTier {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function scorePriorityItem(item: PriorityItem, now: Date = new Date()): PriorityScore {
  let score = 0;
  const reasons: string[] = [];

  // 1. Warranty expiry urgency
  if (item.warrantyExpiry) {
    const daysToExpiry = -daysBetween(item.warrantyExpiry, now); // negative = future
    if (daysToExpiry <= 0) {
      // Already expired
      score += 30;
      reasons.push("Warranty expired");
    } else if (daysToExpiry <= 7) {
      score += 40;
      reasons.push(`Warranty expires in ${Math.ceil(daysToExpiry)} days`);
    } else if (daysToExpiry <= 30) {
      score += 15;
      reasons.push(`Warranty expires in ${Math.ceil(daysToExpiry)} days`);
    }
  }

  // 2. Last contact recency
  if (item.lastContactDate) {
    const daysSinceContact = daysBetween(item.lastContactDate, now);
    if (daysSinceContact > 7) {
      score += 35;
      reasons.push(`No contact in ${Math.floor(daysSinceContact)} days`);
    } else if (daysSinceContact > 3) {
      score += 25;
      reasons.push(`Last contact ${Math.floor(daysSinceContact)} days ago`);
    } else if (daysSinceContact > 1) {
      score += 5;
    }
  }

  // 3. Stage duration (time stuck)
  const daysSinceModified = daysBetween(item.lastModified, now);
  if (daysSinceModified > 7) {
    score += 20;
    reasons.push(`Stuck in "${item.stage}" for ${Math.floor(daysSinceModified)} days`);
  } else if (daysSinceModified > 3) {
    score += 10;
    reasons.push(`In "${item.stage}" for ${Math.floor(daysSinceModified)} days`);
  }

  // 4. Deal value (higher value = higher priority)
  if (item.amount && item.amount > 10000) {
    score += 10;
    reasons.push("High-value service ($" + item.amount.toLocaleString() + ")");
  } else if (item.amount && item.amount > 5000) {
    score += 5;
  }

  // 5. Stage-specific urgency
  const urgentStages = ["Inspection", "Invoicing"];
  const activeStages = ["Site Visit Scheduling", "Work In Progress"];
  if (urgentStages.includes(item.stage)) {
    score += 5;
  }
  if (activeStages.includes(item.stage) && daysSinceModified > 5) {
    score += 10;
    reasons.push(`"${item.stage}" overdue`);
  }

  // Cap at 100
  score = Math.min(100, score);

  // Default reason if none triggered
  if (reasons.length === 0) {
    reasons.push("On track");
  }

  return {
    item,
    score,
    tier: tierFromScore(score),
    reasons,
  };
}

/**
 * Build a complete priority queue from deals (and later tickets).
 * Applies manual overrides from the database.
 */
export function buildPriorityQueue(
  items: PriorityItem[],
  overrides: Array<{ itemId: string; itemType: string; overridePriority: PriorityTier }> = [],
  now: Date = new Date()
): PriorityScore[] {
  const overrideMap = new Map(overrides.map(o => [`${o.itemType}:${o.itemId}`, o.overridePriority]));

  const scored = items.map(item => {
    const result = scorePriorityItem(item, now);
    const overrideKey = `${item.type}:${item.id}`;
    const override = overrideMap.get(overrideKey);

    if (override) {
      const overrideScore = override === "critical" ? 90 : override === "high" ? 65 : override === "medium" ? 35 : 10;
      return {
        ...result,
        tier: override,
        score: overrideScore,
        overridden: true,
        reasons: [`Manually set to ${override}`, ...result.reasons],
      };
    }

    return result;
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/service-priority.test.ts --no-cache`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/service-priority.ts src/__tests__/lib/service-priority.test.ts
git commit -m "feat(service): add priority scoring engine with tests"
```

---

### Task 12: Create Priority Queue Cache Listener — `service-priority-cache.ts`

**Files:**
- Create: `src/lib/service-priority-cache.ts`

- [ ] **Step 1: Create the singleton cache cascade listener**

Create `src/lib/service-priority-cache.ts`:

```typescript
/**
 * Singleton cache cascade listener for the service priority queue.
 *
 * Watches upstream cache keys (deals:service, and later service-tickets:*)
 * and debounces invalidation of the priority queue cache key.
 *
 * IMPORTANT: This module is imported once at the app level (e.g., in the
 * priority queue API route's module scope). The listener is process-local
 * and long-lived — it must NOT be created inside a request handler.
 */

import { appCache } from "@/lib/cache";

const QUEUE_CACHE_KEY = "service:priority-queue";
const DEBOUNCE_MS = 500;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

/**
 * Initialize the cascade listener. Safe to call multiple times —
 * only registers the listener once.
 */
export function initPriorityQueueCascade(): void {
  if (initialized) return;
  initialized = true;

  // CacheListener signature is (key: string, timestamp: number) => void
  appCache.subscribe((key: string, _timestamp: number) => {
    // Phase 1: watch deals:service
    // Phase 2: will add service-tickets:* prefix check
    const isUpstream = key.startsWith("deals:service");

    if (!isUpstream) return;

    // Debounce: multiple upstream invalidations within 500ms
    // trigger a single queue rebuild
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      // INTENTIONAL: Calling appCache.invalidate from within a subscriber
      // is safe — it notifies SSE listeners watching "service:priority-queue"
      // which is how the client gets real-time updates. This does NOT cause
      // an infinite loop because QUEUE_CACHE_KEY !== "deals:service".
      appCache.invalidate(QUEUE_CACHE_KEY);
      debounceTimer = null;
    }, DEBOUNCE_MS);
  });
}

export { QUEUE_CACHE_KEY };
```

- [ ] **Step 2: Add priority queue cache key to CACHE_KEYS**

In `src/lib/cache.ts`, add to the `CACHE_KEYS` object:

```typescript
SERVICE_PRIORITY_QUEUE: "service:priority-queue",
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/service-priority-cache.ts src/lib/cache.ts
git commit -m "feat(service): add singleton cache cascade listener for priority queue"
```

---

### Task 13: Create Priority Queue API Route

**Files:**
- Create: `src/app/api/service/priority-queue/route.ts`

- [ ] **Step 1: Create the priority queue GET endpoint**

Create `src/app/api/service/priority-queue/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { buildPriorityQueue, type PriorityItem, type PriorityTier } from "@/lib/service-priority";
import { initPriorityQueueCascade, QUEUE_CACHE_KEY } from "@/lib/service-priority-cache";
import { PIPELINE_IDS, STAGE_MAPS, ACTIVE_STAGES } from "@/lib/deals-pipeline";
import { hubspotClient } from "@/lib/hubspot";

// Initialize cascade listener at module scope (singleton, process-local)
initPriorityQueueCascade();

async function fetchServiceDeals(): Promise<PriorityItem[]> {
  const pipelineId = PIPELINE_IDS.service;
  const stageMap = STAGE_MAPS.service;
  const activeStageNames = new Set(ACTIVE_STAGES.service);

  const properties = [
    "hs_object_id", "dealname", "amount", "dealstage", "pipeline",
    "closedate", "createdate", "hs_lastmodifieddate",
    "pb_location", "hubspot_owner_id", "notes_last_contacted",
  ];

  const activeStageIds = Object.entries(stageMap)
    .filter(([, name]) => activeStageNames.has(name))
    .map(([id]) => id);

  const searchRequest = {
    filterGroups: [{
      filters: [
        { propertyName: "pipeline", operator: "EQ" as const, value: pipelineId },
        { propertyName: "dealstage", operator: "IN" as const, values: activeStageIds },
      ],
    }],
    properties,
    limit: 100,
  };

  try {
    const response = await hubspotClient.crm.deals.searchApi.doSearch(searchRequest);
    const deals = response.results || [];

    return deals.map(deal => ({
      id: deal.properties.hs_object_id || deal.id,
      type: "deal" as const,
      title: deal.properties.dealname || "Untitled Deal",
      stage: stageMap[deal.properties.dealstage] || deal.properties.dealstage || "Unknown",
      lastModified: deal.properties.hs_lastmodifieddate || deal.properties.createdate || new Date().toISOString(),
      lastContactDate: deal.properties.notes_last_contacted || null,
      createDate: deal.properties.createdate || new Date().toISOString(),
      amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
      location: deal.properties.pb_location || null,
      url: `https://app.hubspot.com/contacts/${process.env.HUBSPOT_PORTAL_ID || ""}/deal/${deal.id}`,
    }));
  } catch (error) {
    console.error("[PriorityQueue] Error fetching service deals:", error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const location = searchParams.get("location");
    const forceRefresh = searchParams.get("refresh") === "true";

    // Fetch with cache (bypass debounce on manual refresh)
    const { data, lastUpdated } = await appCache.getOrFetch(
      QUEUE_CACHE_KEY,
      async () => {
        const deals = await fetchServiceDeals();

        // Fetch overrides from DB
        const overrides = prisma
          ? await prisma.servicePriorityOverride.findMany({
              where: {
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            })
          : [];

        const queue = buildPriorityQueue(
          deals,
          overrides.map(o => ({
            itemId: o.itemId,
            itemType: o.itemType,
            overridePriority: o.overridePriority as PriorityTier,
          }))
        );

        return { queue, fetchedAt: new Date().toISOString() };
      },
      forceRefresh
    );

    let queue = data.queue;

    // Apply location filter
    if (location && location !== "all") {
      queue = queue.filter(item => item.item.location === location);
    }

    // Compute stats
    const stats = {
      total: queue.length,
      critical: queue.filter(i => i.tier === "critical").length,
      high: queue.filter(i => i.tier === "high").length,
      medium: queue.filter(i => i.tier === "medium").length,
      low: queue.filter(i => i.tier === "low").length,
    };

    // Get unique locations for filter
    const locations = [...new Set(
      data.queue
        .map(i => i.item.location)
        .filter((l): l is string => !!l)
    )].sort();

    return NextResponse.json({
      queue,
      stats,
      locations,
      lastUpdated,
    });
  } catch (error) {
    console.error("[PriorityQueue] Error:", error);
    return NextResponse.json({ error: "Failed to load priority queue" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/service/priority-queue/route.ts
git commit -m "feat(service): add priority queue API endpoint"
```

---

### Task 14: Create Priority Override API Routes

**Files:**
- Create: `src/app/api/service/priority-queue/overrides/route.ts`
- Create: `src/app/api/service/priority-queue/overrides/[itemType]/[itemId]/route.ts`

- [ ] **Step 1: Create POST override route**

Create `src/app/api/service/priority-queue/overrides/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { QUEUE_CACHE_KEY } from "@/lib/service-priority-cache";

const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
const VALID_TYPES = ["deal", "ticket"];

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const body = await request.json();
    const { itemId, itemType, priority, reason, expiresAt } = body;

    if (!itemId || !itemType || !priority) {
      return NextResponse.json({ error: "itemId, itemType, and priority are required" }, { status: 400 });
    }

    if (!VALID_TYPES.includes(itemType)) {
      return NextResponse.json({ error: `itemType must be: ${VALID_TYPES.join(", ")}` }, { status: 400 });
    }

    if (!VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: `priority must be: ${VALID_PRIORITIES.join(", ")}` }, { status: 400 });
    }

    const override = await prisma.servicePriorityOverride.upsert({
      where: { itemId_itemType: { itemId, itemType } },
      update: {
        overridePriority: priority,
        setBy: session.user.email,
        reason: reason || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      create: {
        itemId,
        itemType,
        overridePriority: priority,
        setBy: session.user.email,
        reason: reason || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    // Invalidate priority queue cache (bypasses debounce — user action)
    appCache.invalidate(QUEUE_CACHE_KEY);

    return NextResponse.json({ success: true, override });
  } catch (error) {
    console.error("[PriorityOverride] Error:", error);
    return NextResponse.json({ error: "Failed to set override" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create DELETE override route**

Create `src/app/api/service/priority-queue/overrides/[itemType]/[itemId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { QUEUE_CACHE_KEY } from "@/lib/service-priority-cache";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ itemType: string; itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const { itemType, itemId } = await params;

    await prisma.servicePriorityOverride.delete({
      where: { itemId_itemType: { itemId, itemType } },
    }).catch(() => {
      // Not found is OK — idempotent delete
    });

    appCache.invalidate(QUEUE_CACHE_KEY);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PriorityOverride] Error:", error);
    return NextResponse.json({ error: "Failed to remove override" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/app/api/service/priority-queue/overrides/
git commit -m "feat(service): add priority override create/delete API routes"
```

---

### Task 15: Create Service Overview Dashboard Page

**Files:**
- Create: `src/app/dashboards/service-overview/page.tsx`

- [ ] **Step 1: Create the Service Overview dashboard page**

Create `src/app/dashboards/service-overview/page.tsx`. This is the largest new file — the priority queue command center. Key structure:

1. Fetch from `/api/service/priority-queue` with React Query
2. Use `useSSE` with `cacheKeyFilter: "service:priority-queue"` for real-time updates
3. Wrap in `DashboardShell` with `accentColor="cyan"`
4. Layout: KPI strip (4 StatCards) → Priority Queue list → Bottom bar (today's schedule + location filter)

The page should:
- Use `useState` for location filter and priority tier filter
- Call `GET /api/service/priority-queue?location=X` on filter change
- Show each queue item with colored left border based on tier
- Show item type badge ("Deal" or "Ticket")
- Show reasons from the scoring engine
- Allow clicking the priority badge to set a manual override (calls POST to overrides API)
- Include a "Refresh" button that calls with `?refresh=true`

Reference `src/app/dashboards/service/page.tsx` for the existing service dashboard patterns (data fetching, DashboardShell usage, filter UI). Reference the mockup in the spec for the visual layout.

The dashboard should use:
- `StatCard` for the 4 KPI metrics
- Theme tokens: `bg-surface`, `text-foreground`, `text-muted`, `border-t-border`
- Priority tier colors: Critical=red, High=orange, Medium=yellow, Low=zinc
- `stagger-grid` CSS class on the KPI strip grid

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/service-overview/page.tsx
git commit -m "feat(service): add Service Overview priority queue dashboard"
```

---

## Chunk 3: Roofing Pipeline + Scheduler

### Task 16: Create Roofing Pipeline Dashboard

**Files:**
- Create: `src/app/dashboards/roofing/page.tsx`

- [ ] **Step 1: Clone D&R Pipeline page for Roofing**

Copy `src/app/dashboards/dnr/page.tsx` to `src/app/dashboards/roofing/page.tsx`.

Make these changes:
1. Update the `useProgressiveDeals` call: `params: { pipeline: "roofing" }` — match whatever the D&R page passes for its pipeline param (check if `active` param is used and replicate the same pattern)
2. Update `DashboardShell` props:
   - `title` → `"Roofing Pipeline"`
   - `accentColor` → `"purple"` (keep same as D&R)
3. Update stage references: Replace D&R stage names with roofing stages from `STAGE_MAPS.roofing`:
   - On Hold, Color Selection, Material & Labor Order, Confirm Dates, Staged, Production, Post Production, Invoice/Collections, Job Close Out Paperwork, Job Completed
4. Update active stages filter to use `ACTIVE_STAGES.roofing`
5. Update the `STAGE_GROUPS` constant (or equivalent grouping array) — define new stage groupings appropriate for roofing (check D&R for the pattern)
6. Update `STAGE_COLORS` and `STAGE_SHORT_LABELS` constants to match roofing stage names. Each roofing stage needs a color and short label mapping.
7. Remove D&R-specific columns (like `detach_status`, `reset_status`) if present
8. Update any hardcoded labels from "D&R" to "Roofing"
9. Update the `trackDashboardView("dnr", ...)` call to `trackDashboardView("roofing", ...)`

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/roofing/page.tsx
git commit -m "feat(roofing): add Roofing Pipeline dashboard"
```

---

### Task 17: Create Roofing Scheduler Dashboard

**Files:**
- Create: `src/app/dashboards/roofing-scheduler/page.tsx`

- [ ] **Step 1: Clone D&R Scheduler for Roofing**

Copy `src/app/dashboards/dnr-scheduler/page.tsx` to `src/app/dashboards/roofing-scheduler/page.tsx`.

Make these changes:
1. Update `CATEGORY_UIDS` array to use roofing categories:
   ```typescript
   import { JOB_CATEGORY_UIDS } from "@/lib/zuper";

   const CATEGORY_UIDS = [
     JOB_CATEGORY_UIDS.WALK_ROOF,
     JOB_CATEGORY_UIDS.MID_ROOF_INSTALL,
     JOB_CATEGORY_UIDS.ROOF_FINAL,
   ];
   ```
2. Update `DashboardShell` props:
   - `title` → `"Roofing Scheduler"`
   - `accentColor` → `"purple"`
3. Update category display names and colors for roofing categories. The display names from `JOB_CATEGORY_NAMES` in `zuper.ts` are: `"Walk Roof"`, `"Mid Roof Install"`, `"Roof Final"`. Map each to a distinct color in the category color map.
4. Update the back link to `/suites/dnr-roofing`
5. Update any hardcoded "D&R" labels to "Roofing"
6. Update `trackDashboardView("dnr-scheduler", ...)` to `trackDashboardView("roofing-scheduler", ...)`
7. **Phase 1 is read-only calendar only.** The D&R scheduler is already read-only (no interactive scheduling actions). Verify no scheduling action buttons exist in the cloned file before committing. If any do exist, remove them. Do NOT add any interactive scheduling features.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/roofing-scheduler/page.tsx
git commit -m "feat(roofing): add Roofing Scheduler dashboard (read-only calendar)"
```

---

### Task 18: Final Verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No new errors

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: All tests pass (including new service-priority tests)

- [ ] **Step 4: Manual smoke test**

Start dev server and verify:
1. `/suites/service` → shows Service Overview link + existing service dashboards
2. `/suites/dnr-roofing` → shows D&R + Roofing dashboards
3. `/dashboards/service-overview` → loads priority queue with service deals
4. Location filter on overview works
5. Priority override (click to set priority) persists on refresh
6. `/dashboards/roofing` → loads roofing pipeline deals from HubSpot
7. Roofing Pipeline displays correct roofing stage names (On Hold, Color Selection, etc.) — NOT residual D&R stage names
8. `/dashboards/roofing-scheduler` → shows roofing Zuper jobs on calendar
9. Roofing Scheduler has NO scheduling action buttons (slot-finding, assisted scheduling) — read-only calendar only
10. All existing service/D&R dashboards still work
11. Suite switcher shows both suites
12. Breadcrumbs navigate correctly

- [ ] **Step 5: Commit any final fixes**

Review staged files before committing — use specific file paths, not `git add -A`:

```bash
git status
# Stage only the specific files that were fixed:
git add <specific-files-that-changed>
git commit -m "chore: phase 1 verification fixes"
```
