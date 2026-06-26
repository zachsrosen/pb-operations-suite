# Scheduler v2 — Phase 1 (Construction Dispatch Board) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a flag-gated, additive crew-row construction dispatch board ("Scheduler v2") that reads a new aggregated board endpoint, lets dispatchers drag/assign/reschedule installs through the existing scheduling spine, and warns on conflicts — without touching any existing scheduler page or scheduling API.

**Architecture:** New *surface*, same *spine*. All writes route through the existing `PUT /api/zuper/jobs/schedule` (+ `/tentative`, `/confirm`). New code is read-only: a job-type-agnostic data layer (`src/lib/scheduler-v2/`), a `GET /api/scheduler-v2/board` aggregator, a `POST /api/scheduler-v2/conflicts` pre-flight check, and a `src/components/scheduler-v2/` board UI. Board rows = per-location director-team Zuper users, reconciled to `CrewMember`. Everything is gated behind `NEXT_PUBLIC_UI_SCHEDULER_V2_ENABLED` / `SCHEDULER_V2_ENABLED`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, React Query v5, Tailwind v4 tokens, Prisma 7 (read-only here), Jest. Reuses `scheduling-utils.ts`, `travel-time.ts`, `schedule-optimizer.ts` (`DEFAULT_LOCATION_CAPACITY`), `CapacityHeatmap`, `on-call-holidays`, `scheduling-policy.ts`.

**Spec:** [docs/superpowers/specs/2026-06-26-scheduler-v2-unified-dispatch-design.md](../specs/2026-06-26-scheduler-v2-unified-dispatch-design.md)

**Plan-wide conventions:**
- Additive only. Never edit existing scheduler pages or `src/app/api/zuper/**` files. Allowed existing-file edits: `src/lib/roles.ts` (allowlist), `src/app/suites/operations/page.tsx` (one env-gated card, matching the existing PowerHub/Map pattern), `src/lib/query-keys.ts` (new key), `.env.example`.
- Tests use existing `src/__tests__/` patterns and `npm run test -- <file>`.
- Commit after each task. Branch off `origin/main` (see Task 0).
- Code blocks below are complete for pure-logic/test-critical files; UI components give the structure + load-bearing logic and explicitly mirror named existing components.

---

## Chunk 0: Worktree, flags, route scaffold, role plumbing

### Task 0.1: Worktree off main + carry specs

**Files:** (git only)

- [ ] **Step 1:** Use superpowers:using-git-worktrees to create a worktree on a new branch `feat/scheduler-v2-phase1` off `origin/main`.
- [ ] **Step 2:** Copy the two spec docs + this plan from the current checkout into the worktree under `docs/superpowers/{specs,plans}/` if not already tracked.
- [ ] **Step 3:** Commit: `docs: scheduler v2 spec + phase 1 plan`.

### Task 0.2: Feature flags

**Files:** Modify: `.env.example`

- [ ] **Step 1:** Add to `.env.example`:
```
# Scheduler v2 (additive, flag-gated). Off until parity.
NEXT_PUBLIC_UI_SCHEDULER_V2_ENABLED=false
SCHEDULER_V2_ENABLED=false
```
- [ ] **Step 2:** Commit: `chore: add scheduler v2 feature flags to env.example`.

### Task 0.3: Role allowlist + nav card

**Files:** Modify: `src/lib/roles.ts`, `src/app/suites/operations/page.tsx`

- [ ] **Step 0 (verify):** Open the route-permission matcher (`src/lib/role-permissions.ts` / wherever `allowedRoutes` is checked, e.g. `user-access.ts`) and confirm it matches via `path === allowed || path.startsWith(`${allowed}/`)` so a single `/api/scheduler-v2` entry covers `/api/scheduler-v2/board` etc. (Memory: a missing allowlist entry → silent 403.) If matching is exact-only, add each sub-route explicitly.
- [ ] **Step 1:** In `roles.ts`, for **every role that can see the Operations suite** (per spec §8: ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS; ADMIN/OWNER already have `*`), add `"/dashboards/scheduler-v2"` and `"/api/scheduler-v2"` to `allowedRoutes`.
- [ ] **Step 2:** Add the flagged card **in `src/app/suites/operations/page.tsx`**, mirroring the existing env-gated card pattern (see `suites/design-engineering/page.tsx` PowerHub and `suites/operations/page.tsx` Map): spread `...(process.env.NEXT_PUBLIC_UI_SCHEDULER_V2_ENABLED === "true" ? [{ href: "/dashboards/scheduler-v2", title: "Dispatch Board (v2)", description: "Crew-row dispatch board — beta.", ... }] : [])` into the suite's card list. Do NOT use `roles.ts` landingCards (wrong surface, no flag gate).
- [ ] **Step 3:** Run `npm run lint`. Expected: clean.
- [ ] **Step 4:** Commit: `feat(roles): allowlist + flagged operations-suite card for scheduler v2`.

### Task 0.4: Route + page scaffold (flag gate)

**Files:** Create: `src/app/dashboards/scheduler-v2/page.tsx`, `src/components/scheduler-v2/SchedulerV2Shell.tsx`

- [ ] **Step 1:** `page.tsx` — server component that returns 404 (`notFound()`) when `NEXT_PUBLIC_UI_SCHEDULER_V2_ENABLED !== "true"`, else renders `<SchedulerV2Shell />`.
- [ ] **Step 2:** `SchedulerV2Shell.tsx` — `"use client"`, wraps in `DashboardShell` (title "Dispatch Board", accentColor "blue", fullWidth) with a placeholder "Scheduler v2 — coming online". Use theme tokens only.
- [ ] **Step 3:** Verify with preview tool: with the flag on locally, `/dashboards/scheduler-v2` renders the shell; with it off, 404.
- [ ] **Step 4:** Commit: `feat(scheduler-v2): flag-gated route + shell scaffold`.

---

## Chunk 1: Agnostic data model + copied pure logic

### Task 1.1: Types

**Files:** Create: `src/lib/scheduler-v2/types.ts`

- [ ] **Step 1:** Create the file with the types from spec §3 verbatim (`WorkType`, `SubSystem`, `WorkItemStatus`, `WorkItem` (incl. `hasZuperJob`), `Resource` (incl. `locations[]`, `primaryLocation`, `assignable`, `crewMemberId`), `Assignment`, `CapacityCell`, `AvailabilityWindow`, `ConflictResult`, `ConflictFlag`). Plus the board response type:
```ts
export interface BoardData {
  resources: Resource[];
  workItems: WorkItem[];
  assignments: Assignment[];
  capacity: CapacityCell[];
  dateRange: { start: string; end: string };
}
```
- [ ] **Step 2:** `npx tsc --noEmit` (project-wide). Expected: no new errors.
- [ ] **Step 3:** Commit: `feat(scheduler-v2): agnostic data model types`.

### Task 1.2: Constants + colors (copied, with COSP fix)

**Files:** Create: `src/lib/scheduler-v2/constants.ts`, `src/lib/scheduler-v2/colors.ts`

- [ ] **Step 1:** `constants.ts` — copy `CONSTRUCTION_DIRECTORS` (5 teams), location list, and `LOCATION_TIMEZONES` re-export from `@/lib/constants`. For `"Colorado Springs"`: the **`teamUid` is load-bearing** (it resolves the live board rows via `/api/zuper/teams/{teamUid}/users`) — keep it and verify in Task 7.3 that it resolves to Lenny's crew. The director `name`/`userUid` is only a default-assignee label; Lenny's real Zuper `userUid` is NOT in the codebase (grep confirms only his email), so set `name: "Lenny Uematsu"`, `userUid: ""` with `// resolved by /schedule at runtime by name`. Re-export `DEFAULT_LOCATION_CAPACITY` from `@/lib/schedule-optimizer`.
- [ ] **Step 2:** `colors.ts` — a single status→token map (scheduled/en_route/working/done/failed/tentative/forecast/overdue) and a work-type→accent map. Reuse `CapacityHeatmap`'s utilization thresholds (green ≤80 / yellow ≤100 / orange ≤120 / red) as exported constants.
- [ ] **Step 3:** `npx tsc --noEmit`. Commit: `feat(scheduler-v2): constants + color system`.

### Task 1.3: normalize.ts (copied pure helpers) — TDD

**Files:** Create: `src/lib/scheduler-v2/normalize.ts`, `src/__tests__/scheduler-v2-normalize.test.ts`

- [ ] **Step 1 (test):** Write failing tests for `mapStage()` (raw HubSpot stage → normalized), `getCustomerName()` (parse "PROJ-x | Last, First | addr" → "Last, First"), `isOverdue(scheduledStart, durationDays, status)` (construction overdue day after end; done never overdue). Mirror v1 behavior (`scheduler/page.tsx:413,481,1844`).
- [ ] **Step 2:** Run: `npm run test -- scheduler-v2-normalize`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `normalize.ts` with those pure functions (copied/adapted from v1, using `scheduling-utils` business-day helpers).
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(scheduler-v2): normalize helpers + tests`.

---

## Chunk 2: Construction adapter, capacity, conflicts (pure libs, TDD)

### Task 2.1: Capacity math — TDD

**Files:** Create: `src/lib/scheduler-v2/capacity.ts`, `src/__tests__/scheduler-v2-capacity.test.ts`

- [ ] **Step 1 (test):** `computeCapacityCells(assignments, resources, locations, dateRange)` returns `CapacityCell[]` with `loadDays` (sum of assignment-days per location/day) and `capacityDays` (from `DEFAULT_LOCATION_CAPACITY` blended with reconciled `CrewMember.maxDailyJobs`). Assert: 3 install-days in a 2-capacity location/day → loadDays 3, capacityDays 2 (over). Assert utilization classification matches thresholds.
- [ ] **Step 2:** Run `npm run test -- scheduler-v2-capacity`. Expected: FAIL.
- [ ] **Step 3:** Implement `capacity.ts` (produces `CapacityCell[]` fresh; shares only thresholds from `colors.ts`).
- [ ] **Step 4:** Tests PASS. Commit: `feat(scheduler-v2): capacity computation + tests`.

### Task 2.2: Conflict detection — TDD

**Files:** Create: `src/lib/scheduler-v2/conflicts.ts`, `src/__tests__/scheduler-v2-conflicts.test.ts`

- [ ] **Step 1 (test):** Pure `detectConflicts(params, context)` → `ConflictResult`. Cover: double-book (resource already assigned that day → hard `double_book`); over-capacity (location load+new > capacity → soft `over_capacity`); weekend/holiday (via `isPbHoliday`/weekend → hard `weekend_holiday`); sales lead-time (delegate to `scheduling-policy.getSalesSurveyLeadTimeError` → hard `lead_time`). Travel is injected via context (tested in 2.3/3.2).
- [ ] **Step 2:** Run `npm run test -- scheduler-v2-conflicts`. Expected: FAIL.
- [ ] **Step 3:** Implement `conflicts.ts` (pure; takes existing assignments + capacity + policy result as inputs so it stays unit-testable; the endpoint in Chunk 4 supplies travel + availability).
- [ ] **Step 4:** Tests PASS. Commit: `feat(scheduler-v2): conflict detection + tests`.

### Task 2.3: Construction adapter — TDD

**Files:** Create: `src/lib/scheduler-v2/adapters/construction.ts`, `src/__tests__/scheduler-v2-construction-adapter.test.ts`

- [ ] **Step 1 (test):** `toWorkItems(projects, zuperLookup, scheduleRecords)` → `WorkItem[]`. Cover: a deal with PV + ESS Zuper sub-jobs → **two** WorkItems sharing `parentDealId`, each with `subSystem`, `hasZuperJob:true`, `zuperJobUid`; an unscheduled RTB deal with no Zuper job → one WorkItem `hasZuperJob:false`, `status:"unscheduled"`; a tentative schedule-record → `isTentative:true`. And `toResources(crewMembers, teamUsersByLocation)` → reconciled `Resource[]` with `assignable` set when a team user matches a CrewMember by `zuperUserUid` (else by name). **Also test the edge cases from spec §11:** (a) a team user whose name matches no CrewMember → `assignable:true`, `crewMemberId` unset ("unmapped lane"); (b) two CrewMembers sharing a display name → match must prefer `zuperUserUid` and not double-assign; (c) a CrewMember with no current team membership → rendered non-assignable. Use fixture JSON mirroring real `/api/projects` + `/api/zuper/jobs/lookup` + `/api/zuper/teams/{teamUid}/users` shapes (see spec §2/§3).
- [ ] **Step 2:** Run `npm run test -- scheduler-v2-construction-adapter`. Expected: FAIL.
- [ ] **Step 3:** Implement `adapters/construction.ts` (pure transforms only; no fetching — fetching lives in the endpoint).
- [ ] **Step 4:** Tests PASS. Commit: `feat(scheduler-v2): construction adapter + tests`.

---

## Chunk 3: GET /api/scheduler-v2/board

### Task 3.1: Board endpoint — TDD

**Files:** Create: `src/app/api/scheduler-v2/board/route.ts`, `src/lib/scheduler-v2/assign.ts`, `src/__tests__/scheduler-v2-board-route.test.ts`

- [ ] **Step 1:** `assign.ts` — copy the director-team → live Zuper team-users resolution from `construction-scheduler/page.tsx` (`/api/zuper/teams/{teamUid}/users`) into a server util `getTeamUsersByLocation()`, with in-memory TTL cache (reuse `@/lib/cache`).
- [ ] **Step 2 (test):** Mock `prisma` + fetch; assert `GET /api/scheduler-v2/board?from&to` returns `BoardData` composing: CrewMember + ScheduleRecord + BookedSlot + ZuperJobCache (same queries as `/api/crew-schedule/route.ts`), `/api/projects` install pool, Zuper construction lookup, team-users reconciliation, and `computeCapacityCells`. Assert 400 on range > 32 days; assert `requireApiAuth` enforced; **assert 404 when `SCHEDULER_V2_ENABLED !== "true"`.**
- [ ] **Step 3:** Run `npm run test -- scheduler-v2-board-route`. Expected: FAIL.
- [ ] **Step 4:** Implement `route.ts` (read-only; reuse `getCrewSchedulesFromDB`/`db.ts` helpers and the adapter from 2.3; gate behind `SCHEDULER_V2_ENABLED` → 404 when off).
- [ ] **Step 5:** Tests PASS. Commit: `feat(scheduler-v2): GET /board aggregator + tests`.

---

## Chunk 4: POST /api/scheduler-v2/conflicts

### Task 4.1: Conflicts endpoint (with on-demand travel) — TDD

**Files:** Create: `src/app/api/scheduler-v2/conflicts/route.ts`, `src/__tests__/scheduler-v2-conflicts-route.test.ts`

- [ ] **Step 1 (test):** `POST` body `{ workItemId, dealId?, resourceId, date, days, startTime?, endTime?, workType }` → `ConflictResult`. Mock availability + assignments + `travel-time.ts`. Assert: travel-infeasible adjacent job → soft `travel`; PTO/override on resource/date → hard `availability`; quota/geocode failure → fail-open (no travel flag), per `travel-time` behavior. Assert `requireApiAuth` enforced and **404 when `SCHEDULER_V2_ENABLED !== "true"`.**
- [ ] **Step 2:** Run `npm run test -- scheduler-v2-conflicts-route`. Expected: FAIL.
- [ ] **Step 3:** Implement: compose `getCrewSchedulesFromDB` + `getAvailabilityOverrides` (availability), existing assignments (double-book), `DEFAULT_LOCATION_CAPACITY` (capacity), `on-call-holidays` (weekend/holiday), `scheduling-policy` (lead-time), and `travel-time.evaluateSlotTravel` (on-demand only). Delegate the assembly to `conflicts.detectConflicts`.
- [ ] **Step 4:** Tests PASS. Commit: `feat(scheduler-v2): POST /conflicts pre-flight + tests`.

---

## Chunk 5: Board UI (read path)

### Task 5.1: Data hook + query key

**Files:** Modify: `src/lib/query-keys.ts`; Create: `src/components/scheduler-v2/useBoardData.ts`

- [ ] **Step 1:** Add `schedulerV2: { board: (from,to,filters) => [...] }` to `query-keys.ts`.
- [ ] **Step 2:** `useBoardData` — React Query hook hitting `/api/scheduler-v2/board`. Refresh model: **after each v2 write, call `queryClient.invalidateQueries` on the board key** (the existing `/schedule` write path does NOT broadcast to `appCache`, so SSE would deliver nothing — verified). Add a modest `refetchInterval` (e.g. 60s) so out-of-band v1 changes eventually appear. Do not claim live v1↔v2 SSE sync. (Optional later: have the `/board` endpoint set an `appCache` key and subscribe via `useSSE` once the write path also broadcasts — out of scope for Phase 1.)
- [ ] **Step 3:** `npx tsc --noEmit`. Commit: `feat(scheduler-v2): board data hook + query key + SSE`.

### Task 5.2: Board primitives

**Files:** Create: `src/components/scheduler-v2/{DispatchBoard,BoardRow,JobBar,CapacityBar,TravelBlock}.tsx`

- [ ] **Step 1:** `DispatchBoard` — CSS-grid resource timeline: sticky left column of `Resource` rows grouped under collapsible location headers; columns = business days (weekend toggle). Mirror layout from `ConstructionGanttView.tsx` (grid-column span math) but rows = resources, not projects.
- [ ] **Step 2:** `JobBar` — status-colored (from `colors.ts`), shows customer + PROJ + work-type icon; multi-day spans columns; split sub-jobs grouped by `parentDealId` (shared hue + customer). `hasZuperJob:false` → a distinct "no Zuper job" outline.
- [ ] **Step 3:** `CapacityBar` — 2px bar under each resource/day from `CapacityCell` (green→red); supports "availability" mode toggle.
- [ ] **Step 4:** `TravelBlock` — thin hatched segment between consecutive bars; rendered only when travel data present (populated on demand in Chunk 6).
- [ ] **Step 5:** Wire into `SchedulerV2Shell`; verify with preview tool (flag on): rows render, multi-day + split bars correct, capacity colors correct. Screenshot.
- [ ] **Step 6:** Commit: `feat(scheduler-v2): dispatch board read-only render`.

### Task 5.3: Attention queue + filters + saved views

**Files:** Create: `src/components/scheduler-v2/{AttentionStrip,UnscheduledQueue,FilterBar,SavedViews,CommandPalette}.tsx`

- [ ] **Step 1:** `AttentionStrip` — counts of overdue / unfeasible / unassigned as click-to-filter chips.
- [ ] **Step 2:** `UnscheduledQueue` — left rail grouped Unassigned/Unfeasible/Overdue, sortable by age/value (mirror `service-unscheduled/page.tsx`), drag source.
- [ ] **Step 3:** `FilterBar` (location/crew/work-type/stage via `MultiSelectFilter`) with **URL-persisted** state; `SavedViews` (4 presets) reading/writing the URL; `CommandPalette` (`⌘K`) for jump-to-date/find-customer.
- [ ] **Step 4:** Verify filters persist across reload; one filter scopes board + queue. Screenshot.
- [ ] **Step 5:** Commit: `feat(scheduler-v2): attention queue, filters, saved views`.

---

## Chunk 6: Interactions (write path through existing spine)

### Task 6.1: ScheduleDrawer (assign/reschedule)

**Files:** Create: `src/components/scheduler-v2/ScheduleDrawer.tsx`

- [ ] **Step 1:** Drawer pre-filled with suggested resource + valid window. On submit, build the `/schedule` body (spec §2) using `assign.ts` to resolve `teamUid`/user UID and the WorkItem's location → IANA timezone. **`hasZuperJob` decides `rescheduleOnly`** (false → create+assign at creation; true → reschedule). Tentative path → `/schedule/tentative`.
- [ ] **Step 2:** Surface response warnings per spec §7 partial-failure rule (`assignmentFailed` → warning chip; `hubspotWarnings` → toast).
- [ ] **Step 3:** Verify a reschedule and a create-from-pool against a dev deal via preview tool; confirm React Query refetch + SSE update. Screenshot/network capture.
- [ ] **Step 4:** Commit: `feat(scheduler-v2): schedule drawer (create vs reschedule)`.

### Task 6.2: Drag/drop + conflict chips + undo

**Files:** Modify: `DispatchBoard.tsx`, `BoardRow.tsx`, `UnscheduledQueue.tsx`

- [ ] **Step 1:** Drag a pooled WorkItem onto a resource/day and drag existing bars to move/reassign. On hover, call `/conflicts`; show live feasibility chip ("Unavailable"/"Unfeasible"/over-capacity); hard conflicts block drop, soft warn.
- [ ] **Step 2:** On drop → open `ScheduleDrawer` (or quick-reschedule when already-scheduled+has-job). After a write, show an **Undo snackbar** (re-issues the inverse reschedule through the same endpoint).
- [ ] **Step 3:** Customer-facing move → arrival-window reconciliation prompt (reuse v1 copy semantics).
- [ ] **Step 4:** Verify drag-assign, drag-move, conflict block, undo via preview tool. Screenshots.
- [ ] **Step 5:** Commit: `feat(scheduler-v2): drag/drop, conflict chips, undo`.

### Task 6.3: Bulk reassign (client orchestration)

**Files:** Modify: `DispatchBoard.tsx`; Create: `src/components/scheduler-v2/BulkReassign.tsx`

- [ ] **Step 1:** Marquee/multi-select a resource's week → bulk reassign, looping `/schedule` per item with per-item progress + result list (mirror v1 sub-job/optimizer loops). Failures stay in the attention queue.
- [ ] **Step 2:** Verify a 3-item bulk move incl. one induced failure surfaces a correct result list. Screenshot.
- [ ] **Step 3:** Commit: `feat(scheduler-v2): bulk reassign via client orchestration`.

---

## Chunk 7: Secondary views + parity wiring + final verification

### Task 7.1: Week / Month / Gantt views

**Files:** Create: `src/components/scheduler-v2/views/{WeekView,MonthView,GanttView}.tsx`; Modify: `SchedulerV2Shell.tsx` (view switcher)

- [ ] **Step 1:** Implement Week (resource-or-location rows toggle), Month (calendar grid over the same `WorkItem[]`, keeping overlay + forecast styling), Gantt (install→inspection→PTO sequence; reuse `ConstructionGanttView` patterns). All lenses over `useBoardData`.
- [ ] **Step 2:** View switcher with single-key shortcuts; persist selection (mirror `useViewMode`).
- [ ] **Step 3:** Verify each view renders the same data; screenshots.
- [ ] **Step 4:** Commit: `feat(scheduler-v2): week/month/gantt views`.

### Task 7.2: Overlay context + final pass

**Files:** Modify: `DispatchBoard.tsx`, `src/app/api/scheduler-v2/board/route.ts`

- [ ] **Step 1:** Add read-only faded service/D&R/roofing overlay context to the board (from ZuperJobCache, already in the aggregator), toggled off by default.
- [ ] **Step 2:** Full verification pass with preview tool across the five workflows (assign, move, resolve overbooking, find capacity, crew-out bulk). Capture screenshots/network for each.
- [ ] **Step 3:** `npm run lint && npx tsc --noEmit && npm run test`. Expected: clean/pass.
- [ ] **Step 4:** Commit: `feat(scheduler-v2): overlay context + phase-1 verification`.

### Task 7.3: Pre-flag data-readiness check (runtime, not a code task)

- [ ] **Step 1:** With `SCHEDULER_V2_ENABLED=true` in a dev/preview env, hit `/api/scheduler-v2/board` for a current week and confirm: every location's director-team resolves to real install users; reconciled `Resource.assignable` is true for the expected crews; existing assignments map onto rows (no large "unmapped" lane). This is the spec §11 check — surface findings; only escalate to Zach if prod `CrewMember`/Zuper data is wrong in a way code can't fix.
- [ ] **Step 2:** Document findings in the PR description.

---

## Out of scope (later phases)
Survey/inspection/service/roofing/D&R adapters; Map view; optimizer-as-proposal with diff; bulk-notification batching; undo built on `ScheduleEventLog`; retiring v1. See spec §8.

## Done = Phase 1
Flag-on dispatch board for construction/installs with board/week/month/gantt views, attention queue, filters/saved views, conflict-aware drag/drop, create-vs-reschedule drawer, bulk reassign, all writing through the existing spine; existing schedulers untouched; tests + lint + types green; data-readiness verified before any flag-on in prod.
