# On-Call Electrician Rotations — Design Spec

**Date:** 2026-04-20
**Status:** Draft — pending implementation plan
**Owner:** Zach Rosen
**Home:** Executive Suite (v1) — revisit placement once feature is live

## Problem

After-hours service calls land on whichever electrician is on-call. Today the rotation lives informally in spreadsheets and texts, which creates four recurring problems:

1. **Ambiguity** — "who's on tonight?" is hard to answer at a glance.
2. **No forward visibility** — nobody can see their shifts 3 months out to plan life around.
3. **Manual swap coordination** — PTO and swap requests happen over text without a paper trail.
4. **No workload visibility** — weekends and holidays cluster on individuals without anyone noticing.

This spec describes a first version: a rotation calendar with self-service swap/PTO proposals, admin approval, workload tracking, and exports. It does NOT cover on-call pay tracking, callout logging, or automatic ticket-to-electrician dispatch — those are follow-ups.

## Rotation Structure

**Three independent daily rotations.** Each pool has a fixed ordered list of electricians; the rotation cycles through them one day at a time and wraps at the end.

| Pool | Members | Shift Window |
|------|---------|--------------|
| 🌴 California | Nick, Lucas, Charlie, Ruben | 5:00 PM PT → 7:00 AM PT next day |
| 🏔 Denver | Adolphe, Chris K, Chad, Nathan, Rich, Alan, Olek, Gaige, Paul, Jeremy | 5:00 PM MT → 7:00 AM MT next day |
| ⛰ Southern CO | Alex, Lenny, Ro, Josh H, Jerry, Tom, Christian W, Terrell | 5:00 PM MT → 7:00 AM MT next day |

- **Generation rule (v1):** strict round-robin. Day N's on-call = `pool.members[(cycleStartIndex + N) % pool.members.length]`. Simple, predictable, and over ~2 cycles weekend/holiday load evens out naturally. Auto-balance is a deferred v2 feature.
- **Inactive electricians** are skipped in the rotation but kept in the pool list for history.
- **New electricians** are appended to the end of the rotation order and inserted into the cycle on the next pool-edit-published moment.

## User Surfaces

### 1. Main Dashboard — "Tonight across all 3 regions"

Route: `/dashboards/on-call` (or under `/suites/executive/on-call` — TBD in implementation plan).

- **Hero strip:** three region cards side-by-side. Each card shows region name, tonight's on-call electrician (large), phone number, shift window, and three inline buttons: Call, Text, Swap.
- **14-day lookahead grid:** horizontal strip below hero. One row per rotation. Today outlined in orange, weekends tinted, PTO days shown in red with strikethrough on the original assignee.
- **Color coding** (consistent across all views): orange = California, blue = Denver, green = Southern CO.

### 2. Month View + Workload Sidebar

Route: `/dashboards/on-call/month`.

- **Controls:** region tabs, month navigation, action buttons (Block PTO, Regenerate, Export).
- **Calendar:** traditional 7-column month grid. One name per day cell. Weekends tinted. Today outlined. PTO days red with strikethrough. Swapped days marked with ↔. Federal holidays marked with ★.
- **Workload sidebar:** per-electrician stats for the displayed month — total days, weekend days, holiday days. Hot/cold shading when someone's overloaded or underused. An inline alert banner surfaces imbalance.
- **Upcoming PTO panel** below sidebar lists active blocks and who's covering.
- **Click a day** → opens the Day Actions drawer (next section).

### 3. Day Actions Drawer

Slide-in panel from right when admin clicks any day. Three tabs:

- **Swap tab:** Current assignee card with their month stats. Replacement list sorted by least-loaded first, with green "RECOMMENDED" tag on top. Each row shows name, status (available / adjacent-day conflict / PTO), and month stats. Unavailable people greyed and disabled. Optional reason field. Primary action: Confirm Swap.
- **Block PTO tab:** Date-range picker (defaults to single day). Auto-proposes reassignments from the pool. Reason field.
- **Notes tab:** Free-text note attached to the day (e.g., "major storm forecasted, brief the on-call").

All swaps and PTO reassignments are tracked in audit history with the reason, who approved, and when.

### 4. Electrician Mobile View

Route: `/dashboards/on-call/me` (auto-resolves to the logged-in user's electrician record).

- "Hey, {firstName} 👋" greeting.
- **Tonight status card:** either "You're on tonight" or "Not on-call tonight, {X} is covering".
- **Next shift card:** date, time window, days-away.
- **Upcoming list:** next 4–8 personal shifts. Shows "swap pending" if a swap request is in flight on that day.
- **Two primary actions:** Request Swap, Request PTO.
- **Request Swap flow:** pick one of your own days → pick the electrician to swap with → pick the day to swap to → optional reason → submit. Status becomes "waiting on {X}" until the counterparty accepts in their own phone view. Once both parties have accepted, it moves to admin approval queue.
- **Request PTO flow:** date range + reason → submit to admin queue directly (no counterparty needed).

### 5. Admin Approval Queue

Route: `/dashboards/on-call/approvals`.

- **Tabs:** Pending (count badge), Approved, Denied, All.
- **Cards:** one per request. Shows requester avatar, request type (swap / PTO), affected dates, reason, region, submitted-ago timestamp, and counterparty state (for swaps).
- **Urgency:** requests where the affected day is ≤ 72 hours out get a red border.
- **Actions:** Approve / Deny buttons inline. Approve is disabled for swaps still waiting on counterparty confirmation.
- **On approve:** assignments update, Google Calendar push fires, email notifications send to affected electricians.
- **On deny:** requester gets an email with the denial reason; assignments do not change.

### 6. Admin Setup

Route: `/dashboards/on-call/setup` — gated to ADMIN, OWNER, OPERATIONS_MANAGER.

- **Per-pool config cards:** rotation start date (anchors the cycle), shift window (start/end time + timezone), drag-reorder rotation order with active/inactive toggle per electrician, "Add Electrician to Pool" button (picks from existing CrewMember records with role = electrician).
- **Federal holidays list:** read-only display of the 11 federal holidays for the current year. Used for workload stats and the ★ marker. No PB-specific holidays in v1.
- **Export panel:** Google Calendar subscribe URL per pool, email monthly preview toggle, PDF download, CSV download.
- **Publish card:** shows last-published timestamp and range covered. "Publish Now" generates the next 3 months of assignments from today forward (preserving any existing approved swaps/PTO), pushes to Google Calendar, and sends monthly-preview email if enabled. Manual only — no scheduled auto-publish in v1.

## Data Model

Builds on the existing `CrewMember` / `CrewAvailability` / `AvailabilityOverride` tables. Adds four new Prisma models.

```prisma
model OnCallPool {
  id            String   @id @default(cuid())
  name          String   @unique // "California", "Denver", "Southern CO"
  region        String   // matches PB location group for display
  shiftStart    String   // HH:mm local, e.g. "17:00"
  shiftEnd      String   // HH:mm local, e.g. "07:00"
  timezone      String   // "America/Los_Angeles" or "America/Denver"
  startDate     String   // YYYY-MM-DD — cycle anchor
  isActive      Boolean  @default(true)
  members       OnCallPoolMember[]
  assignments   OnCallAssignment[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model OnCallPoolMember {
  id            String   @id @default(cuid())
  poolId        String
  pool          OnCallPool @relation(fields: [poolId], references: [id], onDelete: Cascade)
  crewMemberId  String
  crewMember    CrewMember @relation(fields: [crewMemberId], references: [id])
  orderIndex    Int      // position in rotation (0-based)
  isActive      Boolean  @default(true)  // inactive members skip in rotation
  addedAt       DateTime @default(now())
  @@unique([poolId, crewMemberId])
  @@index([poolId, orderIndex])
}

model OnCallAssignment {
  id            String   @id @default(cuid())
  poolId        String
  pool          OnCallPool @relation(fields: [poolId], references: [id])
  date          String   // YYYY-MM-DD in pool's local timezone
  crewMemberId  String
  crewMember    CrewMember @relation(fields: [crewMemberId], references: [id])
  source        String   // "generated" | "swap" | "pto-reassign" | "manual"
  originalCrewMemberId String? // set when source != "generated" — who was originally on this day
  sourceRequestId String? // OnCallSwapRequest.id or OnCallPtoRequest.id
  note          String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([poolId, date])
  @@index([crewMemberId, date])
}

model OnCallSwapRequest {
  id                     String   @id @default(cuid())
  poolId                 String
  requesterCrewMemberId  String   // "I'm giving up this day"
  requesterDate          String   // YYYY-MM-DD
  counterpartyCrewMemberId String // "...to this person"
  counterpartyDate       String   // YYYY-MM-DD (day requester will take in return)
  reason                 String?
  status                 String   // "awaiting-counterparty" | "awaiting-admin" | "approved" | "denied" | "cancelled"
  counterpartyAcceptedAt DateTime?
  reviewedByUserId       String?
  reviewedAt             DateTime?
  denialReason           String?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  @@index([poolId, status])
  @@index([requesterCrewMemberId])
}

model OnCallPtoRequest {
  id                String   @id @default(cuid())
  poolId            String
  crewMemberId      String
  startDate         String   // YYYY-MM-DD
  endDate           String   // YYYY-MM-DD (inclusive)
  reason            String?
  status            String   // "awaiting-admin" | "approved" | "denied" | "cancelled"
  reviewedByUserId  String?
  reviewedAt        DateTime?
  denialReason      String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@index([poolId, status])
  @@index([crewMemberId])
}
```

**Why these shapes:**

- `OnCallAssignment` is the source of truth for "who's on day X" — generated from the rotation cycle, but mutable via swaps/PTO. `source` + `sourceRequestId` preserve audit trail.
- `OnCallPoolMember` separates pool membership from `CrewMember` so we can add/remove from rotations without touching crew records. `orderIndex` drives the cycle.
- Swaps and PTO requests are separate tables because their state machines differ meaningfully (swap has counterparty state, PTO does not).
- All dates stored as `YYYY-MM-DD` strings in the pool's local timezone to avoid DST/timezone drift bugs. No `DateTime` for on-call day math.

## API Routes

All under `/api/on-call/`:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/on-call/assignments` | GET | Range query: `?poolId=&from=&to=` or `?from=&to=` (all pools). Used by dashboard + month views. |
| `/api/on-call/tonight` | GET | Current on-call across all pools. Powers hero strip. Cached 60s. |
| `/api/on-call/me` | GET | Assignments + upcoming shifts for logged-in user. |
| `/api/on-call/pools` | GET/POST | List/create pools. Admin only on write. |
| `/api/on-call/pools/[id]` | GET/PATCH/DELETE | Pool detail + update/delete. Admin only on write. |
| `/api/on-call/pools/[id]/members` | GET/POST/PATCH | Pool membership management (add, reorder, toggle active). Admin only on write. |
| `/api/on-call/pools/[id]/publish` | POST | Generate + persist next N months of assignments. Admin only. |
| `/api/on-call/swaps` | GET/POST | List swaps (filtered by status) / create new swap request. |
| `/api/on-call/swaps/[id]/accept` | POST | Counterparty accepts (moves to admin queue). |
| `/api/on-call/swaps/[id]/approve` | POST | Admin approves (applies assignments, fires notifications). |
| `/api/on-call/swaps/[id]/deny` | POST | Admin denies with reason. |
| `/api/on-call/pto` | GET/POST | List/create PTO requests. |
| `/api/on-call/pto/[id]/approve` | POST | Admin approves + proposes reassignments. |
| `/api/on-call/pto/[id]/deny` | POST | Admin denies with reason. |
| `/api/on-call/workload` | GET | `?poolId=&month=YYYY-MM` — per-electrician stats (days, weekends, holidays) for a month. |
| `/api/on-call/calendar/[poolId].ics` | GET | iCal subscribe feed per pool. Public URL with token in query. |
| `/api/on-call/export/pdf` | GET | PDF render of current month schedule. |
| `/api/on-call/export/csv` | GET | Raw CSV dump of assignments in a date range. |

**Middleware:** Every new `/api/on-call/*` path must be added to the allowlist in every role's `allowedRoutes` in `src/lib/roles.ts` (or silently returns 403). Admin-only routes are enforced at the handler level via session role check, not middleware.

## Rotation Generation Algorithm (v1)

```
function generateAssignments(pool, fromDate, toDate):
  activeMembers = pool.members.filter(m => m.isActive).sortBy(orderIndex)
  if activeMembers.length == 0: throw "no active members"

  anchor = pool.startDate
  daysSinceAnchor = daysBetween(anchor, fromDate)
  startIndex = daysSinceAnchor % activeMembers.length

  assignments = []
  for each date from fromDate to toDate:
    dayOffset = daysBetween(fromDate, date)
    memberIndex = (startIndex + dayOffset) % activeMembers.length
    assignments.push({ date, crewMemberId: activeMembers[memberIndex].id, source: "generated" })
  return assignments
```

**On Publish:** the handler runs this for each pool, diffs against existing assignments, and only writes net-new rows. Existing rows with `source != "generated"` (approved swaps, PTO reassignments) are preserved. Existing `source = "generated"` rows where the computed member has changed are overwritten (this happens when rotation order or membership changed since last publish).

**On Swap Approval:**

```
function applySwap(swap):
  swap two assignments:
    - pool/requesterDate → counterparty (source: "swap", sourceRequestId: swap.id, originalCrewMemberId: requester)
    - pool/counterpartyDate → requester (source: "swap", sourceRequestId: swap.id, originalCrewMemberId: counterparty)
  fire notifications to both parties
  push update to Google Calendar
```

**On PTO Approval:** admin sees a proposed reassignment list (derived by "next available active member in rotation order who isn't on-call adjacent or themselves on PTO that day"). Admin can override any slot. On approve, each affected day gets a new assignment with `source: "pto-reassign"`, and the PTO-requester's CrewAvailability is NOT touched (keep on-call separate from survey/install availability).

## Notifications

- **Swap proposed by requester** → email to counterparty: "Rich wants to swap with you — {dates}. Accept or decline."
- **Counterparty accepts** → email to admins (OPERATIONS_MANAGER, ADMIN, OWNER): "New swap awaiting approval."
- **Admin approves** → email to both parties: "Your swap is confirmed. New shifts: ..."
- **Admin denies** → email to requester: "Your swap was denied. Reason: ..."
- **PTO approved** → email to requester + all electricians picking up shifts: "PTO approved, {X} will cover {date}."
- **Publish run** → email to all electricians: "Monthly preview attached."

All emails use React Email templates in `src/emails/` (new templates required). Primary channel: Google Workspace. Fallback: Resend.

## Exports

- **Google Calendar subscribe URL:** `/api/on-call/calendar/[poolId].ics?token=<signed-token>`. One feed per pool. Events titled "On-Call: {Electrician Name}". Refreshes on every Publish or swap approval.
- **PDF:** server-rendered via `@react-pdf/renderer` (already in stack for BOM PDFs). One page per region for the month.
- **CSV:** columns = `date, pool, electrician, source, original_electrician, reason`. Date range parameterized.
- **Email monthly preview:** sent by Publish handler when enabled in pool config.

## Role Gating

| Action | Roles |
|--------|-------|
| View dashboard + month | ADMIN, OWNER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS, PROJECT_MANAGER |
| View own shifts (`/me`) | Any role where the user maps to a CrewMember in a pool |
| Propose swap / PTO | Electricians (CrewMember role = electrician with active User account) |
| Approve swap / PTO | ADMIN, OWNER, OPERATIONS_MANAGER |
| Edit pools / publish | ADMIN, OWNER |

Electrician identity resolves by matching the logged-in User's `email` against `CrewMember.email`. If no match, `/me` shows an empty state.

## Error Handling & Edge Cases

- **Empty pool** (no active members): Publish handler returns `409 Conflict` with a clear error. No assignments written.
- **Concurrent publishes:** use advisory lock keyed on `poolId` in Postgres. Second publish waits or returns `409`.
- **Swap collision:** if an electrician tries to swap into a day they're already on-call, the API returns `400` with "you're already on-call that day."
- **PTO overlap with existing PTO:** API returns `400`; electrician must cancel the existing PTO first.
- **Regenerate after rotation order change:** preserves swap/PTO-sourced assignments, overwrites only `source = "generated"` rows. Shows a diff preview in the admin UI before confirming.
- **Inactive electrician with future assignments:** when an admin toggles inactive, existing assignments are NOT auto-reassigned — they show a warning banner in the calendar and the admin is prompted to run Regenerate.

## Testing Strategy

- **Unit tests:** rotation generation algorithm (cycle math, leap days, timezone edges, inactive-member skip).
- **Integration tests:** swap lifecycle (request → accept → approve → assignments updated). PTO lifecycle (request → approve → reassignments applied).
- **Edge tests:** DST transition days (Nov 2 2025, Mar 8 2026), empty pool publish, concurrent publish, inactive electrician with future shifts.
- **Manual QA checklist:** visit every surface in both light and dark modes; verify mobile view on phone.

## Out of Scope (Follow-up Specs)

1. **On-call pay tracking** — standby hours + callout hours + pay rate calculations.
2. **Callout logging** — when an electrician gets called out, log the ticket ID + time + duration.
3. **Automatic dispatch** — when a service ticket comes in after-hours, surface who's on-call and offer one-click assign.
4. **Auto-balance generation (v2)** — rotation algorithm that actively avoids clustering weekends/holidays on one person.
5. **Company-specific holidays** — currently federal-only; could add PB-observed holidays later.
6. **Per-electrician preferences** — "I can't cover weekends" or "I prefer Mondays" constraints.

## Implementation Order (preview — plan will detail)

1. Data model + migrations (no code consumers yet).
2. Rotation generation library + unit tests.
3. Pool admin CRUD + UI at `/dashboards/on-call/setup`.
4. Publish endpoint + Google Calendar export.
5. Main dashboard + month view (read-only at first).
6. Day actions drawer + direct admin swap/PTO.
7. Electrician phone view + self-service propose.
8. Admin approval queue + notifications.
9. PDF / CSV / email exports.
10. Role allowlist wiring + E2E QA.

Each phase ships independently behind a feature flag (`ON_CALL_ROTATIONS_ENABLED`).
