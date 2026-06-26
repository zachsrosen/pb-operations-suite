# Scheduler v2 — Unified Dispatch (Design Spec)

Date: 2026-06-26
Status: Draft for review
Author: Zach Rosen + Claude
Related: [2026-06-26-scheduler-ux-benchmark-redesign.md](./2026-06-26-scheduler-ux-benchmark-redesign.md)

---

## 1. Purpose & decisions

Build a **new, unified scheduling surface ("Scheduler v2")** that will eventually
replace all seven existing schedulers (master, construction, site-survey,
inspection, service, roofing, D&R), with a **crew-row dispatch board** as the hero
view. It is built and configured behind a feature flag while the existing tools
stay live and untouched, then flipped on when at parity.

Decisions locked with the user:
- **Shape:** unified tool, designed to eventually replace all 7.
- **Latitude:** *additive only* — no existing scheduler page or scheduling API
  file is modified. New files/routes/libs only. Pure logic v2 needs is copied/
  adapted into new `scheduler-v2` modules; non-page shared libs are imported as-is.
  Non-scheduler plumbing edits (`roles.ts` allowlists, a flagged nav card) are
  permitted.
- **Build strategy:** custom shared-core module (no third-party calendar library),
  evolving the already-generic `ConstructionGanttView` into a resource timeline.
- **First coverage:** construction/installs first, on a job-type-agnostic data
  layer so other job types plug in later as adapters.

### Guiding principle: new *surface*, same *spine*
All writes flow through the existing, battle-tested endpoints
(`PUT /api/zuper/jobs/schedule`, `/schedule/tentative`, `/schedule/confirm`).
v2 introduces **no new write path** to Zuper or HubSpot. The tentative→confirm→
Zuper lifecycle, Zuper's assigned-at-creation handling, construction sibling
cascade, HubSpot date writes, and crew notification emails are all reused
verbatim. v2's only new backend is read/aggregation (`/board`) and a read-only
pre-flight check (`/conflicts`). This makes it impossible for v2 to corrupt
scheduling state in a way v1 cannot.

---

## 2. Verified reuse facts (grounding)

Confirmed by reading the code on 2026-06-26:

- `/api/crew-schedule` ([route.ts:131](../../../src/app/api/crew-schedule/route.ts))
  returns active `CrewMember` rows + assignments merged from
  `ScheduleRecord` + `BookedSlot` + `ZuperJobCache`, deduped by
  `crewName|date|projectId`, multi-day-expanded, source-prioritized. It does
  **not** return the unscheduled pool, capacity, or availability.
- `CapacityHeatmap({ capacityAnalysis })` is a pure, reusable component
  (`src/components/ui/CapacityHeatmap.tsx`).
- `src/lib/travel-time.ts` exports `getConfig`, `geocodeAddress`,
  `resolveLocation`, `getDriveTime`, `evaluateSlotTravel`, `evaluateSlotsBatch`
  with built-in caching, bounded concurrency, and fail-open behavior.
- `src/lib/schedule-optimizer.ts` exports `generateOptimizedSchedule`,
  `DEFAULT_LOCATION_CAPACITY`, `calculatePriorityScore`, and types.
- `src/lib/roles.ts` uses per-role `allowedRoutes: string[]` and holds the suite
  nav cards; additive entries match existing patterns
  (e.g. `/api/crew-schedule`, `/dashboards/scheduler`).
- `CrewMember` is seeded with install-capable roles (technician/electrician/
  roofer) and Zuper UIDs via `src/app/api/admin/crew/route.ts`.
- The construction scheduler assigns installs via hardcoded
  `CONSTRUCTION_DIRECTORS` → live Zuper team-users
  (`/api/zuper/teams/{teamUid}/users`), **not** via `CrewMember`
  ([construction-scheduler/page.tsx:41,680](../../../src/app/dashboards/construction-scheduler/page.tsx)).

### Stable backend contract v2 builds on (unchanged)
- `PUT /api/zuper/jobs/schedule` — smart reschedule-or-create; Zuper lookup by 5
  strategies; crew reconciliation; construction sibling cascade; HubSpot writes;
  crew email. Body: `{ project, schedule:{type,date,days,startTime,endTime,
  timezone,crew,teamUid,assignedUser,notes,installerNotes,isReschedule,testMode},
  rescheduleOnly, skipSiblingCascade }`.
- `PUT /api/zuper/jobs/schedule/tentative` — local hold (ScheduleRecord +
  BookedSlot, no Zuper).
- `POST /api/zuper/jobs/schedule/confirm` — promote tentative → scheduled + sync.
- `GET /api/zuper/schedule-records?projectIds&type&status` — latest record/project.
- `GET /api/zuper/availability?from_date&to_date&type&location&team_uid` —
  crew availability from `CrewAvailability` + `AvailabilityOverride` + Zuper
  time-off + existing jobs.
- `GET /api/crew-schedule?startDate&endDate` — crew + merged assignments.

### Gaps v2 must fill (the only justification for new code)
- No unscheduled-pool / capacity / availability composition for a board view.
- No pre-flight conflict/double-book/feasibility check.
- Travel-time not generalized beyond surveys.
- No persistent filters / saved views / resource board / map.
- (Deferred) no bulk-notification batching, no in-UI undo surface.

---

## 3. Job-type-agnostic data model

One normalized vocabulary every job type maps into, so adding survey/inspection/
service later is an adapter, not a rewrite. Defined in
`src/lib/scheduler-v2/types.ts`.

```ts
type WorkType = "install" | "survey" | "inspection" | "service" | "roofing" | "dnr";
type SubSystem = "PV" | "ESS" | "EV";
type WorkItemStatus =
  | "unscheduled" | "tentative" | "scheduled" | "en_route"
  | "working" | "done" | "failed" | "cancelled";

interface WorkItem {
  id: string;                 // stable: zuperJobUid ?? `${dealId}:${workType}:${subSystem ?? ""}`
  dealId?: string;            // HubSpot deal id (absent for Zuper-only overlay jobs)
  parentDealId?: string;      // groups split sub-jobs under one deal
  projectNumber?: string;
  customer: string;
  address?: string;
  location: string;           // normalized PB location
  geo?: { lat: number; lng: number };
  workType: WorkType;
  subSystem?: SubSystem;      // present when construction is split
  durationDays: number;
  status: WorkItemStatus;
  scheduledStart?: string;    // ISO; absent when unscheduled
  scheduledEnd?: string;
  assignedResourceIds: string[];
  isTentative: boolean;
  isOverdue: boolean;
  isForecast: boolean;
  hasZuperJob: boolean;       // false => assigning must use the create path (rescheduleOnly:false)
  value?: number;
  zuperJobUid?: string;
  source: "hubspot" | "zuper" | "schedule_record";
}

interface Resource {
  id: string;                 // zuperUserUid (assignable identity) ?? CrewMember.id
  name: string;
  kind: "crew" | "surveyor" | "inspector" | "tech";
  role?: string;              // from matched CrewMember
  locations: string[];        // a crew may serve several locations (e.g. SLO + Camarillo)
  primaryLocation: string;    // header placement
  color: string;
  capacityPerDay: number;     // from CrewMember.maxDailyJobs ?? location default
  zuperUserUid?: string;
  zuperTeamUid?: string;
  assignable: boolean;        // true only if present in its location's director-team user set
  crewMemberId?: string;      // set when reconciled to an active CrewMember
}

interface Assignment {        // mirrors /api/crew-schedule Assignment shape
  id: string;
  source: "schedule_record" | "booked_slot" | "zuper_job_cache";
  resourceName: string;
  date: string;               // YYYY-MM-DD
  startTime?: string | null;
  endTime?: string | null;
  workType: string;
  location?: string | null;
  workItemId: string;
  projectId: string;
  projectName: string;
  value?: number | null;
  status: string;
}

interface CapacityCell { resourceId?: string; location: string; date: string; loadDays: number; capacityDays: number; }
interface AvailabilityWindow { resourceId: string; date: string; startTime: string; endTime: string; available: boolean; reason?: string; }

interface ConflictResult {
  ok: boolean;
  hard: ConflictFlag[];       // block (no cert/crew; double-book; infeasible travel; weekend/holiday; lead-time)
  soft: ConflictFlag[];       // warn (tight travel; over capacity)
}
interface ConflictFlag { kind: "double_book" | "over_capacity" | "travel" | "availability" | "weekend_holiday" | "lead_time"; severity: "hard" | "soft"; message: string; detail?: unknown; }
```

### Adapters
`src/lib/scheduler-v2/adapters/` normalize existing API payloads into the model.
- Phase 1: `adapters/construction.ts` — composes deal install stage
  (`/api/projects?context=scheduling`) + Zuper construction sub-jobs
  (`/api/zuper/jobs/lookup?category=construction`, split PV/ESS/EV) +
  `/api/zuper/schedule-records` (tentatives) → `WorkItem[]`; `CrewMember`
  (install roles) → `Resource[]`; `/api/crew-schedule` assignments → `Assignment[]`;
  `DEFAULT_LOCATION_CAPACITY` + crew load → `CapacityCell[]`.
- Later: `survey.ts`, `inspection.ts`, `service.ts`, `roofing.ts`, `dnr.ts`
  behind the same interface.

Split-crew handling: a deal with PV + ESS yields **two `WorkItem`s** sharing
`parentDealId`, rendered as separate bars (grouped by color + customer) so each
sub-job is independently assignable — matching the construction-split decision.

### Resource sourcing (resolved design fork, was an open item)
Board rows are **the assignable install crews per location**, sourced from each
location's director-team live Zuper users
(`CONSTRUCTION_DIRECTORS[location].teamUid` → `/api/zuper/teams/{teamUid}/users`)
— because that, not `CrewMember`, is the set the existing `/schedule` write path
can actually assign to. Each row is then **reconciled to an active `CrewMember`**
(match by `zuperUserUid`, else by name) for color, capacity (`maxDailyJobs`),
role, and to map existing assignments (which `/api/crew-schedule` returns keyed by
crew name). Rows that reconcile set `assignable=true, crewMemberId`. A `CrewMember`
with install history but no current director-team membership may still render
(so its past/assigned work shows) but with `assignable=false`. The `/board`
endpoint performs this reconciliation server-side and **caches team-users**
(they change rarely) to avoid per-load Zuper calls. This guarantees every
droppable row maps to a real Zuper-assignable identity.

---

## 4. Module structure (all additive)

```
src/lib/scheduler-v2/
  types.ts
  constants.ts            # crews, locations, timezones, colors (copied from v1)
  normalize.ts            # stage map, overdue, customer-name parse (copied/adapted)
  colors.ts               # status/work-type color system (consolidated)
  capacity.ts             # produces CapacityCell[] fresh; shares only CapacityHeatmap's
                          # color thresholds (CapacityHeatmap consumes a different
                          # CapacityAnalysis shape and is not piped directly)
  conflicts.ts            # client helpers around /conflicts results
  assign.ts               # director-team -> live Zuper users resolution (copied from construction scheduler).
                          # NOTE: correct CONSTRUCTION_DIRECTORS["Colorado Springs"] at copy time
                          # (Rolando -> Lenny Uematsu, per current field-assignment coverage).
  adapters/construction.ts

src/components/scheduler-v2/
  SchedulerV2Shell.tsx     # flag gate, layout, view router, filter context
  DispatchBoard.tsx        # hero: crew rows x days
  BoardRow.tsx · JobBar.tsx · CapacityBar.tsx · TravelBlock.tsx
  AttentionStrip.tsx · UnscheduledQueue.tsx
  FilterBar.tsx · SavedViews.tsx · CommandPalette.tsx
  ScheduleDrawer.tsx       # assign/reschedule; wraps existing /schedule endpoints
  views/MonthView.tsx · WeekView.tsx · GanttView.tsx · MapView.tsx

src/app/dashboards/scheduler-v2/page.tsx

src/app/api/scheduler-v2/
  board/route.ts           # NEW additive: composes WorkItems + Resources + Assignments + capacity
  conflicts/route.ts       # NEW additive: pre-flight feasibility (incl. on-demand travel)
```

Imported as-is (not page code): `scheduling-utils.ts`, `travel-time.ts`,
`schedule-optimizer.ts`, `CapacityHeatmap`, `on-call-holidays`, `db.ts`,
`scheduling-policy.ts`, `constants` (timezones), `locations`.

---

## 5. New additive endpoints

### GET /api/scheduler-v2/board
Composes the board read so the client makes one call and the adapter lives
server-side.
- Query: `from`, `to` (YYYY-MM-DD, **max 32-day range** to match the proven
  `/api/crew-schedule` cap), `locations?`, `workTypes?` (phase 1 defaults to
  `install`).
- Internally: same DB queries `/api/crew-schedule` uses (CrewMember,
  ScheduleRecord, BookedSlot, ZuperJobCache) + `/api/projects` install pool +
  Zuper construction lookup + capacity from `DEFAULT_LOCATION_CAPACITY` +
  director-team user resolution (cached) for `Resource` rows (see §3 Resource
  sourcing).
- Returns `{ resources: Resource[], workItems: WorkItem[], assignments:
  Assignment[], capacity: CapacityCell[], dateRange }`.
- Read-only. Auth via `requireApiAuth` (same as crew-schedule).

### POST /api/scheduler-v2/conflicts
Pre-flight check for a proposed assignment; called on drag/hover and before a
drawer submit.
- Body: `{ workItemId, dealId?, resourceId, date, days, startTime?, endTime?,
  workType }`.
- Composes `getCrewSchedulesFromDB` + `getAvailabilityOverrides` +
  existing assignments (double-book), `DEFAULT_LOCATION_CAPACITY` (over-capacity),
  `travel-time.ts` (on-demand drive-time vs adjacent jobs), `on-call-holidays`
  (weekend/holiday), `scheduling-policy.ts` (sales lead-time).
- Returns `ConflictResult` (`hard[]` block, `soft[]` warn).
- Read-only. Travel is evaluated here on demand (not eagerly board-wide) to
  respect Google Distance Matrix quota; uses `travel-time.ts` caching.

### Bulk reschedule — no new endpoint
Bulk (e.g., "move a crew's week to another crew") is **client orchestration**
looping `PUT /api/zuper/jobs/schedule` with per-item progress — the same pattern
v1 already uses for sub-job submit and optimizer-apply. Trade-off: sends N crew
emails in phase 1; batched-notification suppression is deferred to a later phase
(would require extracting shared orchestration out of the existing route).

---

## 6. UI — board, views, interactions

### Hero: crew-row dispatch board
- Rows = active install `CrewMember`s under collapsible location headers
  (Westminster, Centennial, COSP, SLO, Camarillo). Columns = business days
  (weekend toggle).
- `JobBar`: status-colored, customer + PROJ + work-type icon; **multi-day jobs
  span columns**; split PV/ESS/EV render as separate bars grouped by
  `parentDealId`.
- `CapacityBar`: 2px under each crew/day, green ≤80 / yellow 81–100 / orange
  101–120 / red >120 (reusing CapacityHeatmap thresholds); flips to
  "availability" mode (remaining open days).
- `TravelBlock`: thin hatched segment between consecutive jobs on a row,
  populated on demand.
- Color encodes **status**; resource encoded by row position.

### Views (lenses over the same `WorkItem[]`)
Phase 1: Board (default), Week, Month (keeps overlays + forecast ghosts), Gantt
(install→inspection→PTO). Later: Map; survey/inspection/service adapters.

### Left rail: attention queue + unscheduled pool
Grouped Unassigned / Unfeasible / Overdue; sortable by age/value (modeled on
`service-unscheduled`); drag source onto crew rows.

### Filters / saved views / search
- One filter scopes board + queue + map (location / crew / work type / stage);
  persisted in the URL.
- 4–5 named saved views: "Unscheduled this week", "Over-capacity crews",
  "Overdue", "Today by crew".
- `⌘K` palette: jump-to-date, find-customer, assign.
- Display-vs-filter split: show capacity-relevant fields without removing rows.

### Assignment write path (important)
`ScheduleDrawer` reuses the construction scheduler's proven director-team → live
Zuper team-users resolution (copied into `lib/scheduler-v2/assign.ts`), then calls
the existing `/schedule` (or `/tentative`) endpoint. It does **not** push raw
`CrewMember.zuperUserUid` blindly.

### Create vs reschedule (Zuper assigned-at-creation constraint)
Zuper only honors `assigned_to` at job **creation**, and `PUT /schedule` defaults
to `rescheduleOnly:true` (returns `no_job_found` when no Zuper job exists). v2
inherits these exact semantics:
- WorkItem with `hasZuperJob:true` → drag/assign sends `rescheduleOnly:true`
  (reschedule + crew reconcile); construction siblings cascade as today.
- WorkItem with `hasZuperJob:false` (pooled deal whose Zuper job hasn't been
  created — v1 relies on HubSpot workflows to pre-create) → assigning sends
  `rescheduleOnly:false` so the existing route takes the **create path and
  assigns at creation** (the only moment Zuper allows it). The board surfaces a
  distinct "no Zuper job yet" affordance on these items rather than implying
  every pooled item is a simple drop.

---

## 7. Core workflows (all write through the existing spine)

1. **Assign** — drag pooled WorkItem → crew/day; hover → `POST /conflicts` → live
   feasibility chip; drop → `ScheduleDrawer` pre-filled with suggested crew +
   valid window; confirm → `PUT /schedule`; auto-notify.
2. **Move** — drag a bar; conflict check labels "Unavailable" vs "Unfeasible";
   customer-facing → arrival-window reconciliation prompt; commit → Undo snackbar;
   construction sibling cascade preserved by the existing endpoint.
3. **Resolve overbooking** — capacity reds; expand crew to see load; drag
   lowest-priority job to a green crew; hard-block impossible, soft-warn risky.
4. **Find capacity** — capacity bar → availability mode; "Find a time" highlights
   empty crew/day slots satisfying capacity + travel + skill.
5. **Respond to change (crew out)** — marquee-select a crew's week → bulk reassign
   (client orchestration) with per-item results.

### Partial-failure handling (no transactional multi-job writes)
`PUT /schedule` can return success-with-`assignmentFailed`, `hubspotWarnings`, or
per-sibling `failures`. The spine is not transactional across jobs, so v2 does
**not** auto-rollback. Rules:
- A job whose schedule succeeded but crew assignment failed renders with a
  per-row **warning chip** ("scheduled, assignment failed — reassign in Zuper"),
  sourced from `assignmentFailed`/`assignmentError`.
- `hubspotWarnings` surface as a non-blocking toast on that item.
- Bulk/sibling operations report a per-item result list (succeeded / failed /
  warning); failures stay actionable in the attention queue. No silent drops.

---

## 8. Rollout, safety, phasing

- **Feature flags:** `NEXT_PUBLIC_UI_SCHEDULER_V2_ENABLED` (UI),
  `SCHEDULER_V2_ENABLED` (new API gating). Nav card + `roles.ts` allowlist
  (`/dashboards/scheduler-v2`, `/api/scheduler-v2`) added for every role with the
  Operations suite, behind the flag.
- **Safety:** all writes via existing endpoints; new endpoints read-only;
  existing schedulers untouched and live until the flag is flipped.
- **Cache coherence (plumbing, additive):** register a `scheduler-v2` board key in
  `lib/query-keys.ts`; refresh the board by `queryClient.invalidateQueries` after
  each v2 write plus a modest `refetchInterval` for out-of-band v1 changes. Note:
  the existing `/schedule` write path does **not** broadcast to `appCache`, so SSE
  delivers no scheduling events today — do not rely on live v1↔v2 SSE sync. (A
  future phase could add an `appCache` broadcast for true live sync.)
- **Timezone on write:** the drop's IANA timezone is derived from the target
  WorkItem's `location` (CA locations → `America/Los_Angeles`, CO → `America/Denver`),
  matching what the construction scheduler already passes to `/schedule`.
- **Phasing:**
  - Phase 1: construction/install dispatch board (Board/Week/Month/Gantt) +
    attention queue + `/board` + `/conflicts` + on-demand travel + saved views,
    on the agnostic data layer.
  - Phase 2: Map view + survey/inspection adapters.
  - Phase 3: service/roofing/D&R adapters + bulk-notification batching +
    optimizer-as-proposal (surfacing `schedule-optimizer.ts` with a diff) + undo
    surface built on `ScheduleEventLog`.
  - Retire v1 only after all adapters reach parity behind the flag.

---

## 9. Testing

- Unit (TDD where it pays): construction adapter (Zuper sub-jobs + deal +
  schedule records → `WorkItem[]`), capacity math, conflict detection — pure
  functions, follow existing `src/__tests__` patterns.
- Component: board drag/drop, ScheduleDrawer submit (mock the existing endpoints).
- Manual: preview-tool verification of the board before flag-on.

---

## 10. Non-goals (phase 1)

- No autonomous re-optimization (optimizer stays a human-adjudicated proposal,
  and only in phase 3).
- No new write path to Zuper/HubSpot.
- No third-party calendar/scheduler library.
- No editing of existing scheduler pages or scheduling API routes.
- No bulk-notification batching (deferred).

---

## 11. Open items to verify during phase 1 (not blockers)

- **Director-team coverage:** confirm each location's `CONSTRUCTION_DIRECTORS`
  team resolves (via `/api/zuper/teams/{teamUid}/users`) to the actual install
  crews you want as board rows, and that `CrewMember` reconciliation matches them
  by `zuperUserUid`/name. (Resource sourcing is now resolved in §3; this is a
  data-quality check, not a design fork.)
- **Overlay context in phase 1:** decide whether service/D&R/roofing show as
  read-only faded context on the construction board (lean: yes, mirroring the v1
  master overlay) or are hidden until their adapters ship.
- **Capacity granularity:** phase 1 capacity bar blends `DEFAULT_LOCATION_CAPACITY`
  with `CrewMember.maxDailyJobs` where reconciled; pure per-crew capacity is a
  phase-2 refinement.
- **Name-matching of existing assignments:** `/api/crew-schedule` returns
  assignments keyed by crew name; verify these names match the director-team user
  names so existing scheduled work lands on the right row (fallback: unmatched
  assignments render in an "unmapped" lane rather than disappearing).
```
