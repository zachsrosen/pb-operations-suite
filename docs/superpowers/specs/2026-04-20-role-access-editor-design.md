# Role Access Editor — Design

**Date:** 2026-04-20
**Status:** Spec, pending review and approval
**Author:** Zach Rosen + Claude Code session
**Companion plan:** `docs/superpowers/plans/2026-04-18-role-management-ui-roadmap.md` (this is the "Option C" from that roadmap, re-specced with reduced scope)

## Problem

`/admin/roles` today shows every role's full definition — suites, allowed routes, landing cards, scope, badge, capabilities — but only **capabilities** are editable. The other five fields (`suites`, `allowedRoutes`, `landingCards`, `scope`, `badge`) are hardcoded in `src/lib/roles.ts`. Changing any of them requires a code edit, PR, and deploy.

This becomes a practical bottleneck when:
- A new dashboard ships and a role needs it added to their allowed list.
- A role's home-page landing cards need reordering because daily workflow changed.
- A role's suite switcher needs an extra suite turned on.
- Descriptive metadata (label, description, badge color) needs a minor polish.

ADMIN should be able to do all of these from the UI, with an audit trail, without shipping code.

## Goals

1. **Runtime-editable role definitions.** ADMIN can edit any canonical role's `suites`, `allowedRoutes`, `landingCards`, `scope`, `badge`, `label`, `description`, and `visibleInPicker` from `/admin/roles`.
2. **Inherit-or-override per field.** A missing override = inherit `ROLES[role]` code default. A present override = full replacement for that field (not a merge).
3. **Audit trail.** Every write logs a `ROLE_DEFINITION_CHANGED` activity with before/after diff. Every reset logs `ROLE_DEFINITION_RESET`.
4. **Lockout prevention.** ADMIN cannot accidentally remove their own admin-route access. Guards reject violating writes with 400.
5. **Reuse existing infrastructure.** Same 30s role-resolution cache, same admin drawer surface, same override pattern as `RoleCapabilityOverride`.

## Non-goals

- Editing the `UserRole` enum (add/remove role values). That still requires a Prisma migration.
- Editing legacy roles (OWNER, MANAGER, DESIGNER, PERMITTING) directly. They normalize to canonical roles; overrides on legacy names would be silently ignored by the resolver. Editor surfaces a deep-link to the canonical role instead.
- Revision history UI with "revert to this version." `ActivityLog` entries are already searchable at `/admin/activity`. If demand for richer history surfaces, add it later.
- Build-time route manifest for allowed-routes autocomplete. The editor autocompletes against routes already used by any role in the current DB + code state, which covers 99% of real edits. ADMINs can free-text any path that's validated server-side.
- CLI escape hatch script (`reset-role-overrides.sh`). The invariant guards prevent lockout in practice; if one happens anyway, a one-line DELETE from the Neon console recovers in seconds.
- Adding/removing `User.role` enum values, or touching anything about the pending column drop.

## Architecture

### Layering

```
┌──────────────────────────────────────────────────────────┐
│ /admin/roles (drawer)                                    │
│   ├── CapabilityEditor (existing, untouched)             │
│   └── RoleDefinitionEditor (NEW)                         │
│         └── PUT/DELETE /api/admin/roles/[role]/definition│
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌───────────────────────────────┐
              │ RoleDefinitionOverride table  │
              │ (one row per canonical role,  │
              │  single JSONB `override` col) │
              └───────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│ resolveRoleDefinition(role) — existing, extended         │
│   1. ROLES[role] as base                                 │
│   2. Apply RoleCapabilityOverride (existing behavior)    │
│   3. Apply RoleDefinitionOverride (NEW)                  │
│   Cached 30s; invalidated on write.                      │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
         resolveUserAccessWithOverrides → JWT snapshot
         (middleware reads cached snapshot, no DB hit)
```

No new resolver call sites. All existing consumers of `resolveRoleDefinition` pick up definition overrides transparently.

### Data model

```prisma
/// Per-role definition override. One row per canonical role at most. Missing
/// keys in the `override` JSON mean "inherit the code-level value from
/// src/lib/roles.ts". Admin edits via PUT /api/admin/roles/[role]/definition.
///
/// Sibling to RoleCapabilityOverride — both are read by resolveRoleDefinition
/// and merged onto the static ROLES map in one pass.
model RoleDefinitionOverride {
  id             String   @id @default(cuid())
  role           UserRole @unique  // canonical only (rejected for legacy roles at API)
  override       Json                // sparse RoleDefinitionOverridePayload
  updatedAt      DateTime @updatedAt
  updatedByEmail String?

  @@index([role])
}
```

**Why one JSON column instead of per-field columns:**

The natural alternative (per the original Option C sketch) was one nullable column per field, with `*Overridden: Boolean` flags to disambiguate "empty array override" from "inherit". That adds seven columns and seven booleans for no indexable benefit — we query by `role` only, and the override payload is read whole, never partially. JSONB gives us schema simplicity and sparse payloads for free. At scale (≤13 rows, one per canonical role + legacy), the space and index savings are noise.

Shape of the `override` payload (validated at API boundary, typed in TS):

```ts
// src/lib/role-override-types.ts
export interface RoleDefinitionOverridePayload {
  label?: string;
  description?: string;
  visibleInPicker?: boolean;
  suites?: string[];              // present = override even if []
  allowedRoutes?: string[];       // present = override even if []
  landingCards?: LandingCard[];   // present = override even if []; ordered; ≤10
  scope?: "global" | "location" | "owner";
  badge?: { color?: string; abbrev?: string };
}
```

Rules:
- Missing key → inherit `ROLES[role]` value.
- Present key → replace. Empty array is a valid override.
- Per field, no partial merge (an admin can't override "just one entry in allowedRoutes"; they must write the full list). Matches the mental model: "here is what this role's routes are."
- `badge`: present `badge.color` or `badge.abbrev` overrides that sub-field only. Both absent = inherit whole badge.

### Resolver changes

`src/lib/role-resolution.ts` already fetches and applies `RoleCapabilityOverride`. Extend `resolveRoleDefinition()` to also fetch the matching `RoleDefinitionOverride` row in the same function call (two parallel `findUnique` calls inside one `Promise.all`), then apply its payload after the capability merge.

```ts
const [capOverride, defOverride] = await Promise.all([
  prisma.roleCapabilityOverride.findUnique({ where: { role } }).catch(() => null),
  prisma.roleDefinitionOverride.findUnique({ where: { role } }).catch(() => null),
]);

// ... existing capability merge logic ...

if (defOverride?.override) {
  const o = defOverride.override as RoleDefinitionOverridePayload;
  if (typeof o.label === "string") def.label = o.label;
  if (typeof o.description === "string") def.description = o.description;
  if (typeof o.visibleInPicker === "boolean") def.visibleInPicker = o.visibleInPicker;
  if (Array.isArray(o.suites)) def.suites = o.suites;
  if (Array.isArray(o.allowedRoutes)) def.allowedRoutes = o.allowedRoutes;
  if (Array.isArray(o.landingCards)) def.landingCards = o.landingCards.slice(0, 10);
  if (o.scope === "global" || o.scope === "location" || o.scope === "owner") def.scope = o.scope;
  if (o.badge) {
    def.badge = {
      color: typeof o.badge.color === "string" ? o.badge.color : def.badge.color,
      abbrev: typeof o.badge.abbrev === "string" ? o.badge.abbrev : def.badge.abbrev,
    };
  }
}
```

Legacy roles (OWNER, MANAGER, DESIGNER, PERMITTING) are keyed by their canonical `normalizesTo` at resolution time (already — `resolveUserAccessWithOverrides` normalizes before lookup). So overrides keyed on `EXECUTIVE` automatically apply to OWNER users, etc. No special handling needed in the resolver; the API rejects legacy role param instead.

Cache invalidation: `invalidateRoleCache(role)` on every write and reset — already exists.

### API — `/api/admin/roles/[role]/definition`

Sibling to the existing `/api/admin/roles/[role]/capabilities` route. Shares the `requireAdmin()` helper pattern.

**`GET`** — hydrate the editor.

```
Response: {
  role: UserRole,
  override: RoleDefinitionOverridePayload | null,
  codeDefaults: RoleDefinition  // for "Copy from code defaults" UI
}
```

**`PUT`** — upsert override.

```
Body: { override: RoleDefinitionOverridePayload }
Response: { success: true, override: RoleDefinitionOverridePayload, violations?: never } on 200
          { error: "...", violations: GuardViolation[] }             on 400
          { error: "Admin access required" }                         on 403
```

Flow:
1. Parse + validate body shape. Unknown keys → 400.
2. Validate role param is canonical (ROLES[role] exists AND `visibleInPicker === true` at the code level, OR is VIEWER). Legacy → 400 with message pointing to canonical.
3. Run `validateRoleEdit(role, payload)` → if violations, 400 with list.
4. Upsert `RoleDefinitionOverride`.
5. `invalidateRoleCache(role)`.
6. `logAdminActivity({ type: "ROLE_DEFINITION_CHANGED", metadata: { role, previous, next } })`.
7. Return 200.

**`DELETE`** — reset to code default.

```
Response: { success: true, removed: boolean }
```

Flow: delete row, invalidate cache, log `ROLE_DEFINITION_RESET`.

### Guards — `src/lib/role-guards.ts` (new)

Invariant check before every write. Returns `GuardViolation[]`; empty = OK.

```ts
export interface GuardViolation {
  field: "suites" | "allowedRoutes" | "landingCards" | "scope" | "badge" | "label" | "description";
  message: string;
}

export function validateRoleEdit(
  role: UserRole,
  payload: RoleDefinitionOverridePayload,
): GuardViolation[]
```

Invariants enforced:

- **ADMIN lockout prevention.** If `role === "ADMIN"`, the effective `allowedRoutes` after applying the payload must contain `*`, OR must contain every path required for admin function: `/admin`, `/admin/roles`, `/admin/users`, `/api/admin`. (Segment-boundary match; `/admin` covers `/admin/roles` transitively, but we list them explicitly for clarity of error message.)
- **Route shape.** Every entry in `allowedRoutes` must start with `/` or equal `*`.
- **Suite shape.** Every entry in `suites` must start with `/suites/`.
- **Landing card href shape.** Every `landingCards[i].href` must start with `/`.
- **Landing card size.** `landingCards.length <= 10`.
- **Badge color.** `badge.color` must be one of the 11 allowed colors (matches existing palette: red, amber, orange, yellow, emerald, teal, cyan, indigo, purple, zinc, slate).
- **Badge abbrev length.** `badge.abbrev.length <= 16`.
- **Scope value.** `scope` must be `"global" | "location" | "owner"`.
- **Label length.** `label.length <= 40`.
- **Description length.** `description.length <= 200`.

All checks are server-side canonical. UI mirrors them for live feedback but server is the source of truth.

### UI — `RoleDefinitionEditor.tsx`

New component, sibling to `CapabilityEditor.tsx`. Mounted in `_RoleDrawerBody.tsx` below the existing Capabilities section.

Structure — one editor, four collapsible cards:

1. **Basics**
   - `label` — text input (≤40 chars)
   - `description` — textarea (≤200 chars)
   - `scope` — segmented select (Owner / Location / Global) with "Inherit" state
   - `visibleInPicker` — tri-state (Inherit / On / Off)
   - `badge.color` — 11-swatch radio group with "Inherit" button
   - `badge.abbrev` — text input (≤16 chars)

2. **Suites** (collapsible, closed by default)
   - Checklist of the 8 known suite hrefs, statically defined in the editor (matches `src/lib/suite-nav.ts` canonical list).
   - "Copy from code defaults" button fills checklist from `ROLES[role].suites`.
   - "Reset to inherit" button clears the override for just this field (tri-state at field granularity — present key = override; absent = inherit).

3. **Allowed routes** (collapsible)
   - Row-based editor. Each row: text input + remove button. "+ Add route" appends a blank row.
   - "Copy from code defaults" button loads `ROLES[role].allowedRoutes`.
   - "Reset to inherit" clears the override for this field.
   - `<datalist>` autocomplete sourced from the dedup union of all routes across all roles in `ROLES`.
   - Rows with invalid shape show inline red border + a "Must start with / or be *" hint.

4. **Landing cards** (collapsible)
   - Ordered list. Each card = a row with: href (text, autocompleted from routes), title (text), description (text), tag (text), tagColor (swatch).
   - Up/down arrows to reorder, remove button per row. "+ Add card" button disabled when 10 rows reached.
   - "Copy from code defaults" and "Reset to inherit" buttons.

At the bottom of the editor:
- Unsaved changes indicator (same pattern as capability editor)
- Validation summary (if any invariants fail locally, shown before save)
- **Save definition** button — posts entire payload (only fields that were touched — tracked via dirty bits)
- **Reset all overrides** button — calls DELETE, wipes the row

"Legacy role" case: when `def.normalizesTo !== role` (i.e., viewing OWNER, MANAGER, DESIGNER, PERMITTING), the editor replaces itself with a banner:

> This role is legacy. Its access is resolved from its canonical target: **EXECUTIVE**. [Edit EXECUTIVE →]

Clicking the link is a `router.push("/admin/roles?role=EXECUTIVE")`.

### Activity log additions

New `ActivityType` enum entries:
- `ROLE_DEFINITION_CHANGED` — PUT writes
- `ROLE_DEFINITION_RESET` — DELETE writes

Metadata payload:
```ts
{
  role: UserRole,
  previous: RoleDefinitionOverridePayload | null,
  next: RoleDefinitionOverridePayload | null,  // null on reset
}
```

The existing `/admin/activity` page already filters by type and renders generic metadata blocks; no UI changes needed there.

### Testing

**Unit tests:**
- `src/__tests__/lib/role-resolution-full.test.ts` (new) — cover:
  - Pure code default (no override row)
  - Each field override in isolation (just suites, just routes, just landing cards, etc.)
  - Full payload override
  - Empty-array override (suites = []) correctly replaces, not inherits
  - Legacy role correctly falls through to canonical via resolver normalization
  - Capability + definition override combined
  - Cache invalidation busts correctly
- `src/__tests__/lib/role-guards.test.ts` (new) — cover every invariant both positive (payload passes) and negative (payload rejected with expected violation).
- `src/__tests__/lib/user-access.test.ts` (existing) — add a case that injects a role override map with non-default `allowedRoutes` and verifies `resolveUserAccess` produces the overridden union.

**API tests:**
- `src/__tests__/api/admin-roles-definition.test.ts` (new) — cover:
  - Non-admin → 403
  - Unknown role → 400
  - Legacy role → 400 with canonical-target message
  - Invalid shape (unknown key, wrong type) → 400
  - Guard violation (ADMIN `allowedRoutes` missing `/admin`) → 400 with violations
  - Successful PUT → 200, override row written, cache invalidated, activity logged
  - DELETE → 200, row removed, activity logged
  - GET → 200, returns override + codeDefaults

**Build gate:**
- `npm run build` must succeed. Vercel's strict typecheck and Next.js build catch issues Jest doesn't.

## Data flow

1. ADMIN opens `/admin/roles`, clicks a row → drawer opens with `?role=PROJECT_MANAGER`.
2. `_RoleDrawerBody.tsx` renders `RoleDrawerBody` → `RoleDefinitionEditor` mounts.
3. Editor fires `GET /api/admin/roles/PROJECT_MANAGER/definition` → receives `{ override, codeDefaults }`.
4. Form hydrates from override if present, else shows "Inherit" tri-states everywhere.
5. ADMIN edits fields, clicks **Save definition**.
6. Client builds payload of only dirty fields, POSTs to PUT endpoint.
7. Server validates, runs guards, upserts, invalidates cache, logs activity.
8. Client shows "Saved" + calls `router.refresh()`.
9. Within 30s every server instance picks up the new override (cache TTL). `/api/auth/sync` re-resolves on next user session refresh, pushing the new access into JWT.
10. Users with this role see the new suites/routes/cards on their next request.

## Error handling

- **DB unreachable** — `resolveRoleDefinition` falls back to code defaults (existing behavior). Editor GET shows "Could not load override" error, form stays disabled.
- **Write fails after validation** — API returns 500 with sanitized error; editor surfaces it. Cache isn't invalidated so no partial state.
- **Stale JWT after override** — users are on a cached JWT `access` snapshot. Worst case, they see stale access until next session refresh (typically <5 min via `/api/auth/sync`). Not a correctness bug — just a latency characteristic, same as capability overrides.
- **Guard violations** — 400 response includes `violations: GuardViolation[]`. Editor displays each inline on the matching field and refuses to clear the unsaved-changes indicator until fixed.

## Rollback

- **Per-role undo:** Click "Reset all overrides" in the drawer → DELETE row, cache invalidated, code defaults restored within 30s.
- **Full wipe:** `DELETE FROM "RoleDefinitionOverride";` from Neon console — clears every role's override in one shot.
- **Code revert:** Revert the PR via Vercel rollback. Migration is additive (new table); leaving the empty table in place is harmless.

## Migration

One additive migration, `prisma/migrations/<ts>_add_role_definition_overrides/migration.sql`:

```sql
-- Role-level definition overrides. Each role has 0 or 1 row here. The JSON
-- `override` column is a sparse RoleDefinitionOverridePayload; missing keys
-- mean "inherit src/lib/roles.ts defaultCapabilities fields of that name."
-- Admin edits via /admin/roles drawer → PUT /api/admin/roles/[role]/definition.
CREATE TABLE "RoleDefinitionOverride" (
  "id" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "override" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedByEmail" TEXT,
  CONSTRAINT "RoleDefinitionOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoleDefinitionOverride_role_key" ON "RoleDefinitionOverride"("role");
CREATE INDEX "RoleDefinitionOverride_role_idx" ON "RoleDefinitionOverride"("role");
```

Plus `ActivityType` enum additions:

```sql
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ROLE_DEFINITION_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ROLE_DEFINITION_RESET';
```

**Migration execution** follows the standing rule: subagents write the file, orchestrator runs `scripts/migrate-prod.sh CONFIRM` post-merge with explicit user approval. No exceptions.

## Sequencing

**Single PR:** `feat/role-access-editor` off main.

The original roadmap proposed splitting into three PRs (schema-only → UI → history). Collapsing to one PR because:
- No user impact until an admin writes an override (same as capability overrides).
- Splitting schema from UI means two round trips where one suffices.
- Revision history UI (original C3) is dropped from scope per non-goals.
- All changes are reversible via revert + empty-table tolerance.

Single migration, single merge, single post-merge migrate step.

## Out of scope (deferred to follow-ups if demand surfaces)

- Revision history UI with per-revision revert.
- Build-time route manifest generator (scrapes `src/app/**/page.tsx` + `src/app/api/**/route.ts`).
- CLI escape-hatch script (`scripts/reset-role-overrides.sh`).
- Editing legacy role names directly.
- Role creation/deletion from UI (still requires Prisma enum change).
- Bulk "apply these route changes to every role" utility.

## Open questions

- **None at this scope.** Every judgment call has a committed decision documented in the "Decisions" table in the brainstorm transcript and encoded in this spec.

## Success criteria

- ADMIN can change `PROJECT_MANAGER.allowedRoutes` to remove `/dashboards/optimizer` from the UI, save, and within 30s a PM user can no longer load that page.
- ADMIN can reorder `OPERATIONS.landingCards` via arrow buttons, save, and an OPS user sees the new order on their home page after next session refresh.
- ADMIN clicks a legacy role (MANAGER) and is shown the deep-link to canonical (PROJECT_MANAGER) rather than a confusing editor.
- ADMIN tries to remove `/admin/roles` from ADMIN's allowed routes — save is rejected with a clear guard violation message.
- Every write produces an `ActivityLog` row visible at `/admin/activity` with a readable before/after diff.
- Jest suite passes. `npm run build` passes. No regressions in existing `user-access.test.ts` or `role-overrides.test.ts`.
