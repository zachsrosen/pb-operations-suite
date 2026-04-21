# Role Access Editor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every canonical role's `allowedRoutes`, `landingCards`, `suites`, `scope`, `badge`, `label`, `description`, and `visibleInPicker` runtime-editable from the `/admin/roles` drawer, with invariant guards preventing ADMIN lockout and an audit trail on every change.

**Architecture:** Mirrors the existing `RoleCapabilityOverride` pattern end-to-end. Single JSONB `override` column on a new `RoleDefinitionOverride` table. Resolver (`src/lib/role-resolution.ts`) extended to merge both capability + definition overrides in one pass, preserving the 30s in-memory cache. API route at `/api/admin/roles/[role]/definition`. New `RoleDefinitionEditor` component mounts in `_RoleDrawerBody.tsx` below the existing `CapabilityEditor`. Server-side invariant checks live in `src/lib/role-guards.ts`. Single PR, single additive migration.

**Tech Stack:** Next.js 16 App Router (server + client split), React 19, TypeScript, Prisma 7 on Neon Postgres, Jest + Testing Library, Tailwind tokens.

**Spec:** `docs/superpowers/specs/2026-04-20-role-access-editor-design.md` (approved iter 2).

**Branch:** `feat/role-access-editor` off main. Currently on spec branch `spec/role-access-editor` with the spec committed. Orchestrator creates the feature branch at the start of Chunk 1 and base-resets back if chunks abort.

**Subagent guardrails (standing memory rules):**
- Subagents NEVER run migrations. They write migration files only. `scripts/migrate-prod.sh CONFIRM` is orchestrator-only, invoked in Chunk 9 after user approval in the same message.
- Commit scope discipline. Each subagent task declares files upfront. Use explicit `git add <path>` per file; never `git add .`, never `git add -A`. Verify `git log feat/role-access-editor ^main --stat` before claiming done.
- Full `npm run build` before pushing (Chunk 9) — Vercel's strict typecheck catches issues Jest doesn't.

---

## File Structure (locked decisions)

### New files

| Path | Responsibility |
|---|---|
| `src/lib/role-override-types.ts` | TypeScript types + shared constants (`RoleDefinitionOverridePayload`, `BADGE_COLOR_OPTIONS`, `SUITE_OPTIONS`, `SCOPE_VALUES`). Single source of truth imported by editor, guards, resolver, db layer. |
| `src/lib/role-guards.ts` | `validateRoleEdit(role, payload) → GuardViolation[]` — pre-write invariant checks (ADMIN lockout, route shape, badge color, etc.). |
| `src/app/api/admin/roles/[role]/definition/route.ts` | `GET` (hydrate editor) + `PUT` (upsert override) + `DELETE` (reset). Admin-gated. |
| `src/app/admin/roles/RoleDefinitionEditor.tsx` | Client component. The full edit form — Basics, Suites, Allowed routes, Landing cards. Wired to the API route. |
| `src/app/admin/roles/_definition-editor-sections.tsx` | Subcomponents (`BasicsCard`, `SuitesCard`, `RoutesCard`, `LandingCardsCard`) to keep `RoleDefinitionEditor` focused on state + save flow. Split if parent exceeds ~400 LOC; otherwise inline. |
| `prisma/migrations/<ts>_add_role_definition_overrides/migration.sql` | Create `RoleDefinitionOverride` table + `ALTER TYPE ActivityType ADD VALUE` for two new enum values. |
| `src/__tests__/lib/role-guards.test.ts` | Exhaustive coverage of every invariant. |
| `src/__tests__/lib/role-resolution-full.test.ts` | Resolver merge cases: inherit, per-field override, empty-array override, multi-role union, legacy normalization, malformed JSONB fallback, cache invalidation. |
| `src/__tests__/api/admin-roles-definition.test.ts` | API route tests: 401/403/400/200 for each method + guard violation surfacing + audit logging hook. |

### Modified files

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add `RoleDefinitionOverride` model; add `ROLE_DEFINITION_CHANGED` + `ROLE_DEFINITION_RESET` to `enum ActivityType`. |
| `src/lib/db.ts` | Add `getRoleDefinitionOverride`, `upsertRoleDefinitionOverride`, `resetRoleDefinitionOverride`. New `RoleDefinitionOverrideInput` type alias that equals `RoleDefinitionOverridePayload`. |
| `src/lib/role-resolution.ts` | Extend `resolveRoleDefinition` to read `RoleDefinitionOverride` in the same `Promise.all` as the capability fetch and apply the definition merge. Keep 30s cache + `invalidateRoleCache` behavior. |
| `src/app/admin/roles/_RoleDrawerBody.tsx` | Mount `RoleDefinitionEditor` below the existing `RoleCapabilityEditorLoader` section. Legacy-role banner replaces the whole drawer body (replaces current bullet-list view) when `def.normalizesTo !== row.role`. |

### Explicitly NOT touched

- `src/lib/roles.ts` — code defaults stay authoritative; no admin UI writes ever mutate this file.
- `src/lib/user-access.ts` — existing merge semantics (`resolveEffectiveRole`, `resolveUserAccess`) unchanged. Only the `overrides` Map it receives gains definition content.
- `src/app/admin/roles/CapabilityEditor.tsx` — not modified. New editor mounts alongside, doesn't wrap.
- `src/app/admin/roles/page.tsx` — table rendering unchanged. New drawer body content is orthogonal.
- `src/middleware.ts` — reads JWT access snapshot; no resolver changes touch middleware.

---

## Chunk 1: Types + shared constants

**Subagent task. One commit.**

Creates `src/lib/role-override-types.ts` as the single source of truth for the payload shape and the option lists that both the editor and the guards reference. No behavior changes yet.

**Files:**
- Create: `src/lib/role-override-types.ts`

### Step-by-step

- [ ] **Step 1: Create `src/lib/role-override-types.ts`**

```ts
import type { LandingCard } from "@/lib/roles";

/**
 * Sparse payload shape for a RoleDefinitionOverride row's `override` JSONB
 * column. Each key is optional; a present key (including empty arrays)
 * means "replace the code default with this value." An absent key means
 * "inherit the code default from src/lib/roles.ts."
 *
 * Resolver: src/lib/role-resolution.ts
 * Writer: PUT /api/admin/roles/[role]/definition
 * Reader (editor): src/app/admin/roles/RoleDefinitionEditor.tsx
 */
export interface RoleDefinitionOverridePayload {
  label?: string;
  description?: string;
  visibleInPicker?: boolean;
  suites?: string[];
  allowedRoutes?: string[];
  landingCards?: LandingCard[];
  scope?: "global" | "location" | "owner";
  badge?: { color?: string; abbrev?: string };
}

/**
 * The full set of badge color values accepted by the guards + surfaced by
 * the editor's swatch picker. Must stay in sync with the Tailwind color
 * families used in src/app/admin/roles/page.tsx's BADGE_COLOR_CLASSES map.
 */
export const BADGE_COLOR_OPTIONS = [
  "red",
  "amber",
  "orange",
  "yellow",
  "emerald",
  "teal",
  "cyan",
  "indigo",
  "purple",
  "zinc",
  "slate",
] as const;

export type BadgeColor = (typeof BADGE_COLOR_OPTIONS)[number];

/**
 * The full set of suite hrefs the editor offers as checkbox options. Mirrors
 * the 8 suite directories under src/app/suites/. New suites must be added
 * here AND to src/lib/suite-nav.ts's canonical list.
 */
export const SUITE_OPTIONS = [
  "/suites/operations",
  "/suites/design-engineering",
  "/suites/permitting-interconnection",
  "/suites/service",
  "/suites/dnr-roofing",
  "/suites/intelligence",
  "/suites/executive",
  "/suites/accounting",
] as const;

export const SCOPE_VALUES = ["global", "location", "owner"] as const;

export type ScopeValue = (typeof SCOPE_VALUES)[number];

/** Per-field length / size limits enforced by the guards + UI. */
export const LABEL_MAX_LEN = 40;
export const DESCRIPTION_MAX_LEN = 200;
export const BADGE_ABBREV_MAX_LEN = 16;
export const LANDING_CARDS_MAX = 10;

/** Shape of a single guard violation returned by validateRoleEdit. */
export interface GuardViolation {
  field:
    | "suites"
    | "allowedRoutes"
    | "landingCards"
    | "scope"
    | "badge"
    | "label"
    | "description"
    | "visibleInPicker";
  message: string;
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit -p . 2>&1 | head -30`
Expected: No errors referencing `role-override-types.ts`. (Repo-wide pre-existing errors may appear; those are not this chunk's concern.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/role-override-types.ts
git commit -m "feat(roles): add RoleDefinitionOverride types + shared constants

Single-source type + option list for the role access editor:
- RoleDefinitionOverridePayload (payload shape for the JSONB column)
- BADGE_COLOR_OPTIONS (11-value palette, imported by editor + guards)
- SUITE_OPTIONS (8 suites shown in checklist)
- SCOPE_VALUES, length limits, GuardViolation shape

No behavior change — types only.
"
```

Expected commit scope: 1 file added.

---

## Chunk 2: Prisma schema + migration file (NOT RUN)

**Subagent task. One commit.**

Adds the `RoleDefinitionOverride` model to `prisma/schema.prisma`, two new `ActivityType` enum values, and writes the migration SQL file. The subagent does NOT run the migration. The orchestrator runs it in Chunk 9.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_role_definition_overrides/migration.sql`

### Step-by-step

- [ ] **Step 1: Read existing migration template**

Read `prisma/migrations/20260418030909_add_role_capability_overrides/migration.sql` fully. The new migration mirrors its structure (ALTER TYPE ADD VALUE statements at top, CREATE TABLE + indexes below).

- [ ] **Step 2: Add RoleDefinitionOverride model to schema**

Locate the `RoleCapabilityOverride` model at ~line 2636 in `prisma/schema.prisma`. Immediately below it (before the `// ===========` comment for "ON-CALL ELECTRICIAN ROTATIONS"), insert:

```prisma
/// Per-role definition override. One row per canonical role at most.
/// The `override` column is a sparse RoleDefinitionOverridePayload JSON blob
/// (see src/lib/role-override-types.ts). Missing keys mean "inherit the
/// code default from src/lib/roles.ts"; present keys (including empty arrays)
/// mean "replace the code default with this value."
///
/// Admin edits via PUT /api/admin/roles/[role]/definition. Resolver in
/// src/lib/role-resolution.ts reads this table alongside RoleCapabilityOverride.
///
/// See: docs/superpowers/specs/2026-04-20-role-access-editor-design.md
model RoleDefinitionOverride {
  id             String   @id @default(cuid())
  role           UserRole @unique
  override       Json
  updatedAt      DateTime @updatedAt
  updatedByEmail String?

  @@index([role])
}
```

- [ ] **Step 3: Add ActivityType enum values**

Locate `enum ActivityType` at line 97. Find the existing entries `ROLE_CAPABILITIES_CHANGED` and `ROLE_CAPABILITIES_RESET` (lines ~202-203). Immediately after them, add:

```prisma
  ROLE_DEFINITION_CHANGED
  ROLE_DEFINITION_RESET
```

- [ ] **Step 4: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`. Emits to `src/generated/prisma/`.

- [ ] **Step 5: Create migration directory**

Pick a timestamp `TS` of the form `YYYYMMDDHHMMSS` using the current UTC time. Example: `20260420220000`. Then:

```bash
mkdir -p prisma/migrations/${TS}_add_role_definition_overrides
```

- [ ] **Step 6: Write migration SQL**

Create `prisma/migrations/${TS}_add_role_definition_overrides/migration.sql`:

```sql
-- Role-level definition overrides. Each role has 0 or 1 row here. The JSON
-- `override` column is a sparse RoleDefinitionOverridePayload (see
-- src/lib/role-override-types.ts); missing keys mean "inherit the
-- src/lib/roles.ts value of that name"; present keys (including empty
-- arrays) mean "replace the code default with this value."
--
-- Admin UI: /admin/roles drawer — RoleDefinitionEditor
-- Resolver: src/lib/role-resolution.ts

-- Add ActivityType enum values for audit entries on override writes.
-- `ADD VALUE IF NOT EXISTS` keeps the migration idempotent on re-runs.
-- Mirrors the RoleCapabilityOverride migration pattern (20260418030909).
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ROLE_DEFINITION_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ROLE_DEFINITION_RESET';

CREATE TABLE IF NOT EXISTS "RoleDefinitionOverride" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "override" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByEmail" TEXT,

    CONSTRAINT "RoleDefinitionOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RoleDefinitionOverride_role_key" ON "RoleDefinitionOverride"("role");
CREATE INDEX IF NOT EXISTS "RoleDefinitionOverride_role_idx" ON "RoleDefinitionOverride"("role");
```

- [ ] **Step 7: Verify Prisma recognizes the migration**

Run: `npx prisma migrate status 2>&1 | head -20`
Expected output includes line: `<timestamp>_add_role_definition_overrides` as a pending migration.

**DO NOT RUN `prisma migrate deploy` OR `prisma migrate dev`.** The orchestrator runs the migration in Chunk 9 after PR merge.

- [ ] **Step 8: Commit**

`src/generated/prisma/` IS gitignored in this repo (confirmed via `.gitignore` line `/src/generated/prisma`). Do NOT `git add` anything under that path — regenerate locally via `npx prisma generate`; consumers run it themselves on checkout.

```bash
git add prisma/schema.prisma prisma/migrations/${TS}_add_role_definition_overrides/migration.sql
git commit -m "feat(roles): add RoleDefinitionOverride table + ActivityType entries

Prisma schema adds RoleDefinitionOverride model (one JSONB override
column per canonical role) and two new ActivityType enum values:
ROLE_DEFINITION_CHANGED and ROLE_DEFINITION_RESET.

Migration file written but NOT applied — orchestrator runs
scripts/migrate-prod.sh after PR merge per standing rule.
"
```

Expected commit scope: exactly 2 files (schema + migration). Verify with `git log feat/role-access-editor ^main --stat` after commit — the list must be exactly `prisma/schema.prisma` and `prisma/migrations/<ts>_add_role_definition_overrides/migration.sql`.

---

## Chunk 3: db.ts helpers

**Subagent task. One commit.**

Adds three helpers in `src/lib/db.ts` mirroring the existing `RoleCapabilityOverride` ones. Placed in the same file to match the established pattern (the existing capability helpers are at lines ~1300-1353).

**Files:**
- Modify: `src/lib/db.ts`

### Step-by-step

- [ ] **Step 1: Read the existing capability helpers in db.ts**

Read `src/lib/db.ts` lines 1280-1355 to observe the exact pattern: doc block at top, `getRoleCapabilityOverride` → `upsertRoleCapabilityOverride` → `resetRoleCapabilityOverride`, prisma-null guard at each, returns.

- [ ] **Step 2a: Add the top-of-file import**

Add the following import to the existing top-level import block in `src/lib/db.ts` (in alphabetical/path order alongside other `@/lib/...` imports):

```ts
import type { RoleDefinitionOverridePayload } from "@/lib/role-override-types";
```

- [ ] **Step 2b: Append the definition-override helpers**

Immediately after `resetRoleCapabilityOverride` (around line 1353, right before the `// Per-user extra route overrides (Option D)` section banner), insert:

```ts
// ===========================================
// Role definition overrides (Option C)
// ===========================================

/**
 * Sparse payload shape for RoleDefinitionOverride.override. Alias of
 * RoleDefinitionOverridePayload from role-override-types — exported under
 * this name so the helper signatures below match the RoleCapabilityOverride
 * pattern (which uses an `Input` type alias).
 */
export type RoleDefinitionOverrideInput = RoleDefinitionOverridePayload;

/**
 * Fetch the single definition override row for a role, or null if none.
 * The `override` column is JSONB; Prisma returns it as `JsonValue` and the
 * caller coerces to RoleDefinitionOverridePayload.
 */
export async function getRoleDefinitionOverride(role: UserRole) {
  if (!prisma) return null;
  return prisma.roleDefinitionOverride.findUnique({ where: { role } });
}

/**
 * Upsert the definition override row for a role. The caller passes the full
 * sparse payload — absent keys mean "inherit", present keys (including
 * empty arrays) mean "replace." Validation happens at the API boundary
 * (validateRoleEdit + shape check); this helper trusts its input.
 *
 * Returns the upserted row, or null if the DB isn't configured.
 */
export async function upsertRoleDefinitionOverride(
  role: UserRole,
  override: RoleDefinitionOverrideInput,
  updatedByEmail: string | null,
) {
  if (!prisma) return null;
  return prisma.roleDefinitionOverride.upsert({
    where: { role },
    create: { role, override, updatedByEmail },
    update: { override, updatedByEmail },
  });
}

/**
 * Delete the definition override row for a role, reverting every overridden
 * field back to its code default in src/lib/roles.ts. Returns the deleted
 * row if one existed, or null if nothing to delete.
 */
export async function resetRoleDefinitionOverride(role: UserRole) {
  if (!prisma) return null;
  const existing = await prisma.roleDefinitionOverride.findUnique({ where: { role } });
  if (!existing) return null;
  await prisma.roleDefinitionOverride.delete({ where: { role } });
  return existing;
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "db\.ts|role-override-types" | head -20`
Expected: empty (no errors in either file).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(roles): add RoleDefinitionOverride db helpers

getRoleDefinitionOverride / upsertRoleDefinitionOverride /
resetRoleDefinitionOverride — mirror the RoleCapabilityOverride
pattern in the same file. Helpers trust their input; API boundary
runs validateRoleEdit before calling upsert.
"
```

Expected commit scope: 1 file modified.

---

## Chunk 4: role-guards.ts (TDD)

**Subagent task. One commit.**

Writes tests first, then implements the guard function. Heavy on invariant coverage because this is the lockout-prevention layer.

**Files:**
- Create: `src/__tests__/lib/role-guards.test.ts`
- Create: `src/lib/role-guards.ts`

### Step-by-step

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/lib/role-guards.test.ts`:

```ts
import { validateRoleEdit } from "@/lib/role-guards";
import type { RoleDefinitionOverridePayload } from "@/lib/role-override-types";

describe("validateRoleEdit — generic invariants", () => {
  it("accepts an empty payload (inherit everything)", () => {
    expect(validateRoleEdit("PROJECT_MANAGER", {})).toEqual([]);
  });

  it("rejects an allowedRoutes entry that does not start with / or *", () => {
    const payload: RoleDefinitionOverridePayload = { allowedRoutes: ["dashboards/foo"] };
    const v = validateRoleEdit("PROJECT_MANAGER", payload);
    expect(v).toHaveLength(1);
    expect(v[0].field).toBe("allowedRoutes");
  });

  it("accepts * as a valid allowedRoute entry", () => {
    expect(validateRoleEdit("PROJECT_MANAGER", { allowedRoutes: ["*"] })).toEqual([]);
  });

  it("rejects a suites entry that does not start with /suites/", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", { suites: ["/dashboards/foo"] });
    expect(v[0].field).toBe("suites");
  });

  it("accepts empty arrays (valid override meaning 'no suites/routes/cards')", () => {
    expect(
      validateRoleEdit("SALES", { suites: [], allowedRoutes: [], landingCards: [] }),
    ).toEqual([]);
  });

  it("rejects landingCards with a non-/ href", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", {
      landingCards: [
        {
          href: "dashboards/foo",
          title: "X",
          description: "Y",
          tag: "T",
          tagColor: "blue",
        },
      ],
    });
    expect(v[0].field).toBe("landingCards");
  });

  it("rejects landingCards longer than 10 entries", () => {
    const cards = Array.from({ length: 11 }, (_, i) => ({
      href: `/dashboards/card-${i}`,
      title: `C${i}`,
      description: "D",
      tag: "T",
      tagColor: "blue",
    }));
    const v = validateRoleEdit("PROJECT_MANAGER", { landingCards: cards });
    expect(v[0].field).toBe("landingCards");
  });

  it("rejects badge.color outside the allowed palette", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", { badge: { color: "magenta" } });
    expect(v[0].field).toBe("badge");
  });

  it("accepts badge.color from the allowed palette", () => {
    expect(validateRoleEdit("PROJECT_MANAGER", { badge: { color: "indigo" } })).toEqual([]);
  });

  it("rejects badge.abbrev longer than 16 chars", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", {
      badge: { abbrev: "ABCDEFGHIJKLMNOPQ" }, // 17 chars
    });
    expect(v[0].field).toBe("badge");
  });

  it("rejects invalid scope values", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", {
      scope: "company" as unknown as "global",
    });
    expect(v[0].field).toBe("scope");
  });

  it("rejects label longer than 40 chars", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", { label: "a".repeat(41) });
    expect(v[0].field).toBe("label");
  });

  it("rejects description longer than 200 chars", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", { description: "a".repeat(201) });
    expect(v[0].field).toBe("description");
  });
});

describe("validateRoleEdit — ADMIN lockout prevention", () => {
  it("rejects ADMIN allowedRoutes that drops both * and /admin", () => {
    const v = validateRoleEdit("ADMIN", { allowedRoutes: ["/dashboards/service"] });
    expect(v).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "allowedRoutes" }),
      ]),
    );
  });

  it("accepts ADMIN allowedRoutes = ['*']", () => {
    expect(validateRoleEdit("ADMIN", { allowedRoutes: ["*"] })).toEqual([]);
  });

  it("accepts ADMIN allowedRoutes that includes /admin AND /api/admin", () => {
    expect(
      validateRoleEdit("ADMIN", {
        allowedRoutes: ["/", "/admin", "/api/admin", "/dashboards/service"],
      }),
    ).toEqual([]);
  });

  it("rejects ADMIN allowedRoutes that has /admin but is missing /api/admin", () => {
    const v = validateRoleEdit("ADMIN", { allowedRoutes: ["/admin"] });
    expect(v).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "allowedRoutes" }),
      ]),
    );
  });

  it("does NOT apply the ADMIN guard to non-ADMIN roles", () => {
    // SALES can legitimately have an allowedRoutes list without /admin
    expect(
      validateRoleEdit("SALES", { allowedRoutes: ["/", "/dashboards/sales"] }),
    ).toEqual([]);
  });

  it("does NOT apply the ADMIN guard when the role's allowedRoutes key is absent (inherit mode)", () => {
    // No override on allowedRoutes means inherit ROLES.ADMIN's allowedRoutes = ["*"],
    // so there's no lockout risk. Guard should pass.
    expect(validateRoleEdit("ADMIN", { label: "Admin (renamed)" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest src/__tests__/lib/role-guards.test.ts`
Expected: FAIL — "Cannot find module '@/lib/role-guards'".

- [ ] **Step 3: Implement `src/lib/role-guards.ts`**

```ts
import type { UserRole } from "@/generated/prisma/enums";
import {
  BADGE_COLOR_OPTIONS,
  SCOPE_VALUES,
  LABEL_MAX_LEN,
  DESCRIPTION_MAX_LEN,
  BADGE_ABBREV_MAX_LEN,
  LANDING_CARDS_MAX,
  type GuardViolation,
  type RoleDefinitionOverridePayload,
} from "@/lib/role-override-types";

/**
 * Pre-write invariant checks for role definition overrides.
 *
 * Returns a list of violations — empty list means payload is OK. The API
 * route returns 400 with the list on non-empty. The editor mirrors these
 * checks client-side for live feedback but the server is canonical.
 *
 * Spec: docs/superpowers/specs/2026-04-20-role-access-editor-design.md
 *       (Section: "Guards — src/lib/role-guards.ts")
 *
 * Limitations (documented non-goals):
 *  - ADMIN lockout guard runs ONLY on ADMIN role edits. Cross-role
 *    scenarios (e.g. editing SERVICE to break a multi-role admin) and
 *    "last admin user" detection are out of scope.
 *  - Payload shape (required fields, JSON type correctness) is validated
 *    by the API route parser, not here. This function assumes the payload
 *    matches the TS type.
 */
export function validateRoleEdit(
  role: UserRole,
  payload: RoleDefinitionOverridePayload,
): GuardViolation[] {
  const violations: GuardViolation[] = [];

  // ----- allowedRoutes shape + ADMIN lockout -----
  if (payload.allowedRoutes) {
    for (const route of payload.allowedRoutes) {
      if (typeof route !== "string" || (!route.startsWith("/") && route !== "*")) {
        violations.push({
          field: "allowedRoutes",
          message: `Route "${route}" must start with "/" or equal "*".`,
        });
      }
    }
    if (role === "ADMIN") {
      const hasWildcard = payload.allowedRoutes.includes("*");
      const hasAdminRoute = payload.allowedRoutes.some(
        (r) => r === "/admin" || r.startsWith("/admin/"),
      );
      const hasApiAdmin = payload.allowedRoutes.some(
        (r) => r === "/api/admin" || r.startsWith("/api/admin/"),
      );
      if (!hasWildcard && !(hasAdminRoute && hasApiAdmin)) {
        violations.push({
          field: "allowedRoutes",
          message:
            "ADMIN must retain '*' OR both '/admin' and '/api/admin' in allowedRoutes to prevent lockout.",
        });
      }
    }
  }

  // ----- suites shape -----
  if (payload.suites) {
    for (const s of payload.suites) {
      if (typeof s !== "string" || !s.startsWith("/suites/")) {
        violations.push({
          field: "suites",
          message: `Suite "${s}" must start with "/suites/".`,
        });
      }
    }
  }

  // ----- landingCards shape + size -----
  if (payload.landingCards) {
    if (payload.landingCards.length > LANDING_CARDS_MAX) {
      violations.push({
        field: "landingCards",
        message: `Landing cards capped at ${LANDING_CARDS_MAX}; got ${payload.landingCards.length}.`,
      });
    }
    for (const c of payload.landingCards) {
      if (typeof c?.href !== "string" || !c.href.startsWith("/")) {
        violations.push({
          field: "landingCards",
          message: `Landing card href "${c?.href}" must start with "/".`,
        });
      }
    }
  }

  // ----- badge -----
  if (payload.badge) {
    if (payload.badge.color !== undefined) {
      if (!BADGE_COLOR_OPTIONS.includes(payload.badge.color as (typeof BADGE_COLOR_OPTIONS)[number])) {
        violations.push({
          field: "badge",
          message: `Badge color "${payload.badge.color}" is not in the allowed palette (${BADGE_COLOR_OPTIONS.join(", ")}).`,
        });
      }
    }
    if (payload.badge.abbrev !== undefined) {
      if (typeof payload.badge.abbrev !== "string" || payload.badge.abbrev.length > BADGE_ABBREV_MAX_LEN) {
        violations.push({
          field: "badge",
          message: `Badge abbrev must be a string of at most ${BADGE_ABBREV_MAX_LEN} characters.`,
        });
      }
    }
  }

  // ----- scope -----
  if (payload.scope !== undefined) {
    if (!SCOPE_VALUES.includes(payload.scope)) {
      violations.push({
        field: "scope",
        message: `Scope must be one of: ${SCOPE_VALUES.join(", ")}.`,
      });
    }
  }

  // ----- label / description -----
  if (payload.label !== undefined) {
    if (typeof payload.label !== "string" || payload.label.length > LABEL_MAX_LEN) {
      violations.push({
        field: "label",
        message: `Label must be a string of at most ${LABEL_MAX_LEN} characters.`,
      });
    }
  }
  if (payload.description !== undefined) {
    if (typeof payload.description !== "string" || payload.description.length > DESCRIPTION_MAX_LEN) {
      violations.push({
        field: "description",
        message: `Description must be a string of at most ${DESCRIPTION_MAX_LEN} characters.`,
      });
    }
  }

  return violations;
}
```

- [ ] **Step 4: Run tests to confirm green**

Run: `npx jest src/__tests__/lib/role-guards.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/role-guards.ts src/__tests__/lib/role-guards.test.ts
git commit -m "feat(roles): add role-guards.ts with full invariant coverage

validateRoleEdit(role, payload) returns GuardViolation[] — empty
list = OK, non-empty = API returns 400 with the list.

Invariants: ADMIN lockout prevention (single-role guard), route
shape, suite shape, landing-card href + cap, badge palette + abbrev
length, scope enum, label/description length.

Limitations documented in the function JSDoc: cross-role lockout
and last-admin detection are explicit non-goals per spec.
"
```

Expected commit scope: 2 files added.

---

## Chunk 5: Extend role-resolution.ts + tests

**Subagent task. One commit.**

Extends the existing `resolveRoleDefinition` function to fetch and merge `RoleDefinitionOverride` alongside the capability fetch. TDD: tests first, then implementation.

**Files:**
- Create: `src/__tests__/lib/role-resolution-full.test.ts`
- Modify: `src/lib/role-resolution.ts`

### Step-by-step

- [ ] **Step 1: Read the existing resolver**

Read `src/lib/role-resolution.ts` fully. The existing `resolveRoleDefinition` already has the cache + capability merge. Goal: add a definition-override fetch in the same `Promise.all`, merge its payload after the capability merge.

- [ ] **Step 2: Write the failing resolver test**

Create `src/__tests__/lib/role-resolution-full.test.ts`:

```ts
import type { UserRole } from "@/generated/prisma/enums";

const mockCapFindUnique = jest.fn();
const mockDefFindUnique = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    roleCapabilityOverride: { findUnique: (...a: unknown[]) => mockCapFindUnique(...a) },
    roleDefinitionOverride: { findUnique: (...a: unknown[]) => mockDefFindUnique(...a) },
  },
}));

// Import after mock so the module picks up the mocked prisma.
import { resolveRoleDefinition, invalidateRoleCache } from "@/lib/role-resolution";
import { ROLES } from "@/lib/roles";

beforeEach(() => {
  jest.clearAllMocks();
  invalidateRoleCache(); // wipe module-level cache between tests
  mockCapFindUnique.mockResolvedValue(null);
  mockDefFindUnique.mockResolvedValue(null);
});

describe("resolveRoleDefinition — definition overrides", () => {
  it("falls back to code defaults when no override row exists", async () => {
    const def = await resolveRoleDefinition("OPERATIONS");
    expect(def.allowedRoutes).toEqual(ROLES.OPERATIONS.allowedRoutes);
    expect(def.suites).toEqual(ROLES.OPERATIONS.suites);
    expect(def.landingCards).toEqual(ROLES.OPERATIONS.landingCards);
  });

  it("replaces allowedRoutes when the override provides an allowedRoutes key", async () => {
    mockDefFindUnique.mockResolvedValue({
      role: "OPERATIONS",
      override: { allowedRoutes: ["/", "/dashboards/custom"] },
    });
    const def = await resolveRoleDefinition("OPERATIONS");
    expect(def.allowedRoutes).toEqual(["/", "/dashboards/custom"]);
    // Unaffected fields stay at code default.
    expect(def.suites).toEqual(ROLES.OPERATIONS.suites);
  });

  it("empty-array override replaces (does not inherit)", async () => {
    mockDefFindUnique.mockResolvedValue({
      role: "SERVICE",
      override: { landingCards: [] },
    });
    const def = await resolveRoleDefinition("SERVICE");
    expect(def.landingCards).toEqual([]);
    expect(def.allowedRoutes).toEqual(ROLES.SERVICE.allowedRoutes); // untouched
  });

  it("merges capability + definition overrides in one resolve", async () => {
    mockCapFindUnique.mockResolvedValue({
      role: "SERVICE",
      canScheduleInstalls: true, // default is false
      canScheduleSurveys: null,
      canScheduleInspections: null,
      canSyncZuper: null,
      canManageUsers: null,
      canManageAvailability: null,
      canEditDesign: null,
      canEditPermitting: null,
      canViewAllLocations: null,
    });
    mockDefFindUnique.mockResolvedValue({
      role: "SERVICE",
      override: { label: "Service (custom)" },
    });
    const def = await resolveRoleDefinition("SERVICE");
    expect(def.defaultCapabilities.canScheduleInstalls).toBe(true); // capability merge
    expect(def.label).toBe("Service (custom)"); // definition merge
    expect(def.description).toBe(ROLES.SERVICE.description); // unchanged
  });

  it("badge partial override merges color only, keeps abbrev", async () => {
    mockDefFindUnique.mockResolvedValue({
      role: "SERVICE",
      override: { badge: { color: "purple" } },
    });
    const def = await resolveRoleDefinition("SERVICE");
    expect(def.badge.color).toBe("purple");
    expect(def.badge.abbrev).toBe(ROLES.SERVICE.badge.abbrev);
  });

  it("caps landingCards at 10 on read (matches LANDING_CARDS_MAX)", async () => {
    const manyCards = Array.from({ length: 15 }, (_, i) => ({
      href: `/dashboards/x-${i}`,
      title: `T${i}`,
      description: "d",
      tag: "T",
      tagColor: "blue",
    }));
    mockDefFindUnique.mockResolvedValue({
      role: "OPERATIONS",
      override: { landingCards: manyCards },
    });
    const def = await resolveRoleDefinition("OPERATIONS");
    expect(def.landingCards).toHaveLength(10);
  });

  it("malformed JSONB override (wrong types) falls back to code defaults and does not throw", async () => {
    mockDefFindUnique.mockResolvedValue({
      role: "OPERATIONS",
      override: { allowedRoutes: "not an array" }, // wrong shape
    });
    const def = await resolveRoleDefinition("OPERATIONS");
    // Bad field ignored; others still resolve from code.
    expect(def.allowedRoutes).toEqual(ROLES.OPERATIONS.allowedRoutes);
    expect(def.suites).toEqual(ROLES.OPERATIONS.suites);
  });

  it("invalidateRoleCache(role) busts the cache so a subsequent call re-reads the DB", async () => {
    mockDefFindUnique.mockResolvedValueOnce(null);
    await resolveRoleDefinition("OPERATIONS");
    // Second call without invalidate would return the cached value without hitting DB.
    mockDefFindUnique.mockResolvedValueOnce({
      role: "OPERATIONS",
      override: { label: "Ops (renamed)" },
    });
    invalidateRoleCache("OPERATIONS");
    const def2 = await resolveRoleDefinition("OPERATIONS");
    expect(def2.label).toBe("Ops (renamed)");
  });

  it("calling resolveRoleDefinition('OWNER') directly does NOT apply an EXECUTIVE override (documents the contract)", async () => {
    // Per spec §Resolver changes: resolveRoleDefinition does NOT normalize.
    // Normalization is the contract of resolveUserAccessWithOverrides only.
    // So an override stored under EXECUTIVE does NOT affect a direct OWNER lookup.
    mockDefFindUnique.mockImplementation(({ where }: { where: { role: string } }) =>
      Promise.resolve(
        where.role === "EXECUTIVE"
          ? { role: "EXECUTIVE", override: { label: "Exec (custom)" } }
          : null,
      ),
    );
    const ownerDef = await resolveRoleDefinition("OWNER");
    // OWNER's own base label (from ROLES.OWNER) is "Owner". EXECUTIVE's override
    // is "Exec (custom)". OWNER lookup should return the OWNER base, unmodified.
    expect(ownerDef.label).toBe(ROLES.OWNER.label);
    expect(ownerDef.label).not.toBe("Exec (custom)");
  });
});
```

- [ ] **Step 2b: Add multi-role + extras tests to `src/__tests__/lib/user-access.test.ts`**

The existing file already imports everything needed at the top:

```ts
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import {
  isPathAllowedByAccess,
  resolveEffectiveRole,
  resolveUserAccess,
} from "@/lib/user-access";
```

Add `type RoleDefinition` to the `@/lib/roles` import if not already there — the tests below reference it. Then append this describe block at the end of the file. Do not modify existing cases.

```ts
describe("multi-role merge with definition overrides (spec examples 1-3)", () => {
  it("example 1: role A override landingCards=[] + role B no override → union contains B's code cards", () => {
    const opsOverride: RoleDefinition = { ...ROLES.OPERATIONS, landingCards: [] };
    const overrides = new Map<UserRole, RoleDefinition>([["OPERATIONS", opsOverride]]);
    const eff = resolveEffectiveRole(["OPERATIONS", "OPERATIONS_MANAGER"], overrides);
    // OPERATIONS contributes zero cards; OPS_MGR's code cards survive.
    expect(eff.landingCards.length).toBe(ROLES.OPERATIONS_MANAGER.landingCards.length);
  });

  it("example 2: role A override adds /x + role B no override → union contains /x plus B's code routes", () => {
    const pmOverride: RoleDefinition = {
      ...ROLES.PROJECT_MANAGER,
      allowedRoutes: ["/dashboards/x"],
    };
    const overrides = new Map<UserRole, RoleDefinition>([["PROJECT_MANAGER", pmOverride]]);
    const eff = resolveEffectiveRole(["PROJECT_MANAGER", "SERVICE"], overrides);
    expect(eff.allowedRoutes).toContain("/dashboards/x");
    // A specific SERVICE code-default route is still present:
    expect(eff.allowedRoutes).toContain("/dashboards/service-overview");
  });

  it("example 3: single role with empty override → effective routes empty (modulo per-user extras)", () => {
    const srvOverride: RoleDefinition = { ...ROLES.SERVICE, allowedRoutes: [] };
    const overrides = new Map<UserRole, RoleDefinition>([["SERVICE", srvOverride]]);
    const eff = resolveEffectiveRole(["SERVICE"], overrides);
    expect(eff.allowedRoutes).toEqual([]);
  });
});

describe("per-user extraDeniedRoutes still wins over role-level override grant", () => {
  it("override grants /x; user denies /x → isPathAllowedByAccess returns false", () => {
    const srvOverride: RoleDefinition = {
      ...ROLES.SERVICE,
      allowedRoutes: ["/", "/dashboards/x"],
    };
    const overrides = new Map<UserRole, RoleDefinition>([["SERVICE", srvOverride]]);
    const access = resolveUserAccess(
      { roles: ["SERVICE"], extraDeniedRoutes: ["/dashboards/x"] },
      overrides,
    );
    expect(access.allowedRoutes.has("/dashboards/x")).toBe(true);
    expect(access.deniedRoutes.has("/dashboards/x")).toBe(true);
    // isPathAllowedByAccess checks deniedRoutes first:
    expect(isPathAllowedByAccess(access, "/dashboards/x")).toBe(false);
  });
});
```

**Do NOT** use `await import(...)` inside these test callbacks — they are synchronous (`() =>`), and `await` in a non-async function is a syntax error. Everything needed is available via the top-level imports.

- [ ] **Step 3: Run tests — expect failure**

Run: `npx jest src/__tests__/lib/role-resolution-full.test.ts src/__tests__/lib/user-access.test.ts`
Expected: several tests FAIL in `role-resolution-full.test.ts` (the resolver hasn't been extended yet — overrides are ignored). The new `user-access.test.ts` blocks pass already — those test the pre-existing override-Map injection path and work without resolver changes.

- [ ] **Step 4a: Add top-of-file imports**

Add these imports to the existing import block at the top of `src/lib/role-resolution.ts`. Keep the existing `import type { UserRole } from "@/generated/prisma/enums"` and `ROLES` import as-is; ADD the new ones below them:

```ts
import type { LandingCard } from "@/lib/roles";
import {
  SCOPE_VALUES,
  LANDING_CARDS_MAX,
  type RoleDefinitionOverridePayload,
} from "@/lib/role-override-types";
```

- [ ] **Step 4b: Extend `resolveRoleDefinition`**

Modify `resolveRoleDefinition`. The existing function body fetches `roleCapabilityOverride.findUnique`. Change that single fetch to a parallel fetch, then add the definition merge after the capability merge.

Replace the existing override-fetch block (lines ~58-77) with:

```ts
  const [capOverride, defOverride] = await Promise.all([
    prisma.roleCapabilityOverride.findUnique({ where: { role } }).catch(() => null),
    prisma.roleDefinitionOverride.findUnique({ where: { role } }).catch(() => null),
  ]);

  if (!capOverride && !defOverride) {
    cache.set(role, { def: base, expires: Date.now() + CACHE_TTL_MS });
    return base;
  }

  const defaultCapabilities = { ...base.defaultCapabilities };
  if (capOverride) {
    const keys = Object.keys(defaultCapabilities) as Array<keyof typeof defaultCapabilities>;
    for (const key of keys) {
      const overrideVal = capOverride[key];
      if (typeof overrideVal === "boolean") defaultCapabilities[key] = overrideVal;
    }
  }

  let def: RoleDefinition = { ...base, defaultCapabilities };

  if (defOverride?.override) {
    try {
      def = applyDefinitionOverride(def, defOverride.override);
    } catch (err) {
      console.warn(
        `[role-resolution] Malformed override for role ${role}, using code defaults:`,
        err,
      );
      // def stays at the post-capability-merge version, which is the safe fallback.
    }
  }

  cache.set(role, { def, expires: Date.now() + CACHE_TTL_MS });
  return def;
```

- [ ] **Step 4c: Add the `applyDefinitionOverride` helper**

Insert the helper function in the module body below `resolveRoleDefinitions` (before the `resolveUserAccessWithOverrides` export). Keep it unexported — it's private to this module. The imports it uses (`LandingCard`, `SCOPE_VALUES`, `LANDING_CARDS_MAX`, `RoleDefinitionOverridePayload`) were already added in Step 4a.

```ts
/**
 * Apply a definition-override payload onto a base RoleDefinition. Present
 * keys replace; absent keys inherit. Malformed values (wrong types) are
 * skipped — the caller wraps this in try/catch and logs a warning, falling
 * back to the base definition if this function throws.
 *
 * This function is intentionally defensive: DB rows are supposed to be valid
 * because writes pass through the API's validateRoleEdit guard, but bad rows
 * can slip in via manual DB edits. We never crash the resolver.
 */
function applyDefinitionOverride(
  base: RoleDefinition,
  payload: unknown,
): RoleDefinition {
  if (!payload || typeof payload !== "object") return base;
  const o = payload as RoleDefinitionOverridePayload;
  const out: RoleDefinition = { ...base };

  if (typeof o.label === "string") out.label = o.label;
  if (typeof o.description === "string") out.description = o.description;
  if (typeof o.visibleInPicker === "boolean") out.visibleInPicker = o.visibleInPicker;
  if (Array.isArray(o.suites) && o.suites.every((s) => typeof s === "string")) {
    out.suites = o.suites;
  }
  if (Array.isArray(o.allowedRoutes) && o.allowedRoutes.every((r) => typeof r === "string")) {
    out.allowedRoutes = o.allowedRoutes;
  }
  if (
    Array.isArray(o.landingCards) &&
    o.landingCards.every((c): c is LandingCard => !!c && typeof c === "object" && typeof (c as LandingCard).href === "string")
  ) {
    out.landingCards = o.landingCards.slice(0, LANDING_CARDS_MAX);
  }
  if (typeof o.scope === "string" && (SCOPE_VALUES as readonly string[]).includes(o.scope)) {
    out.scope = o.scope as RoleDefinition["scope"];
  }
  if (o.badge && typeof o.badge === "object") {
    out.badge = {
      color: typeof o.badge.color === "string" ? o.badge.color : base.badge.color,
      abbrev: typeof o.badge.abbrev === "string" ? o.badge.abbrev : base.badge.abbrev,
    };
  }
  return out;
}
```

- [ ] **Step 5: Run tests — expect green**

Run: `npx jest src/__tests__/lib/role-resolution-full.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Run the existing related tests + the new user-access additions to confirm all green**

Run: `npx jest src/__tests__/lib/role-overrides.test.ts src/__tests__/lib/user-access.test.ts src/__tests__/lib/roles.test.ts`
Expected: all tests PASS (both pre-existing and the appended multi-role / extraDenied blocks added in Step 2b).

- [ ] **Step 7: Commit**

```bash
git add src/lib/role-resolution.ts src/__tests__/lib/role-resolution-full.test.ts src/__tests__/lib/user-access.test.ts
git commit -m "feat(roles): resolver merges RoleDefinitionOverride with fail-open

Extend resolveRoleDefinition to fetch definition overrides alongside
capability overrides (single Promise.all), merge payload via a new
applyDefinitionOverride helper. Malformed rows log a warning and
fall back to code defaults instead of crashing.

Same 30s cache + invalidateRoleCache(role) behavior. No change to
the resolver's public API.

Tests cover: inherit, per-field override, empty-array replace,
badge partial merge, landing-cards cap on read, malformed-JSON
fallback, cache invalidation round-trip, legacy-role direct
lookup contract, plus new user-access.test.ts blocks covering
spec multi-role examples 1-3 and extraDeniedRoutes precedence.
"
```

Expected commit scope: 3 files (1 modified, 1 added, 1 test file appended).

---

## Chunk 6: API route + tests

**Subagent task. One commit.**

Creates `/api/admin/roles/[role]/definition/route.ts` with `GET`/`PUT`/`DELETE`. Mirrors the capabilities route pattern at `src/app/api/admin/roles/[role]/capabilities/route.ts`. Audit-logs both mutation types. TDD.

**Files:**
- Create: `src/__tests__/api/admin-roles-definition.test.ts`
- Create: `src/app/api/admin/roles/[role]/definition/route.ts`

### Step-by-step

- [ ] **Step 1: Read the capabilities route as the reference**

Read `src/app/api/admin/roles/[role]/capabilities/route.ts` fully. The new route follows the same structure: `requireAdmin()` helper, `isValidRole`, `extractRequestContext`, `logAdminActivity`, `invalidateRoleCache` on write.

- [ ] **Step 2: Read an existing admin API test for the mocking pattern**

Read `src/__tests__/api/admin-search.test.ts` for the auth + prisma mock skeleton.

- [ ] **Step 3: Write the failing test file**

Create `src/__tests__/api/admin-roles-definition.test.ts`:

```ts
const mockAuth = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockGetOverride = jest.fn();
const mockUpsertOverride = jest.fn();
const mockResetOverride = jest.fn();
const mockInvalidateCache = jest.fn();
const mockLogAdminActivity = jest.fn();
const mockExtractCtx = jest.fn();

jest.mock("@/auth", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/db", () => ({
  prisma: {},
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
  getRoleDefinitionOverride: (role: string) => mockGetOverride(role),
  upsertRoleDefinitionOverride: (
    role: string,
    override: unknown,
    email: string | null,
  ) => mockUpsertOverride(role, override, email),
  resetRoleDefinitionOverride: (role: string) => mockResetOverride(role),
}));
jest.mock("@/lib/role-resolution", () => ({
  invalidateRoleCache: (r: string) => mockInvalidateCache(r),
}));
jest.mock("@/lib/audit/admin-activity", () => ({
  logAdminActivity: (...a: unknown[]) => mockLogAdminActivity(...a),
  extractRequestContext: (h: unknown) => mockExtractCtx(h),
}));
jest.mock("next/headers", () => ({
  headers: async () => new Map(),
}));

import { NextRequest } from "next/server";
import {
  GET,
  PUT,
  DELETE,
} from "@/app/api/admin/roles/[role]/definition/route";

function mkReq(body?: unknown, url = "http://localhost/api/admin/roles/PROJECT_MANAGER/definition") {
  return new NextRequest(url, {
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function mkParams(role: string) {
  return { params: Promise.resolve({ role }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: "admin@photonbrothers.com" } });
  mockGetUserByEmail.mockResolvedValue({
    id: "a1",
    email: "admin@photonbrothers.com",
    name: "Admin",
    roles: ["ADMIN"],
  });
  mockExtractCtx.mockReturnValue({ ipAddress: "0.0.0.0", userAgent: null });
  mockGetOverride.mockResolvedValue(null);
  mockUpsertOverride.mockResolvedValue({
    role: "PROJECT_MANAGER",
    override: {},
    updatedAt: new Date(),
    updatedByEmail: "admin@photonbrothers.com",
  });
  mockResetOverride.mockResolvedValue(null);
});

describe("GET /api/admin/roles/[role]/definition", () => {
  it("401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(401);
  });

  it("403 when user is not ADMIN", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "u1",
      email: "zach@photonbrothers.com",
      roles: ["SERVICE"],
    });
    const res = await GET(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(403);
  });

  it("400 for unknown role", async () => {
    const res = await GET(mkReq(), mkParams("NOT_A_ROLE"));
    expect(res.status).toBe(400);
  });

  it("400 for legacy role with canonical-target message", async () => {
    const res = await GET(mkReq(), mkParams("OWNER"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/EXECUTIVE/);
  });

  it("200 returns override + codeDefaults", async () => {
    mockGetOverride.mockResolvedValue({
      role: "PROJECT_MANAGER",
      override: { label: "PM (custom)" },
    });
    const res = await GET(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("PROJECT_MANAGER");
    expect(body.override).toEqual({ label: "PM (custom)" });
    expect(body.codeDefaults).toBeTruthy();
    expect(body.codeDefaults.label).toBe("Project Manager");
  });
});

describe("PUT /api/admin/roles/[role]/definition", () => {
  it("400 when body is not JSON object", async () => {
    const res = await PUT(mkReq(null), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(400);
  });

  it("400 when body.override has unknown keys", async () => {
    const res = await PUT(
      mkReq({ override: { not_a_field: true } }),
      mkParams("PROJECT_MANAGER"),
    );
    expect(res.status).toBe(400);
  });

  it("400 with violations array when guard fails (ADMIN allowedRoutes without /admin)", async () => {
    const res = await PUT(
      mkReq({ override: { allowedRoutes: ["/dashboards/something"] } }),
      mkParams("ADMIN"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.violations)).toBe(true);
    expect(body.violations.length).toBeGreaterThan(0);
  });

  it("400 for legacy role", async () => {
    const res = await PUT(
      mkReq({ override: { label: "x" } }),
      mkParams("MANAGER"),
    );
    expect(res.status).toBe(400);
  });

  it("200 on success: upserts, invalidates cache, logs activity", async () => {
    const override = { label: "PM (renamed)" };
    const res = await PUT(mkReq({ override }), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(200);
    expect(mockUpsertOverride).toHaveBeenCalledWith(
      "PROJECT_MANAGER",
      override,
      "admin@photonbrothers.com",
    );
    expect(mockInvalidateCache).toHaveBeenCalledWith("PROJECT_MANAGER");
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ROLE_DEFINITION_CHANGED",
        entityType: "role",
        entityId: "PROJECT_MANAGER",
      }),
    );
  });
});

describe("DELETE /api/admin/roles/[role]/definition", () => {
  it("403 when not admin", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "u1",
      email: "zach@photonbrothers.com",
      roles: ["SERVICE"],
    });
    const res = await DELETE(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(403);
  });

  it("400 for legacy role", async () => {
    const res = await DELETE(mkReq(), mkParams("OWNER"));
    expect(res.status).toBe(400);
  });

  it("200 resets, invalidates cache, logs activity", async () => {
    mockResetOverride.mockResolvedValue({ role: "PROJECT_MANAGER", override: { label: "x" } });
    const res = await DELETE(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(200);
    expect(mockInvalidateCache).toHaveBeenCalledWith("PROJECT_MANAGER");
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ROLE_DEFINITION_RESET" }),
    );
  });
});
```

- [ ] **Step 4: Run tests — expect failure**

Run: `npx jest src/__tests__/api/admin-roles-definition.test.ts`
Expected: FAIL — "Cannot find module '@/app/api/admin/roles/[role]/definition/route'".

- [ ] **Step 5: Implement the route**

Create `src/app/api/admin/roles/[role]/definition/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import {
  prisma,
  getUserByEmail,
  getRoleDefinitionOverride,
  upsertRoleDefinitionOverride,
  resetRoleDefinitionOverride,
} from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { invalidateRoleCache } from "@/lib/role-resolution";
import { validateRoleEdit } from "@/lib/role-guards";
import {
  logAdminActivity,
  extractRequestContext,
} from "@/lib/audit/admin-activity";
import type {
  RoleDefinitionOverridePayload,
} from "@/lib/role-override-types";

/**
 * PUT/DELETE /api/admin/roles/[role]/definition
 *
 * Admin-only. Reads, writes, and resets the RoleDefinitionOverride row for
 * a single canonical role. Legacy roles (normalizesTo !== role) are rejected
 * with a message pointing to the canonical target. Payload shape + invariants
 * are validated here; the db helpers trust their input.
 */

const ALLOWED_PAYLOAD_KEYS: readonly string[] = [
  "label",
  "description",
  "visibleInPicker",
  "suites",
  "allowedRoutes",
  "landingCards",
  "scope",
  "badge",
];

function isValidRole(role: string): role is UserRole {
  return Boolean(ROLES[role as UserRole]);
}

function isCanonicalRole(role: UserRole): boolean {
  return ROLES[role].normalizesTo === role;
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!prisma) {
    return { error: NextResponse.json({ error: "Database not configured" }, { status: 500 }) };
  }
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { currentUser };
}

interface ParsedBody {
  override: RoleDefinitionOverridePayload;
}

function parseBody(data: unknown): ParsedBody | { error: string } {
  if (!data || typeof data !== "object") {
    return { error: "Body must be a JSON object with an `override` field" };
  }
  const override = (data as { override?: unknown }).override;
  if (!override || typeof override !== "object") {
    return { error: "`override` must be an object" };
  }
  for (const key of Object.keys(override as Record<string, unknown>)) {
    if (!ALLOWED_PAYLOAD_KEYS.includes(key)) {
      return { error: `Unknown override key: ${key}` };
    }
  }
  return { override: override as RoleDefinitionOverridePayload };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ role: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const { role: roleParam } = await context.params;
  if (!isValidRole(roleParam)) {
    return NextResponse.json({ error: `Unknown role: ${roleParam}` }, { status: 400 });
  }
  const role: UserRole = roleParam;
  if (!isCanonicalRole(role)) {
    return NextResponse.json(
      {
        error: `Role ${role} is legacy. Edit its canonical target ${ROLES[role].normalizesTo} instead.`,
      },
      { status: 400 },
    );
  }

  const row = await getRoleDefinitionOverride(role);
  return NextResponse.json({
    role,
    override: row?.override ?? null,
    codeDefaults: ROLES[role],
  });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ role: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const { currentUser } = gate;

  const { role: roleParam } = await context.params;
  if (!isValidRole(roleParam)) {
    return NextResponse.json({ error: `Unknown role: ${roleParam}` }, { status: 400 });
  }
  const role: UserRole = roleParam;
  if (!isCanonicalRole(role)) {
    return NextResponse.json(
      {
        error: `Role ${role} is legacy. Edit its canonical target ${ROLES[role].normalizesTo} instead.`,
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }
  const parsed = parseBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const violations = validateRoleEdit(role, parsed.override);
  if (violations.length > 0) {
    return NextResponse.json(
      { error: "Guard violations", violations },
      { status: 400 },
    );
  }

  const previous = await getRoleDefinitionOverride(role);
  const updated = await upsertRoleDefinitionOverride(
    role,
    parsed.override,
    currentUser.email,
  );
  invalidateRoleCache(role);

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);
  await logAdminActivity({
    type: "ROLE_DEFINITION_CHANGED",
    description: `Updated definition overrides for role ${role}`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    userName: currentUser.name || undefined,
    entityType: "role",
    entityId: role,
    entityName: role,
    metadata: {
      role,
      previous: previous?.override ?? null,
      next: parsed.override,
    },
    ...reqCtx,
  });

  return NextResponse.json({ success: true, override: updated?.override ?? parsed.override });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ role: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const { currentUser } = gate;

  const { role: roleParam } = await context.params;
  if (!isValidRole(roleParam)) {
    return NextResponse.json({ error: `Unknown role: ${roleParam}` }, { status: 400 });
  }
  const role: UserRole = roleParam;
  if (!isCanonicalRole(role)) {
    return NextResponse.json(
      {
        error: `Role ${role} is legacy. Edit its canonical target ${ROLES[role].normalizesTo} instead.`,
      },
      { status: 400 },
    );
  }

  const previous = await getRoleDefinitionOverride(role);
  const removed = await resetRoleDefinitionOverride(role);
  invalidateRoleCache(role);

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);
  await logAdminActivity({
    type: "ROLE_DEFINITION_RESET",
    description: `Reset definition overrides for role ${role}`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    userName: currentUser.name || undefined,
    entityType: "role",
    entityId: role,
    entityName: role,
    metadata: {
      role,
      previous: previous?.override ?? null,
      removed: Boolean(removed),
    },
    ...reqCtx,
  });

  return NextResponse.json({ success: true, removed: Boolean(removed) });
}
```

- [ ] **Step 6: Run tests — expect green**

Run: `npx jest src/__tests__/api/admin-roles-definition.test.ts`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/roles/[role]/definition/route.ts src/__tests__/api/admin-roles-definition.test.ts
git commit -m "feat(roles): add /api/admin/roles/[role]/definition GET/PUT/DELETE

Admin-only endpoint that hydrates, upserts, and resets RoleDefinition
override rows. Rejects legacy roles (normalizesTo !== role) with a
400 pointing at the canonical target. Runs validateRoleEdit guards
and returns the violations list on 400. Audit-logs every write via
logAdminActivity (ROLE_DEFINITION_CHANGED / ROLE_DEFINITION_RESET).

Mirrors the /capabilities route pattern end-to-end.
"
```

Expected commit scope: 2 files added.

---

## Chunk 7: UI — RoleDefinitionEditor

**Subagent task. One commit.**

Creates the client component. Wires it to the API route. Matches the CapabilityEditor pattern: tri-state inherit/override per field where applicable, dirty-state tracking, save button, reset button, error surface.

Kept as one file targeting ≤500 LOC. If it exceeds ~400 LOC during implementation, the subagent splits the inner subcomponents into `_definition-editor-sections.tsx` per the File Structure section above.

**Files:**
- Create: `src/app/admin/roles/RoleDefinitionEditor.tsx`
- (Conditional) Create: `src/app/admin/roles/_definition-editor-sections.tsx`

### Step-by-step

- [ ] **Step 1: Read the CapabilityEditor for UX + dirty-state pattern**

Read `src/app/admin/roles/CapabilityEditor.tsx` fully. Key patterns to mirror:
- `"use client"` directive at top
- `useRouter`, `useTransition`, local `FormState`, `initial` from props, `isDirty` computed from form vs initial
- Save handler posts to API, shows error/saved text
- Reset handler calls DELETE with `confirm()`

- [ ] **Step 2: Write `RoleDefinitionEditor.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/generated/prisma/enums";
import type { LandingCard, RoleDefinition } from "@/lib/roles";
import {
  BADGE_COLOR_OPTIONS,
  SUITE_OPTIONS,
  SCOPE_VALUES,
  LABEL_MAX_LEN,
  DESCRIPTION_MAX_LEN,
  BADGE_ABBREV_MAX_LEN,
  LANDING_CARDS_MAX,
  type RoleDefinitionOverridePayload,
  type GuardViolation,
  type ScopeValue,
} from "@/lib/role-override-types";

/**
 * Admin UI for editing a role's full definition (routes, suites, landing cards,
 * badge, label, description, scope, visibleInPicker). Mirrors the tri-state
 * inherit/override pattern from CapabilityEditor — present key in the payload
 * means "override with this value"; absent key means "inherit code default".
 *
 * Form state tracks, for each field, whether the admin has set an override.
 * On save, only fields with an active override are included in the payload.
 * Save posts to PUT /api/admin/roles/[role]/definition.
 */

interface FormState {
  label: { on: boolean; value: string };
  description: { on: boolean; value: string };
  visibleInPicker: { on: boolean; value: boolean };
  scope: { on: boolean; value: ScopeValue };
  badgeColor: { on: boolean; value: string };
  badgeAbbrev: { on: boolean; value: string };
  suites: { on: boolean; value: string[] };
  allowedRoutes: { on: boolean; value: string[] };
  landingCards: { on: boolean; value: LandingCard[] };
}

function initialFormState(
  codeDefaults: RoleDefinition,
  override: RoleDefinitionOverridePayload | null,
): FormState {
  return {
    label: {
      on: typeof override?.label === "string",
      value: override?.label ?? codeDefaults.label,
    },
    description: {
      on: typeof override?.description === "string",
      value: override?.description ?? codeDefaults.description,
    },
    visibleInPicker: {
      on: typeof override?.visibleInPicker === "boolean",
      value: override?.visibleInPicker ?? codeDefaults.visibleInPicker,
    },
    scope: {
      on: typeof override?.scope === "string",
      value: (override?.scope ?? codeDefaults.scope) as ScopeValue,
    },
    badgeColor: {
      on: typeof override?.badge?.color === "string",
      value: override?.badge?.color ?? codeDefaults.badge.color,
    },
    badgeAbbrev: {
      on: typeof override?.badge?.abbrev === "string",
      value: override?.badge?.abbrev ?? codeDefaults.badge.abbrev,
    },
    suites: {
      on: Array.isArray(override?.suites),
      value: override?.suites ?? [...codeDefaults.suites],
    },
    allowedRoutes: {
      on: Array.isArray(override?.allowedRoutes),
      value: override?.allowedRoutes ?? [...codeDefaults.allowedRoutes],
    },
    landingCards: {
      on: Array.isArray(override?.landingCards),
      value: override?.landingCards ?? [...codeDefaults.landingCards],
    },
  };
}

function buildPayload(form: FormState): RoleDefinitionOverridePayload {
  const out: RoleDefinitionOverridePayload = {};
  if (form.label.on) out.label = form.label.value;
  if (form.description.on) out.description = form.description.value;
  if (form.visibleInPicker.on) out.visibleInPicker = form.visibleInPicker.value;
  if (form.scope.on) out.scope = form.scope.value;
  if (form.badgeColor.on || form.badgeAbbrev.on) {
    out.badge = {};
    if (form.badgeColor.on) out.badge.color = form.badgeColor.value;
    if (form.badgeAbbrev.on) out.badge.abbrev = form.badgeAbbrev.value;
  }
  if (form.suites.on) out.suites = form.suites.value;
  if (form.allowedRoutes.on) out.allowedRoutes = form.allowedRoutes.value;
  if (form.landingCards.on) out.landingCards = form.landingCards.value;
  return out;
}

export default function RoleDefinitionEditor({
  role,
  codeDefaults,
  initialOverride,
  allKnownRoutes,
}: {
  role: UserRole;
  codeDefaults: RoleDefinition;
  initialOverride: RoleDefinitionOverridePayload | null;
  /** Union of routes across all canonical roles — feeds the <datalist> autocomplete. */
  allKnownRoutes: string[];
}) {
  const router = useRouter();
  const initial = useMemo(
    () => initialFormState(codeDefaults, initialOverride),
    [codeDefaults, initialOverride],
  );
  const [form, setForm] = useState<FormState>(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<GuardViolation[]>([]);
  const [saved, setSaved] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  const hasAnyOverride = useMemo(() => {
    const anyOn = (
      form.label.on ||
      form.description.on ||
      form.visibleInPicker.on ||
      form.scope.on ||
      form.badgeColor.on ||
      form.badgeAbbrev.on ||
      form.suites.on ||
      form.allowedRoutes.on ||
      form.landingCards.on
    );
    return anyOn;
  }, [form]);

  const handleSave = useCallback(async () => {
    setError(null);
    setViolations([]);
    setSaved(false);
    try {
      const body = { override: buildPayload(form) };
      const res = await fetch(`/api/admin/roles/${role}/definition`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.violations)) setViolations(data.violations);
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [form, role, router]);

  const handleReset = useCallback(async () => {
    if (!confirm(`Reset all definition overrides for ${role}? This reverts every field to the code default.`)) {
      return;
    }
    setError(null);
    setViolations([]);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/roles/${role}/definition`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Reset failed (${res.status})`);
        return;
      }
      setForm(initialFormState(codeDefaults, null));
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [codeDefaults, role, router]);

  const violationsByField = useMemo(() => {
    const map = new Map<GuardViolation["field"], string[]>();
    for (const v of violations) {
      const arr = map.get(v.field) ?? [];
      arr.push(v.message);
      map.set(v.field, arr);
    }
    return map;
  }, [violations]);

  return (
    <div className="space-y-4">
      {/* ----- Basics ----- */}
      <BasicsCard
        form={form}
        setForm={setForm}
        codeDefaults={codeDefaults}
        violationsByField={violationsByField}
      />

      {/* ----- Suites ----- */}
      <SuitesCard
        form={form}
        setForm={setForm}
        codeDefaults={codeDefaults}
        violationsByField={violationsByField}
      />

      {/* ----- Allowed routes ----- */}
      <RoutesCard
        form={form}
        setForm={setForm}
        codeDefaults={codeDefaults}
        allKnownRoutes={allKnownRoutes}
        violationsByField={violationsByField}
      />

      {/* ----- Landing cards ----- */}
      <LandingCardsCard
        form={form}
        setForm={setForm}
        codeDefaults={codeDefaults}
        allKnownRoutes={allKnownRoutes}
        violationsByField={violationsByField}
      />

      {/* ----- Save / Reset bar ----- */}
      <div className="flex flex-col gap-3 rounded-lg border border-t-border/60 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs">
          {error && <span className="text-red-400">{error}</span>}
          {saved && !error && <span className="text-green-400">Saved</span>}
          {!error && !saved && isDirty && <span className="text-muted">Unsaved changes</span>}
          {!error && !saved && !isDirty && !hasAnyOverride && (
            <span className="text-muted">No overrides — inheriting all code defaults.</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={isPending || !hasAnyOverride}
            className="rounded-lg border border-t-border/60 bg-surface-2 px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || !isDirty}
            className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save definition"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Subcomponents — inline if parent stays under 500 LOC; otherwise move
// to src/app/admin/roles/_definition-editor-sections.tsx.
// =====================================================================

interface SectionProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  codeDefaults: RoleDefinition;
  violationsByField: Map<GuardViolation["field"], string[]>;
  allKnownRoutes?: string[];
}

/**
 * Static Tailwind class map for the badge-color swatches. Tailwind JIT only
 * emits utilities it sees as literal strings in source — `bg-${c}-500/40`
 * would NOT reliably compile for every color. Keep this map in sync with
 * BADGE_COLOR_OPTIONS; the shape mirrors existing BADGE_COLOR_CLASSES in
 * src/app/admin/roles/page.tsx.
 */
const SWATCH_CLASS: Record<string, string> = {
  red: "bg-red-500/40 border-red-500/60",
  amber: "bg-amber-500/40 border-amber-500/60",
  orange: "bg-orange-500/40 border-orange-500/60",
  yellow: "bg-yellow-500/40 border-yellow-500/60",
  emerald: "bg-emerald-500/40 border-emerald-500/60",
  teal: "bg-teal-500/40 border-teal-500/60",
  cyan: "bg-cyan-500/40 border-cyan-500/60",
  indigo: "bg-indigo-500/40 border-indigo-500/60",
  purple: "bg-purple-500/40 border-purple-500/60",
  zinc: "bg-zinc-500/40 border-zinc-500/60",
  slate: "bg-slate-500/40 border-slate-500/60",
};

function FieldViolations({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-red-400">
      {messages.map((m, i) => (
        <li key={i}>{m}</li>
      ))}
    </ul>
  );
}

function OverrideToggle({
  on,
  onChange,
  labelOn,
  labelOff,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  labelOn?: string;
  labelOff?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        on
          ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
          : "bg-zinc-500/10 text-muted border border-zinc-500/30"
      }`}
    >
      {on ? (labelOn ?? "Override") : (labelOff ?? "Inherit")}
    </button>
  );
}

function BasicsCard({ form, setForm, codeDefaults, violationsByField }: SectionProps) {
  return (
    <details className="group rounded-lg border border-t-border/60 bg-surface p-4" open>
      <summary className="cursor-pointer select-none text-sm font-semibold text-foreground">
        Basics
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        {/* Label */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Label</label>
            <OverrideToggle
              on={form.label.on}
              onChange={(on) => setForm((p) => ({ ...p, label: { ...p.label, on } }))}
            />
          </div>
          <input
            type="text"
            maxLength={LABEL_MAX_LEN}
            disabled={!form.label.on}
            value={form.label.value}
            onChange={(e) => setForm((p) => ({ ...p, label: { ...p.label, value: e.target.value } }))}
            placeholder={codeDefaults.label}
            className="mt-1 w-full rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-sm text-foreground disabled:opacity-60"
          />
          <FieldViolations messages={violationsByField.get("label")} />
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Description</label>
            <OverrideToggle
              on={form.description.on}
              onChange={(on) => setForm((p) => ({ ...p, description: { ...p.description, on } }))}
            />
          </div>
          <textarea
            maxLength={DESCRIPTION_MAX_LEN}
            disabled={!form.description.on}
            value={form.description.value}
            onChange={(e) =>
              setForm((p) => ({ ...p, description: { ...p.description, value: e.target.value } }))
            }
            placeholder={codeDefaults.description}
            rows={2}
            className="mt-1 w-full rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-sm text-foreground disabled:opacity-60"
          />
          <FieldViolations messages={violationsByField.get("description")} />
        </div>

        {/* Scope */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Scope</label>
            <OverrideToggle
              on={form.scope.on}
              onChange={(on) => setForm((p) => ({ ...p, scope: { ...p.scope, on } }))}
            />
          </div>
          <div className="mt-1 flex gap-1 rounded-lg border border-t-border/60 bg-surface-2 p-1">
            {SCOPE_VALUES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!form.scope.on}
                onClick={() => setForm((p) => ({ ...p, scope: { ...p.scope, value: s } }))}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium capitalize ${
                  form.scope.value === s && form.scope.on
                    ? "bg-orange-500/30 text-orange-200"
                    : "text-muted hover:bg-surface"
                } disabled:opacity-60`}
              >
                {s}
              </button>
            ))}
          </div>
          <FieldViolations messages={violationsByField.get("scope")} />
        </div>

        {/* visibleInPicker */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Visible in role picker</label>
            <OverrideToggle
              on={form.visibleInPicker.on}
              onChange={(on) =>
                setForm((p) => ({ ...p, visibleInPicker: { ...p.visibleInPicker, on } }))
              }
            />
          </div>
          <div className="mt-1 flex gap-1 rounded-lg border border-t-border/60 bg-surface-2 p-1">
            {[
              { v: true, label: "On" },
              { v: false, label: "Off" },
            ].map((opt) => (
              <button
                key={String(opt.v)}
                type="button"
                disabled={!form.visibleInPicker.on}
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    visibleInPicker: { ...p.visibleInPicker, value: opt.v },
                  }))
                }
                className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                  form.visibleInPicker.value === opt.v && form.visibleInPicker.on
                    ? "bg-orange-500/30 text-orange-200"
                    : "text-muted hover:bg-surface"
                } disabled:opacity-60`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Badge */}
        <div>
          <label className="text-xs font-medium text-muted">Badge</label>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-muted">Color</span>
                <OverrideToggle
                  on={form.badgeColor.on}
                  onChange={(on) =>
                    setForm((p) => ({ ...p, badgeColor: { ...p.badgeColor, on } }))
                  }
                />
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {BADGE_COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={!form.badgeColor.on}
                    onClick={() =>
                      setForm((p) => ({ ...p, badgeColor: { ...p.badgeColor, value: c } }))
                    }
                    className={`h-6 w-6 rounded border disabled:opacity-50 ${
                      form.badgeColor.value === c && form.badgeColor.on
                        ? "ring-2 ring-orange-400"
                        : ""
                    } ${SWATCH_CLASS[c]}`}
                    title={c}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-muted">Abbrev</span>
                <OverrideToggle
                  on={form.badgeAbbrev.on}
                  onChange={(on) =>
                    setForm((p) => ({ ...p, badgeAbbrev: { ...p.badgeAbbrev, on } }))
                  }
                />
              </div>
              <input
                type="text"
                maxLength={BADGE_ABBREV_MAX_LEN}
                disabled={!form.badgeAbbrev.on}
                value={form.badgeAbbrev.value}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    badgeAbbrev: { ...p.badgeAbbrev, value: e.target.value },
                  }))
                }
                placeholder={codeDefaults.badge.abbrev}
                className="mt-1 w-full rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-sm text-foreground disabled:opacity-60"
              />
            </div>
          </div>
          <FieldViolations messages={violationsByField.get("badge")} />
        </div>
      </div>
    </details>
  );
}

function SuitesCard({ form, setForm, codeDefaults, violationsByField }: SectionProps) {
  const onChecked = (href: string, checked: boolean) => {
    setForm((p) => {
      const cur = new Set(p.suites.value);
      if (checked) cur.add(href);
      else cur.delete(href);
      return { ...p, suites: { ...p.suites, value: Array.from(cur) } };
    });
  };
  const copyDefaults = () =>
    setForm((p) => ({ ...p, suites: { on: true, value: [...codeDefaults.suites] } }));
  return (
    <details className="group rounded-lg border border-t-border/60 bg-surface p-4">
      <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-foreground">
        <span>Suites ({form.suites.on ? form.suites.value.length : codeDefaults.suites.length})</span>
        <OverrideToggle
          on={form.suites.on}
          onChange={(on) => setForm((p) => ({ ...p, suites: { ...p.suites, on } }))}
        />
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <button
          type="button"
          onClick={copyDefaults}
          className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated"
        >
          Copy from code defaults
        </button>
        <ul className="space-y-1">
          {SUITE_OPTIONS.map((href) => {
            const checked = form.suites.on
              ? form.suites.value.includes(href)
              : codeDefaults.suites.includes(href);
            return (
              <li key={href} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!form.suites.on}
                  checked={checked}
                  onChange={(e) => onChecked(href, e.target.checked)}
                />
                <code className="text-xs text-muted">{href}</code>
              </li>
            );
          })}
        </ul>
        <FieldViolations messages={violationsByField.get("suites")} />
      </div>
    </details>
  );
}

function RoutesCard({
  form,
  setForm,
  codeDefaults,
  allKnownRoutes,
  violationsByField,
}: SectionProps) {
  const copyDefaults = () =>
    setForm((p) => ({
      ...p,
      allowedRoutes: { on: true, value: [...codeDefaults.allowedRoutes] },
    }));
  const setAt = (idx: number, value: string) =>
    setForm((p) => ({
      ...p,
      allowedRoutes: {
        ...p.allowedRoutes,
        value: p.allowedRoutes.value.map((r, i) => (i === idx ? value : r)),
      },
    }));
  const removeAt = (idx: number) =>
    setForm((p) => ({
      ...p,
      allowedRoutes: {
        ...p.allowedRoutes,
        value: p.allowedRoutes.value.filter((_, i) => i !== idx),
      },
    }));
  const add = () =>
    setForm((p) => ({
      ...p,
      allowedRoutes: { ...p.allowedRoutes, value: [...p.allowedRoutes.value, ""] },
    }));
  return (
    <details className="group rounded-lg border border-t-border/60 bg-surface p-4">
      <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-foreground">
        <span>
          Allowed routes (
          {form.allowedRoutes.on
            ? form.allowedRoutes.value.length
            : codeDefaults.allowedRoutes.length}
          )
        </span>
        <OverrideToggle
          on={form.allowedRoutes.on}
          onChange={(on) =>
            setForm((p) => ({ ...p, allowedRoutes: { ...p.allowedRoutes, on } }))
          }
        />
      </summary>
      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyDefaults}
            className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated"
          >
            Copy from code defaults
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!form.allowedRoutes.on}
            className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated disabled:opacity-50"
          >
            + Add route
          </button>
        </div>
        <datalist id="role-editor-all-routes">
          {(allKnownRoutes ?? []).map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <ul className="space-y-1">
          {(form.allowedRoutes.on ? form.allowedRoutes.value : codeDefaults.allowedRoutes).map(
            (route, idx) => {
              const valid = route === "*" || route.startsWith("/");
              return (
                <li key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    list="role-editor-all-routes"
                    disabled={!form.allowedRoutes.on}
                    value={route}
                    onChange={(e) => setAt(idx, e.target.value)}
                    className={`flex-1 rounded border px-2 py-1 font-mono text-xs ${
                      valid ? "border-t-border/60" : "border-red-500/60"
                    } bg-surface-2 text-foreground disabled:opacity-60`}
                  />
                  <button
                    type="button"
                    disabled={!form.allowedRoutes.on}
                    onClick={() => removeAt(idx)}
                    className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                    aria-label="Remove route"
                  >
                    ×
                  </button>
                </li>
              );
            },
          )}
        </ul>
        <FieldViolations messages={violationsByField.get("allowedRoutes")} />
      </div>
    </details>
  );
}

function LandingCardsCard({
  form,
  setForm,
  codeDefaults,
  allKnownRoutes,
  violationsByField,
}: SectionProps) {
  const cards = form.landingCards.on ? form.landingCards.value : codeDefaults.landingCards;
  const copyDefaults = () =>
    setForm((p) => ({
      ...p,
      landingCards: { on: true, value: [...codeDefaults.landingCards] },
    }));
  const move = (idx: number, dir: -1 | 1) =>
    setForm((p) => {
      const arr = [...p.landingCards.value];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return p;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...p, landingCards: { ...p.landingCards, value: arr } };
    });
  const updateAt = (idx: number, patch: Partial<LandingCard>) =>
    setForm((p) => ({
      ...p,
      landingCards: {
        ...p.landingCards,
        value: p.landingCards.value.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
      },
    }));
  const removeAt = (idx: number) =>
    setForm((p) => ({
      ...p,
      landingCards: {
        ...p.landingCards,
        value: p.landingCards.value.filter((_, i) => i !== idx),
      },
    }));
  const add = () =>
    setForm((p) => ({
      ...p,
      landingCards: {
        ...p.landingCards,
        value: [
          ...p.landingCards.value,
          { href: "", title: "", description: "", tag: "", tagColor: "blue" },
        ],
      },
    }));
  return (
    <details className="group rounded-lg border border-t-border/60 bg-surface p-4">
      <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-foreground">
        <span>Landing cards ({cards.length} / {LANDING_CARDS_MAX})</span>
        <OverrideToggle
          on={form.landingCards.on}
          onChange={(on) =>
            setForm((p) => ({ ...p, landingCards: { ...p.landingCards, on } }))
          }
        />
      </summary>
      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyDefaults}
            className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated"
          >
            Copy from code defaults
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!form.landingCards.on || cards.length >= LANDING_CARDS_MAX}
            className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated disabled:opacity-50"
          >
            + Add card
          </button>
        </div>
        <ul className="space-y-2">
          {cards.map((card, idx) => (
            <li
              key={idx}
              className="rounded border border-t-border/60 bg-surface-2 p-2 text-xs"
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!form.landingCards.on || idx === 0}
                  onClick={() => move(idx, -1)}
                  className="rounded px-1 text-muted hover:text-foreground disabled:opacity-40"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={!form.landingCards.on || idx === cards.length - 1}
                  onClick={() => move(idx, 1)}
                  className="rounded px-1 text-muted hover:text-foreground disabled:opacity-40"
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={!form.landingCards.on}
                  onClick={() => removeAt(idx)}
                  className="ml-auto rounded px-1 text-muted hover:text-red-400 disabled:opacity-40"
                  aria-label="Remove card"
                >
                  ×
                </button>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input
                  type="text"
                  list="role-editor-all-routes"
                  disabled={!form.landingCards.on}
                  placeholder="href (/dashboards/…)"
                  value={card.href}
                  onChange={(e) => updateAt(idx, { href: e.target.value })}
                  className="rounded border border-t-border/60 bg-surface px-2 py-1 font-mono text-[11px] disabled:opacity-60"
                />
                <input
                  type="text"
                  disabled={!form.landingCards.on}
                  placeholder="title"
                  value={card.title}
                  onChange={(e) => updateAt(idx, { title: e.target.value })}
                  className="rounded border border-t-border/60 bg-surface px-2 py-1 text-[11px] disabled:opacity-60"
                />
                <input
                  type="text"
                  disabled={!form.landingCards.on}
                  placeholder="description"
                  value={card.description}
                  onChange={(e) => updateAt(idx, { description: e.target.value })}
                  className="col-span-2 rounded border border-t-border/60 bg-surface px-2 py-1 text-[11px] disabled:opacity-60"
                />
                <input
                  type="text"
                  disabled={!form.landingCards.on}
                  placeholder="tag (e.g. SCHEDULING)"
                  value={card.tag}
                  onChange={(e) => updateAt(idx, { tag: e.target.value })}
                  className="rounded border border-t-border/60 bg-surface px-2 py-1 text-[11px] disabled:opacity-60"
                />
                <select
                  disabled={!form.landingCards.on}
                  value={card.tagColor}
                  onChange={(e) => updateAt(idx, { tagColor: e.target.value })}
                  className="rounded border border-t-border/60 bg-surface px-2 py-1 text-[11px] disabled:opacity-60"
                >
                  {BADGE_COLOR_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
        <FieldViolations messages={violationsByField.get("landingCards")} />
      </div>
    </details>
  );
}
```

- [ ] **Step 3: Verify LOC budget**

Run: `wc -l src/app/admin/roles/RoleDefinitionEditor.tsx`
If >500, split `BasicsCard`/`SuitesCard`/`RoutesCard`/`LandingCardsCard` plus `FieldViolations`/`OverrideToggle` into `src/app/admin/roles/_definition-editor-sections.tsx` and re-import.

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "RoleDefinitionEditor|_definition-editor-sections" | head -20`
Expected: empty.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/roles/RoleDefinitionEditor.tsx
# If split:
# git add src/app/admin/roles/_definition-editor-sections.tsx
git commit -m "feat(roles): add RoleDefinitionEditor client component

Tri-state inherit/override editor for every field of a role definition
(basics, suites, allowed routes, landing cards). Built to mirror the
CapabilityEditor UX: dirty tracking, unsaved-changes indicator,
inline guard violations surfaced per field, reset-to-defaults button.

Landing cards are ordered with up/down arrow buttons (no drag-drop)
and capped at 10 via the shared LANDING_CARDS_MAX constant. Route
inputs autocomplete against the union of routes across all roles
via a <datalist>.

Editor is not mounted yet — Chunk 8 wires it into _RoleDrawerBody.
"
```

Expected commit scope: 1–2 files added.

---

## Chunk 8: Mount editor + legacy-role banner

**Subagent task. One commit.**

Mounts `RoleDefinitionEditor` in `_RoleDrawerBody.tsx` below the existing `Capabilities` section. Adds a legacy-role banner that short-circuits the drawer body when the selected role is legacy (normalizesTo !== role).

**Files:**
- Modify: `src/app/admin/roles/_RoleDrawerBody.tsx`

### Step-by-step

- [ ] **Step 1: Read current `_RoleDrawerBody.tsx`**

Read the full file. Key observations:
- Exports `RoleRow`, `scopeClass`, `RoleDrawerBody`, and `RoleCapabilityEditorLoader` (private helper).
- `RoleDrawerBody` takes `{ row: RoleRow }` and renders the header/grid/capabilities section.
- Legacy roles currently render the same body with a "Legacy → X" badge in the header; no redirection.

- [ ] **Step 2: Add legacy-role short-circuit + mount the new editor**

**IMPORTANT — do not delete or summarize the existing `RoleDrawerBody` body.** The existing function renders `AdminDetailHeader` + `AdminKeyValueGrid` (with a specific `items` array spanning ~55 lines) + an allowed-routes `<details>` disclosure + the capabilities section. Leave all of that verbatim. The only changes in this step are:

1. At the very top of `RoleDrawerBody`, before the `return`, add the `isLegacy` branch:

```tsx
export function RoleDrawerBody({ row }: { row: RoleRow }) {
  const { role, def } = row;
  const isLegacy = def.normalizesTo !== role;
  if (isLegacy) {
    return <LegacyRoleBanner role={role} canonical={def.normalizesTo} />;
  }
  // ...existing body below stays as-is...
```

2. After the existing `<section aria-labelledby={\`caps-heading-${role}\`}>` block that contains `<RoleCapabilityEditorLoader role={role} def={def} />`, append a second section for the new editor. Do NOT modify the existing capabilities section itself:

```tsx
      {/* NEW: Full definition editor */}
      <section aria-labelledby={`def-heading-${role}`} className="space-y-2">
        <h3
          id={`def-heading-${role}`}
          className="text-[10px] font-semibold uppercase tracking-wider text-muted"
        >
          Definition overrides
        </h3>
        <RoleDefinitionEditorLoader role={role} def={def} />
      </section>
```

3. Verify after edit: `wc -l src/app/admin/roles/_RoleDrawerBody.tsx` — the file should grow by roughly 60-80 lines (the LegacyRoleBanner + Loader + new section), NOT shrink. If it shrank, the existing `items` array was accidentally replaced — revert the edit and try again.

Add the legacy banner subcomponent after the `RoleCapabilityEditorLoader` function:

```tsx
/**
 * Banner shown when the selected role is legacy (normalizesTo !== role).
 * Legacy roles don't have their own override rows; their access resolves
 * from the canonical target at request time. Editing them would silently
 * no-op at the resolver layer.
 */
function LegacyRoleBanner({ role, canonical }: { role: UserRole; canonical: UserRole }) {
  return (
    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-foreground">
      <p className="font-medium">This role is legacy.</p>
      <p className="mt-2 text-muted">
        <span className="font-mono text-foreground">{role}</span> normalizes to{" "}
        <span className="font-mono text-foreground">{canonical}</span>. Its access is
        resolved from the canonical target at request time, so overrides on this role
        would have no effect.
      </p>
      <p className="mt-3">
        <Link
          href={`/admin/roles?role=${encodeURIComponent(canonical)}`}
          className="inline-flex items-center gap-1 text-cyan-400 hover:underline"
        >
          Edit {canonical} instead →
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Add `RoleDefinitionEditorLoader` alongside `RoleCapabilityEditorLoader`**

```tsx
import RoleDefinitionEditor from "./RoleDefinitionEditor";
import type { RoleDefinitionOverridePayload } from "@/lib/role-override-types";

/**
 * Loads the current definition override row for a role + the known-routes
 * union, then renders RoleDefinitionEditor. Keyed by role so switching
 * roles remounts with correct initial state.
 */
function RoleDefinitionEditorLoader({ role, def }: { role: UserRole; def: RoleDefinition }) {
  const [override, setOverride] = useState<RoleDefinitionOverridePayload | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOverride(undefined);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/roles/${encodeURIComponent(role)}/definition`,
          { credentials: "same-origin" },
        );
        if (!res.ok) throw new Error(`Failed to load override (${res.status})`);
        const data = (await res.json()) as {
          override: RoleDefinitionOverridePayload | null;
        };
        if (!cancelled) setOverride(data.override ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load override");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const allKnownRoutes = useMemo(() => {
    const seen = new Set<string>();
    for (const r of Object.values(ROLES)) {
      for (const route of r.allowedRoutes) {
        if (typeof route === "string") seen.add(route);
      }
    }
    return Array.from(seen).sort();
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
        {error}
      </div>
    );
  }
  if (override === undefined) {
    return <div className="text-xs text-muted">Loading definition…</div>;
  }

  return (
    <RoleDefinitionEditor
      key={role}
      role={role}
      codeDefaults={def}
      initialOverride={override}
      allKnownRoutes={allKnownRoutes}
    />
  );
}
```

Also add `import { ROLES } from "@/lib/roles";` and `import { useMemo } from "react";` alongside the existing imports.

- [ ] **Step 4: Update the existing AdminShell test to cover the new mount point**

Read `src/__tests__/components/admin-shell/AdminShell.test.tsx` — only verify it still passes; it doesn't test the drawer body directly, so no changes expected. If new tests for the drawer body are warranted, defer to follow-up.

Run: `npx jest src/__tests__/components/admin-shell/AdminShell.test.tsx`
Expected: PASS (no regression).

- [ ] **Step 5: Build to catch any wiring issues**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "_RoleDrawerBody|RoleDefinitionEditor" | head -20`
Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/roles/_RoleDrawerBody.tsx
git commit -m "feat(roles): mount RoleDefinitionEditor in drawer + legacy banner

Canonical roles get the new editor below the existing Capabilities
section, loaded via RoleDefinitionEditorLoader (hydrates from GET
/api/admin/roles/[role]/definition + passes the union of all known
routes for datalist autocomplete).

Legacy roles (OWNER, MANAGER, DESIGNER, PERMITTING) short-circuit
the drawer body with a banner that deep-links to the canonical
target's edit page. Editing legacy roles was silently a no-op at
the resolver; this makes the constraint visible.
"
```

Expected commit scope: 1 file modified.

---

## Chunk 9: Build, push, PR, review, merge, migrate (ORCHESTRATOR ONLY)

**Orchestrator task. NOT a subagent dispatch.**

Why orchestrator-only: (a) runs `npm run build` which requires a reliable shell environment; (b) opens the PR and drives self-review; (c) runs `scripts/migrate-prod.sh CONFIRM` which is subagent-forbidden per the memory rule.

### Step-by-step

- [ ] **Step 1: Verify full test suite is green**

```bash
npx jest --no-coverage 2>&1 | tail -40
```

Accept only: `Tests: <n> passed`. Known pre-existing failures (catalog-sync, solar-projects Prisma 7 import.meta, etc.) from CLAUDE.md can be ignored if they are unchanged from main. Confirm with: compare pass/fail count vs main.

- [ ] **Step 2: Run the full Vercel-equivalent build**

```bash
npm run build 2>&1 | tail -40
```

Accept only: `✓ Compiled successfully`. Address any errors (typecheck failures are the most likely category — fix them on this branch, do not push on a red build).

- [ ] **Step 3: Verify commit scope**

```bash
git log feat/role-access-editor ^main --oneline --stat
```

Expected files (superset — some chunks may bundle adjacent changes):

```
src/lib/role-override-types.ts                               (Chunk 1)
prisma/schema.prisma                                          (Chunk 2)
prisma/migrations/<ts>_add_role_definition_overrides/migration.sql (Chunk 2)
src/generated/prisma/** (optional, depends on gitignore)     (Chunk 2)
src/lib/db.ts                                                 (Chunk 3)
src/lib/role-guards.ts                                        (Chunk 4)
src/__tests__/lib/role-guards.test.ts                         (Chunk 4)
src/lib/role-resolution.ts                                    (Chunk 5)
src/__tests__/lib/role-resolution-full.test.ts                (Chunk 5)
src/app/api/admin/roles/[role]/definition/route.ts            (Chunk 6)
src/__tests__/api/admin-roles-definition.test.ts              (Chunk 6)
src/app/admin/roles/RoleDefinitionEditor.tsx                  (Chunk 7)
src/app/admin/roles/_definition-editor-sections.tsx           (Chunk 7, if split)
src/app/admin/roles/_RoleDrawerBody.tsx                       (Chunk 8)
```

**Hard gate:** No extra files. If anything unrelated leaked in (scratch scripts, formatting sweeps, etc.), abort and surgically reset before pushing.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/role-access-editor
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "feat(roles): runtime-editable role definitions (routes, landing cards, suites)" --body "$(cat <<'EOF'
## Summary
- Adds a new `RoleDefinitionOverride` Prisma table (one JSONB `override` column per canonical role) and extends `resolveRoleDefinition` to merge both capability + definition overrides in one pass, preserving the 30s cache.
- Adds `/api/admin/roles/[role]/definition` (`GET`/`PUT`/`DELETE`) with admin gate, invariant guards (`src/lib/role-guards.ts`), and audit logging (`ROLE_DEFINITION_CHANGED` / `ROLE_DEFINITION_RESET`).
- Adds `RoleDefinitionEditor` client component with four collapsible sections (Basics, Suites, Allowed routes, Landing cards), mounted in the `/admin/roles` drawer below the existing Capabilities editor.
- Legacy roles (OWNER, MANAGER, DESIGNER, PERMITTING) surface a banner deep-linking to their canonical target instead of the editor.
- Single migration, additive — creates the new table and adds two `ActivityType` enum values.

## Spec
docs/superpowers/specs/2026-04-20-role-access-editor-design.md

## Test plan
- [ ] As ADMIN, open `/admin/roles`, click PROJECT_MANAGER → drawer opens with the new Definition-overrides section populated from `ROLES.PROJECT_MANAGER`.
- [ ] Toggle the "Allowed routes" override, click "Copy from code defaults", remove one route, click Save → toast shows "Saved" → reload page, new state persists.
- [ ] Click "Reset to defaults" → confirm → the override row is deleted and the form falls back to code defaults.
- [ ] Attempt to save ADMIN with `allowedRoutes: ["/dashboards/service"]` (no wildcard, no `/admin`) → save is rejected with a visible guard violation.
- [ ] Click OWNER in the roles list → drawer shows the legacy banner with a link to EXECUTIVE instead of the editor.
- [ ] Reorder OPERATIONS landing cards with the up/down arrows → save → sign in as an OPS user in an incognito tab → home page reflects the new order (after next session sync; may take up to 30s).
- [ ] Check `/admin/activity` — two new entries appear (`ROLE_DEFINITION_CHANGED` and `ROLE_DEFINITION_RESET`) with readable before/after metadata.

## Migration
One additive migration: `prisma/migrations/<ts>_add_role_definition_overrides/migration.sql`. Creates `RoleDefinitionOverride` table + adds two `ActivityType` enum values. Orchestrator will run `scripts/migrate-prod.sh CONFIRM` after merge and user approval.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note the PR URL for later steps.

- [ ] **Step 6: Wait for CI signal before self-review**

Poll with:

```bash
gh pr view <PR#> --json statusCheckRollup,mergeable,mergeStateStatus | jq '{mergeable, mergeStateStatus, checks: [.statusCheckRollup[] | {name, status, conclusion}]}'
```

Wait until: all required checks conclude (PASS or failure). Re-run `/loop` pacing as needed. Skip if Vercel shows a stale FAILURE on a superseded deployment — verify by reading the latest deployment URL directly.

- [ ] **Step 7: Self-review via code-review skill**

Invoke `Skill: code-review:code-review` with argument:

```
Review PR #<N> (<URL>) on branch feat/role-access-editor vs main.

This PR adds runtime-editable role definitions. Spec: docs/superpowers/specs/2026-04-20-role-access-editor-design.md.

Key correctness checks:
- resolveRoleDefinition in src/lib/role-resolution.ts still applies capability + definition overrides correctly; malformed JSONB rows fall back to code defaults without crashing.
- validateRoleEdit in src/lib/role-guards.ts rejects ADMIN allowedRoutes that drops both '*' and '/admin'.
- API route at src/app/api/admin/roles/[role]/definition/route.ts rejects legacy roles (normalizesTo !== role) with 400 pointing at canonical target.
- RoleDefinitionEditor tri-state dirty tracking: toggling override "on/off" correctly includes/excludes that field from the PUT payload (buildPayload in the component).
- Legacy-role banner in _RoleDrawerBody.tsx displays when def.normalizesTo !== row.role and does not render the editor.

Standing preference: self-review; flag only real blockers or high-confidence bugs scoring ≥80. Ignore pre-existing test failures in catalog-sync, solar-projects, forecasting-accuracy.
```

Fix any flagged issues with additional commits to the branch; re-push; re-review loop until clean.

- [ ] **Step 8: Confirm PR is mergeable**

```bash
gh pr view <PR#> --json mergeable,mergeStateStatus,reviewDecision
```

Expected: `"mergeable":"MERGEABLE"`, `"mergeStateStatus":"CLEAN"` (or `UNSTABLE` if only Vercel preview is flaky), plus all required checks passing. If `CONFLICTING`, rebase on main and re-push.

- [ ] **Step 9: Merge**

```bash
gh pr merge <PR#> --squash --delete-branch
```

Wait for the Vercel deploy to show READY:

```bash
gh pr view <PR#> --json statusCheckRollup | jq '.statusCheckRollup[] | select(.name | test("Vercel"; "i")) | {name, status, conclusion}'
```

- [ ] **Step 10: Run the migration against prod — ORCHESTRATOR + EXPLICIT USER APPROVAL REQUIRED**

Per memory rule: never run migrations from pre-authorization. Must have explicit user approval **in the same message** as the command.

If user has approved:

```bash
./scripts/migrate-prod.sh CONFIRM 2>&1 | tee /tmp/role-def-override-migrate.log
```

Watch for:
- `Applying migration \`<ts>_add_role_definition_overrides\`` → `The following migration(s) have been applied`.
- No errors touching `RoleCapabilityOverride` or any existing table (migration is purely additive).

- [ ] **Step 11: Sanity-check the deployed feature**

- Visit `https://<prod-url>/admin/roles`, click any role → drawer shows the "Definition overrides" section.
- Watch Sentry for 15 min post-migration for any resolver or API errors referencing `role-resolution` or `admin/roles`.

- [ ] **Step 12: Close the loop**

Mark the TodoWrite item complete. Report PR URL, merge SHA, migration output tail, and smoke-test results. Surface any flagged follow-ups (e.g., updatedByEmail surfacing from the spec).

---

## Post-merge housekeeping (not in this PR)

- Manually QA the editor on a non-critical role first (SALES or SALES_MANAGER) before making any production-impacting edit to OPERATIONS/PROJECT_MANAGER/SERVICE.
- If a prod lockout occurs despite guards: `DELETE FROM "RoleDefinitionOverride" WHERE role = 'ADMIN';` from Neon console; cache flushes within 30s.
- Minor follow-up tickets (listed in spec):
  - Surface `updatedAt` + `updatedByEmail` in both the Capability and Definition editor headers.
  - Consider adding Zod for payload validation the next time Zod is added to the repo.
