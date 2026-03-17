# Customer History Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Customer History dashboard that lets service coordinators search customers and see all associated deals, tickets, and Zuper jobs in one place.

**Architecture:** Live aggregation from HubSpot (contacts + companies search, deal/ticket association resolution) + Prisma-backed Zuper job cache. Search returns grouped customer summaries; detail endpoint resolves full associations lazily. No new database models.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5, HubSpot API Client (`@hubspot/api-client`), Prisma (existing `ZuperJobCache` model), `appCache` (in-memory with stale-while-revalidate)

**Spec:** `docs/superpowers/specs/2026-03-17-customer-history-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/utils.ts` | Create | Shared `chunk<T>()` utility extracted from `hubspot-tickets.ts` |
| `src/lib/hubspot-tickets.ts` | Modify | Import `chunk` from utils instead of local definition |
| `src/lib/customer-resolver.ts` | Create | Customer search, identity grouping, expansion, association resolution |
| `src/__tests__/lib/customer-resolver.test.ts` | Create | Unit tests for normalizeAddress, displayName, grouping, expansion scoping |
| `src/app/api/service/customers/route.ts` | Create | Search endpoint (GET with `?q=`) |
| `src/app/api/service/customers/[groupKey]/route.ts` | Create | Detail endpoint (GET by groupKey) |
| `src/app/dashboards/service-customers/page.tsx` | Create | Dashboard page with search, card grid, slide-over detail panel |
| `src/lib/cache.ts` | Modify | Add `SERVICE_CUSTOMERS_SEARCH` and `SERVICE_CUSTOMER_DETAIL` key builders |
| `src/lib/query-keys.ts` | Modify | Add `serviceCustomers` domain with root/search/detail keys |
| `src/lib/page-directory.ts` | Modify | Add `/dashboards/service-customers` to `APP_PAGE_ROUTES` |
| `src/lib/role-permissions.ts` | Modify | Add `/dashboards/service-customers` to all service-capable roles |
| `src/app/suites/service/page.tsx` | Modify | Add Customer History card to landing page |

**Note:** `src/components/DashboardShell.tsx` already has the `SUITE_MAP` entry for `/dashboards/service-customers` → `/suites/service` (added in Phase 1). No change needed.

---

## Chunk 1: Shared Utilities, Types, and Cache/Query Keys

### Task 1: Extract `chunk()` to shared utility

**Files:**
- Create: `src/lib/utils.ts`
- Modify: `src/lib/hubspot-tickets.ts`
- Test: `src/__tests__/lib/utils.test.ts`

- [ ] **Step 1: Write the failing test for `chunk()`**

Create `src/__tests__/lib/utils.test.ts`:

```ts
import { chunk } from "@/lib/utils";

describe("chunk", () => {
  it("splits an array into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk when array is smaller than size", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("handles exact multiples", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/utils.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '@/lib/utils'`

- [ ] **Step 3: Create `src/lib/utils.ts` with `chunk()`**

```ts
/**
 * Shared utility functions.
 */

/** Split an array into groups of `size`. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/utils.test.ts --no-coverage`
Expected: PASS (4 tests)

- [ ] **Step 5: Update `hubspot-tickets.ts` to import shared `chunk`**

In `src/lib/hubspot-tickets.ts`, replace the local `chunk` function (lines 28-35):

Remove:
```ts
/** Chunk an array into groups of `size` */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
```

Add at the top of the file (after the existing imports):
```ts
import { chunk } from "@/lib/utils";
```

- [ ] **Step 6: Run existing ticket tests to verify no regression**

Run: `npx jest --no-coverage 2>&1 | head -50`
Expected: All existing tests pass. No test files reference the old `chunk` directly since it was a private function.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils.ts src/__tests__/lib/utils.test.ts src/lib/hubspot-tickets.ts
git commit -m "refactor: extract chunk() to shared utils module"
```

---

### Task 2: Add cache key builders and query keys

**Files:**
- Modify: `src/lib/cache.ts`
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add cache key builders to `cache.ts`**

In `src/lib/cache.ts`, add two entries to the `CACHE_KEYS` object (before the closing `} as const`):

```ts
  SERVICE_CUSTOMERS_SEARCH: (queryHash: string) => `service:customers:search:${queryHash}`,
  SERVICE_CUSTOMER_DETAIL: (groupKey: string) => `service:customers:detail:${groupKey}`,
```

The `CACHE_KEYS` object should now end with:

```ts
  SERVICE_PRIORITY_QUEUE: "service:priority-queue",
  SERVICE_TICKETS: "service-tickets:all",
  SERVICE_CUSTOMERS_SEARCH: (queryHash: string) => `service:customers:search:${queryHash}`,
  SERVICE_CUSTOMER_DETAIL: (groupKey: string) => `service:customers:detail:${groupKey}`,
} as const;
```

- [ ] **Step 2: Add query key domain to `query-keys.ts`**

In `src/lib/query-keys.ts`, add after the `serviceTickets` domain (before the closing `} as const`):

```ts
  serviceCustomers: {
    root: ["serviceCustomers"] as const,
    search: (query: string) =>
      [...queryKeys.serviceCustomers.root, "search", query] as const,
    detail: (groupKey: string) =>
      [...queryKeys.serviceCustomers.root, "detail", groupKey] as const,
  },
```

Also add a mapping in `cacheKeyToQueryKeys()` — add before the final `return []`:

```ts
  if (serverKey.startsWith("service:customers")) return [queryKeys.serviceCustomers.root];
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/cache.ts src/lib/query-keys.ts
git commit -m "feat: add customer history cache keys and query key domain"
```

---

### Task 3: Write `normalizeAddress()` with tests

**Files:**
- Create: `src/lib/customer-resolver.ts` (partial — types + normalizer only)
- Create: `src/__tests__/lib/customer-resolver.test.ts`

- [ ] **Step 1: Write failing tests for `normalizeAddress`**

Create `src/__tests__/lib/customer-resolver.test.ts`:

```ts
import { normalizeAddress, deriveDisplayName } from "@/lib/customer-resolver";

describe("normalizeAddress", () => {
  it("normalizes a standard address to lowercase street|zip format", () => {
    expect(normalizeAddress("123 Main St", "80202")).toBe("123 main street|80202");
  });

  it("expands common abbreviations", () => {
    expect(normalizeAddress("456 Oak Ave", "80301")).toBe("456 oak avenue|80301");
    expect(normalizeAddress("789 Pine Dr", "80401")).toBe("789 pine drive|80401");
    expect(normalizeAddress("100 Elm Blvd", "80501")).toBe("100 elm boulevard|80501");
    expect(normalizeAddress("200 Cedar Ln", "80601")).toBe("200 cedar lane|80601");
    expect(normalizeAddress("300 Birch Ct", "80701")).toBe("300 birch court|80701");
    expect(normalizeAddress("400 Maple Rd", "80801")).toBe("400 maple road|80801");
  });

  it("normalizes directionals", () => {
    expect(normalizeAddress("123 N Main St", "80202")).toBe("123 north main street|80202");
    expect(normalizeAddress("456 S Oak Ave", "80301")).toBe("456 south oak avenue|80301");
    expect(normalizeAddress("789 E Pine Dr", "80401")).toBe("789 east pine drive|80401");
    expect(normalizeAddress("100 W Elm Blvd", "80501")).toBe("100 west elm boulevard|80501");
  });

  it("strips periods and extra whitespace", () => {
    expect(normalizeAddress("123 Main St.", "80202")).toBe("123 main street|80202");
    expect(normalizeAddress("  456   Oak   Ave  ", "80301")).toBe("456 oak avenue|80301");
  });

  it("takes only first 5 digits of zip", () => {
    expect(normalizeAddress("123 Main St", "80202-1234")).toBe("123 main street|80202");
  });

  it("returns null for missing street", () => {
    expect(normalizeAddress("", "80202")).toBeNull();
    expect(normalizeAddress(null as unknown as string, "80202")).toBeNull();
  });

  it("returns null for missing zip", () => {
    expect(normalizeAddress("123 Main St", "")).toBeNull();
    expect(normalizeAddress("123 Main St", null as unknown as string)).toBeNull();
  });
});

describe("deriveDisplayName", () => {
  it("uses company name when present", () => {
    expect(deriveDisplayName("Acme Solar LLC", [], "123 Main St")).toBe("Acme Solar LLC");
  });

  it("skips generic company names", () => {
    expect(deriveDisplayName("Unknown Company", [{ lastName: "Smith" }], "123 Main St"))
      .toBe("Smith Residence");
  });

  it("skips empty company name", () => {
    expect(deriveDisplayName("", [{ lastName: "Jones" }], "456 Oak Ave"))
      .toBe("Jones Residence");
  });

  it("uses first contact's last name when no company", () => {
    expect(deriveDisplayName(null, [{ lastName: "Garcia" }, { lastName: "Lopez" }], "789 Pine Dr"))
      .toBe("Garcia Residence");
  });

  it("falls back to address when no company or last name", () => {
    expect(deriveDisplayName(null, [{ lastName: null }, { lastName: "" }], "789 Pine Dr"))
      .toBe("789 Pine Dr");
  });

  it("falls back to address when contacts array is empty", () => {
    expect(deriveDisplayName(null, [], "789 Pine Dr")).toBe("789 Pine Dr");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/customer-resolver.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '@/lib/customer-resolver'`

- [ ] **Step 3: Create `customer-resolver.ts` with types + normalizer**

Create `src/lib/customer-resolver.ts`:

```ts
/**
 * Customer Resolver Module
 *
 * Searches HubSpot contacts + companies, groups by canonical identity
 * (Company ID + normalized address), expands via company associations,
 * and resolves deal/ticket/Zuper job associations for detail view.
 *
 * Spec: docs/superpowers/specs/2026-03-17-customer-history-design.md
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 100;
const MAX_SEARCH_RESULTS = 25;

/** Company names to treat as empty/generic */
const GENERIC_COMPANY_NAMES = new Set([
  "unknown company",
  "unknown",
  "n/a",
  "na",
  "none",
  "test",
  "test company",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomerContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface CustomerSummary {
  groupKey: string;
  displayName: string;
  address: string;
  contactIds: string[];
  companyId: string | null;
  dealCount: number;
  ticketCount: number;
  jobCount: number;
}

export interface CustomerDeal {
  id: string;
  name: string;
  stage: string;
  pipeline: string;
  amount: string | null;
  location: string | null;
  closeDate: string | null;
  lastModified: string;
}

export interface CustomerTicket {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  createDate: string;
  lastModified: string;
}

export interface CustomerJob {
  uid: string;
  title: string;
  category: string | null;
  status: string | null;
  scheduledDate: string | null;
  createdAt: string | null;
}

export interface CustomerDetail extends CustomerSummary {
  contacts: CustomerContact[];
  deals: CustomerDeal[];
  tickets: CustomerTicket[];
  jobs: CustomerJob[];
}

export interface SearchResult {
  results: CustomerSummary[];
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Address Normalization
// ---------------------------------------------------------------------------

/** Street suffix abbreviation → full form */
const SUFFIX_MAP: Record<string, string> = {
  st: "street",
  ave: "avenue",
  dr: "drive",
  blvd: "boulevard",
  ln: "lane",
  ct: "court",
  rd: "road",
  pl: "place",
  cir: "circle",
  way: "way",
  pkwy: "parkway",
  trl: "trail",
};

/** Directional abbreviation → full form */
const DIRECTIONAL_MAP: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

/**
 * Normalize a street address + zip into a canonical grouping key.
 * Returns `"{normalized_street}|{zip5}"` or null if inputs are missing.
 */
export function normalizeAddress(street: string | null | undefined, zip: string | null | undefined): string | null {
  if (!street || !zip) return null;

  const trimmedStreet = street.trim();
  const trimmedZip = zip.trim();
  if (!trimmedStreet || !trimmedZip) return null;

  // Take first 5 digits of zip
  const zip5 = trimmedZip.replace(/[^0-9]/g, "").slice(0, 5);
  if (zip5.length < 5) return null;

  // Lowercase, strip periods, collapse whitespace
  let normalized = trimmedStreet
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Expand directionals (must come before suffixes to avoid "n" matching inside words)
  // Only expand standalone tokens that are directionals
  normalized = normalized
    .split(" ")
    .map((token) => {
      // Check directionals
      if (DIRECTIONAL_MAP[token]) return DIRECTIONAL_MAP[token];
      // Check suffixes
      if (SUFFIX_MAP[token]) return SUFFIX_MAP[token];
      return token;
    })
    .join(" ");

  return `${normalized}|${zip5}`;
}

// ---------------------------------------------------------------------------
// Display Name
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable display name for a customer group.
 * 1. Company name (if present and not generic)
 * 2. "{LastName} Residence" from first contact with a last name
 * 3. Formatted address as fallback
 */
export function deriveDisplayName(
  companyName: string | null | undefined,
  contacts: Array<{ lastName: string | null | undefined }>,
  address: string
): string {
  if (companyName && !GENERIC_COMPANY_NAMES.has(companyName.toLowerCase().trim())) {
    return companyName.trim();
  }

  for (const c of contacts) {
    if (c.lastName && c.lastName.trim()) {
      return `${c.lastName.trim()} Residence`;
    }
  }

  return address;
}

// ---------------------------------------------------------------------------
// Retry Wrappers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Search contacts with rate-limit retry.
 * Mirrors searchTicketsWithRetry() in hubspot-tickets.ts.
 */
export async function searchContactsWithRetry(
  searchRequest: Parameters<typeof hubspotClient.crm.contacts.searchApi.doSearch>[0],
  maxRetries = 5
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await hubspotClient.crm.contacts.searchApi.doSearch(searchRequest);
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const base = Math.pow(2, attempt) * 1100;
        const jitter = Math.random() * 400;
        await sleep(Math.round(base + jitter));
        continue;
      }
      Sentry.addBreadcrumb({
        category: "customer-resolver",
        message: "Contact search failed after retries",
        level: "error",
        data: { attempt, statusCode },
      });
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Search companies with rate-limit retry.
 * Mirrors searchTicketsWithRetry() in hubspot-tickets.ts.
 */
export async function searchCompaniesWithRetry(
  searchRequest: Parameters<typeof hubspotClient.crm.companies.searchApi.doSearch>[0],
  maxRetries = 5
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await hubspotClient.crm.companies.searchApi.doSearch(searchRequest);
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const base = Math.pow(2, attempt) * 1100;
        const jitter = Math.random() * 400;
        await sleep(Math.round(base + jitter));
        continue;
      }
      Sentry.addBreadcrumb({
        category: "customer-resolver",
        message: "Company search failed after retries",
        level: "error",
        data: { attempt, statusCode },
      });
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

// ---------------------------------------------------------------------------
// Phase 1: Multi-Entity Search
// ---------------------------------------------------------------------------
// (Implemented in Task 4)

// ---------------------------------------------------------------------------
// Phase 2: Identity Grouping + Expansion
// ---------------------------------------------------------------------------
// (Implemented in Task 5)

// ---------------------------------------------------------------------------
// Phase 3: Association Resolution (Detail only)
// ---------------------------------------------------------------------------
// (Implemented in Task 6)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/customer-resolver.test.ts --no-coverage`
Expected: PASS — all `normalizeAddress` and `deriveDisplayName` tests pass

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (imports for `hubspotClient`, `chunk`, `Sentry`, and `getCachedZuperJobsByDealIds` are added later in Tasks 4-6 when the consuming code is written)

- [ ] **Step 6: Commit**

```bash
git add src/lib/customer-resolver.ts src/__tests__/lib/customer-resolver.test.ts
git commit -m "feat: add customer resolver types, normalizeAddress, and deriveDisplayName"
```

---

## Chunk 2: Customer Resolver — Search, Grouping, and Resolution

### Task 4: Implement Phase 1 — Multi-entity search

**Files:**
- Modify: `src/lib/customer-resolver.ts`
- Modify: `src/__tests__/lib/customer-resolver.test.ts`

- [ ] **Step 1: Write failing test for `searchCustomers` Phase 1**

The search functions call the HubSpot API, which can't be unit-tested without mocking the client. Instead, test the grouping logic that processes raw search results. **Update the imports** at the top of `src/__tests__/lib/customer-resolver.test.ts` (merge with existing imports — do not replace the file):

```ts
import {
  normalizeAddress,
  deriveDisplayName,
  groupSearchHits,
  type RawSearchHit,
} from "@/lib/customer-resolver";

describe("groupSearchHits", () => {
  it("groups contacts by company + normalized address", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Acme Solar",
        firstName: "John",
        lastName: "Smith",
        email: "john@example.com",
        phone: "555-1234",
      },
      {
        type: "contact",
        id: "c2",
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Acme Solar",
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        phone: "555-5678",
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe("company:comp1:123 main street|80202");
    expect(groups[0].contactIds).toEqual(["c1", "c2"]);
    expect(groups[0].displayName).toBe("Acme Solar");
  });

  it("separates multi-site company into distinct groups", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Big Corp",
        firstName: "Alice",
        lastName: "A",
        email: null,
        phone: null,
      },
      {
        type: "contact",
        id: "c2",
        companyId: "comp1",
        street: "456 Oak Ave",
        zip: "80301",
        companyName: "Big Corp",
        firstName: "Bob",
        lastName: "B",
        email: null,
        phone: null,
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.groupKey).sort()).toEqual([
      "company:comp1:123 main street|80202",
      "company:comp1:456 oak avenue|80301",
    ]);
  });

  it("creates address-only group when no company", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: null,
        street: "789 Pine Dr",
        zip: "80401",
        companyName: null,
        firstName: "Charlie",
        lastName: "Brown",
        email: "charlie@example.com",
        phone: null,
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe("addr:789 pine drive|80401");
    expect(groups[0].companyId).toBeNull();
    expect(groups[0].displayName).toBe("Brown Residence");
  });

  it("deduplicates contacts appearing in both contact and company search", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Acme Solar",
        firstName: "John",
        lastName: "Smith",
        email: "john@example.com",
        phone: null,
      },
      {
        type: "company",
        id: "c1", // same contact surfaced through company search
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Acme Solar",
        firstName: "John",
        lastName: "Smith",
        email: "john@example.com",
        phone: null,
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(1);
    expect(groups[0].contactIds).toEqual(["c1"]); // not duplicated
  });

  it("skips hits with no resolvable address", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: "comp1",
        street: "",
        zip: "",
        companyName: "No Address Corp",
        firstName: "Dan",
        lastName: "D",
        email: null,
        phone: null,
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/customer-resolver.test.ts --no-coverage`
Expected: FAIL — `groupSearchHits` is not exported

- [ ] **Step 3: Implement `groupSearchHits` and `RawSearchHit`**

First, add the imports needed by Phase 1 at the top of `src/lib/customer-resolver.ts` (after the module comment):

```ts
import * as Sentry from "@sentry/nextjs";
import { hubspotClient } from "@/lib/hubspot";
import { chunk } from "@/lib/utils";
```

Then add the Phase 1 code (replacing the Phase 1 placeholder comment):

```ts
// ---------------------------------------------------------------------------
// Phase 1: Multi-Entity Search
// ---------------------------------------------------------------------------

/** Intermediate type — a single contact record from either contact or company search */
export interface RawSearchHit {
  type: "contact" | "company";
  id: string;          // contact ID
  companyId: string | null;
  street: string | null;
  zip: string | null;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Group raw search hits by canonical identity: Company ID + normalized address.
 * Deduplicates contacts by ID. Skips hits with no resolvable address.
 * Returns CustomerSummary[] with counts set to -1 (resolved lazily on detail).
 */
export function groupSearchHits(hits: RawSearchHit[]): CustomerSummary[] {
  // Deduplicate by contact ID
  const seen = new Set<string>();
  const unique: RawSearchHit[] = [];
  for (const hit of hits) {
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      unique.push(hit);
    }
  }

  // Group by canonical key
  const groups = new Map<string, {
    companyId: string | null;
    companyName: string | null;
    address: string;  // formatted display address (original casing)
    contactIds: string[];
    contacts: Array<{ lastName: string | null }>;
  }>();

  for (const hit of unique) {
    const normalizedAddr = normalizeAddress(hit.street, hit.zip);
    if (!normalizedAddr) continue;

    const groupKey = hit.companyId
      ? `company:${hit.companyId}:${normalizedAddr}`
      : `addr:${normalizedAddr}`;

    const existing = groups.get(groupKey);
    if (existing) {
      if (!existing.contactIds.includes(hit.id)) {
        existing.contactIds.push(hit.id);
        existing.contacts.push({ lastName: hit.lastName });
      }
    } else {
      // Build display address from original values
      const displayAddress = [hit.street, hit.zip].filter(Boolean).join(", ").trim();
      groups.set(groupKey, {
        companyId: hit.companyId,
        companyName: hit.companyName,
        address: displayAddress,
        contactIds: [hit.id],
        contacts: [{ lastName: hit.lastName }],
      });
    }
  }

  // Convert to CustomerSummary[]
  const results: CustomerSummary[] = [];
  for (const [groupKey, group] of groups) {
    results.push({
      groupKey,
      displayName: deriveDisplayName(group.companyName, group.contacts, group.address),
      address: group.address,
      contactIds: group.contactIds,
      companyId: group.companyId,
      dealCount: -1,
      ticketCount: -1,
      jobCount: -1,
    });
  }

  return results;
}

/**
 * Execute Phase 1: search both contacts and companies in HubSpot.
 * Returns raw hits + truncated flag.
 */
export async function executeSearch(query: string): Promise<{ hits: RawSearchHit[]; truncated: boolean }> {
  const hits: RawSearchHit[] = [];
  let truncated = false;

  // Search contacts and companies in parallel
  const [contactResults, companyResults] = await Promise.allSettled([
    searchContactsWithRetry({
      filterGroups: [{
        filters: [
          { propertyName: "firstname", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }, {
        filters: [
          { propertyName: "lastname", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }, {
        filters: [
          { propertyName: "email", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }, {
        filters: [
          { propertyName: "phone", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }],
      properties: ["firstname", "lastname", "email", "phone", "address", "city", "state", "zip"],
      limit: MAX_SEARCH_RESULTS,
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }] as unknown as string[],
      after: "0",
    }),
    searchCompaniesWithRetry({
      filterGroups: [{
        filters: [
          { propertyName: "name", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }, {
        filters: [
          { propertyName: "address", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }],
      properties: ["name", "address", "city", "state", "zip"],
      limit: MAX_SEARCH_RESULTS,
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }] as unknown as string[],
      after: "0",
    }),
  ]);

  // Process contact results
  if (contactResults.status === "fulfilled") {
    const res = contactResults.value;
    if (res.paging?.next?.after) truncated = true;

    for (const c of res.results || []) {
      // Resolve company association for each contact
      // This is done in Phase 2 expansion, not here — just capture contact-level data
      hits.push({
        type: "contact",
        id: c.id,
        companyId: null, // resolved in Phase 2
        street: c.properties?.address || null,
        zip: c.properties?.zip || null,
        companyName: null, // resolved in Phase 2
        firstName: c.properties?.firstname || null,
        lastName: c.properties?.lastname || null,
        email: c.properties?.email || null,
        phone: c.properties?.phone || null,
      });
    }
  } else {
    Sentry.captureException(contactResults.reason);
    console.error("[CustomerResolver] Contact search failed:", contactResults.reason);
  }

  // Process company results — need to resolve company → contacts
  if (companyResults.status === "fulfilled") {
    const res = companyResults.value;
    if (res.paging?.next?.after) truncated = true;

    // Batch-fetch contacts for each matched company
    const companyIds = res.results?.map(c => c.id) || [];
    if (companyIds.length > 0) {
      try {
        const companyContactMap = await resolveCompanyContacts(companyIds);

        for (const company of res.results || []) {
          const contactIds = companyContactMap.get(company.id) || [];
          // Batch-read contact properties
          if (contactIds.length > 0) {
            for (const batch of chunk(contactIds, BATCH_SIZE)) {
              const batchResp = await hubspotClient.crm.contacts.batchApi.read({
                inputs: batch.map(id => ({ id })),
                properties: ["firstname", "lastname", "email", "phone", "address", "zip"],
                propertiesWithHistory: [],
              });
              for (const contact of batchResp.results || []) {
                hits.push({
                  type: "company",
                  id: contact.id,
                  companyId: company.id,
                  street: contact.properties?.address || company.properties?.address || null,
                  zip: contact.properties?.zip || company.properties?.zip || null,
                  companyName: company.properties?.name || null,
                  firstName: contact.properties?.firstname || null,
                  lastName: contact.properties?.lastname || null,
                  email: contact.properties?.email || null,
                  phone: contact.properties?.phone || null,
                });
              }
            }
          }
        }
      } catch (err) {
        Sentry.captureException(err);
        console.error("[CustomerResolver] Company contact resolution failed:", err);
      }
    }
  } else {
    Sentry.captureException(companyResults.reason);
    console.error("[CustomerResolver] Company search failed:", companyResults.reason);
  }

  return { hits, truncated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/customer-resolver.test.ts --no-coverage`
Expected: PASS — all tests pass (groupSearchHits is pure, doesn't call HubSpot)

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/customer-resolver.ts src/__tests__/lib/customer-resolver.test.ts
git commit -m "feat: implement customer search Phase 1 — multi-entity search + grouping"
```

---

### Task 5: Implement Phase 2 — Company expansion with address scoping

**Files:**
- Modify: `src/lib/customer-resolver.ts`
- Modify: `src/__tests__/lib/customer-resolver.test.ts`

- [ ] **Step 1: Write failing test for expansion scoping**

**Update the imports** at the top of `src/__tests__/lib/customer-resolver.test.ts` to add `filterExpandedContactsByAddress`:

```ts
import {
  normalizeAddress,
  deriveDisplayName,
  groupSearchHits,
  filterExpandedContactsByAddress,
  type RawSearchHit,
} from "@/lib/customer-resolver";

describe("filterExpandedContactsByAddress", () => {
  it("keeps contacts whose address matches the group key", () => {
    const contacts = [
      { id: "c1", street: "123 Main St", zip: "80202" },
      { id: "c2", street: "456 Oak Ave", zip: "80301" },
      { id: "c3", street: "123 Main St.", zip: "80202-1234" }, // normalizes to same
    ];
    const groupNormalizedAddr = "123 main street|80202";

    const result = filterExpandedContactsByAddress(contacts, groupNormalizedAddr);
    expect(result.map(c => c.id)).toEqual(["c1", "c3"]);
  });

  it("returns empty array when no contacts match", () => {
    const contacts = [
      { id: "c1", street: "999 Other Rd", zip: "90210" },
    ];
    const result = filterExpandedContactsByAddress(contacts, "123 main street|80202");
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/customer-resolver.test.ts --no-coverage`
Expected: FAIL — `filterExpandedContactsByAddress` is not exported

- [ ] **Step 3: Implement `filterExpandedContactsByAddress` and `resolveCompanyContacts`**

Add to `src/lib/customer-resolver.ts` (replacing the Phase 2 placeholder):

```ts
// ---------------------------------------------------------------------------
// Phase 2: Identity Grouping + Expansion
// ---------------------------------------------------------------------------

/**
 * Resolve company → contact associations via batch API.
 * Returns Map<companyId, contactId[]>.
 */
async function resolveCompanyContacts(companyIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  for (const batch of chunk(companyIds, BATCH_SIZE)) {
    try {
      const resp = await hubspotClient.crm.associations.batchApi.read(
        "companies",
        "contacts",
        { inputs: batch.map(id => ({ id })) }
      );
      for (const result of resp.results || []) {
        const companyId = result._from?.id;
        if (!companyId) continue;
        const contactIds = (result.to || []).map((t: { id: string }) => t.id);
        map.set(companyId, contactIds);
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Company→contact association batch failed:", err);
    }
  }

  return map;
}

/**
 * Filter expanded contacts to only those whose resolved address matches
 * the group's normalized address key. This prevents multi-site companies
 * from over-merging unrelated properties.
 *
 * Address source precedence:
 * 1. Deal-derived: contact → deal → address_line_1 + postal_code (deferred to detail)
 * 2. Contact address: contact's own address + zip properties
 * At search time, we only have contact-level address (deal derivation is Phase 3).
 */
export function filterExpandedContactsByAddress(
  contacts: Array<{ id: string; street: string | null; zip: string | null }>,
  groupNormalizedAddr: string
): Array<{ id: string; street: string | null; zip: string | null }> {
  return contacts.filter(c => {
    const normalized = normalizeAddress(c.street, c.zip);
    return normalized === groupNormalizedAddr;
  });
}

/**
 * Expand customer groups by fetching all contacts for each company,
 * then filtering back to the matching address.
 * Mutates the groups array — adds new contactIds from expansion.
 */
export async function expandGroups(groups: CustomerSummary[]): Promise<void> {
  // Collect unique company IDs that need expansion
  const companyGroups = groups.filter(g => g.companyId);
  if (companyGroups.length === 0) return;

  const uniqueCompanyIds = [...new Set(companyGroups.map(g => g.companyId!))];
  const companyContactMap = await resolveCompanyContacts(uniqueCompanyIds);

  // For each company group, fetch expanded contacts and filter by address
  for (const group of companyGroups) {
    const allContactIds = companyContactMap.get(group.companyId!) || [];
    const newContactIds = allContactIds.filter(id => !group.contactIds.includes(id));

    if (newContactIds.length === 0) continue;

    // Batch-read contact properties to check addresses
    const matchedIds: string[] = [];
    for (const batch of chunk(newContactIds, BATCH_SIZE)) {
      try {
        const batchResp = await hubspotClient.crm.contacts.batchApi.read({
          inputs: batch.map(id => ({ id })),
          properties: ["firstname", "lastname", "email", "phone", "address", "zip"],
          propertiesWithHistory: [],
        });

        // Extract normalized address portion from groupKey
        const addrPart = group.groupKey.includes(":")
          ? group.groupKey.split(":").slice(2).join(":")
          : group.groupKey.replace("addr:", "");

        const filtered = filterExpandedContactsByAddress(
          (batchResp.results || []).map(c => ({
            id: c.id,
            street: c.properties?.address || null,
            zip: c.properties?.zip || null,
          })),
          addrPart
        );

        matchedIds.push(...filtered.map(c => c.id));
      } catch (err) {
        Sentry.captureException(err);
        console.error("[CustomerResolver] Expansion batch read failed:", err);
      }
    }

    // Add matched contacts to the group
    for (const id of matchedIds) {
      if (!group.contactIds.includes(id)) {
        group.contactIds.push(id);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/customer-resolver.test.ts --no-coverage`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/customer-resolver.ts src/__tests__/lib/customer-resolver.test.ts
git commit -m "feat: implement customer expansion Phase 2 — company contacts with address scoping"
```

---

### Task 6: Implement Phase 3 — Association resolution (detail)

**Files:**
- Modify: `src/lib/customer-resolver.ts`

- [ ] **Step 1: Implement `resolveCustomerDetail`**

First, add the Zuper import at the top of `src/lib/customer-resolver.ts` (after the existing imports):

```ts
import { getCachedZuperJobsByDealIds } from "@/lib/db";
```

Then add the Phase 3 code (replacing the Phase 3 placeholder):

```ts
// ---------------------------------------------------------------------------
// Phase 3: Association Resolution (Detail only)
// ---------------------------------------------------------------------------

/**
 * Resolve a single customer group's full detail:
 * contacts (with properties), deals, tickets, and Zuper jobs.
 *
 * This is the expensive path — only called by the detail endpoint.
 */
export async function resolveCustomerDetail(summary: CustomerSummary): Promise<CustomerDetail> {
  const contacts: CustomerContact[] = [];
  const dealIdSet = new Set<string>();
  const ticketIdSet = new Set<string>();

  // 1. Batch-read contact properties
  for (const batch of chunk(summary.contactIds, BATCH_SIZE)) {
    try {
      const batchResp = await hubspotClient.crm.contacts.batchApi.read({
        inputs: batch.map(id => ({ id })),
        properties: ["firstname", "lastname", "email", "phone"],
        propertiesWithHistory: [],
      });
      for (const c of batchResp.results || []) {
        contacts.push({
          id: c.id,
          firstName: c.properties?.firstname || null,
          lastName: c.properties?.lastname || null,
          email: c.properties?.email || null,
          phone: c.properties?.phone || null,
        });
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Contact batch read failed:", err);
    }
  }

  // 2. Resolve contact → deal associations
  for (const batch of chunk(summary.contactIds, BATCH_SIZE)) {
    try {
      const resp = await hubspotClient.crm.associations.batchApi.read(
        "contacts",
        "deals",
        { inputs: batch.map(id => ({ id })) }
      );
      for (const result of resp.results || []) {
        for (const to of (result.to || []) as Array<{ id: string }>) {
          dealIdSet.add(to.id);
        }
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Contact→deal association failed:", err);
    }
  }

  // 3. Resolve contact → ticket associations
  for (const batch of chunk(summary.contactIds, BATCH_SIZE)) {
    try {
      const resp = await hubspotClient.crm.associations.batchApi.read(
        "contacts",
        "tickets",
        { inputs: batch.map(id => ({ id })) }
      );
      for (const result of resp.results || []) {
        for (const to of (result.to || []) as Array<{ id: string }>) {
          ticketIdSet.add(to.id);
        }
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Contact→ticket association failed:", err);
    }
  }

  // 4. Batch-read deal properties
  const deals: CustomerDeal[] = [];
  const dealIds = Array.from(dealIdSet);
  for (const batch of chunk(dealIds, BATCH_SIZE)) {
    try {
      const batchResp = await hubspotClient.crm.deals.batchApi.read({
        inputs: batch.map(id => ({ id })),
        properties: [
          "dealname", "dealstage", "pipeline", "amount",
          "pb_location", "address_line_1", "closedate", "hs_lastmodifieddate",
        ],
        propertiesWithHistory: [],
      });
      for (const d of batchResp.results || []) {
        deals.push({
          id: d.id,
          name: d.properties?.dealname || "Untitled Deal",
          stage: d.properties?.dealstage || "unknown",
          pipeline: d.properties?.pipeline || "unknown",
          amount: d.properties?.amount || null,
          location: d.properties?.pb_location || null,
          closeDate: d.properties?.closedate || null,
          lastModified: d.properties?.hs_lastmodifieddate || "",
        });
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Deal batch read failed:", err);
    }
  }

  // Sort deals by lastModified descending
  deals.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  // 5. Batch-read ticket properties
  const tickets: CustomerTicket[] = [];
  const ticketIds = Array.from(ticketIdSet);
  for (const batch of chunk(ticketIds, BATCH_SIZE)) {
    try {
      const batchResp = await hubspotClient.crm.tickets.batchApi.read({
        inputs: batch.map(id => ({ id })),
        properties: [
          "subject", "hs_pipeline_stage", "hs_ticket_priority",
          "createdate", "hs_lastmodifieddate",
        ],
        propertiesWithHistory: [],
      });
      for (const t of batchResp.results || []) {
        tickets.push({
          id: t.id,
          subject: t.properties?.subject || "Untitled Ticket",
          status: t.properties?.hs_pipeline_stage || "unknown",
          priority: t.properties?.hs_ticket_priority || null,
          createDate: t.properties?.createdate || "",
          lastModified: t.properties?.hs_lastmodifieddate || "",
        });
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Ticket batch read failed:", err);
    }
  }

  // Sort tickets by lastModified descending
  tickets.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  // 6. Zuper jobs via Prisma cached lookup
  let jobs: CustomerJob[] = [];
  if (dealIds.length > 0) {
    try {
      const zuperJobs = await getCachedZuperJobsByDealIds(dealIds);
      jobs = (zuperJobs || []).map(j => ({
        uid: j.jobUid,
        title: j.jobTitle || "Untitled Job",
        category: j.jobCategory || null,
        status: j.jobStatus || null,
        scheduledDate: j.scheduledStart?.toISOString() || null,
        createdAt: j.lastSyncedAt?.toISOString() || null,
      }));

      // Sort by scheduledDate descending, fallback to createdAt
      jobs.sort((a, b) => {
        const dateA = a.scheduledDate || a.createdAt || "";
        const dateB = b.scheduledDate || b.createdAt || "";
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Zuper job lookup failed:", err);
    }
  }

  return {
    ...summary,
    dealCount: deals.length,
    ticketCount: tickets.length,
    jobCount: jobs.length,
    contacts,
    deals,
    tickets,
    jobs,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors. The `ZuperJobCache` model properties (`jobUid`, `jobTitle`, `jobCategory`, `jobStatus`, `scheduledStart`, `lastSyncedAt`) are accessed via the Prisma type.

- [ ] **Step 3: Run all tests**

Run: `npx jest --no-coverage 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/customer-resolver.ts
git commit -m "feat: implement customer detail Phase 3 — deal/ticket/Zuper association resolution"
```

---

### Task 7: Add top-level `searchCustomers` orchestrator

**Files:**
- Modify: `src/lib/customer-resolver.ts`

- [ ] **Step 1: Add `searchCustomers` function**

Add to the end of `src/lib/customer-resolver.ts`:

```ts
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search for customers by query string.
 * Runs Phase 1 (multi-entity search) + Phase 2 (grouping + expansion).
 * Returns CustomerSummary[] with counts = -1 (resolved lazily on detail).
 */
export async function searchCustomers(query: string): Promise<SearchResult> {
  // Phase 1: Multi-entity search
  const { hits, truncated } = await executeSearch(query);

  // Phase 2: Group + expand
  const groups = groupSearchHits(hits);

  // Expand company groups with all contacts at the same address
  await expandGroups(groups);

  // Cap at MAX_SEARCH_RESULTS groups
  const capped = groups.slice(0, MAX_SEARCH_RESULTS);

  return {
    results: capped,
    truncated: truncated || groups.length > MAX_SEARCH_RESULTS,
  };
}

/**
 * Parse and validate a groupKey string.
 * Returns the parsed components or null if invalid.
 */
export function parseGroupKey(groupKey: string): {
  type: "company" | "addr";
  companyId: string | null;
  normalizedAddress: string;
} | null {
  if (groupKey.startsWith("company:")) {
    const rest = groupKey.slice("company:".length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) return null;
    const companyId = rest.slice(0, colonIdx);
    const normalizedAddress = rest.slice(colonIdx + 1);
    if (!companyId || !normalizedAddress) return null;
    return { type: "company", companyId, normalizedAddress };
  }

  if (groupKey.startsWith("addr:")) {
    const normalizedAddress = groupKey.slice("addr:".length);
    if (!normalizedAddress) return null;
    return { type: "addr", companyId: null, normalizedAddress };
  }

  return null;
}
```

- [ ] **Step 2: Add test for `parseGroupKey`**

**Update the imports** at the top of `src/__tests__/lib/customer-resolver.test.ts` to add `parseGroupKey`:

```ts
import {
  normalizeAddress,
  deriveDisplayName,
  groupSearchHits,
  filterExpandedContactsByAddress,
  parseGroupKey,
  type RawSearchHit,
} from "@/lib/customer-resolver";

describe("parseGroupKey", () => {
  it("parses a company groupKey", () => {
    const result = parseGroupKey("company:12345:123 main street|80202");
    expect(result).toEqual({
      type: "company",
      companyId: "12345",
      normalizedAddress: "123 main street|80202",
    });
  });

  it("parses an address-only groupKey", () => {
    const result = parseGroupKey("addr:123 main street|80202");
    expect(result).toEqual({
      type: "addr",
      companyId: null,
      normalizedAddress: "123 main street|80202",
    });
  });

  it("returns null for invalid groupKey", () => {
    expect(parseGroupKey("invalid")).toBeNull();
    expect(parseGroupKey("company:")).toBeNull();
    expect(parseGroupKey("addr:")).toBeNull();
    expect(parseGroupKey("company:12345:")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx jest src/__tests__/lib/customer-resolver.test.ts --no-coverage`
Expected: PASS — all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/customer-resolver.ts src/__tests__/lib/customer-resolver.test.ts
git commit -m "feat: add searchCustomers orchestrator and parseGroupKey validator"
```

---

## Chunk 3: API Routes

### Task 8: Create search endpoint

**Files:**
- Create: `src/app/api/service/customers/route.ts`

- [ ] **Step 1: Create the search route**

Create `src/app/api/service/customers/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { searchCustomers } from "@/lib/customer-resolver";
import crypto from "crypto";

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
    const rawQuery = searchParams.get("q") || "";
    const query = rawQuery.trim().toLowerCase();

    if (query.length < 2) {
      return NextResponse.json(
        { error: "Query must be at least 2 characters" },
        { status: 400 }
      );
    }

    const forceRefresh = searchParams.get("refresh") === "true";

    // Hash the normalized query for cache key
    const queryHash = crypto.createHash("md5").update(query).digest("hex").slice(0, 12);
    const cacheKey = CACHE_KEYS.SERVICE_CUSTOMERS_SEARCH(queryHash);

    const { data, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      () => searchCustomers(query),
      forceRefresh
    );

    return NextResponse.json({
      results: data.results,
      query,
      truncated: data.truncated,
      lastUpdated,
    });
  } catch (error) {
    console.error("[CustomerSearch] Error:", error);
    return NextResponse.json(
      { error: "Failed to search customers" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/service/customers/route.ts
git commit -m "feat: add customer search API endpoint"
```

---

### Task 9: Create detail endpoint

**Files:**
- Create: `src/app/api/service/customers/[groupKey]/route.ts`

- [ ] **Step 1: Create the detail route**

First create the directory:
```bash
mkdir -p "src/app/api/service/customers/[groupKey]"
```

Create `src/app/api/service/customers/[groupKey]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  parseGroupKey,
  resolveCustomerDetail,
  type CustomerSummary,
} from "@/lib/customer-resolver";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupKey: string }> }
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

    const { groupKey: encodedGroupKey } = await params;
    const groupKey = decodeURIComponent(encodedGroupKey);

    // Validate groupKey shape
    const parsed = parseGroupKey(groupKey);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid groupKey format. Must start with 'company:' or 'addr:'" },
        { status: 400 }
      );
    }

    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "true";
    const cacheKey = CACHE_KEYS.SERVICE_CUSTOMER_DETAIL(groupKey);

    // Build a minimal CustomerSummary from the parsed groupKey
    // The detail resolver needs contactIds — these come from the search result
    // that the client already has, passed via query param
    const contactIdsParam = new URL(request.url).searchParams.get("contactIds") || "";
    const contactIds = contactIdsParam.split(",").filter(Boolean);

    if (contactIds.length === 0) {
      return NextResponse.json(
        { error: "contactIds query parameter required" },
        { status: 400 }
      );
    }

    const summary: CustomerSummary = {
      groupKey,
      displayName: "", // will be derived from detail
      address: "",
      contactIds,
      companyId: parsed.companyId,
      dealCount: -1,
      ticketCount: -1,
      jobCount: -1,
    };

    const { data: customer, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      () => resolveCustomerDetail(summary),
      forceRefresh
    );

    return NextResponse.json({
      customer,
      lastUpdated,
    });
  } catch (error) {
    console.error("[CustomerDetail] Error:", error);
    return NextResponse.json(
      { error: "Failed to load customer detail" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/service/customers/[groupKey]/route.ts"
git commit -m "feat: add customer detail API endpoint"
```

---

## Chunk 4: Dashboard Page and Wiring

### Task 10: Create the dashboard page

**Files:**
- Create: `src/app/dashboards/service-customers/page.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `src/app/dashboards/service-customers/page.tsx`:

```tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import type {
  CustomerSummary,
  CustomerDetail,
  CustomerContact,
} from "@/lib/customer-resolver";

// ---------------------------------------------------------------------------
// Types (client-side mirrors)
// ---------------------------------------------------------------------------

interface SearchResponse {
  results: CustomerSummary[];
  query: string;
  truncated: boolean;
  lastUpdated: string;
}

interface DetailResponse {
  customer: CustomerDetail;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

// NOTE: This page is a client component ("use client"), so env vars must use
// NEXT_PUBLIC_ prefix. Ensure NEXT_PUBLIC_HUBSPOT_PORTAL_ID is set in Vercel
// env config (mirrors the existing HUBSPOT_PORTAL_ID server-side var).
function hubspotDealUrl(dealId: string): string {
  return `https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || ""}/deal/${dealId}`;
}

function hubspotTicketUrl(ticketId: string): string {
  return `https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || ""}/ticket/${ticketId}`;
}

function hubspotContactUrl(contactId: string): string {
  return `https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || ""}/contact/${contactId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomerHistoryPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail panel state
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setResults([]);
      setTruncated(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/service/customers?q=${encodeURIComponent(value.trim())}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Search failed (${res.status})`);
        }
        const data: SearchResponse = await res.json();
        setResults(data.results);
        setTruncated(data.truncated);
        setLastUpdated(data.lastUpdated);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  // Fetch detail when a customer card is clicked
  const handleSelectCustomer = useCallback(async (customer: CustomerSummary) => {
    setSelectedCustomer(customer);
    setDetail(null);
    setDetailLoading(true);

    try {
      const groupKeyEncoded = encodeURIComponent(customer.groupKey);
      const contactIds = customer.contactIds.join(",");
      const res = await fetch(
        `/api/service/customers/${groupKeyEncoded}?contactIds=${contactIds}`
      );
      if (!res.ok) throw new Error("Failed to load customer detail");
      const data: DetailResponse = await res.json();
      setDetail(data.customer);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Close slide-over on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedCustomer(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <DashboardShell
      title="Customer History"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      fullWidth
    >
      {/* Search Bar */}
      <div className="max-w-2xl mx-auto mb-8">
        <div className="relative">
          <input
            type="text"
            placeholder="Search by customer name, email, phone, or address..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full px-4 py-3 bg-surface border border-t-border rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-cyan-500" />
            </div>
          )}
        </div>
        {query.trim().length >= 2 && !loading && (
          <p className="text-sm text-muted mt-2">
            {results.length} result{results.length !== 1 ? "s" : ""}
            {truncated && " (more results available — try a more specific search)"}
          </p>
        )}
      </div>

      {/* Error State */}
      {error && <ErrorState message={error} />}

      {/* Empty State */}
      {!loading && !error && results.length === 0 && (
        <div className="text-center text-muted py-16">
          {query.trim().length < 2
            ? "Search by customer name, email, phone, or address"
            : `No customers found for "${query}"`}
        </div>
      )}

      {/* Customer Cards Grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-grid">
          {results.map((customer) => (
            <button
              key={customer.groupKey}
              onClick={() => handleSelectCustomer(customer)}
              className={`text-left p-4 bg-surface rounded-lg border transition-all hover:shadow-lg ${
                selectedCustomer?.groupKey === customer.groupKey
                  ? "border-cyan-500 shadow-cyan-500/20"
                  : "border-t-border hover:border-cyan-500/50"
              }`}
            >
              <h3 className="font-semibold text-foreground truncate">
                {customer.displayName}
              </h3>
              <p className="text-sm text-muted mt-1 truncate">{customer.address}</p>
              <p className="text-xs text-muted mt-2">
                {customer.contactIds.length} contact{customer.contactIds.length !== 1 ? "s" : ""}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Slide-Over Detail Panel */}
      {selectedCustomer && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelectedCustomer(null)}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-surface border-l border-t-border shadow-2xl z-50 overflow-y-auto">
            {/* Panel Header */}
            <div className="sticky top-0 bg-surface border-b border-t-border p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold text-foreground truncate">
                {selectedCustomer.displayName}
              </h2>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="text-muted hover:text-foreground p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-6">
              {detailLoading ? (
                <div className="flex justify-center py-12">
                  <LoadingSpinner />
                </div>
              ) : detail ? (
                <>
                  {/* Contacts */}
                  <section>
                    <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                      Contacts ({detail.contacts.length})
                    </h3>
                    <div className="space-y-2">
                      {detail.contacts.map((c: CustomerContact) => (
                        <a
                          key={c.id}
                          href={hubspotContactUrl(c.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-2 rounded bg-surface-2 hover:bg-surface-2/80 transition-colors"
                        >
                          <span className="text-foreground font-medium">
                            {[c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown"}
                          </span>
                          {c.email && (
                            <span className="text-sm text-muted ml-2">{c.email}</span>
                          )}
                          {c.phone && (
                            <span className="text-sm text-muted ml-2">{c.phone}</span>
                          )}
                        </a>
                      ))}
                    </div>
                  </section>

                  {/* Three-Column Grid: Deals | Tickets | Jobs */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Deals */}
                    <section>
                      <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                        Deals ({detail.deals.length})
                      </h3>
                      {detail.deals.length === 0 ? (
                        <p className="text-sm text-muted italic">None found</p>
                      ) : (
                        <div className="space-y-2">
                          {detail.deals.map((d) => (
                            <a
                              key={d.id}
                              href={hubspotDealUrl(d.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block p-2 rounded bg-surface-2 hover:bg-surface-2/80 transition-colors"
                            >
                              <p className="text-sm font-medium text-foreground truncate">
                                {d.name}
                              </p>
                              <p className="text-xs text-muted">
                                {d.stage} · {d.location || "No location"}
                              </p>
                              <p className="text-xs text-muted">
                                {formatDate(d.closeDate)}
                                {d.amount && ` · $${Number(d.amount).toLocaleString()}`}
                              </p>
                            </a>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Tickets */}
                    <section>
                      <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                        Tickets ({detail.tickets.length})
                      </h3>
                      {detail.tickets.length === 0 ? (
                        <p className="text-sm text-muted italic">None found</p>
                      ) : (
                        <div className="space-y-2">
                          {detail.tickets.map((t) => (
                            <a
                              key={t.id}
                              href={hubspotTicketUrl(t.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block p-2 rounded bg-surface-2 hover:bg-surface-2/80 transition-colors"
                            >
                              <p className="text-sm font-medium text-foreground truncate">
                                {t.subject}
                              </p>
                              <p className="text-xs text-muted">
                                {t.status}
                                {t.priority && ` · ${t.priority}`}
                              </p>
                              <p className="text-xs text-muted">
                                {formatDate(t.createDate)}
                              </p>
                            </a>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Zuper Jobs */}
                    <section>
                      <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                        Jobs ({detail.jobs.length})
                      </h3>
                      {detail.jobs.length === 0 ? (
                        <p className="text-sm text-muted italic">None found</p>
                      ) : (
                        <div className="space-y-2">
                          {detail.jobs.map((j) => (
                            <div
                              key={j.uid}
                              className="p-2 rounded bg-surface-2"
                            >
                              <p className="text-sm font-medium text-foreground truncate">
                                {j.title}
                              </p>
                              <p className="text-xs text-muted">
                                {j.category || "No category"}
                                {j.status && ` · ${j.status}`}
                              </p>
                              <p className="text-xs text-muted">
                                {formatDate(j.scheduledDate)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </>
              ) : (
                <ErrorState message="Failed to load customer detail" />
              )}
            </div>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/service-customers/page.tsx
git commit -m "feat: add Customer History dashboard page with search and slide-over detail"
```

---

### Task 11: Wire up routes, permissions, and landing page

**Files:**
- Modify: `src/lib/page-directory.ts`
- Modify: `src/lib/role-permissions.ts`
- Modify: `src/app/suites/service/page.tsx`

- [ ] **Step 1: Add route to page directory**

In `src/lib/page-directory.ts`, add `/dashboards/service-customers` to the `APP_PAGE_ROUTES` array. Place it after the existing service routes (after `/dashboards/service-tickets`):

```ts
  "/dashboards/service-customers",
```

- [ ] **Step 2: Add permissions for all service-capable roles**

In `src/lib/role-permissions.ts`, add `"/dashboards/service-customers"` to the `allowedRoutes` array for these roles. In each role's `allowedRoutes` array, add it right after the `"/dashboards/service-tickets"` entry:

Roles to update:
- OPERATIONS (search for `"/dashboards/service-tickets"` in OPERATIONS block, add after)
- PROJECT_MANAGER (same pattern)
- OPERATIONS_MANAGER (same pattern)
- MANAGER (same pattern)
- TECH_OPS (same pattern)

Each addition is one line:
```ts
      "/dashboards/service-customers",
```

Also confirm ADMIN and OWNER have wildcard or full access (they typically do in this codebase — verify before adding).

- [ ] **Step 3: Add Customer History card to service landing page**

In `src/app/suites/service/page.tsx`, add a new card to the `LINKS` array. Place it after the "Ticket Board" entry (index 1):

```ts
  {
    href: "/dashboards/service-customers",
    title: "Customer History",
    description: "Search customers by name, email, phone, or address — see all deals, tickets, and jobs.",
    tag: "HISTORY",
    section: "Service",
  },
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build 2>&1 | tail -30`
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/page-directory.ts src/lib/role-permissions.ts src/app/suites/service/page.tsx
git commit -m "feat: wire customer history route, permissions, and landing page card"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `npm run build 2>&1 | tail -30`
Expected: Build succeeds

- [ ] **Step 4: Final commit if any fixups needed**

If lint or build surfaced issues, fix them and commit:

```bash
git add -A
git commit -m "fix: address lint/build issues from customer history implementation"
```
