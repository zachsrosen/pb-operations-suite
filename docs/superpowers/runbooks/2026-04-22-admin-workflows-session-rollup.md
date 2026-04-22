# Admin Workflow Builder — Session Rollup (2026-04-22)

**Status:** Live in production. Full feature set shipped, end-to-end verified in browser.

## What exists now

### Palette (17 actions + 2 control-flow)

| Category | Action | What it does |
|---|---|---|
| Messaging | `send-email` | Dual-provider (Google Workspace → Resend fallback) email send |
| AI | `ai-compose` | Claude Haiku — generate text that flows to later steps |
| HubSpot | `fetch-hubspot-deal` | Read deal properties mid-flow |
| HubSpot | `find-hubspot-contact` | Look up contact by email |
| HubSpot | `update-hubspot-property` | Update a deal property |
| HubSpot | `update-hubspot-contact-property` | Update a contact property |
| HubSpot | `update-hubspot-ticket-property` | Update a ticket property |
| HubSpot | `add-hubspot-note` | Append note to a deal's timeline |
| HubSpot | `add-hubspot-contact-note` | Append note to a contact's timeline |
| HubSpot | `create-hubspot-task` | Create task with subject/body/priority/owner |
| Zuper | `fetch-zuper-job` | Read job + custom fields |
| Zuper | `update-zuper-property` | Update a Zuper custom field |
| PB Ops | `run-bom-pipeline` | Queue BOM pipeline for a deal |
| PB Ops | `log-activity` | Write an ActivityLog row |
| Integration | `http-request` | GET/POST/PUT/PATCH/DELETE to any URL |
| Control flow | `delay` | `step.sleep` up to 24h |
| Control flow | `stop-if` | Early-exit on condition (equals/contains/empty) |

### Triggers (4 types)

| Kind | Wiring |
|---|---|
| `MANUAL` | Admin clicks "Run now" in editor, OR POSTs to `/api/admin/workflows/[id]/run` |
| `HUBSPOT_PROPERTY_CHANGE` | Fan-out from the existing HubSpot deal-sync webhook |
| `ZUPER_PROPERTY_CHANGE` | Fan-out from new `/api/webhooks/zuper/admin-workflows` (Zuper config needed) |
| `CRON` | 5-field cron expression; `/api/cron/admin-workflow-cron-dispatch` fires every minute |

### Templates (8)

1. Deal stage → kickoff email
2. Deal stage → add HubSpot note
3. Deal stage → AI-summary email
4. Zuper job status → HubSpot deal property
5. Deal stage → fetch details → AI email (3-step chain, demonstrates templates)
6. Ticket stuck → update property + notify
7. Weekly Monday → status email (CRON example)
8. Manual → send test email (smoke test)

### Feature flags (Vercel production)

| Flag | Value | What it gates |
|---|---|---|
| `ADMIN_WORKFLOWS_ENABLED` | `true` | Editor, API, manual runs, cron dispatcher |
| `ADMIN_WORKFLOWS_FANOUT_ENABLED` | **off** | Webhook → workflow fan-out for HubSpot + Zuper |
| `ADMIN_WORKFLOWS_HTTP_ALLOWLIST` | unset | When set, restricts `http-request` action to named hostnames |

### Cron schedule (Vercel)

| Path | Schedule | Purpose |
|---|---|---|
| `/api/cron/admin-workflow-cleanup` | `*/15 * * * *` | Mark RUNNING > 15m as FAILED |
| `/api/cron/admin-workflow-cron-dispatch` | `* * * * *` | Fire CRON-triggered workflows |

### Inngest (production)

- App: `pb-tech-ops` at `https://www.pbtechops.com/api/inngest`
- Functions registered: `Admin Workflow Executor`, `BOM: Design-complete pipeline`
- Event: `admin-workflow/run.requested`
- Concurrency: 5 per workflow id

### UI surface

- `/dashboards/admin/workflows` — list with Clone/Edit/Archive/Delete + "Start from template" + "+ Blank workflow" + "View all runs"
- `/dashboards/admin/workflows/[id]` — editor (basics, trigger, steps with up/down reorder, save, run now, activate, recent runs panel)
- `/dashboards/admin/workflows/runs` — cross-workflow run history, auto-refreshes every 10s, status filter
- `/dashboards/admin/workflows/runs/[runId]` — per-run drill-in (trigger context, step outputs, Mark-FAILED button)
- `/admin` landing page has "Admin Workflows" card

## PR history (13 PRs)

| # | Scope |
|---|---|
| 317 | Foundation: Prisma models, executor, 3 actions, 3 triggers |
| 321 | UI editor + full CRUD API |
| 323 | 4 new actions (hubspot-note, task, contact-property, ai-compose) + 5 templates |
| 325 | Webhook fan-out (flag still off) |
| 326 | Control-flow (delay, stop-if) + run-bom-pipeline + log-activity |
| 328 | Step reorder + run history page |
| 329 | Per-run detail page |
| 330 | CLAUDE.md docs |
| 332 | Operations runbook |
| 335 | Cleanup cron + 3 actions (fetch-deal, ticket-property, contact-note) + 2 templates + Mark-FAILED button |
| 336 | fetch-zuper-job + Duplicate workflow |
| 337 | http-request + find-hubspot-contact |
| 338 | CRON trigger type + dispatcher + weekly template |

## Migrations applied (manually, with user approval)

| Name | When | Effect |
|---|---|---|
| `20260422210000_admin_workflows` | Session 1 | Added AdminWorkflow, AdminWorkflowRun tables + 3 enums |
| `20260422230000_admin_workflow_cron_trigger` | Session 2 | Added CRON value to AdminWorkflowTriggerType enum |

## Known gotchas (from the ops runbook)

1. **Inngest manual resync needed** whenever an Inngest function is added/removed (Vercel-Inngest integration targets the deployment URL which is behind auth). Manual sync against `www.pbtechops.com/api/inngest` works. Already documented + I've resynced once during this session.

2. **ADMIN_WORKFLOWS_FANOUT_ENABLED is off** — webhooks receive events but won't fire admin workflows until flipped. Deliberate so admins can author + test workflows before real events hit.

3. **Zuper webhook requires manual config** in Zuper's dashboard — URL `https://www.pbtechops.com/api/webhooks/zuper/admin-workflows`, Bearer token = `ZUPER_WEBHOOK_SECRET` env var.

4. **http-request action** can hit any URL when `ADMIN_WORKFLOWS_HTTP_ALLOWLIST` is unset. Admins are trusted but if you want to lock this down, set the env var to a comma-separated list of allowed hostnames.

5. **Cron dispatcher runs every minute**. On Vercel Hobby that uses 1 cron slot (max 2). On Pro/Team it's unmetered. Fan-out events count against Inngest's plan (free tier = 50k/mo).

## What's NOT in this session (logical next steps)

- Visual canvas editor (the `@inngest/workflow-kit` React components are installed but not wired — current editor is form-based)
- Analytics dashboard (success rate, most-run workflow, p50/p95 duration)
- Workflow export/import (JSON)
- Custom event trigger (`CUSTOM_EVENT` — lets app code emit named events that workflows listen for)
- Zuper webhook config in their dashboard (manual step — admin needs to do this when ready to flip fan-out)
- Flipping `ADMIN_WORKFLOWS_FANOUT_ENABLED=true` (deliberate — wait until admins have authored workflows)

## Quick verification

End-to-end manual-run flow confirmed in browser during session:
1. Create workflow from "Manual → send test email" template
2. Activate
3. Click Run now
4. Workflow succeeded in 1.5s in the Inngest dashboard
5. Email action returned `{"sent": true, "recipients": ["zach@photonbrothers.com"]}`
6. Run detail page shows everything (step outputs, trigger context, timing)

Cron dispatcher can't be manually verified right now because CRON workflows need a real schedule to fire — if you create one with expression `* * * * *` (every minute) and activate it, it'll start firing within 60 seconds.
