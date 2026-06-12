# Directory Identity Links Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link app Users to their HubSpot owner, Zuper user, and CrewMember identities — auto-matched by email during directory sync, hand-editable in /admin/users.

**Architecture:** A pure matcher module (`src/lib/directory-links.ts`) computes link fills from (users × externals) with never-overwrite semantics. The existing `/api/admin/sync-workspace` route gains three phases that call it. Admin UI mirrors the already-shipped HubSpot owner picker pattern (GET options route + per-user PATCH route + drawer section).

**Tech Stack:** Next.js 16 route handlers, Prisma 7 (Neon), Jest, existing `zuper.getUsers()` + `hubspotClient.crm.owners` clients.

**Spec:** `docs/superpowers/specs/2026-06-12-directory-identity-links-design.md`

**Branch:** `feature/directory-identity-links` off `origin/main`.

**Already exists (do not rebuild):** HubSpot owner picker — `GET /api/admin/hubspot-owners`, `PATCH /api/admin/users/[userId]/hubspot-owner`, drawer UI (`_UserDetailDrawer.tsx` `loadHubspotOwners`/`onSaveHubspotOwner`). New work mirrors these files.

**Migration gate:** Task 1 writes the migration file but NOBODY runs `prisma migrate deploy` — orchestrator surfaces it to Zach for explicit approval, and it must be applied to prod before the PR merges (additive-migration-before-code rule).

---

## Chunk 1: Schema + matcher

### Task 1: Prisma schema + migration file

**Files:**
- Modify: `prisma/schema.prisma` (User model ~line 60s, CrewMember model ~line 1077)
- Create: `prisma/migrations/20260612230000_add_user_directory_links/migration.sql`

- [ ] **Step 1: Add fields to schema**

In `model User`, next to `hubspotOwnerId`:

```prisma
  // Zuper user link — mirrors hubspotOwnerId. Filled by directory sync
  // (email match) or set manually in /admin/users. Never auto-overwritten.
  zuperUserUid String?

  crewMember CrewMember? @relation("CrewMemberUser")
```

In `model CrewMember`, after `email`:

```prisma
  // App user link — connects field-crew records to app Users.
  userId String? @unique
  user   User?   @relation("CrewMemberUser", fields: [userId], references: [id])
```

- [ ] **Step 2: Write migration SQL**

```sql
-- Additive: User.zuperUserUid + CrewMember.userId link
ALTER TABLE "User" ADD COLUMN "zuperUserUid" TEXT;
ALTER TABLE "CrewMember" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "CrewMember_userId_key" ON "CrewMember"("userId");
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate client + typecheck**

Run: `npx prisma generate && npx tsc --noEmit -p tsconfig.json`
Expected: clean (project-wide tsc, not single-file).

- [ ] **Step 4: Commit** — `feat: schema for directory identity links (migration NOT applied)`

### Task 2: Matcher module (TDD)

**Files:**
- Create: `src/lib/directory-links.ts`
- Test: `src/__tests__/directory-links.test.ts`

Pure functions, no I/O. Interface:

```ts
export interface ExternalIdentity { id: string; email: string | null; label: string }
export interface LinkableUser { id: string; email: string; existingLink: string | null; name: string | null }
export interface LinkPlan {
  fills: Array<{ userId: string; externalId: string; label: string }>;
  alreadyLinked: number;
  unmatched: Array<{ email: string; reason: "no-external-match" | "duplicate-external-email" }>;
}
export function normalizeEmail(raw: string | null | undefined): string | null;
export function planLinkFills(users: LinkableUser[], externals: ExternalIdentity[]): LinkPlan;
export interface CrewCandidate { crewMemberId: string; crewName: string; userId: string; userName: string }
export function nameMatchCandidates(
  crew: Array<{ id: string; name: string; email: string | null; userId: string | null }>,
  users: Array<{ id: string; name: string | null; email: string }>,
): CrewCandidate[];
```

- [ ] **Step 1: Write failing tests** covering, at minimum:
  - `normalizeEmail`: trims, lowercases, returns null for null/empty/whitespace.
  - `planLinkFills`: fills null-link users on email match; counts users whose `existingLink` is already set as `alreadyLinked` WITHOUT changing them (never-overwrite); externals with null email are ignored; two externals sharing an email → affected user lands in `unmatched` with `duplicate-external-email`; user email with no external → `no-external-match`.
  - `nameMatchCandidates`: only crew with null email AND null userId produce candidates; name comparison is case/whitespace-insensitive exact match on full name; a crew name matching zero users produces nothing; matching 2+ users produces nothing (ambiguous — manual only).
- [ ] **Step 2: Run** `npm test -- directory-links` — expect FAIL (module missing).
- [ ] **Step 3: Implement minimal module.**
- [ ] **Step 4: Run** `npm test -- directory-links` — expect PASS.
- [ ] **Step 5: Commit** — `feat: directory link matcher (pure, never-overwrite)`

## Chunk 2: Sync phases + admin APIs

### Task 3: fetchAllOwners helper + sync route phases

**Files:**
- Modify: `src/lib/hubspot.ts` — add exported `fetchAllOwnersMinimal(): Promise<Array<{id: string; email: string | null; firstName: string | null; lastName: string | null}>>` — paginated active owners via `hubspotClient.crm.owners.ownersApi.getPage(undefined, after, 500, false)`, respecting `ownersApiAllowed()`/`markOwnersApiForbidden()` (returns `[]` when in the 403 window). Lift the pagination loop currently inlined in `/api/admin/hubspot-owners/route.ts` and have that route call this helper (DRY).
- Modify: `src/app/api/admin/hubspot-owners/route.ts` — use the helper, keep cache + response shape identical.
- Modify: `src/app/api/admin/sync-workspace/route.ts`

Sync route additions after the existing Google loop (each phase wrapped in try/catch so a failure reports `{ skipped: reason }` and the rest continue):

```ts
// Phase 2: HubSpot owners → User.hubspotOwnerId
const owners = await fetchAllOwnersMinimal();
const hsPlan = planLinkFills(
  appUsers.map(u => ({ id: u.id, email: u.email, existingLink: u.hubspotOwnerId, name: u.name })),
  owners.map(o => ({ id: o.id, email: o.email, label: `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() })),
);
for (const f of hsPlan.fills) await prisma.user.update({ where: { id: f.userId }, data: { hubspotOwnerId: f.externalId } });

// Phase 3: Zuper users → User.zuperUserUid
//   import { zuper } from "@/lib/zuper" (singleton — there is NO getZuperClient()).
//   const res = await zuper.getUsers("sync-workspace:links"); res is ZuperApiResponse —
//   check res.type === "success" and unwrap res.data, else phase reports skipped.
//   Filter inactive: (u as any).is_active !== false (field exists on the wire even though
//   the minimal ZuperUser interface omits it — see sync-zuper/route.ts:161 precedent).
//   Map user_uid → id, `${first_name} ${last_name}` → label.
// Phase 4: CrewMember.userId — fetch crew with isActive: true only (spec: active crew).
//   Email-matched crew filled via planLinkFills inversion: each unlinked crew-with-email
//   is the link target. Guard the @unique constraint: skip fill if target User already
//   claimed by another CrewMember (report in unmatched).
//   Crew without email → nameMatchCandidates(), returned in response, never written.
```

`appUsers` = one `prisma.user.findMany({ select: { id, email, name, hubspotOwnerId, zuperUserUid } })` fetched once after phase 1 so phases 2–3 share it.

Response gains `links: { hubspot: {...}, zuper: {...}, crew: {...counts, candidates[] } }`; audit metadata gains the same counts (keep `entityType: "workspace_sync"`).

- [ ] Extract + reuse `fetchAllOwnersMinimal`, typecheck, commit — `refactor: extract fetchAllOwnersMinimal`
- [ ] Implement phases 2–4 with per-phase try/catch, commit — `feat: directory sync link phases`
- [ ] Verify: `npm test -- directory-links` (no sync-workspace test exists — don't invent the pattern) and project-wide tsc pass.

Note: carry the existing 10-page (5,000 owner) pagination cap from the hubspot-owners route into `fetchAllOwnersMinimal` — and unlike the current route, gate on `ownersApiAllowed()` (return `[]` inside the 403 window).

### Task 4: Zuper/crew options + PATCH routes

**Files (mirror the hubspot-owner pair exactly — same auth gate, cache, activity logging):**
- Create: `src/app/api/admin/zuper-users/route.ts` — GET; `zuper.getUsers()` → `{ users: [{ uid, email, name }] }`, `appCache` key `zuper:users:admin-picker`, 5-min TTL.
- Create: `src/app/api/admin/crew-options/route.ts` — GET; active CrewMembers → `{ crew: [{ id, name, email, linkedUserId }] }` (no cache — cheap DB read).
- Create: `src/app/api/admin/users/[userId]/zuper-user/route.ts` — PATCH `{ zuperUserUid: string | null }`; on set, validate uid exists in `zuper.getUsers()` result; log admin activity.
- Create: `src/app/api/admin/users/[userId]/crew-link/route.ts` — PATCH `{ crewMemberId: string | null }`; null clears (set that crew's `userId = null`); set validates crew exists and returns **409 naming the conflicting user** if `crew.userId` is already a different user; writes `CrewMember.userId = userId`; log admin activity.

Copy the auth/validation skeleton from `src/app/api/admin/users/[userId]/hubspot-owner/route.ts`. Heads-up: that route has NO activity logging — for the new PATCH routes use `logAdminActivity` + `extractRequestContext` from `@/lib/audit/admin-activity` (working example at the top of `src/app/api/admin/sync-workspace/route.ts`).

- [ ] Implement all four routes, typecheck, commit — `feat: zuper/crew link admin endpoints`
- [ ] Route test for crew-link PATCH (admin gate 403, conflict 409, clear, set) in `src/__tests__/api/` following existing route test patterns; run, commit.

## Chunk 3: UI

### Task 5: Drawer "Linked accounts" + badges + toast

**Files:**
- Modify: `src/app/admin/users/_UserDetailDrawer.tsx` — extend the existing HubSpot owner section into a "Linked accounts" group with two more rows (Zuper user, Crew member), each cloning the HubSpot picker pattern: lazy-load options on first expand, searchable select, Save/Unlink, inline error on 409 (display the server's conflicting-user message).
- Modify: `src/app/admin/users/page.tsx` — (a) row badges: small `HS` / `ZP` / `Crew` chips (theme tokens, `text-muted` when absent — render only present ones); (b) `syncWorkspace()` result handling: render per-system counts from `links`, and when `links.crew.candidates` is non-empty list the pairs ("Drew Perry → drew@…") each opening that user's drawer; (c) button label → "Sync Directory".
- Modify: `src/lib/db.ts` `getAllUsers()` — the admin users GET payload comes from here (a bare `findMany`), NOT from logic in the route file. `zuperUserUid` appears automatically post-migration; add `include: { crewMember: { select: { id, name } } }` so badges/drawer have the crew link.

- [ ] Implement, typecheck, `npm run lint`, commit — `feat: linked accounts UI in admin users`
- [ ] Verify in browser (preview or prod after deploy): drawer shows three link rows; badges render; sync toast shows link counts.

### Task 6: Finish line

- [ ] `npm test` (full suite), `npm run lint`, `npm run preflight` — all green.
- [ ] **Surface migration to Zach for approval + apply to prod** (orchestrator-only). DANGER: the main checkout contains two untracked, unmerged migration dirs (`20260515040000_add_extended_property_rollups`, `20260517210000_add_extended_rollup_columns`) with duplicate SQL — `migrate deploy` from there could apply them and fail on duplicate columns. Run `npx prisma migrate status` first, and apply from the clean feature worktree (branched off origin/main, where those dirs don't exist).
- [ ] PR via commit-push-pr; verify `git log branch ^main --stat` contains only this feature + spec/plan docs.
