# My Tasks (HubSpot) Page — Design

**Date:** 2026-04-20
**Author:** Zach Rosen (with Claude)
**Status:** Draft

## Problem

PB users frequently juggle HubSpot-assigned tasks across deals, tickets, and contacts but have no unified view inside the PB Operations Suite. They're forced to hop between HubSpot and our app. A dedicated page can surface their open tasks with enough context (associated deal / ticket / contact) to act without context-switching.

## Goals (v1 — read-only)

- Every logged-in PB user whose email maps to a HubSpot owner can see **their open/incomplete tasks**.
- Date-bucketed grouping: Overdue / Today / This week / Later / No due date.
- Filters: search (subject + deal name), task type, priority, task queue.
- Each row shows subject, body preview, type icon, priority badge, due date, status, associated deal/ticket/contact (linkable), plus "Open in HubSpot" and "Copy link" actions.
- Graceful empty state when the user has no matching HubSpot owner, with audit log entry.

## Non-goals (v2 follow-ups)

- Inline "mark complete" writeback to HubSpot.
- Admin "view as another user" override.
- "Show completed (last 7 days)" toggle.
- SSE real-time updates — pull-on-focus is enough.

## Architecture

Client fetches via React Query → calls a new Next.js API route → route resolves owner from session email → queries HubSpot Tasks search API filtered by owner + open statuses → enriches with associations → returns payload.

```
UserMenu / Operations-suite tile
  └─ /dashboards/my-tasks
     └─ useQuery(["my-tasks"]) → GET /api/hubspot/tasks/mine
          ├─ resolveOwnerIdByEmail(session.user.email)
          │   ├─ found: fetchOpenTasksByOwner + fetchQueues (parallel)
          │   │   └─ enrichWithAssociations (batch-read task→deal/ticket/contact)
          │   └─ null: log MISSING_HUBSPOT_OWNER activity, return { ownerId: null }
          └─ response cached in appCache (60s) + React Query staleTime 60s
```

## Files

### New

- `src/lib/hubspot-tasks.ts`
  - `resolveOwnerIdByEmail(email: string): Promise<string | null>` — reuses the owner map pattern from `hubspot.ts` (Owners API + property definition fallback), 15-min cache.
  - `fetchOpenTasksByOwner(ownerId: string): Promise<HubSpotTask[]>` — Tasks search API, filter `hubspot_owner_id = ownerId` AND `hs_task_status IN (NOT_STARTED, IN_PROGRESS, WAITING)`. Returns `hs_task_subject`, `hs_task_body`, `hs_task_status`, `hs_task_priority`, `hs_task_type`, `hs_timestamp`, `hs_task_completion_date`, `hs_queue_membership_ids`.
  - `fetchQueues(): Promise<Queue[]>` — Owners-scoped queues list (GET `/crm/v3/owners` → queues are separate: GET `/crm/v3/objects/tasks/queues` via low-level `apiRequest`).
  - `enrichWithAssociations(tasks: HubSpotTask[]): Promise<EnrichedTask[]>` — batch-read task → deal (name), task → ticket (subject), task → contact (firstname+lastname) via `hubspotClient.crm.associations.v4.batchApi`.
  - Uses the existing `withHubSpotRetry` pattern already in `hubspot-engagements.ts` (duplicate or factor shared helper — leaning toward keeping both local to avoid premature abstraction).

- `src/app/api/hubspot/tasks/mine/route.ts`
  - `GET` handler. Returns:
    ```ts
    {
      ownerId: string | null;
      reason?: "NO_HUBSPOT_OWNER";
      tasks: EnrichedTask[];
      queues: Queue[];
      fetchedAt: string; // ISO
    }
    ```
  - If owner is null, logs `ActivityType.MISSING_HUBSPOT_OWNER` with user email in metadata.
  - Cached server-side via `appCache` key `hubspot:tasks:owner:<ownerId>`, TTL 60s.

- `src/app/dashboards/my-tasks/page.tsx`
  - Wrapped in `<DashboardShell title="My Tasks" accentColor="blue" lastUpdated={data?.fetchedAt} />`.
  - Renders `<TaskFilters>` + `<TasksGrouped>` (or empty state).

- `src/components/my-tasks/TasksGrouped.tsx`
  - Buckets tasks by due date using `hs_timestamp`:
    - `Overdue`: due before today 00:00 Denver.
    - `Today`: due today.
    - `This week`: due this calendar week (Mon-Sun) excluding today.
    - `Later`: due after this week.
    - `No due date`: timestamp missing.
  - Each bucket is a collapsible section with count.

- `src/components/my-tasks/TaskRow.tsx`
  - Layout: type icon, subject (bold), body preview (120 chars, "show more" expands inline), priority badge, due date (relative — "Today 3 PM" / "2d overdue"), status pill, associated entity chips (clickable), quick actions on hover (Open in HubSpot, Copy deal link).

- `src/components/my-tasks/TaskFilters.tsx`
  - Top row of filters. Debounced search input (300ms), `<MultiSelectFilter>` for type / priority / queue. State lifts up to page.

### Modified

- `src/components/UserMenu.tsx` — add "My Tasks" menu item above profile/sign-out, always visible when logged in.
- `src/app/suites/operations/page.tsx` — new tile: `{ href: "/dashboards/my-tasks", title: "My Tasks", ... }` positioned adjacent to the Comms tile (line ~169).
- `src/lib/roles.ts` — add `/api/hubspot/tasks/mine` and `/dashboards/my-tasks` to every role's `allowedRoutes` (including VIEWER, since this is personal-scoped data), per memory feedback about route allowlist.
- `prisma/schema.prisma` — add `MISSING_HUBSPOT_OWNER` to `ActivityType` enum. **Migration file will be generated but NOT applied automatically** per user's migration discipline.

## Data model

### New ActivityType enum value

```prisma
enum ActivityType {
  // ... existing values
  MISSING_HUBSPOT_OWNER
}
```

No new tables. No new columns on `User`.

### HubSpotTask shape (internal)

```ts
interface HubSpotTask {
  id: string;
  subject: string | null;
  body: string | null;
  status: "NOT_STARTED" | "IN_PROGRESS" | "WAITING" | "COMPLETED" | "DEFERRED";
  priority: "HIGH" | "MEDIUM" | "LOW" | null;
  type: "CALL" | "EMAIL" | "TODO" | null;
  dueAt: string | null; // ISO
  queueIds: string[];
  ownerId: string;
}

interface EnrichedTask extends HubSpotTask {
  associations: {
    deal?: { id: string; name: string };
    ticket?: { id: string; subject: string };
    contact?: { id: string; name: string };
  };
}
```

## Error handling

- **No HubSpot owner for user email** → 200 response with `{ ownerId: null, reason: "NO_HUBSPOT_OWNER", tasks: [], queues: [] }`. Activity log entry. UI shows empty state ("We couldn't find a HubSpot owner record for your email. Contact an admin to link your account.").
- **HubSpot 429** → `withHubSpotRetry` exponential backoff (3 attempts, 1.1s base, jitter).
- **HubSpot 5xx** → Sentry report + 502 to client with `{ error: "HubSpot unavailable" }`.
- **Association batch-read partial failure** → render task without association data rather than dropping the task.

## Caching

- Server: `appCache` key `hubspot:tasks:owner:<ownerId>`, TTL 60s. Cleared on user action (manual refresh).
- Client: React Query `staleTime: 60_000`, `refetchOnWindowFocus: true`.
- Owner-ID resolution cache: 15 min TTL on `email → ownerId` lookup.

## Testing

### Unit tests

- `__tests__/hubspot-tasks.test.ts`
  - `resolveOwnerIdByEmail` — found, not found, email casing.
  - Date bucket assignment — overdue, today boundary, week crossover, no-due-date.
- `__tests__/my-tasks-api.test.ts`
  - Owner found → returns tasks.
  - Owner not found → returns empty payload + logs activity.
  - HubSpot 429 → retries then succeeds.
  - Cache hit short-circuits HubSpot call.

### Manual QA

- Load `/dashboards/my-tasks` as logged-in user with known HubSpot owner → see tasks grouped.
- Impersonate user without HubSpot owner record → see empty state.
- Check `activity_log` for `MISSING_HUBSPOT_OWNER` entry.
- UserMenu dropdown → "My Tasks" link appears.
- Operations suite landing page → "My Tasks" tile next to Comms.
- Filter by queue, type, priority → results narrow correctly.
- Search "tank" → matches on subject and on associated deal name.
- Dark mode, light mode, mobile viewport render cleanly.

## Rollout

- Single PR from `feat/my-tasks-page` → `main`.
- No feature flag — empty state is the natural gate for users without HubSpot owner records.
- Prisma migration for `MISSING_HUBSPOT_OWNER` enum value generated locally but **not applied in this PR**. Ship code first (enum value tolerated by Postgres when writing via Prisma only if migration runs before). Actually — Postgres enum addition must be applied before code uses it. So: migration file committed, user runs `scripts/migrate-prod.sh` (or equivalent) before merging, or we defer the activity log write behind a try/catch until migration is confirmed applied. **Decision: wrap the log write in a try/catch so a missing enum value gracefully no-ops; this decouples code deploy from migration deploy.**

## Risks / open questions

- **HubSpot rate limits** — each page load triggers 1 search + 1 queues fetch + N association batch-reads. At 100 tasks per user, that's ~4 HubSpot calls. Acceptable.
- **Owner map freshness** — cached 15 min; a brand-new HubSpot user's tasks won't appear for up to 15 min. Acceptable.
- **Queue metadata** — HubSpot's queues API (`/crm/v3/objects/tasks/queues`) returns ALL queues, not just ones containing the user's tasks. We'll filter client-side to only show queues actually referenced by at least one loaded task (keeps the dropdown tidy).

## v2 preview (not in this PR)

- `POST /api/hubspot/tasks/[id]/complete` — marks task complete in HubSpot, invalidates cache.
- Inline "Mark complete" button on each row.
- Optimistic UI update with rollback on failure.
