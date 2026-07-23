# Design Hub — design doc

**Date:** 2026-07-22
**Status:** Approved (Zach, 2026-07-22)
**Route:** `/dashboards/design-hub`

## Problem

Design coordinators route work to Vishtik, review what comes back, chase DA
approvals, and drive revisions. Today that work is dispatched by Zach through
email and Google Chat worklists, and tracked by hunting across `de-overview`,
`plan-review`, `pending-approval`, and `design-revisions`. There is no single
place a coordinator works out of, and no durable record of "do these today".

Two things already exist and are reused rather than rebuilt:

- `src/lib/daily-focus/config.ts` — `DESIGN_LEADS` roster (Jacob Campbell,
  Elliott Gunning, Zach Rosen) with HubSpot owner IDs.
- `src/lib/bottleneck-team-digest.ts` — a `design` team case producing "DAs to
  send", "Designs to complete", "Final design reviews", "Revisions to
  complete", served by `/api/bottlenecks/worklist?team=design`.

The emailed worklists are already computed. What is missing is an interactive
surface to work them from, and a way to point at specific deals.

## Non-goals

- No new metrics. `de-metrics` and `design-engineering-funnel` already cover
  reporting.
- No Vishtik API integration. The `send-plans-revision` and
  `design-project-closeout` skills own that.
- No changes to the digest emails or the bottleneck cron.
- No status-hygiene enforcement. The hub renders what HubSpot says. Bad
  `design_status` hygiene becomes *visible* here, not fixed — the existing
  `sub-counter-attribution` skill exists precisely because these drift.

## Architecture

Mirrors the P&I hub (`src/lib/pi-hub/`, `src/app/dashboards/pi-hub/`), which
is the proven in-house pattern for exactly this shape: config-driven status
lanes, a cached server-built queue, a queue rail plus detail pane.

```
src/lib/design-hub/
  types.ts        Tab, GroupKey, SubGroupKey, QueueItem, ProjectDetail
  config.ts       TAB_CONFIGS — status property + status→group map per tab
  access.ts       flag + role gates
  queue.ts        parameterized queue fetch (ported from pi-hub/queue.ts)
  leads.ts        design-lead resolution
  assignments.ts  DesignAssignment read/write
src/app/api/design-hub/
  queue/route.ts            GET  ?tab=design|da
  project/[dealId]/route.ts GET  detail payload
  status/route.ts           POST status write-back
  assignments/route.ts      GET  mine  |  POST create
  assignments/[id]/route.ts PATCH clear
src/app/dashboards/design-hub/
  page.tsx, DesignHubClient.tsx, Queue.tsx, ProjectDetail.tsx,
  AssignDialog.tsx, panels/
```

Two tabs are two `TabConfig` entries differing only in `statusProperty` and
their status→group map — structurally identical to how pi-hub's permit / ic /
pto tabs differ. The one genuinely new mechanic is **sub-grouping** (the two
revision lanes split five ways), which pi-hub has no equivalent of.

### Tab 1 — Design (`design_status`)

| Group key | Label | HubSpot values |
|---|---|---|
| `idr` | IDR | `Initial Review` |
| `fdr` | FDR | `Ready for Review`, `DA Approved` |
| `revisions_needed` | Revisions Needed | see sub-groups |
| `revisions_in_progress` | Revisions In Progress | see sub-groups |
| `other` | Other | catch-all, everything non-terminal not above |

Sub-groups, applied to both revision lanes:

| Sub-group | Revisions Needed | Revisions In Progress |
|---|---|---|
| `da` | `Revision Needed - DA Rejected` | `DA Revision In Progress` |
| `permit` | `Revision Needed - Rejected by AHJ` | `Permit Revision In Progress` |
| `utility` | `Revision Needed - Rejected by Utility` | `Utility Revision In Progress` |
| `as_built` | `Revision Needed - Rejected` | `As-Built Revision In Progress` |
| `idr` | `IDR Revision Needed` | `IDR Revision in Progress` |

`Other` therefore holds: `Ready for Design`, `In Progress`, `Draft Complete`,
`Submitted To Engineering`, `Needs Clarification` (+ from Customer / Sales /
Operations), `Pending Resurvey`, `On Hold`, `New Construction - Design
Needed` / `- In Progress` / `- Ready for Review`, `Xcel - Design Needed` /
`- In Progress`, and the five `(Archived)` statuses.

**Terminal** (excluded from the queue entirely): `Complete`, `DA Revision
Completed`, `Permit Revision Completed`, `Utility Revision Completed`,
`As-Built Revision Completed`, `IDR Revision Complete`, `No Design Needed`,
`New Construction - Design Completed`, `Xcel - Site Plan & SLD Completed`.

Archived statuses are deliberately in `other` rather than terminal: a deal
still sitting on a dead status should be visible, not silently gone.

### Tab 2 — Design Approval (`layout_status`)

All 14 values are placed; no catch-all is needed.

| Group key | Label | HubSpot values |
|---|---|---|
| `send` | Send | `Ready`, `Pending Review`, `Draft Created`, `Revision Returned From Design` |
| `waiting_info` | Waiting on Info | `Needs Clarification`, `Pending Sales Changes`, `Pending Ops Changes`, `Pending Design Changes`, `Pending Resurvey` |
| `follow_up` | Follow Up With Customer | `Sent to Customer`, `Resent For Approval` |
| `rejection_revision` | Rejection/Revision | `Design Rejected`, `In Revision` |

**Terminal:** `Design Approved`.

A deal may legitimately appear in both tabs — they track different properties
and different loops. Within a tab, every deal appears exactly once.

### Tab 3 — Assigned to me

`DesignAssignment` rows for the signed-in user, newest first, each rendering
the deal row plus the assigner's note and due date.

## UI

Layout is the pi-hub two-column shell: a 420px queue rail (tab strip, search,
location and lead `MultiSelectFilter`s, grouped rows) beside a detail pane.
`SessionHeader` carries the user, queue freshness, and a "touched today" count.

Queue rail specifics:

- Group tabs render in config order; a group with no rows hides its tab, as
  pi-hub does. Sub-grouped lanes (both revision lanes) render five labelled
  sections *inside* the lane rather than as separate tabs — five more tabs
  would blow the 420px strip past its width and wrap it.
- A row carrying an open assignment shows an "Assigned" pill with the
  assignee's first name; in the Assigned-to-me tab the note renders inline.
- Rows show name, address, status label, `daysInStatus`, lead, and stale
  styling above `STALE_THRESHOLD_DAYS`.

Detail pane panels, trimmed from pi-hub's seven to what design coordinators
actually use:

| Panel | Contents |
|---|---|
| Overview | deal facts, system size, stage, lead, PM, HubSpot + Drive links |
| Design Files | `design_documents` / `design_folder_url` folder links |
| Revisions | `revision_counter` and the four sub-counters, with `total_revision_count` mismatch flagged |
| Activity | recent emails, calls, notes, tasks |
| Status History | `design_status` and `layout_status` timelines together |

The Revisions panel surfaces the counter mismatch that
`sub-counter-attribution` exists to repair — the hub is where a coordinator
would first notice it, so it is shown rather than hidden.

`StatusDropdown` writes the **current tab's** status property only, offering
every non-terminal value of that property plus its terminal values. It does not
attempt to restrict transitions: HubSpot itself does not enforce a design
status machine, and a client-side allowlist would block legitimate corrections.

React Query keys follow the `queryKeys.piHub` shape — a `queryKeys.designHub`
block with `queue(tab)`, `project(tab, dealId)`, `assignments()`, and
`todayCount()`.

## Data model

```prisma
model DesignAssignment {
  id            String    @id @default(cuid())
  dealId        String
  assigneeEmail String
  assignedBy    String
  note          String?
  dueDate       DateTime?
  clearedAt     DateTime?
  clearedBy     String?
  createdAt     DateTime  @default(now())

  @@index([assigneeEmail, clearedAt])
  @@index([dealId])
}
```

App-local by decision (Zach, 2026-07-22) — no HubSpot task is created. Cheap,
no CRM clutter; the tradeoff accepted is that assignments are invisible
outside the hub.

**Clearing is manual only.** If `design_status` moves while an assignment is
open, the row shows a "status moved" hint and the assignment stays open.
Auto-clearing on status change would silently eat asks that a HubSpot workflow
flipped, which is the failure mode most likely to erode trust in the lane.

Assignment targets come from the static `DESIGN_LEADS` roster, not a User-table
query — three people, and a wrong name here misassigns real work.

## Data flow

Queue build per tab, ported from `lib/pi-hub/queue.ts`:

1. HubSpot deal search: `pipeline IN INCLUDED_PIPELINES`, tab status property
   `HAS_PROPERTY` and `NOT_IN` terminal, `dealstage NOT_IN EXCLUDED_STAGES`.
   Paginated with the `after` cursor, capped at 10 pages, cap hit logged not
   silently truncated.
2. Parallel resolution: `buildOwnerMap` (already resolves the `design` enum
   property — it is in that function's `ENUM_PROPS`), `buildStageDisplayMap`,
   `fetchStatusEnteredAt` for real time-in-status, `getEnumLabelMap` for
   value→label.
3. Map to `QueueItem` with `group` and `subGroup` computed server-side, sorted
   stalest-first with unknown-entry-time rows last.

`daysInStatus` comes from status history via `fetchStatusEnteredAt`, never
`hs_lastmodifieddate` — a calc-property loop re-stamps that daily and every
row would compute to 0 days.

Caching mirrors pi-hub exactly: `appCache` keyed `design-hub:queue:{tab}`,
2 min TTL / 15 min stale, stale-while-refresh, with in-flight coalescing so a
cold instance does not stampede HubSpot.

Assignments are joined onto the queue payload **per request, after cache
retrieval** — never baked into the cached build. Same reasoning as pi-hub's
approval-signal join: the queue cache serves stale data for up to 15 minutes,
and an assignment badge baked in would survive a clear for that whole window.

## Access control

- Flag `DESIGN_HUB_ENABLED` (server) / `NEXT_PUBLIC_DESIGN_HUB_ENABLED`
  (client), matching the pi-hub split.
- Roles: `ADMIN`, `EXECUTIVE`, `DESIGN`, `TECH_OPS`.
- Page is `export const dynamic = "force-dynamic"` — a flag-read page that
  prerenders will 404 once the flag flips on.
- `/api/design-hub` must be added to every allowed role's `allowedRoutes` in
  `lib/roles.ts`, and `/dashboards/design-hub` likewise. Omitting this yields a
  silent 403 with no UI signal.
- Assignment writes: any allowed role may assign. `assignedBy` is taken from
  the session, never the request body.
- `PATCH /assignments/[id]` authorizes on assignee-or-assigner only, so one
  designer cannot clear another's work.

## Error handling

- HubSpot search failures propagate as 500 with a Sentry capture; the client
  shows the stale cached queue if one exists rather than an empty state.
- A tab whose status property returns nothing renders an empty-lane message,
  not a spinner.
- Assignment create is rejected if an open (`clearedAt IS NULL`) assignment
  already exists for the same `dealId` + `assigneeEmail`, so double-assigning
  cannot produce duplicate rows.
- Status write-back reuses the pi-hub `SetStatusResult` shape: hard failures
  fail the request, non-fatal post-write problems return as `warnings`.

## Testing

- `design-hub-config.test.ts` — the load-bearing test. `other` is a catch-all,
  so "every value maps somewhere" is trivially true and worthless. Assert
  instead: (a) the explicit group maps are pairwise disjoint, so no status
  lands in two lanes; (b) mapped values and terminal values do not intersect;
  (c) every value in the explicit maps and terminal lists actually exists in
  `deal-status-labels.ts`, catching a typo'd status that silently never
  matches; (d) for the DA tab specifically, mapped ∪ terminal covers all 14
  values exactly, since that tab has no catch-all to absorb a miss.
- `design-hub-queue.test.ts` — grouping and sub-grouping from fixture deals;
  stalest-first ordering; null `daysInStatus` sorts last.
- `design-hub-assignments.test.ts` — duplicate-open-assignment rejection;
  clear authorization (assignee and assigner yes, third party no); the
  "status moved" hint fires without clearing.
- `design-hub-access.test.ts` — flag off yields 404; disallowed role yields
  403.

## Migration

The `DesignAssignment` migration is additive and written as a file only. It is
**not applied** as part of this work — per project convention, migrations are
run manually by Zach.

## Open items, deliberately deferred

- `Submitted To Engineering` sits in `other` because its real-world meaning is
  unconfirmed. Promoting it to its own lane is a one-line config change.
- Whether coordinators need an aging view of deals sitting at Vishtik. Folded
  into `other` for now; `daysInStatus` is already on every row if it turns out
  to matter.
