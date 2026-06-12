# Directory Identity Links — HubSpot, Zuper, CrewMember

**Date:** 2026-06-12
**Status:** Approved (design discussed with Zach; "your call" delegation for execution)

## Problem

App users now cover the whole Workspace domain (226 accounts synced 2026-06-12), but their identities in other systems are disconnected:

- `User.hubspotOwnerId` exists but is mostly null — My Tasks falls back to heuristic email matching at runtime.
- Zuper user identity has no home on `User` at all. Zuper UIDs live on `CrewMember`, a separate model keyed by name with optional email, not linked to `User`.
- Admins have no way to see who-is-who across systems, and no place to hand-fix a bad match.

## Goals

1. **Admin visibility** — each user's HubSpot owner ID, Zuper user UID, and CrewMember link visible and editable in /admin/users.
2. **Personalized views** — "my stuff" features resolve identity from stored links, not runtime email heuristics.
3. **Unify CrewMember + User** — field-crew records connect to app users via a link. (v1 delivers the link + admin visibility only — no merged directory view.)

Out of scope (v1): Zoho Inventory users (no per-user use case yet), Aircall/Freshservice identities, offboarding automation, any change to scheduling code that consumes CrewMember.

## Design

### Schema (additive only)

```prisma
model User {
  zuperUserUid String?  // Zuper user UID, mirrors hubspotOwnerId pattern
  crewMember   CrewMember? @relation("CrewMemberUser")
}

model CrewMember {
  userId String? @unique
  user   User?   @relation("CrewMemberUser", fields: [userId], references: [id])
}
```

Migration ships and applies to prod **before** the code that reads the new columns merges (Vercel-build/Prisma-regen ordering rule). Migration apply is orchestrator-only with explicit user approval.

### Sync flow

`POST /api/admin/sync-workspace` (route path unchanged for back-compat; button label becomes **"Sync Directory"**) runs four phases:

1. **Google Workspace upsert** — existing behavior, unchanged.
2. **HubSpot owners** — fetch all owners. The 403-backoff + pagination logic exists inline in hubspot.ts's owner-map builder; extract/export a `fetchAllOwners()` from it rather than duplicating. Match on lowercased email. Fill `User.hubspotOwnerId` where null.
3. **Zuper users** — fetch via existing `zuper.getUsers()`. Match on lowercased email. Fill `User.zuperUserUid` where null.
4. **CrewMember links** — for each active CrewMember:
   - has email → match to User on lowercased email, fill `CrewMember.userId` where null.
   - no email → compute name-match candidate (normalized full-name equality against User.name). Candidates are **returned in the response for manual review, never written**.

**Overwrite rules:** null links get filled; existing values are never overwritten or cleared by sync. Manual corrections always survive re-syncs. Suspended/inactive external users are not matched.

Response/result shape per system: `{ linked, alreadyLinked, unmatched, candidates? }`. Audit log entry extends the existing `workspace_sync` activity with per-system counts.

If phase 2 or 3 fails (e.g., owners API 403 window), the sync reports that phase as skipped with a reason and continues — phases are independent.

### Admin UI

- **User detail drawer** (`/admin/users` → drawer): new "Linked accounts" section showing HubSpot owner, Zuper user, CrewMember — each with the matched display name, or "Not linked". Each row is editable via a searchable dropdown populated from the live owner/user/crew lists (fetched on drawer open through admin API endpoints). Saving writes the link directly; an explicit "Unlink" clears it.
- **Users table**: small badges (HS / ZP / Crew) per row indicating which links are present.
- **Sync toast**: per-system counts. When name-match candidates exist, the result panel lists the actual pairs (CrewMember → suggested User) with a one-click "open in drawer" per pair — count-only would force the admin to rediscover the matches by hand.

**Existing infrastructure discovered during planning:** the HubSpot link picker already exists end-to-end — `GET /api/admin/hubspot-owners` (cached picker options) and `PATCH /api/admin/users/[userId]/hubspot-owner`, wired into the user detail drawer. New endpoints follow that per-system pattern rather than a combined `identity/options` route:

- `GET /api/admin/zuper-users` — `{ users: [{ uid, email, name }] }` for the Zuper picker (cached ~5 min, mirrors hubspot-owners).
- `GET /api/admin/crew-options` — active CrewMembers `{ id, name, email, linkedUserId }` for the crew picker.
- `PATCH /api/admin/users/[userId]/zuper-user` — set/clear `zuperUserUid` (mirrors hubspot-owner PATCH).
- `PATCH /api/admin/users/[userId]/crew-link` — set/clear the CrewMember link. Relink conflicts are rejected, not stolen: linking to a CrewMember already linked to a different User returns 409 with the conflicting user named — the admin must unlink there first. Logs admin activity.

All under `/api/admin/*` (covered by the existing `ADMIN_ONLY_ROUTES` middleware prefix — no roles.ts allowlist changes needed).

### Consumers

- **My Tasks**: already prefers `User.hubspotOwnerId` with heuristic email fallback. No code change; backfill makes the heuristic the rare path.
- Nothing else changes behavior in v1. `User.zuperUserUid` and `CrewMember.userId` exist for admin visibility and future "my jobs" views.

### Error handling

- Email comparison: trim + lowercase both sides; ignore external users with no email.
- Duplicate external emails (two HubSpot owners sharing an email): skip + report in `unmatched` with reason rather than guessing. Same rule generalized to crew links: `CrewMember.userId` is `@unique` per User, so if a User is already claimed by another CrewMember, skip + report instead of violating the constraint.
- Shared mailboxes (accounting@ etc.) simply won't match anything — they stay unlinked, which is correct.

### Testing

Unit tests for the matcher module (pure functions, no I/O):
- email normalization (case, whitespace)
- null-fill vs. never-overwrite
- name-candidate generation flags instead of writes
- duplicate-email skip
- no-email externals ignored

Route-level test for the PATCH links endpoint (admin gate, validation).

## Implementation order

1. Prisma migration (additive) — apply to prod with user approval.
2. Matcher module + tests.
3. Sync route phases 2–4.
4. Admin API endpoints.
5. Drawer UI + table badges + toast.
