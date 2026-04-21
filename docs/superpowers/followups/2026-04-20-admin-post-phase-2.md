# Admin post-Phase-2 running list

> Followups surfaced after the admin-shell redesign (PRs #215-224) plus assorted small items we've been noting. Kept as a running list so nothing falls through the cracks.

**Status key:**
- 🔴 = blocking or user-visible bug
- 🟡 = real improvement, time-bounded
- 🟢 = nice-to-have
- 📝 = needs design / brainstorm before implementation

**Last updated:** 2026-04-20

---

## Open

### 📝 Phase 2 IA audit + redesign (non-admin surfaces)
**Origin:** original brainstorm session (`docs/superpowers/specs/2026-04-18-admin-suite-redesign-design.md` → "What comes after").

**Problem statement:** 9 suites + 94 dashboards with usage data showing only ~8 dashboards get real traffic. Ghost cards. Inconsistent shell pattern between admin (`<AdminShell>`) and everything else (`<SuitePageShell>` / `<DashboardShell>`).

**Scope:**
- Apply the `<AdminShell>` playbook to one non-admin suite (anchor) + extract learnings.
- Usage-driven archive sweep: hide dashboards with <5 views / 30d AND not in any role's primary path.
- Lifecycle-vs-Workflow-vs-Department IA call (parked in the original brainstorm, owed).
- Ghost-card problem: home-page suite cards should hide when the viewer can't access the destination.

**Needs:** dedicated brainstorming session. ~2-4 weeks of work depending on scope choice.

**Next step:** new brainstorm → new spec → new plan. Pick anchor suite first.

---

### 📝 Create-role UI (would finish the Role Management saga)
**Origin:** user question "is there the ability to create roles from the UI" → no, not currently.

**Problem:** 14 roles hard-coded in the `UserRole` Prisma enum + `src/lib/roles.ts` ROLES map. Option B (capability overrides) and Option C (definition overrides) let admins *edit* existing roles at runtime but not *create new ones*. Adding a role today = schema migration + code PR + deploy.

**Scope sketch:**
1. Decouple role identity from the Prisma enum. Introduce a `CustomRole` table or similar DB-backed registry. Users' `roles` column stays `UserRole[]` (canonical) but merges in custom keys at read time.
2. Resolution layer: `resolveUserAccess` merges static ROLES + DB overrides + DB custom roles. Build on existing `role-resolution.ts` 30s cache.
3. UI: "New role" button on `/admin/roles`. Form: label / description / scope / suites / allowedRoutes / badge / landingCards. Reuse the existing RoleDefinitionEditor pattern.
4. Guard rails: prevent colliding with enum values, cap custom-role count (e.g., 50), invariant checks (can't create a role with zero routes, ADMIN can't be shadowed, etc.), delete flow that reassigns users to a fallback role.
5. Audit: `ROLE_CREATED` / `ROLE_DELETED` activity types, risk HIGH.

**Effort:** ~2-3 days. Similar complexity to Option C but touches the auth/schema boundary, so it warrants a short brainstorm + spec before code.

**Priority (my read):** lower than the IA audit. With only 14 roles covering 57 users, this is a "nice to have" — most new needs get covered by editing an existing role. Revisit when you hit a real "I need a custom role that can't be expressed by editing" moment.

---

### 🟡 Legacy user role normalization (2 DB rows)
**Origin:** `/admin/roles` inventory showed 1 user still on `MANAGER`, 1 on `DESIGNER`. Both are legacy role strings that normalize to canonical targets at resolve time, but the DB still carries the legacy string.

**Action:** one-time UPDATE to migrate them:
- `MANAGER` → `PROJECT_MANAGER`
- `DESIGNER` → `TECH_OPS`

**Risk:** zero. Behavior is unchanged (resolver already normalizes). This is DB hygiene.

**Next step:** run the SQL today (see `scripts/cleanup-legacy-user-roles.sql` in this branch).

---

### 🟢 Running list meta
This file is the running list. Add new items at the bottom of each section. Mark completed items with a strikethrough + date moved to "Done" at the bottom. Reshuffle priority markers freely.

---

## Done

- **2026-04-20 — Legacy user role normalization.** Migrated 2 users (Jacob Campbell `DESIGNER → TECH_OPS`, Katlyyn Arnoldi `MANAGER → PROJECT_MANAGER`). Script: `scripts/cleanup-legacy-user-roles.sql`. Zero behavior change (resolver already normalized).
- **2026-04-20 — `adminSection` flag removed from home page.** Intelligence/Service/D&R+Roofing no longer render under a misleading "Admin" heading. All accessible suites now render in a single "Suites" grid. The real admin surface lives in the UserMenu dropdown → `/admin`.
- **2026-04-20 — Ghost-card problem verified already fixed.** Home page filters `SUITE_METADATA` by `userAccess.suites` (authoritative list from `/api/auth/sync`). No action needed.
