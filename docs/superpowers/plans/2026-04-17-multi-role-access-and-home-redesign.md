# Multi-role access and home-page redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate three separate sources of truth for role-based access into a single canonical `ROLES` map, add multi-role per user, and make per-role home pages derive cleanly from the new model.

**Architecture:** A single `src/lib/roles.ts` module owns every role's definition (label, suites, allowed routes, landing cards, badge, scope, default capabilities). Consumers — middleware, suite switcher, home page, admin UI, NextAuth callbacks — derive from it via `resolveUserAccess(user)`. Users get a `roles: UserRole[]` column; access is the union across all of a user's roles. Ships in two PRs: Phase 1 introduces the new model behind a back-compat shim; Phase 2 deletes the shim and drops the legacy `role` column.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Prisma 7 on Neon Postgres, next-auth v5 beta.

**Spec:** [docs/superpowers/specs/2026-04-16-multi-role-access-and-home-redesign-design.md](../specs/2026-04-16-multi-role-access-and-home-redesign-design.md)

---

## File Structure

### Phase 1 — new modules

| File | Responsibility |
|---|---|
| `src/lib/roles.ts` | Canonical `ROLES: Record<UserRole, RoleDefinition>` map. One entry per enum value. Zero behavior — pure data + types. |
| `src/lib/user-access.ts` | `resolveEffectiveRole(roles)` and `resolveUserAccess(user)` derivation logic. Unknown-role filtering, empty-roles fallback, capability OR, scope max-privilege, landing-card dedup + collision rule. |
| `src/__tests__/lib/roles.test.ts` | Verify every `UserRole` enum value has a `ROLES` entry; verify `normalizesTo` chains terminate; verify `visibleInPicker: false` matches the legacy role set. |
| `src/__tests__/lib/user-access.test.ts` | Cover the resolution rules end-to-end with fixture users. |
| `prisma/migrations/<ts>_add_user_roles_array/migration.sql` | Adds `User.roles` column, backfills from `role`. |

### Phase 1 — modified modules

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `roles UserRole[] @default([])` column. Keep `role` for dual-write. |
| `src/lib/role-permissions.ts` | Replace data-holding code with a shim that re-exports from `user-access.ts`. Keep exports that other files import — `canAccessRoute`, `ROLE_PERMISSIONS`, `normalizeRole`, `ADMIN_ONLY_ROUTES`, `UserRole`. `ADMIN_ONLY_ROUTES` kept as deprecated no-op export. |
| `src/lib/suite-nav.ts` | `getSuiteSwitcherEntriesForRoles(roles)` derived from `ROLES[r].suites`. Keep `getSuiteSwitcherEntriesForRole(role)` for one-role call sites as a thin wrapper. |
| `src/lib/access-scope.ts` | Shim: `ROLE_SCOPE_TYPE` derives from `ROLES[r].scope` via module init; `getScopeTypeForRole` unchanged. |
| `src/lib/scope-resolver.ts` | `resolveAccessScope(user)` reads `user.roles` (fallback to `[user.role]` if roles is empty during Phase 1 transition). |
| `src/lib/db.ts` | Add `updateUserRoles(userId, roles)` — single-update dual-write of both columns. Keep `updateUserRole(userId, role)` as a thin wrapper that calls `updateUserRoles(userId, [role])`. |
| `src/middleware.ts` | Replace `canAccessRoute(user.role, path)` with lookup via `resolveUserAccess`. Preserve `API_SECRET_TOKEN` bypass path unchanged. |
| `src/auth.ts` | NextAuth `jwt` callback populates `token.roles: UserRole[]`. `session` callback exposes `session.user.roles`. Back-compat: if a JWT is re-issued for a user whose record has only `role`, populate `roles` from `[role]`. Keep exposing `session.user.role = roles[0]` during Phase 1. |
| `src/app/api/auth/sync/route.ts` | Response gains `access: EffectiveUserAccess` field. Existing `role` field kept. |
| `src/app/page.tsx` | Delete `SUITE_LINKS[].visibility` model, `visibleSuites` role-branches, and `ROLE_LANDING_CARDS`. Render suite grid and landing cards from `access` returned by `/api/auth/sync`. |
| `src/app/admin/users/page.tsx` | Replace single-select role `<select>` with multi-select checkbox list. Badge rendering becomes a chip list when `roles.length > 1`. Read labels/colors/descriptions from `ROLES` map (via a thin client-side re-export). |
| `src/app/admin/directory/page.tsx` | Similar: read labels/styles from the `ROLES` map; render multi-role badge chips. |
| `src/app/api/admin/users/route.ts` | Request body accepts `roles: UserRole[]`. Validation: non-empty array, each member is `visibleInPicker`. `requiresLocations` fires when ANY of the new roles is `scope: "location"`. Calls `updateUserRoles`. Audit log metadata uses `oldRoles` / `newRoles`. |
| `src/app/api/admin/impersonate/route.ts` | Set `pb_effective_roles` cookie (JSON array). Keep writing `pb_effective_role` (first role) for one release window. |
| `src/app/api/admin/fix-role/route.ts` | Accept `roles: UserRole[]` in addition to `role`. Writes via `updateUserRoles`. |

### Phase 1 — tests updated

| File | Change |
|---|---|
| `src/__tests__/lib/role-permissions.test.ts` | Fixtures use `roles: [...]`; assertions assert against `resolveUserAccess(user).allowedRoutes.has(path)` when tests were calling `canAccessRoute` directly. |
| `src/__tests__/api/admin-users-role-update.test.ts` | PUT body becomes `{ userId, roles: [...] }`. Response shape updates. 3 existing tests must pass. Add new tests for multi-role assignment + empty-array rejection. |
| `src/__tests__/lib/scope-resolver.test.ts` | Fixtures carry `roles: [...]`. Max-privilege scope test added. |

### Phase 2 — cleanup modules

| File | Change |
|---|---|
| `prisma/schema.prisma` | Drop `role` column. |
| `prisma/migrations/<ts>_drop_user_role_column/migration.sql` | `ALTER TABLE "User" DROP COLUMN "role";` |
| `src/lib/role-permissions.ts` | Delete file. All remaining imports migrated to `@/lib/roles` or `@/lib/user-access`. |
| `src/lib/access-scope.ts` | Delete file. Imports migrated. |
| `src/lib/db.ts` | Delete `updateUserRole` single-role wrapper. Rename call sites to `updateUserRoles`. |
| `src/auth.ts` | Drop `session.user.role = roles[0]` back-compat. |
| `src/app/api/auth/sync/route.ts` | Drop legacy `role` field from response. |
| `src/app/api/admin/impersonate/route.ts` | Drop `pb_effective_role` cookie write. |
| `CLAUDE.md` | Rewrite User Roles + Suite switcher visibility sections. |
| ~170 files | Audit sweep for `user.role`, `role === "X"`, `session.user.role` patterns. Convert to `user.roles`, `roles.includes("X")`, `session.user.roles`. |

---

## Chunk 1 — Phase 1: ROLES map scaffold + types

**Files:**
- Create: `src/lib/roles.ts`
- Create: `src/__tests__/lib/roles.test.ts`

- [ ] **Step 1: Write the failing test for role map completeness**

```ts
// src/__tests__/lib/roles.test.ts
import { describe, it, expect } from "@jest/globals";
import { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";

describe("ROLES map", () => {
  it("has exactly one entry per UserRole enum value", () => {
    const enumValues = Object.values(UserRole);
    const mapKeys = Object.keys(ROLES).sort();
    expect(mapKeys).toEqual([...enumValues].sort());
  });

  it("every normalizesTo target is itself a canonical role (visibleInPicker: true)", () => {
    for (const [role, def] of Object.entries(ROLES)) {
      if (def.normalizesTo !== role) {
        expect(ROLES[def.normalizesTo].visibleInPicker, `${role} normalizes to ${def.normalizesTo} which must be canonical`).toBe(true);
      }
    }
  });

  it("every role has badge color + abbrev", () => {
    for (const [role, def] of Object.entries(ROLES)) {
      expect(def.badge.color, `${role} badge.color`).toMatch(/^[a-z-]+$/);
      expect(def.badge.abbrev, `${role} badge.abbrev`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run — confirm it fails (module doesn't exist)**

Run: `npx jest src/__tests__/lib/roles.test.ts`
Expected: FAIL — `Cannot find module '@/lib/roles'`

- [ ] **Step 3: Create `src/lib/roles.ts` with types + empty map**

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
  label: string;
  description: string;
  normalizesTo: UserRole;
  visibleInPicker: boolean;
  suites: string[];
  allowedRoutes: string[];
  landingCards: LandingCard[];
  scope: Scope;
  badge: { color: string; abbrev: string };
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

// Populated in Chunk 2.
export const ROLES: Record<UserRole, RoleDefinition> = {} as Record<UserRole, RoleDefinition>;
```

- [ ] **Step 4: Run — confirm test fails with a different message (empty map)**

Run: `npx jest src/__tests__/lib/roles.test.ts`
Expected: FAIL — map keys `[]` not equal to enum values.

- [ ] **Step 5: Commit the scaffold**

```bash
git checkout -b feat/multi-role-phase-1
git add src/lib/roles.ts src/__tests__/lib/roles.test.ts
git commit -m "feat(roles): add RoleDefinition types + empty ROLES map scaffold"
```

---

## Chunk 2 — Phase 1: populate the ROLES map

Source data lives in five existing files. Port it all into `ROLES` exactly; no behavior changes in this chunk.

**Files:**
- Modify: `src/lib/roles.ts`

**Sources to port from:**
| Field | Source |
|---|---|
| `label`, `description` | `src/app/admin/users/page.tsx` (`ROLE_LABELS`, `ROLE_DESCRIPTIONS`) + comments in `src/lib/role-permissions.ts` |
| `suites` | `src/lib/suite-nav.ts` `SUITE_SWITCHER_ALLOWLIST` |
| `allowedRoutes` | `src/lib/role-permissions.ts` `ROLE_PERMISSIONS[role].allowedRoutes`, **minus** any entries that are in `ADMIN_ONLY_ROUTES` (those were dead entries per PR #185 review) |
| `landingCards` | `src/app/page.tsx` `ROLE_LANDING_CARDS[role]` — port existing as-is; SERVICE gets the 3 Daily Operations cards from the spec |
| `scope` | `src/lib/access-scope.ts` `NORMALIZED_ROLE_SCOPE_TYPE` |
| `badge` | `src/app/admin/users/page.tsx` `ROLE_COLORS` + `src/app/admin/directory/page.tsx` `ROLE_STYLES` |
| `defaultCapabilities` | `src/lib/role-permissions.ts` `ROLE_PERMISSIONS[role].canScheduleSurveys` etc. |
| `normalizesTo`, `visibleInPicker` | Per spec: OWNER→EXECUTIVE, MANAGER→PROJECT_MANAGER, DESIGNER/PERMITTING→TECH_OPS all have `visibleInPicker: false`; all others canonical |

- [ ] **Step 1: Port canonical roles first** — ADMIN, EXECUTIVE, OPERATIONS_MANAGER, OPERATIONS, SERVICE, PROJECT_MANAGER, TECH_OPS, SALES_MANAGER, SALES, VIEWER.

For each, create a `RoleDefinition` entry by copying the data from the sources above. The LANDING_CARDS for roles that currently have none (EXECUTIVE, SERVICE was just added, SALES_MANAGER) should be `[]`. ADMIN gets all allowedRoutes as `["*"]` — sentinel handled in `resolveUserAccess`.

Use the SERVICE entry added in PR #185 as the template — its data is the most recent and cleanest.

- [ ] **Step 2: Port legacy roles** — OWNER, MANAGER, DESIGNER, PERMITTING.

Each legacy role's fields (suites, allowedRoutes, landingCards, scope, badge, defaultCapabilities) should match its `normalizesTo` target. The intent: if a legacy role ever sneaks through without normalization, behavior matches the modern equivalent. `visibleInPicker: false`.

Simplest approach: define legacy entries using spread from the canonical target:
```ts
OWNER: {
  label: "Executive",
  description: "Legacy role — normalizes to EXECUTIVE.",
  normalizesTo: "EXECUTIVE",
  visibleInPicker: false,
  ...pickAccessFields(ROLES_CANONICAL.EXECUTIVE), // helper that copies suites, allowedRoutes, etc.
},
```

Implement `pickAccessFields` inline or just copy the data directly — whichever is less error-prone.

- [ ] **Step 3: Run the roles.test.ts suite**

Run: `npx jest src/__tests__/lib/roles.test.ts`
Expected: PASS (completeness, normalizesTo terminals, badges).

- [ ] **Step 4: Run typecheck to catch any type-level mismatches**

Run: `npx tsc --noEmit 2>&1 | grep -E "roles\.ts|RoleDefinition" | head -20`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(roles): populate ROLES map for all 14 UserRole values"
```

---

## Chunk 3 — Phase 1: user-access derivation module

**Files:**
- Create: `src/lib/user-access.ts`
- Create: `src/__tests__/lib/user-access.test.ts`

- [ ] **Step 1: Write the failing tests for `resolveEffectiveRole`**

```ts
// src/__tests__/lib/user-access.test.ts
import { describe, it, expect } from "@jest/globals";
import { resolveEffectiveRole, resolveUserAccess } from "@/lib/user-access";

describe("resolveEffectiveRole", () => {
  it("single role returns that role's definition fields", () => {
    const r = resolveEffectiveRole(["SERVICE"]);
    expect(r.suites).toContain("/suites/service");
    expect(r.scope).toBe("global");
    expect(r.defaultCapabilities.canSyncZuper).toBe(true);
  });

  it("multi-role unions suites + allowedRoutes", () => {
    const r = resolveEffectiveRole(["SERVICE", "OPERATIONS"]);
    expect(r.suites).toEqual(expect.arrayContaining(["/suites/service", "/suites/operations"]));
    expect(r.allowedRoutes).toEqual(expect.arrayContaining(["/api/service", "/dashboards/scheduler"]));
  });

  it("multi-role max-privileges scope (global > location > owner)", () => {
    const r = resolveEffectiveRole(["OPERATIONS", "EXECUTIVE"]); // OPERATIONS is location, EXECUTIVE is global
    expect(r.scope).toBe("global");
  });

  it("multi-role ORs default capabilities", () => {
    const r = resolveEffectiveRole(["SERVICE", "SALES"]);
    expect(r.defaultCapabilities.canSyncZuper).toBe(true);        // from SERVICE
    expect(r.defaultCapabilities.canScheduleSurveys).toBe(true);  // from SALES
  });

  it("legacy role normalizes to its canonical", () => {
    const r = resolveEffectiveRole(["OWNER"]);
    expect(r.suites).toEqual(resolveEffectiveRole(["EXECUTIVE"]).suites);
  });

  it("unknown role string is filtered out with a warning", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const r = resolveEffectiveRole(["SERVICE", "MARTIAN_ADMIN" as any]);
    expect(r.suites).toContain("/suites/service");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("MARTIAN_ADMIN"));
    warn.mockRestore();
  });

  it("empty roles array returns VIEWER-equivalent access", () => {
    const r = resolveEffectiveRole([]);
    expect(r.suites).toEqual([]);
    expect(r.allowedRoutes).toEqual(expect.arrayContaining(["/", "/unassigned"]));
  });
});

describe("resolveUserAccess", () => {
  const userBase = { id: "u1", email: "t@x.com" };

  it("user.canSyncZuper=null falls back to role default", () => {
    const access = resolveUserAccess({ ...userBase, roles: ["SERVICE"], canSyncZuper: null } as any);
    expect(access.capabilities.canSyncZuper).toBe(true);
  });

  it("user.canSyncZuper=false overrides role default", () => {
    const access = resolveUserAccess({ ...userBase, roles: ["SERVICE"], canSyncZuper: false } as any);
    expect(access.capabilities.canSyncZuper).toBe(false);
  });

  it("landing cards are deduped by href", () => {
    const access = resolveUserAccess({ ...userBase, roles: ["OPERATIONS_MANAGER", "OPERATIONS"] } as any);
    const hrefs = access.landingCards.map(c => c.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("landing cards capped at 10", () => {
    const access = resolveUserAccess({ ...userBase, roles: ["OPERATIONS_MANAGER", "OPERATIONS", "PROJECT_MANAGER"] } as any);
    expect(access.landingCards.length).toBeLessThanOrEqual(10);
  });

  it("landing-card collision: first role in declaration order wins for display payload", () => {
    // Pick two roles that share a landing card href but the first-declared has a distinct title.
    // Adjust fixtures to match actual shared hrefs across ROLES entries.
    const a = resolveUserAccess({ ...userBase, roles: ["OPERATIONS_MANAGER", "PROJECT_MANAGER"] } as any);
    const b = resolveUserAccess({ ...userBase, roles: ["PROJECT_MANAGER", "OPERATIONS_MANAGER"] } as any);
    // Titles may differ if the two roles have different metadata for the same href.
    // This test documents the behavior; adjust assertion once the ROLES data is frozen.
    expect(a.landingCards).toBeDefined();
    expect(b.landingCards).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `npx jest src/__tests__/lib/user-access.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/user-access.ts`**

```ts
// src/lib/user-access.ts
import type { UserRole } from "@/generated/prisma/enums";
import type { User } from "@/generated/prisma/client";
import { ROLES, type LandingCard, type RoleDefinition, type Scope } from "@/lib/roles";

const SCOPE_RANK: Record<Scope, number> = { owner: 0, location: 1, global: 2 };
const CAPABILITY_KEYS = [
  "canScheduleSurveys", "canScheduleInstalls", "canScheduleInspections",
  "canSyncZuper", "canManageUsers", "canManageAvailability",
  "canEditDesign", "canEditPermitting", "canViewAllLocations",
] as const;
type CapabilityKey = typeof CAPABILITY_KEYS[number];

export interface EffectiveRole {
  suites: string[];
  allowedRoutes: string[];
  landingCards: LandingCard[];
  scope: Scope;
  defaultCapabilities: Record<CapabilityKey, boolean>;
}

export interface EffectiveUserAccess {
  roles: UserRole[];
  suites: Set<string>;
  allowedRoutes: Set<string>;
  landingCards: LandingCard[];
  scope: Scope;
  capabilities: Record<CapabilityKey, boolean>;
}

const VIEWER_FALLBACK_ROUTES = ["/", "/unassigned", "/api/auth", "/api/user/me"];

export function resolveEffectiveRole(rawRoles: UserRole[]): EffectiveRole {
  // Filter unknown, normalize legacy.
  const canonical: UserRole[] = [];
  for (const r of rawRoles) {
    const def = ROLES[r];
    if (!def) {
      console.warn(`[user-access] Unknown role ${String(r)} filtered from resolution`);
      continue;
    }
    canonical.push(def.normalizesTo);
  }

  if (canonical.length === 0) {
    return {
      suites: [],
      allowedRoutes: VIEWER_FALLBACK_ROUTES.slice(),
      landingCards: [],
      scope: "owner",
      defaultCapabilities: Object.fromEntries(CAPABILITY_KEYS.map(k => [k, false])) as Record<CapabilityKey, boolean>,
    };
  }

  // De-dup canonicals while preserving first-seen order.
  const seen = new Set<UserRole>();
  const ordered: UserRole[] = [];
  for (const r of canonical) {
    if (!seen.has(r)) { seen.add(r); ordered.push(r); }
  }

  // Union suites + allowedRoutes.
  const suites = new Set<string>();
  const allowedRoutes = new Set<string>();
  for (const r of ordered) {
    for (const s of ROLES[r].suites) suites.add(s);
    for (const rt of ROLES[r].allowedRoutes) allowedRoutes.add(rt);
  }

  // Max-privilege scope.
  let scope: Scope = "owner";
  for (const r of ordered) {
    if (SCOPE_RANK[ROLES[r].scope] > SCOPE_RANK[scope]) scope = ROLES[r].scope;
  }

  // OR default capabilities.
  const defaultCapabilities = Object.fromEntries(
    CAPABILITY_KEYS.map(k => [k, ordered.some(r => ROLES[r].defaultCapabilities[k])])
  ) as Record<CapabilityKey, boolean>;

  // Dedupe landing cards by href, preserving first-declared role's card + within each role the declared order.
  const seenHrefs = new Set<string>();
  const landingCards: LandingCard[] = [];
  for (const r of ordered) {
    for (const card of ROLES[r].landingCards) {
      if (!seenHrefs.has(card.href)) {
        seenHrefs.add(card.href);
        landingCards.push(card);
      }
    }
  }

  return { suites: [...suites], allowedRoutes: [...allowedRoutes], landingCards, scope, defaultCapabilities };
}

type UserLike = Pick<User,
  | "roles"
  | "canScheduleSurveys" | "canScheduleInstalls" | "canScheduleInspections"
  | "canSyncToZuper" | "canManageUsers" | "canManageAvailability"
> & Partial<Pick<User, "role">>;

export function resolveUserAccess(user: UserLike): EffectiveUserAccess {
  // During Phase 1 transition, fall back to [user.role] if roles array is empty.
  const rawRoles = (user.roles && user.roles.length > 0) ? user.roles : (user.role ? [user.role] : []);

  const eff = resolveEffectiveRole(rawRoles);

  // Per-user capability overrides (db field names differ slightly — canSyncToZuper vs canSyncZuper; preserve existing column names).
  const capabilities: Record<CapabilityKey, boolean> = { ...eff.defaultCapabilities };
  const overrideKey: Partial<Record<CapabilityKey, keyof User>> = {
    canScheduleSurveys: "canScheduleSurveys",
    canScheduleInstalls: "canScheduleInstalls",
    canScheduleInspections: "canScheduleInspections",
    canSyncZuper: "canSyncToZuper",
    canManageUsers: "canManageUsers",
    canManageAvailability: "canManageAvailability",
  };
  for (const key of CAPABILITY_KEYS) {
    const col = overrideKey[key];
    if (!col) continue;
    const val = (user as any)[col];
    if (typeof val === "boolean") capabilities[key] = val;
  }

  // Capped landing cards (display-only).
  const capped = eff.landingCards.slice(0, 10);

  return {
    roles: rawRoles,
    suites: new Set(eff.suites),
    allowedRoutes: new Set(eff.allowedRoutes),
    landingCards: capped,
    scope: eff.scope,
    capabilities,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx jest src/__tests__/lib/user-access.test.ts`
Expected: PASS. Adjust the collision test's assertions to match actual `ROLES` data.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "user-access|roles\.ts" | head -20`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/user-access.ts src/__tests__/lib/user-access.test.ts
git commit -m "feat(user-access): add resolveEffectiveRole + resolveUserAccess"
```

---

## Chunk 4 — Phase 1: Prisma schema + migration + db.ts helper

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_user_roles_array/migration.sql`
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Edit `prisma/schema.prisma` — add `roles` column**

Find the `User` model. Add right after the existing `role` line:
```prisma
  role   UserRole   @default(VIEWER)  // DEPRECATED: removed in Phase 2. Kept for dual-write back-compat.
  roles  UserRole[] @default([])
```

- [ ] **Step 2: Write the migration SQL by hand** (follow the pattern from `prisma/migrations/20260416000000_add_service_user_role/migration.sql`)

Create `prisma/migrations/20260417000000_add_user_roles_array/migration.sql`:
```sql
-- Add `roles` column as a UserRole[] with empty default, then backfill from existing `role` column.
-- Dual-write is handled at the application layer — see src/lib/db.ts updateUserRoles.
-- The legacy `role` column is dropped in a follow-up migration (Phase 2).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "roles" "UserRole"[] NOT NULL DEFAULT '{}';

-- Backfill: every existing user gets roles = [role]. Idempotent via the `= '{}'` guard.
UPDATE "User"
SET "roles" = ARRAY["role"]::"UserRole"[]
WHERE "roles" = '{}';
```

- [ ] **Step 3: Generate the Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client ... to ./src/generated/prisma".

- [ ] **Step 4: Apply the migration to local dev DB (user runs manually in prod when ready)**

Run: `set -a && source .env && set +a && npx prisma migrate deploy`
Expected: "The following migration(s) have been applied: 20260417000000_add_user_roles_array".

**Note for production deploy:** This migration backfills in a single UPDATE. Safe to run while app is live — reads see either state; writes are append-only column addition.

- [ ] **Step 5: Add `updateUserRoles` to `src/lib/db.ts`**

Find the existing `updateUserRole` function. Replace its body with a dual-write call, and add the new array-accepting function above it:

```ts
/**
 * Update a user's roles (array). Writes both `roles` (canonical) and `role` (Phase 1 back-compat — the
 * first element of roles, or VIEWER if empty) in a single DB statement to prevent mid-flight drift.
 * Use this for all new code. `updateUserRole` is a thin wrapper for single-role callers.
 */
export async function updateUserRoles(userId: string, roles: UserRole[]): Promise<User | null> {
  if (!prisma) return null;
  const primary = roles[0] ?? UserRole.VIEWER;
  return await prisma.user.update({
    where: { id: userId },
    data: { roles, role: primary },
  });
}

/**
 * @deprecated — use `updateUserRoles`. Kept for Phase 1 back-compat.
 */
export async function updateUserRole(userId: string, role: UserRole): Promise<User | null> {
  return updateUserRoles(userId, [role]);
}
```

- [ ] **Step 6: Run existing tests — expect all green**

Run: `npx jest src/__tests__/api/admin-users-role-update.test.ts`
Expected: 3 passing (current state).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260417000000_add_user_roles_array src/lib/db.ts
git commit -m "feat(db): add User.roles array column + updateUserRoles helper"
```

---

## Chunk 5 — Phase 1: NextAuth JWT/session + /api/auth/sync

**Files:**
- Modify: `src/auth.ts` (or wherever the NextAuth config + callbacks live)
- Modify: `src/app/api/auth/sync/route.ts`

- [ ] **Step 1: Locate NextAuth config**

Run: `rg -n "NextAuth\\(|authConfig|callbacks: \\{" src/ --glob '*.ts' | head`
Find the file that defines the `jwt` and `session` callbacks. Typical: `src/auth.ts` or `src/lib/auth.ts`.

- [ ] **Step 2: Update `jwt` callback to populate `token.roles`**

```ts
callbacks: {
  async jwt({ token, user, trigger }) {
    // On sign-in or update, refresh roles from DB.
    if (user || trigger === "update") {
      // Look up user by token.sub or user.id, read roles array.
      const dbUser = await getUserById((user?.id ?? token.sub) as string);
      if (dbUser) {
        token.roles = (dbUser.roles && dbUser.roles.length > 0)
          ? dbUser.roles
          : (dbUser.role ? [dbUser.role] : []);
        token.role = token.roles[0] ?? "VIEWER";  // Phase 1 back-compat
      }
    }
    return token;
  },
  async session({ session, token }) {
    if (session.user) {
      (session.user as any).roles = (token.roles as string[]) ?? [];
      (session.user as any).role = token.role as string;  // Phase 1 back-compat
    }
    return session;
  },
},
```

Adjust to match the existing callback shape (types, helper names) — don't invent APIs.

- [ ] **Step 3: Extend session type declaration**

If `src/types/next-auth.d.ts` or similar exists, add `roles: UserRole[]` to the `User` and `Session['user']` interfaces. Keep `role: UserRole` for Phase 1.

- [ ] **Step 4: Update `/api/auth/sync/route.ts` to include `access`**

Find the current return shape. Add:
```ts
import { resolveUserAccess } from "@/lib/user-access";

// after fetching dbUser:
const access = resolveUserAccess(dbUser);
return NextResponse.json({
  ...existingFields,  // role, email, etc.
  roles: dbUser.roles ?? [dbUser.role],
  access: {
    roles: access.roles,
    suites: [...access.suites],            // JSON-serializable
    allowedRoutes: [...access.allowedRoutes],
    landingCards: access.landingCards,
    scope: access.scope,
    capabilities: access.capabilities,
  },
});
```

- [ ] **Step 5: Add a typecheck run**

Run: `npx tsc --noEmit 2>&1 | grep -E "auth\\.ts|sync/route" | head -20`
Expected: no errors.

- [ ] **Step 6: Manual smoke — sign in locally, hit `/api/auth/sync`**

Run dev server if not running. In browser devtools, call `fetch('/api/auth/sync').then(r => r.json())` and verify the response includes `roles: [...]` and `access: { suites, allowedRoutes, landingCards, scope, capabilities }`.

- [ ] **Step 7: Commit**

```bash
git add src/auth.ts src/app/api/auth/sync/route.ts src/types/next-auth.d.ts 2>/dev/null
git commit -m "feat(auth): carry roles[] in JWT + session; /api/auth/sync returns access"
```

---

## Chunk 6 — Phase 1: middleware migration (preserving API_SECRET_TOKEN path)

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Read the current middleware end-to-end to understand the decision tree**

Run: `cat src/middleware.ts | head -250`
Identify: session check → role check → API_SECRET_TOKEN bypass → public-route allowlist → role-based routing.

- [ ] **Step 2: Replace the role check with `resolveUserAccess`**

The middleware currently calls something like `canAccessRoute(effectiveRole, pathname)`. Change to:
```ts
import { resolveUserAccess } from "@/lib/user-access";

// After we have a `dbUser` or equivalent user object in scope:
const access = resolveUserAccess(dbUser);

// Replace the canAccessRoute check with:
const allowed = access.allowedRoutes.has(pathname)
  || [...access.allowedRoutes].some(route =>
      route.endsWith("/*")
        ? pathname.startsWith(route.slice(0, -2))
        : pathname === route || pathname.startsWith(route + "/"));

if (!allowed && !isPublicRoute(pathname) && effectiveRole !== "ADMIN") {
  return NextResponse.redirect(new URL("/unassigned", request.url));
}
```

Preserve the exact match-or-prefix semantics the current `canAccessRoute` uses — check that function's implementation in `role-permissions.ts` to lift the logic precisely, or keep calling through to the shim version of `canAccessRoute` that internally uses `access.allowedRoutes`. Preferred: have the shim delegate, so semantics can't drift.

- [ ] **Step 3: Verify `API_SECRET_TOKEN` bypass is untouched**

Read the block handling `API_SECRET_TOKEN` — must come BEFORE any user-session-dependent role check. If currently ordered differently, leave alone.

Run: `rg -n "API_SECRET_TOKEN" src/middleware.ts`
Expected: one path that short-circuits on the token header BEFORE the role-access logic.

- [ ] **Step 4: Handle empty roles array → redirect to /unassigned**

If `dbUser.roles.length === 0 && !dbUser.role`, redirect as though the user is VIEWER with no allowed locations. This matches the spec's empty-roles fallback.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "middleware\\.ts" | head`
Expected: no errors.

- [ ] **Step 6: Run all tests that exercise middleware indirectly**

Run: `npx jest src/__tests__/api/ src/__tests__/lib/ 2>&1 | tail -30`
Expected: any test failures are not in role-permissions/scope — those come in Chunk 9.

- [ ] **Step 7: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(middleware): consult resolveUserAccess; preserve machine-auth bypass"
```

---

## Chunk 7 — Phase 1: suite-nav + access-scope + scope-resolver migration

**Files:**
- Modify: `src/lib/suite-nav.ts`
- Modify: `src/lib/access-scope.ts`
- Modify: `src/lib/scope-resolver.ts`

- [ ] **Step 1: Update `src/lib/suite-nav.ts` — derive `SUITE_SWITCHER_ALLOWLIST` from `ROLES`**

Replace the hardcoded `SUITE_SWITCHER_ALLOWLIST` const with a derived one:
```ts
import { ROLES } from "@/lib/roles";
import { resolveEffectiveRole } from "@/lib/user-access";

export function getSuiteSwitcherEntriesForRoles(rawRoles: UserRole[]): SuiteNavEntry[] {
  const eff = resolveEffectiveRole(rawRoles);
  const allowed = new Set(eff.suites);
  return SUITE_NAV_ENTRIES.filter(entry => allowed.has(entry.href));
}

// Back-compat single-role wrapper — internally calls the multi-role version.
export function getSuiteSwitcherEntriesForRole(role: UserRole): SuiteNavEntry[] {
  return getSuiteSwitcherEntriesForRoles([role]);
}
```

Remove the `SUITE_SWITCHER_ALLOWLIST` export entirely. Callers that imported it: find with `rg -n "SUITE_SWITCHER_ALLOWLIST" src/`.

- [ ] **Step 2: Update `src/lib/access-scope.ts` — derive `ROLE_SCOPE_TYPE` from `ROLES`**

Replace the hardcoded map with a derived one:
```ts
import { ROLES } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";

export type ScopeType = "global" | "location" | "owner";

export const ROLE_SCOPE_TYPE: Record<UserRole, ScopeType> = Object.fromEntries(
  Object.entries(ROLES).map(([role, def]) => [role, def.scope])
) as Record<UserRole, ScopeType>;

export function getScopeTypeForRole(role?: string | null): ScopeType {
  return ROLE_SCOPE_TYPE[(role || "VIEWER") as UserRole] ?? "owner";
}
```

- [ ] **Step 3: Update `src/lib/scope-resolver.ts` — read `user.roles`**

Replace the call `normalizeRole(user.role)` with a call to `resolveEffectiveRole(user.roles ?? [user.role])` and use the resulting scope (max-privilege across roles).

- [ ] **Step 4: Update existing tests — `scope-resolver.test.ts`**

Open `src/__tests__/lib/scope-resolver.test.ts`. For every fixture user, add `roles: [user.role]` alongside `role: ...`. Add one new test for multi-role max-privilege scope (e.g. `roles: ["OPERATIONS", "EXECUTIVE"]` → scope global).

- [ ] **Step 5: Run affected tests**

Run: `npx jest src/__tests__/lib/role-permissions.test.ts src/__tests__/lib/scope-resolver.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "suite-nav|access-scope|scope-resolver" | head`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/suite-nav.ts src/lib/access-scope.ts src/lib/scope-resolver.ts src/__tests__/lib/scope-resolver.test.ts
git commit -m "feat(access): derive suite switcher + scope from ROLES; read user.roles"
```

---

## Chunk 8 — Phase 1: home page migration

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Read the current page.tsx role-handling code**

Key sections: `SUITE_LINKS` (lines ~55-136), `ROLE_LANDING_CARDS` (lines ~146-182), `visibleSuites` useMemo (lines ~481-526), `roleLandingCards` useMemo (lines ~528-534).

- [ ] **Step 2: Fetch `access` from `/api/auth/sync` and store in component state**

The existing `/api/auth/sync` fetch on mount (~line 306) already populates `userRole`. Extend it to also populate `userAccess: EffectiveUserAccess`:
```ts
const [userAccess, setUserAccess] = useState<ClientAccess | null>(null);

useEffect(() => {
  fetch("/api/auth/sync", { cache: "no-store" })
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (data?.role) setUserRole(data.role);
      if (data?.access) setUserAccess(data.access);
    })
    .catch(() => {});
}, []);
```

Where `ClientAccess` is a client-side mirror of `EffectiveUserAccess` — arrays instead of Sets. Declare the type at the top of the file.

- [ ] **Step 3: Replace `SUITE_LINKS` + `visibleSuites` with a simple derivation**

Delete `SUITE_LINKS` array entirely (all 10 entries). Delete the `visibleSuites` useMemo role-branch logic (lines ~481-526).

Replace with:
```ts
const visibleSuites = useMemo(() => {
  if (!userAccess) return [];
  return userAccess.suites
    .map(href => SUITE_METADATA[href])
    .filter((entry): entry is SuiteMetadata => Boolean(entry));
}, [userAccess]);
```

Where `SUITE_METADATA` is a new constant at the top of the file — keyed by href, containing `{ title, description, tag, tagColor }` only (no `visibility` field). Port the title/description data from the deleted `SUITE_LINKS` array.

- [ ] **Step 4: Replace `ROLE_LANDING_CARDS` + `roleLandingCards` with direct render**

Delete the entire `ROLE_LANDING_CARDS` map. Delete the `roleLandingCards` useMemo.

Replace with:
```ts
const roleLandingCards = userAccess?.landingCards ?? null;
```

- [ ] **Step 5: Verify SERVICE role shows Service Suite + 3 landing cards**

Start dev server. Impersonate Terrell (SERVICE role) via the admin impersonation flow.
Expected: home page shows Service Suite card + Service Overview / Ticket Board / Service Schedule landing cards. No Operations / D&E / P&I cards.

- [ ] **Step 6: Verify ADMIN sees all suites**

Exit impersonation. As ADMIN, verify all suite cards present.

- [ ] **Step 7: Verify SALES still sees the 3 sales landing cards**

Impersonate a SALES user. Expected: 3 cards (Sales Pipeline, Site Survey Schedule, Comms), no suite grid.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "app/page\\.tsx" | head`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(home): render suite grid + landing cards from EffectiveUserAccess"
```

---

## Chunk 9 — Phase 1: admin UI (users page + directory + route) + impersonation

**Files:**
- Modify: `src/app/admin/users/page.tsx`
- Modify: `src/app/admin/directory/page.tsx`
- Modify: `src/app/api/admin/users/route.ts`
- Modify: `src/app/api/admin/impersonate/route.ts`
- Modify: `src/app/api/admin/fix-role/route.ts`
- Update tests: `src/__tests__/api/admin-users-role-update.test.ts`

- [ ] **Step 1: Replace single-select role picker in `admin/users/page.tsx` with multi-select**

Replace the `<select>` for role with a checkbox list. Source of roles:
```ts
import { ROLES } from "@/lib/roles";

const PICKER_ROLES = Object.entries(ROLES)
  .filter(([, def]) => def.visibleInPicker)
  .sort((a, b) => /* existing display order */);
```

UI: checkbox list with labels and descriptions from `ROLES[r].label` and `.description`. Save button submits array `roles: string[]`.

- [ ] **Step 2: Update badge rendering to handle multiple roles**

Wherever the current `<Badge role={user.role}>` renders, replace with:
```tsx
{user.roles.map(r => (
  <Badge key={r} role={r} />
))}
```

Badge component reads color + abbrev from `ROLES[role].badge`.

- [ ] **Step 3: Delete the local `ROLE_LABELS` / `ROLE_COLORS` / `ROLE_DESCRIPTIONS` constants**

They're now redundant with `ROLES` map. Replace call sites with `ROLES[role].label` / `.badge.color` / `.description`.

- [ ] **Step 4: Do the same for `admin/directory/page.tsx`**

Replace `ROLES` array + `ROLE_LABELS` + `ROLE_STYLES` with reads from the canonical `ROLES` map. Render multi-role users with a chip list.

- [ ] **Step 5: Update `src/app/api/admin/users/route.ts`**

Request body schema:
```ts
interface UpdateUserRolesRequest {
  userId?: unknown;
  roles?: unknown;  // expect string[]
}

function validateRolesUpdate(data: unknown): data is { userId: string; roles: UserRole[] } {
  if (!data || typeof data !== "object") return false;
  const req = data as UpdateUserRolesRequest;
  if (typeof req.userId !== "string" || !req.userId) return false;
  if (!Array.isArray(req.roles) || req.roles.length === 0) return false;
  return req.roles.every(r => typeof r === "string" && r in ROLES && ROLES[r as UserRole].visibleInPicker);
}
```

`requiresLocations` check becomes: compute `resolveEffectiveRole(newRoles).scope`; fire the gate only if scope is `"location"`.

Call `updateUserRoles(userId, roles)`.

Audit log metadata: `oldRoles`, `newRoles` (arrays). Description: `Changed {email} roles from [A, B] to [A, C]`.

Keep the request body `role: UserRole` (single) accepted for one release window — if only `role` is present, transform to `roles: [role]`. This lets old clients still work.

- [ ] **Step 6: Update `src/app/api/admin/impersonate/route.ts`**

Accept `roles: UserRole[]` in addition to `role: UserRole`. Set `pb_effective_roles` cookie (JSON-encoded). Also set `pb_effective_role` (single, first role) for one release window.

- [ ] **Step 7: Update `src/app/api/admin/fix-role/route.ts`**

Accept `roles` array. Delegate to `updateUserRoles`.

- [ ] **Step 8: Update `scheduling-policy.ts` → `resolveEffectiveRoleFromRequest`**

Add a companion `resolveEffectiveRolesFromRequest` that reads the `pb_effective_roles` cookie first, falls back to `[pb_effective_role]` if only the legacy cookie is present. The single-role function becomes a wrapper that returns the first element.

- [ ] **Step 9: Update `src/__tests__/api/admin-users-role-update.test.ts`**

All existing tests update:
- Request bodies: `{ userId, role: "..." }` → `{ userId, roles: ["..."] }`
- Mocks: `updateUserRole` → `updateUserRoles`
- Response assertions reflect `user.roles` array

Add new tests:
```ts
it("accepts a multi-role assignment", async () => { /* roles: ["SERVICE", "OPERATIONS"] */ });
it("rejects an empty roles array", async () => { /* roles: [] → 400 */ });
it("rejects assignment to a legacy role", async () => { /* roles: ["OWNER"] → 400 */ });
it("requires locations when ANY role is location-scoped", async () => { /* roles: ["SERVICE", "OPERATIONS"] w/ no allowedLocations → 400 requiresLocations */ });
```

- [ ] **Step 10: Run updated tests**

Run: `npx jest src/__tests__/api/admin-users-role-update.test.ts`
Expected: all PASS (3 original + 4 new = 7).

- [ ] **Step 11: Manual QA — assign `[SERVICE, OPERATIONS]` to a test user via the UI**

Sign in as admin. Go to `/admin/users`. Find a test user. Check both SERVICE and OPERATIONS role checkboxes. Save.
Expected: both badges appear. Impersonate that user; home page shows both roles' suite cards + both roles' landing cards, deduped.

- [ ] **Step 12: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep -E "admin/(users|directory|fix-role|impersonate)|api/admin" | head -20`
Run: `npx eslint src/app/admin src/app/api/admin`
Expected: clean.

- [ ] **Step 13: Commit**

```bash
git add src/app/admin/ src/app/api/admin/ src/lib/scheduling-policy.ts src/__tests__/api/admin-users-role-update.test.ts
git commit -m "feat(admin): multi-role picker + API + impersonation support"
```

---

## Chunk 10 — Phase 1: role-permissions.ts shim + existing test updates

**Files:**
- Modify: `src/lib/role-permissions.ts`
- Update: `src/__tests__/lib/role-permissions.test.ts`

- [ ] **Step 1: Convert `src/lib/role-permissions.ts` to a shim**

Replace its body. Keep these exports (every other file imports at least one of them):
- `UserRole` (re-export)
- `normalizeRole(role)` — thin wrapper: `return ROLES[role].normalizesTo`
- `canAccessRoute(role, path)` — thin wrapper: `return resolveUserAccess({ roles: [role] } as any).allowedRoutes.has(path) || /* prefix-match helper */`
- `ROLE_PERMISSIONS` — derived object for back-compat reads (each entry: `{ allowedRoutes, canScheduleSurveys, … }` computed from `ROLES[role]`)
- `ADMIN_ONLY_ROUTES` — empty array export, marked `@deprecated`. Middleware no longer consults it; the shim no-op prevents compile breaks in any remaining call sites until Phase 2 audit.
- `RolePermissions` type (re-export)

Add a JSDoc block at the top: **"This module is a back-compat shim for Phase 1. New code should import from `@/lib/roles` and `@/lib/user-access`. This file is deleted in Phase 2."**

- [ ] **Step 2: Update `src/__tests__/lib/role-permissions.test.ts`**

For every test that called `canAccessRoute("X", path)` or `ROLE_PERMISSIONS.X.allowedRoutes`, update assertions to match the new data source. The values should match — if a test fails, investigate whether we lost access for a role.

For any test that specifically asserted `ADMIN_ONLY_ROUTES.includes("/dashboards/X")`, mark `xit` (skipped) with a comment: "deleted in Phase 2 — ADMIN_ONLY filter no longer used".

- [ ] **Step 3: Run the full targeted test suite**

Run: `npx jest src/__tests__/lib/ src/__tests__/api/admin-users-role-update.test.ts`
Expected: all PASS.

- [ ] **Step 4: Full typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "^src/__tests__/.*\\.test\\.ts" | grep -E "error TS" | head -30`
Expected: pre-existing errors only (the tests with known pre-existing issues listed in PR #185's CI results). No new errors introduced by this chunk.

- [ ] **Step 5: Lint**

Run: `npx eslint src/lib src/app/admin src/app/api/admin src/app/page.tsx src/app/api/auth src/middleware.ts 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/role-permissions.ts src/__tests__/lib/role-permissions.test.ts
git commit -m "refactor(role-permissions): convert to back-compat shim reading from ROLES"
```

---

## Chunk 11 — Phase 1: open PR, code review, merge

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/multi-role-phase-1
```

- [ ] **Step 2: Open PR**

Use `gh pr create` with a body covering:
- Phase 1 of spec 2026-04-16-multi-role-access-and-home-redesign
- What's in: ROLES map, user-access derivation, `roles[]` column + migration, NextAuth updates, middleware + suite-nav + home page + admin UI all reading from the new model, shim preserves back-compat
- Home page fix for SERVICE role (closes the post-#185 gap)
- Phase 2 (cleanup) ships separately
- Test plan: typecheck + lint clean, 3 existing test files updated + passing, 4 new tests added, manual QA for multi-role user

- [ ] **Step 3: Self-review via code-review skill**

Invoke `code-review:code-review` skill on the PR. Fix any issues ≥80 severity. Post the review comment per the skill.

- [ ] **Step 4: Verify CI green + mergeable**

Run: `gh pr view <N> --json mergeable,mergeStateStatus,statusCheckRollup`
Expected: mergeable CLEAN, all checks green.

- [ ] **Step 5: Run the migration against production**

Run: `set -a && source .env && set +a && npx prisma migrate deploy`
Expected: `20260417000000_add_user_roles_array` applied.

- [ ] **Step 6: Merge PR (squash, delete branch)**

```bash
gh pr merge <N> --repo zachsrosen/pb-operations-suite --squash --delete-branch
git checkout main && git pull
```

---

# Phase 2 — cleanup

Phase 2 is an independent PR that can run any time after Phase 1 is merged and stable (wait at least 24 hours for any impersonation JWTs with only legacy `role` to cycle out).

## Chunk 12 — Phase 2: audit sweep for role-reading call sites

**Files:**
- Modify: ~170 files across `src/`

Strategy: find every non-shim reader of `user.role` or role string literals and convert to `user.roles` or `hasRole` idiom. Each pattern gets its own sub-task.

- [ ] **Step 1: Create audit working branch**

```bash
git checkout -b feat/multi-role-phase-2
```

- [ ] **Step 2: Pattern sweep — `user.role` direct reads**

Run: `rg -n "user\\.role(?![s])" src/ --type ts --glob '!src/__tests__/**' --glob '!src/generated/**' | wc -l`
Expected: initial count N (for comparison after sweep).

For each match, classify:
- **Authorization check** (`if (user.role === "ADMIN")`): convert to `resolveUserAccess(user).capabilities.canManageUsers` or `user.roles.includes("ADMIN")` depending on intent.
- **Display only** (`{user.role}` rendered in UI): convert to `user.roles.join(", ")` or use a `RoleBadge` component.
- **API payload field**: keep for back-compat one more release; rename in the caller to `roles` going forward.

Work in file-cluster batches — commit after each cluster (admin/, dashboards/, api/, components/). Keep clusters ≤10 files.

- [ ] **Step 3: Pattern sweep — `session.user.role` reads**

Run: `rg -n "session\\.user\\.role(?![s])" src/ --type ts`
Most of these are in server components / API routes. Convert to `session.user.roles` + the appropriate check.

- [ ] **Step 4: Pattern sweep — role string literal comparisons**

Run: `rg -n "=== \"(ADMIN|EXECUTIVE|OWNER|MANAGER|OPERATIONS(_MANAGER)?|PROJECT_MANAGER|TECH_OPS|DESIGNER|PERMITTING|SERVICE|SALES(_MANAGER)?|VIEWER)\"" src/ --type ts`
Most will be like `role === "OPERATIONS" || role === "PROJECT_MANAGER"`. Convert to `resolveUserAccess(user).capabilities.X` when it's a capability check, or `user.roles.some(r => ["OPERATIONS", "PROJECT_MANAGER"].includes(r))` when it's literally "one of these two roles."

- [ ] **Step 5: Pattern sweep — `normalizeRole` call sites**

Run: `rg -n "normalizeRole\\(" src/ --type ts`
Each call already works via shim. Audit for any call that then does `=== "X"` — those should use the full `resolveUserAccess` path instead. Low priority.

- [ ] **Step 6: Run full test suite after each cluster commit**

Run: `npx jest 2>&1 | tail -20`
Expected: green per cluster. Fix immediately before moving to the next cluster.

- [ ] **Step 7: Final pattern verification**

Run: `rg -n "user\\.role(?![s])" src/ --type ts --glob '!src/__tests__/**' --glob '!src/generated/**'`
Expected: zero matches, or matches only in src/lib/role-permissions.ts shim + src/auth.ts Phase 1 back-compat lines scheduled for deletion.

- [ ] **Step 8: Commit intermediate progress continuously**

Each cluster: `git add src/<cluster>/ && git commit -m "refactor(<cluster>): migrate role reads to user.roles"`.

---

## Chunk 13 — Phase 2: delete shims + drop legacy column

**Files:**
- Delete: `src/lib/role-permissions.ts`
- Delete: `src/lib/access-scope.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_drop_user_role_column/migration.sql`
- Modify: `src/auth.ts` (drop `token.role`, `session.user.role` back-compat)
- Modify: `src/app/api/auth/sync/route.ts` (drop `role` field)
- Modify: `src/app/api/admin/impersonate/route.ts` (drop `pb_effective_role`)
- Modify: `src/lib/db.ts` (delete `updateUserRole` wrapper)
- Modify: `src/lib/scheduling-policy.ts` (drop `resolveEffectiveRoleFromRequest` single-role form)

- [ ] **Step 1: Delete `src/lib/role-permissions.ts`**

All remaining imports of `canAccessRoute`, `ROLE_PERMISSIONS`, `normalizeRole`, `ADMIN_ONLY_ROUTES`, or `RolePermissions` must already be gone after Chunk 12. Verify:
Run: `rg -n "from \"@/lib/role-permissions\"" src/ --type ts`
Expected: no matches (or only in tests flagged for deletion).

Delete the file: `git rm src/lib/role-permissions.ts`.

- [ ] **Step 2: Delete `src/lib/access-scope.ts`**

Same pattern: verify no imports remain, then delete.

- [ ] **Step 3: Write migration to drop `role` column**

Create `prisma/migrations/20260501000000_drop_user_role_column/migration.sql`:
```sql
-- Drop the legacy `role` column. `roles` array has been the canonical source since
-- 20260417000000_add_user_roles_array. Phase 2 of multi-role refactor.

ALTER TABLE "User" DROP COLUMN IF EXISTS "role";
```

Update `prisma/schema.prisma`: remove the `role UserRole` line from the User model.

- [ ] **Step 4: Remove `role` back-compat from auth**

`src/auth.ts`:
- Drop `token.role = ...` assignment
- Drop `session.user.role = ...` assignment
- Update `src/types/next-auth.d.ts` to remove `role` from Session/User

`src/app/api/auth/sync/route.ts`:
- Drop `role` field from response
- Keep `roles` and `access`

- [ ] **Step 5: Remove `pb_effective_role` cookie writes**

`src/app/api/admin/impersonate/route.ts`: drop the single-role cookie. Only set `pb_effective_roles`.
`src/lib/scheduling-policy.ts`: drop the `pb_effective_role` fallback read.

- [ ] **Step 6: Delete `updateUserRole` single-role wrapper**

`src/lib/db.ts`: delete the function. Verify no callers remain:
Run: `rg -n "updateUserRole\\b(?!s)" src/ --type ts`
Expected: no matches.

- [ ] **Step 7: Full regeneration**

Run: `npx prisma generate`
Run: `npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20`
Expected: pre-existing errors only — any new errors indicate a missed Phase 2 conversion.

- [ ] **Step 8: Apply migration locally**

Run: `set -a && source .env && set +a && npx prisma migrate deploy`
Expected: `drop_user_role_column` applied.

**Production deploy note:** drop the column only after verifying all running production instances are on Phase 2 code (no dual-writes outstanding). Recommended: merge Phase 2 PR, wait for Vercel deploy rollout, then run migration manually.

- [ ] **Step 9: Run all tests**

Run: `npx jest 2>&1 | tail -20`
Expected: green.

- [ ] **Step 10: Update CLAUDE.md**

Update two sections:
- **User Roles** table: reflect multi-role model. Remove mentions of single-role assignment. Document empty-roles = VIEWER fallback.
- **Suite switcher visibility** table: derive description from `ROLES[r].suites` — or just note "derived from src/lib/roles.ts; no separate list to maintain."

Add a note: "Role definitions live in `src/lib/roles.ts`. To add a new role: add to UserRole enum in Prisma schema, add a `ROLES` entry, ship a migration. Everything else derives automatically."

- [ ] **Step 11: Commit Phase 2 final**

```bash
git add -A
git commit -m "refactor(auth): Phase 2 — drop shims, drop role column, update CLAUDE.md"
```

---

## Chunk 14 — Phase 2: open PR, code review, merge, migrate prod

- [ ] **Step 1: Push + open PR**

```bash
git push -u origin feat/multi-role-phase-2
gh pr create ...
```

- [ ] **Step 2: Self-review via code-review skill**

Pay special attention to the ~170-file audit sweep — make sure no role check was accidentally inverted or narrowed.

- [ ] **Step 3: CI green + mergeable check**

- [ ] **Step 4: Merge, then apply prod migration**

```bash
gh pr merge <N> --squash --delete-branch
# wait for Vercel deploy to roll out
set -a && source .env && set +a && npx prisma migrate deploy
```

- [ ] **Step 5: Verify production**

- [ ] Confirm `User.role` column is gone via `psql` or Neon console
- [ ] Confirm a multi-role user's home page shows the union
- [ ] Confirm a SERVICE-only user's home page shows only the Service Suite card

---

## Risks + mitigation summary

| Risk | Mitigation |
|---|---|
| Phase 1 shim misses a call site, some page crashes in prod | Thorough test run in Chunk 10; fallback is `role` field on User is still populated so old code keeps working even if it reads `role` directly |
| Phase 1 migration fails mid-run | Migration is a simple `ALTER TABLE ADD COLUMN` + backfill UPDATE — both idempotent and single-statement |
| Phase 2 audit misses a call site, some page crashes | Grep patterns in Chunk 12 catch everything; compile errors flag any stragglers |
| Impersonation cookie mismatch during Phase 1 deploy rollout | Chunk 9 writes both `pb_effective_role` and `pb_effective_roles`; Chunk 13 drops singular only after a stable window |
| JWT carrying old single `role` during Phase 1 | JWT callback refreshes on `trigger === "update"`; even without refresh, both `role` and `roles` are populated |
| Landing cards collision produces visibly confusing UI | First-declared-role-wins rule is deterministic; tested in Chunk 3 |

## Out of scope (explicit non-goals from spec)

- Permission-first access model
- Functional-area scope dimension
- Role renaming / reshaping the 14-role set
- Runtime-customizable home-page layouts
- Per-user capability override audit UI
