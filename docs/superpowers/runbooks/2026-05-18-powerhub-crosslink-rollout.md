# PowerHub Crosslink Rollout Runbook

**Date:** 2026-05-18
**Spec:** docs/superpowers/specs/2026-05-18-powerhub-property-zuper-linking-design.md

## Pre-flight (admin work, done BEFORE merge to main)

- [ ] HubSpot: create 6 custom properties (`tesla_portal_url`, `tesla_site_id` × Property + Deal + Ticket). See Chunk 1 Task 1 of the plan for the exact table.
- [ ] Zuper: create 4 custom fields ("Tesla PowerHub", "Tesla Site ID" × Property + Job modules). Field type: URL for "Tesla PowerHub", text for "Tesla Site ID".
- [ ] Confirm Tesla GridLogic portal URL pattern with Tesla account manager. If different from default `https://gridlogic.tesla.com/sites/{siteId}`, set `TESLA_POWERHUB_PORTAL_URL_TEMPLATE` in Vercel production env.
- [ ] Verify predecessor specs are in production: `2026-05-06-powerhub-integration`, `2026-05-16-zuper-property-sync`, `2026-05-17-property-hub-enhancements`.

## Step 1 — Merge code + apply schema migration

- [ ] Merge PR to main.
- [ ] Auto-deploy to production (Vercel).
- [ ] Run prod migration manually: `./scripts/migrate-prod.sh` (do NOT run from a subagent — orchestrator-only with user approval).
- [ ] Verify: `npx prisma db execute --stdin <<'SQL'` returns the new columns: `SELECT column_name FROM information_schema.columns WHERE table_name = 'PowerhubSite' AND column_name IN ('portalUrl', 'primaryForProperty');`

At this point: code is live, schema is updated, flag is OFF — nothing is being pushed externally yet.

## Step 2 — Enable HubSpot push in production

- [ ] Set `POWERHUB_CROSSLINK_ENABLED=true` in Vercel production (use `vercel env add`, NOT echo — `printf '%s' "true" | vercel env add ...`).
- [ ] Verify with `vercel env ls production`.
- [ ] Wait for next deployment OR redeploy to pick up the env var.
- [ ] Watch the next asset-sync cron run (every 6h). Confirm one or two `PowerhubSite` rows have `portalUrl` populated and the linked HubSpot Property shows the new field.

## Step 3 — Run backfill

- [ ] Orchestrator runs (user approval required): `npx tsx scripts/backfill-powerhub-crosslinks.ts`
- [ ] Monitor logs: ~1,200 properties × 5/sec ≈ 4 min runtime.
- [ ] On completion, spot-check 5 random properties in HubSpot UI — `Tesla PowerHub` field should be populated on Property + Deal + Ticket.

## Step 4 — Enable Zuper cascade

- [ ] Set `POWERHUB_ZUPER_CASCADE_ENABLED=true` in Vercel production.
- [ ] Trigger one `zuper-property-sync` cron cycle (15 min normal cadence or manual curl).
- [ ] Spot-check 3 Zuper Properties and their linked Jobs in the Zuper UI — both `Tesla PowerHub` and `Tesla Site ID` fields should be populated.

## Step 5 — Announce

- [ ] Email Service team lead: new System Health column on priority queue, PowerHub button on Customer 360.
- [ ] Email D&E team lead: Tesla PowerHub link now on Project Detail panels.
- [ ] Email field tech lead: Tesla PowerHub field now visible in Zuper Job custom fields.

## Rollback

- [ ] Set `POWERHUB_CROSSLINK_ENABLED=false` in Vercel — kills all push paths.
- [ ] Set `POWERHUB_ZUPER_CASCADE_ENABLED=false` if Zuper-specific issues.
- [ ] No data corruption possible — URL fields just go stale until re-enabled.

## Verification queries

```sql
-- How many properties have a primary site assigned?
SELECT COUNT(*) FROM "PowerhubSite" WHERE "primaryForProperty" = true;

-- How many properties have the denormalized URL set?
SELECT COUNT(*) FROM "HubSpotPropertyCache" WHERE "teslaPortalUrl" IS NOT NULL;

-- Find properties with multiple Tesla sites
SELECT "propertyId", COUNT(*) AS n
FROM "PowerhubSite"
WHERE "propertyId" IS NOT NULL
GROUP BY "propertyId"
HAVING COUNT(*) > 1;
```
