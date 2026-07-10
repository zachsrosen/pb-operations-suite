# Production Check Guarantee Workflow — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production-guarantee fix verification: designer verifies the proposed solution, Jessica presses Yes/No, Yes creates the Send Plans (Vishtik) task, No loops back to design.

**Architecture:** App-side state machine (`ProductionCheckRequest` Prisma model + `lib/production-check.ts`) with HubSpot tasks as the notification surface (created/completed via `lib/hubspot-tasks.ts`). API under `/api/service/production-check` (SERVICE prefix already allowlisted); UI is a new panel on `/dashboards/production-issues`. Spec: `docs/superpowers/specs/2026-07-10-production-check-guarantee-design.md`.

**Tech Stack:** Next.js App Router routes, Prisma (migration file only — NEVER run `prisma migrate`), Jest with module mocks, React Query.

**Verified facts (do not re-derive):**
- Middleware route matching is prefix-based: `pathname === allowed || pathname.startsWith(allowed + "/")` (`src/middleware.ts:269`).
- HubSpot deal property `design` = "Design Lead", owner-type (value is a HubSpot **owner ID**) — verified live 2026-07-10.
- `lib/hubspot-tasks.ts` exports `createTask(CreateTaskInput)` (`ownerId`, `subject`, `body`, `associate.dealId`), `markTaskComplete(taskId)`, and `resolveOwnerIdByEmail(email, displayName?, linkedOwnerId?): Promise<string | null>` — **null when the email isn't a HubSpot owner; every caller must handle it**.
- `getRuntimeConfig(key, envKeys)` (`src/lib/runtime-config-db.ts`) resolves env → `SystemConfig` row.
- In-route auth: `requireApiAuth()` from `src/lib/api-auth.ts` — returns `AuthenticatedUser` (`email`, `roles[]`) or a 401 `NextResponse` (check with `instanceof NextResponse`). Test mock precedent: `src/__tests__/api/rtb-review.test.ts`.
- Next 16 dynamic route handlers take `{ params }: { params: Promise<{ id: string }> }` and must `await params` (see `src/app/api/reviews/status/[id]/route.ts`).
- Baseline on origin/main: 93 pre-existing test failures / 4257 passing — final verification compares counts, not zero-failures.
- `ActivityLog.type` is the `ActivityType` enum — new values need a migration (precedent: `20260708150000_add_bot_message_sent_activity_type`).

---

## Chunk 1: Data model + state machine lib

### Task 1: Prisma schema + migration file

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260710120000_add_production_check_request/migration.sql`

- [ ] **Step 1:** Add to `schema.prisma` (Workflows section, near `SurveyInvite`):

```prisma
enum ProductionCheckStatus {
  DESIGN_REVIEW
  PENDING_APPROVAL
  APPROVED
  CANCELLED
}

model ProductionCheckRequest {
  id                  String                @id @default(cuid())
  hubspotDealId       String
  dealName            String?
  zuperJobUid         String?
  hubspotTicketId     String?
  status              ProductionCheckStatus @default(DESIGN_REVIEW)

  issueSummary        String
  proposedSolution    String?
  designerEmail       String?
  solutionSubmittedAt DateTime?

  decidedByEmail      String?
  decidedAt           DateTime?
  rejectionReason     String?
  designCycles        Int                   @default(1)

  // Reserved for the Photon Advantage cost calculator (future follow-up).
  estimatedCostCents  Int?
  costBreakdown       Json?

  designTaskId        String?
  approvalTaskId      String?
  sendPlansTaskId     String?

  createdByEmail      String
  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @updatedAt

  @@index([status])
  @@index([hubspotDealId])
}
```

Also append `PRODUCTION_CHECK` to `enum ActivityType`.

- [ ] **Step 2:** Write the migration SQL by hand (CREATE TYPE "ProductionCheckStatus", CREATE TABLE "ProductionCheckRequest" matching the model incl. indexes, `ALTER TYPE "ActivityType" ADD VALUE 'PRODUCTION_CHECK'`). Match column/casing conventions from a recent migration (e.g. `20260709010000_add_idr_escalation_photo`).
- [ ] **Step 3:** `npx prisma generate` — must succeed. Run `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma` only if available; otherwise eyeball SQL vs model. **Do NOT run `prisma migrate deploy/dev`.**
- [ ] **Step 4:** Commit: `feat(production-check): add ProductionCheckRequest model + migration file`

### Task 2: `lib/production-check.ts` state machine (TDD)

**Files:**
- Create: `src/lib/production-check.ts`
- Test: `src/__tests__/production-check.test.ts`

Public API (all functions take a `viewerEmail` and log to `ActivityLog` with `type: "PRODUCTION_CHECK"`, `entityType: "deal"`, `entityId: hubspotDealId`):

```ts
createProductionCheck({ dealId, issueSummary, zuperJobUid?, hubspotTicketId?, createdByEmail })
// fetch deal (dealname, design) via hubspotClient basicApi.getById
// designer ownerId = deal.design; if blank, fall back to
//   getRuntimeConfig("production_check_default_designer_email",
//     ["PRODUCTION_CHECK_DEFAULT_DESIGNER_EMAIL"]) → resolveOwnerIdByEmail
//   (spec: "fallback: a configurable default designer email")
// create row; if an ownerId resolved → createTask designer task, save designTaskId
// subject: `Verify production fix solution — ${dealName}`
// body links to https://pbtechops.com/dashboards/production-issues
// returns { request, warning?: "no-designer-task" } when neither source resolves

submitSolution({ id, proposedSolution, designerEmail })
// guard status === DESIGN_REVIEW else throw ProductionCheckStateError (→409)
// set PENDING_APPROVAL, stamp solutionSubmittedAt/designerEmail
// markTaskComplete(designTaskId) if set (swallow+log HubSpot errors)
// approver = getRuntimeConfig("production_check_approver_email", ["PRODUCTION_CHECK_APPROVER_EMAIL"])
// resolveOwnerIdByEmail(approver) → createTask approval task, save approvalTaskId
// subject: `Production fix approval — press Yes or No — ${dealName}`

decide({ id, decision: "yes" | "no", reason?, decidedByEmail })
// guard status === PENDING_APPROVAL else ProductionCheckStateError
// yes → APPROVED; complete approvalTaskId; createTask Send Plans task to the
//   deal's design lead (re-fetch deal.design), subject
//   `Send Plans — production fix — ${dealName}`, save sendPlansTaskId
// no → reason required (throw ProductionCheckValidationError if blank);
//   status DESIGN_REVIEW, designCycles+1, rejectionReason; complete
//   approvalTaskId; new designer task `Rework production fix solution — ${dealName}`
//   (reason in body), overwrite designTaskId

cancelProductionCheck({ id, cancelledByEmail })
// guard status is DESIGN_REVIEW | PENDING_APPROVAL; complete whichever task is open
```

Cross-cutting: the decide-"no" re-task path uses the same designer-resolution chain as create (deal `design` → default-designer config). All HubSpot task writes go through one internal helper that no-ops (with a log line) when `PRODUCTION_CHECK_TASKS_DISABLED=1` — dev/preview safety valve used by Task 5 Step 4.

- [ ] **Step 1:** Write failing tests (mock `@/lib/db` prisma, `@/lib/hubspot-tasks`, `@/lib/hubspot`, `@/lib/runtime-config-db`). Cases:
  - create: row created with DESIGN_REVIEW, designer task to `deal.design` owner id, dealName snapshot; no `design` owner → falls back to configured default-designer email; neither source → no task + warning.
  - submitSolution: happy path transitions + completes design task + creates approval task to resolved approver; wrong status → ProductionCheckStateError; missing approver config → row still transitions, warning returned, no task (don't block the flow on config); approver config set but `resolveOwnerIdByEmail` returns null → same transition-succeeds + warning path.
  - decide yes: APPROVED, approval task completed, Send Plans task created to design lead.
  - decide no: reason required; DESIGN_REVIEW again, designCycles 1→2, new designer task with reason in body.
  - decide on APPROVED row → ProductionCheckStateError (double-submit).
  - cancel from each legal state; cancel APPROVED → error.
  - markTaskComplete failure does NOT fail the transition (logged warning).
- [ ] **Step 2:** `npx jest src/__tests__/production-check.test.ts` — expect FAIL (module not found).
- [ ] **Step 3:** Implement `src/lib/production-check.ts`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit: `feat(production-check): state machine + HubSpot task orchestration`

## Chunk 2: API routes + role allowlist

### Task 3: API routes (TDD)

**Files:**
- Create: `src/app/api/service/production-check/route.ts` (GET list, POST create)
- Create: `src/app/api/service/production-check/[id]/solution/route.ts` (POST)
- Create: `src/app/api/service/production-check/[id]/decide/route.ts` (POST)
- Create: `src/app/api/service/production-check/[id]/cancel/route.ts` (POST)
- Test: `src/__tests__/api/production-check.test.ts`

Auth: `requireApiAuth()` at the top of every handler (`instanceof NextResponse` → return it). `[id]` handlers use the Next 16 signature `{ params }: { params: Promise<{ id: string }> }` + `await params`.

In-route gates (middleware only checks the prefix):
- POST create: roles ∩ {SERVICE, PROJECT_MANAGER, OPERATIONS_MANAGER, ADMIN, OWNER}
- POST solution: roles ∩ {DESIGN, TECH_OPS, ADMIN, OWNER}
- POST decide: session email equals configured approver email (case-insensitive) OR roles ∩ {ADMIN, OWNER}  ← decision #1
- POST cancel: creator email match OR roles ∩ {SERVICE, PROJECT_MANAGER, OPERATIONS_MANAGER, ADMIN, OWNER} (matches the spec's "creator roles + ADMIN/OWNER")
- GET list: any session that middleware let through; response includes `viewer: { canCreate, canSubmitSolution, canDecide }` so the UI renders the right buttons without duplicating gate logic client-side. **YAGNI cut (deliberate):** the spec's list filter-by-status/deal params are dropped — low-volume table, client hides CANCELLED; revisit if volume grows.

Error mapping: `ProductionCheckStateError` → 409, `ProductionCheckValidationError` → 400, not found → 404, gate fail → 403.

- [ ] **Step 1:** Failing tests (mock `@/lib/api-auth` and `@/lib/production-check`; follow `src/__tests__/api/rtb-review.test.ts` shape — its `requireApiAuth` mock returns `{ email, roles }`). Cover each gate (allowed role, denied role), decide-as-approver-email, decide-as-ADMIN, 409 passthrough, no-reason 400.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement routes. **Step 4:** PASS.
- [ ] **Step 5:** Commit: `feat(production-check): API routes with role gating`

### Task 4: roles.ts allowlist

**Files:**
- Modify: `src/lib/roles.ts`
- Test: extend `src/__tests__/api/production-check.test.ts` (or a small `production-check-roles.test.ts`) importing `src/lib/roles.ts` definitions

- [ ] **Step 1:** Failing assertions: every role listing `/dashboards/production-issues` also reaches `/api/service/production-check` (via `/api/service` prefix or explicit entry); SERVICE contains `/dashboards/production-issues`.
- [ ] **Step 2:** Add `"/dashboards/production-issues"` to SERVICE. Add `"/api/service/production-check"` to DESIGN, TECH_OPS, and INTELLIGENCE **iff** they lack an `/api/service` prefix (check PROJECT_MANAGER/OPERATIONS_MANAGER too — add if missing).
- [ ] **Step 3:** PASS. **Step 4:** Commit: `feat(production-check): role allowlist entries`

## Chunk 3: UI

### Task 5: ProductionCheckPanel + page integration

**Files:**
- Create: `src/app/dashboards/production-issues/ProductionCheckPanel.tsx`
- Modify: `src/app/dashboards/production-issues/page.tsx` (render panel above/below existing list)

Panel behavior (theme tokens only, `MultiSelectFilter` not needed):
- React Query `GET /api/service/production-check`; list rows: deal link (HubSpot URL), status chip (Design Review amber / Awaiting Approval cyan / Approved green), cycle count when >1, age, issue summary; CANCELLED hidden by default.
- `viewer.canCreate` → "Start production check" button → inline form: deal ID (plus name lookup if an existing deal-search endpoint is trivially reusable — check `/api/deals`; otherwise plain deal-ID input), issue summary textarea, optional Zuper job UID / ticket ID.
- `viewer.canSubmitSolution` + row in DESIGN_REVIEW → proposed-solution textarea + "Submit for approval".
- `viewer.canDecide` + row in PENDING_APPROVAL → show designer's solution, reserved "Estimated cost — coming soon" slot, and two buttons: **Yes, proceed** (wrap in `ConfirmDialog` — it commits spend) and **No, back to design** (reason textarea required).
- Cancel affordance: small "Cancel" action on DESIGN_REVIEW / PENDING_APPROVAL rows for viewers who can create (server enforces the real gate), with `ConfirmDialog`.
- Mutations invalidate the list query; surface API errors via ToastContext.

- [ ] **Step 1:** Build panel. **Step 2:** Wire into page. **Step 3:** `npx tsc --noEmit` + `npm run lint` clean.
- [ ] **Step 4:** Verify in dev browser preview with `PRODUCTION_CHECK_TASKS_DISABLED=1` set — Task 2 must implement this env guard in the task-orchestration layer (skip all `createTask`/`markTaskComplete` calls, log "[production-check] task writes disabled"). This makes the full kickoff → submit → yes/no round trip safe against the real HubSpot portal with zero task noise. State transitions + ActivityLog verified in the local DB/UI; task-creation behavior itself is covered by the Task 2 unit tests.
- [ ] **Step 5:** Commit: `feat(production-check): production-issues dashboard panel`

## Chunk 4: Verification

### Task 6: Full pass

- [ ] `npx tsc --noEmit` project-wide; `npm run lint`; `npm test` (full suite, compare against baseline).
- [ ] Self-review with pb-code-reviewer + pb-security-reviewer agents (auth on every route, no secrets, HubSpot retry wrappers used).
- [ ] Update spec status line if anything drifted; note rollout steps (set `production_check_approver_email` SystemConfig to Jessica's **verified** User-table email — never guessed; Zach runs the migration per house rule).

**Rollout (not in this build):** migration applied by Zach (`prisma migrate deploy` manually), SystemConfig approver set, announce to Jessica + design leads.
