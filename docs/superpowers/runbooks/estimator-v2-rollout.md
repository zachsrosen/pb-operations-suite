# Estimator v2 Rollout Runbook

**Status:** Not yet released. Follow this order.

The new estimator is feature-flagged off. Bringing it live is a three-stage rollout. Do not skip stages — the code and schema are coupled (see the prisma-before-code memory; additive fields break unrelated flows if the code ships before the migration).

---

## Stage 1 — Database migration

Deploy the migration SQL **before** merging any code PR that references new fields. The migration is additive (new enum values, new column, new table) and safe to apply live.

```bash
# From the main clone (not a worktree), with prod DATABASE_URL loaded:
npx prisma migrate deploy
```

This applies `20260421160000_estimator_v2`:
- Adds `ESTIMATOR_SUBMISSION` and `ESTIMATOR_OUT_OF_AREA` to `ActivityType`.
- Adds `EquipmentSku.defaultForEstimator` (Boolean, default false) + index.
- Creates the `EstimatorRun` table with indexes.

Confirm with:
```bash
psql "$DATABASE_URL" -c "\dt EstimatorRun" && echo OK
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"EstimatorRun\""  # should be 0
```

## Stage 2 — HubSpot custom properties (manual in HubSpot admin)

Create these properties **before** flipping the flag. They must exist or the submit route's deal creation will drop values silently.

### Deal properties — pipeline: Sales (env `HUBSPOT_PIPELINE_SALES`)

Group: **Estimator** (create the group too).

| Property internal name | Type | Field type |
|---|---|---|
| `estimator_system_size_kw` | Number | Decimal |
| `estimator_panel_count` | Number | Integer |
| `estimator_annual_production_kwh` | Number | Integer |
| `estimator_offset_percent` | Number | Decimal |
| `estimator_retail_usd` | Number | Integer |
| `estimator_incentives_usd` | Number | Integer |
| `estimator_final_usd` | Number | Integer |
| `estimator_monthly_payment_usd` | Number | Integer |
| `estimator_has_ev` | Boolean | Checkbox |
| `estimator_has_panel_upgrade` | Boolean | Checkbox |
| `estimator_considers_battery` | Boolean | Checkbox |
| `estimator_considers_new_roof` | Boolean | Checkbox |
| `estimator_results_token` | Text | Single-line |
| `estimator_source` | Text | Single-line |

### Contact properties

Group: **Marketing** (or existing equivalent).

| Property internal name | Type | Field type |
|---|---|---|
| `waitlist_zip` | Text | Single-line |

## Stage 3 — Vercel prod env vars

Add these to Vercel project settings → Environment variables → Production **before** flipping the public flag. Missing vars will either fail requests or fall back to insecure defaults.

```
NEXT_PUBLIC_ESTIMATOR_V2_ENABLED=false   # flip to true last
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=<site key from Google reCAPTCHA admin>
RECAPTCHA_SECRET_KEY=<secret key, server-only>
IP_HASH_SALT=<openssl rand -hex 32>
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=<Google Cloud key with Places API restriction>
GOOGLE_MAPS_STATIC_API_KEY=<Google Cloud key with Static Maps restriction; server-only>
HUBSPOT_PIPELINE_SALES_FIRST_STAGE=<stage internal name if different from default "appointmentscheduled">
```

Verify:
```bash
vercel env ls production | grep -E "ESTIMATOR|RECAPTCHA|IP_HASH_SALT|GOOGLE_PLACES|GOOGLE_MAPS_STATIC"
```

## Stage 4 — Default panel

Pick one `InternalProduct` with `category = 'MODULE'` and flip `defaultForEstimator = true`:

```sql
-- Pick the current production default panel. Example:
UPDATE "EquipmentSku"
SET "defaultForEstimator" = true
WHERE id = '<panel product id>';

-- Verify exactly one is flagged:
SELECT id, brand, model FROM "EquipmentSku"
WHERE category = 'MODULE' AND "defaultForEstimator" = true;
```

If no product is flagged, the engine falls back to 440W with a Sentry warning. Multiple flagged products will log a warning and pick the first.

## Stage 5 — Deploy code (flag off)

```bash
vercel --prod
```

Verify:
- `/estimator` loads and shows "Coming soon" (because flag is `false`).
- `/api/estimator/quote` returns 401/403? — no, it's public; hitting it without valid body should return 400.
- `/api/cron/estimator-cleanup` returns 401 without bearer.

## Stage 6 — Staff-IP staging test

On Vercel, set `NEXT_PUBLIC_ESTIMATOR_V2_ENABLED=true` temporarily in a preview branch or use a staff-only override (the feature flag is simple on/off in v1; stricter IP gating can be added later).

Walk through:
1. Start a quote with a known Denver address.
2. Verify roof tile renders.
3. Fill usage with Xcel + 1000 kWh/mo.
4. Submit with a staff-owned email.
5. Verify:
   - `EstimatorRun` row exists.
   - HubSpot contact + deal created in sales pipeline.
   - Estimator result email arrives.
   - `/estimator/results/[token]` loads and re-prices on add-on toggle.

## Stage 7 — Public rollout

Set `NEXT_PUBLIC_ESTIMATOR_V2_ENABLED=true` in production env and redeploy (or re-promote).

Coordinate with marketing to update the iframe on `photonbrothers.com/learn/estimator` to point at `https://app.photonbrothers.com/estimator`. Alternative: a simple 301 redirect on the marketing site.

## Monitoring

Daily for the first week:
- `prisma.estimatorRun.count({ where: { createdAt: { gte: <24h ago> }}})` for traffic.
- HubSpot Sales pipeline: new deals tagged `estimator_source = public_estimator_v2`.
- `ActivityLog` entries of type `ESTIMATOR_SUBMISSION` and `ESTIMATOR_OUT_OF_AREA`.
- Reconcile cron output: look for `examined > 0 && succeeded < examined` → investigate HubSpot or deal-property drift.
- Rate-limit 429s via Vercel logs — if frequent, raise the limit.
- `flaggedForReview: true` rows — recaptcha borderline scores; review manually.

## Rollback

Flip `NEXT_PUBLIC_ESTIMATOR_V2_ENABLED=false`. The database + HubSpot props remain harmlessly in place; no code changes.

## Phase 2+ follow-ups

Tracked as separate specs, not this rollout:
- EV Charger / Battery / Detach & Reset / System Expansion flows.
- Internal rep-facing surface at `/dashboards/estimator` with overrides.
- Admin UI for editing incentives / utilities / service area (currently JSON in `src/lib/estimator/data/`).
- Integration with v12 solar engine for higher-fidelity sizing after an EagleView measurement is available.
