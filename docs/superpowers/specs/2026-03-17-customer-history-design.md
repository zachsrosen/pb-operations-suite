# Customer History Dashboard — Design Spec

## Context

Phase 3 of the Service Suite expansion. Adds a Customer History dashboard (`/dashboards/service-customers`) that lets service coordinators search for customers and see all associated deals, tickets, and Zuper jobs in one place. Warranty tracking is deferred to a later phase.

**Architecture:** Live aggregation from HubSpot (contacts, companies, deals, tickets) + Prisma-backed cached Zuper jobs. No new Prisma models. Data cached via `appCache` with 5-min TTL.

---

## 1. Customer Resolver Module

**File:** `src/lib/customer-resolver.ts`

### Search Flow (3 phases)

**Phase 1 — Multi-entity search (max 25 results per entity):**
Query runs against both HubSpot contacts (`crm.contacts.searchApi.doSearch`) and companies (`crm.companies.searchApi.doSearch`) in parallel.
- Contact search matches on: name, email, phone
- Company search matches on: company name, address fields
- Results from both paths feed into the same grouping pipeline
- Each search is capped at 25 results to limit downstream API pressure
- Uses local retry wrappers (`searchContactsWithRetry()`, `searchCompaniesWithRetry()`) following the same pattern as `searchTicketsWithRetry()` in `hubspot-tickets.ts` — NOT reusing the deals-specific `searchWithRetry()` from `hubspot.ts`

**Phase 2 — Identity grouping + expansion (search endpoint returns summary only):**
Group initial hits by Company ID + normalized address. Then expand each group: for every Company ID found, fetch all contacts associated with that company (via `crm.associations.batchApi.read` companies → contacts).

**Lazy vs eager:** The search endpoint runs Phases 1-2 only (grouping + expansion) and returns `CustomerSummary` with counts set to `-1` (unknown). Full association resolution (Phase 3) runs only on the detail endpoint. This keeps the search path to ~5-10 API calls instead of 30+ and avoids rate-limit pressure from broad queries.

**Expansion scoping:** After fetching all contacts for a company, filter them back to the specific normalized address key for that group. This prevents a company with multiple service sites (e.g. Denver and Colorado Springs) from merging into one group.

**Address source precedence during expansion** (most subtle behavior in the resolver):
1. Deal-derived street address first — contact's associated deals → `address_line_1` + `city` + `state` + `postal_code` (NOT `pb_location`, which is a location label like "Denver"/"Westminster", not a street address)
2. Contact/company address fallback second — contact's own address properties or company address fields
3. Only then normalize the resolved street address and compare against the group key for inclusion/exclusion

> **Important:** `pb_location` is useful as a display label (shown on customer cards) but must NOT feed the `street|zip` normalizer. The grouping key is built from structured address fields (`address_line_1`, `postal_code`), not from the location label.

For address-only groups (no company association), expansion is skipped — only the matched contacts are included.

**Phase 3 — Association resolution:**
For the full expanded set of contact IDs per group, batch-resolve:
- Contacts → deals (via `crm.associations.batchApi.read`)
- Contacts → tickets (via `crm.associations.batchApi.read`)
- Deduplicate deal/ticket IDs across contacts in the same group
- Zuper jobs: **Prisma-backed cached lookup** from `db.ts` via `prisma.zuperJobCache.findMany({ where: { hubspotDealId: { in: dealIds } } })` — not a live Zuper API call. Zuper freshness depends on the existing sync job that populates the `ZuperJobCache` model; Customer History inherits that cadence.

### Address Normalization

`normalizeAddress()`:
- Lowercase, expand abbreviations (St→Street, Ave→Avenue), normalize directionals (N→North), strip periods/extra whitespace
- Grouping key: `{normalized_street}|{zip5}` — e.g. `"123 main street|80202"`
- Multi-contact households roll up via the company expansion pass

### Exported Types

```ts
interface CustomerContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

interface CustomerSummary {
  groupKey: string;           // "company:{id}:{normalizedAddr}" or "addr:{normalizedAddr}"
  displayName: string;        // see Display Name Derivation below
  address: string;            // formatted display address
  contactIds: string[];       // all HubSpot contact IDs (including expanded)
  companyId: string | null;
  dealCount: number;          // -1 on search results (resolved on detail only)
  ticketCount: number;        // -1 on search results
  jobCount: number;           // -1 on search results
}

interface CustomerDetail extends CustomerSummary {
  contacts: CustomerContact[];  // all contacts in group with name/email/phone
  deals: CustomerDeal[];        // id, name, stage, pipeline, amount, location, closeDate
  tickets: CustomerTicket[];    // id, subject, status, priority, createDate
  jobs: CustomerJob[];          // uid, title, category, status, scheduledDate
}
```

**Display name derivation:**
1. Use company name if present and not empty/generic (e.g. skip "Unknown Company")
2. Otherwise, use `{lastName} Residence` from the first contact with a last name
3. If no last name available, use the formatted address as display name

**Contact properties to fetch:** `firstname`, `lastname`, `email`, `phone` (fetched during Phase 2 expansion via batch contact reads)

### Reuse

- `hubspotClient` from `hubspot.ts` (but NOT `searchWithRetry()` — that's deals-specific)
- Retry pattern from `searchTicketsWithRetry()` in `hubspot-tickets.ts` — duplicate for contacts/companies
- `chunk()` utility: extract from `hubspot-tickets.ts` to `src/lib/utils.ts` as a shared export (it's already duplicated between `hubspot.ts` patterns and `hubspot-tickets.ts`)
- Batch association pattern from `hubspot-tickets.ts`
- Prisma `ZuperJobCache` lookup via `hubspotDealId` from `db.ts` (line ~615, `prisma.zuperJobCache.findMany`)
- `appCache.getOrFetch()` for search result caching

### Cache

- Key: `service:customers:search:{queryHash}` — 5-min TTL
- No cascade invalidation (search results are ephemeral)
- Zuper freshness inherited from existing sync cadence

---

## 2. API Routes

### `GET /api/service/customers` — Search

**File:** `src/app/api/service/customers/route.ts`

- Query param: `?q=smith` (minimum 2 characters, return `400` below that)
- Auth: same `auth()` + `getUserByEmail()` + route permissions pattern as existing service routes
- Normalize query via `q.trim().toLowerCase()` before hashing for cache key
- Calls `customer-resolver.ts` search flow (Phases 1-2 only), returns `CustomerSummary[]`
- Max 25 customer groups returned; `truncated` is set to `true` when either HubSpot search (contacts or companies) returns `paging?.next?.after` in its response, indicating more raw results exist upstream
- Counts (`dealCount`, `ticketCount`, `jobCount`) are `-1` on search results — resolved lazily on detail view
- Response:

```ts
{
  results: CustomerSummary[];
  query: string;
  truncated: boolean;
  lastUpdated: string;
}
```

### `GET /api/service/customers/[groupKey]` — Detail

**File:** `src/app/api/service/customers/[groupKey]/route.ts`

> **Note:** The parent spec (Phase 3 section) uses `[id]` for this route parameter. Changed to `[groupKey]` because the canonical identity is a composite key (company + address), not a single ID. Parent spec should be considered superseded on this point.

- `groupKey` is the URL-encoded canonical identity key, encoded via `encodeURIComponent()` (e.g. `company%3A12345%3A123%20main%20street%7C80202`)
- Auth: same pattern as search route
- Validates parsed groupKey shape (must start with `company:` or `addr:` and contain a valid address component), returns `400` on malformed keys
- Runs full association resolution for that single group: contacts (with properties), deals, tickets, Zuper jobs
- Cache: `service:customers:detail:{groupKey}` — 5-min TTL
- Response:

```ts
{
  customer: CustomerDetail;
  lastUpdated: string;
}
```

**No write endpoints.** Customer History is read-only. All mutations happen through existing deal/ticket/Zuper interfaces.

---

## 3. Dashboard Page

**File:** `src/app/dashboards/service-customers/page.tsx`

### Layout (top → bottom)

**Search bar** — Centered input with debounced query (300ms). Minimum 2 chars before firing. Shows result count while loading.

**Customer cards grid** — `CustomerSummary` cards in a responsive grid (`stagger-grid` class for animated entry). Each card shows:
- Display name (company name or residence label)
- Address
- Contact count (number of contacts in group)
- Click → opens detail slide-over panel (which loads full counts and metadata)

**Detail slide-over panel** — Slides in from right (matching Ticket Board interaction pattern). Grid stays visible underneath for easy back-and-forth scanning. Shows:
- **Header:** Contact names + emails with HubSpot links. Raw contact IDs in collapsible debug section or tooltip only — not primary UI.
- **Three-column metadata list:** Deals | Tickets | Jobs — each as a compact card list
- Each item shows: name/subject/title, stage/status, date, and link to HubSpot or Zuper
- Close button returns focus to search results

### Sort Timestamps

- Deals: `hs_lastmodifieddate` (most recently active first)
- Tickets: `hs_lastmodifieddate` (most recently active first)
- Jobs: `scheduled_start_time`, fallback to `created_at`

### Component Patterns

- `DashboardShell` wrapper with cyan accent (matching Service Suite)
- `useSSE` not needed — search is user-initiated, no real-time push
- Standard `fetch()` to the two API routes
- `LoadingSpinner` and `ErrorState` for loading/error states
- `MiniStat` for count badges on customer cards

### Empty States

- No query yet: "Search by customer name, email, phone, or address"
- No results: "No customers found for '{query}'"
- Detail column with zero items: "None found" placeholder

---

## 4. Suite + Route Wiring

### Files to modify

| File | Change |
|------|--------|
| `src/lib/page-directory.ts` | Add `/dashboards/service-customers` to `APP_PAGE_ROUTES` |
| `src/lib/role-permissions.ts` | Add `/dashboards/service-customers` to ADMIN, OWNER, MANAGER, OPERATIONS, OPERATIONS_MANAGER, PROJECT_MANAGER. Add to TECH_OPS `allowedRoutes`. |
| `src/app/suites/service/page.tsx` | Add Customer History card on Service Suite landing page — cyan accent, search icon |
| `src/components/DashboardShell.tsx` | Add `SUITE_MAP` entry: `/dashboards/service-customers` → `/suites/service` |
| `src/lib/cache.ts` | Add key builders: `SERVICE_CUSTOMERS_SEARCH(queryHash) => "service:customers:search:${queryHash}"`, `SERVICE_CUSTOMER_DETAIL(groupKey) => "service:customers:detail:${groupKey}"` |
| `src/lib/query-keys.ts` | Add single-domain keys: `serviceCustomers.root`, `serviceCustomers.search(query)`, `serviceCustomers.detail(groupKey)` |

**Not modified:** `src/lib/suite-nav.ts` — that file defines top-level suite switcher entries only, not per-dashboard navigation.

### No Database Changes

No new Prisma models. No migrations. All data sourced from HubSpot + existing Prisma-backed Zuper cache.

---

## Integration Contracts

### Canonical Customer Identity
- Primary key: Company ID + normalized service address
- Grouping key format: `"company:{id}:{normalizedAddr}"` or `"addr:{normalizedAddr}"`
- Expansion scoped to matching address — multi-site companies stay separate
- Address source precedence: deal `address_line_1` + `postal_code` → contact/company address → normalize and compare against group key (NOT `pb_location`, which is a location label)

### Data Sources
- HubSpot contacts + companies: live search via local `searchContactsWithRetry()` / `searchCompaniesWithRetry()` (NOT the deals-specific `searchWithRetry()`)
- HubSpot deals + tickets: live association resolution via batch API (detail endpoint only)
- Zuper jobs: `ZuperJobCache` Prisma model lookup via `hubspotDealId` — inherits existing sync cadence

### Rate-Limit Budget
- Search endpoint: ~5-10 HubSpot API calls (2 searches + expansion associations)
- Detail endpoint: ~10-20 HubSpot API calls (contact batch reads + deal/ticket associations)
- Both use per-entity retry wrappers with exponential backoff

### Cache Strategy
- Search: `service:customers:search:{queryHash}` — 5-min TTL, ephemeral
- Detail: `service:customers:detail:{groupKey}` — 5-min TTL, ephemeral
- No cascade invalidation needed

---

## Verification

- `npm run build` passes with new page
- Customer search returns grouped results for name, email, phone, and address queries
- Company expansion pulls in spouse/secondary contacts under same address
- Multi-site companies stay separated by address
- Detail panel shows deals, tickets, and Zuper jobs with correct counts
- Sort order: most recently modified first for deals/tickets, scheduled date for jobs
- Empty states render correctly for no query, no results, and empty columns
- TECH_OPS role can access the dashboard
- Service Suite landing page shows Customer History card
