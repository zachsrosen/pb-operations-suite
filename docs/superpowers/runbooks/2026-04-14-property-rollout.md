# HubSpot Property Object — Rollout Runbook

> Generated 2026-04-14. Executes Chunk 7 of `docs/superpowers/plans/2026-04-14-hubspot-property-object.md`.
> Code + schema + tests for Chunks 1–6 are merged on branch `feat/hubspot-property-object` / PR `TBD` before this runbook begins.

## Why this is a human-in-loop runbook

Two steps create persistent state in prod HubSpot (the Property custom object and its labeled-association types) that cannot be cleanly reverted via script. The bootstrap script's output (object type ID + 7 association type IDs) must land in Vercel env vars in the same window or the sync layer will start up misconfigured. A human at the keyboard keeps the Vercel tab open, pastes IDs as they emerge, and halts if Sentry lights up.

---

## Pre-flight checklist

Run once before starting 7.1. Each bullet is a `[ ]` you tick off.

- [ ] PR `feat/hubspot-property-object` is merged to `main` OR you are executing the runbook against a prod deploy that contains the branch's code. (Webhook handler + cron + backfill script must exist in the deployed bundle.)
- [ ] `PROPERTY_SYNC_ENABLED=false` is set in Vercel prod env (default — webhook short-circuits to 200 until you flip it in 7.2).
- [ ] `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED=false` is set in Vercel prod env (default — UI hidden until 7.3).
- [ ] You have admin access to both the HubSpot sandbox portal and the prod portal (21710069).
- [ ] You have write access to Vercel env vars for the `pb-operations-suite` project.
- [ ] Local `.env` has `DATABASE_URL` pointing at the Neon branch you will backfill. **Double-check this before running the backfill script.** For 7.2, it must be prod.
- [ ] Sentry dashboard open, filtered to `route:/api/webhooks/hubspot/property` and `route:/api/cron/property-reconcile`.

---

## Task 7.1 — Sandbox smoke run

**Goal:** prove the pipeline end-to-end in sandbox before touching prod.

### 7.1.1 Swap credentials to sandbox

Temporarily edit your local `.env`:

```bash
# Comment out prod:
# HUBSPOT_ACCESS_TOKEN=<prod token>
# HUBSPOT_PORTAL_ID=21710069

# Paste sandbox:
HUBSPOT_ACCESS_TOKEN=<sandbox private-app token>
HUBSPOT_PORTAL_ID=<sandbox portal id>
DATABASE_URL=<neon SANDBOX branch url>    # must NOT be prod
PROPERTY_SYNC_ENABLED=true
```

### 7.1.2 Create the sandbox Property object

```bash
tsx scripts/create-hubspot-property-object.ts
```

Expected output (idempotent on re-run):
- `✅ Created property object. objectTypeId: 2-xxxxxxx`
- Association type IDs for each label (current_owner, previous_owner, tenant, property_manager, authorized_contact, company_owner, company_manager).

Copy these into your local `.env`:

```
HUBSPOT_PROPERTY_OBJECT_TYPE=2-xxxxxxx
HUBSPOT_PROPERTY_CONTACT_ASSOC_CURRENT_OWNER=<id>
HUBSPOT_PROPERTY_CONTACT_ASSOC_PREVIOUS_OWNER=<id>
HUBSPOT_PROPERTY_CONTACT_ASSOC_TENANT=<id>
HUBSPOT_PROPERTY_CONTACT_ASSOC_PROPERTY_MANAGER=<id>
HUBSPOT_PROPERTY_CONTACT_ASSOC_AUTHORIZED_CONTACT=<id>
HUBSPOT_PROPERTY_COMPANY_ASSOC_OWNER=<id>
HUBSPOT_PROPERTY_COMPANY_ASSOC_MANAGER=<id>
```

### 7.1.3 Configure sandbox webhooks

In the HubSpot sandbox portal UI → Settings → Integrations → Private Apps → your app → Webhooks:

- Target URL: `<sandbox deploy URL>/api/webhooks/hubspot/property`
- Subscriptions: `contact.propertyChange` for `address`, `city`, `state`, `zip`, `country`.
- Hit **Create subscription** for each, then **Activate**.

### 7.1.4 Happy path — 5 new contacts

In the sandbox portal, create 5 brand-new contacts with 5 unique real addresses (use your own neighborhood, not placeholders — geocoder rejects fake addresses). Wait ~30 seconds after each create for the webhook to fire.

Check each:

```bash
psql "$DATABASE_URL" -c "SELECT hubspotObjectId, fullAddress, pbLocation, ahjName FROM \"HubSpotPropertyCache\" ORDER BY createdAt DESC LIMIT 10;"
```

Expected: 5 new rows, each with `pbLocation` resolved, `ahjName` populated if a nearby deal exists.

In the sandbox portal, open each new contact and confirm there's a Property associated under the labeled `Current Owner` relationship.

### 7.1.5 Ownership migration — address change

Pick one of the 5 test contacts. In the portal, edit their address to a different unique address (same city is fine, different street). Wait 30s.

Check:
- A SECOND property row exists in the cache with the new address.
- The first property still has the contact as `Current Owner` (v1 invariant: no demotion).
- The new property has the contact as `Current Owner`.

If you see only one property or the contact detached from the old one, **stop here and dig in** — the move-vs-correction heuristic in `property-sync.ts` may be mis-classifying.

### 7.1.6 Deal + ticket rollup

Pick one test contact. Create a deal against it in the sandbox portal (any pipeline, any amount). Create a ticket against the same contact.

Check:
```bash
psql "$DATABASE_URL" -c "SELECT hubspotObjectId, systemSizeKwDc, openTicketsCount FROM \"HubSpotPropertyCache\" WHERE id IN (SELECT propertyCacheId FROM \"PropertyDealLink\" ORDER BY createdAt DESC LIMIT 3);"
```

Expected: `openTicketsCount` > 0, and a `PropertyDealLink` row exists for that deal.

### 7.1.7 Drift repair

1. In the sandbox portal → Webhooks → **disable** the address-change subscription.
2. Edit one test contact's city (e.g., Denver → Boulder).
3. Wait 1 minute. Confirm the cache row is stale (still shows old city) — this proves the webhook path is off.
4. Re-enable the subscription.
5. Run the reconcile cron manually:
   ```bash
   curl -X POST "<sandbox deploy URL>/api/cron/property-reconcile" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
6. Wait for the response. Check the cache again — city should now be corrected.

### 7.1.8 Rollback sandbox credentials

Restore your local `.env` to prod. Double-check `DATABASE_URL` is back to prod before you run anything else.

### 7.1.9 Write-up

If anything surprised you, add a bullet to `docs/superpowers/runbooks/2026-04-14-property-rollout.md` under a new "Sandbox findings" section below and commit.

---

## Task 7.2 — Prod rollout (Phase 3)

**Goal:** create the prod Property object, turn on sync, run the backfill, soak for 48h.

### 7.2.1 Pre-flight

- [ ] 7.1 sandbox smoke passed clean.
- [ ] Merge `feat/hubspot-property-object` PR to `main` if not yet done. Wait for Vercel prod deploy green.
- [ ] In Vercel, confirm `PROPERTY_SYNC_ENABLED=false` and `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED=false` are set. No code change goes live yet.
- [ ] `.env` locally points at **prod** HubSpot + **prod** Neon.

### 7.2.2 Create prod Property object

```bash
tsx scripts/create-hubspot-property-object.ts
```

**CAREFUL:** this writes to the prod portal. The object + association types it creates cannot be cleanly deleted without HubSpot support. The script is idempotent so re-running is safe, but the first run is the point of no return.

Copy the emitted IDs into a scratch pad — you'll paste them into Vercel next.

### 7.2.3 Set Vercel prod env vars

Go to Vercel → `pb-operations-suite` project → Settings → Environment Variables → Production.

Add or update:

```
HUBSPOT_PROPERTY_OBJECT_TYPE             = 2-xxxxxxx
HUBSPOT_PROPERTY_CONTACT_ASSOC_CURRENT_OWNER       = <id>
HUBSPOT_PROPERTY_CONTACT_ASSOC_PREVIOUS_OWNER      = <id>
HUBSPOT_PROPERTY_CONTACT_ASSOC_TENANT              = <id>
HUBSPOT_PROPERTY_CONTACT_ASSOC_PROPERTY_MANAGER    = <id>
HUBSPOT_PROPERTY_CONTACT_ASSOC_AUTHORIZED_CONTACT  = <id>
HUBSPOT_PROPERTY_COMPANY_ASSOC_OWNER               = <id>
HUBSPOT_PROPERTY_COMPANY_ASSOC_MANAGER             = <id>
```

**Do NOT flip `PROPERTY_SYNC_ENABLED=true` yet** — the webhooks aren't subscribed in prod HubSpot yet, so there's nothing to receive. Setting the flag first would cause the reconcile cron to attempt to process an empty state on its next tick, which is safe but pointless.

Trigger a redeploy so the env vars load: Vercel → Deployments → latest prod deploy → ⋯ menu → **Redeploy** (unchecking "Use existing build cache").

### 7.2.4 Configure prod webhooks

HubSpot prod portal → Settings → Integrations → Private Apps → your app → Webhooks:

- Target URL: `https://<prod deploy URL>/api/webhooks/hubspot/property`
- Subscriptions: `contact.propertyChange` for `address`, `city`, `state`, `zip`, `country`. Create and Activate.

Webhook will 200 on arrival but short-circuit because `PROPERTY_SYNC_ENABLED=false`. Confirm by trigering a trivial address edit on any prod contact and checking that the webhook logs show receipt with no cache writes.

### 7.2.5 Flip the sync flag

Vercel → env vars → `PROPERTY_SYNC_ENABLED` = `true`. Redeploy.

From this point forward, webhook events create cache rows. Watch Sentry closely for the first ~15 minutes.

### 7.2.6 Backfill — dry run

Backfill runs from your local workstation, not Vercel (the runtime limit would kill it mid-way). From the repo root:

```bash
PROPERTY_SYNC_ENABLED=true BACKFILL_LIMIT=100 tsx scripts/backfill-properties.ts
```

Expected: processes 100 contacts across the 4 phases (contacts → deals → tickets → rollups), creates up to 100 cache rows, writes a `PropertyBackfillRun` row with `status=completed`, `totalFailed < 5`.

```bash
psql "$DATABASE_URL" -c "SELECT id, status, totalProcessed, totalFailed, phase, startedAt, finishedAt FROM \"PropertyBackfillRun\" ORDER BY startedAt DESC LIMIT 5;"
```

If `totalFailed >= 5`:
- Check Sentry for the specific failures (most common: geocode 0-result on weird addresses).
- Review the per-row failure rows in the DB (field TBD — check `property-backfill-lock.ts`).
- Decide whether to patch the skip list or push through; document your call in the Sandbox findings section.

### 7.2.7 Backfill — full run

Remove `BACKFILL_LIMIT`:

```bash
PROPERTY_SYNC_ENABLED=true tsx scripts/backfill-properties.ts
```

This is resumable (see `PropertyBackfillRun` state machine). If you need to stop, Ctrl+C is safe; next invocation resumes from the last completed phase/offset.

Expected wall time: depends on contact count. Budget 15–30 minutes for ~10k contacts (geocoding is the slowest step). **Keep the terminal open.**

### 7.2.8 Soak

For the next 48 hours:

- Check Sentry error rate filtered to property routes. Target: < 0.5% over the soak window.
- Spot-check cache parity: pick 5 random cache rows and manually compare against the HubSpot object.
- Monitor Google geocoding spend in Cloud Console. If daily spend > expected, the reconcile cron is probably re-geocoding — check its code path.
- Reconcile cron fires daily at 9am. Confirm the first run after backfill is a no-op (no drift to repair).

---

## Task 7.3 — UI rollout (Phase 4)

Flip on a **weekday morning** (9am PT / noon ET). Team is available to respond to feedback.

### 7.3.1 Flip the flag

Vercel → env vars → `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED` = `true`. Redeploy (required since it's a NEXT_PUBLIC flag baked at build time).

After redeploy, confirm:
- Service Suite customer-360 view shows a "Properties" section for a customer you know has properties.
- Deals detail panel address row is clickable.
- Clicking either opens the `<PropertyDrawer>` with correct data.

### 7.3.2 Monitor

- Ping #ops Slack announcing the feature is live.
- Watch bug report endpoint for 2 hours.
- If a blocking regression is reported: flip the flag back to `false` and redeploy. This is pure-UI so revert is safe.

---

## Task 7.4 — Docs

### 7.4.1 CLAUDE.md

Already done on branch (commit `360a6513`).

### 7.4.2 hubspot-integration-guide.docx

Open `docs/hubspot-integration-guide.docx` in Word. Find (or create) the "Custom Objects" section. Paste the content from `docs/superpowers/runbooks/hubspot-integration-guide-property-patch.md` verbatim, substituting the prod object type ID + association IDs you captured in 7.2.2.

Commit the updated `.docx`:

```bash
git add docs/hubspot-integration-guide.docx
git commit -m "docs(property): integration guide object type IDs"
```

---

## Rollback

If anything goes wrong in 7.2 between 7.2.5 (flag flip) and 7.2.8 (soak):

1. Vercel → `PROPERTY_SYNC_ENABLED=false` → redeploy. Webhooks return 200 immediately, no new cache writes.
2. Cron short-circuits on the next tick.
3. Backfill refuses to start (checks the flag).
4. The cache tables retain whatever was written, but it's inert. No user-visible impact because `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED` is still false.
5. Investigate root cause at leisure. No data loss.

If 7.3 UI rollout has a regression: flip `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED=false` → redeploy. UI reverts.

If schema needs rolling back (nuclear option, not expected): write a down-migration for the 6 property tables + 3 ActivityType enum values. Don't do this casually — the backfilled data is valuable even if the feature pauses.

---

## Sandbox findings

<!-- Fill in after 7.1 runs. Delete this section if no surprises. -->
