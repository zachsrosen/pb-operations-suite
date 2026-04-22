# Admin Workflow Builder

**Status:** Phase 1 scaffolding in progress
**Date:** 2026-04-22
**Goal:** Give ADMIN users a HubSpot-style drag-and-drop workflow editor that composes **existing** PB Ops Suite integrations (HubSpot writes, Zuper writes, Zoho writes, email templates, BOM pipeline, crons, webhooks).

Built on the Inngest runtime we shipped in #309. Uses `@inngest/workflow-kit` for the editor UI.

## Non-goals (Phase 1)

- Replacing hardcoded webhook handlers (they keep working exactly as they do today).
- Admin-editable BOM pipeline (the 7-stage BOM pipeline stays in code).
- User-authored JavaScript (actions are code-defined; admins can only compose, not invent).
- Roles beyond ADMIN (OPS_MANAGER etc. come later).
- Versioning, draft/published state machine (Phase 2).

## Phase 1 scope — walking skeleton

The walking skeleton proves the whole pattern end-to-end with 2 actions + 2 triggers. Once that works, every additional action/trigger is ~50 lines and a follow-up PR.

**Triggers (starter):**
1. **Manual** — admin clicks "Run this workflow now" from the editor.
2. **HubSpot deal stage change** — fans out from the existing webhook; workflow filters by stage ID.

**Actions (starter):**
1. **Send email** — via the existing Resend/Google Workspace dual-provider system (`src/lib/email.ts`).
2. **Add HubSpot deal note** — via HubSpot Engagements API.

**Out of scope for Phase 1 (explicit follow-up list):**
- Actions: create/update HubSpot task, update deal property, create/assign Zuper job, create Zoho SO, run BOM pipeline, send SMS (needs Twilio), Google Calendar event.
- Triggers: HubSpot ticket events, contact property changes, cron schedule, webhook from external systems.
- UI: run history, per-step logs, test-run preview, branching/conditionals (workflow-kit supports them; we just don't wire in Phase 1).

## Data model

```prisma
enum AdminWorkflowStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

enum AdminWorkflowTriggerType {
  MANUAL
  HUBSPOT_DEAL_STAGE
}

enum AdminWorkflowRunStatus {
  RUNNING
  SUCCEEDED
  FAILED
}

model AdminWorkflow {
  id            String                   @id @default(cuid())
  name          String
  description   String?
  status        AdminWorkflowStatus      @default(DRAFT)
  triggerType   AdminWorkflowTriggerType
  triggerConfig Json                     // e.g. {"dealStageIds": ["123"]}
  definition    Json                     // workflow-kit's serialized workflow
  createdById   String
  createdBy     User                     @relation("AdminWorkflowCreatedBy", fields: [createdById], references: [id])
  updatedAt     DateTime                 @updatedAt
  createdAt     DateTime                 @default(now())
  runs          AdminWorkflowRun[]
  @@index([status])
  @@index([triggerType])
}

model AdminWorkflowRun {
  id             String                  @id @default(cuid())
  workflowId     String
  workflow       AdminWorkflow           @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  status         AdminWorkflowRunStatus  @default(RUNNING)
  triggeredByEmail String
  triggerContext Json                    // the event or manual-run payload
  result         Json?                   // per-step outputs
  errorMessage   String?
  durationMs     Int?
  startedAt      DateTime                @default(now())
  completedAt    DateTime?
  @@index([workflowId, startedAt])
  @@index([status])
}
```

Migration is **additive** — safe to deploy before any code references it (per memory note `feedback_migration_ordering.md`).

## Architecture

```
ADMIN UI ──(save)──────→  /api/admin/workflows/[id]  ──→  AdminWorkflow row
                                                            │
                                                            ├─→ /api/admin/workflows/[id]/run (manual)
                                                            │     emits admin-workflow/run.requested
                                                            │
                                                            └─→ /api/webhooks/hubspot/* (existing)
                                                                  after existing handler, fan out:
                                                                  find matching AdminWorkflow rows
                                                                  emit admin-workflow/run.requested per match

INNGEST ──(receives admin-workflow/run.requested)──→ adminWorkflowExecutor function
                                                          │
                                                          └─→ loads AdminWorkflow by id
                                                              runs via @inngest/workflow-kit Engine
                                                              each step → step.run("action-kind", handler)
                                                              writes AdminWorkflowRun on start/end
```

**Key property: additive to existing webhooks.** The HubSpot design-complete webhook still runs its existing logic (BOM pipeline). AFTER that, it queries `AdminWorkflow` rows where `triggerType = HUBSPOT_DEAL_STAGE` and `dealStageIds` contains the incoming stage, and emits an Inngest event per match. Zero risk to existing flows.

## Action interface

Every action is defined once in code with a Zod input schema, then surfaced in the editor. Admins fill in the inputs via generated forms.

```ts
// src/lib/admin-workflows/actions/send-email.ts
export const sendEmailAction: AdminWorkflowAction = {
  kind: "send-email",
  name: "Send email",
  description: "Send an email via Google Workspace (fallback: Resend)",
  inputs: z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  handler: async ({ inputs, context }) => {
    await sendInternalNotification({
      to: inputs.to,
      subject: inputs.subject,
      html: inputs.body,
    });
    return { sent: true, to: inputs.to };
  },
};
```

Available actions are listed in `src/lib/admin-workflows/actions/index.ts`. Adding one = creating a file + appending to the array.

## Trigger interface

Similar pattern — each trigger defines how it matches and what context it produces.

```ts
export const manualTrigger: AdminWorkflowTrigger = {
  kind: "MANUAL",
  name: "Manual run",
  description: "Admin clicks 'Run now' in the editor",
  configSchema: z.object({}),  // no config
  buildContext: (raw) => raw,
};

export const hubspotDealStageTrigger: AdminWorkflowTrigger = {
  kind: "HUBSPOT_DEAL_STAGE",
  name: "HubSpot deal stage change",
  description: "Fires when a deal moves to a configured stage",
  configSchema: z.object({
    dealStageIds: z.array(z.string()).min(1),
  }),
  buildContext: (raw) => ({
    dealId: raw.objectId,
    stageId: raw.propertyValue,
  }),
};
```

## Role-gating

- ADMIN role only for every `/api/admin/workflows/*` route — `allowedRoutes` in `src/lib/roles.ts` (per memory note `feedback_api_route_role_allowlist.md`).
- Dashboard link only shown on `/suites/admin` suite page.
- Every AdminWorkflow edit/run/delete logs an `ActivityLog` with the admin's email.

## Open questions (deferred)

1. **Execution identity.** Today, when an admin-authored "Send email" runs, whose identity is the sender? Current plan: service account (`pb-workflows@photonbrothers.com` via Google Workspace domain-wide delegation). Admin is logged for audit, service account is the sender.
2. **Rate limiting.** A misconfigured workflow could fan out on every webhook. Phase 1 relies on Inngest's built-in concurrency + HubSpot rate-limit retry. Phase 2: per-workflow max runs/hour.
3. **Preview / dry-run.** Not in Phase 1. Admins should use a DRAFT status and the test-run button (Phase 2).
4. **Abuse prevention.** ADMIN is trusted; no technical guardrails beyond standard audit.

## Rollout

1. Merge Phase 1 PR with `ADMIN_WORKFLOWS_ENABLED` feature flag (default off).
2. Run migration.
3. Set `ADMIN_WORKFLOWS_ENABLED=true` in production.
4. Admins use the editor; watch Inngest dashboard for first few runs.
5. Follow-up PRs add actions/triggers one at a time.
