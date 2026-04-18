# Role Management UI Roadmap (B, C, D + column drop)

> **For agentic workers:** Use superpowers:executing-plans or superpowers:subagent-driven-development to implement. Every step that would mutate production DB is marked `[MIGRATION — orchestrator only]` and requires explicit user approval at the moment — never from pre-authorization. This rule exists because of the 2026-04-17 incident (subagent ran `prisma migrate deploy` against prod).

**Date:** 2026-04-18 (written after Phase 2 shipped)

**Prior context:**
- Phase 1 (PR #189) shipped multi-role: `User.roles: UserRole[]`, SERVICE role, canonical `ROLES` map, `resolveUserAccess` derivation.
- Phase 2 Part 1 (PR #192) shipped tiny fixes + `scripts/migrate-prod.sh` wrapper + subagent-no-migrations memory rule.
- Phase 2 Part 2A (PR #204 + #206) migrated ~85 files from shim to canonical imports.
- Phase 2 Part 2B (PR #205) deleted back-compat paths in auth/middleware/session. `User.role` column kept (Part 2B's drop was deferred).
- Step A (PR #207) shipped read-only Role Inspector at `/admin/roles`.

**What's in this plan:**
- **B** — Per-role capability toggles editable at runtime (9 booleans per role, overrides the static `defaultCapabilities`).
- **C** — Full runtime-editable role definitions (suites, routes, scope, landing cards, badges). Builds on B's merge layer.
- **D** — Per-user route grants (`extraAllowedRoutes`, `extraDeniedRoutes` on User). Parallel to B/C.
- **E** — Drop the legacy `User.role` column (the column still exists, no auth paths use it, 30min cleanup PR).

**Recommended sequencing:** B → D → E → C. B delivers most value for least risk; D is orthogonal; E is pure cleanup; C is saved for last because of lockout risk.

---

## Shared infrastructure (prerequisite for B and C)

Both B and C need a resolution layer that merges DB overrides onto the static `ROLES` map. Build this once, reuse.

### File plan

| File | Change |
|---|---|
| `src/lib/role-resolution.ts` | **New.** Exports `resolveRoleDefinition(role): RoleDefinition` that reads DB overrides and merges onto `ROLES[role]`. Cached in-memory with 30s TTL to avoid per-request DB hits. |
| `src/lib/user-access.ts` | Change `resolveEffectiveRole` to use `resolveRoleDefinition` instead of reading `ROLES` directly. |
| `src/lib/cache.ts` | Add `invalidateRoleCache(role?)` for cache bust on admin edit. |

### Resolution semantics

- For each field: override value (if non-null) wins over `ROLES[role]` static value. Null = inherit.
- Cache TTL: 30 seconds. Admin edit calls `invalidateRoleCache(role)` after writing. Short TTL means stale reads resolve on their own if invalidation misses.
- Edge runtime compat: NOT needed for this layer. Middleware will use the existing `resolveUserAccess` which calls through; only the Node-runtime layers (admin pages, API routes, /api/auth/sync) hit the DB-backed resolver. Middleware gets cached values via the JWT's `access` snapshot which refreshes on sign-in.

### Audit log additions

Extend `ActivityType` enum:
- `ROLE_CAPABILITIES_CHANGED` — for option B writes
- `ROLE_DEFINITION_CHANGED` — for option C writes
- `USER_EXTRA_ROUTES_CHANGED` — for option D writes

All log the before/after delta in `metadata.changes`.

---

## Option B — Per-role capability toggles

**Goal:** Admin edits the 9 capability booleans on any role from `/admin/roles/[role]`. Changes take effect within 30s.

**Risk:** Low. Capabilities are fine-grained (`canSyncZuper`, `canScheduleSurveys`, etc.) — they gate actions, not route access. Even if an admin accidentally disables every capability on ADMIN, they still have the admin route set, so they can't lock themselves out.

**Effort:** ~1 PR, 2 days.

### File structure

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `RoleCapabilityOverride` model. |
| `prisma/migrations/<ts>_add_role_capability_overrides/migration.sql` | Create table. |
| `src/lib/role-resolution.ts` | New (see Shared). Initial version handles capability overrides only. |
| `src/lib/user-access.ts` | `resolveEffectiveRole` reads via `resolveRoleDefinition`. |
| `src/lib/db.ts` | `getRoleCapabilityOverride(role)`, `upsertRoleCapabilityOverride(role, data)`, `resetRoleCapabilityOverride(role)`. |
| `src/app/admin/roles/[role]/page.tsx` | New page: individual role detail + capability edit form. |
| `src/app/admin/roles/page.tsx` (existing) | Link each role card to `/admin/roles/[role]` for edit. |
| `src/app/api/admin/roles/[role]/capabilities/route.ts` | `PUT` + `DELETE` (reset to default). |
| `src/__tests__/lib/role-resolution.test.ts` | Cover override precedence, null fallback, cache invalidation. |
| `src/__tests__/api/admin-roles-capabilities.test.ts` | PUT writes override, DELETE resets, non-admin rejected. |

### Schema

```prisma
model RoleCapabilityOverride {
  id                         String   @id @default(cuid())
  role                       UserRole @unique  // one override row per role
  canScheduleSurveys         Boolean?
  canScheduleInstalls        Boolean?
  canScheduleInspections     Boolean?
  canSyncZuper               Boolean?
  canManageUsers             Boolean?
  canManageAvailability      Boolean?
  canEditDesign              Boolean?
  canEditPermitting          Boolean?
  canViewAllLocations        Boolean?
  updatedAt                  DateTime @updatedAt
  updatedByEmail             String?

  @@index([role])
}
```

### Migration

```sql
-- Role-level capability overrides. Each role has 0 or 1 row here. Any non-null
-- field overrides the corresponding defaultCapability in src/lib/roles.ts. Null
-- means "inherit the code-level default." Admin edits from /admin/roles/<role>.
CREATE TABLE "RoleCapabilityOverride" (
  "id" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "canScheduleSurveys" BOOLEAN,
  "canScheduleInstalls" BOOLEAN,
  "canScheduleInspections" BOOLEAN,
  "canSyncZuper" BOOLEAN,
  "canManageUsers" BOOLEAN,
  "canManageAvailability" BOOLEAN,
  "canEditDesign" BOOLEAN,
  "canEditPermitting" BOOLEAN,
  "canViewAllLocations" BOOLEAN,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedByEmail" TEXT,
  CONSTRAINT "RoleCapabilityOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoleCapabilityOverride_role_key" ON "RoleCapabilityOverride"("role");
CREATE INDEX "RoleCapabilityOverride_role_idx" ON "RoleCapabilityOverride"("role");
```

### Resolution logic

```ts
// src/lib/role-resolution.ts
import { prisma } from "@/lib/db";
import { ROLES, type RoleDefinition } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";

const CACHE_TTL_MS = 30_000;
type CacheEntry = { def: RoleDefinition; expires: number };
const cache = new Map<UserRole, CacheEntry>();

export function invalidateRoleCache(role?: UserRole) {
  if (role) cache.delete(role);
  else cache.clear();
}

export async function resolveRoleDefinition(role: UserRole): Promise<RoleDefinition> {
  const cached = cache.get(role);
  if (cached && cached.expires > Date.now()) return cached.def;

  const base = ROLES[role];
  if (!prisma) return base;

  const override = await prisma.roleCapabilityOverride.findUnique({ where: { role } }).catch(() => null);
  if (!override) {
    cache.set(role, { def: base, expires: Date.now() + CACHE_TTL_MS });
    return base;
  }

  const defaultCapabilities = { ...base.defaultCapabilities };
  for (const key of Object.keys(defaultCapabilities) as Array<keyof typeof defaultCapabilities>) {
    const overrideVal = override[key];
    if (typeof overrideVal === "boolean") defaultCapabilities[key] = overrideVal;
  }

  const def: RoleDefinition = { ...base, defaultCapabilities };
  cache.set(role, { def, expires: Date.now() + CACHE_TTL_MS });
  return def;
}
```

`resolveUserAccess` is the caller; it currently does `ROLES[role]` directly. We update it to `await resolveRoleDefinition(role)`. Because `resolveUserAccess` is already async in middleware via the JWT sync path, this is additive.

### Admin UI — `/admin/roles/[role]`

Per-role page with:
- Header: role name, badge, current description
- Capabilities grid: 9 toggles, each showing:
  - Role default (from `ROLES[role].defaultCapabilities`)
  - Current override (or "inherit" if null)
  - Edit: toggle to true/false/inherit
- "Save" writes all 9 fields in one PUT.
- "Reset to defaults" deletes the override row entirely.
- Changed-since-save indicator.
- "Last changed by X at Y" line.

### API — `PUT /api/admin/roles/[role]/capabilities`

```ts
// Body: { canScheduleSurveys: boolean | null, ... }  (all 9 keys, null = inherit)
// Auth: ADMIN only
// Validation: role must be in ROLES; all 9 keys present in body.
// Writes: prisma.roleCapabilityOverride.upsert({ where: { role }, ... })
// Audit: logAdminActivity({ type: ROLE_CAPABILITIES_CHANGED, metadata: { role, oldCaps, newCaps } })
// Post-write: invalidateRoleCache(role)
```

`DELETE /api/admin/roles/[role]/capabilities` removes the override row and invalidates cache.

### Execution checklist

- [ ] Branch `feat/role-capability-overrides` off main.
- [ ] Add `RoleCapabilityOverride` to `schema.prisma`.
- [ ] Write migration file. **DO NOT run it.**
- [ ] Run `npx prisma generate`.
- [ ] Create `src/lib/role-resolution.ts` with `resolveRoleDefinition` + `invalidateRoleCache`.
- [ ] Write tests first: `src/__tests__/lib/role-resolution.test.ts`. Confirm they fail with "module not found".
- [ ] Implement `resolveRoleDefinition`; tests pass.
- [ ] Update `resolveUserAccess` in `src/lib/user-access.ts` to call `resolveRoleDefinition` instead of direct `ROLES[role]` lookup.
- [ ] Add `getRoleCapabilityOverride`, `upsertRoleCapabilityOverride`, `resetRoleCapabilityOverride` to `src/lib/db.ts`.
- [ ] Extend `ActivityType` enum (schema + migration — bundled in the same migration file).
- [ ] Create `/api/admin/roles/[role]/capabilities/route.ts` with PUT + DELETE.
- [ ] Write API test: `src/__tests__/api/admin-roles-capabilities.test.ts`.
- [ ] Create `/admin/roles/[role]/page.tsx` with the capability toggle grid. Use the same badge/styling as the existing inspector.
- [ ] Link from the inspector cards to `/admin/roles/[role]`.
- [ ] Run `npm run build` locally — must succeed.
- [ ] Run targeted tests: `npx jest src/__tests__/lib/role-resolution.test.ts src/__tests__/api/admin-roles-capabilities.test.ts src/__tests__/lib/user-access.test.ts`.
- [ ] Push, open PR, self-review via `code-review:code-review`.
- [ ] **[MIGRATION — orchestrator + explicit user approval]** After PR merges and Vercel deploy is READY: run `scripts/migrate-prod.sh CONFIRM` to apply the migration.
- [ ] Monitor Sentry for 30 min post-migration.
- [ ] Manual smoke: as ADMIN, visit `/admin/roles/SERVICE`, flip `canScheduleInstalls` to true, save, wait 30s, verify a SERVICE user now passes the `canScheduleInstalls` check.

### Rollback

If B breaks prod:
1. Revert the code PR (Vercel rollback to previous deploy).
2. Migration is additive (only adds a table) — safe to leave applied. Zero harm if the table exists and no code reads it.

---

## Option D — Per-user route grants

**Goal:** Admin grants a specific user access to a route without changing their role. E.g., give Nick access to `/dashboards/executive` while keeping them on the SERVICE role.

**Risk:** Low. Only affects one user at a time. Safer than B/C because no role-wide impact.

**Effort:** ~1 PR, 1 day. Can be built in parallel with B.

### File structure

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `extraAllowedRoutes` + `extraDeniedRoutes` columns to `User`. |
| `prisma/migrations/<ts>_add_user_extra_routes/migration.sql` | ALTER TABLE. |
| `src/lib/user-access.ts` | `resolveUserAccess` merges `user.extraAllowedRoutes` into the unioned `allowedRoutes`, subtracts `user.extraDeniedRoutes`. |
| `src/lib/db.ts` | `updateUserExtraRoutes(userId, { allowed, denied })`. |
| `src/app/admin/users/[userId]/page.tsx` (may not exist yet — or tab on existing admin/users modal) | New section: "Extra route grants." Add/remove list. |
| `src/app/api/admin/users/[userId]/extra-routes/route.ts` | PUT handler. |
| `src/__tests__/api/admin-users-extra-routes.test.ts` | Tests. |

### Schema

```prisma
model User {
  // ... existing fields
  extraAllowedRoutes  String[] @default([])
  extraDeniedRoutes   String[] @default([])
}
```

### Migration

```sql
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "extraAllowedRoutes" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "extraDeniedRoutes" TEXT[] NOT NULL DEFAULT '{}';
```

### Resolution logic

In `resolveUserAccess`:

```ts
// after computing access.allowedRoutes from role union:
for (const route of user.extraAllowedRoutes ?? []) access.allowedRoutes.add(route);
for (const route of user.extraDeniedRoutes ?? []) access.allowedRoutes.delete(route);
```

Denial takes precedence over role grants — even if SERVICE role grants `/dashboards/service-tickets` and the user has that in `extraDeniedRoutes`, they're blocked.

### Admin UI

Add an "Extra access" section to the user edit modal in `/admin/users`. Two lists:
- **Extra allowed routes** — admin adds paths one by one
- **Extra denied routes** — admin adds paths to explicitly revoke

Each path has a remove button. A text input + "Add" button. Autocomplete from known app routes (derived from Next.js file-system routing — a simple `find src/app -name 'page.tsx'` at build time generates a JSON list).

### API — `PUT /api/admin/users/[userId]/extra-routes`

```ts
// Body: { extraAllowedRoutes: string[], extraDeniedRoutes: string[] }
// Auth: ADMIN only
// Validation: routes must start with "/"; array length reasonable (<= 50 each)
// Audit: USER_EXTRA_ROUTES_CHANGED
// Post-write: invalidate the specific user's session cache if any
```

### Execution checklist

- [ ] Branch `feat/user-extra-routes` off main.
- [ ] Schema + migration file (not run).
- [ ] `npx prisma generate`.
- [ ] Update `src/lib/user-access.ts` + `UserLike` type to include `extraAllowedRoutes`, `extraDeniedRoutes`.
- [ ] Write test: `src/__tests__/lib/user-access.test.ts` — cover (a) extraAllowed adds route not in role, (b) extraDenied removes route in role, (c) denied wins over allowed within same user.
- [ ] Update `resolveUserAccess` to apply extras; tests pass.
- [ ] Add `updateUserExtraRoutes` helper in `db.ts`.
- [ ] Create the admin UI section (probably a new row group in the existing `/admin/users` user-edit modal).
- [ ] Create the API route.
- [ ] Write API test.
- [ ] Build + typecheck + lint clean.
- [ ] Push, PR, self-review, merge.
- [ ] **[MIGRATION — orchestrator + approval]** Run `scripts/migrate-prod.sh CONFIRM`.
- [ ] Manual smoke: grant a test user extra access to `/dashboards/executive`; confirm they can reach it without being EXECUTIVE.

### Rollback

Migration is additive. Code revert is the rollback path if needed.

---

## Option C — Fully runtime-editable role definitions

**Goal:** Admin edits every aspect of a role (suites, routes, scope, landing cards, badge) from the UI. No deploys needed to change role access.

**Risk:** HIGH. Lockout potential — admin removes `/admin/roles` from ADMIN's allowlist → can't edit anymore → needs CLI escape hatch. Also: staging/prod drift becomes real (role overrides live in DB).

**Effort:** ~3 PRs across 1-2 weeks. Depends on B's resolution layer being in place.

### Prerequisites

- Option B merged (provides `role-resolution.ts`).
- Option A shipped (provides the inspector UI we'll extend).

### File structure

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `RoleDefinitionOverride` model. |
| `prisma/migrations/<ts>_add_role_definition_overrides/migration.sql` | Create table. |
| `src/lib/role-resolution.ts` | Extend to merge both `RoleCapabilityOverride` and `RoleDefinitionOverride`. |
| `src/lib/role-guards.ts` | **New.** Invariant checks — "ADMIN must retain /admin/roles in allowedRoutes", "ADMIN must have /admin in suites", etc. Called pre-write. |
| `src/app/admin/roles/[role]/edit/page.tsx` | **New.** Full edit form. |
| `src/app/admin/roles/[role]/page.tsx` (from B) | Add "Edit full definition" button. |
| `src/app/api/admin/roles/[role]/definition/route.ts` | PUT + DELETE (reset) for the full definition override. |
| `scripts/reset-role-overrides.sh` | **New.** CLI escape hatch that wipes all overrides from DB and restores code-level defaults. For when an admin locks themselves out. Usage: `scripts/reset-role-overrides.sh CONFIRM`. |
| `src/__tests__/lib/role-resolution-full.test.ts` | Cover override precedence for every field. |
| `src/__tests__/lib/role-guards.test.ts` | Cover every invariant. |
| `src/__tests__/api/admin-roles-definition.test.ts` | API tests. |

### Schema

```prisma
model RoleDefinitionOverride {
  id              String   @id @default(cuid())
  role            UserRole @unique
  label           String?
  description     String?
  suites          String[] @default([])
  suitesOverridden Boolean @default(false)  // empty array is ambiguous ("no suites" vs "inherit"); this flag disambiguates
  allowedRoutes   String[] @default([])
  allowedRoutesOverridden Boolean @default(false)
  landingCards    Json?
  scope           Scope?
  badgeColor      String?
  badgeAbbrev     String?
  visibleInPicker Boolean?
  updatedAt       DateTime @updatedAt
  updatedByEmail  String?

  @@index([role])
}

enum Scope {
  global
  location
  owner
}
```

(The `*Overridden: Boolean` flags disambiguate "admin set the override to empty list" vs "admin didn't override". Alternative: use a single Json field for the whole override — simpler schema but loses per-field type safety. I'd go with the flag approach.)

### Resolution logic

Extends B's `resolveRoleDefinition`:

```ts
// inside resolveRoleDefinition:
const defOverride = await prisma.roleDefinitionOverride.findUnique({ where: { role } });
if (defOverride) {
  if (defOverride.label) base.label = defOverride.label;
  if (defOverride.description) base.description = defOverride.description;
  if (defOverride.suitesOverridden) base.suites = defOverride.suites;
  if (defOverride.allowedRoutesOverridden) base.allowedRoutes = defOverride.allowedRoutes;
  if (defOverride.landingCards) base.landingCards = defOverride.landingCards as LandingCard[];
  if (defOverride.scope) base.scope = defOverride.scope;
  if (defOverride.badgeColor) base.badge = { ...base.badge, color: defOverride.badgeColor };
  if (defOverride.badgeAbbrev) base.badge = { ...base.badge, abbrev: defOverride.badgeAbbrev };
  if (typeof defOverride.visibleInPicker === "boolean") base.visibleInPicker = defOverride.visibleInPicker;
}
```

### Invariant guards (pre-write)

`src/lib/role-guards.ts`:

```ts
export interface GuardViolation {
  field: string;
  message: string;
}

export function validateRoleEdit(
  role: UserRole,
  proposed: Partial<RoleDefinition>,
): GuardViolation[] {
  const violations: GuardViolation[] = [];
  if (role === "ADMIN") {
    const requiredRoutes = ["/admin", "/admin/roles", "/admin/users", "/api/admin"];
    for (const req of requiredRoutes) {
      if (proposed.allowedRoutes && !proposed.allowedRoutes.some((r) => req.startsWith(r) || r === "*")) {
        violations.push({
          field: "allowedRoutes",
          message: `ADMIN must retain access to "${req}" to prevent lockout. Add it back or cancel.`,
        });
      }
    }
    if (proposed.suites && !proposed.suites.includes("/suites/admin")) {
      violations.push({
        field: "suites",
        message: `ADMIN must retain "/suites/admin" in their suite list to prevent lockout.`,
      });
    }
  }
  // Additional invariants: every role must have at least one suite; all route strings must start with "/"; etc.
  return violations;
}
```

API handler validates before writing. If `violations.length > 0`, returns 400 with the list.

### Admin UI

`/admin/roles/[role]/edit` form:
- **Basic**: label, description, scope (select), visibleInPicker (toggle)
- **Badge**: color (color picker from 11 Tailwind families), abbrev (text)
- **Suites**: multi-select of known suite hrefs (derived from a build-time manifest)
- **Allowed routes**: large textarea or row-based editor, each row a route; autocomplete from known routes
- **Landing cards**: add/remove/reorder; each card has href (autocomplete), title, description, tag, tagColor
- **"Preview changes"** button: shows a diff panel (red/green) before save
- **"Save"** — calls PUT. If guards reject, shows violations inline on affected fields.
- **"Reset to code default"** button — DELETE.
- **"View revision history"** link — opens a read-only log of past changes (from ActivityLog filtered by ROLE_DEFINITION_CHANGED + role metadata).

Confirmation modal before save: "You're about to change <N> fields on role <X>. N users currently have this role. Continue?"

### CLI escape hatch

`scripts/reset-role-overrides.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "CONFIRM" ]]; then
  echo "Usage: scripts/reset-role-overrides.sh CONFIRM"
  echo ""
  echo "Wipes all role definition and capability overrides from the DB."
  echo "After running, every role falls back to the code defaults in src/lib/roles.ts."
  echo ""
  echo "Use this when an admin accidentally locks ADMIN out of the admin area."
  exit 1
fi

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cat > /tmp/reset-role-overrides.sql <<SQL
DELETE FROM "RoleDefinitionOverride";
DELETE FROM "RoleCapabilityOverride";
SQL

set -a && source .env && set +a
npx prisma db execute --file /tmp/reset-role-overrides.sql

echo "Done. All role overrides cleared. Restart app or wait 30s for cache to flush."
```

This sits alongside `scripts/migrate-prod.sh`. Requires the same manual confirmation pattern.

### PR breakdown

Ship as 3 sequential PRs for reviewability:

**PR C1 — Schema + resolution layer extension (no UI)**

- Adds `RoleDefinitionOverride` table and Scope enum
- Extends `resolveRoleDefinition` in `role-resolution.ts` to merge definition overrides
- Full unit test coverage for the merge
- API route exists but is stubbed (returns 501 Not Implemented) so no UI yet
- Migration applies; table is empty; nothing changes user-facing
- Safe to merge mid-week; zero user impact until C2

**PR C2 — Admin edit UI + guards**

- `role-guards.ts` with invariant validation
- Admin edit form at `/admin/roles/[role]/edit`
- API route fully implemented
- `scripts/reset-role-overrides.sh`
- Preview-before-save flow
- Still no production impact until an admin actually writes an override
- End-to-end test: as ADMIN, write an override via the UI, verify it takes effect within 30s, reset via the button, verify the default restores

**PR C3 — Revision history UI**

- Read-only revision log at `/admin/roles/[role]/history`
- Filters ActivityLog by `ROLE_DEFINITION_CHANGED` + role metadata
- Shows before/after diff for each edit
- Optional "Revert to this version" button — writes the prior snapshot back

### Execution checklist

**PR C1:**
- [ ] Branch `feat/role-definition-overrides-schema` off main (post-B merge).
- [ ] Add `Scope` enum + `RoleDefinitionOverride` to schema.
- [ ] Write migration.
- [ ] Regenerate Prisma client.
- [ ] Extend `resolveRoleDefinition` to merge definition overrides (code path unused initially — can be dead-until-data).
- [ ] Write `src/__tests__/lib/role-resolution-full.test.ts`.
- [ ] Stub out `/api/admin/roles/[role]/definition` returning 501.
- [ ] Build + tests + typecheck clean.
- [ ] Push, PR, self-review, merge.
- [ ] **[MIGRATION — orchestrator + approval]** Run migrate-prod.sh.

**PR C2:**
- [ ] Branch `feat/role-definition-override-ui` off main.
- [ ] Write `role-guards.ts` + tests.
- [ ] Implement full edit UI at `/admin/roles/[role]/edit`.
- [ ] Replace stub API with working implementation (+ guard enforcement).
- [ ] Add `scripts/reset-role-overrides.sh`.
- [ ] Manual QA: make small override (e.g. SERVICE adds /dashboards/deals), confirm SERVICE user's access, reset, confirm restoration.
- [ ] Lockout dry-run: try to save ADMIN with `/admin/roles` removed → 400.
- [ ] Build + tests + typecheck.
- [ ] Push, PR, self-review, merge. (No new migration.)

**PR C3:**
- [ ] Branch `feat/role-history-view` off main.
- [ ] Build revision history page.
- [ ] Optional revert action.
- [ ] Tests.
- [ ] Push, PR, merge.

### Rollback strategy

Three layers:

1. **Single admin undo**: the inspector shows "reset to defaults" per role. Clears that role's overrides. Recovery time ~30s.
2. **CLI wipe**: `scripts/reset-role-overrides.sh CONFIRM` clears every override. Recovery time ~30s after cache flush.
3. **Code revert**: revert the PR, redeploy. Recovery time ~2-3 min.

For the lockout scenario (ADMIN accidentally removes their own admin access):
- Dev SSHes into a machine with `.env` pointing at prod, runs `scripts/reset-role-overrides.sh CONFIRM`.
- If that's not available, the guard in `validateRoleEdit` should have prevented the commit in the first place.

---

## Option E — Drop the `User.role` column

**Goal:** Delete the legacy column. Unblocks a fully canonical schema.

**Risk:** Low-medium. Low because the column isn't used for auth. Medium because `updateUserRoles` stopped writing it in Part 2B, so `role` has been going stale — any code reading it as "primary role" sees a potentially-outdated value today. After the drop, code reading it breaks at compile time.

**Effort:** ~1 PR, 30-60 min.

### Steps

- [ ] Branch `feat/drop-user-role-column` off main.
- [ ] `rg 'user\.role\b(?!s)|dbUser\.role\b(?!s)|session\.user\.role\b(?!s)' src/ --type ts --glob '!src/__tests__/**' --glob '!src/generated/**' -P` — list remaining readers.
- [ ] For each, migrate to `user.roles[0]` or `user.roles.join(", ")` or delete if vestigial.
- [ ] Run `npx tsc --noEmit` — should be zero errors after the sweep.
- [ ] Write migration `prisma/migrations/<ts>_drop_user_role_column/migration.sql`:
  ```sql
  -- Backfill any stale `role` values first so roles[1] stays accurate for a brief
  -- window if code reverts. This is paranoia; Part 2B guarantees roles is canonical.
  UPDATE "User" SET "role" = COALESCE("roles"[1], 'VIEWER'::"UserRole");

  -- Then drop.
  ALTER TABLE "User" DROP COLUMN IF EXISTS "role";
  DROP INDEX IF EXISTS "User_role_idx";
  ```
- [ ] Remove `role` line and `@@index([role])` from `prisma/schema.prisma`.
- [ ] `npx prisma generate`.
- [ ] `npm run build` must succeed.
- [ ] Run targeted tests.
- [ ] Push, PR, self-review, merge. (Wait for Vercel deploy READY.)
- [ ] **[MIGRATION — orchestrator + approval]** Run `scripts/migrate-prod.sh CONFIRM`. Watch Sentry for 30 min.
- [ ] Verify drift script reports 0 problems.

### Rollback

If anything breaks:
1. Revert the code PR (Vercel rollback).
2. Restore the column via SQL: `ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'VIEWER'; UPDATE "User" SET "role" = COALESCE("roles"[1], 'VIEWER'::"UserRole"); CREATE INDEX "User_role_idx" ON "User"("role");`
3. Delete the drop-column migration row from `_prisma_migrations`.

(Same recovery we used for the 2026-04-17 incident.)

---

## Overall sequencing

Recommended cadence, assuming we resume Monday:

| Day | PR | Risk | Migration? |
|---|---|---|---|
| Mon AM | **Option B** (capability toggles) | Low | Yes (additive — new table) |
| Mon PM | **Option D** (per-user extra routes) | Low | Yes (additive — 2 new columns) |
| Tue | Bake. Watch for anything weird. | - | - |
| Wed | **Option E** (drop role column) | Low-medium | Yes (destructive — drop column) |
| Thu | **Option C1** (schema + resolution) | Low | Yes (additive) |
| Fri | **Option C2** (edit UI + guards + CLI escape) | Medium | No |
| Next week | **Option C3** (history + revert) | Low | No |

Each PR is independently revertible. Migrations are all orchestrator-run with explicit user approval at the moment.

---

## Guardrails applied throughout

- **Subagents never run migrations.** Per the memory rule codified 2026-04-17, every migration step is orchestrator-only. Subagents CAN write migration files; they CANNOT execute them.
- **Migrations require explicit moment-of user approval.** Not pre-authorization.
- **Commit scope discipline.** Every subagent task declares declared files upfront and verifies post-commit. Scope expansions = stop and report.
- **Full `npm run build` before every PR push.** jest doesn't catch the strict typecheck Vercel runs — as we learned 2026-04-17 with the 70-error Part 2A prod fail.
- **`scripts/migrate-prod.sh` wrapper** is the only sanctioned migration path. No direct `npx prisma migrate deploy`.
- **Bake period between risky PRs.** Each one settles before the next.

---

## Out of scope for this plan

- Role creation/deletion from the UI (always requires a Prisma enum change + migration + code edit; the enum is intentionally the boundary).
- Permissions library (the rejected Option B from the original spec).
- Functional-area scope dimension (rejected Option C from the original spec).
- Per-role home-page widget framework (live data on home, not just cards) — separate design when demand is real.
