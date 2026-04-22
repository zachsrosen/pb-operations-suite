# Admin Workflows — Operations Runbook

**Last updated:** 2026-04-22

This runbook covers operational concerns for the Admin Workflow Builder system that's live in production.

## System summary

- **Editor:** https://www.pbtechops.com/dashboards/admin/workflows
- **Runtime:** Inngest app `pb-tech-ops` at https://www.pbtechops.com/api/inngest
- **Inngest dashboard:** https://app.inngest.com/env/production/runs
- **Feature flags (Vercel production):**
  - `ADMIN_WORKFLOWS_ENABLED=true` — editor + API + manual runs
  - `ADMIN_WORKFLOWS_FANOUT_ENABLED` — webhook → workflow event fan-out (CURRENTLY OFF)

## Common operations

### Rolling back admin workflows entirely

```
vercel env rm ADMIN_WORKFLOWS_ENABLED production
# Or set to false:
printf 'false' | vercel env add ADMIN_WORKFLOWS_ENABLED production
```

Then redeploy. Takes ~2 min. Editor returns 503, fan-out is a no-op. Existing workflow rows are untouched.

### Pausing a single workflow

Admin clicks **Pause (back to DRAFT)** in the editor — or archive it. ACTIVE → DRAFT stops webhook fan-out from firing it, but manual runs still work (useful for debugging).

### Re-running a failed run

Open the run in the Inngest dashboard, click **Rerun**. This re-dispatches the event; the executor re-runs the whole workflow.

Note: actions are not yet guaranteed idempotent. Re-running `send-email` sends again; re-running `add-hubspot-note` adds a second note. Plan accordingly.

## Known gotchas

### 🔴 Inngest sync on deploy — manual step required today

Today's setup (Vercel-Inngest integration, auto-sync):

The auto-sync points at the auto-generated Vercel deployment URL (e.g. `pb-operations-suite-abc123-tech-ops.vercel.app`), which is behind Vercel's deployment protection and returns 401 to Inngest. Result: auto-sync fails silently; any new functions you add won't register.

**The manual sync I did on 2026-04-22 points at the static production domain (`https://www.pbtechops.com/api/inngest`).** That one works.

**Implication:** whenever you add or remove an Inngest function (a new `createFunction` call), you must manually resync the app in the Inngest dashboard:

1. Go to https://app.inngest.com/env/production/apps/pb-tech-ops
2. Click **Resync** (top right)
3. Confirm the URL is `https://www.pbtechops.com/api/inngest` (not the deployment URL)
4. Click **Resync app**

Events sent to Inngest for a function that isn't registered at the time are **dropped** (not queued). Any workflow runs sitting in `RUNNING` state from before a resync are orphaned — they'll never complete.

**Fix options (future PRs):**
- Wire a CI/CD step that calls Inngest's sync API automatically after each deploy
- Migrate away from the Vercel-Inngest integration to a direct signing-key setup where we control the sync URL
- Add a stuck-run cleanup cron that marks `RUNNING` rows older than 10 min as `FAILED`

### Orphaned RUNNING rows

Caused by: the scenario above, Inngest outage, or worker crash before DB update. A row stays in `RUNNING` status forever.

**Detection query** (paste into Prisma Studio or psql):
```sql
SELECT id, "workflowId", "triggerContext", "startedAt",
       NOW() - "startedAt" AS age
FROM "AdminWorkflowRun"
WHERE status = 'RUNNING'
  AND "startedAt" < NOW() - INTERVAL '10 minutes'
ORDER BY "startedAt" ASC;
```

Current known orphan (as of 2026-04-22 22:30 UTC): one run at 6:28:33 PM local, queued before the Inngest app resync added the `admin-workflow-executor` function. Safe to leave or delete manually.

### No rate limiting on actions

A poorly configured workflow fires once per matching webhook event. A misconfigured template (e.g. `send-email` on every deal property change) could hammer email providers.

**Mitigations today:**
- Manual DRAFT/ACTIVE gate — admin must opt in explicitly
- Inngest's built-in concurrency control (currently limit=5 per workflow)
- HubSpot / Zoho / Zuper each have their own API rate limiters with retry

**Future:** add a per-workflow max-runs-per-hour config in the editor.

### Control-flow kind misuse

`delay` uses Inngest's durable sleep — free up to the plan limit, but long sleeps consume billable run-hours. 24h is the current max; longer was intentionally disallowed.

`stop-if` evaluates against resolved template strings. It won't work for complex comparisons (boolean AND/OR, numeric <, >). Use case keep it simple for now.

## Webhook fan-out rollout (not yet live)

`ADMIN_WORKFLOWS_FANOUT_ENABLED` is still off. When you want to flip it:

### HubSpot deal property changes
Already wired — the existing `/api/webhooks/hubspot/deal-sync` webhook calls `fanoutAdminWorkflows("HUBSPOT_PROPERTY_CHANGE", ...)` after its primary sync. No HubSpot-side config changes needed.

### Zuper job updates
Not wired yet — you need to configure Zuper's webhook settings:

1. Generate a random secret and set it:
   ```
   printf '<random 48-char>' | vercel env add ZUPER_WEBHOOK_SECRET production
   ```
2. In Zuper's webhook dashboard, create a new webhook:
   - URL: `https://www.pbtechops.com/api/webhooks/zuper/admin-workflows`
   - Method: POST
   - Headers: `Authorization: Bearer <secret from step 1>`
   - Events: Job update / Job status change
3. Redeploy (so the env var takes effect)
4. Flip the flag: `printf 'true' | vercel env add ADMIN_WORKFLOWS_FANOUT_ENABLED production`

### First-hour watch

After flipping, monitor:
- https://app.inngest.com/env/production/runs (expect a spike in admin-workflow-executor runs)
- /dashboards/admin/workflows/runs (PB Ops-side status)
- Sentry for any thrown errors in `fanoutAdminWorkflows` or action handlers

## Quick commands

```bash
# Force a rollout of ADMIN_WORKFLOWS_ENABLED without code changes
vercel --scope tech-ops redeploy <latest-prod-url> --target=production

# Tail Inngest function logs via their dashboard
# (no CLI yet; use the run detail page)

# Check env flag state
vercel env ls production | grep -i admin_workflows
```

## Escalation path

If an active workflow is misbehaving (sending too many emails, etc):

1. Archive the specific workflow in the editor — stops fan-out immediately
2. If multiple, flip `ADMIN_WORKFLOWS_FANOUT_ENABLED=false` — stops all future fan-out
3. If total meltdown, flip `ADMIN_WORKFLOWS_ENABLED=false` — editor + runs both go 503

All three are recoverable within ~2 minutes of decision.
