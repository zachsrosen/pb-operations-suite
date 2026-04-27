# Shit Show Meeting Hub — Design Spec

**Date:** 2026-04-27
**Author:** Zach (with Claude)
**Status:** Draft for review

---

## 1. Summary

The Shit Show Meeting is a recurring owner-led review of "problem projects" — deals that are stuck, costing money, or otherwise embarrassing — brought to the owner as a group for discussion and decisions. Today projects can be flagged for the meeting from the IDR Meeting hub via a 🔥 toggle, but no actual meeting space exists; the flagged items live in `IdrMeetingItem` rows with no way to run a session against them.

This spec defines `/dashboards/shit-show-meeting`, a session-based meeting hub mirroring the IDR Meeting hub's pattern (sessions, presence, a project queue, a per-project detail pane, and meeting outcomes), but scoped to the simpler shit-show workflow: snapshot every flagged deal, walk through them with the owner, decide an outcome, capture follow-ups, and write the result back to HubSpot so the deal carries the decision in its native record.

---

## 2. Goals & Non-Goals

### Goals

- One canonical "is this deal a shit show?" answer, stored on the deal in HubSpot, visible from anywhere (HubSpot views, workflows, both meeting hubs, future automation).
- A meeting space the owner can run live: open a session, see every flagged deal grouped by location, walk through each, take notes, assign follow-ups, mark a decision.
- Follow-ups become real obligations — HubSpot tasks on the deal owned by a real person — not just notes that vanish.
- Meeting outcomes land on the HubSpot deal timeline as a note so non-attendees can see what was discussed.
- Track session history per deal so chronic problems surface ("3rd time at shit show in 2 months").

### Non-Goals

- No standalone calendar / cadence — sessions are created ad hoc.
- No SMS or email notifications when a deal is flagged or resolved.
- No analytics dashboard ("how many shit shows per quarter") — `decision` is queryable later if wanted.
- No mobile-optimized layout — desktop-first like the IDR hub.
- No PDF / minutes export — the per-deal HubSpot note is the durable record.
- No replacement for the existing IDR meeting; the two hubs share the flag but otherwise operate independently.

---

## 3. Source of Truth: HubSpot Deal Properties

Three new custom properties on the Deal object:

| Property name (internal) | Label | Type | Notes |
|---|---|---|---|
| `pb_shit_show_flagged` | Shit Show Flagged | Single checkbox (boolean) | True = currently a shit show |
| `pb_shit_show_reason` | Shit Show Reason | Multi-line text | Free text; cleared when `pb_shit_show_flagged` flips to false |
| `pb_shit_show_flagged_since` | Shit Show Flagged Since | Date | Set to `now()` whenever the flag transitions false→true; null when flag is false. Drives "oldest first" queue sort. The transition is computed server-side in `lib/shit-show/hubspot-flag.ts` — read current `pb_shit_show_flagged`, write all three properties together if and only if the flag is changing to true. |

**Why deal-level, not session-level:** A deal flagged in IDR session A on April 1 is currently NOT flagged in IDR session B on April 8 because `IdrMeetingItem.shitShowFlagged` is per-session. Moving the flag to the deal makes "is this a shit show?" a single answer that all consumers (IDR, Shit Show hub, HubSpot views, workflows, future automation) see consistently.

**Backfill:** before the new code reads from HubSpot, every existing `IdrMeetingItem` row where `shitShowFlagged = true` is reduced to a unique set of dealIds, and each deal gets its `pb_shit_show_flagged` and `pb_shit_show_reason` set in HubSpot. Backfill is idempotent (re-runnable; PATCHes the same value on re-run).

**Drop-after-backfill:** after a one-week bake period in prod (see §9 step 5), a follow-up migration drops `IdrMeetingItem.shitShowFlagged` and `IdrMeetingItem.shitShowReason`. Per the user's migration-ordering rule, the additive HubSpot property work + backfill ships first; the column drop is a separate, later migration.

### HUMAN ACTION REQUIRED — before code merge

1. In HubSpot: create `pb_shit_show_flagged` (single checkbox), `pb_shit_show_reason` (multi-line text), and `pb_shit_show_flagged_since` (date) on the Deal object.
2. Add the new env-vars-or-constants if any (none currently anticipated; property names are hard-coded).
3. After merge: run the backfill script once.
4. After verification: ship the column-drop migration.

---

## 4. Data Model — New Tables

```prisma
model ShitShowSession {
  id        String                 @id @default(cuid())
  date      DateTime
  status    ShitShowSessionStatus  @default(DRAFT)
  createdBy String                 // user email
  createdAt DateTime               @default(now())
  updatedAt DateTime               @updatedAt

  items ShitShowSessionItem[]

  @@index([date])
}

enum ShitShowSessionStatus {
  DRAFT       // session created but not started
  ACTIVE      // currently being run
  COMPLETED   // session ended
}

model ShitShowSessionItem {
  id        String           @id @default(cuid())
  sessionId String
  session   ShitShowSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  dealId    String
  region    String           // pb_location, snapshotted at session start
  sortOrder Int              @default(0)

  // Snapshotted from HubSpot at session start (refreshed via stale-while-revalidate pattern, like IDR)
  dealName        String
  dealAmount      Float?
  systemSizeKw    Float?
  stage           String?    // dealstage label
  dealOwner       String?
  reasonSnapshot  String?    // copy of pb_shit_show_reason at snapshot time
  flaggedSince    DateTime?  // copied from pb_shit_show_flagged_since at snapshot time; backfilled rows get the migration's run timestamp
  snapshotUpdatedAt DateTime @default(now())

  // Filled during the meeting
  meetingNotes        String?
  decision            ShitShowDecision @default(PENDING)
  decisionRationale   String?  // Short "why we made this call." Required when decision is STILL_PROBLEM, ESCALATED, or DEFERRED. Optional for RESOLVED.
  resolvedAt          DateTime?
  resolvedBy          String?

  // External writes — IDs stored for idempotency
  hubspotNoteId        String?  // posted at session-end
  noteSyncStatus       ShitShowSyncStatus @default(PENDING)
  noteSyncError        String?

  // Escalation (when decision = ESCALATED) — uses decisionRationale as the reason text; these fields capture the external write IDs only
  idrEscalationQueueId    String?  // FK-by-id to IdrEscalationQueue.id (not enforced; escalation is best-effort)
  hubspotEscalationTaskId String?  // HubSpot task created when escalating to owner

  addedBy       ShitShowAddedBy @default(SYSTEM) // ShitShowAddedBy.SYSTEM = auto from snapshot; ShitShowAddedBy.MANUAL = AddProjectDialog
  addedByUser   String?         // user email when addedBy = ShitShowAddedBy.MANUAL; null when SYSTEM
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  assignments ShitShowAssignment[]

  @@unique([sessionId, dealId])
  @@index([sessionId, region])
  @@index([dealId])
}

enum ShitShowDecision {
  PENDING        // not yet discussed
  RESOLVED       // discussed, fixed; clears pb_shit_show_flagged on the deal
  STILL_PROBLEM  // still a shit show; flag stays
  ESCALATED      // escalated; flag stays + creates HubSpot task on owner + IdrEscalationQueue row
  DEFERRED       // skip for this session; flag stays
}

enum ShitShowSyncStatus {
  PENDING        // awaiting first sync attempt
  SYNCED         // successfully written to HubSpot
  FAILED         // last attempt failed; will retry
}

model ShitShowAssignment {
  id            String              @id @default(cuid())
  sessionItemId String
  sessionItem   ShitShowSessionItem @relation(fields: [sessionItemId], references: [id], onDelete: Cascade)

  assigneeUserId String   // FK-by-id to User; not enforced because users can be deactivated
  dueDate        DateTime?
  actionText     String

  status ShitShowAssignmentStatus @default(OPEN)

  // External writes — IDs stored for idempotency
  hubspotTaskId    String?
  taskSyncStatus   ShitShowSyncStatus @default(PENDING)
  taskSyncError    String?

  createdBy String   // user email
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([sessionItemId])
  @@index([assigneeUserId, status])
}

enum ShitShowAssignmentStatus {
  OPEN
  COMPLETED
  CANCELLED
}

enum ShitShowAddedBy {
  SYSTEM    // auto from snapshot
  MANUAL    // user added via AddProjectDialog
}

model ShitShowBackfillRun {
  id          String    @id @default(cuid())
  startedAt   DateTime  @default(now())
  completedAt DateTime?
  processed   Int       @default(0)
  errors      Int       @default(0)
  errorLog    Json      @default("[]") // array of { dealId, error } for skipped/failed rows
  status      String    @default("RUNNING") // RUNNING | COMPLETED | FAILED

  @@index([status])
}
```

### Relationships in plain English

- A session has many items; each item is one deal up for discussion.
- An item has many assignments — concrete follow-ups handed to a person with a due date.
- The deal lives in HubSpot; we only store its dealId + a snapshot of display fields, refreshed on demand.

### Indexes

- `ShitShowSession.date` — list view sort.
- `ShitShowSessionItem.(sessionId, region)` — group-by-location queue rendering.
- `ShitShowSessionItem.dealId` — "show all prior shit-show appearances for this deal" history strip.
- `ShitShowAssignment.(assigneeUserId, status)` — "what do I owe from shit show meetings?" my-tasks view (future).

---

## 5. Architecture & File Layout

### Routes — page

```
src/app/dashboards/shit-show-meeting/
  page.tsx                       — server component, role-gates and renders client
  ShitShowMeetingClient.tsx      — top-level client component (mirrors IdrMeetingClient.tsx)
  SessionHeader.tsx              — session metadata, presence chips, start/end controls
  ProjectQueue.tsx               — left rail, location-grouped queue
  AddProjectDialog.tsx           — search HubSpot, set pb_shit_show_flagged, add to current session
  ProjectDetail.tsx              — right pane container
  ReasonPanel.tsx                — read-only reason + flagged-since
  ProjectInfoPanel.tsx           — read-only project context (address, system, owners, AHJ/utility, links)
  HistoryStrip.tsx               — prior shit-show sessions for this deal (date, decision, decisionRationale one-liner)
  IdrNotesContext.tsx            — read-only recent IDR notes for context
  MeetingNotesForm.tsx           — autosaving textarea for ShitShowSessionItem.meetingNotes
  AssignmentsPanel.tsx           — list + add follow-ups
  DecisionActions.tsx            — Resolved / Still problem / Escalate / Defer buttons
  MeetingSearch.tsx              — search past sessions
```

Components named identically to IDR equivalents (e.g., `ProjectQueue`, `MeetingNotesForm`) are conceptually parallel but live in separate files because their shape differs. Genuinely shared logic moves to a shared module (see §10).

### Routes — API

```
src/app/api/shit-show-meeting/
  sessions/route.ts                       — GET list, POST create
  sessions/[id]/route.ts                  — GET detail, PATCH (start/end), DELETE
  sessions/[id]/snapshot/route.ts         — POST: pull all deals where pb_shit_show_flagged=true
                                            and create ShitShowSessionItem rows
  sessions/[id]/end/route.ts              — POST: completes session, posts HubSpot notes per item
  items/[id]/route.ts                     — PATCH: meetingNotes, decision, escalation fields
  items/[id]/assignments/route.ts         — GET list, POST create
  assignments/[id]/route.ts               — PATCH: status updates; mirrors HubSpot task close-back
  presence/route.ts                       — same pattern as /api/idr-meeting/presence
  search/route.ts                         — past sessions search
  deal-search/route.ts                    — wraps HubSpot deal search for AddProjectDialog
  flag/route.ts                           — POST { dealId, flagged, reason }; the canonical write to
                                            pb_shit_show_flagged + pb_shit_show_reason
  idr-notes/[dealId]/route.ts             — proxy: GET recent IdrMeetingNote rows for the deal (read-only)
  users/route.ts                          — proxy: GET active users for the assignee picker
```

Plus one cron route (public-by-middleware, not subject to role allowlist):

```
src/app/api/cron/shit-show-task-sync/route.ts
                                          — every 15 min: poll HubSpot for status changes on tasks
                                            referenced by ShitShowAssignment.hubspotTaskId; updates
                                            ShitShowAssignment.status when the HubSpot task closes
```

### Library modules

```
src/lib/shit-show/
  hubspot-flag.ts          — read/write pb_shit_show_flagged + pb_shit_show_reason
  hubspot-note.ts          — post end-of-session timeline note on the deal
  hubspot-task.ts          — create/close-back HubSpot tasks for assignments
  hubspot-escalation.ts    — escalate-action: HubSpot task to owner + IdrEscalationQueue row
  snapshot.ts              — orchestrate "snapshot all flagged deals into a session"
  decision.ts              — apply a ShitShowDecision (incl. clearing flag on RESOLVED)
```

Mirror the existing `lib/idr-meeting/*` layout where parallel.

### Suite navigation

In `src/lib/suite-nav.ts`, the Executive suite's card list gets one new entry for `/dashboards/shit-show-meeting`. No other suite shows it.

### Role allowlists

Per `feedback_api_route_role_allowlist.md` and the user's prior pain ("last time we did this, some users could see the page but nothing populated"), the spec is explicit about EVERY route — page AND API — that needs to be in each role's `allowedRoutes`. ADMIN and EXECUTIVE already have wildcard `["*"]` and don't need any addition.

The 15 explicit non-wildcard roles requiring the addition: ACCOUNTING, DESIGN, INTELLIGENCE, INTERCONNECT, MARKETING, OPERATIONS, OPERATIONS_MANAGER, PERMIT, PROJECT_MANAGER, ROOFING, SALES, SALES_MANAGER, SERVICE, TECH_OPS, VIEWER.

(Legacy roles MANAGER, DESIGNER, PERMITTING, OWNER all normalize to other entries above and inherit transitively — no separate handling needed. ADMIN and EXECUTIVE are wildcard.)

For each of those 15 roles, add the following entries to `allowedRoutes` (prefix matching is in effect, so the API prefix covers all sub-routes):

```ts
"/dashboards/shit-show-meeting",
"/api/shit-show-meeting",
```

The single `/api/shit-show-meeting` prefix entry covers every API route enumerated in §5 (sessions, items, assignments, presence, search, deal-search, flag, snapshot, end). No per-route additions needed.

**Cross-namespace dependencies — resolved by namespacing everything under `/api/shit-show-meeting`.** To eliminate silent 403s, NO Shit-Show UI calls cross-namespace APIs. Every dependency gets a thin proxy under `/api/shit-show-meeting/*`:

| Original endpoint | Replaced by Shit-Show proxy | Why |
|---|---|---|
| HubSpot deal search (used by IDR's `deal-search`) | `/api/shit-show-meeting/deal-search` | already in §5 |
| `IdrMeetingNote` reads | `/api/shit-show-meeting/idr-notes/[dealId]` | new proxy |
| User list for assignee picker | `/api/shit-show-meeting/users` | new proxy that reads from DB |
| `/api/stream` (SSE) | `/api/stream` (shared, all roles already have it) | no change |

Update the §5 API listing to include these proxies (added there).

### Verification step (explicit, NOT a "nice to have")

Before merging, the implementation MUST include a manual QA pass that does the following for **every** role in {ACCOUNTING, DESIGN, INTELLIGENCE, INTERCONNECT, MARKETING, OPERATIONS, OPERATIONS_MANAGER, PERMIT, PROJECT_MANAGER, ROOFING, SALES, SALES_MANAGER, SERVICE, TECH_OPS, VIEWER}:

1. Use the admin role-impersonation cookie (`pb_effective_roles`) to assume that role.
2. Navigate to `/dashboards/shit-show-meeting`.
3. Verify (a) the page loads, (b) the queue populates with snapshot data, (c) clicking a queue item populates the right pane with reason, history, IDR notes, and assignments, (d) the assignee picker dropdown shows users.
4. Open browser devtools Network tab and confirm zero 403s on any `/api/*` request.

Any 403 → that endpoint's prefix is missing from that role's allowlist → fix and re-verify.

This step is a checklist item in the implementation plan, not a vague "test it." Each role gets a row in a verification table.

### Middleware

No changes. Standard NextAuth session + role gate already covers the new routes once `roles.ts` is updated. No public/portal/machine-token paths.

---

## 6. UI / UX

### Layout

Two-pane layout, identical chrome to IDR Meeting hub:

```
┌──────────────────────────────────────────────────────────────────┐
│ DashboardShell — accentColor="red", title="Shit Show Meeting"   │
├────────────────┬─────────────────────────────────────────────────┤
│ SessionHeader  │ (right pane = ProjectDetail for selected item)  │
├────────────────┤                                                 │
│ AddProjectBtn  │ ReasonPanel                                     │
├────────────────┤ ProjectInfoPanel                                │
│ ProjectQueue   │ HistoryStrip                                    │
│                │ IdrNotesContext (collapsed)                     │
│  - DTC        ▾│ MeetingNotesForm                                │
│  - Westy      ▾│ AssignmentsPanel                                │
│  - COSP       ▾│ DecisionActions                                 │
│  - California ▾│                                                 │
└────────────────┴─────────────────────────────────────────────────┘
```

### ProjectInfoPanel (read-only context)

A compact grid above the meeting notes giving the owner enough context to evaluate "is this still broken?" without leaving the page. **All fields are read-only** — the meeting captures decisions and follow-ups, not field-level project edits (those still happen in IDR / HubSpot).

Fields shown (curated subset of what the snapshot already pulls):

| Section | Fields |
|---|---|
| Site | `address`, `pb_location` |
| System | `systemSizeKw`, `equipmentSummary`, `projectType` |
| Stage & status | current `stage` (deal stage label), `surveyStatus`, `surveyDate`, `designStatus`, `designApprovalStatus`, `plansetDate` |
| Compliance | `ahj`, `utilityCompany` |
| People | `dealOwner`, `projectManager`, `operationsManager`, `siteSurveyor` |
| Quick links (button row) | HubSpot deal page, OpenSolar URL, Sales folder, Survey folder, Design folder |

If a field is null on the snapshot, show "—" rather than a blank cell. Quick-link buttons whose URL is null are hidden, not greyed.

The data comes from `ShitShowSessionItem` snapshot fields; these mirror IDR's snapshot field set (see §8 — snapshot pulls the same shape as `IdrMeetingItem`'s snapshot fields). The `ShitShowSessionItem` schema in §4 is extended below to carry these fields.

### Queue grouping & sort

- Sticky section headers per `pb_location` (DTC, Westy, COSP, California / Camarillo, etc.).
- Within each group: oldest-flagged-first (`flaggedSince` ascending; null `flaggedSince` rows sort last). Surfaces chronic problems.
- Empty groups omitted.
- Each row shows: deal name, deal $, decision pill (color-coded), "🔥 Nth time" badge if `> 1` prior shit-show appearances for this deal.

### Add-project flow

- "+ Add a deal" opens a dialog with a HubSpot deal search (debounced, mirrors IDR `deal-search`).
- User picks a deal, types a reason in a required textarea, submits.
- Server: PATCHes deal in HubSpot to set `pb_shit_show_flagged=true` + `pb_shit_show_reason=<text>`, then creates a `ShitShowSessionItem` for the active session pointing at that deal.
- The deal is now flagged for any future session too (until resolved).

### Decision actions

Four buttons in `DecisionActions`:

| Button | Effect on `decision` | `decisionRationale` | Effect on HubSpot flag | Other side effects |
|---|---|---|---|---|
| Resolved | RESOLVED | optional | Clears `pb_shit_show_flagged`, `pb_shit_show_reason`, `pb_shit_show_flagged_since` | none |
| Still a problem | STILL_PROBLEM | **required** | unchanged | none |
| Escalate | ESCALATED | **required** (used as escalation reason text) | unchanged | (1) creates HubSpot task assigned to deal owner with the rationale as task body; (2) creates row in `IdrEscalationQueue` with the rationale as `reason`, so it surfaces in the next IDR session |
| Defer | DEFERRED | **required** | unchanged | none |

All four also set `resolvedAt = now()` and `resolvedBy = current user`.

The `DecisionActions` UI: clicking any button opens a small inline form for `decisionRationale` (textarea, required for the three "required" rows above; optional placeholder "What was resolved?" for RESOLVED). Submit commits the decision; the buttons are disabled until the form passes validation.

### Assignments panel

- Lists existing `ShitShowAssignment` rows for the selected item.
- "+ Add assignment" → form: assignee picker (User table), optional due date, action text (required).
- On save: DB row created; HubSpot task created on the deal with `taskSubject = "Shit Show follow-up: <action text>"`, `taskBody = action text + permalink back to the session item`, `taskOwnerId = HubSpot user id mapped from assignee`, `taskDueDate = dueDate`.
- The DB row stores `hubspotTaskId` for idempotency.
- Status-change-on-close: when the HubSpot task is marked complete, our existing HubSpot webhook handler (or a poller — see §7) updates the assignment row to `COMPLETED`.

### End-of-session

When the owner clicks "End Session":
- Session status → `COMPLETED`.
- For each `ShitShowSessionItem` (regardless of decision), post one HubSpot note on the deal timeline:
  ```
  🔥 Shit Show Meeting — <date>

  Decision: <Resolved | Still a problem | Escalated | Deferred>
  Decision rationale: <decisionRationale>
  Reason at time of meeting: <reasonSnapshot>

  Notes from discussion:
  <meetingNotes>

  Follow-ups assigned:
  - <assignee>: <actionText> (due <date>)
  - …
  ```
- `hubspotNoteId` stored on the item for idempotency. Re-running end-session is safe — items with a non-null `hubspotNoteId` skip note creation.
- `noteSyncStatus` transitions PENDING → SYNCED on success or → FAILED with error captured in `noteSyncError`. A retry button surfaces in the item detail when status is FAILED.

### Theme & visuals

- `DashboardShell` `accentColor="red"` (the queue is fire-themed; matches the 🔥 emoji in IDR).
- Decision pill colors: green (Resolved), amber (Still problem), red (Escalated), gray (Deferred), neutral (Pending).
- Otherwise inherit existing theme tokens — `bg-surface`, `text-foreground`, etc. No new CSS variables.

---

## 7. Integrations & External Writes

All HubSpot calls go through the existing `searchWithRetry`-style rate-limit-aware client.

### Three outbound write paths

1. **Flag write** (`hubspot-flag.ts`)
   - PATCH `/crm/v3/objects/deals/{dealId}` with `properties: { pb_shit_show_flagged, pb_shit_show_reason }`.
   - Called from: IDR's existing 🔥 toggle, Shit Show `AddProjectDialog`, Shit Show `Resolved` decision.
   - Idempotent by HubSpot semantics.

2. **Task write** (`hubspot-task.ts`, `hubspot-escalation.ts`)
   - POST a Task object associated with the deal.
   - Stored task id → `ShitShowAssignment.hubspotTaskId` or `ShitShowSessionItem.hubspotEscalationTaskId`.
   - Status close-back: option A — webhook from HubSpot on task status change. Option B — poller in a cron route. Both are existing patterns in this codebase. **Recommendation: option B** (poller every 15min via existing cron infra) because HubSpot task webhooks aren't currently subscribed; standing up that subscription adds a separate ops task.

3. **Note write** (`hubspot-note.ts`)
   - POST an Engagement (Note) associated with the deal.
   - One note per session-item at end-of-session.
   - Idempotent by `ShitShowSessionItem.hubspotNoteId` check before posting.

### Failure handling

- All three writes use exponential backoff on 429.
- On other failures: persist the failure on the originating row (`*SyncStatus = FAILED`, `*SyncError = <message>`), surface a "retry" button in the UI, and a background job (existing cron pattern) retries every N minutes for up to M attempts.
- We never block the user-facing request on the external write succeeding — the DB write is the synchronous return; the HubSpot write is best-effort with retry.

### Escalation atomicity

The "Escalate" decision performs two external writes (HubSpot task + IdrEscalationQueue row). The route handler `PATCH /api/shit-show-meeting/items/[id]` (when the body sets `decision: "ESCALATED"`) wraps the local writes in a single Prisma transaction:

```ts
await prisma.$transaction(async (tx) => {
  await tx.shitShowSessionItem.update({ where: { id }, data: { decision: "ESCALATED", decisionRationale, resolvedAt, resolvedBy } });
  await tx.idrEscalationQueue.create({ data: { dealId, dealName, region, queueType: "ESCALATION", reason: decisionRationale, requestedBy: userEmail } });
});
// AFTER the transaction commits, fire-and-retry the HubSpot task write:
await scheduleHubspotEscalationTask({ sessionItemId: id, dealId, ownerId, reason: decisionRationale });
```

- The `IdrEscalationQueue` row and the decision update commit together or not at all.
- The HubSpot task is async and best-effort with retry per the §7 failure-handling rules.
- If the HubSpot task fails permanently, the IDR queue row still surfaces the deal — so the escalation isn't "lost," just under-noisy.

---

## 8. Sessions, Snapshotting, Presence

### Session lifecycle

```
DRAFT → (user clicks "Start") → ACTIVE → (user clicks "End") → COMPLETED
```

Only one ACTIVE session is permitted at a time (enforced server-side via a partial unique index pattern, mirroring the BOM pipeline lock). Attempting to start a second concurrently returns 409 with the active session id.

### Snapshot timing

- Snapshot runs on **session start** (DRAFT → ACTIVE), not on creation.
- Snapshot fetches every deal where `pb_shit_show_flagged = true` from HubSpot via the search API (paginated as needed).
- One `ShitShowSessionItem` is created per deal, with snapshot fields populated.
- `addedBy = "system"`.

### Stale-while-revalidate

Same pattern as IDR: the snapshot stores display fields. When the right pane opens, the client triggers a refresh of those fields from HubSpot (rate-limited per-session-per-item to once every 5 min). Updates `snapshotUpdatedAt`.

### Presence

Reuse the IDR presence pattern verbatim — same in-memory store keyed by `(sessionId, userEmail, lastSeenAt)`, same SSE stream, same chip UI.

**Default: mirror, not share.** Copy IDR's presence implementation into `src/app/api/shit-show-meeting/presence/` and a new `ShitShowMeetingClient` presence hook. Only extract to `lib/meeting-presence.ts` if the IDR implementation is already factored such that the extraction is a 30-minute refactor with no behavior changes. The implementation plan owns this decision — if extraction takes longer than 30 minutes, keep them duplicated and revisit in a separate refactor PR.

---

## 9. Migration Plan

In strict order:

1. **Additive HubSpot property creation (HUMAN)** — create `pb_shit_show_flagged` (boolean), `pb_shit_show_reason` (multi-line text), `pb_shit_show_flagged_since` (date) on the Deal object in HubSpot UI.
2. **Additive Prisma migration** — add the four new tables (`ShitShowSession`, `ShitShowSessionItem`, `ShitShowAssignment`, `ShitShowBackfillRun`) and five enums (`ShitShowSessionStatus`, `ShitShowDecision`, `ShitShowSyncStatus`, `ShitShowAssignmentStatus`, `ShitShowAddedBy`). No drops. Run manually by the user (subagents cannot run migrations).
3. **Backfill script** (`scripts/backfill-shit-show-flags.ts`) — read all `IdrMeetingItem` rows where `shitShowFlagged = true`, dedupe by `dealId`, PATCH HubSpot deals with `pb_shit_show_flagged = true`, `pb_shit_show_reason = <latest non-null shitShowReason>`, `pb_shit_show_flagged_since = <run timestamp>`. Idempotent. Tracks progress in a `ShitShowBackfillRun` row (resumable on restart by querying for `status = 'RUNNING'`).
4. **Code merge** — Shit Show hub goes live AND IDR's existing toggle is rewired to write to HubSpot. Specifically:
   - **IDR files modified:**
     - `src/app/api/idr-meeting/items/[id]/route.ts` — remove `"shitShowFlagged"` and `"shitShowReason"` from the editable-fields whitelist. Replace with a write to `lib/shit-show/hubspot-flag.ts` when those fields are in the PATCH body.
     - `src/app/api/idr-meeting/preview/route.ts` — `shitShowFlagged: false` defaults become `await readShitShowFlag(dealId)` calls (batched for the preview list, with a per-page `Promise.all` against the HubSpot search API rather than per-deal fetches).
     - `src/app/dashboards/idr-meeting/StatusActionsForm.tsx` — `handleToggle("shitShowFlagged")` continues to call the same items PATCH endpoint; no UI change. Tooltip added: "This flags the deal globally — clear it from the Shit Show meeting's Resolved action."
     - `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx` — `shitShowFlagged: boolean` and `shitShowReason: string | null` types stay (the values come from the snapshot path, just sourced from HubSpot now).
     - `src/app/dashboards/idr-meeting/ProjectQueue.tsx` — no change; consumes existing `item.shitShowFlagged` field.
   - **Rollback plan:** revert this code merge. The legacy `IdrMeetingItem.shitShowFlagged`/`shitShowReason` columns still exist during the bake period, so a revert restores the prior behavior immediately. After the drop migration in step 6, rollback requires also reverting the migration.
5. **Bake period** — minimum one week from prod merge. Verify daily that (a) the IDR 🔥 toggle still works end-to-end and reflects in HubSpot, (b) the Shit Show snapshot pulls the right deals, (c) `ShitShowBackfillRun` shows `status = COMPLETED` with `errors = 0`.
6. **Drop migration** — separate later migration removing `IdrMeetingItem.shitShowFlagged` and `IdrMeetingItem.shitShowReason`. Run manually by the user (subagents cannot run migrations).

---

## 10. Code Reuse vs Duplication

Where IDR has a clear, generic pattern that Shit Show needs identically, extract to a shared module:

- **Presence** → `lib/meeting-presence.ts` if not already shared.
- **Deal search** for `AddProjectDialog` → `lib/hubspot-deal-search.ts` (likely already exists; reuse).
- **Note rendering** for "recent IDR notes" context → existing `IdrMeetingNote` query, no new code.
- **Session list & search** → similar shape but different tables; mirror rather than share.
- **Project queue / detail / decision actions** → duplicate, not share. The shapes diverge (decisions, assignments, escalation flow) and forcing a shared component creates more conditionals than it saves lines.

Rule of thumb applied: extract when the abstraction is genuinely the same; duplicate when the surface is similar but the inner logic diverges.

---

## 11. Testing Strategy

- **Unit tests** for the four HubSpot lib modules (`hubspot-flag`, `hubspot-note`, `hubspot-task`, `hubspot-escalation`): mock the HubSpot client, verify request shape, verify idempotency on second call.
- **Unit tests** for `decision.ts`: each decision value produces the right combination of DB updates and external write triggers.
- **Unit tests** for `snapshot.ts`: given mock HubSpot responses, produces expected `ShitShowSessionItem` rows.
- **API route tests** for `/api/shit-show-meeting/sessions/[id]/snapshot`, `/api/shit-show-meeting/items/[id]`, `/api/shit-show-meeting/sessions/[id]/end`: happy path + permission denial + idempotency on re-end.
- **Integration test** for backfill script against a mocked HubSpot client: dedupes correctly, resumes from a partial run.
- **Manual QA** against a HubSpot sandbox before prod merge: full flow from flag → snapshot → meeting → decision → end-session → note appears on deal timeline.

---

## 12. Out of Scope / Future Work

(Re-stated from §2 for the writing-plans handoff.)

- Cadence / scheduled sessions.
- SMS/email/HubSpot-Chat notifications when a deal is flagged or resolved.
- "Shit show analytics" dashboard.
- Mobile layout.
- Minutes export (PDF or otherwise).
- "My open shit-show assignments" personal task view (the `(assigneeUserId, status)` index makes this easy to add later).
- HubSpot workflow that auto-flags deals matching certain criteria (e.g., stuck in survey > 30 days). Easy to add post-launch since the property is now Hub native.

---

## 13. Open Questions

None at this time. Anything that surfaces during implementation surfaces back here.

---

## 14. Risks

- **HubSpot rate limits** on the snapshot pull when many deals are flagged. Mitigation: batched search + the existing rate-limit retry wrapper. If `pb_shit_show_flagged = true` count exceeds ~200 we'd want to cache the search result for 60s.
- **Concurrent flag writes from IDR + Shit Show hub** to the same deal. Mitigation: HubSpot's PATCH semantics handle last-writer-wins; we accept that behavior.
- **Property name typos** between HubSpot and code. Mitigation: define names as exported constants in `lib/shit-show/hubspot-flag.ts` and reference from one place.
- **IDR users surprised by the flag persisting across sessions.** Mitigation: add a one-line tooltip on the IDR 🔥 toggle clarifying "this flags the deal globally — clear it from the Shit Show meeting's Resolved action."
