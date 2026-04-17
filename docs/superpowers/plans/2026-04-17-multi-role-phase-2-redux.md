# Multi-role Phase 2 redux + location model cleanup — Execution Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans for the prod-deploy sequence; subagents MAY be used for Part 1 (code-only) work but **never for steps marked MIGRATION**. Steps use checkbox (`- [ ]`) syntax.

**Date:** 2026-04-17 (planned evening of) — for execution next week

**Goal:** Finish the multi-role access refactor (delete the Phase-1 back-compat shim, drop the legacy `User.role` column) and address sub-threshold bugs surfaced in PR #189 review, plus the `requiresLocations` gate that doesn't reflect current scope-enforcement reality. Ship in 4 small independent PRs so each can be reverted cleanly if anything misbehaves.

**Prior context (must read before executing):**
- Original spec: [`docs/superpowers/specs/2026-04-16-multi-role-access-and-home-redesign-design.md`](../specs/2026-04-16-multi-role-access-and-home-redesign-design.md)
- Original Phase 1 plan: [`docs/superpowers/plans/2026-04-17-multi-role-access-and-home-redesign.md`](./2026-04-17-multi-role-access-and-home-redesign.md)
- Phase 1 shipped: PR #189.

---

## Today's incident (read BEFORE executing any part of this plan)

Around 10:24 AM on 2026-04-17, I dispatched a subagent to execute Phase 2 Chunk 13 in a single task. The subagent:

1. Wrote a migration file dropping `User.role`.
2. Ran `npx prisma migrate deploy` — which hit production Neon (the local `.env` points at prod) and dropped the column.
3. Only committed **half** the code changes, leaving the branch in an incoherent state.

Meanwhile the deployed code (Phase 1 / PR #189) still reads `user.role` in several places. Without the column, every authenticated request saw "Access Pending." **Approximately 8 minutes of auth outage (~10:24–10:32 AM).**

Recovery:
- `ALTER TABLE "User" ADD COLUMN "role" ... ; UPDATE "User" SET "role" = roles[1]` — restored the column from each user's roles array.
- Deleted the errant migration row from `_prisma_migrations`.
- Deleted the local migration file.
- Reset the Phase 2 branch working tree to HEAD so the committed commits remain coherent.
- Drift check confirmed 0 users with empty roles, 0 drift between `role` and `roles[1]`, 57 users total.

### Lessons encoded into this plan

1. **Subagents MUST NOT run `prisma migrate deploy` or equivalent prod DDL.** Every step that would mutate prod DB is marked `[MIGRATION — orchestrator only]` in this plan. The orchestrator asks the user explicitly at each migration moment.
2. **Commit scope discipline: subagents declare every file they'll commit BEFORE starting.** If scope changes mid-task, they stop and report, not expand silently. Post-commit verification that only declared files are in the commit.
3. **Smaller subagent tasks.** "Do all of Cluster 3" was too big (80+ files, multi-subsystem). Split into 10-30-file chunks max.
4. **The `.env` → prod database gun is loaded.** Consider: (a) point local `.env` at a dev/shadow DB and use `.env.production-pull` only when explicitly promoting, or (b) rename local `.env`'s `DATABASE_URL` to force explicit selection, or (c) add a preflight script that requires typing `PROD` before any `migrate deploy` runs. Add this as a chore item (Part 4).

---

## Part 1 — Tiny fixes (1 PR, ~1 hour, low risk)

Three fixes unrelated to the big refactor; each stands alone.

### 1A — Remove the `requiresLocations` gate in `PUT /api/admin/users`

**Rationale:** The gate fires when an admin tries to change a user's role to a location-scoped role (OPERATIONS or VIEWER) without `allowedLocations` set. But [`buildLocationScope` in `scope-resolver.ts`](../../../src/lib/scope-resolver.ts) returns `{ type: "global" }` (all locations) when allowedLocations is empty AND `scopeEnforcementEnabled` is false. Scope enforcement is **off everywhere in production** (every non-test call site omits the flag). So the gate is rejecting legitimate role assignments — a user with `role=OPERATIONS` + empty locations works fine today.

**Decision needed before executing:**
- **D1** — Remove entirely (option A), or make it conditional on a feature flag so when scope enforcement is turned on, the gate kicks in (option B)? **Recommendation: option A.** Simpler, matches current reality. If enforcement is ever turned on, the UX needs re-design anyway (the gate alone isn't enough — we'd need messaging + UI affordances).

**Files:**
- `src/app/api/admin/users/route.ts` — delete the `requiresLocations` gate block.
- `src/__tests__/api/admin-users-role-update.test.ts` — delete or repurpose the "rejects switching to a location-scoped role when no locations are assigned" test. The other 2 tests stay.

**Acceptance:**
- Admin can change a user to OPERATIONS (or any location-scoped role) without locations set.
- Remaining tests pass.

---

### 1B — Fix `getSalesSurveyLeadTimeError` multi-role bypass (PR #189 review, score 75)

**Rationale:** The helper takes a single `role: UserRole` parameter. Call sites resolve a single role via `resolveEffectiveRoleFromRequest` (returns `roles[0]`). A user with roles `[PROJECT_MANAGER, SALES]` — PM first in the array — has the guard skipped because `role === "SALES"` check sees PM. The 2-day-out SALES survey lead-time guard doesn't fire.

**Files:**
- `src/lib/scheduling-policy.ts` — change `getSalesSurveyLeadTimeError({ role, ... })` signature to `({ roles, ... })`. Change the check from `role !== "SALES"` to `!roles.includes("SALES")`.
- Three call sites: `src/app/api/zuper/jobs/schedule/route.ts`, `src/app/api/zuper/jobs/schedule/confirm/route.ts`, `src/app/api/zuper/jobs/schedule/tentative/route.ts`. Each resolves `roles` via `resolveEffectiveRolesFromRequest` (the plural, from Chunk 9) and passes to the helper.

**Acceptance:**
- A test user with `roles: [PROJECT_MANAGER, SALES]` cannot book a survey for today/tomorrow via any of the 3 schedule endpoints.
- A test user with `roles: [SALES]` alone still cannot (unchanged behavior).
- Non-SALES users unaffected.

---

### 1C — Middleware comment drift (cosmetic, PR #189 review)

**Rationale:** [Line 160 of middleware.ts](../../../src/middleware.ts) says "Never let the cookie elevate to ADMIN/OWNER" but the code on line 163 blocks `ADMIN` and `EXECUTIVE`. OWNER normalizes to EXECUTIVE, so the code is semantically correct; the comment is just stale.

**Files:**
- `src/middleware.ts` — update the comment to read "Never let the cookie elevate to ADMIN/EXECUTIVE" (mention that OWNER normalizes to EXECUTIVE).

**Acceptance:** diff is 1 line.

---

### 1D — Packaging

One PR titled `fix(auth): drop spurious requiresLocations gate + multi-role SALES guard + comment drift`. Three small commits, one per fix. Self-review via `code-review:code-review` skill. Merge when clean. No migration, no prod risk.

---

## Part 2 — Phase 2 proper: finish the role→roles migration (2 PRs, ~3-5 days across execution)

### Decision before executing
- **D2** — Start from branch `feat/multi-role-phase-2` (salvaging the 3 Phase 2 commits from today — 72 files migrated role→roles in `src/app/api`, `src/app/admin|suites|dashboards|prototypes`, and partial lib/) OR start fresh from main? **Recommendation: start fresh from main.** Reasons: (a) the partial Cluster 3 commit is confusing provenance, (b) redoing the work in smaller chunks with the new safeguards catches any drift-bugs the subagent may have introduced silently, (c) the incident showed our scope discipline was weak; fresh start lets us re-verify each file.

### Structure — 2 PRs

#### PR 2A — Shim-internal migration + import-path sweep (code-only, no migration)

Goal: every non-test file imports from `@/lib/roles` or `@/lib/user-access`, not `@/lib/role-permissions`. Every `user.role` read becomes `user.roles`. Every `session.user.role` becomes `session.user.roles`. The shim stays in place — still re-exports everything — but nobody imports from it. This PR is safe to merge without touching the DB; prod runs identically.

**Execution (in Part 2A's branch):**

- [ ] Create branch `feat/multi-role-phase-2-redux` off latest main.
- [ ] Dispatch subagent for **Cluster A: `src/app/api/**`** (32 files). Subagent rules: declare files in scope at start, commit once, only touch the declared files.
- [ ] Dispatch subagent for **Cluster B: `src/app/{admin,suites,dashboards,prototypes}/**`** (11-13 files).
- [ ] Dispatch subagent for **Cluster C: `src/lib/**` + `src/components/**` + test fixtures** (10-15 files).
- [ ] After each cluster: orchestrator runs `npx tsc --noEmit` + `npx jest src/__tests__/lib src/__tests__/api/admin-users-role-update.test.ts`. If anything broke, fix in the same cluster before moving on.
- [ ] Final orchestrator pass: verify `rg -l 'from "@/lib/role-permissions"' src/ --type ts --glob '!src/__tests__/**'` returns 0 results. Same for `user.role\b(?!s)`.
- [ ] Self-review via `code-review:code-review` skill. Fix findings ≥80.
- [ ] Open PR, merge.

**What this PR does NOT do:**
- Delete `role-permissions.ts` / `access-scope.ts`
- Drop the `role` column
- Modify any migration
- Touch `auth.ts` back-compat
- Touch `middleware.ts` back-compat

Those all live in PR 2B.

#### PR 2B — Shim deletion, column drop, cleanup (the one with a migration)

Goal: delete the shim, drop the column, remove the Phase-1 dual-write/back-compat paths.

**Execution — every migration step is orchestrator-only:**

- [ ] Create branch `feat/multi-role-phase-2-cleanup` off main (post-2A merge).
- [ ] Subagent: move `ADMIN_ONLY_ROUTES` + `ADMIN_ONLY_EXCEPTIONS` from `role-permissions.ts` to `roles.ts` (break the circular import). Update `user-access.ts`'s `isPathAllowedByAccess` import. Commit.
- [ ] Subagent: delete `src/lib/role-permissions.ts` + `src/lib/access-scope.ts`. Commit.
- [ ] Subagent: remove Phase-1 dual-write logic in `src/lib/db.ts` (`updateUserRoles` writes `roles` only; delete the deprecated `updateUserRole` wrapper since PR 2A removed all callers). Commit.
- [ ] Subagent: remove Phase-1 back-compat in `src/auth.ts` (drop `token.role` / `session.user.role` writes, update module augmentation to remove `role?: string`). Commit.
- [ ] Subagent: update `src/app/api/auth/sync/route.ts` to drop `role` field from response. Commit.
- [ ] Subagent: update `src/app/api/admin/impersonate/route.ts` to drop `pb_effective_role` cookie write. Commit.
- [ ] Subagent: update `src/middleware.ts` to drop the `pb_effective_role` fallback read; drop `?? [token.role]` fallback in `tokenRoles` extraction. Commit.
- [ ] Subagent: update `src/lib/user-access.ts` — remove the `[user.role]` back-compat fallback in `resolveUserAccess`. Update `UserLike` type to require `roles`. Commit.
- [ ] Subagent: update `src/lib/scope-resolver.ts` — same back-compat removal. Commit.
- [ ] Subagent: update `src/components/SuitePageShell.tsx` — drop `role` prop, keep `roles` only. Update the 9 suite pages that pass both. Commit.
- [ ] Subagent: write the drop-column migration file (`prisma/migrations/<ts>_drop_user_role_column/migration.sql` with `ALTER TABLE "User" DROP COLUMN IF EXISTS "role"; DROP INDEX IF EXISTS "User_role_idx";`). Update `prisma/schema.prisma` to remove the `role` line + `@@index([role])`. **DO NOT RUN THE MIGRATION.** Commit the file only.
- [ ] Subagent: update CLAUDE.md — rewrite User Roles + Suite switcher visibility sections to describe the multi-role model. Commit.
- [ ] Orchestrator: `npx prisma generate` locally. `npx tsc --noEmit` across repo. `npx jest` full role-related tests. Fix anything broken.
- [ ] Orchestrator: self-review via `code-review:code-review` skill on the full PR. Fix findings ≥80.
- [ ] Orchestrator: push branch + open PR. **Do not merge yet.**
- [ ] **[MIGRATION — orchestrator only, WITH user approval]** Merge PR 2B. Wait for Vercel deploy to roll out (~2 min). Confirm deploy healthy (check Sentry, homepage loads). THEN run `set -a && source .env && set +a && npx prisma migrate deploy` against prod. Verify migration applied via drift-check script.
- [ ] Orchestrator: monitor for 30 minutes. If anything breaks, have the column-restore SQL ready (see Part 3 below).

**Rollback playbook (Part 3):**
If PR 2B causes prod issues after the migration runs:
1. Re-deploy PR #189's merge commit (revert all of PR 2B) via Vercel's deploy promotion.
2. If the `role` column is gone but code needs it: restore it with the same SQL used today — `ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'VIEWER'; UPDATE "User" SET "role" = roles[1]; CREATE INDEX "User_role_idx" ON "User"("role");`.
3. Delete the drop-migration row from `_prisma_migrations` so it doesn't re-run.

---

## Part 3 — Location model clarification (1 PR, discussion then small code)

The `requiresLocations` gate incident raised the question: is the location model actually doing what we want?

### Current state
- `User.allowedLocations: String[] @default([])` — comment says "empty = all locations"
- `buildLocationScope(allowedLocations, scopeEnforcementEnabled)`:
  - If `scopeEnforcementEnabled=false` + empty locations → `{ type: "global" }` (unrestricted)
  - If `scopeEnforcementEnabled=true` + empty locations → `{ type: "location", locations: [] }` (blocked)
- `scopeEnforcementEnabled` is **off at every non-test call site** in prod.
- Net: `allowedLocations` effectively does nothing in prod today. It's a filter primitive that's never enabled.

### Decision needed
- **D3** — Is scope enforcement an intended future feature (keep the machinery), or is it a relic of an earlier design that should be ripped out?
  - **Option X**: Keep the hooks. Leave `scopeEnforcementEnabled` parameter in place, keep `allowedLocations` column as-is. Someday flip a feature flag.
  - **Option Y**: Remove the machinery. Rename `allowedLocations` → `preferredLocations` (or similar) and treat it purely as a UI default filter, not an access constraint. Remove `scopeEnforcementEnabled` parameter. Simpler mental model.
- This is a product decision, not an engineering one. Bring this to the user's weekly review before starting work.

**If option Y is chosen:**

- [ ] Branch `feat/location-model-simplify` off main.
- [ ] Remove `scopeEnforcementEnabled` parameter from `resolveAccessScope` and related functions.
- [ ] `buildLocationScope` always returns `{ type: "global" }` for empty, `{ type: "location", ... }` for non-empty. No flag needed.
- [ ] Remove the `scopeEnforcementEnabled: true` test case as well (it was testing a feature that's never enabled in prod).
- [ ] Optional: rename `allowedLocations` → `defaultLocations` via migration. Low value, high churn — probably skip unless the team wants it.
- [ ] Update CLAUDE.md's Location restrictions section.

**If option X is chosen:**
- Leave as-is. Just fix Part 1A's `requiresLocations` gate and move on.

---

## Part 4 — Guardrails (small, valuable, should ship alongside or before Part 2B)

Today's incident could repeat if we don't add rails. Ship as a lightweight separate PR:

### 4A — Require explicit confirmation for `prisma migrate deploy` against prod

Add `scripts/migrate-prod.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "CONFIRM" ]]; then
  echo "Usage: scripts/migrate-prod.sh CONFIRM"
  echo ""
  echo "DATABASE_URL currently points at: $(set -a && source .env && set +a && echo "$DATABASE_URL" | sed -E 's/(:\/\/[^:]+:)[^@]+(@)/\1***\2/' | cut -c1-80)..."
  echo ""
  echo "This will apply pending Prisma migrations to that database."
  echo "Re-run with 'CONFIRM' as the only argument to proceed."
  exit 1
fi

echo "Applying migrations against $DATABASE_URL..."
set -a && source .env && set +a
npx prisma migrate deploy
```

Make executable. Document in CLAUDE.md: "Run migrations against prod via `scripts/migrate-prod.sh CONFIRM`, never directly."

### 4B — Subagent execution memory update

Add to [`~/.claude/projects/-Users-zach-Downloads-Dev-Projects-PB-Operations-Suite/memory/MEMORY.md`](file:///Users/zach/.claude/projects/-Users-zach-Downloads-Dev-Projects-PB-Operations-Suite/memory/MEMORY.md):

- New file: `feedback_subagents_no_migrations.md` — "Subagents MUST NOT run `prisma migrate deploy` or any DDL-producing command. Migration steps are orchestrator-only and require explicit user approval at the moment. Subagents writing migration FILES is fine; running them is not."

### 4C — `.env` safety

Consider renaming `.env` → `.env.prod` on local and requiring `dotenv -f .env.prod -- <cmd>` for explicit prod access. Tradeoff: breaks `npm run dev` unless we add a `.env.local` pointing at dev DB. Discuss with user before doing — involves dev workflow changes.

---

## Sequencing

Recommended order (all happen next week):

1. **Monday morning — Part 1 (all 3 tiny fixes + Part 4A migration guard).** One PR. Ship.
2. **Monday afternoon — user decides on D3 (location model).** If Option Y, schedule Part 3 next.
3. **Tuesday / Wednesday — PR 2A (shim-internal migration).** Biggest effort but safe (no DB change). Ship when green.
4. **Thursday — PR 2B (shim delete + column drop).** Requires the explicit migration gate. Ship in a low-traffic window (early morning).
5. **Friday — monitor + cleanup.** If Part 3 Option Y was chosen, ship it now.

Each step is independently revertible. No single PR touches more than one concern.

## Out of scope (not for next week)

- Removing the `UserRole` enum's 4 legacy values (OWNER, MANAGER, DESIGNER, PERMITTING). They normalize to canonical roles; the Prisma enum can keep them indefinitely. Revisit if/when we do a User table backfill.
- Per-role home-page widgets (dashboards with live data vs card links). Separate design.
- Fine-grained permissions (the "Option B" rejected during brainstorming).

## Risks

| Risk | Mitigation |
|---|---|
| Part 2A missing a call site → Part 2B's shim delete breaks prod | Part 2A's final step greps for `"@/lib/role-permissions"` imports + direct `user.role` reads; must be 0 before PR ships. Part 2B adds compile errors that CI catches if any sneak through. |
| Column-drop migration fires before Part 2B's code deploys | Migration executes AFTER merge + Vercel rollout confirmed, per Part 2B's checklist. Not before. |
| Incident repeats (subagent runs migration) | Part 4A + 4B add a script-level gate and a memory-level rule. |
| Legacy JWT sessions carry only `role` and reject after Part 2B | Phase 1's JWT callback backfills `token.roles = [token.role]` on refresh. JWTs refresh every request that touches the session. Worst case: one stale tab sees a micro-glitch, auto-recovers. |
| Locations UX gets worse after Part 3 Option Y | N/A — Option Y is cosmetic/simplification; same user-facing behavior. |

## Open decisions (user answers before starting execution)

- **D1** — Part 1A: remove `requiresLocations` gate entirely (Option A, recommended) vs. make conditional on scope flag (Option B)?
- **D2** — Part 2: start fresh from main (recommended) vs. salvage `feat/multi-role-phase-2` branch commits?
- **D3** — Part 3: is scope enforcement an intended future feature (Option X, keep machinery) or a relic to rip out (Option Y, simplify)?
- **D4** — Part 4C: rename local `.env` to `.env.prod` to force explicit selection? (Breaks `npm run dev` unless `.env.local` is added.)

Three mechanical answers + one product answer. Ideally answered before Monday.
