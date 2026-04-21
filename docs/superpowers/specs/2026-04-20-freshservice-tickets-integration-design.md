# Freshservice Tickets Integration — Design

**Date:** 2026-04-20
**Branch:** fix/on-call-nav (will branch off for this work)
**Status:** Draft

## Problem

Zach, Patrick, and Caleb are the only PB Operations Suite users who file Freshservice tickets. Today, to see the status of an IT ticket they filed, they have to leave the suite and log into `photonbrothers.freshservice.com` separately. There is no at-a-glance signal ("do I have open tickets?") and no list view inside the suite.

## Goal

Surface a user's own open and pending Freshservice tickets inside the admin suite, with a count badge in the UserMenu for quick awareness.

**Non-goals:**
- Writing or replying to tickets from the app
- Closing tickets (scripts/sync-tasks.ts already handles that)
- All-tickets view across all requesters
- Real-time SSE push (manual refresh + 60s stale time is sufficient)
- TASKS.md integration (the existing sync script owns that)

## Users

Admin-gated. Three users today:

- **Zach** — ADMIN (native access)
- **Patrick** — not ADMIN; granted via `ADMIN_ONLY_EXCEPTIONS` + explicit `allowedRoutes` entry on his role
- **Caleb** — same treatment as Patrick

If Patrick/Caleb roles change, the exception list entries stay harmless.

## Architecture

### 1. Freshservice client — `src/lib/freshservice.ts` (new)

Typed REST wrapper. Patterns mirrored from `scripts/sync-tasks.ts` (already proven against the same API).

**Exports:**
- `freshserviceFetch(endpoint: string, opts?: RequestInit): Promise<Response>` — HTTP Basic auth (`base64(API_KEY:X)`), exponential backoff on 429 (5 attempts, 1.1 × 2^attempt + jitter), throws on non-ok. Env: `FRESHSERVICE_API_KEY`, `FRESHSERVICE_DOMAIN` (default `photonbrothers`).
- `fetchTicketsByRequester(email: string): Promise<FreshserviceTicket[]>` — calls `GET /api/v2/tickets?email={email}&per_page=100&page=N&order_by=created_at&order_type=desc`, paginates until `length < per_page`, filters to status ∈ {2, 3, 4} (Open, Pending, Resolved — excludes Closed).
- `fetchTicketDetail(id: number): Promise<FreshserviceTicket>` — `GET /api/v2/tickets/:id?include=stats`.
- `fetchRequester(id: number): Promise<FreshserviceRequester>` — used only if we need requester display names later; not called in v1 since the user's own tickets show their own name.

**Types** (exported):
```ts
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
  first_name: string;
  last_name: string;
  primary_email: string;
}

export const FRESHSERVICE_STATUS_LABELS: Record<number, string> = {
  2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed",
};
export const FRESHSERVICE_PRIORITY_LABELS: Record<number, string> = {
  1: "Low", 2: "Medium", 3: "High", 4: "Urgent",
};
```

**Server cache** (via existing `lib/cache.ts`):
- Key: `freshservice:my-tickets:<email>`
- TTL: 60s
- Reason: Freshservice API is slow (~500ms-2s) and list refresh does not need to be sub-minute.

### 2. API routes

**`GET /api/admin/freshservice/tickets`**
- Session check via `auth()`; 401 if no session.
- Role check: admin middleware (already in place for `/api/admin/*`).
- Calls `fetchTicketsByRequester(session.user.email)`.
- Returns `{ tickets: FreshserviceTicket[], lastUpdated: string }`.
- Response headers: `Cache-Control: private, max-age=60`.
- On missing `FRESHSERVICE_API_KEY`: 500 `{ error: "Freshservice not configured" }`.

**`GET /api/admin/freshservice/tickets/[id]`**
- Same auth. Calls `fetchTicketDetail(id)`.
- Returns `{ ticket: FreshserviceTicket }` (stripped of fields we don't need).

**`GET /api/admin/freshservice/count`**
- Same auth. Shares the same 60s cache key as `/tickets`.
- Returns `{ open: number, pending: number, total: number }` (counts of statuses 2, 3, and 2+3 respectively — Resolved doesn't count as "needs attention").
- Separate endpoint rather than reusing `/tickets` so UserMenu doesn't ship full ticket payloads on every page load.

### 3. Admin page — `src/app/admin/freshservice/page.tsx` (new)

Client component. Uses existing admin-shell primitives:

- `AdminPageHeader title="Freshservice Tickets" breadcrumb={["Admin", "Freshservice"]} subtitle="Your open tickets on photonbrothers.freshservice.com."`
- `AdminFilterBar` with status tabs: All / Open / Pending / Resolved (counts next to each label)
- `AdminTable` with columns:
  - `id` — formatted as `#{id}` (monospace)
  - `subject` — truncated, click opens drawer
  - `status` — pill (colors: Open=red/15, Pending=amber/15, Resolved=emerald/15)
  - `priority` — pill (Low=zinc, Medium=blue, High=amber, Urgent=red)
  - `created_at` — relative ("3d ago")
  - `due_by` — relative, red text if overdue, blank if null
- `AdminDetailDrawer` on row click → ticket detail view:
  - `AdminDetailHeader` with subject and status/priority badges
  - `AdminKeyValueGrid`: Status, Priority, Created, Updated, Due, Type, Category
  - Description (sanitized `description_text`, plain text)
  - Footer: "View in Freshservice →" external link (`https://photonbrothers.freshservice.com/a/tickets/:id`)
- Refresh button in header uses `queryClient.invalidateQueries({ queryKey: queryKeys.freshservice.root })`.
- React Query `staleTime: 60_000`, `refetchOnWindowFocus: false`.
- Empty state: `AdminEmpty` with "No open tickets 🎉" + link to Freshservice portal.
- Error state: `AdminError` with retry button.

### 4. UserMenu badge — modify `src/components/UserMenu.tsx`

Add a menu item rendered only when `isAdmin === true`, between the existing `Admin` link and `SOP Guide` link:

```tsx
<Link href="/admin/freshservice" ...>
  <svg>...ticket icon...</svg>
  Freshservice Tickets
  {ticketCount > 0 && (
    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
      {ticketCount}
    </span>
  )}
</Link>
```

Fetch count in the existing `useEffect` that calls `/api/auth/sync`:

```tsx
const [ticketCount, setTicketCount] = useState(0);
useEffect(() => {
  if (!session?.user?.email) return;
  // ...existing /api/auth/sync fetch...
  fetch("/api/admin/freshservice/count")
    .then(r => (r.ok ? r.json() : null))
    .then(d => d && setTicketCount((d.open ?? 0) + (d.pending ?? 0)))
    .catch(() => {}); // hide silently on failure
}, [session]);
```

Non-admins: fetch returns 403, silently caught, count stays 0, menu item hidden via `isAdmin` guard.

### 5. Nav registration — modify `src/components/admin-shell/nav.ts`

Add to the "Operations" group, after the existing "Tickets" item:

```ts
{ label: "Freshservice", href: "/admin/freshservice", iconName: "ticket" },
```

Rename the existing `/admin/tickets` item from `"Tickets"` to `"Bug reports"` in the same change, so the two aren't confusingly both called "Tickets". No code path change — just the `label` string.

### 6. Role allowlist — modify `src/lib/roles.ts`

The user feedback memory says new `/api/*` routes must be added to every role's `allowedRoutes` or middleware returns 403 silently. BUT `/api/admin/*` is blanket-blocked by `ADMIN_ONLY_ROUTES` regardless, so only the admin exception path applies.

Add to `ADMIN_ONLY_EXCEPTIONS`:

```ts
"/admin/freshservice",
"/api/admin/freshservice",
```

These make the routes accessible to any role that has them in `allowedRoutes`. Then add the same two paths to Patrick's and Caleb's effective roles — likely PROJECT_MANAGER (Patrick) and OPERATIONS_MANAGER or TECH_OPS (Caleb, to be confirmed during implementation by looking up their `User.roles`).

If their roles already include broad `/admin/*` via wildcard-like patterns, the exception is unnecessary. Implementation will check actual role state before the change.

### 7. Query keys — modify `src/lib/query-keys.ts`

Add a new domain:

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
  UserMenu useEffect → GET /api/admin/freshservice/count
    → session check → freshservice.ts → Freshservice API (cached 60s)
    → { open, pending, total } → badge pill

Admin page:
  useQuery(queryKeys.freshservice.tickets) → GET /api/admin/freshservice/tickets
    → same client, same cache → render AdminTable
    → row click → drawer opens → useQuery(queryKeys.freshservice.ticket(id))
    → GET /api/admin/freshservice/tickets/[id] → drawer content
```

## Error handling

| Scenario | Behavior |
|----------|----------|
| `FRESHSERVICE_API_KEY` unset | API returns 500 `{ error: "Freshservice not configured" }`; page shows `AdminError`; UserMenu badge hides silently |
| Freshservice 429 | Client retries up to 5× with exponential backoff; user sees loading state; eventual failure bubbles to `AdminError` |
| Freshservice 401 / 403 (bad API key) | Logged to Sentry with tag `freshservice:auth-failure`; API returns 502; page shows `AdminError` with generic message (do not leak key) |
| Freshservice network timeout | Default fetch timeout applies; surfaces as `AdminError` |
| Non-admin hits `/api/admin/freshservice/*` | Middleware returns 403; UserMenu badge `.catch(() => {})` swallows; no UI |
| User has 0 tickets | `AdminEmpty` with celebratory message + portal link; count badge hides (0 doesn't render) |

## Testing

**Unit** (`src/__tests__/freshservice.test.ts`):
- Basic auth header encoded correctly
- 429 retry with exponential backoff (mock `setTimeout`)
- Pagination terminates when `length < per_page`
- Filter excludes status=5 (Closed)
- Empty email throws
- Missing API key throws

**Integration** (API route tests):
- Session missing → 401
- Non-admin session → 403 (handled by middleware; verify middleware allowlist covers the new path)
- Admin session + mocked client → 200 with `{ tickets, lastUpdated }`
- Count endpoint returns correct status tallies

**Manual QA**:
- Browser: load `/admin/freshservice` as Zach; verify open tickets render, drawer opens, priority/status colors correct, external link works.
- UserMenu: open as Zach, verify badge count matches page row count for Open+Pending.
- Non-admin (test user): verify no menu item, 403 on direct API call, 404 or redirect on direct page navigation.
- Unplug `FRESHSERVICE_API_KEY` env var: verify graceful error states.

## File summary

**New:**
- `src/lib/freshservice.ts`
- `src/app/api/admin/freshservice/tickets/route.ts`
- `src/app/api/admin/freshservice/tickets/[id]/route.ts`
- `src/app/api/admin/freshservice/count/route.ts`
- `src/app/admin/freshservice/page.tsx`
- `src/__tests__/freshservice.test.ts`

**Modified:**
- `src/components/UserMenu.tsx`
- `src/components/admin-shell/nav.ts` (add entry, rename Tickets → Bug reports)
- `src/lib/roles.ts` (add to `ADMIN_ONLY_EXCEPTIONS`, update Patrick/Caleb roles if needed)
- `src/lib/query-keys.ts`

## Rollout

Single PR. No feature flag needed — feature is visually additive and role-gated. Env var `FRESHSERVICE_API_KEY` already exists in prod.

## Open questions resolved

- **Admin-only or per-user?** Admin-only. Three known users today.
- **Real-time?** No. 60s cache + manual refresh.
- **Ticket replies / closure in-app?** No. Read-only v1.
- **Patrick/Caleb access?** Via `ADMIN_ONLY_EXCEPTIONS` + explicit `allowedRoutes` entry on their roles. Confirmed during implementation.
