# On-Call Electrician Rotations — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship V1 of a daily on-call rotation calendar covering three pools (California, Denver, Southern CO), with admin-driven publish, swap, and PTO flows. Self-service phone view, approval queue UI, and non-iCal exports are deferred to a V1.1 follow-up plan.

**Architecture:** Four new Prisma models (`OnCallPool`, `OnCallPoolMember`, `OnCallAssignment`, `OnCallSwapRequest`, `OnCallPtoRequest`) anchor rotation state. A pure `on-call-rotation.ts` library computes generated assignments via modular arithmetic. API routes under `/api/on-call/*` handle CRUD, publish, swap/PTO lifecycle, workload stats, and the iCal subscribe feed. Three UI pages at `/dashboards/on-call/*` (main dashboard, month view, admin setup) cover the V1 admin workflow. Feature-flagged throughout via `ON_CALL_ROTATIONS_ENABLED` (server) and `NEXT_PUBLIC_ON_CALL_ROTATIONS_ENABLED` (client).

**Tech Stack:** Next.js 16, React 19, Prisma 7.3, Tailwind v4, React Query v5, Google Workspace email

**Spec:** [docs/superpowers/specs/2026-04-20-on-call-electrician-rotations-design.md](../specs/2026-04-20-on-call-electrician-rotations-design.md)

**Scope boundary:** V1 is admin-managed. Admins create pools, publish rotations, and record swaps/PTO on behalf of electricians via the Day Actions drawer. Electrician self-service (phone view at `/me`, approval queue UI, propose flows) lands in V1.1. Email notifications for pool Publish use a single template; swap/PTO notification emails use a stub logger until V1.1.

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/lib/on-call-rotation.ts` | Pure rotation generation, swap/PTO reassignment logic, workload stats computation. Client-safe (no Prisma imports). |
| `src/lib/on-call-holidays.ts` | US federal holiday constants for 2026/2027 with a function `isFederalHoliday(date: string): boolean` |
| `src/lib/on-call-db.ts` | Thin Prisma helpers for pool/assignment/request reads and writes; wraps transactions |
| `src/lib/on-call-ical.ts` | iCal feed generation (RFC 5545) from assignments + pool config |
| `src/lib/feature-flags.ts` | Shared helper `isOnCallRotationsEnabled()` — reads env var, used server + client side |
| `src/app/api/on-call/tonight/route.ts` | GET — all pools' current on-call |
| `src/app/api/on-call/assignments/route.ts` | GET — range query across pool(s) |
| `src/app/api/on-call/workload/route.ts` | GET — per-electrician monthly stats for a pool |
| `src/app/api/on-call/pools/route.ts` | GET/POST |
| `src/app/api/on-call/pools/[id]/route.ts` | GET/PATCH/DELETE |
| `src/app/api/on-call/pools/[id]/members/route.ts` | GET/POST/PATCH (reorder + toggle active) |
| `src/app/api/on-call/pools/[id]/publish/route.ts` | POST — run generation + persist + fire monthly preview email |
| `src/app/api/on-call/pools/[id]/rotate-token/route.ts` | POST — rotate iCal token |
| `src/app/api/on-call/swaps/route.ts` | GET/POST |
| `src/app/api/on-call/swaps/[id]/accept/route.ts` | POST — counterparty accepts |
| `src/app/api/on-call/swaps/[id]/approve/route.ts` | POST — admin approves (transactional apply) |
| `src/app/api/on-call/swaps/[id]/deny/route.ts` | POST — admin denies |
| `src/app/api/on-call/pto/route.ts` | GET/POST |
| `src/app/api/on-call/pto/[id]/approve/route.ts` | POST — admin approves with reassignments |
| `src/app/api/on-call/pto/[id]/deny/route.ts` | POST |
| `src/app/api/on-call/me/route.ts` | GET — logged-in user's shifts (stub for V1) |
| `src/app/api/on-call/calendar/[poolId]/route.ts` | GET — iCal feed by token (public route) |
| `src/app/dashboards/on-call/page.tsx` | Main dashboard — hero strip + 14-day lookahead |
| `src/app/dashboards/on-call/month/page.tsx` | Month view + workload sidebar |
| `src/app/dashboards/on-call/setup/page.tsx` | Admin setup (pool config + publish) |
| `src/app/dashboards/on-call/layout.tsx` | Feature flag gate → 404 when off |
| `src/components/on-call/HeroStrip.tsx` | Client component — tonight cards × 3 pools |
| `src/components/on-call/LookaheadGrid.tsx` | Client component — 14-day horizontal strip |
| `src/components/on-call/MonthCalendar.tsx` | Client component — full month grid with day-click |
| `src/components/on-call/WorkloadSidebar.tsx` | Client component — per-person stats panel |
| `src/components/on-call/DayActionDrawer.tsx` | Client component — swap/pto/notes tabbed drawer |
| `src/components/on-call/PoolConfigCard.tsx` | Client component — drag-reorder + active toggle |
| `src/components/on-call/PublishCard.tsx` | Client component — publish state + button |
| `src/emails/OnCallMonthlyPreview.tsx` | React Email template for Publish-run preview |
| `src/__tests__/lib/on-call-rotation.test.ts` | Unit tests — cycle math, DST, inactive, workload |

### Modified Files
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 5 new models + new `ActivityType` enum values |
| `src/lib/roles.ts` | Add `/dashboards/on-call` + `/api/on-call` to role allowlists |
| `src/middleware.ts` | Add `/api/on-call/calendar` to `PUBLIC_API_ROUTES` |
| `src/lib/query-keys.ts` | Add `onCall` keys |
| `src/lib/cache.ts` | Add `ON_CALL_TONIGHT` cache key |
| `src/app/suites/executive/page.tsx` | Add "On-Call Electricians" tile (visible only when flag on) |
| `.env.example` | Add `ON_CALL_ROTATIONS_ENABLED` + `NEXT_PUBLIC_ON_CALL_ROTATIONS_ENABLED` |

---

## Chunk 1: Data Model

### Task 1: Add Prisma models + ActivityType values

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add new models at end of schema file + edit CrewMember block**

Append the 5 models defined in the spec (OnCallPool, OnCallPoolMember, OnCallAssignment, OnCallSwapRequest, OnCallPtoRequest) at the end of `prisma/schema.prisma`.

Additionally, **edit the existing `CrewMember` model** (around line 739) to add back-relations:

```prisma
// Inside existing CrewMember model, alongside availabilities / overrides:
onCallMemberships     OnCallPoolMember[]
onCallAssignments     OnCallAssignment[]
onCallSwapsRequested  OnCallSwapRequest[]  @relation("RequesterSwaps")
onCallSwapsAsCounterparty OnCallSwapRequest[] @relation("CounterpartySwaps")
onCallPtoRequests     OnCallPtoRequest[]
```

On the new `OnCallSwapRequest` model, use **named relations** to disambiguate the two CrewMember foreign keys:

```prisma
requesterCrewMember     CrewMember @relation("RequesterSwaps", fields: [requesterCrewMemberId], references: [id])
counterpartyCrewMember  CrewMember @relation("CounterpartySwaps", fields: [counterpartyCrewMemberId], references: [id])
```

Without named relations, Prisma will fail at `generate` time with "ambiguous relation."

Keep the `@@unique([poolId, date])` on `OnCallAssignment` unnamed so Prisma generates the default composite key name `poolId_date` — the transactional code in Task 11 relies on this exact name.

- [ ] **Step 2: Add ActivityType enum values**

In `ActivityType` (schema.prisma line ~97), add these values in alphabetical-adjacent clusters:
- `ON_CALL_POOL_CREATED`, `ON_CALL_POOL_UPDATED`, `ON_CALL_POOL_MEMBERS_CHANGED`
- `ON_CALL_PUBLISHED`
- `ON_CALL_SWAP_REQUESTED`, `ON_CALL_SWAP_ACCEPTED`, `ON_CALL_SWAP_APPROVED`, `ON_CALL_SWAP_DENIED`, `ON_CALL_SWAP_CANCELLED`
- `ON_CALL_PTO_REQUESTED`, `ON_CALL_PTO_APPROVED`, `ON_CALL_PTO_DENIED`, `ON_CALL_PTO_CANCELLED`
- `ON_CALL_MANUAL_OVERRIDE`
- `ON_CALL_ICAL_TOKEN_ROTATED`

- [ ] **Step 3: Generate Prisma client locally**

Run:
```bash
npx prisma generate
```

**Do NOT run migrations.** Per user memory: subagents/orchestrator do not invoke `prisma migrate deploy` or `prisma migrate dev`. Just generate the client so TypeScript sees the new models. User will run migrations manually after review.

- [ ] **Step 4: Create a migration file without applying it**

Create the migration directory first:
```bash
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_add_on_call_rotations"
```

Diff current migrations history against the new schema to generate the SQL:
```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "prisma/migrations/${TS}_add_on_call_rotations/migration.sql"
```

Verify the SQL is non-empty and sane:
```bash
wc -l prisma/migrations/${TS}_add_on_call_rotations/migration.sql
# Should be ~100+ lines (5 tables, indexes, unique constraints, enum ALTERs)
```

**Flag to user:** "Migration file created at `prisma/migrations/${TS}_add_on_call_rotations/migration.sql` but not applied. Please run `npm run db:migrate` when ready, or review the SQL first and apply via your preferred process." Per user memory (`feedback_subagents_no_migrations.md` and `feedback_migration_ordering.md`): **do not invoke `prisma migrate deploy` or `prisma migrate dev`**. The file waits for user's manual apply on a deployed branch only.

---

## Chunk 2: Pure Logic & Helpers

### Task 2: Rotation generation library

**Files:**
- Create: `src/lib/on-call-rotation.ts`
- Create: `src/lib/on-call-holidays.ts`
- Create: `src/__tests__/lib/on-call-rotation.test.ts`

- [ ] **Step 1: Holiday constants**

```ts
// src/lib/on-call-holidays.ts
export const FEDERAL_HOLIDAYS_2026: Array<{ date: string; name: string }> = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-19", name: "Martin Luther King Jr. Day" },
  { date: "2026-02-16", name: "Presidents Day" },
  { date: "2026-05-25", name: "Memorial Day" },
  { date: "2026-06-19", name: "Juneteenth" },
  { date: "2026-07-04", name: "Independence Day" },
  { date: "2026-09-07", name: "Labor Day" },
  { date: "2026-10-12", name: "Columbus Day" },
  { date: "2026-11-11", name: "Veterans Day" },
  { date: "2026-11-26", name: "Thanksgiving Day" },
  { date: "2026-12-25", name: "Christmas Day" },
];

// Include 2027 similarly.

export function isFederalHoliday(dateStr: string): boolean { /* lookup */ }
export function holidayName(dateStr: string): string | null { /* lookup */ }
```

- [ ] **Step 2: Rotation library**

```ts
// src/lib/on-call-rotation.ts
export type RotationMember = { crewMemberId: string; orderIndex: number; isActive: boolean };
export type GeneratedAssignment = { date: string; crewMemberId: string };

/**
 * Pure function — no I/O. Generates assignments from fromDate to toDate (inclusive)
 * using strict round-robin over active members, anchored to startDate.
 *
 * Dates are YYYY-MM-DD strings in the pool's timezone. The function does NOT touch
 * Date objects beyond simple day-difference math to avoid DST/tz drift.
 */
export function generateAssignments(opts: {
  startDate: string;
  fromDate: string;
  toDate: string;
  members: RotationMember[];
}): GeneratedAssignment[];

export function daysBetween(a: string, b: string): number;
export function addDays(date: string, n: number): string;
export function isWeekend(date: string): boolean;

/**
 * Computes workload stats for a month (YYYY-MM) in the pool's tz.
 * Returns per-crewMemberId: days, weekends, holidays.
 */
export function computeWorkload(opts: {
  month: string; // YYYY-MM
  assignments: GeneratedAssignment[];
  timezone: string;
}): Record<string, { days: number; weekends: number; holidays: number }>;

/**
 * For Day Actions "recommended replacement" — ranks pool members by least-loaded
 * (current-month days, then weekends, then holidays). Excludes members who are
 * on-call adjacent day or on approved PTO on the target date.
 */
export function rankReplacements(opts: {
  targetDate: string;
  currentAssignments: GeneratedAssignment[];
  members: RotationMember[];
  ptoDates: Set<string>; // flattened PTO for the pool
  month: string;
  timezone: string;
}): Array<{ crewMemberId: string; rank: number; reason: "recommended" | "eligible" | "adjacent-conflict" | "pto" }>;
```

- [ ] **Step 3: Unit tests — cycle math and edges**

Test cases:
1. Basic 4-member pool, 14 consecutive days — cycles correctly, wraps at day 4.
2. Start date in past, query window in future — correct offset computation.
3. Single active member (rest inactive) — every day assigned to same person.
4. All members inactive — throws with clear error.
5. DST spring-forward date (Mar 8 2026) — date string math unaffected.
6. DST fall-back date (Nov 1 2026) — same.
7. Leap day (Feb 29 2028) — same.
8. `isWeekend("2026-05-02")` → true (Sat), `"2026-05-04"` → false (Mon).
9. `computeWorkload` — 10-person pool, May 2026, each person ~3 days, weekends spread across members.
10. `rankReplacements` — correctly sorts by load, excludes PTO and adjacent-day conflicts.

Tests must pass with `npm run test`.

### Task 3: Feature flag helper

**Files:**
- Create: `src/lib/feature-flags.ts`

- [ ] **Step 1:** Export `isOnCallRotationsEnabled()` that reads `process.env.ON_CALL_ROTATIONS_ENABLED === "true"`. Also export `isOnCallRotationsEnabledClient()` for client code that reads `process.env.NEXT_PUBLIC_ON_CALL_ROTATIONS_ENABLED`.

### Task 4: iCal feed generator

**Files:**
- Create: `src/lib/on-call-ical.ts`

- [ ] **Step 1: Pure iCal generator**

```ts
export function generateIcal(opts: {
  poolName: string;
  poolTz: string;
  shiftStart: string; // "17:00"
  shiftEnd: string;   // "07:00"
  assignments: Array<{ date: string; crewMemberName: string }>;
}): string; // RFC 5545 VCALENDAR string
```

Events span shift start (date at 17:00 local) → next-day shift end (07:00 local). Event title "On-Call: {crewMemberName}". DTSTART/DTEND use `TZID=` with the pool's IANA timezone.

---

## Chunk 3: Feature Flag Gate & Middleware Wiring

### Task 5: Add public route + role allowlist entries

**Files:**
- Modify: `src/middleware.ts`
- Modify: `src/lib/roles.ts`
- Modify: `.env.example`

- [ ] **Step 1: Public route**

Append `"/api/on-call/calendar"` to `PUBLIC_API_ROUTES` in `src/middleware.ts`. This bypasses session auth — the iCal handler validates `?token=` itself.

- [ ] **Step 2: Role allowlists**

**Canonical roles with independent `allowedRoutes`** in `src/lib/roles.ts` (from the file as of this plan's writing):

| Role | allowedRoutes handling |
|------|-----------------------|
| ADMIN | Uses `["*"]` — no change needed |
| EXECUTIVE | Uses `["*"]` — no change needed (OWNER is a legacy alias referencing EXECUTIVE — inherits automatically) |
| OPERATIONS_MANAGER | Add all paths listed below under "viewing" + "approving" |
| PROJECT_MANAGER | Add paths listed under "viewing" only |
| OPERATIONS | Add paths listed under "viewing" only |
| TECH_OPS | Add paths listed under "viewing" only |
| SERVICE | Add paths listed under "viewing" only (service team sees on-call schedule) |
| SALES_MANAGER | **Skip** — not a target user |
| SALES | **Skip** — not a target user |
| VIEWER | **Skip** — minimal access by policy |

Legacy aliases (OWNER → EXECUTIVE, MANAGER → PROJECT_MANAGER, DESIGNER/PERMITTING → TECH_OPS) inherit by reference — no action needed.

**Viewing paths** (add to OPERATIONS_MANAGER, PROJECT_MANAGER, OPERATIONS, TECH_OPS, SERVICE):
- `/dashboards/on-call`
- `/dashboards/on-call/month`
- `/api/on-call/tonight`
- `/api/on-call/assignments`
- `/api/on-call/me`
- `/api/on-call/workload`
- `/api/on-call/swaps` (GET only — create/approve guarded at handler level)
- `/api/on-call/pto` (GET only — same)
- `/api/on-call/pools` (GET — list, also guarded at handler level for detail access)

**Approving paths** (OPERATIONS_MANAGER only — approval privilege above view-only):
- Specific sub-routes `/api/on-call/swaps/{id}/approve`, `/api/on-call/swaps/{id}/deny`
- Specific sub-routes `/api/on-call/pto/{id}/approve`, `/api/on-call/pto/{id}/deny`

Note: middleware matches by prefix, so adding `/api/on-call/swaps` to OPERATIONS/PROJECT_MANAGER allowlists ALSO allows them to hit `/api/on-call/swaps/{id}/approve`. To prevent this, the approval handlers must re-check role in-handler (ADMIN/EXECUTIVE/OPERATIONS_MANAGER only) and return 403 if caller lacks privilege. Middleware enforces coarse access; handler enforces fine-grained.

**Admin-only paths** (do NOT add to any non-ADMIN/non-EXECUTIVE role):
- `/dashboards/on-call/setup`
- `/api/on-call/pools/{id}` (PATCH/DELETE)
- `/api/on-call/pools/{id}/members` (POST/PATCH)
- `/api/on-call/pools/{id}/publish` (POST)
- `/api/on-call/pools/{id}/rotate-token` (POST)

Handler-level check: setup/publish/members/rotate-token handlers must verify caller has ADMIN or EXECUTIVE role, return 403 otherwise.

Every `allowedRoutes` array must include the paths or the middleware silently returns 403.

- [ ] **Step 3: .env.example**

Add at the bottom:
```
# On-Call Electrician Rotations (feature-flagged V1)
ON_CALL_ROTATIONS_ENABLED=false
NEXT_PUBLIC_ON_CALL_ROTATIONS_ENABLED=false
```

### Task 6: Layout-level + API-level feature flag gate

**Files:**
- Create: `src/app/dashboards/on-call/layout.tsx`
- Create: `src/lib/on-call-guard.ts` — helper used by every handler

- [ ] **Step 1: Layout guard**

Server layout that calls `isOnCallRotationsEnabled()` and returns `notFound()` when off.

- [ ] **Step 2: API guard helper**

```ts
// src/lib/on-call-guard.ts
import { NextResponse } from "next/server";
import { isOnCallRotationsEnabled } from "./feature-flags";

export function assertOnCallEnabled(): NextResponse | null {
  if (!isOnCallRotationsEnabled()) {
    return NextResponse.json({ error: "On-call rotations feature is disabled" }, { status: 503 });
  }
  return null;
}
```

**Every `/api/on-call/*` handler** (including the public iCal route) must call `assertOnCallEnabled()` at the top:

```ts
export async function GET(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  // ... handler logic
}
```

---

## Chunk 4: API Routes — Reads

### Task 7: Assignments + tonight + workload reads

**Files:**
- Create: `src/lib/on-call-db.ts`
- Create: `src/app/api/on-call/tonight/route.ts`
- Create: `src/app/api/on-call/assignments/route.ts`
- Create: `src/app/api/on-call/workload/route.ts`
- Create: `src/app/api/on-call/me/route.ts`

- [ ] **Step 1: DB helper module**

```ts
// src/lib/on-call-db.ts
export async function listPools(): Promise<OnCallPool[]>;
export async function getPool(id: string): Promise<OnCallPoolWithMembers | null>;
export async function listAssignmentsInRange(poolId: string | null, from: string, to: string): Promise<OnCallAssignment[]>;
export async function getActiveMembers(poolId: string): Promise<(OnCallPoolMember & { crewMember: CrewMember })[]>;
export async function getPtoDates(poolId: string): Promise<Set<string>>;
export async function resolveCurrentUserElectrician(userEmail: string): Promise<CrewMember | null>;
```

- [ ] **Step 2: GET /api/on-call/tonight**

For each pool: compute "today" in pool's tz, fetch assignment for that date. If no assignment persisted, compute it from rotation order on the fly. Return `{ pools: [{ poolId, poolName, date, crewMember, shiftStart, shiftEnd, phone }] }`.

Return 503 if `isOnCallRotationsEnabled()` is false. Cache for 60 seconds.

- [ ] **Step 3: GET /api/on-call/assignments**

Query params: `poolId?` (omit for all pools), `from=YYYY-MM-DD`, `to=YYYY-MM-DD`. Validate range ≤ 180 days. Merge persisted assignments with on-the-fly generated ones for gaps.

- [ ] **Step 4: GET /api/on-call/workload**

Query params: `poolId=`, `month=YYYY-MM`. Compute the month's day range in pool's tz. Pull assignments, call `computeWorkload()`, return per-crewMember record with name + stats.

- [ ] **Step 5: GET /api/on-call/me** — **V1 STUB**

For V1, this endpoint is implemented but not consumed by any UI (the phone view at `/dashboards/on-call/me` is V1.1). Returns `{ crewMember: null, shifts: [] }` as a minimal stub so the route allowlist entry has a concrete handler.

### Task 8: Pool admin reads

**Files:**
- Create: `src/app/api/on-call/pools/route.ts`
- Create: `src/app/api/on-call/pools/[id]/route.ts`

- [ ] **Step 1: GET /api/on-call/pools**

Returns all pools with member counts and last-published metadata. Role-gated to ADMIN/OWNER for mutations, but GET open to any role with route permission.

- [ ] **Step 2: GET /api/on-call/pools/[id]**

Returns pool detail + ordered members (with CrewMember joined) + recent publish history. ADMIN/OWNER only.

---

## Chunk 5: API Routes — Writes

### Task 9: Pool CRUD

**Files:**
- Modify: `src/app/api/on-call/pools/route.ts`
- Modify: `src/app/api/on-call/pools/[id]/route.ts`
- Create: `src/app/api/on-call/pools/[id]/members/route.ts`
- Create: `src/app/api/on-call/pools/[id]/rotate-token/route.ts`

- [ ] **Step 1: POST /api/on-call/pools**

Creates pool. Body: `{ name, region, shiftStart, shiftEnd, timezone, startDate, horizonMonths? }`. Generates random `icalToken`. Logs `ON_CALL_POOL_CREATED`. ADMIN/OWNER only.

- [ ] **Step 2: PATCH /api/on-call/pools/[id]**

Updates pool metadata (not members — separate endpoint). Logs `ON_CALL_POOL_UPDATED`.

- [ ] **Step 3: POST/PATCH /api/on-call/pools/[id]/members**

- POST: `{ crewMemberId, orderIndex? }` — adds member at end of rotation (or at specified index, shifting others).
- PATCH: `{ members: [{ id, orderIndex, isActive }] }` — bulk reorder + toggle active. Transactional.
- Logs `ON_CALL_POOL_MEMBERS_CHANGED`.

- [ ] **Step 4: POST /api/on-call/pools/[id]/rotate-token**

Regenerates `icalToken`. Old token becomes invalid immediately. Logs `ON_CALL_ICAL_TOKEN_ROTATED`. ADMIN/OWNER only.

### Task 10: Publish

**Files:**
- Create: `src/app/api/on-call/pools/[id]/publish/route.ts`

- [ ] **Step 1: POST /api/on-call/pools/[id]/publish**

Flow:
1. Acquire Postgres advisory lock on `poolId` (`pg_try_advisory_lock(hashtext('on-call-publish-' || poolId))`).
2. Load pool + active members.
3. Compute `fromDate = today` (pool tz), `toDate = addDays(today, horizonMonths * 30)`.
4. Call `generateAssignments(...)` → proposed assignments.
5. Load existing assignments in range.
6. Diff: new rows to insert, `source="generated"` rows to update if member changed, preserve `source != "generated"` rows untouched.
7. Apply in a transaction using `upsert` by composite key `(poolId, date)`.
8. Update `pool.lastPublishedAt`, `lastPublishedBy`, `lastPublishedThrough`.
9. Log `ON_CALL_PUBLISHED` with metadata: `{ rowsCreated, rowsUpdated, from, to }`.
10. Fire monthly preview email if config enables (V1: just log to console via email stub).
11. Release lock.

Returns `{ rowsCreated, rowsUpdated, through }`. On lock contention, return 409.

**Cache invalidation on success:** call `invalidateCache('on-call:tonight')` (using `src/lib/cache.ts` helper) so the cached tonight response doesn't serve stale data after Publish.

### Task 11: Swap lifecycle

**Files:**
- Create: `src/app/api/on-call/swaps/route.ts`
- Create: `src/app/api/on-call/swaps/[id]/accept/route.ts`
- Create: `src/app/api/on-call/swaps/[id]/approve/route.ts`
- Create: `src/app/api/on-call/swaps/[id]/deny/route.ts`

- [ ] **Step 1: GET /api/on-call/swaps**

Query: `status?`, `poolId?`. Returns swap requests with requester/counterparty CrewMember info. Role-gated: any viewer can see all; electricians can filter to their own.

- [ ] **Step 2: POST /api/on-call/swaps**

Body: `{ poolId, requesterCrewMemberId, requesterDate, counterpartyCrewMemberId, counterpartyDate, reason?, asAdmin?: boolean }`. Validates:
- Both dates have existing assignments.
- Requester is on requesterDate; counterparty is on counterpartyDate.
- Neither date has pending conflicting swap.
- Status defaults to `"awaiting-counterparty"`. When `asAdmin === true` (admin creating directly from Day Actions drawer), status starts at `"awaiting-admin"` — skipping counterparty acceptance. The handler verifies the caller has ADMIN/EXECUTIVE role when `asAdmin === true`; otherwise returns 403.

Logs `ON_CALL_SWAP_REQUESTED`.

- [ ] **Step 3: POST /api/on-call/swaps/[id]/accept**

Counterparty (or admin proxying) marks accepted. Status → `awaiting-admin`. Sets `counterpartyAcceptedAt`. Logs `ON_CALL_SWAP_ACCEPTED`.

- [ ] **Step 4: POST /api/on-call/swaps/[id]/approve**

Transactional apply (see spec's `applySwap` pseudocode). Updates two assignments + swap status in one `$transaction`. Logs `ON_CALL_SWAP_APPROVED`. Fires (stubbed) notification emails. ADMIN/EXECUTIVE/OPERATIONS_MANAGER only (role checked in handler). **Cache invalidation on success:** `invalidateCache('on-call:tonight')`.

- [ ] **Step 5: POST /api/on-call/swaps/[id]/deny**

Body: `{ denialReason }`. Updates swap status + reviewedByUserId + reviewedAt. Logs `ON_CALL_SWAP_DENIED`. Fires stubbed denial emails to both parties.

### Task 12: PTO lifecycle

**Files:**
- Create: `src/app/api/on-call/pto/route.ts`
- Create: `src/app/api/on-call/pto/[id]/approve/route.ts`
- Create: `src/app/api/on-call/pto/[id]/deny/route.ts`

- [ ] **Step 1: POST /api/on-call/pto**

Body: `{ poolId, crewMemberId, startDate, endDate, reason? }`. Validates dates, no overlap with existing approved PTO. Default status `"awaiting-admin"`. Logs `ON_CALL_PTO_REQUESTED`.

- [ ] **Step 2: POST /api/on-call/pto/[id]/approve**

Body: `{ reassignments: [{ date, replacementCrewMemberId }] }`. ADMIN/EXECUTIVE/OPERATIONS_MANAGER only. Transactional:
1. Mark PTO approved + reviewed metadata.
2. For each affected assignment in the date range, update to `{ crewMemberId: replacement, source: "pto-reassign", originalCrewMemberId: <pto requester>, sourceRequestId: ptoId }`.
3. Log `ON_CALL_PTO_APPROVED`.
4. Stub-email affected parties.
5. **Cache invalidation:** `invalidateCache('on-call:tonight')`.

- [ ] **Step 3: POST /api/on-call/pto/[id]/deny**

Body: `{ denialReason }`. Sets status + reviewed metadata. Logs `ON_CALL_PTO_DENIED`.

### Task 13: iCal feed

**Files:**
- Create: `src/app/api/on-call/calendar/[poolId]/route.ts`

- [ ] **Step 1: GET /api/on-call/calendar/[poolId]?token=<token>**

1. Call `assertOnCallEnabled()` → 503 if off.
2. Fetch pool. If `pool.icalToken !== req token` → 401.
3. Load assignments from (today - 30 days) through `lastPublishedThrough`.
4. Pass to `generateIcal()`.
5. Return with headers:
   - `Content-Type: text/calendar; charset=utf-8`
   - `Content-Disposition: inline; filename="on-call-{poolSlug}.ics"`
   - `Cache-Control: private, no-store` — token rotations must invalidate immediately; don't let proxies cache the feed

No session auth — `PUBLIC_API_ROUTES` bypass + token validation in handler.

---

## Chunk 6: UI — Admin Setup

### Task 14: Admin setup page

**Files:**
- Create: `src/app/dashboards/on-call/setup/page.tsx`
- Create: `src/components/on-call/PoolConfigCard.tsx`
- Create: `src/components/on-call/PublishCard.tsx`

- [ ] **Step 1: Page scaffold**

Server component. Role-gate via `getCurrentUser()` → redirect to `/` if not ADMIN/OWNER. Renders `<DashboardShell title="On-Call Setup" accentColor="orange">` wrapping the config cards.

- [ ] **Step 2: PoolConfigCard**

Client component. One per pool (tabbed UI matches mockup `admin-setup.html`). Inputs:
- Start date picker
- Shift start/end time + timezone select
- Horizon months number input (default 3)
- Member list with drag-handles + active toggles

**For V1, skip drag-and-drop.** Use numeric up/down buttons to change `orderIndex` (move up, move down). Simpler; avoids adding a new dependency. If `@dnd-kit/sortable` is already in `package.json`, use it. Check first:

```bash
grep -q '"@dnd-kit/sortable"' package.json && echo "available" || echo "not installed — use up/down buttons"
```

On save → PATCH to pool + PATCH to members endpoints. Invalidate React Query keys `onCall.pools()`, `onCall.pool(id)`, `onCall.assignments(...)`, `onCall.tonight()`.

- [ ] **Step 3: PublishCard**

Shows `lastPublishedAt`, `lastPublishedThrough`. Preview button runs a dry-run (client-side generate from current pool state, show diff count). Publish button POSTs to publish endpoint, shows toast, invalidates query cache.

- [ ] **Step 4: Federal holidays panel**

Read-only chip display of current-year holidays from `FEDERAL_HOLIDAYS_2026`.

---

## Chunk 7: UI — Main Dashboard & Month View

### Task 15: Main dashboard page

**Files:**
- Create: `src/app/dashboards/on-call/page.tsx`
- Create: `src/components/on-call/HeroStrip.tsx`
- Create: `src/components/on-call/LookaheadGrid.tsx`

- [ ] **Step 1: Page scaffold**

Server component. Wraps in `<DashboardShell>` with `accentColor="orange"`. Renders hero strip + 14-day lookahead.

- [ ] **Step 2: HeroStrip**

Client component. React Query for `/api/on-call/tonight`. Maps each pool to a hero card with color theme (orange/blue/green). Buttons: `<a href="tel:...">`, `<a href="sms:...">`, and "Swap" linking to month view with day selected.

- [ ] **Step 3: LookaheadGrid**

Client component. Horizontal 14-column grid, one row per pool. Highlights today, weekends, PTO days. Click any day → navigate to month view with that date focused.

### Task 16: Month view + workload

**Files:**
- Create: `src/app/dashboards/on-call/month/page.tsx`
- Create: `src/components/on-call/MonthCalendar.tsx`
- Create: `src/components/on-call/WorkloadSidebar.tsx`
- Create: `src/components/on-call/DayActionDrawer.tsx`

- [ ] **Step 1: Page scaffold**

Server component taking `?pool=&month=YYYY-MM` params. Wraps in DashboardShell.

- [ ] **Step 2: MonthCalendar**

Client component. Standard 7-column grid with ~35 day tiles. Data from `/api/on-call/assignments`. Click tile → opens `DayActionDrawer`.

- [ ] **Step 3: WorkloadSidebar**

Client component. Data from `/api/on-call/workload`. Shows bar + day/weekend/holiday counts. Surfaces hot/cold flags when variance exceeds pool-member average by >1.5 stddev (simple heuristic).

- [ ] **Step 4: DayActionDrawer**

Client component. Slide-in from right (reuse Radix UI Sheet if in deps, otherwise simple fixed-position panel with transform transition). Three tabs:
- Swap: current on-call + ranked replacement list (call `/api/on-call/swaps` with `?proxy=true`)
- Block PTO: crewMember + date range → POST `/api/on-call/pto` then immediate approve
- Notes: stub for V1 — show "Notes coming soon" placeholder (deferred)

For V1, both actions auto-apply (admin is already acting). No separate approval step in the flow.

---

## Chunk 8: Executive Suite Tile & Final Wiring

### Task 17: Executive Suite link

**Files:**
- Modify: `src/app/suites/executive/page.tsx`

- [ ] **Step 1:** Add a new `SuitePageCard` entry:

```ts
{
  href: "/dashboards/on-call",
  title: "On-Call Electricians",
  description: "Daily rotation calendar for after-hours service coverage across California, Denver, and Southern CO.",
  tag: "ON-CALL",
  icon: "📞",
  section: "Executive Views",
},
```

Conditional visibility: only render when `isOnCallRotationsEnabledClient()` returns true. If the page is server-rendered, use server-side env check + conditional spread in the `LINKS` array.

### Task 18: Query keys + cache

**Files:**
- Modify: `src/lib/query-keys.ts`
- Modify: `src/lib/cache.ts`

- [ ] **Step 1:** Add keys:

```ts
// query-keys.ts
onCall: {
  tonight: () => ["on-call", "tonight"] as const,
  assignments: (poolId: string | null, from: string, to: string) =>
    ["on-call", "assignments", poolId, from, to] as const,
  workload: (poolId: string, month: string) =>
    ["on-call", "workload", poolId, month] as const,
  pools: () => ["on-call", "pools"] as const,
  pool: (id: string) => ["on-call", "pool", id] as const,
  swaps: (status?: string) => ["on-call", "swaps", status] as const,
  pto: () => ["on-call", "pto"] as const,
  me: () => ["on-call", "me"] as const,
},
```

```ts
// cache.ts
ON_CALL_TONIGHT: "on-call:tonight",
```

### Task 19: Verification

- [ ] **Step 1: Prisma validate**

```bash
npx prisma format
npx prisma validate
```

Both must exit clean. `prisma validate` catches relation name mismatches + missing back-references.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Must pass with zero errors.

- [ ] **Step 3: Unit tests**

```bash
npm run test -- on-call-rotation
```

All tests pass.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Zero errors (warnings acceptable if pre-existing).

- [ ] **Step 5: Manual smoke**

With `ON_CALL_ROTATIONS_ENABLED=true` and `NEXT_PUBLIC_ON_CALL_ROTATIONS_ENABLED=true`:
1. Visit `/dashboards/on-call` — see main dashboard (empty until pools exist).
2. Visit `/dashboards/on-call/setup` — create all 3 pools via UI (or use seed script — see next step).
3. Add members, publish. Confirm assignments appear on main dashboard.
4. Visit `/dashboards/on-call/month` — confirm calendar populates, workload sidebar shows stats.
5. Click a day, open drawer, execute a direct swap. Confirm assignments update.
6. With flag off, `/dashboards/on-call` returns 404 and Executive Suite hides the tile.

---

## Chunk 9: Optional Seed (Post-Verification)

### Task 20: Seed script for initial pools

- [ ] **Step 1: Seed script for initial pools** (**do NOT run without user approval — creates DB rows**)

Create `scripts/seed-on-call-pools.ts`:

Creates three pools with the electrician names from the spec. Matches against existing `CrewMember` records by name (case-insensitive). If a CrewMember doesn't exist, skip with a warning. Generates iCal tokens via `crypto.randomUUID()`.

Run via:
```bash
npx tsx scripts/seed-on-call-pools.ts
```

---

## Out of Scope (V1.1 follow-up plan)

- Electrician phone view at `/dashboards/on-call/me` — self-service swap/PTO propose flows
- Admin approval queue UI at `/dashboards/on-call/approvals`
- Two-party swap confirmation flow (electrician accepts in their own view)
- Real email templates via React Email (currently stubbed to console)
- PDF export via `@react-pdf/renderer`
- CSV export
- Monthly preview email scheduled send
- Holiday star (★) UI polish in month calendar
- Notes tab in DayActionDrawer
- Notification preferences per electrician
- Rotation audit history viewer

## Known Deferred Concerns

- **Auto-balance generation:** V1 is strict round-robin. Future v2 will optimize weekend/holiday distribution.
- **SMS notifications:** out of scope. `tel:`/`sms:` links on hero cards hand off to device.
- **Integration with service tickets:** no auto-dispatch in V1. Admin copies phone from hero card manually.
- **ATTOM / HubSpot Property overlap:** on-call data is pool-based, not address-based. No overlap with Property object.
