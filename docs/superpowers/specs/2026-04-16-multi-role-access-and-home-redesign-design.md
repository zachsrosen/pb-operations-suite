# Multi-role access and home-page redesign — Design

**Date:** 2026-04-16
**Status:** Draft for review
**Author:** Zach (with Claude)

## Problem

Three interlocking problems in how PB Tech Ops Suite handles role-based access and role-driven UI, surfaced by the recent SERVICE role rollout (PRs #185/#186).

### 1. Three sources of truth for "what does role X see?"

Each currently answers part of the question, independently, and they drift:

| File | Owns | Drift problem |
|---|---|---|
| `src/lib/role-permissions.ts` | `ROLE_PERMISSIONS[role].allowedRoutes` (middleware route gate), `ADMIN_ONLY_ROUTES` (overrides allowlist), per-user capability booleans (`canSyncZuper` etc.) | Adding a route to a role's allowlist is silently overridden if the route is in `ADMIN_ONLY_ROUTES`. Caught during PR #185 review — SERVICE had dead entries for `/dashboards/inventory`, `/dashboards/catalog`, `/dashboards/product-comparison`. OPERATIONS / OPERATIONS_MANAGER / PROJECT_MANAGER still have the same dead entries (out of scope for #185, still pre-existing). |
| `src/lib/suite-nav.ts` | `SUITE_SWITCHER_ALLOWLIST[role]` (suite-switcher chrome) | Not derived from role-permissions. Adding a new role (SERVICE in #185) required manually adding it here separately, easy to miss. |
| `src/app/page.tsx` | `SUITE_LINKS[].visibility` + `visibleSuites` role-branches + `ROLE_LANDING_CARDS[role]` | Not derived from either of the above. The SERVICE role added in #185 was silently broken on the home page — a SERVICE user saw Operations / D&E / P&I cards (none clickable, all 403) and did NOT see the Service Suite card they actually had access to. |

These three sources must stay in lockstep but the code offers no mechanism to enforce it.

### 2. Single-role user model

`User.role: UserRole` allows exactly one role per user. Real users have blended responsibilities — a sales manager who also runs projects, a service tech who does some operations work, a manager covering two functional areas. Today these users get the most-privileged role assigned (`PROJECT_MANAGER`) and their secondary responsibilities bleed into that role's route list, making it hard to reason about what any one role actually grants.

### 3. Home page is not role-aware in a principled way

`src/app/page.tsx` renders suite cards a user can see, but:

- The visibility model (`"all" | "admin" | "owner_admin"`) doesn't align with the role-permissions model — cards can be shown to users who can't open them, and hidden from users who can.
- Role-specific landing cards (`ROLE_LANDING_CARDS`) are a first-class concept for OPERATIONS_MANAGER, PROJECT_MANAGER, OPERATIONS, TECH_OPS, SALES — but not for newer roles (SERVICE has no entry, so their home page shows nothing useful).
- The rules for "does a role get landing cards or a suite grid" are inconsistent (some roles get landing cards + no suites, some get suites + no landing cards, some get both).

## Decision summary

1. **Single canonical role definition.** A new `src/lib/roles.ts` module defines one `RoleDefinition` per role. All other consumers (middleware, suite switcher, home page, admin UI) derive from this single map.

2. **Multi-role user model.** `User.role: UserRole` is replaced with `User.roles: UserRole[]`. A user's effective access is the union of their roles. No "primary role" concept — if a user has two roles, both roles' surfaces are visible simultaneously.

3. **Per-role home-page layouts as a first-class concept.** Every role defines its own `landingCards` list in the role definition. Home page for a user = union of all their roles' suite grids + union of all their roles' landing cards, deduped.

4. **`ADMIN_ONLY_ROUTES` is deleted.** Routes live in the roles that should access them. No secondary filter.

5. **Scope stays role-based.** `RoleDefinition.scope: "global" | "location" | "owner"` consumed by data queries. Uses existing `allowedLocations` field — no new functional-area dimension. (Explicit non-goal — see Alternatives Considered.)

## Goals

- One place to change when adding or modifying a role.
- Every card a user sees on the home page is a card they can open.
- Support `[SERVICE, OPERATIONS]`-style combined roles without bleeding one role's capabilities into the other.
- Ship consistency fixes before UX improvements, in phases.

## Non-goals (explicitly out of scope)

- **Permission-first access model.** No per-user capability grants beyond the existing override booleans (`canSyncZuper`, `canScheduleSurveys`, etc.). Migrating the ~170 files that currently role-check is a 4-6 week project that doesn't match current demand. Revisit when per-user grants become a recurring pattern.
- **Functional-area scope dimension.** No new `functionalAreas: FunctionalArea[]` field on users. Multi-role covers the use case (a user who wants both SERVICE and OPERATIONS gets both roles). Revisit if multi-function single-role users appear.
- **Role renaming or reshaping the 13-role set.** Legacy roles (OWNER → EXECUTIVE, MANAGER → PROJECT_MANAGER, DESIGNER/PERMITTING → TECH_OPS) keep normalizing. No new roles added in this redesign, no existing roles removed.
- **Runtime-customizable home-page layouts.** Users cannot rearrange their home-page cards. Layout is determined by role definition.
- **Permission override audit UI.** Per-user capability overrides remain settable via the existing admin UI; no new audit surface in this redesign.

## Architecture

### The `ROLES` map

Single module, single export, one entry per `UserRole` enum value.

```ts
// src/lib/roles.ts
import type { UserRole } from "@/generated/prisma/enums";

export type Scope = "global" | "location" | "owner";

export interface LandingCard {
  href: string;
  title: string;
  description: string;
  tag: string;
  tagColor: string;
}

export interface RoleDefinition {
  /** Display label in badges, pickers, admin UI. */
  label: string;
  /** One-line description shown in admin UI. */
  description: string;
  /** Canonical role this normalizes to. Non-legacy roles normalize to themselves. */
  normalizesTo: UserRole;
  /** Visible in the admin role picker? Legacy roles are hidden. */
  visibleInPicker: boolean;
  /** Suites this role can access (also used for suite switcher). */
  suites: string[];
  /** Routes (dashboards + APIs) this role can access. */
  allowedRoutes: string[];
  /** Landing cards for home-page daily-ops row. Empty if none. */
  landingCards: LandingCard[];
  /** Data-query scope. */
  scope: Scope;
  /** Badge display for admin UI and impersonation banner. */
  badge: { color: string; abbrev: string };
  /** Default capability overrides. Per-user User fields take precedence over these. */
  defaultCapabilities: {
    canScheduleSurveys: boolean;
    canScheduleInstalls: boolean;
    canScheduleInspections: boolean;
    canSyncZuper: boolean;
    canManageUsers: boolean;
    canManageAvailability: boolean;
    canEditDesign: boolean;
    canEditPermitting: boolean;
    canViewAllLocations: boolean;
  };
}

export const ROLES: Record<UserRole, RoleDefinition> = {
  ADMIN: { /* ... */ },
  EXECUTIVE: { /* ... */ },
  OWNER: { /* legacy, normalizesTo: EXECUTIVE, visibleInPicker: false */ },
  SERVICE: { /* ... */ },
  // ... 13 total
};

/**
 * Merge multiple role definitions into one effective definition for a multi-role user.
 * Access fields (suites, allowedRoutes) are unioned. Capability defaults use max-privilege
 * (OR across roles). Scope uses max-privilege (global > location > owner).
 */
export function resolveEffectiveRole(roles: UserRole[]): RoleDefinition;
```

### User resolution for multi-role

```ts
// src/lib/user-access.ts
export interface EffectiveUserAccess {
  roles: UserRole[];              // canonical (legacy normalized, unknown values filtered)
  suites: Set<string>;
  allowedRoutes: Set<string>;
  landingCards: LandingCard[];    // deduped by href
  scope: Scope;                   // max-privilege across roles
  capabilities: Record<CapKey, boolean>; // default-OR across roles, overridden by user fields
}

export function resolveUserAccess(user: User): EffectiveUserAccess;
```

**Resolution rules:**
- **Unknown roles** in `user.roles` (e.g. a role string that no longer exists in the `ROLES` map) are filtered out with a warning log. They never grant access. This prevents stale DB values from becoming silent access grants.
- **Empty roles array** (`user.roles = []`) resolves to the VIEWER default: no suites, minimal allowed routes (`/`, `/unassigned`, `/api/auth/*`, `/api/user/me`), no landing cards, location scope with no allowed locations. Middleware treats this as "redirect to `/unassigned`." Admin UI enforces minimum of one role at write time; empty arrays only exist for freshly-created users pre-assignment.
- **Capability OR across roles, user override wins.** `user.canSyncZuper` is `boolean | null`. If null, the effective value is `defaultCapabilities.canSyncZuper` ORed across all of the user's roles. If non-null, the user's explicit value wins regardless of role defaults — this is the "admin denies a capability for a specific user" escape hatch.

`resolveUserAccess` is called:
- In middleware (route gate).
- In `/api/auth/sync` — existing endpoint that returns `{ role: UserRole, ... }` to the client. Extend additively: the response gains `access: EffectiveUserAccess` alongside the existing `role` field (kept during Phase 1 for back-compat with any client code still reading it). Phase 2 replaces `role` with `roles`.
- In server components that render role-sensitive UI.

### Consumer changes

Every other file that currently reads roles changes to read from `ROLES` / `resolveUserAccess`:

| File | Before | After |
|---|---|---|
| `src/middleware.ts` | `canAccessRoute(user.role, path)` with special-cased ADMIN_ONLY check | `access.allowedRoutes` consulted using the same exact-match-or-prefix-match semantics as today (an allowlist entry `/api/deals` grants `/api/deals/123`; an entry without trailing slash matches both exact and `entry/*`). The existing `API_SECRET_TOKEN` machine-auth bypass path is preserved unchanged. |
| `auth.ts` / NextAuth `jwt` + `session` callbacks | JWT carries `role: string` | JWT carries `roles: string[]`. `jwt` callback sets `token.roles = user.roles`. `session` callback exposes `session.user.roles`. Back-compat: if a JWT is re-issued for a user whose record still had only the legacy `role` field (phase 1 window), populate `roles` from `[role]`. |
| `src/lib/role-permissions.ts` | `ROLE_PERMISSIONS` map + `ADMIN_ONLY_ROUTES` + `canAccessRoute` | Thin shim that re-exports `resolveUserAccess` for back-compat during Phase 1. Deleted in Phase 2. |
| `src/lib/suite-nav.ts` | `SUITE_SWITCHER_ALLOWLIST` map | `getSuiteSwitcherEntriesForRoles(roles)` derived from `ROLES[r].suites` |
| `src/app/page.tsx` | `SUITE_LINKS` + `visibleSuites` role-branches + `ROLE_LANDING_CARDS` | Reads `access.suites` + `access.landingCards` from `/api/auth/sync` response. No role-specific branches. |
| `src/app/admin/users/page.tsx` | `ROLES` / `ROLE_LABELS` / `ROLE_COLORS` arrays + multi-select fallback logic | Reads `ROLES` map + `visibleInPicker` to populate the picker. Role picker becomes multi-select (checkbox list). |
| `src/app/admin/directory/page.tsx` | same pattern | same pattern |
| `src/app/api/admin/users/route.ts` | `validRoles` array + single-role validation + `requiresLocations` gate | Array validation (all members must be in `ROLES` + `visibleInPicker`), `requiresLocations` derived from `resolveEffectiveRole(newRoles).scope` |
| `src/lib/access-scope.ts` | `ROLE_SCOPE_TYPE` | Derived from `ROLES[role].scope`. File may become a thin shim or delete. |
| `src/lib/scope-resolver.ts` | reads single `user.role` | reads `user.roles` + `resolveUserAccess` |

### Home-page rendering (deduped union)

**Client:** Server returns `access: EffectiveUserAccess` from `/api/auth/sync`. Home page renders:

1. **Pipeline-by-stage widget** — unchanged; uses `/api/deals` which already scopes by user.
2. **Suite grid** — one card per suite in `access.suites`. Cards are clickable; every card a user sees is a card their middleware would allow.
3. **Landing cards row** — `access.landingCards`, deduped by href, capped at 10 (display-only cap). Cut order when over cap: preserve role-definition declaration order, and within each role preserve the order listed in that role's `landingCards`. **Dedupe collision rule:** when two roles declare the same href with different metadata (title / description / tag), the first role in declaration order wins for the display payload. Rendered only if at least one card exists.

No special cases for specific roles in `page.tsx`. No `visibility` model. No `ROLE_LANDING_CARDS`.

### Multi-role admin UI

**Role picker in `src/app/admin/users/page.tsx`:**
- Replace the single-select `<select>` with a multi-select (checkbox list, one checkbox per role where `visibleInPicker: true`).
- Validation: at least one role must be selected (a user with zero roles is functionally blocked — use VIEWER for that intent, not empty array).
- Badge display: if single-role, show one badge (current behavior). If multi-role, show a horizontal chip list of badges.

**Admin activity logging:**
- Current: `USER_ROLE_CHANGED` with `oldRole` / `newRole`. Becomes `oldRoles` / `newRoles` (arrays) in `metadata`. Description becomes `"Changed {email} roles from [A, B] to [A, C]"`.

### Impersonation

Current state: `pb_effective_role` cookie holds one role string; `pb_is_impersonating` signals impersonation active.

New state:
- `pb_effective_roles` cookie holds a JSON-encoded array of role strings.
- `resolveEffectiveRoleFromRequest` in `scheduling-policy.ts` becomes `resolveEffectiveRolesFromRequest` returning `UserRole[]`.
- Admin impersonation UI gets a multi-select matching the admin role picker.
- Back-compat: if `pb_effective_role` (singular) is set and `pb_effective_roles` is not, treat as `[cookieRole]`.

### Legacy role normalization

`normalizesTo` field on each `RoleDefinition` replaces the `normalizeRole()` function's hardcoded list:

```ts
OWNER: { normalizesTo: "EXECUTIVE", visibleInPicker: false, /* rest defers to EXECUTIVE */ }
MANAGER: { normalizesTo: "PROJECT_MANAGER", visibleInPicker: false, /* rest defers to PROJECT_MANAGER */ }
DESIGNER: { normalizesTo: "TECH_OPS", visibleInPicker: false, /* rest defers to TECH_OPS */ }
PERMITTING: { normalizesTo: "TECH_OPS", visibleInPicker: false, /* rest defers to TECH_OPS */ }
```

`resolveUserAccess` normalizes each role in `user.roles` via `normalizesTo` before merging. Admin picker hides any role where `visibleInPicker` is false — admins can't assign legacy roles to new users, but existing users carrying legacy values keep working.

## Data model changes

### Prisma schema

```prisma
model User {
  // ...
  role   UserRole   @default(VIEWER)  // DEPRECATED: kept for Phase 1 back-compat, removed in Phase 2
  roles  UserRole[] @default([])      // NEW: canonical
  // ...
}
```

### Migration — Phase 1

Add `roles` column, backfill from existing `role`, leave `role` column in place:

```sql
ALTER TABLE "User" ADD COLUMN "roles" "UserRole"[] NOT NULL DEFAULT '{}';
UPDATE "User" SET "roles" = ARRAY["role"]::"UserRole"[] WHERE "roles" = '{}';
```

Writes during Phase 1: application code writes BOTH `role` (first element of new roles array, or VIEWER if empty) and `roles` **within a single `prisma.$transaction` or a single `update()` call that sets both columns at once** — no separate sequential writes that could drift mid-flight. Reads use `roles`.

### Migration — Phase 2

Drop the deprecated `role` column:

```sql
ALTER TABLE "User" DROP COLUMN "role";
```

Application stops dual-writing.

## Phasing

### Phase 1 — Foundation (one PR, target ~3 days)

1. Create `src/lib/roles.ts` with the full `ROLES` map. Include all 13 current roles with data ported from existing `ROLE_PERMISSIONS`, `SUITE_SWITCHER_ALLOWLIST`, `ROLE_LANDING_CARDS`, badge colors from `admin/users/page.tsx` and `admin/directory/page.tsx`.
2. Create `src/lib/user-access.ts` with `resolveUserAccess` + `resolveEffectiveRole`.
3. Add Prisma migration: new `roles` column, backfill, dual-write from application.
4. Migrate consumers in dependency order:
    - `middleware.ts` → `resolveUserAccess`
    - `suite-nav.ts` → derive from `ROLES[r].suites`
    - `/api/auth/sync` → return `EffectiveUserAccess` payload
    - `src/app/page.tsx` → render from `EffectiveUserAccess`, delete role-branches
    - Admin UIs → read `ROLES` map
5. `src/lib/role-permissions.ts` becomes a thin shim that re-exports `resolveUserAccess`-derived helpers, keeping existing import sites working without refactor. `ADMIN_ONLY_ROUTES` stays exported from the shim with a `@deprecated` JSDoc but is no longer consulted by middleware.
6. Admin role picker becomes multi-select.
7. `pb_effective_roles` cookie introduced, falls back to `pb_effective_role`.

Result: single source of truth, multi-role functional, home page fixed. No behavior change for single-role users. Old call sites compile via shim.

### Phase 2 — Cleanup (one PR, ~1 day)

1. Delete shim in `src/lib/role-permissions.ts`. Update all remaining import sites to use `resolveUserAccess`.
2. Delete `ADMIN_ONLY_ROUTES` and `ADMIN_ONLY_EXCEPTIONS`.
3. Delete `pb_effective_role` (single) cookie path.
4. Drop the `role` column from `User` (migration).
5. Stop dual-writing.
6. Update `CLAUDE.md` to reflect the new model.

Result: one file owns role definitions. No dead filters.

### Phase 3 — Richer per-role home pages (optional, separate design)

Out of scope for this spec. If/when we want dashboards that show live data (priority-queue count, crew availability) on home rather than just card links, write a new design doc.

## Testing

- Unit tests for `resolveEffectiveRole` covering single-role, multi-role, legacy role normalization, capability OR, scope max-privilege.
- Unit tests for `resolveUserAccess` covering per-user capability overrides, impersonation cookie precedence, unknown-role resilience (see below), empty-roles fallback.
- Unit tests for admin users route: multi-role assignment, location-scope requirement triggered when ANY of the roles is location-scoped, empty-array rejection.
- Existing tests will need assertion updates in three files because the underlying API signatures change (`user.role` → `user.roles`, admin PUT body shape, `canAccessRoute` signature):
  - `src/__tests__/lib/role-permissions.test.ts` — update fixtures to use `roles: [...]`; assertions on `canAccessRoute` become assertions on `resolveUserAccess(...).allowedRoutes`.
  - `src/__tests__/api/admin-users-role-update.test.ts` — PUT body becomes `{ userId, roles: [...] }`; response + mocks update accordingly.
  - `src/__tests__/lib/scope-resolver.test.ts` — user fixtures carry `roles: [...]`; scope resolution is now max-privilege across roles.
  The 3 currently-passing tests in `admin-users-role-update.test.ts` (added in PR #185) must continue to pass after update. These are contract tests and must be preserved.
- Manual QA: create a multi-role user (`[SERVICE, OPERATIONS]`), log in as them, verify suite grid and landing cards show the union. Flip to `[SERVICE]` only, verify operations content drops out.

## Risks and open questions

### Risk: Shim-layer blast radius

~170 files currently reference `role`, `UserRole`, or role strings directly. Most will work fine via the Phase 1 shim. Some may be doing arithmetic like `role === "OPERATIONS" || role === "PROJECT_MANAGER"` — these should become `roles.includes("OPERATIONS") || roles.includes("PROJECT_MANAGER")`. **Mitigation:** Phase 1 spot-checks these patterns during migration; Phase 2 audit catches the rest. Planner should confirm the current `UserRole` enum count against Prisma schema (spec estimates 13 including legacy; CLAUDE.md docs have drifted) and use that as the iteration scope for audit.

### Risk: Cookie-based impersonation array size

Browsers cap cookies at 4KB. `pb_effective_roles` with a JSON-encoded array of even 13 roles is ~200 bytes. Not a concern.

### Risk: Landing-cards clutter for multi-role users

Worst realistic case: OPERATIONS_MANAGER (6 cards) + SERVICE (3 cards) = 9 deduped. Cap at 8 in spec. **Mitigation:** cap is display-only; no data lost; role-definition order determines which cards get cut. If this becomes painful, add a user preference in Phase 3.

### Resolved: capability overrides for multi-role users

Capability defaults OR across roles (see Resolution rules above). A user with `[SERVICE, OPERATIONS]` gets `canSyncZuper: true` by default because SERVICE and OPERATIONS both set it true — the OR never goes down. If an admin wants to DENY that capability, they set the per-user override to `false`, which wins over any role default. The `User.canSyncZuper: boolean | null` data model is unchanged; the only UI change is the admin capability panel shows "Role default: TRUE (via [SERVICE, OPERATIONS]) — override: [toggle]" instead of the single-role form.

### Open question: What does `pb_effective_roles` impersonation allow?

Today admins can impersonate only non-ADMIN roles. Can they impersonate `[SERVICE, OPERATIONS]` (multi-role) even if no real user has that combination? **Proposed resolution:** yes — impersonation is for testing access, not mimicking a specific user. Restrict to the set of roles where `visibleInPicker` is true, same as the admin picker.

### Open question: Should role changes retroactively update the user's session?

Today: admin changes a user's role → user's JWT still reflects the old role until they sign out. Known issue, not this spec's problem, but worth flagging. **Proposed resolution:** out of scope; document the behavior in CLAUDE.md as-is.

## Alternatives considered

### Permission-first model (rejected)

Defining ~50-100 permission strings and making roles bundles of permissions. Route gates check specific permissions, admin UI grows to per-user permission toggles.

**Rejected** because:
- ~4-6 weeks of work vs. ~1 week for the roles-primary approach.
- ~170 files would need audit/rewrite; taxonomy mistakes would be painful to reverse.
- No concrete demand for per-user permission grants that the existing override booleans don't cover.
- Roles + multi-role assignment gets 90% of the flexibility.
- Revisit when per-user grants become a recurring pattern.

### Role + functional-area scope (rejected)

Adding `User.functionalAreas: FunctionalArea[]` to express "SERVICE coordinator who only does service work."

**Rejected** because:
- Multi-role assignment solves the same problem — a SERVICE-only coordinator simply gets `[SERVICE]` and doesn't get OPERATIONS.
- The real scope axis is location, already covered by `allowedLocations`.
- Adding a second orthogonal scope dimension is speculative; no concrete user-type demands it today.

### Primary-role concept (considered, rejected)

A user has multiple roles but one is "primary" for home-page rendering. Access is still union. Rejected during brainstorming because:
- Adds a second admin decision when assigning multi-role (which one is primary?) with no clear default.
- Hides newly-granted access behind a separate flag that admins would forget to toggle.
- Semantic mismatch: "granting a role" should mean "that role's surfaces are visible."
- Clutter concern is overstated — dedup + realistic role counts (1-2 typical) keep home pages reasonable.
- If focus-mode UX becomes desirable, it can be added as a client-side preference later without schema change.

## References

- PR #185 (SERVICE role added) — surfaced the drift issues in role-permissions.ts and ADMIN_ONLY_ROUTES.
- PR #185 code review comment — documented the ADMIN_ONLY_ROUTES short-circuit behavior.
- PR #186 (Service Suite reorg) — surfaced the home-page gap where SERVICE sees no Service Suite card.
- `CLAUDE.md` User Roles + Suite switcher visibility sections — current documentation to be updated in Phase 2.
