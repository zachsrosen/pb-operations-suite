# Admin Workflows — current state + accepted limitations

**Last updated:** 2026-04-23 (Phase 15)

Supersedes earlier session rollup docs on dated scope. This is the living
state doc — edit in place as the system evolves.

## Shipped

Everything from the previous rollup, plus:

| Phase | Added |
|---|---|
| 14a | Failure alerts (email on every failed run) + Zuper property discovery dropdowns |
| 14b | Dry-run mode (editor button + stub handlers + DRY RUN badge) |
| 14c | Best-effort idempotency (DB checkpoints between steps, cross-invocation resume) |
| 15a | Per-workflow rate limiting (`maxRunsPerHour`, default 60) |
| 15b | Inngest auto-sync on prod deploy (via `/api/deployment` webhook) + `/api/admin/inngest-resync` manual trigger |

## Active feature flags

| Flag | Value | Effect |
|---|---|---|
| `ADMIN_WORKFLOWS_ENABLED` | `true` | Editor, API, cron dispatcher, manual runs |
| `ADMIN_WORKFLOWS_FANOUT_ENABLED` | `true` | Real HubSpot + Zuper webhook events fire admin workflows |
| `ADMIN_WORKFLOWS_HTTP_ALLOWLIST` | unset | http-request action unrestricted (admin-trust model) |
| `ADMIN_WORKFLOWS_FAILURE_ALERT_EMAIL` | defaults to `ops@photonbrothers.com` | Recipient for failure alerts; empty string disables |
| `ZUPER_WEBHOOK_SECRET` | set | Bearer token for the Zuper webhook |

## Palette

17 actions + 2 control-flow. See previous rollup for the full table.

## Accepted limitations (documented, not fixed)

### Action-level idempotency

The cross-invocation checkpoint (Phase 14c) covers **95% of realistic duplicate-call risks**. The remaining 5%:

**Vulnerable pattern:** an action handler makes an external side-effect, crashes/times out before returning to the executor, Inngest retries, the handler runs again, the side-effect fires a second time.

Affected actions:
- `send-email` — admins could receive a duplicate email
- `add-hubspot-note` / `add-hubspot-contact-note` — duplicate note on the timeline
- `create-hubspot-task` — duplicate task
- `http-request` with non-idempotent verbs — depends on the remote endpoint
- `ai-compose` — extra Claude API cost

Not affected (naturally idempotent):
- `update-*-property` actions (setting X=Y twice = same result)
- `fetch-*` actions (reads only)
- `update-zuper-property` (same as above)
- `run-bom-pipeline` (has its own `acquirePipelineLock`)

**Why we accepted this:**
- Inngest's own `step.run` cache handles retries within a single invocation (common case)
- The Phase 14c cross-invocation checkpoint handles function re-entry (uncommon case)
- The remaining window is "external call succeeded, function crashed before response was persisted" — rare in practice
- Fixing it generically requires per-action search-before-create logic + extra API calls per create, which adds cost and complexity

**If this bites us:** specific actions can add idempotency markers (embed run+step in the created resource, search before create). `add-hubspot-note` is the easiest candidate since HubSpot's search API can match on `hs_note_body` prefix.

### No action-level rate limiting

Per-workflow cap (Phase 15a) limits total runs per workflow. It does NOT limit per-action (e.g. "send at most 10 emails per hour to a given recipient"). An admin could configure a workflow that sends 60 emails/hour to the same address.

Mitigation: admin trust + run-history visibility. Could add action-level rate limits as a follow-up if needed.

### http-request has no allowlist in production

`ADMIN_WORKFLOWS_HTTP_ALLOWLIST` is unset → admins can hit any URL from the pb-ops server. Accepted because:
- Only ADMIN role can author workflows
- Workflow changes are logged via `ActivityLog`
- External calls are visible in Sentry / run detail

If you want to lock down: set the env var to a comma-separated list of hostnames.

## Operational procedures

### New Inngest function added

Phase 15b makes this automatic. On `deployment.succeeded` from Vercel:
1. `/api/deployment` webhook fires
2. Calls `triggerInngestSync()` which PUTs to Inngest's `/fn/register` endpoint
3. Inngest re-reads `https://www.pbtechops.com/api/inngest` and registers any new/changed functions

If that doesn't fire (e.g. Vercel webhook not configured, or the integration is misbehaving): `POST /api/admin/inngest-resync` as ADMIN manually triggers the same flow.

### Adding a new action

1. Create `src/lib/admin-workflows/actions/<kind>.ts` — declare `AdminWorkflowAction` with `kind`, `name`, `category`, `fields[]`, `inputsSchema`, `handler`
2. Append to `ACTIONS[]` in `src/lib/admin-workflows/actions/index.ts`
3. Deploy. Auto-sync registers it.

### Adding a new trigger type

1. Update `AdminWorkflowTriggerType` enum in Prisma schema (additive migration — see `20260422230000_admin_workflow_cron_trigger` as template)
2. Add trigger definition in `src/lib/admin-workflows/triggers/index.ts`
3. Register a fan-out path (webhook handler, cron dispatcher, or manual emit)
4. Update editor + API type unions to include the new enum value

### Rate limit tuning

Per-workflow: `maxRunsPerHour` on `AdminWorkflow`. Admin can set in editor. 0 = unlimited. Default 60.

### Rollback paths

- Full kill: `ADMIN_WORKFLOWS_ENABLED=false` → editor/API/cron all return 503
- Fan-out only: `ADMIN_WORKFLOWS_FANOUT_ENABLED=false` → webhooks stop triggering workflows (manual + cron still work)
- Single workflow: admin archives or pauses it via editor
- Stuck run: click "Mark FAILED" on the run detail page

All rollbacks are sub-2-minute operations.

## Not yet shipped

- Visual canvas editor (deps installed: `@inngest/workflow-kit`, not wired)
- Analytics dashboard (run success rate, p50/p95, top workflows by volume)
- Workflow export/import (JSON blob for cross-env migration)
- Custom event trigger (`CUSTOM_EVENT` — emit from arbitrary app code)
- Branching beyond `stop-if` (parallel steps, if/else splits, loops)
- Workflow versioning / edit history
- Action-level idempotency for create-actions (see accepted limitations)
- Action-level rate limiting (separate from workflow-level)
