# Admin Workflows — Phase 16 closeout

**Date:** 2026-04-23
**Status:** Complete. System is fully production-capable.

This doc supersedes earlier phase-specific rollups. Canonical state of the
admin workflow system after 30+ PRs.

## Final feature matrix

### Triggers (5 types)

| Kind | How it fires |
|---|---|
| `MANUAL` | Admin clicks Run now / Dry run in editor |
| `HUBSPOT_PROPERTY_CHANGE` | deal-sync webhook fan-out (objectType + propertyName + optional propertyValuesIn filter) |
| `ZUPER_PROPERTY_CHANGE` | Zuper webhook at /api/webhooks/zuper/admin-workflows |
| `CRON` | Vercel cron dispatcher every minute; admin supplies 5-field expression |
| `CUSTOM_EVENT` | `emitAdminWorkflowCustomEvent(name, data)` called from any app code |

### Actions (17)

**Messaging** — send-email
**AI** — ai-compose (Claude Haiku)
**HubSpot** — fetch-hubspot-deal, find-hubspot-contact, update-hubspot-property, update-hubspot-contact-property, update-hubspot-ticket-property, add-hubspot-note, add-hubspot-contact-note, create-hubspot-task
**Zuper** — fetch-zuper-job, update-zuper-property
**PB Ops** — run-bom-pipeline, log-activity
**Integration** — http-request

### Control flow (4 kinds)

- `delay` — Inngest `step.sleep` up to 24h
- `stop-if` — conditional early-exit (equals / not-equals / contains / is-empty / is-not-empty)
- `parallel` — N children run concurrently
- `for-each` — iterate array, run children per item, cap 100 iterations, `{{loop.item}}` + `{{loop.index}}` in scope

### Templates (8)

1. Deal stage → kickoff email
2. Deal stage → add HubSpot note
3. Deal stage → AI-summary email
4. Deal stage → fetch details → AI email (3-step chain)
5. Zuper job status → HubSpot deal property
6. Ticket stuck → update property + notify
7. Weekly Monday → status email (CRON)
8. Manual → send test email

### Reliability

- **Per-workflow rate limit** (`maxRunsPerHour`, default 60, 0 = unlimited)
- **Cross-invocation checkpoint** — executor resumes completed steps on re-entry (PR #350)
- **Action-level idempotency** for create-actions (send-email, note/contact-note, task) via IdempotencyKey table lookup
- **Cleanup cron** marks stale RUNNING > 15m as FAILED every 15m
- **Dry-run mode** — admin can preview without external side effects, works on DRAFT workflows

### Observability

- **Run history page** with status filter + 10s auto-refresh
- **Per-run detail** — trigger context, step outputs, errors, Mark FAILED button
- **Analytics dashboard** — totals, success rate, p50/p95 duration, daily bar chart, top-workflow table, window selector
- **Failure alerts** — email on failed runs to ADMIN_WORKFLOWS_FAILURE_ALERT_EMAIL (default ops@photonbrothers.com)

### Authoring

- **Form editor** — structured fields per action/trigger, dropdowns with dynamic options for HubSpot pipelines + Zuper properties
- **Canvas preview** with drag-to-reorder steps (full inline editing still in form editor)
- **Template picker** — 8 starter templates, clone-to-customize
- **Clone workflow** button on list page
- **Export/import JSON** for cross-environment migration + version control
- **Version history** — snapshot on every content save, restore with one click

### Ops

- **Inngest auto-sync on deploy** via `/api/deployment` webhook hitting Inngest's /fn/register with canonical app URL
- **Manual resync** via `/api/admin/inngest-resync` (ADMIN-gated POST)
- **Three kill switches**: `ADMIN_WORKFLOWS_ENABLED`, `ADMIN_WORKFLOWS_FANOUT_ENABLED`, per-workflow archive
- **HTTP allowlist** (optional) via `ADMIN_WORKFLOWS_HTTP_ALLOWLIST`

## Active feature flags

| Flag | Value | Purpose |
|---|---|---|
| `ADMIN_WORKFLOWS_ENABLED` | `true` | Editor / API / cron / manual runs |
| `ADMIN_WORKFLOWS_FANOUT_ENABLED` | `true` | Real HubSpot + Zuper events fire admin workflows |
| `ADMIN_WORKFLOWS_HTTP_ALLOWLIST` | unset | Unrestricted http-request action |
| `ADMIN_WORKFLOWS_FAILURE_ALERT_EMAIL` | default `ops@photonbrothers.com` | Recipient for failure alerts |
| `ZUPER_WEBHOOK_SECRET` | set | Bearer token for Zuper webhook |

## Cron schedule

| Path | Schedule | Effect |
|---|---|---|
| `/api/cron/admin-workflow-cleanup` | `*/15 * * * *` | Mark RUNNING > 15m as FAILED |
| `/api/cron/admin-workflow-cron-dispatch` | `* * * * *` | Fire CRON-triggered workflows |

## Migrations applied (all with user approval)

1. `20260422210000_admin_workflows` — foundation
2. `20260422230000_admin_workflow_cron_trigger` — CRON enum value
3. `20260423010000_admin_workflow_rate_limit` — maxRunsPerHour column
4. `20260423020000_admin_workflow_custom_event_trigger` — CUSTOM_EVENT enum value
5. `20260423030000_admin_workflow_versioning` — AdminWorkflowVersion table

## PR index (all phases)

30+ PRs. Full list in git history under `admin-workflow-*` branches.

## Accepted limitations

### Action-level idempotency residual risk (~1%)

Even with the IdempotencyKey guard, there's a narrow window where an
external call succeeds but our DB write fails before we can mark it
completed. On retry, the external call runs again → duplicate.

Mitigation paths (not shipped):
- Search-before-create using idempotency markers embedded in the
  external resource (e.g. `<!-- pb-wf:runId:stepId -->` in note bodies,
  then HubSpot search before create)
- API-native idempotency tokens where supported

### Canvas authoring is drag-reorder only

Adding / deleting nodes + inline input editing happens in the form
editor. Full drag-drop authoring (add from palette, edit inline, delete
on canvas) requires deeper @inngest/workflow-kit integration and was
deferred.

### Parallel / for-each children are defined as JSON

The form editor has a JSON textarea for childrenJson. A nested sub-form
builder would be cleaner but was deferred in favor of shipping the
functionality. The JSON pattern is documented in action field help text.

### No multi-level control-flow nesting

Child steps inside `parallel` and `for-each` can't themselves be
control-flow kinds. This keeps the executor simple. If deep nesting is
needed in practice, the child-validation code is the only change site.

### No action-level rate limits

Per-workflow rate limiting (maxRunsPerHour) catches the runaway case.
Per-action limits ("at most 10 emails/hour from this workflow") are a
nicer-to-have that most real use cases don't need.

## What a real use case looks like end-to-end

Admin wants: "when a HubSpot deal moves to Construction Scheduled in the
Westminster location, notify the install lead by email with a kickoff
checklist, add an audit note on the deal, and schedule a follow-up task."

1. Open `/dashboards/admin/workflows`
2. Click "+ Blank workflow"
3. Set trigger: HubSpot property change → object=deal → property=dealstage → values=[Construction Scheduled stage ID from the dropdown]
4. Add step 1: `stop-if` with `{{trigger.propertyValue}} != <expected>` safeguard
5. Add step 2: `fetch-hubspot-deal` to pull pb_location, system_size_kw, etc.
6. Add step 3: `stop-if` with `{{previous.fetch.properties.pb_location}} != "Westminster"`
7. Add step 4: `send-email` to install lead with deal info in the body
8. Add step 5: `add-hubspot-note` with "Kickoff sent to crew" marker
9. Add step 6: `create-hubspot-task` for 7-day follow-up
10. Dry-run to verify
11. Activate

That whole flow is now possible inside PB Ops Suite without a single
engineer touch.

## Closeout

The admin workflow builder is done for the scope I committed to. Real
admins should be able to author productive workflows without engineering
support. Further iteration is feature-by-feature based on actual usage
feedback rather than anticipatory polish.
