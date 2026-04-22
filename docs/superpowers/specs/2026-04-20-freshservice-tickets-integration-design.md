# Freshservice Tickets Integration — Design

**Date:** 2026-04-20
**Branch:** feat/freshservice-tickets
**Status:** Approved (post spec-review v2)

## Problem

Zach, Patrick, and Caleb are the only PB Tech Ops Suite users who file Freshservice tickets. Today, to see the status of an IT ticket they filed, they have to leave the suite and log into `photonbrothers.freshservice.com` separately. There is no at-a-glance signal ("do I have open tickets?") and no list view inside the suite.

## Goal

Surface a user's own open and pending Freshservice tickets inside the admin suite, with a count badge in the UserMenu for quick awareness.

**Non-goals:**
- Writing or replying to tickets from the app
- Closing tickets (scripts/sync-tasks.ts already handles that)
- All-tickets view across all requesters
- Real-time SSE push (manual refresh + 60s stale time is sufficient)
- TASKS.md integration (the existing sync script owns that)

## Users

Admin-gated at the route level. Three users today:

- **Zach** — ADMIN (native access)
- **Patrick** — not ADMIN; granted via per-user `extraAllowedRoutes` on his User row
- **Caleb** — same treatment as Patrick

`extraAllowedRoutes` (per-user override, processed in `src/lib/user-access.ts`) is the right mechanism for a 2-user exception rather than role-wide grants. When combined with `ADMIN_ONLY_EXCEPTIONS` entries, the admin-only gate lifts for those paths and the user's route allowlist takes over.

## Architecture

### 1. Freshservice client — `src/lib/freshservice.ts` (new)

Typed REST wrapper. Patterns mirrored from `scripts/sync-tasks.ts` (already proven against the same API).

**Filtering by requester — two-step lookup (documented path):**

The Freshservice v2 `GET /api/v2/tickets` endpoint supports predefined filter names (`new_and_my_open`, `watching`, etc.) and certain scalar parameters, but using `?email=...` as a requester filter is inconsistent across tenants and undocumented. The safe, documented path:

1. `GET /api/v2/requesters?email=<user_email>` → returns `{ requesters: [{ id, ... }] }`
2. `GET /api/v2/tickets?requester_id=<id>&include=stats&per_page=100&page=N` → paginate

Cache the `email → requester_id` lookup for 10 minutes (requesters rarely change per user).

**Exports:**
```ts
export async function freshserviceFetch(endpoint: string, opts?: RequestInit): Promise<Response>;
// HTTP Basic (base64(API_KEY:X)), 5-attempt exponential backoff on 429.

export async function fetchRequesterIdByEmail(email: string): Promise<number | null>;
// Step 1. Returns null if no requester exists for the email.

export async function fetchTicketsByRequesterId(requesterId: number): Promise<FreshserviceTicket[]>;
// Step 2. Paginates; filters client-side to status ∈ {2, 3, 4}.

export async function fetchTicketDetail(id: number): Promise<FreshserviceTicket>;

export interface FreshserviceTicket {
  id: number;
  subject: string;
  status: 2 | 3 | 4 | 5;
  priority: 1 | 2 | 3 | 4;
  created_at: string;
  updated_at: string;
  due_by: string | null;
  fr_due_by: string | null;
  description_text: string;
  requester_id: number;
  responder_id: number | null;
  type: string | null;
  category: string | null;
}

export interface FreshserviceRequester {
  id: number;
  primary_email: string;
  first_name: string;
  last_name: string;
}

export const FRESHSERVICE_STATUS_LABELS: Record<number, string> = {
  2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed",
};
export const FRESHSERVICE_PRIORITY_LABELS: Record<number, string> = {
  1: "Low", 2: "Medium", 3: "High", 4: "Urgent",
};
```

**Server cache** — Dedicated `CacheStore` instances, not the shared `appCache` singleton (which uses a 5-minute default TTL incompatible with the 60s freshness we want).

```ts
// src/lib/freshservice.ts
import { CacheStore } from "@/lib/cache";
const ticketsCache = new CacheStore(60_000, 120_000); // 60s fresh, 120s stale window
const requesterCache = new CacheStore(10 * 60_000, 30 * 60_000); // 10m fresh, 30m stale
```

Cache keys:
- `freshservice:requester-id:<email>` (requester ID lookup)
- `freshservice:tickets:<requester_id>` (ticket list)
- `freshservice:ticket:<ticket_id>` (single ticket detail)

### 2. API routes

**`GET /api/admin/freshservice/tickets`**
- `auth()` from `@/auth` → 401 if no session.
- Route access handled by `middleware.ts` via `isPathAllowedByAccess` in `src/lib/user-access.ts`. ADMIN passes natively; Patrick/Caleb pass via `ADMIN_ONLY_EXCEPTIONS` + `extraAllowedRoutes`.
- Flow: `email → fetchRequesterIdByEmail → fetchTicketsByRequesterId`.
- Returns `{ tickets: FreshserviceTicket[], lastUpdated: string, requesterFound: boolean }`.
- `Cache-Control: private, max-age=60`.
- Missing `FRESHSERVICE_API_KEY`: 500 `{ error: "Freshservice not configured" }`.
- `requesterFound=false`: 200 with `tickets: []` so the page can show a specific empty state ("No Freshservice account linked to your email").

**`GET /api/admin/freshservice/tickets/[id]`**
- Same auth/route check. Calls `fetchTicketDetail(id)`.
- Authorization check: reject if `ticket.requester_id !== currentUserRequesterId` (prevents enumeration — users can only read their own tickets).
- Returns `{ ticket: FreshserviceTicket }`.

**`GET /api/admin/freshservice/count`**
- Same auth/route check. Shares the 60s cache with the tickets endpoint (reuses list result, runs counts).
- Returns `{ open: number, pending: number, total: number }` (counts of status 2, 3, and 2+3; Resolved doesn't count as "needs attention").
- Separate endpoint so UserMenu doesn't ship full ticket payloads on every page load.

### 3. Admin page — `src/app/admin/freshservice/page.tsx` (new)

Client component. Uses existing admin-shell primitives:

- `AdminPageHeader title="Freshservice Tickets" breadcrumb={["Admin", "Freshservice"]} subtitle="Your open tickets on photonbrothers.freshservice.com."`
- `AdminFilterBar` with `FilterChip` tabs: All / Open / Pending / Resolved. Counts rendered inline in the chip label (same pattern as `src/app/admin/tickets/page.tsx`).
- `AdminTable` columns:
  - `id` — `#{id}` (monospace)
  - `subject` — truncated, click opens drawer
  - `status` — pill (Open=red/15, Pending=amber/15, Resolved=emerald/15)
  - `priority` — pill (Low=zinc, Medium=blue, High=amber, Urgent=red)
  - `created_at` — relative ("3d ago")
  - `due_by` — relative, red text if overdue, blank if null
- `AdminDetailDrawer` on row click → ticket detail:
  - `AdminDetailHeader` with subject + status/priority badges
  - `AdminKeyValueGrid`: Status, Priority, Created, Updated, Due, Type, Category
  - Description (`description_text`, rendered via React text children only — no raw HTML).
  - Footer: "View in Freshservice →" external link (`https://photonbrothers.freshservice.com/a/tickets/:id`)
- Refresh button calls `queryClient.invalidateQueries({ queryKey: queryKeys.freshservice.root })`.
- React Query: `staleTime: 60_000`, `refetchOnWindowFocus: false`.
- Empty states:
  - `requesterFound=false`: `AdminEmpty` with "No Freshservice account linked to your email" + contact-admin note.
  - `requesterFound=true`, `tickets=[]`: `AdminEmpty` with "No open tickets 🎉" + portal link.
- Error state: `AdminError` with retry button.

### 4. UserMenu badge — modify `src/components/UserMenu.tsx`

Add a menu item rendered only when the user is ADMIN. The count fetch must be gated so non-admin users don't fire a doomed request every session change. Use a second `useEffect` that depends on `userRole`:

```tsx
const [ticketCount, setTicketCount] = useState<number | null>(null);

useEffect(() => {
  // Only fetch if userRole resolved to ADMIN. Patrick/Caleb don't see the badge
  // in v1; they navigate via the admin sidebar (acceptable — they know about it).
  if (userRole !== "ADMIN") return;
  fetch("/api/admin/freshservice/count")
    .then(r => (r.ok ? r.json() : null))
    .then(d => d && setTicketCount((d.open ?? 0) + (d.pending ?? 0)))
    .catch(() => {});
}, [userRole]);
```

Menu item (between Admin and SOP Guide):

```tsx
{isAdmin && (
  <Link href="/admin/freshservice" ...>
    <svg>...ticket icon...</svg>
    Freshservice Tickets
    {ticketCount !== null && ticketCount > 0 && (
      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
        {ticketCount}
      </span>
    )}
  </Link>
)}
```

### 5. Nav registration — modify `src/components/admin-shell/nav.ts`

Add to the "Operations" group and rename the existing item for clarity:

```ts
{
  label: "Operations",
  items: [
    { label: "Crew availability", href: "/admin/crew-availability", iconName: "calendar" },
    { label: "Bug reports", href: "/admin/tickets", iconName: "ticket" },  // renamed from "Tickets"
    { label: "Freshservice", href: "/admin/freshservice", iconName: "ticket" },  // new
  ],
},
```

**Nav label rename scope check** — the word "Tickets" as a user-visible label for `/admin/tickets` appears in:
- `src/components/admin-shell/nav.ts` (primary — this change)
- `src/lib/page-directory.ts:8` — update to "Bug reports"
- `src/app/admin/tickets/page.tsx` — page header/breadcrumb strings; update to "Bug reports"
- `src/app/handbook/page.tsx:391` — update if the handbook references the admin nav by name

`src/components/GlobalSearch.tsx` already says "Bug Reports" — no change.

### 6. Role allowlist — modify `src/lib/roles.ts` + Patrick/Caleb user records

Add to `ADMIN_ONLY_EXCEPTIONS`:

```ts
"/admin/freshservice",
"/api/admin/freshservice",
```

These lift the admin-only gate for the two paths. Then grant Patrick and Caleb via per-user `extraAllowedRoutes` (data change, not role definition change):

Provide a one-off script `scripts/_grant-freshservice-access.ts` (underscore prefix marks it one-off) that pushes the two routes onto each user's `extraAllowedRoutes` array. Do NOT hard-code the user list in source — the script takes emails as CLI args.

### 7. Query keys — modify `src/lib/query-keys.ts`

```ts
freshservice: {
  root: ["freshservice"] as const,
  tickets: () => [...queryKeys.freshservice.root, "tickets"] as const,
  ticket: (id: number) => [...queryKeys.freshservice.root, "ticket", id] as const,
  count: () => [...queryKeys.freshservice.root, "count"] as const,
},
```

No SSE mapping added in `cacheKeyToQueryKeys` (no server push for Freshservice in v1).

## Data flow

```
Page load:
  UserMenu useEffect (gated on userRole === "ADMIN") → GET /api/admin/freshservice/count
    → session check → user-access middleware → freshservice.ts
    → requester lookup (10m cache) → ticket list (60s cache)
    → count aggregation → badge pill

Admin page:
  useQuery(queryKeys.freshservice.tickets) → GET /api/admin/freshservice/tickets
    → same client, same caches → render AdminTable
    → row click → drawer opens → useQuery(queryKeys.freshservice.ticket(id))
    → GET /api/admin/freshservice/tickets/[id]
    → authorization: ticket.requester_id === currentUserRequesterId
    → drawer content
```

## Error handling

| Scenario | Behavior |
|----------|----------|
| `FRESHSERVICE_API_KEY` unset | API returns 500 `{ error: "Freshservice not configured" }`; page shows `AdminError`; UserMenu badge hides silently |
| Freshservice 429 | Client retries up to 5× with exponential backoff; user sees loading state; eventual failure bubbles to `AdminError` |
| Freshservice 401/403 (bad API key) | Logged to Sentry with `setTag("integration", "freshservice")` + `setTag("failure_type", "auth")`; API returns 502; page shows `AdminError` with generic message (do not leak key) |
| Freshservice network timeout | Default fetch timeout applies; surfaces as `AdminError` |
| Non-admin without `extraAllowedRoutes` | Middleware returns 403; UserMenu badge `.catch(() => {})` swallows; no UI |
| User has no Freshservice requester record | API returns 200 with `tickets: []`, `requesterFound: false`; page shows specific empty state |
| User has 0 open tickets | `AdminEmpty` with celebratory message + portal link; count badge hides (0 doesn't render) |
| Ticket detail requester_id mismatch | API returns 403 `{ error: "Not authorized to view this ticket" }`; drawer shows error |

## Security & PII

- `description_text` can contain user-supplied content including attachments metadata, error messages, emails, and potentially sensitive IT context. Rendered via React text children only — no raw HTML injection path.
- Ticket detail endpoint enforces requester_id match — users cannot enumerate other users' tickets by incrementing ID.
- Sentry tag convention: `setTag("integration", "freshservice")` + `setTag("failure_type", "<auth|rate-limit|network|unknown>")`, matching the convention used elsewhere in the repo.
- No activity logging (read-only view, no mutations). Documented decision, not an oversight.

## Rate-limit coordination

Freshservice has a ~500/min rate limit per API key. The existing `scripts/sync-tasks.ts` runs as a manual/cron job and hits the same bucket. Mitigation:
- 60s server cache → at most ~3 requests/user/hour/endpoint for UI consumers.
- 10m requester cache → at most ~6 lookups/user/hour.
- Sync-tasks at normal cadence adds ~30-60 requests/run.
- Combined ceiling is well under 500/min at 3 users. No explicit coordination needed.

## Testing

**Unit** (`src/__tests__/freshservice.test.ts`):
- Basic auth header encoded correctly (`base64(API_KEY:X)`)
- 429 retry with exponential backoff (mock `setTimeout`)
- Pagination terminates when `length < per_page`
- Filter excludes status=5 (Closed)
- `fetchRequesterIdByEmail` returns null on empty response
- Missing API key throws

**Integration** (API route tests):
- Session missing → 401
- Non-admin session → 403 (verify middleware covers the new path)
- Admin session + mocked client → 200 with `{ tickets, lastUpdated, requesterFound }`
- Count endpoint returns correct status tallies
- Ticket detail with mismatched requester_id → 403

**Manual QA**:
- Browser: load `/admin/freshservice` as Zach; verify open tickets render, drawer opens, priority/status colors correct, external link works.
- UserMenu: open as Zach, verify badge count matches page row count for Open+Pending.
- Non-admin (test user): verify no badge, 403 on direct API call, redirect or 404 on direct page navigation.
- Unplug `FRESHSERVICE_API_KEY`: verify graceful error states.
- After running `scripts/_grant-freshservice-access.ts` for Patrick: log in as Patrick, verify page loads, sidebar shows Freshservice item, no badge in UserMenu.

## File summary

**New:**
- `src/lib/freshservice.ts`
- `src/app/api/admin/freshservice/tickets/route.ts`
- `src/app/api/admin/freshservice/tickets/[id]/route.ts`
- `src/app/api/admin/freshservice/count/route.ts`
- `src/app/admin/freshservice/page.tsx`
- `src/__tests__/freshservice.test.ts`
- `scripts/_grant-freshservice-access.ts`

**Modified:**
- `src/components/UserMenu.tsx`
- `src/components/admin-shell/nav.ts` (add Freshservice entry, rename Tickets → Bug reports)
- `src/lib/page-directory.ts` (rename label)
- `src/app/admin/tickets/page.tsx` (rename header/breadcrumb strings)
- `src/app/handbook/page.tsx` (if references admin nav label)
- `src/lib/roles.ts` (add two paths to `ADMIN_ONLY_EXCEPTIONS`)
- `src/lib/query-keys.ts`

## Rollout

Single PR. No feature flag (integration is additive; kill-switch is unsetting `FRESHSERVICE_API_KEY`).

**Post-merge steps:**
1. Confirm `FRESHSERVICE_API_KEY` present in production Vercel env (already is).
2. Run `npx tsx scripts/_grant-freshservice-access.ts patrick@photonbrothers.com caleb@photonbrothers.com` against prod DB.
3. Verify as Zach in prod.
