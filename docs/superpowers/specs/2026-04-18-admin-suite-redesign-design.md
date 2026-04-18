# Admin Suite Redesign — Design Spec

**Date:** 2026-04-18
**Status:** Spec
**Author:** Zach Rosen (via Claude brainstorm)
**Phase:** 1 of a multi-phase IA overhaul; later phases deferred.

## Problem

The admin surface is nine disconnected pages at `/admin/*`:

- `/admin/users`, `/admin/roles`, `/admin/roles/[role]`, `/admin/directory`, `/admin/crew-availability`, `/admin/tickets`, `/admin/activity`, `/admin/audit`, `/admin/security`

Each page is its own `<DashboardShell>` with no connection to the others. Admins navigate by typing URLs or using Cmd+K on the global search. There's no breadcrumb, no shared nav, no landing page, no sense of "where am I in admin." Finding the right tool requires URL memory.

Tonight's `/api/admin/users/bulk-role` bug (PR #210) was a discoverability symptom. The bulk-update UI existed; the matching API did not; nobody noticed because nobody found the bulk path in the first place. Fragmented admin surface makes patterns like that invisible until they break.

The broader site has related IA problems — 94 dashboards under `/dashboards/*` with a long tail that nobody uses, 9 suites whose mental model overlaps, and non-admin users who see landing cards they 403 on click. Those are deferred to phase 2+. This spec is strictly admin-only.

## Goals

1. Every admin page shares a consistent layout with persistent nav and breadcrumb.
2. A new `/admin` landing page gives at-a-glance admin health (users, risk events, open bugs, recent activity).
3. In-shell admin search finds users, roles, activity entries, and tickets from anywhere in `/admin`.
4. Cross-links between related admin pages replace dead ends (Role Inspector links to "users with this role"; Users links to "activity for this user").
5. Unified empty/loading/error patterns across all nine pages.

## Non-goals (explicit)

- No URL changes. Every existing `/admin/*` URL stays the same.
- No changes to the underlying data, API, or auth/authz logic of the nine pages.
- No new admin features beyond what's above (e.g., no new role types, no new audit reports).
- No feature flag. The audience is ~5 admins; any regression is a ping away.
- No changes to any non-admin surface. The 7-area restructure, dashboard archival, and home-page redesign are later phases.

## Architecture

### The `<AdminShell>` component

New server component at `src/components/AdminShell.tsx`. Wraps the body of each admin page the same way `<DashboardShell>` does today, but with admin-specific chrome.

```tsx
<AdminShell title="Role Inspector" breadcrumb={["Admin", "People", "Roles"]}>
  {/* existing page body — unchanged */}
</AdminShell>
```

Props:
- `title: string` — main H1
- `breadcrumb: string[]` — segments shown above the title
- `actions?: React.ReactNode` — optional right-aligned header actions (e.g., "New user" button)

Internal structure:
- Left sidebar (sticky, 220px) with three groups — People, Operations, Audit
- Top bar with breadcrumb, title, optional actions, in-shell search box (right-aligned)
- Main content area renders children

Admin-ness is enforced by the existing `/admin` route being in `ADMIN_ONLY_ROUTES`. No new auth logic; middleware continues to gate the whole prefix.

### Sidebar grouping

```
ADMIN
──────
People
  · Users                /admin/users
  · Roles                /admin/roles
  · Directory            /admin/directory

Operations
  · Crew availability    /admin/crew-availability
  · Tickets              /admin/tickets

Audit
  · Activity log         /admin/activity
  · Audit sessions       /admin/audit
  · Security alerts      /admin/security
```

Active-link state derived from pathname.

**Collapse behavior:** 220px expanded, 64px (icon-only) collapsed. Auto-collapses at viewport width <1280px; admin can toggle manually above that. No persisted state across sessions in phase 1 — the collapsed state resets on reload.

### URL convention for deep-links and filters

Cross-links and search results land on existing pages with state in query params, not client-only state. One convention across the shell so users can bookmark and the server can render server-first:

| Link | URL |
|------|-----|
| User row from search or cross-link | `/admin/users?userId=<id>` |
| Activity for a specific user | `/admin/activity?userId=<id>` |
| Activity of a specific type | `/admin/activity?type=<ACTIVITY_TYPE>` |
| Role editor | `/admin/roles/<role>` (existing, unchanged) |
| Ticket detail from search | `/admin/tickets?ticketId=<id>` |

Each page handles the query param by scrolling the match into view and (where applicable) opening its detail panel. Pages that don't already support the query param gain one small change to do so — this is in-scope.

### New `/admin` landing page

`src/app/admin/page.tsx`. Currently `/admin` redirects to `/suites/admin`. Replace the redirect with a server component that renders:

**Row 1 — three KPI tiles:**

| Tile | Data source | Shape |
|------|-------------|-------|
| Users | `prisma.user.count()` + count where `lastLoginAt > now - 7d` | "57 total · 44 active in last 7d" |
| Risk events (7d) | `prisma.activityLog.count({ where: { riskLevel: { in: ['HIGH', 'CRITICAL'] }, createdAt: { gt: sevenDaysAgo } } })` | "3 HIGH · last: 12m ago" |
| Open bug tickets | `prisma.bugReport.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } })` | "2 open · 0 flagged urgent" |

**Row 2 — recent admin activity feed:**

`prisma.activityLog.findMany({ where: { type: { in: [...adminActivityTypes] } }, orderBy: { createdAt: 'desc' }, take: 10 })`

Admin activity types: `USER_ROLE_CHANGED`, `USER_PERMISSIONS_CHANGED`, `USER_CREATED`, `USER_DELETED`, `ROLE_CAPABILITIES_CHANGED`, `ROLE_CAPABILITIES_RESET`, `USER_EXTRA_ROUTES_CHANGED`, `SETTINGS_CHANGED`.

Each row: timestamp · actor email · description · entity link (where applicable).

The old `/suites/admin` page remains as-is for now — it's a landing dashboard different from this unified shell view. Phase 2 can decide if it's still needed.

### In-shell admin search

Search input at the top-right of the admin header (not a modal, not a new keyboard shortcut — just an input with a dropdown of results). Placeholder: "Search users, roles, activity…"

Scope:
- **Users** — match on `email` or `name` (case-insensitive); result links to the user in `/admin/users` with that user selected
- **Roles** — match on role key or label; result links to `/admin/roles/[role]`
- **Activity** — match on `description` or `userEmail` over last 30 days; result links to `/admin/activity` with that filter preloaded
- **Tickets** — match on `title` or `body` snippet; result links to `/admin/tickets`

Implementation: one new API route `/api/admin/search?q=<query>` that parallel-fires the four queries with `take: 5` each and returns `{ users, roles, activity, tickets }`. Debounced client-side at 200ms.

The new route lives under `/api/admin/*`, which is already in `ADMIN_ONLY_ROUTES` in `src/lib/roles.ts` and gated by middleware. The route handler still does an explicit fresh-DB admin check (matching the existing pattern in `/api/admin/users` — JWT can be stale). No entries are needed in each role's `allowedRoutes` because the admin-only short-circuit handles it.

The existing global Cmd+K (`<GlobalSearch>`) is untouched. Admins can still use it; it stays unaware of admin entities. This avoids polluting global search with admin data for non-admins (who can't see admin APIs anyway, but clean separation makes future work easier).

### Cross-links

Pragmatic, not exhaustive:
- Role Inspector card → "N users with this role" link → `/admin/users?role=X`
- Users table row → "View activity" link → `/admin/activity?userId=X`
- Activity log row → clickable `entityName` where `entityType` is user/role → `/admin/users/[id]` or `/admin/roles/[role]`
- Audit session detail → link to the user's row in `/admin/users`

### Unified empty/loading/error patterns

Three small shared components in `src/components/admin-shell/`:
- `<AdminEmpty icon label description action?>` — shown when a filtered list has zero results
- `<AdminLoading label?>` — centered spinner with label for server-side suspense boundaries
- `<AdminError error retry?>` — standardized error card with message + retry button

Each existing admin page's ad-hoc empty / error UI is replaced with these.

## Data flow

- Each admin page continues to fetch its own data via its existing server component or React Query hook. `<AdminShell>` is pure chrome — no data fetching.
- Landing page is a server component that runs four Prisma queries in parallel via `Promise.all`.
- In-shell search uses a single debounced client-side fetch to `/api/admin/search` and renders a dropdown.

## Error handling

- Landing page KPI tiles degrade gracefully: if one Prisma query throws, render that tile as "—" with a small inline warning; other tiles still render.
- Search dropdown shows "No results" after 300ms of stable empty state; shows "Search failed" on fetch error with retry.
- `<AdminShell>` itself has no failure modes — it's pure layout. Pages' own error boundaries handle data failures.

## Testing

- Component test for `<AdminShell>`: renders title, breadcrumb, active sidebar link matches pathname, action slot accepts children, collapse toggle works at both viewport widths.
- Component test for `<AdminEmpty>`, `<AdminLoading>`, `<AdminError>`.
- Unit test for the `/api/admin/search` route: admin-gate (returns 403 for non-admin); matches across four entity types; respects `take: 5` cap per category; returns consistent shape even when one category errors.
- Accessibility checks for the in-shell search dropdown: keyboard nav (↑/↓ through results, Enter to open, Esc to close), `aria-activedescendant` on the input reflecting focused result, input has `role="combobox"` and result list has `role="listbox"`. These checks run as part of the component test.
- Manual smoke: walk through all 9 pages + landing page locally before merge; verify sidebar active state, breadcrumb, search from each page, query-param deep-links from cross-links and search results.
- No integration test changes — the pages' data paths are unchanged.

## Rollout

- Single PR containing all changes:
  - `src/components/AdminShell.tsx` + the three helper components
  - `src/app/admin/page.tsx` (new landing)
  - `src/app/admin/layout.tsx` (applies `<AdminShell>` to all children)
  - `src/app/api/admin/search/route.ts` (new)
  - Updates to each of the 9 existing admin pages: replace their individual `<DashboardShell>` with the new shell, remove duplicated empty/error UI, add cross-links where noted
- No feature flag. Audience is ~5 admins.
- Rollback: git revert. The shell is additive — removing it leaves each page functional in its previous standalone form (after a small amount of DashboardShell-restoration).

## Risks

| Risk | Mitigation |
|------|------------|
| New sidebar takes visual space away from page bodies that already felt cramped (e.g., /admin/users has a wide table). | Sidebar auto-collapses to 64px (icon-only) at viewport widths <1280px. See "Collapse behavior" in Architecture. |
| Cross-links introduce tight coupling between admin pages. | Cross-links are simple `<Link href>` — no shared state. Each page still functions if its neighbor's URL changes. |
| The recent-activity feed on `/admin` becomes a noisy distraction. | Cap at 10 items. Filter to the admin-relevant activity types listed above, not every activity. |
| Someone lands on the old `/suites/admin` and is confused about which admin is the "real" one. | Out of scope for phase 1. Phase 2 can either delete `/suites/admin`, redirect it, or make it a dashboard of a different kind. |

## Open questions

- Do we want the landing page's recent-activity feed to auto-refresh (SSE) or stay static on pageview? Defaulting to static — refresh by reloading. Can add SSE later if it feels stale.
- Should the sidebar collapse state persist across sessions? Defaulting to no — it resets expanded on each load. Can add localStorage later if anyone asks.

## Success criteria

- From any admin page, an admin can reach any other admin page in one click (sidebar) without typing a URL.
- New admins onboard to the admin surface by landing on `/admin` and seeing the full scope of what's available.
- When a bug or support question arrives ("who changed this role?"), finding the answer is ≤2 clicks from `/admin` home.
- The `<AdminShell>` becomes the template we reuse for `<OperationsShell>`, `<EngineeringShell>`, etc. in later phases of the IA overhaul.

## What comes after

Phase 2+ scope (not part of this spec):
- Decide on the top-level IA model (Lifecycle vs Workflow vs Department vs Product — still open)
- Apply the same shell pattern to Operations, Engineering, Service, Intelligence
- Dashboard archival audit — identify and hide ~20-30 low-usage dashboards
- Unified per-role landing page pattern (reusing or replacing `/app/page.tsx`'s current role-filter logic)
- Deprecate or repurpose `/suites/admin` in favor of `/admin`

A separate brainstorm will pick up the Lifecycle vs Workflow vs Department question once we've lived inside the admin shell for a week.
