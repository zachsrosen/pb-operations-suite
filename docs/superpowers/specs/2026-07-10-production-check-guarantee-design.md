# Production Guarantee Fix Verification & Approval ("Production Check") — Design

**Date:** 2026-07-10
**Source:** 7/10 meeting, Zach / Jessica Blanchard (service lead)
**Status:** Approved by Zach 2026-07-10 (all open items resolved below)
**Related:** #829 production-issue triage config (2026-06-21), Photon Advantage production guarantee

## Problem

When a production issue is confirmed on a completed system (e.g. ~1 year post-install
underproduction under the Photon Advantage guarantee), service currently sends the repair
work straight to Vishtik (external design vendor). Money gets committed to a planset before
anyone at PB has verified the proposed fix is right, and before design and service agree
it should happen at all.

## Goal

Insert two gates between "production issue identified" and "work goes to Vishtik":

1. **Design verification** — a PB designer verifies (or finds) the proposed solution first.
2. **Service approval** — Jessica gets a simple binary yes/no. Yes proceeds to Vishtik;
   No sends it back to design with a reason.

Jessica's words: *"a task on the job that tells you to go press yes or no."* Explicitly
**not** a PandaDoc — one button, no document signing.

## Non-goals (this build)

- **No cost calculator.** Matt's company-cost estimate (labor hours + panel counts →
  approximate cost) is a separate follow-up. The data model reserves fields for it so it
  slots into the approval card later without a migration redesign.
- **No automatic trigger.** Kickoff is manual for now (a human confirms the production
  issue and starts the check). The upstream tag-triggered triage (#829) is unchanged.
- **No direct Vishtik API call.** There is no Vishtik API integration in this codebase;
  "send to Vishtik" today is a human/skill-driven step (the send-plans-revision skill
  processes HubSpot "Send Plans" tasks). Approval produces that task; it does not message
  Vishtik itself.
- **No changes to the existing production-issues install view or the #829 HubSpot triage
  workflow.**

## Why not the Admin Workflow Builder

Considered and rejected as the substrate:

- Its editor, API (`/api/admin/*`), and run surfaces are **admin-only**; Jessica is SERVICE
  and could never reach an approval step hosted there.
- The Inngest executor is **linear** — control flow is `delay` / `stop-if` / `parallel` /
  `for-each`. This flow needs *wait for a human decision* and *loop back to design on
  rejection*, neither of which exists; building generic wait-for-event + goto primitives is
  far more machinery than the feature needs.

Instead this follows the established house pattern (RTB-Blocked PM review gate, internal
rejection, PE doc tracker): **app-side state machine + HubSpot tasks as the notification
surface + a one-click app action that records the decision.**

## Flow

```
Production issue confirmed (manual — service or design)
        │  "Start production check" (app button)
        ▼
  DESIGN_REVIEW ──────────── HubSpot task → designer:
        │                     "Verify production fix solution — {deal}"
        │  designer submits proposed solution (app form)
        ▼
  PENDING_APPROVAL ────────── HubSpot task → Jessica:
        │                     "Production fix approval — press Yes or No — {deal}"
        │                     (task body links to the approval card)
        ├─ YES ─▶ APPROVED ── HubSpot task → designer/Zach:
        │                     "Send Plans — production fix — {deal}"
        │                     (feeds the existing send-plans-to-Vishtik process)
        └─ NO ──▶ back to DESIGN_REVIEW (reason required; new designer task;
                  cycle counter increments)
```

Each transition auto-completes the task it supersedes (via `markTaskComplete`), so nobody
is left with a stale open task.

## Data model (Prisma — migration file only, never auto-applied)

```prisma
enum ProductionCheckStatus {
  DESIGN_REVIEW      // waiting on designer to verify/propose the fix
  PENDING_APPROVAL   // waiting on service lead yes/no
  APPROVED           // yes — Send Plans task created
  CANCELLED          // withdrawn (issue resolved another way)
}

model ProductionCheckRequest {
  id                String                @id @default(cuid())
  hubspotDealId     String                // the completed-project deal
  dealName          String?               // snapshot for display
  zuperJobUid       String?               // optional link to the service job
  hubspotTicketId   String?               // optional link to the service ticket
  status            ProductionCheckStatus @default(DESIGN_REVIEW)

  issueSummary      String                // what's wrong (entered at kickoff)
  proposedSolution  String?               // designer's verified fix
  designerEmail     String?               // who submitted the solution
  solutionSubmittedAt DateTime?

  decidedByEmail    String?               // who pressed yes/no
  decidedAt         DateTime?
  rejectionReason   String?               // last "No" reason
  designCycles      Int                   @default(1) // increments on each No

  // Reserved for the Photon Advantage cost calculator (separate follow-up).
  estimatedCostCents Int?
  costBreakdown      Json?

  // HubSpot task ids, so transitions can auto-complete superseded tasks.
  designTaskId      String?
  approvalTaskId    String?
  sendPlansTaskId   String?

  createdByEmail    String
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt

  @@index([status])
  @@index([hubspotDealId])
}
```

One row per production check; rejection reuses the row (new design cycle) so the full
history of a single issue stays in one place. Transitions are also logged to the existing
`ActivityLog` for audit.

## API (all under `/api/service/production-check` — SERVICE's existing `/api/service`
prefix already covers it for Jessica)

| Route | Method | Who | Does |
|---|---|---|---|
| `/api/service/production-check` | GET | all flow roles | List requests (filter by status/deal) |
| `/api/service/production-check` | POST | SERVICE, PM, OPS_MGR, ADMIN, OWNER | Kick off: create row + designer HubSpot task |
| `/api/service/production-check/[id]/solution` | POST | DESIGN, TECH_OPS, ADMIN, OWNER | Designer submits/updates proposed solution → PENDING_APPROVAL; completes design task; creates approval task |
| `/api/service/production-check/[id]/decide` | POST | SERVICE, ADMIN, OWNER (approvers) | `{decision: "yes"}` → APPROVED + Send Plans task; `{decision: "no", reason}` → back to DESIGN_REVIEW + new designer task |
| `/api/service/production-check/[id]/cancel` | POST | creator roles + ADMIN/OWNER | CANCELLED; completes any open task |

In-route role checks enforce the "who" column (middleware only gates the route prefix).

**Role allowlist changes (`src/lib/roles.ts`)** — prefix matching means one entry covers
all sub-routes:
- `/api/service/production-check` added to **DESIGN**, **TECH_OPS**, and any other role in
  the "who" column that lacks an `/api/service` prefix today (verify each at build time).
- `/dashboards/production-issues` added to **SERVICE** (Jessica currently can't reach the
  page that hosts the UI — PM/TECH_OPS/DESIGN/INTELLIGENCE have it, SERVICE doesn't).

## Task assignment

- **Designer task** → the deal's `design` owner property (the existing Design Lead
  rotation, same as the #829 triage decision — no new rotation infra). Fallback: a
  configurable default designer email.
- **Approval task** → the service-lead approver, configured via `SystemConfig`
  (key `production_check_approver_email`), not hardcoded. Set to Jessica's account at
  rollout after verifying her email in the User table / HubSpot owners.
- **Send Plans task** → same assignee pattern as existing "Send Plans" tasks (verify the
  current owner of those tasks at build time), subject prefixed so the send-plans-revision
  skill and humans can find it: `Send Plans — production fix — {deal}`.

All tasks are created with `lib/hubspot-tasks.ts` `createTask` (owner resolved via
`resolveOwnerIdByEmail`), associated to the deal, with a body linking to the app card.
Tasks surface in HubSpot and in `/dashboards/my-tasks` (every role has it).

## UI

Hosted on the existing **`/dashboards/production-issues`** page (already the home for
production issues) as a new **"Production Checks"** section/tab alongside the current
install view:

- **List**: all non-cancelled requests, status chip (Design Review / Awaiting Approval /
  Approved), deal link, cycle count, age.
- **Kickoff**: "Start production check" button → small form (deal search, issue summary,
  optional Zuper job / ticket link).
- **Designer card** (visible to DESIGN/TECH_OPS/admins on DESIGN_REVIEW rows): textarea
  for the proposed solution + "Submit for approval".
- **Approval card** (visible to approver roles on PENDING_APPROVAL rows): the issue
  summary + designer's proposed solution, then two big buttons — **Yes, proceed** and
  **No, back to design** (reason required on No). A `ConfirmDialog` on Yes since it
  triggers spend. A visibly-reserved (empty for now) "Estimated cost" slot on this card
  is where the future calculator output lands.

No feature flag: the trigger is manual and the page section is additive; nothing fires
without a human starting it.

## Testing (TDD)

- State-machine unit tests: legal/illegal transitions, cycle increment on No, reason
  required on No, task-id bookkeeping per transition.
- API route tests: role gating per route (403 for wrong roles), happy paths, idempotent
  double-submit handling (deciding an already-decided request → 409).
- Task-creation lib mocked; assert subjects/assignees/associations and that superseded
  tasks are completed.
- Follow existing patterns in `src/__tests__/` for API + lib tests.

## Files touched

- `prisma/schema.prisma` + new migration file (NOT applied — Zach runs migrations)
- `src/lib/production-check.ts` (state machine + task orchestration)
- `src/app/api/service/production-check/route.ts` + `[id]/solution|decide|cancel/route.ts`
- `src/app/dashboards/production-issues/page.tsx` (new section) + a
  `ProductionCheckPanel` component
- `src/lib/roles.ts` (allowlist additions above)
- `src/__tests__/production-check*.test.ts`

## Decisions (Zach, 2026-07-10)

1. **Approver**: Jessica via SystemConfig, with ADMIN/OWNER as backup approvers.
2. **Send Plans task assignee**: the deal's design lead (`design` owner property).
3. **Designer assignee**: the deal's `design` Design Lead rotation (matches #829).
4. **UI home**: section on the `/dashboards/production-issues` page.
