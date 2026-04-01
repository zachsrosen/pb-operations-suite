# Customer History v2 — Contact-Based Lookup

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Customer History to be a simple contact-based lookup — search for contacts, select one, see everything associated with that contact.

**Architecture:** Search HubSpot contacts by name/email/phone/address. Each search result is a single contact (no grouping, no address normalization, no company expansion). Detail view resolves all associations for the selected contact: deals (contact→deal), tickets (contact→ticket), and Zuper jobs (via deal IDs from ZuperJobCache + name/address match on ZuperJobCache.customerAddress and projectName).

**Tech Stack:** HubSpot API (contacts search, batch read, batch associations), Prisma (ZuperJobCache), Next.js API routes, React client component.

---

## What's Changing

The v1 resolver used Company ID + normalized address grouping with company expansion and lazy detail resolution. This caused multiple bugs where contacts with blank addresses got filtered out during re-resolution, losing their deals/tickets/jobs.

v2 replaces this with:
- **Search** returns individual contacts (not groups)
- **Detail** takes a contact ID (not a groupKey) and resolves all associations directly
- **Jobs** found via deal-linked ZuperJobCache records + name/address fuzzy match on ZuperJobCache

## Files

| Action | File | Purpose |
|--------|------|---------|
| Rewrite | `src/lib/customer-resolver.ts` | Strip grouping/expansion/address-normalization. New: `searchContacts()`, `resolveContactDetail()` |
| Rewrite | `src/__tests__/lib/customer-resolver.test.ts` | New tests for simplified resolver |
| Rewrite | `src/app/api/service/customers/route.ts` | Search endpoint returns contacts |
| Rewrite | `src/app/api/service/customers/[groupKey]/route.ts` → rename to `[contactId]/route.ts` | Detail endpoint keyed by contact ID |
| Modify | `src/app/dashboards/service-customers/page.tsx` | Update types and fetch URLs |
| Modify | `src/lib/cache.ts` | Update detail cache key builder |
| Modify | `src/lib/query-keys.ts` | Update detail query key |
| No change | `src/lib/utils.ts` | `chunk()` still used |
| No change | `src/lib/role-permissions.ts` | Routes already wired |
| No change | `src/app/suites/service/page.tsx` | Landing page card already wired |

---

## Chunk 1: Resolver Rewrite + Tests

### Task 1: Rewrite customer-resolver.ts types and search

**Files:**
- Rewrite: `src/lib/customer-resolver.ts`
- Test: `src/__tests__/lib/customer-resolver.test.ts`

The new resolver exports these types and functions:

```ts
// Types
export interface ContactSearchResult {
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  companyName: string | null;
}

export interface SearchResult {
  results: ContactSearchResult[];
  truncated: boolean;
}

export interface ContactDeal {
  id: string;
  name: string;
  stage: string;
  pipeline: string;
  amount: string | null;
  location: string | null;
  closeDate: string | null;
  lastModified: string;
}

export interface ContactTicket {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  createDate: string;
  lastModified: string;
}

export interface ContactJob {
  uid: string;
  title: string;
  category: string | null;
  status: string | null;
  scheduledDate: string | null;
  createdAt: string | null;
}

export interface ContactDetail {
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  companyName: string | null;
  deals: ContactDeal[];
  tickets: ContactTicket[];
  jobs: ContactJob[];
}
```

Functions:
- `searchContacts(query: string): Promise<SearchResult>` — searches HubSpot contacts by firstname, lastname, email, phone, address (5 filterGroups with `CONTAINS_TOKEN`). Returns up to `MAX_SEARCH_RESULTS` (25) contacts with their properties. Sets `truncated = true` if `paging.next.after` is present. Also searches companies by name/address and returns their associated contacts (deduped by contact ID).
- `resolveContactDetail(contactId: string): Promise<ContactDetail>` — fetches the contact's properties, then resolves:
  1. Contact → deal associations (batch API), batch-read deal properties
  2. Contact → ticket associations (batch API), batch-read ticket properties
  3. Zuper jobs: `getCachedZuperJobsByDealIds(dealIds)` for deal-linked jobs, PLUS `prisma.zuperJobCache.findMany()` matching `projectName` (case-insensitive contains on contact's full name) or `customerAddress` JSON field matching the contact's address. Deduplicate by `jobUid`.

**Keep (carry over verbatim):** `searchContactsWithRetry`, `searchCompaniesWithRetry`, `resolveCompanyContacts`, `sleep` helper, `chunk` import from `@/lib/utils`, `BATCH_SIZE`, `MAX_SEARCH_RESULTS`. Also preserve the import aliases: `import { FilterOperatorEnum as ContactFilterOp } from "@hubspot/api-client/lib/codegen/crm/contacts"` and `import { FilterOperatorEnum as CompanyFilterOp } from "@hubspot/api-client/lib/codegen/crm/companies"`. Import `prisma` statically at the top: `import { getCachedZuperJobsByDealIds, prisma } from "@/lib/db"`.

**Remove entirely:** `normalizeAddress`, `deriveDisplayName`, `SUFFIX_MAP`, `DIRECTIONAL_MAP`, `GENERIC_COMPANY_NAMES`, `groupSearchHits`, `RawSearchHit`, `filterExpandedContactsByAddress`, `expandGroups`, `parseGroupKey`, `resolveContactIdsFromGroupKey`, `CustomerSummary`, `CustomerDetail` (replaced by `ContactDetail`), `CustomerContact`, `CustomerDeal`, `CustomerTicket`, `CustomerJob`.

- [ ] **Step 1: Write failing tests for searchContacts**

Create `src/__tests__/lib/customer-resolver.test.ts` (full rewrite). Mock the HubSpot client and test:
1. Returns contacts from contact search
2. Returns contacts from company search (deduplicated)
3. Sets `truncated` when paging present
4. Returns empty results for no matches
5. Handles search API errors gracefully

```ts
// Mock setup at top of file
jest.mock("@/lib/db", () => ({
  getCachedZuperJobsByDealIds: jest.fn().mockResolvedValue([]),
  prisma: { zuperJobCache: { findMany: jest.fn().mockResolvedValue([]) } },
}));

jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      contacts: {
        searchApi: { doSearch: jest.fn() },
        batchApi: { read: jest.fn() },
      },
      companies: {
        searchApi: { doSearch: jest.fn() },
      },
      associations: {
        batchApi: { read: jest.fn() },
      },
      deals: { batchApi: { read: jest.fn() } },
      tickets: { batchApi: { read: jest.fn() } },
    },
  },
}));
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest src/__tests__/lib/customer-resolver.test.ts --no-coverage`
Expected: FAIL (functions don't exist yet)

- [ ] **Step 3: Implement customer-resolver.ts**

Rewrite the file with the types above + `searchContacts()` and `resolveContactDetail()`.

Key implementation details for `searchContacts`:

```ts
export async function searchContacts(query: string): Promise<SearchResult> {
  let truncated = false;
  const contactMap = new Map<string, ContactSearchResult>();

  // Search contacts by name/email/phone/address
  const [contactRes, companyRes] = await Promise.allSettled([
    searchContactsWithRetry({
      filterGroups: [
        { filters: [{ propertyName: "firstname", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "lastname", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "email", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "phone", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "address", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
      ],
      properties: ["firstname", "lastname", "email", "phone", "address", "city", "state", "zip", "company"],
      limit: MAX_SEARCH_RESULTS,
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }] as unknown as string[],
      after: "0",
    }),
    searchCompaniesWithRetry({
      filterGroups: [
        { filters: [{ propertyName: "name", operator: CompanyFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "address", operator: CompanyFilterOp.ContainsToken, value: `*${query}*` }] },
      ],
      properties: ["name", "address"],
      limit: MAX_SEARCH_RESULTS,
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }] as unknown as string[],
      after: "0",
    }),
  ]);

  // Process direct contact hits
  if (contactRes.status === "fulfilled") {
    if (contactRes.value.paging?.next?.after) truncated = true;
    for (const c of contactRes.value.results || []) {
      contactMap.set(c.id, {
        contactId: c.id,
        firstName: c.properties?.firstname || null,
        lastName: c.properties?.lastname || null,
        email: c.properties?.email || null,
        phone: c.properties?.phone || null,
        address: formatContactAddress(c.properties),
        companyName: c.properties?.company || null,
      });
    }
  }

  // Process company hits → resolve to contacts
  if (companyRes.status === "fulfilled") {
    if (companyRes.value.paging?.next?.after) truncated = true;
    const companyIds = (companyRes.value.results || []).map(c => c.id);
    if (companyIds.length > 0) {
      const companyContactMap = await resolveCompanyContacts(companyIds);
      const companyNameMap = new Map(
        (companyRes.value.results || []).map(c => [c.id, c.properties?.name || null])
      );

      // Batch-read all contacts from matched companies
      const allContactIds = [...new Set([...companyContactMap.values()].flat())];
      for (const batch of chunk(allContactIds, BATCH_SIZE)) {
        try {
          const batchResp = await hubspotClient.crm.contacts.batchApi.read({
            inputs: batch.map(id => ({ id })),
            properties: ["firstname", "lastname", "email", "phone", "address", "city", "state", "zip", "company"],
            propertiesWithHistory: [],
          });
          for (const c of batchResp.results || []) {
            if (!contactMap.has(c.id)) {
              // Find which company this contact belongs to
              let companyName = c.properties?.company || null;
              for (const [compId, contactIds] of companyContactMap) {
                if (contactIds.includes(c.id)) {
                  companyName = companyNameMap.get(compId) || companyName;
                  break;
                }
              }
              contactMap.set(c.id, {
                contactId: c.id,
                firstName: c.properties?.firstname || null,
                lastName: c.properties?.lastname || null,
                email: c.properties?.email || null,
                phone: c.properties?.phone || null,
                address: formatContactAddress(c.properties),
                companyName,
              });
            }
          }
        } catch (err) {
          Sentry.captureException(err);
        }
      }
    }
  }

  const results = [...contactMap.values()].slice(0, MAX_SEARCH_RESULTS);
  return { results, truncated: truncated || contactMap.size > MAX_SEARCH_RESULTS };
}
```

Helper for formatting address from contact properties:

```ts
function formatContactAddress(props: Record<string, string | null> | undefined): string | null {
  if (!props) return null;
  const parts = [props.address, props.city, props.state, props.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
```

Key implementation details for `resolveContactDetail`:

```ts
export async function resolveContactDetail(contactId: string): Promise<ContactDetail> {
  // 1. Read contact properties
  const contactResp = await hubspotClient.crm.contacts.batchApi.read({
    inputs: [{ id: contactId }],
    properties: ["firstname", "lastname", "email", "phone", "address", "city", "state", "zip", "company"],
    propertiesWithHistory: [],
  });
  const contact = contactResp.results?.[0];
  const props = contact?.properties || {};

  // 2. Resolve contact → deal associations
  const dealIdSet = new Set<string>();
  try {
    const resp = await hubspotClient.crm.associations.batchApi.read(
      "contacts", "deals",
      { inputs: [{ id: contactId }] }
    );
    for (const result of resp.results || []) {
      for (const to of (result.to || []) as Array<{ id: string }>) {
        dealIdSet.add(to.id);
      }
    }
  } catch (err) {
    Sentry.captureException(err);
  }

  // 3. Resolve contact → ticket associations
  const ticketIdSet = new Set<string>();
  try {
    const resp = await hubspotClient.crm.associations.batchApi.read(
      "contacts", "tickets",
      { inputs: [{ id: contactId }] }
    );
    for (const result of resp.results || []) {
      for (const to of (result.to || []) as Array<{ id: string }>) {
        ticketIdSet.add(to.id);
      }
    }
  } catch (err) {
    Sentry.captureException(err);
  }

  // 4. Batch-read deal properties
  const deals: ContactDeal[] = [];
  const dealIds = [...dealIdSet];
  for (const batch of chunk(dealIds, BATCH_SIZE)) {
    try {
      const batchResp = await hubspotClient.crm.deals.batchApi.read({
        inputs: batch.map(id => ({ id })),
        properties: ["dealname", "dealstage", "pipeline", "amount", "pb_location", "closedate", "hs_lastmodifieddate"],
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
    }
  }
  deals.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  // 5. Batch-read ticket properties
  const tickets: ContactTicket[] = [];
  for (const batch of chunk([...ticketIdSet], BATCH_SIZE)) {
    try {
      const batchResp = await hubspotClient.crm.tickets.batchApi.read({
        inputs: batch.map(id => ({ id })),
        properties: ["subject", "hs_pipeline_stage", "hs_ticket_priority", "createdate", "hs_lastmodifieddate"],
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
    }
  }
  tickets.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  // 6. Zuper jobs — deal-linked + name/address match
  const jobMap = new Map<string, ContactJob>();

  // 6a. Jobs linked via deal IDs
  if (dealIds.length > 0) {
    try {
      const zuperJobs = await getCachedZuperJobsByDealIds(dealIds);
      for (const j of zuperJobs || []) {
        jobMap.set(j.jobUid, {
          uid: j.jobUid,
          title: j.jobTitle || "Untitled Job",
          category: j.jobCategory || null,
          status: j.jobStatus || null,
          scheduledDate: j.scheduledStart?.toISOString() || null,
          createdAt: j.lastSyncedAt?.toISOString() || null,
        });
      }
    } catch (err) {
      Sentry.captureException(err);
    }
  }

  // 6b. Jobs matching customer name or address (catches jobs not linked via deal)
  const fullName = [props.firstname, props.lastname].filter(Boolean).join(" ").trim();
  const contactAddress = props.address?.trim() || null;

  if (fullName || contactAddress) {
    try {
      // prisma is imported statically at the top of the file
      const orConditions: Array<Record<string, unknown>> = [];

      if (fullName) {
        orConditions.push({
          projectName: { contains: fullName, mode: "insensitive" },
        });
      }
      if (contactAddress) {
        orConditions.push({
          customerAddress: { path: ["street"], string_contains: contactAddress },
        });
      }

      const nameAddrJobs = await prisma.zuperJobCache.findMany({
        where: { OR: orConditions },
      });

      for (const j of nameAddrJobs) {
        if (!jobMap.has(j.jobUid)) {
          jobMap.set(j.jobUid, {
            uid: j.jobUid,
            title: j.jobTitle || "Untitled Job",
            category: j.jobCategory || null,
            status: j.jobStatus || null,
            scheduledDate: j.scheduledStart?.toISOString() || null,
            createdAt: j.lastSyncedAt?.toISOString() || null,
          });
        }
      }
    } catch (err) {
      Sentry.captureException(err);
    }
  }

  const jobs = [...jobMap.values()];
  jobs.sort((a, b) => {
    const dateA = a.scheduledDate || a.createdAt || "";
    const dateB = b.scheduledDate || b.createdAt || "";
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  return {
    contactId,
    firstName: props.firstname || null,
    lastName: props.lastname || null,
    email: props.email || null,
    phone: props.phone || null,
    address: formatContactAddress(props),
    companyName: props.company || null,
    deals,
    tickets,
    jobs,
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest src/__tests__/lib/customer-resolver.test.ts --no-coverage`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/customer-resolver.ts src/__tests__/lib/customer-resolver.test.ts
git commit -m "refactor: rewrite customer resolver as contact-based lookup

Replaces company grouping + address normalization + expansion with
direct contact search and association resolution. Each search result
is now a single contact. Detail resolves deals, tickets, and Zuper
jobs (deal-linked + name/address match) for that contact."
```

---

## Chunk 2: API Routes + Dashboard Page

### Task 2: Rewrite API routes

**Files:**
- Rewrite: `src/app/api/service/customers/route.ts`
- Delete: `src/app/api/service/customers/[groupKey]/route.ts`
- Create: `src/app/api/service/customers/[contactId]/route.ts`
- Modify: `src/lib/cache.ts:269`
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Update cache key builder**

In `src/lib/cache.ts`, change the detail key from groupKey to contactId:

```ts
// Before:
SERVICE_CUSTOMER_DETAIL: (groupKey: string) => `service:customers:detail:${groupKey}`,
// After:
SERVICE_CUSTOMER_DETAIL: (contactId: string) => `service:customers:detail:${contactId}`,
```

- [ ] **Step 2: Update query keys**

In `src/lib/query-keys.ts`, update the detail key builder to accept `contactId` instead of `groupKey`. (The key shape is the same — just the parameter name changes for clarity.)

- [ ] **Step 3: Rewrite search route**

`src/app/api/service/customers/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { searchContacts } from "@/lib/customer-resolver";
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
    const queryHash = crypto.createHash("md5").update(query).digest("hex").slice(0, 12);
    const cacheKey = CACHE_KEYS.SERVICE_CUSTOMERS_SEARCH(queryHash);

    const { data, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      () => searchContacts(query),
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

- [ ] **Step 4: Delete old groupKey route, create contactId route**

Delete `src/app/api/service/customers/[groupKey]/route.ts`.

Create `src/app/api/service/customers/[contactId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { resolveContactDetail } from "@/lib/customer-resolver";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
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

    const { contactId } = await params;

    // Validate contactId is numeric
    if (!/^\d+$/.test(contactId)) {
      return NextResponse.json(
        { error: "Invalid contact ID" },
        { status: 400 }
      );
    }

    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "true";
    const cacheKey = CACHE_KEYS.SERVICE_CUSTOMER_DETAIL(contactId);

    const { data: customer, lastUpdated } = await appCache.getOrFetch(
      cacheKey,
      () => resolveContactDetail(contactId),
      forceRefresh
    );

    return NextResponse.json({ customer, lastUpdated });
  } catch (error) {
    console.error("[CustomerDetail] Error:", error);
    return NextResponse.json(
      { error: "Failed to load customer detail" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: Commit**

```bash
git rm src/app/api/service/customers/\[groupKey\]/route.ts
git add src/app/api/service/customers/route.ts \
        src/app/api/service/customers/\[contactId\]/route.ts \
        src/lib/cache.ts src/lib/query-keys.ts
git commit -m "refactor: switch API routes from groupKey to contactId"
```

### Task 3: Update dashboard page

**Files:**
- Rewrite: `src/app/dashboards/service-customers/page.tsx`

The page structure stays the same (search bar + cards grid + slide-over). Changes:

1. **Types**: Import `ContactSearchResult`, `ContactDetail` instead of `CustomerSummary`, `CustomerDetail`, `CustomerContact`
2. **Search response**: `results` is now `ContactSearchResult[]`
3. **Card rendering**: Show contact name, email, address, company name. Card `key` uses `contact.contactId`.
4. **Detail fetch**: `/api/service/customers/${contact.contactId}` (no encoding needed — it's numeric)
5. **Detail rendering**: Remove the "Contacts" section. Add a contact info header. Keep Deals, Tickets, Jobs sections as-is.
6. **State rename**: ALL occurrences of `selectedCustomer`/`setSelectedCustomer` → `selectedContact`/`setSelectedContact`. There are 4+ references including the Escape key handler, backdrop click, close button, and selection comparison. The active card highlight comparison changes from `selectedCustomer?.groupKey === customer.groupKey` to `selectedContact?.contactId === contact.contactId`.

Updated `handleSelectContact`:
```tsx
const handleSelectContact = useCallback(async (contact: ContactSearchResult) => {
  setSelectedContact(contact);
  setDetail(null);
  setDetailLoading(true);

  try {
    const res = await fetch(`/api/service/customers/${contact.contactId}`);
    if (!res.ok) throw new Error("Failed to load customer detail");
    const data: DetailResponse = await res.json();
    setDetail(data.customer);
  } catch {
    setDetail(null);
  } finally {
    setDetailLoading(false);
  }
}, []);
```

Key changes in card:
```tsx
<button
  key={contact.contactId}
  onClick={() => handleSelectContact(contact)}
  className={`text-left p-4 bg-surface rounded-lg border transition-all hover:shadow-lg ${
    selectedContact?.contactId === contact.contactId
      ? "border-cyan-500 shadow-cyan-500/20"
      : "border-t-border hover:border-cyan-500/50"
  }`}
>
  <h3 className="font-semibold text-foreground truncate">
    {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown"}
  </h3>
  <p className="text-sm text-muted mt-1 truncate">{contact.email || "No email"}</p>
  {contact.address && <p className="text-sm text-muted truncate">{contact.address}</p>}
  {contact.companyName && <p className="text-xs text-muted mt-1">{contact.companyName}</p>}
</button>
```

Key changes in detail panel header:
```tsx
<div className="min-w-0 flex-1 mr-3">
  <h2 className="text-lg font-semibold text-foreground truncate">
    {[detail.firstName, detail.lastName].filter(Boolean).join(" ") || "Unknown"}
  </h2>
  {detail.email && (
    <a href={hubspotContactUrl(detail.contactId)} target="_blank" rel="noopener noreferrer"
       className="text-sm text-cyan-500 hover:underline truncate block">{detail.email}</a>
  )}
  {detail.address && <p className="text-sm text-muted truncate">{detail.address}</p>}
  {detail.companyName && <p className="text-xs text-muted">{detail.companyName}</p>}
  {detail.phone && <p className="text-xs text-muted">{detail.phone}</p>}
</div>
```

Detail body: Remove the "Contacts" section entirely. Keep Deals, Tickets, Jobs sections as-is (rendering is identical).

- [ ] **Step 1: Update the dashboard page**

Rewrite the component with all the changes above. Rename all `selectedCustomer`/`setSelectedCustomer` → `selectedContact`/`setSelectedContact` (including the Escape handler and backdrop onClick).

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors in customer-resolver, service-customers, or API routes

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/service-customers/page.tsx
git commit -m "refactor: update dashboard page for contact-based lookup

Search cards now show individual contacts with name, email, address,
and company. Detail panel shows contact info header + deals, tickets,
and Zuper jobs. No more group-based display."
```

### Task 4: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: customer-resolver tests pass, no new failures

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No new errors

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: `Compiled successfully`

- [ ] **Step 4: Manual smoke test with dev server**

Start dev server (`npm run dev`), navigate to `/dashboards/service-customers`, search for "oleary". Verify:
- Search returns Jessica Oleary as an individual contact
- Clicking her card opens the detail panel
- Detail shows her deals, tickets, and Zuper jobs
- HubSpot links work (correct portal ID)
- Zuper job links work

---

## Notes

- The `normalizeAddress`, `deriveDisplayName`, and all grouping/expansion code gets deleted entirely. If something downstream imported those exports, the TypeScript compiler will catch it.
- The `CustomerSummary` type was not imported anywhere outside the customer-history feature files, so removing it is safe.
- The name/address match on ZuperJobCache is a secondary lookup — it catches jobs that aren't linked via deal ID (e.g., jobs created before the deal-linking sync was set up). False positives are low because `projectName` typically contains the homeowner's name.
- Prisma's `string_contains` on a JSON path requires Postgres — which we have (Neon). If the JSON filter syntax doesn't work for the `customerAddress` field, fall back to fetching all jobs for the contact's ZIP and filtering in memory.
