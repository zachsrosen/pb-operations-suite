# Service Suite Enrichment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared server-side enrichment layer so all service suite pages show richer deal/ticket data — including contact-level last activity, service type, line items, and Zuper jobs.

**Architecture:** A new `lib/service-enrichment.ts` module provides batch enrichment that API routes call once per request. Each route merges enrichment into its existing response shape. A Zuper cache sync fills the missing job data. The priority queue scoring engine is updated to use contact-level timestamps and emit reason categories.

**Tech Stack:** Next.js 16.1, TypeScript 5, HubSpot CRM API (deals/tickets/contacts/line-items), Zuper REST API, Prisma/Neon Postgres, React 19

**Spec:** `docs/superpowers/specs/2026-03-26-service-suite-enrichment-design.md`

---

## Chunk 1: Foundation — Types, Schema Migration, and Enrichment Core

### Task 1: Schema Migration — Add `completedDate` to ZuperJobCache

**Files:**
- Modify: `prisma/schema.prisma:379-410` (ZuperJobCache model)

- [ ] **Step 1: Add completedDate column to ZuperJobCache model**

In `prisma/schema.prisma`, add `completedDate` after the `scheduledEnd` field (line ~391):

```prisma
  scheduledEnd    DateTime?
  completedDate   DateTime?  // Populated when jobStatus is COMPLETED
```

- [ ] **Step 2: Generate and apply the migration**

```bash
npx prisma migrate dev --name add-zuper-completed-date
```

Expected: Migration creates `ALTER TABLE "ZuperJobCache" ADD COLUMN "completedDate" TIMESTAMP(3)`

- [ ] **Step 3: Update `cacheZuperJob` to accept `completedDate`**

In `src/lib/db.ts`, find the `cacheZuperJob` function (~line 531). Add `completedDate?: Date` to its parameter type and include it in both the `create` and `update` objects of the `upsert` call.

- [ ] **Step 4: Verify Prisma client regenerated**

```bash
npx prisma generate
```

Expected: No errors, `completedDate` available on `prisma.zuperJobCache`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "chore: add completedDate to ZuperJobCache schema"
```

---

### Task 2: Shared Enrichment Types

**Files:**
- Create: `src/lib/service-enrichment.ts`

- [ ] **Step 1: Write the type definitions and function signature**

Create `src/lib/service-enrichment.ts` with the canonical types from the spec. This file will hold both types and the enrichment function. Start with types only:

```typescript
import type { PriorityItem } from "@/lib/service-priority";

// ---------------------------------------------------------------------------
// Canonical enrichment types — shared across all service API routes
// ---------------------------------------------------------------------------

export interface ServiceEnrichment {
  serviceType: string | null;
  lastContactDate: string | null;
  lastContactSource: "contact" | "deal" | "ticket" | null;
  lineItems: ServiceLineItem[] | null;
  zuperJobs: ServiceZuperJob[] | null;
}

export interface ServiceLineItem {
  name: string;
  quantity: number;
  category: string | null;
  unitPrice: number | null;
}

export interface ServiceZuperJob {
  jobUid: string;
  title: string;
  category: string;
  status: string;
  assignedUsers: string[];
  scheduledDate: string | null;
  completedDate: string | null;
  zuperUrl: string;
}

export type ReasonCategory =
  | "no_contact"
  | "warranty_expiring"
  | "stuck_in_stage"
  | "high_value"
  | "stage_urgency";

export interface EnrichmentInput {
  itemId: string;
  itemType: "deal" | "ticket";
  contactIds: string[];
  /** Raw service_type from HubSpot (already fetched by the calling route) */
  serviceType?: string | null;
  /** For tickets: the ticket-level notes_last_contacted as fallback */
  ticketLastContacted?: string | null;
  /** For deals: the deal-level notes_last_contacted as fallback */
  dealLastContacted?: string | null;
}

export interface EnrichmentOptions {
  includeLineItems?: boolean;
  includeZuperJobs?: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/service-enrichment.ts
git commit -m "feat: add shared service enrichment types"
```

---

### Task 3: Enrichment Function — Contact-Level Last Activity

**Files:**
- Modify: `src/lib/service-enrichment.ts`
- Reference: `src/lib/hubspot.ts` (for `hubspotClient`, `searchWithRetry`)
- Reference: `src/lib/utils.ts:6` (for `chunk`)

- [ ] **Step 1: Write failing test for contact-level last activity resolution**

Create `src/__tests__/lib/service-enrichment.test.ts`:

```typescript
import { resolveLastContact } from "@/lib/service-enrichment";

describe("resolveLastContact", () => {
  it("returns contact-level timestamp when available", () => {
    const result = resolveLastContact(
      { "c1": "2026-03-20T00:00:00Z", "c2": "2026-03-25T00:00:00Z" },
      ["c1", "c2"],
      null // no deal-level fallback
    );
    expect(result).toEqual({
      lastContactDate: "2026-03-25T00:00:00Z",
      lastContactSource: "contact",
    });
  });

  it("falls back to deal-level when no contacts have timestamps", () => {
    const result = resolveLastContact(
      {},
      [],
      "2026-03-15T00:00:00Z"
    );
    expect(result).toEqual({
      lastContactDate: "2026-03-15T00:00:00Z",
      lastContactSource: "deal",
    });
  });

  it("falls back to ticket-level for ticket items", () => {
    const result = resolveLastContact(
      {},
      [],
      null,
      "2026-03-18T00:00:00Z"
    );
    expect(result).toEqual({
      lastContactDate: "2026-03-18T00:00:00Z",
      lastContactSource: "ticket",
    });
  });

  it("returns null when all sources empty", () => {
    const result = resolveLastContact({}, [], null);
    expect(result).toEqual({
      lastContactDate: null,
      lastContactSource: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=service-enrichment --verbose
```

Expected: FAIL — `resolveLastContact` not exported

- [ ] **Step 3: Implement resolveLastContact**

Add to `src/lib/service-enrichment.ts`:

```typescript
/**
 * Pure function: resolve the best "last contact" timestamp from available sources.
 * Priority: contact-level > deal-level > ticket-level > null
 */
export function resolveLastContact(
  contactTimestamps: Record<string, string | null | undefined>,
  contactIds: string[],
  dealFallback: string | null | undefined,
  ticketFallback?: string | null | undefined,
): { lastContactDate: string | null; lastContactSource: "contact" | "deal" | "ticket" | null } {
  // 1. Try contact-level timestamps — pick most recent
  let best: string | null = null;
  for (const cid of contactIds) {
    const ts = contactTimestamps[cid];
    if (ts && (!best || ts > best)) best = ts;
  }
  if (best) return { lastContactDate: best, lastContactSource: "contact" };

  // 2. Deal-level fallback
  if (dealFallback) return { lastContactDate: dealFallback, lastContactSource: "deal" };

  // 3. Ticket-level fallback
  if (ticketFallback) return { lastContactDate: ticketFallback, lastContactSource: "ticket" };

  return { lastContactDate: null, lastContactSource: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern=service-enrichment --verbose
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/service-enrichment.ts src/__tests__/lib/service-enrichment.test.ts
git commit -m "feat: implement resolveLastContact with contact>deal>ticket fallback"
```

---

### Task 4: Enrichment Function — Batch Orchestrator

**Files:**
- Modify: `src/lib/service-enrichment.ts`
- Reference: `src/lib/hubspot.ts` (hubspotClient for batch reads)
- Reference: `src/lib/db.ts:612` (getCachedZuperJobsByDealIds)
- Reference: `src/lib/utils.ts:6` (chunk)

- [ ] **Step 1: Write failing test for enrichServiceItems batch function**

Add to `src/__tests__/lib/service-enrichment.test.ts`:

```typescript
// Integration-style test — will mock HubSpot + Prisma
import { enrichServiceItems } from "@/lib/service-enrichment";

// Mock external deps at module level
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      contacts: { batchApi: { read: jest.fn() } },
      deals: { batchApi: { read: jest.fn() } },
      lineItems: { batchApi: { read: jest.fn() } },
    },
    apiRequest: jest.fn(),
  },
}));
jest.mock("@/lib/db", () => ({
  getCachedZuperJobsByDealIds: jest.fn().mockResolvedValue([]),
  prisma: null,
}));

describe("enrichServiceItems", () => {
  it("returns empty enrichment map for empty input", async () => {
    const result = await enrichServiceItems([]);
    expect(result.size).toBe(0);
  });

  it("returns null fields when all lookups fail gracefully", async () => {
    const result = await enrichServiceItems([
      { itemId: "deal-1", itemType: "deal", contactIds: [], serviceType: null, dealLastContacted: null },
    ]);
    const enrichment = result.get("deal-1");
    expect(enrichment).toBeDefined();
    expect(enrichment!.serviceType).toBeNull();
    expect(enrichment!.lastContactDate).toBeNull();
    expect(enrichment!.lineItems).toBeNull();
    expect(enrichment!.zuperJobs).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=service-enrichment --verbose
```

Expected: FAIL — `enrichServiceItems` not exported

- [ ] **Step 3: Implement enrichServiceItems**

Add to `src/lib/service-enrichment.ts`. This is the main batch orchestrator:

```typescript
import { hubspotClient } from "@/lib/hubspot";
import { getCachedZuperJobsByDealIds } from "@/lib/db";
import { chunk } from "@/lib/utils";

const ZUPER_APP_URL = "https://app.zuper.co/app/job";
const HUBSPOT_BATCH_LIMIT = 100;

/**
 * Batch-enrich service items with contact activity, line items, and Zuper jobs.
 * Each API route calls this once for its full result set. Failures are non-blocking.
 */
export async function enrichServiceItems(
  items: EnrichmentInput[],
  options: EnrichmentOptions = {},
): Promise<Map<string, ServiceEnrichment>> {
  const result = new Map<string, ServiceEnrichment>();
  if (items.length === 0) return result;

  const { includeLineItems = false, includeZuperJobs = false } = options;

  // Collect unique contact IDs and deal IDs for batch operations
  const allContactIds = [...new Set(items.flatMap(i => i.contactIds))];
  const dealItems = items.filter(i => i.itemType === "deal");
  const dealIds = dealItems.map(i => i.itemId);

  // 1. Batch-read contact timestamps
  const contactTimestamps: Record<string, string | null> = {};
  if (allContactIds.length > 0) {
    try {
      for (const batch of chunk(allContactIds, HUBSPOT_BATCH_LIMIT)) {
        const response = await hubspotClient.crm.contacts.batchApi.read({
          inputs: batch.map(id => ({ id })),
          properties: ["hs_last_sales_activity_timestamp"],
          propertiesWithHistory: [],
        });
        for (const contact of response.results || []) {
          contactTimestamps[contact.id] =
            contact.properties?.hs_last_sales_activity_timestamp || null;
        }
      }
    } catch (err) {
      console.warn("[ServiceEnrichment] Contact timestamp batch read failed:", err);
      // Non-blocking — contactTimestamps stays empty, will fall back per-item
    }
  }

  // 2. Batch-read line items (deals only)
  const dealLineItems = new Map<string, ServiceLineItem[]>();
  if (includeLineItems && dealIds.length > 0) {
    try {
      // Get deal→line-item associations (use SDK batchApi, same pattern as customer-resolver.ts)
      const lineItemIdsByDeal = new Map<string, string[]>();
      const allLineItemIds: string[] = [];
      for (const batch of chunk(dealIds, HUBSPOT_BATCH_LIMIT)) {
        const assocResponse = await hubspotClient.crm.associations.batchApi.read(
          "deals", "line_items",
          { inputs: batch.map(id => ({ id })) },
        );

        for (const r of assocResponse.results || []) {
          const fromId = r.from?.id;
          const ids = (r.to || []).map(t => t.id);
          if (fromId && ids.length > 0) {
            lineItemIdsByDeal.set(fromId, ids);
            allLineItemIds.push(...ids);
          }
        }
      }

        // Batch read line item properties
        if (allLineItemIds.length > 0) {
          const liProps = new Map<string, { name: string; qty: number; category: string | null; price: number | null }>();
          for (const liBatch of chunk(allLineItemIds, HUBSPOT_BATCH_LIMIT)) {
            const liResponse = await hubspotClient.crm.lineItems.batchApi.read({
              inputs: liBatch.map(id => ({ id })),
              properties: ["name", "quantity", "price", "hs_product_id", "description"],
              propertiesWithHistory: [],
            });
            for (const li of liResponse.results || []) {
              liProps.set(li.id, {
                name: li.properties?.name || li.properties?.description || "Unknown",
                qty: parseFloat(li.properties?.quantity || "1") || 1,
                category: null, // Could look up InternalProduct, but deferred for perf
                price: li.properties?.price ? parseFloat(li.properties.price) : null,
              });
            }
          }

          // Assemble per-deal line items
          for (const [dealId, liIds] of lineItemIdsByDeal) {
            const lineItemsForDeal: ServiceLineItem[] = [];
            for (const liId of liIds) {
              const p = liProps.get(liId);
              if (p) lineItemsForDeal.push({ name: p.name, quantity: p.qty, category: p.category, unitPrice: p.price });
            }
            if (lineItemsForDeal.length > 0) dealLineItems.set(dealId, lineItemsForDeal);
          }
        }
      }
    } catch (err) {
      console.warn("[ServiceEnrichment] Line item batch read failed:", err);
      // Non-blocking — dealLineItems stays empty
    }
  }

  // 3. Batch-read Zuper jobs
  const dealZuperJobs = new Map<string, ServiceZuperJob[]>();
  if (includeZuperJobs && dealIds.length > 0) {
    try {
      const cachedJobs = await getCachedZuperJobsByDealIds(dealIds);
      for (const j of cachedJobs) {
        const dealId = j.hubspotDealId;
        if (!dealId) continue;
        const job: ServiceZuperJob = {
          jobUid: j.jobUid,
          title: j.jobTitle || "Untitled Job",
          category: j.jobCategory || "Unknown",
          status: j.jobStatus || "Unknown",
          assignedUsers: Array.isArray(j.assignedUsers)
            ? (j.assignedUsers as Array<{ user_name?: string }>).map(u => u.user_name || "Unknown")
            : [],
          scheduledDate: j.scheduledStart?.toISOString() || null,
          completedDate: j.completedDate?.toISOString() ?? null,
          zuperUrl: `${ZUPER_APP_URL}/${j.jobUid}`,
        };
        const existing = dealZuperJobs.get(dealId) || [];
        existing.push(job);
        dealZuperJobs.set(dealId, existing);
      }
    } catch (err) {
      console.warn("[ServiceEnrichment] Zuper job cache lookup failed:", err);
    }
  }

  // 4. Assemble per-item enrichment
  for (const item of items) {
    const { lastContactDate, lastContactSource } = resolveLastContact(
      contactTimestamps,
      item.contactIds,
      item.dealLastContacted,
      item.ticketLastContacted,
    );

    result.set(item.itemId, {
      serviceType: item.serviceType || null,
      lastContactDate,
      lastContactSource,
      lineItems: dealLineItems.get(item.itemId) || null,
      zuperJobs: dealZuperJobs.get(item.itemId) || null,
    });
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=service-enrichment --verbose
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/service-enrichment.ts src/__tests__/lib/service-enrichment.test.ts
git commit -m "feat: implement enrichServiceItems batch orchestrator"
```

---

### Task 5: Reason Categories on Priority Scoring

**Files:**
- Modify: `src/lib/service-priority.ts:25-31` (PriorityScore interface)
- Modify: `src/lib/service-priority.ts:45-122` (scorePriorityItem function)
- Reference: `src/lib/service-enrichment.ts` (ReasonCategory type)

- [ ] **Step 1: Write failing test for reason categories**

Add to an existing or new test file `src/__tests__/lib/service-priority.test.ts`:

```typescript
import { scorePriorityItem, type PriorityItem } from "@/lib/service-priority";

describe("scorePriorityItem reason categories", () => {
  const now = new Date("2026-03-26T12:00:00Z");
  const baseItem: PriorityItem = {
    id: "1", type: "deal", title: "Test",
    stage: "Work In Progress", lastModified: "2026-03-26T12:00:00Z",
    createDate: "2026-03-20T00:00:00Z", amount: null,
    location: "Westminster", ownerId: null,
  };

  it("includes no_contact when lastContactDate is >7 days old", () => {
    const result = scorePriorityItem(
      { ...baseItem, lastContactDate: "2026-03-10T00:00:00Z" },
      now
    );
    expect(result.reasonCategories).toContain("no_contact");
  });

  it("includes warranty_expiring when warranty is within 30 days", () => {
    const result = scorePriorityItem(
      { ...baseItem, warrantyExpiry: "2026-04-10T00:00:00Z" },
      now
    );
    expect(result.reasonCategories).toContain("warranty_expiring");
  });

  it("includes stuck_in_stage when lastModified > 7 days", () => {
    const result = scorePriorityItem(
      { ...baseItem, lastModified: "2026-03-15T00:00:00Z" },
      now
    );
    expect(result.reasonCategories).toContain("stuck_in_stage");
  });

  it("includes high_value when amount > 10000", () => {
    const result = scorePriorityItem(
      { ...baseItem, amount: 15000 },
      now
    );
    expect(result.reasonCategories).toContain("high_value");
  });

  it("includes stage_urgency for Inspection stage", () => {
    const result = scorePriorityItem(
      { ...baseItem, stage: "Inspection" },
      now
    );
    expect(result.reasonCategories).toContain("stage_urgency");
  });

  it("returns empty array when no reasons triggered", () => {
    const result = scorePriorityItem(baseItem, now);
    expect(result.reasonCategories).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=service-priority --verbose
```

Expected: FAIL — `reasonCategories` not on PriorityScore

- [ ] **Step 3: Add reasonCategories to PriorityScore and scoring function**

In `src/lib/service-priority.ts`:

1. Import the type at the top:
```typescript
import type { ReasonCategory } from "@/lib/service-enrichment";
```

2. Add to `PriorityScore` interface (line ~25):
```typescript
export interface PriorityScore {
  item: PriorityItem;
  score: number;
  tier: PriorityTier;
  reasons: string[];
  reasonCategories: ReasonCategory[];
  overridden?: boolean;
}
```

3. In `scorePriorityItem` (line ~45), add a `reasonCategories` set and populate alongside each scoring branch:

```typescript
export function scorePriorityItem(item: PriorityItem, now: Date = new Date()): PriorityScore {
  let score = 0;
  const reasons: string[] = [];
  const categories = new Set<ReasonCategory>();

  // 1. Warranty expiry urgency
  if (item.warrantyExpiry) {
    const daysToExpiry = -daysBetween(item.warrantyExpiry, now);
    if (daysToExpiry <= 0) {
      score += 30;
      reasons.push("Warranty expired");
      categories.add("warranty_expiring");
    } else if (daysToExpiry <= 7) {
      score += 40;
      reasons.push(`Warranty expires in ${Math.ceil(daysToExpiry)} days`);
      categories.add("warranty_expiring");
    } else if (daysToExpiry <= 30) {
      score += 15;
      reasons.push(`Warranty expires in ${Math.ceil(daysToExpiry)} days`);
      categories.add("warranty_expiring");
    }
  }

  // 2. Last contact recency
  if (item.lastContactDate) {
    const daysSinceContact = daysBetween(item.lastContactDate, now);
    if (daysSinceContact > 7) {
      score += 35;
      reasons.push(`No contact in ${Math.floor(daysSinceContact)} days`);
      categories.add("no_contact");
    } else if (daysSinceContact > 3) {
      score += 25;
      reasons.push(`Last contact ${Math.floor(daysSinceContact)} days ago`);
      categories.add("no_contact");
    } else if (daysSinceContact > 1) {
      score += 5;
      categories.add("no_contact");
    }
  }

  // 3. Stage duration (time stuck)
  const daysSinceModified = daysBetween(item.lastModified, now);
  if (daysSinceModified > 7) {
    score += 20;
    reasons.push(`Stuck in "${item.stage}" for ${Math.floor(daysSinceModified)} days`);
    categories.add("stuck_in_stage");
  } else if (daysSinceModified > 3) {
    score += 10;
    reasons.push(`In "${item.stage}" for ${Math.floor(daysSinceModified)} days`);
    categories.add("stuck_in_stage");
  }

  // 4. Deal value
  if (item.amount && item.amount > 10000) {
    score += 10;
    reasons.push("High-value service ($" + item.amount.toLocaleString() + ")");
    categories.add("high_value");
  } else if (item.amount && item.amount > 5000) {
    score += 5;
    categories.add("high_value");
  }

  // 5. Stage-specific urgency
  const urgentStages = ["Inspection", "Invoicing"];
  const activeStages = ["Site Visit Scheduling", "Work In Progress"];
  if (urgentStages.includes(item.stage)) {
    score += 5;
    categories.add("stage_urgency");
  }
  if (activeStages.includes(item.stage) && daysSinceModified > 5) {
    score += 10;
    reasons.push(`"${item.stage}" overdue`);
    categories.add("stage_urgency");
  }

  score = Math.min(100, score);
  if (reasons.length === 0) reasons.push("On track");

  return {
    item, score, tier: tierFromScore(score), reasons,
    reasonCategories: [...categories],
  };
}
```

4. In `buildPriorityQueue` (line ~128), ensure `reasonCategories` is preserved on overridden items:
```typescript
if (override) {
  // ... existing override logic ...
  return {
    ...result,
    tier: override,
    score: overrideScore,
    overridden: true,
    reasons: [`Manually set to ${override}`, ...result.reasons],
    reasonCategories: result.reasonCategories, // preserve original categories
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=service-priority --verbose
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/service-priority.ts src/__tests__/lib/service-priority.test.ts
git commit -m "feat: add reasonCategories to priority scoring engine"
```

---

## Chunk 2: Zuper Cache Sync

### Task 6: Zuper Job Sync Function

**Files:**
- Create: `src/lib/zuper-sync.ts`
- Reference: `src/lib/zuper.ts:240` (ZuperClient class, `searchJobs` method at line ~1113)
- Reference: `src/lib/db.ts:531` (cacheZuperJob function)

- [ ] **Step 1: Create the sync function**

Create `src/lib/zuper-sync.ts`:

```typescript
import { zuper } from "@/lib/zuper";
import { cacheZuperJob } from "@/lib/db";

/**
 * Full sync of Zuper service jobs into ZuperJobCache.
 * Fetches all service-category jobs from Zuper API (paginated) and upserts into cache.
 * Returns count of synced jobs.
 */
export async function syncZuperServiceJobs(): Promise<{ synced: number; errors: number }> {
  if (!zuper.isConfigured()) {
    console.warn("[ZuperSync] Zuper not configured, skipping sync");
    return { synced: 0, errors: 0 };
  }

  let synced = 0;
  let errors = 0;
  let page = 1;

  try {
    // Paginate through all Zuper jobs (500 per page)
    // NOTE: filter to service job categories if Zuper supports category filtering;
    // verify actual category UIDs during implementation and pass as filter param.
    let hasMore = true;
    while (hasMore) {
      const result = await zuper.searchJobs({ limit: 500, page });
      if (result.type === "error") {
        console.error(`[ZuperSync] Failed to fetch jobs page ${page}:`, result.error);
        errors++;
        break;
      }

      const jobs = result.data?.jobs || [];
      const total = result.data?.total || 0;

      for (const job of jobs) {
        try {
          const jobUid = job.job_uid;
          if (!jobUid) continue;

          // Extract HubSpot deal ID from custom fields or tags
          const hubspotDealId = extractHubspotDealId(job);
          const category = typeof job.job_category === "string"
            ? job.job_category
            : job.job_category?.category_name || "Unknown";
          const status = job.current_job_status?.status_name
            || job.current_job_status
            || "Unknown";

          // Extract assigned users
          const assignedUsers = Array.isArray(job.assigned_to)
            ? job.assigned_to.map((u: Record<string, unknown>) => ({
                user_uid: String(u.user_uid || ""),
                user_name: String(u.first_name || "") + " " + String(u.last_name || ""),
              }))
            : [];

          // Extract customer address
          const addr = job.customer_address || job.job_location || {};
          const customerAddress = {
            street: String(addr.street || addr.line1 || ""),
            city: String(addr.city || ""),
            state: String(addr.state || ""),
            zip_code: String(addr.zip_code || addr.zipcode || ""),
          };

          // Determine completedDate
          const isCompleted = typeof status === "string" && status.toUpperCase().includes("COMPLETED");
          const completedDate = isCompleted && job.scheduled_end_time
            ? new Date(job.scheduled_end_time)
            : undefined;

          await cacheZuperJob({
            jobUid,
            jobTitle: job.job_title || "Untitled Job",
            jobCategory: category,
            jobStatus: typeof status === "string" ? status : "Unknown",
            jobPriority: job.priority,
            scheduledStart: job.scheduled_start_time ? new Date(job.scheduled_start_time) : undefined,
            scheduledEnd: job.scheduled_end_time ? new Date(job.scheduled_end_time) : undefined,
            completedDate,  // Pass directly — update cacheZuperJob to accept this in Task 1
            assignedUsers,
            assignedTeam: job.team_uid || undefined,
            customerAddress,
            hubspotDealId: hubspotDealId || undefined,
            projectName: job.job_title || undefined,
            jobTags: Array.isArray(job.tags) ? job.tags.map(String) : [],
            jobNotes: job.job_description || undefined,
            rawData: job,  // For debugging
          });

          synced++;
        } catch (err) {
          errors++;
          console.warn(`[ZuperSync] Failed to sync job ${job.job_uid}:`, err);
        }
      }

      // Check if more pages exist
      hasMore = (synced + errors) < total && jobs.length > 0;
      page++;
    }
  } catch (err) {
    console.error("[ZuperSync] Sync failed:", err);
    return { synced, errors: errors + 1 };
  }

  console.log(`[ZuperSync] Sync complete: ${synced} synced, ${errors} errors`);
  return { synced, errors };
}

/**
 * Extract HubSpot deal ID from Zuper job custom fields or tags.
 * Looks for common patterns: "DEAL-12345", custom field named "hubspot_deal_id", etc.
 */
function extractHubspotDealId(job: Record<string, unknown>): string | null {
  // Check custom fields
  const customFields = job.custom_fields as Array<{ label?: string; value?: string }> | undefined;
  if (Array.isArray(customFields)) {
    for (const cf of customFields) {
      if (cf.label?.toLowerCase().includes("hubspot") && cf.value) {
        return cf.value;
      }
      if (cf.label?.toLowerCase().includes("deal_id") && cf.value) {
        return cf.value;
      }
    }
  }

  // Check tags for deal ID patterns
  const tags = job.tags as string[] | undefined;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      // Match patterns like "hs:12345" or "deal:12345"
      const match = tag.match(/^(?:hs|deal|hubspot)[:\-_](\d+)$/i);
      if (match) return match[1];
    }
  }

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/zuper-sync.ts
git commit -m "feat: add Zuper service job cache sync function"
```

---

### Task 7: Zuper Sync API Endpoint

**Files:**
- Create: `src/app/api/zuper/sync-cache/route.ts`

- [ ] **Step 1: Add route to middleware allow-list**

In `src/middleware.ts`, add `"/api/zuper/sync-cache"` to the `MACHINE_TOKEN_ALLOWED_ROUTES` array so the middleware passes `API_SECRET_TOKEN` bearer auth through to the route handler.

- [ ] **Step 2: Create the cron-callable sync endpoint**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { syncZuperServiceJobs } from "@/lib/zuper-sync";

/**
 * POST /api/zuper/sync-cache
 * Triggers a full sync of Zuper jobs into ZuperJobCache.
 * Intended for cron (every 30 min) or on-demand trigger.
 * Protected by API_SECRET_TOKEN via middleware MACHINE_TOKEN_ALLOWED_ROUTES.
 */
export async function POST(request: NextRequest) {
  // Auth already validated by middleware (MACHINE_TOKEN_ALLOWED_ROUTES)
  const isAuthed = request.headers.get("x-api-token-authenticated") === "1";
  if (!isAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncZuperServiceJobs();
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[ZuperSync API] Sync failed:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/zuper/sync-cache/route.ts src/middleware.ts
git commit -m "feat: add /api/zuper/sync-cache endpoint for cron-driven job sync"
```

---

## Chunk 3: Priority Queue Route + Service Overview Frontend

### Task 8: Priority Queue API — Enrichment Integration

**Files:**
- Modify: `src/lib/service-priority.ts:8-21` (PriorityItem — add `serviceType`)
- Modify: `src/lib/service-enrichment.ts` (export `ALL_REASON_CATEGORIES` constant)
- Modify: `src/app/api/service/priority-queue/route.ts`

- [ ] **Step 1: Add `serviceType` to PriorityItem interface**

In `src/lib/service-priority.ts`, add to the `PriorityItem` interface:
```typescript
  serviceType?: string | null;
```

This avoids fragile type-punning — all routes can set it directly when building items.

- [ ] **Step 2: Export ALL_REASON_CATEGORIES from service-enrichment.ts**

Add to `src/lib/service-enrichment.ts`:
```typescript
export const ALL_REASON_CATEGORIES: ReasonCategory[] = [
  "no_contact", "warranty_expiring", "stuck_in_stage", "high_value", "stage_urgency",
];
```

- [ ] **Step 3: Update deal properties and mapping in priority-queue route**

In `src/app/api/service/priority-queue/route.ts`:

1. Add `"service_type"` to the `properties` array at line ~20:
```typescript
const properties = [
  "hs_object_id", "dealname", "amount", "dealstage", "pipeline",
  "closedate", "createdate", "hs_lastmodifieddate",
  "pb_location", "hubspot_owner_id", "notes_last_contacted",
  "service_type",
];
```

2. In the `fetchServiceDeals` loop (line ~51-65), map `serviceType` directly on the PriorityItem:
```typescript
serviceType: deal.properties.service_type || null,
```

3. Import enrichment at top:
```typescript
import { enrichServiceItems, type EnrichmentInput, ALL_REASON_CATEGORIES } from "@/lib/service-enrichment";
```

- [ ] **Step 4: Add enrichment INSIDE the cache callback**

All enrichment must happen inside the `appCache.getOrFetch()` callback so results are cached. After building `allItems` (line ~103):

```typescript
const allItems = [...deals, ...tickets];

// Resolve deal→contact associations for enrichment input
// Batch-read associations: deals → contacts
const dealIds = deals.map(d => d.id);
let dealContactMap = new Map<string, string[]>();
if (dealIds.length > 0) {
  try {
    for (const batch of chunk(dealIds, 100)) {
      const assocResponse = await hubspotClient.crm.associations.batchApi.read(
        "deals", "contacts",
        { inputs: batch.map(id => ({ id })) },
      );
      for (const r of assocResponse.results || []) {
        const contactIds = (r.to || []).map(t => t.id);
        if (r.from?.id) dealContactMap.set(r.from.id, contactIds);
      }
    }
  } catch {
    console.warn("[PriorityQueue] Contact association resolution failed, using deal-level fallback");
  }
}

const enrichInputs: EnrichmentInput[] = allItems.map(item => ({
  itemId: item.id,
  itemType: item.type,
  contactIds: dealContactMap.get(item.id) || [],
  serviceType: item.serviceType ?? null,
  dealLastContacted: item.type === "deal" ? item.lastContactDate || null : null,
  ticketLastContacted: item.type === "ticket" ? item.lastContactDate || null : null,
}));

const enrichments = await enrichServiceItems(enrichInputs);

// Override lastContactDate with enriched version (contact-level when available)
for (const item of allItems) {
  const enrichment = enrichments.get(item.id);
  if (enrichment?.lastContactDate) {
    item.lastContactDate = enrichment.lastContactDate;
  }
}
```

Then build the queue as before. The `enrichments` Map stays in scope for the response construction.

- [ ] **Step 5: Update response shape (still inside callback scope)**

Merge `serviceType`, `lastContactSource`, and `reasonCategories` into the cached queue items and response:

```typescript
return NextResponse.json({
  queue: queue.map(q => ({
    ...q,
    serviceType: enrichments.get(q.item.id)?.serviceType ?? null,
    lastContactSource: enrichments.get(q.item.id)?.lastContactSource ?? null,
  })),
  stats,
  locations,
  owners,
  reasonCategories: ALL_REASON_CATEGORIES,
  lastUpdated,
});
```

Note: per-item `reasonCategories` already comes from the updated `scorePriorityItem` in Task 5.

- [ ] **Step 6: Verify the build compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No type errors related to service-priority or priority-queue

- [ ] **Step 7: Commit**

```bash
git add src/lib/service-priority.ts src/lib/service-enrichment.ts src/app/api/service/priority-queue/route.ts
git commit -m "feat: integrate enrichment into priority queue API route"
```

---

### Task 9: Service Overview Frontend — Service Type + Reason Filter

**Files:**
- Modify: `src/app/dashboards/service-overview/page.tsx`

- [ ] **Step 1: Read the current page to identify exact insertion points**

Read `src/app/dashboards/service-overview/page.tsx` fully. Identify:
- The filter section (location, owner, tier filters)
- The table columns definition
- Where data is fetched and state is managed

- [ ] **Step 2: Update local TypeScript interfaces**

The page re-declares local types for the API response. Add to the local `PriorityScore` type:
```typescript
  reasonCategories?: string[];
  serviceType?: string | null;
  lastContactSource?: string | null;
```

And add to the `PriorityQueueResponse` type:
```typescript
  reasonCategories?: string[];
```

- [ ] **Step 3: Add reason category filter state and UI**

Add a new multi-select filter for reason categories alongside existing filters. Use `MultiSelectFilter` component (same pattern as location/owner filters):

```tsx
const [selectedReasons, setSelectedReasons] = useState<string[]>([]);

// In the filter bar:
<MultiSelectFilter
  label="Reason"
  options={(data?.reasonCategories || []).map((r: string) => ({
    value: r,
    label: r.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
  }))}
  selected={selectedReasons}
  onChange={setSelectedReasons}
/>
```

- [ ] **Step 4: Add service type column to the table**

Add a `serviceType` column between the existing "Stage" and "Last Contact" columns:

```tsx
<th>Service Type</th>
// ...
<td>
  {item.serviceType ? (
    <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-300">
      {item.serviceType}
    </span>
  ) : (
    <span className="text-muted text-xs">—</span>
  )}
</td>
```

- [ ] **Step 5: Add reason category client-side filtering as a third `useMemo`**

The page has two filtering stages: `preTierFiltered` (location + owner) and `filteredQueue` (tier). Add a third `useMemo` AFTER `filteredQueue`:

```typescript
const reasonFiltered = useMemo(() => {
  if (selectedReasons.length === 0) return filteredQueue;
  return filteredQueue.filter(entry =>
    entry.reasonCategories?.some((r: string) => selectedReasons.includes(r))
  );
}, [filteredQueue, selectedReasons]);
```

Then replace all `filteredQueue` references in the rendering section (the table rows and empty-state check) with `reasonFiltered`. **Do NOT** use `reasonFiltered` for the `tierCounts` computation — tier badge counts should remain unaffected by the reason filter.

- [ ] **Step 6: Verify the page renders correctly**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds with no errors

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/service-overview/page.tsx
git commit -m "feat: add service type column and reason category filter to service overview"
```

---

## Chunk 4: Customer History Enrichment

### Task 10: Customer History API — Enrichment Integration

**Files:**
- Modify: `src/lib/customer-resolver.ts:43-83` (ContactDeal, ContactTicket, ContactJob, ContactDetail interfaces)
- Modify: `src/app/api/service/customers/[contactId]/route.ts`

- [ ] **Step 1: Add `service_type` and `notes_last_contacted` to deal/ticket property fetches**

In `src/lib/customer-resolver.ts`, find the deal properties array in `resolveContactDetail()` (~line 438) and add `"service_type"` and `"notes_last_contacted"`. Do the same for the ticket properties array (~line 471).

- [ ] **Step 2: Extend ContactDeal, ContactTicket, ContactJob types**

In `src/lib/customer-resolver.ts`, add **optional** enrichment fields (optional so existing construction code still compiles):

```typescript
export interface ContactDeal {
  id: string;
  name: string;
  stage: string;
  pipeline: string;
  amount: string | null;
  location: string | null;
  closeDate: string | null;
  lastModified: string;
  // Enrichment fields (optional — populated after construction)
  serviceType?: string | null;
  lastContactDate?: string | null;
  daysInStage?: number | null;
  lineItems?: Array<{ name: string; quantity: number; category: string | null; unitPrice: number | null }> | null;
  hubspotUrl?: string | null;
}

export interface ContactTicket {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  createDate: string;
  lastModified: string;
  // Enrichment fields (optional — populated after construction)
  serviceType?: string | null;
  daysInStage?: number | null;
}

export interface ContactJob {
  uid: string;
  title: string;
  category: string | null;
  status: string | null;
  scheduledDate: string | null;
  createdAt: string | null;
  // Enrichment fields (optional — populated after construction)
  assignedUsers?: string[];
  completedDate?: string | null;
  zuperUrl?: string | null;
}
```

- [ ] **Step 3: Update resolveContactDetail to populate enrichment fields**

In `resolveContactDetail()`, after building deals/tickets/jobs arrays, call `enrichServiceItems()` and merge results:

```typescript
import { enrichServiceItems, type EnrichmentInput } from "@/lib/service-enrichment";

// After existing deal/ticket/job resolution...

// Enrich deals — pass raw service_type and notes_last_contacted from the HubSpot response
const dealEnrichInputs: EnrichmentInput[] = deals.map(d => ({
  itemId: d.id,
  itemType: "deal" as const,
  contactIds: [contactId],
  serviceType: rawDealProps.get(d.id)?.service_type ?? null,
  dealLastContacted: rawDealProps.get(d.id)?.notes_last_contacted ?? null,
}));
// NOTE: Build a rawDealProps Map<string, Record<string, string>> during the deal-building
// loop above, capturing the raw HubSpot properties before mapping to ContactDeal.

const dealEnrichments = await enrichServiceItems(dealEnrichInputs, {
  includeLineItems: true,
  includeZuperJobs: true,
});

for (const deal of deals) {
  const e = dealEnrichments.get(deal.id);
  deal.serviceType = e?.serviceType ?? null;
  deal.lastContactDate = e?.lastContactDate ?? null;
  deal.daysInStage = deal.lastModified
    ? Math.floor((Date.now() - new Date(deal.lastModified).getTime()) / 86400000)
    : null;
  deal.lineItems = e?.lineItems ?? null;
  deal.hubspotUrl = `https://app.hubspot.com/contacts/${process.env.HUBSPOT_PORTAL_ID || ""}/deal/${deal.id}`;
}

// Enrich tickets
const ticketEnrichInputs: EnrichmentInput[] = tickets.map(t => ({
  itemId: t.id,
  itemType: "ticket" as const,
  contactIds: [contactId],
  serviceType: rawTicketProps.get(t.id)?.service_type ?? null,
  ticketLastContacted: rawTicketProps.get(t.id)?.notes_last_contacted ?? null,
}));
const ticketEnrichments = await enrichServiceItems(ticketEnrichInputs);
for (const ticket of tickets) {
  const e = ticketEnrichments.get(ticket.id);
  ticket.serviceType = e?.serviceType ?? null;
  ticket.daysInStage = ticket.lastModified
    ? Math.floor((Date.now() - new Date(ticket.lastModified).getTime()) / 86400000)
    : null;
}

// Enrich jobs — populate from ZuperJobCache data directly during the job-building loop
// In the existing job-building loop (~line 504), read assignedUsers and completedDate
// from the ZuperJobCache query results:
for (const job of jobs) {
  job.zuperUrl = job.uid ? `https://app.zuper.co/app/job/${job.uid}` : null;
  // assignedUsers and completedDate should be populated from the cache query
  // during the job-building loop above, NOT in a separate pass.
}
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/customer-resolver.ts src/app/api/service/customers/
git commit -m "feat: enrich customer history with service type, line items, Zuper jobs"
```

---

### Task 11: Customer History Frontend — Rich Cards

**Files:**
- Modify: `src/app/dashboards/service-customers/page.tsx`

- [ ] **Step 1: Read the current detail panel rendering**

Read `src/app/dashboards/service-customers/page.tsx` fully. Identify the deals, tickets, and jobs sections in the detail slide-over.

- [ ] **Step 2: Enrich deal cards**

In the deals section of the detail panel, add:
- Service type badge (cyan, same style as overview)
- Days in stage indicator
- Line items summary (collapsed list)
- HubSpot link icon

- [ ] **Step 3: Enrich ticket cards**

In the tickets section, add:
- Service type badge
- Days in stage

- [ ] **Step 4: Enrich job cards**

In the jobs section, add:
- Assigned technicians list
- Completion status badge
- Zuper link icon

- [ ] **Step 5: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/service-customers/page.tsx
git commit -m "feat: enrich customer history deal/ticket/job cards with service type and details"
```

---

## Chunk 5: Service Tickets, Stream, and Backlog Rollout

### Task 12: Service Tickets — Add service_type to Properties

**Files:**
- Modify: `src/lib/hubspot-tickets.ts:84-95` (TICKET_PROPERTIES array)
- Modify: `src/lib/hubspot-tickets.ts:154-175` (transformTicketToPriorityItem)

- [ ] **Step 1: Add service_type to TICKET_PROPERTIES**

In `src/lib/hubspot-tickets.ts`, add `"service_type"` to the `TICKET_PROPERTIES` array (line ~95):

```typescript
const TICKET_PROPERTIES = [
  "hs_object_id",
  "subject",
  "content",
  "hs_pipeline",
  "hs_pipeline_stage",
  "hs_ticket_priority",
  "createdate",
  "hs_lastmodifieddate",
  "notes_last_contacted",
  "hubspot_owner_id",
  "service_type",
];
```

- [ ] **Step 2: Pass service_type through to EnrichedTicketItem**

The `EnrichedTicketItem` extends `PriorityItem`. Either add `serviceType` to `PriorityItem` (in `service-priority.ts`) or extend `EnrichedTicketItem`:

In `hubspot-tickets.ts`, extend the interface:
```typescript
export interface EnrichedTicketItem extends PriorityItem {
  priority: string | null;
  ownerId: string | null;
  serviceType: string | null;
}
```

In `transformTicketToPriorityItem` (line ~154), add:
```typescript
serviceType: props.service_type || null,
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/hubspot-tickets.ts
git commit -m "feat: add service_type to ticket properties and enriched ticket type"
```

---

### Task 13: Service Tickets Frontend — Service Type Badge

**Files:**
- Modify: `src/app/dashboards/service-tickets/page.tsx`

- [ ] **Step 1: Add service type badge to Kanban cards**

In the ticket card rendering, add a service type badge below the priority badge:

```tsx
{ticket.serviceType && (
  <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-300">
    {ticket.serviceType}
  </span>
)}
```

- [ ] **Step 2: Add service type to detail slide-over header**

In the ticket detail slide-over, add service type near the subject/stage area.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/service-tickets/page.tsx
git commit -m "feat: add service type badge to ticket kanban cards and detail slide-over"
```

---

### Task 14: Deals Stream — Add service_type for Service Pipeline

**Files:**
- Modify: `src/lib/deals-pipeline.ts:245-265` (DEAL_PROPERTIES array)
- Modify: `src/app/api/deals/stream/route.ts:78` (StreamedDeal type)
- Modify: `src/app/api/deals/stream/route.ts:123` (projectType mapping)

- [ ] **Step 1: Add service_type to DEAL_PROPERTIES**

In `src/lib/deals-pipeline.ts`, add `"service_type"` to `DEAL_PROPERTIES` (line ~265):

```typescript
export const DEAL_PROPERTIES = [
  // ... existing properties ...
  "deal_currency_code",
  "service_type",
  // D&R specific
  "detach_status",
  "reset_status",
];
```

- [ ] **Step 2: Add serviceType to streamed deal shape**

In `src/app/api/deals/stream/route.ts`, add `serviceType` to the deal interface (line ~78):

```typescript
serviceType: string | null;
```

And in the mapping function (near line ~123):
```typescript
serviceType: deal.service_type ? String(deal.service_type) : null,
```

- [ ] **Step 3: Update service pipeline page to prefer serviceType**

In `src/app/dashboards/service/page.tsx`, wherever `projectType` is displayed, check for `serviceType` first:

```tsx
{deal.serviceType || deal.projectType || "—"}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/deals-pipeline.ts src/app/api/deals/stream/route.ts src/app/dashboards/service/page.tsx
git commit -m "feat: add service_type to deal stream, display on service pipeline page"
```

---

### Task 15: Service Backlog — Line Item Resolution for Equipment Names

**Files:**
- Modify: `src/app/api/service/equipment/route.ts` (ServiceDeal interface + enrichment integration)

- [ ] **Step 1: Add `serviceType` to the ServiceDeal interface**

In `src/app/api/service/equipment/route.ts`, add to the `ServiceDeal` interface:
```typescript
serviceType?: string | null;
```

- [ ] **Step 2: Integrate enrichment for line item resolution**

In `src/app/api/service/equipment/route.ts`, after fetching and transforming deals:

```typescript
import { enrichServiceItems, type EnrichmentInput } from "@/lib/service-enrichment";

// After transforming deals...
const enrichInputs: EnrichmentInput[] = projects.map(p => ({
  itemId: p.id.toString(),
  itemType: "deal" as const,
  contactIds: [],
  serviceType: null,
  dealLastContacted: null,
}));

const enrichments = await enrichServiceItems(enrichInputs, {
  includeLineItems: true,
  includeZuperJobs: false,
});

// Category-to-equipment mapping for line items
const CATEGORY_EQUIPMENT_MAP: Record<string, "modules" | "inverter" | "battery"> = {
  MODULE: "modules",
  INVERTER: "inverter",
  BATTERY: "battery",
  BATTERY_EXPANSION: "battery",
};

// Override equipment names from line items
for (const project of projects) {
  const e = enrichments.get(project.id.toString());
  if (e?.lineItems && e.lineItems.length > 0) {
    for (const li of e.lineItems) {
      // Use category from enrichment (derived from InternalProduct) when available
      const equipKey = li.category ? CATEGORY_EQUIPMENT_MAP[li.category] : null;
      if (equipKey && project.equipment[equipKey] && !project.equipment[equipKey].productName) {
        project.equipment[equipKey].productName = li.name;
      } else if (!li.category) {
        // Fallback: use name as-is for the first empty equipment slot
        // This handles line items without InternalProduct category assignment
        const name = li.name.toLowerCase();
        if ((name.includes("module") || name.includes("panel")) && !project.equipment.modules.productName) {
          project.equipment.modules.productName = li.name;
        } else if (name.includes("inverter") && !project.equipment.inverter.productName) {
          project.equipment.inverter.productName = li.name;
        } else if ((name.includes("battery") || name.includes("powerwall")) && !project.equipment.battery.productName) {
          project.equipment.battery.productName = li.name;
        }
      }
    }
  }
  project.serviceType = e?.serviceType ?? null;
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/service/equipment/route.ts
git commit -m "feat: resolve equipment names from line items, fixing Unknown display"
```

---

## Chunk 6: Ticket Detail Enrichment + Verification

### Task 16: Ticket Detail Route — Enrich Associated Deals

**Files:**
- Modify: `src/lib/hubspot-tickets.ts` (TicketDetail associations type)
- Modify: `src/app/api/service/tickets/[id]/route.ts`

- [ ] **Step 1: Read the current ticket detail route and TicketDetail type**

Read `src/app/api/service/tickets/[id]/route.ts` and `src/lib/hubspot-tickets.ts` (TicketDetail interface). Note that associated deals are at `ticket.associations.deals`, typed as `{ id: string; name: string; amount: string | null; location: string | null; url: string }`.

- [ ] **Step 2: Extend TicketDetail deal association type**

In `src/lib/hubspot-tickets.ts`, extend the deal type within `TicketDetail.associations.deals` to include optional enrichment fields:
```typescript
// In TicketDetail interface, update deals type:
deals: Array<{
  id: string;
  name: string;
  amount: string | null;
  location: string | null;
  url: string;
  lineItems?: Array<{ name: string; quantity: number; category: string | null; unitPrice: number | null }> | null;
  serviceType?: string | null;
}>;
```

- [ ] **Step 3: Add line item enrichment for associated deals**

In `src/app/api/service/tickets/[id]/route.ts`, after calling `getTicketDetail(id)`:

```typescript
import { enrichServiceItems, type EnrichmentInput } from "@/lib/service-enrichment";

// After const ticket = await getTicketDetail(id);
const associatedDeals = ticket.associations.deals;
if (associatedDeals.length > 0) {
  // Use the ticket's own contact associations for contact-level enrichment
  const contactIds = ticket.associations.contacts?.map(c => c.id) || [];

  const enrichInputs: EnrichmentInput[] = associatedDeals.map(d => ({
    itemId: d.id,
    itemType: "deal" as const,
    contactIds,
    serviceType: null,
    dealLastContacted: null,
  }));

  const enrichments = await enrichServiceItems(enrichInputs, {
    includeLineItems: true,
    includeZuperJobs: false,
  });

  // Merge enrichment into associated deals
  for (const deal of associatedDeals) {
    const e = enrichments.get(deal.id);
    if (e) {
      deal.lineItems = e.lineItems ?? null;
      deal.serviceType = e.serviceType ?? null;
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/service/tickets/
git commit -m "feat: enrich ticket detail associated deals with line items and service type"
```

---

### Task 17: Build Verification and Type Check

**Files:** All modified files

- [ ] **Step 1: Run full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 2: Run all tests**

```bash
npm test -- --verbose 2>&1 | tail -30
```

Expected: All tests pass

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: No lint errors in modified files

- [ ] **Step 5: Final commit if any fixes were needed**

Stage only the specific files you modified, then commit:
```bash
git add <specific-files-that-were-fixed>
git commit -m "fix: address build/lint issues from service enrichment rollout"
```

---

### Task 18: HubSpot Property Verification

This is a manual/runtime verification task — must be done when the dev server can reach HubSpot.

- [ ] **Step 1: Verify service_type property exists on deals**

Create a temporary script or use the dev console:
```bash
curl -s "https://api.hubapi.com/crm/v3/properties/deals/service_type" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" | jq '.name, .type, .options'
```

If the property doesn't exist, note for manual creation in HubSpot.

- [ ] **Step 2: Verify hs_last_sales_activity_timestamp on service-deal contacts**

Sample ~20 contacts **associated with service pipeline deals** (not random contacts):
```bash
# First, get a few service deal IDs
curl -s "https://api.hubapi.com/crm/v3/objects/deals?properties=pipeline&limit=5&filterGroups=%5B%7B%22filters%22%3A%5B%7B%22propertyName%22%3A%22pipeline%22%2C%22operator%22%3A%22EQ%22%2C%22value%22%3A%2223928924%22%7D%5D%7D%5D" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" | jq '.results[].id'

# Then check associated contacts for hs_last_sales_activity_timestamp
# Use HubSpot associations API to get contact IDs from those deals, then batch-read contacts
```

If mostly null, update enrichment to use `notes_last_contacted` on the contact instead.

- [ ] **Step 3: Document findings**

Update spec or add comments in `service-enrichment.ts` noting which properties are/aren't available.
