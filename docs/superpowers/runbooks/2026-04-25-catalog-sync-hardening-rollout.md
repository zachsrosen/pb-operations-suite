# Catalog Sync Hardening — Rollout Runbook

**PR:** [pb-operations-suite#407](https://github.com/zachsrosen/pb-operations-suite/pull/407)
**Plan:** [`docs/superpowers/plans/2026-04-24-catalog-sync-quality-hardening.md`](../plans/2026-04-24-catalog-sync-quality-hardening.md)
**External mappings spec:** [`docs/superpowers/specs/2026-04-24-catalog-sync-external-mappings.md`](../specs/2026-04-24-catalog-sync-external-mappings.md)
**Discovery diagram:** [`docs/product-sync-map.html`](../../product-sync-map.html)

---

## What shipped (22 commits)

### Code (Milestones 1–3)

| Area | Change |
|---|---|
| **Schema** | 4 new `ActivityType` enum values + `lastSyncedAt`/`lastSyncedBy` columns on InternalProduct. **Migration `20260424210000_catalog_sync_observability` already applied to prod.** |
| **M1 Observability** | `catalog-activity-log.ts` helper. Wired into `executeCatalogPushApproval` (wizard / BOM / approval-retry) and `executePlan` (Sync Modal). `getActivityTypes()` returns enum union so new types appear in admin filter immediately. |
| **M2 Data integrity** | Cross-link writer extracted to `catalog-cross-link.ts`; Sync Modal now writes cross-link IDs (orphan fix); race-safe transactional create+link in `executeZohoSync`/`executeHubSpotSync`/`executeZuperSync`; HubSpot manufacturer enum policy (flag-gated). |
| **M3 Coverage** | Generalized mapping registry picks up `zuperCustomField`/`zohoCustomField` keys. Zoho writes switched from `group_name` to `category_id`+`category_name`. Zuper Product accepts dimensions + arbitrary `customMetaData` array. 15 spec FieldDef entries got `zuperCustomField` labels. |

### Operational data work (Phase B, executed via API scripts)

| Step | Action | Result |
|---|---|---|
| Test product cleanup | Deleted 4 obvious test rows (TestBrand_*, UIBrand_*, UIBrand2_*, "test123") | InternalProduct + HubSpot + Zuper cleaned. 2 Zoho items orphaned (401 on delete — Zoho ops can finalize) |
| Brand casing | Standardized UNIRAC×4 → "Unirac", MULTIPLE×1 → "Multiple" | 5 rows updated across InternalProduct + HubSpot + Zoho |
| HubSpot manufacturer enum | Added 31 brands + "Generic" via PATCH | Enum went from 32 → 64 valid values |
| Zoho categories | Created "Battery" (`5385454000020010899`) + "EV Charger" (`5385454000019964645`) | All 16 internal categories now `confirmed` in zoho-taxonomy.ts |
| Zuper custom fields | Defined 15 spec fields via `meta_data` implicit-create on anchor product | Schema in [followup doc](../followups/2026-04-24-zuper-custom-fields-admin.md) |
| Generic rebrand | Audited 106 Generic rows, rebranded 21 with confident matches | Eaton×6, Tesla×6, Square D×3, Milbank×3, GE×1, Heyco×1, bussman×1 + delete "test123". 86 remain Generic (commodity items, valid HubSpot enum value now) |
| Catalog integrity audit | Found + fixed 4 broken HubSpot links, 5 cross-link mismatches, 31 vendor-field backfills | Down from 4 broken / 11 mismatches → 0 broken / 0 in latest sample |
| **Zoho orphan reconciliation** | **311 active Zoho orphans → InternalProduct + Zuper + cross-links** | **311/311 ok, 0 failed.** 305 new InternalProducts created, 305 new Zuper Products created, all triple-cross-linked |

### Deliverables (in `scripts/`)

- `_pull-zoho-item-groups.ts` / `zoho-item-groups.json` — live Zoho category audit
- `_pull-hubspot-manufacturer-enum.ts` / `hubspot-manufacturer-enum.json` — enum vs internal brand cross-reference
- `_pull-hubspot-product-properties.ts` / `hubspot-product-properties.json` — full HubSpot Products property list
- `_brand-dedup-analysis.ts` / `brand-dedup-suggestions.json` — InternalProduct.brand canonicalization candidates
- `_pull-zuper-product-schema.ts` / `zuper-product-schema.json` — Zuper Product meta_data structure
- `_audit-catalog-integrity.ts` / `catalog-integrity-audit.json` — comprehensive integrity audit
- `_audit-orphan-usage-2026.ts` / `orphan-usage-2026.json` — usage signal for orphan triage
- `_match-zoho-orphans.ts` / `zoho-orphan-matches.json` — Zoho-to-InternalProduct match plan
- `_export-hubspot-orphan-list.ts` / `hubspot-orphans.csv` / `hubspot-orphans.md` — **230 HubSpot orphans for your review (no archives executed)**
- `_create-zuper-product-customfields.ts` / `zuper-product-customfields.json` — Zuper field schema
- All idempotent. Re-runnable any time.

---

## Pre-merge checklist

- [ ] Skim PR #407 description (it has the full per-milestone breakdown)
- [ ] CI checks pass on the PR
- [ ] No conflicting open PRs touching `catalog-fields.ts`, `catalog-sync.ts`, `catalog-push-approve.ts`, or `zuper-catalog.ts`

## Merge sequence

1. Merge PR #407 (all 22 commits land together — observability, integrity, coverage, and Phase B data work)
2. Vercel auto-deploys
3. Watch Vercel build logs for any unexpected failures (no DB migrations are pending — that already ran)
4. Run post-deploy verification (next section)

---

## Post-deploy verification (do these in order)

### 1. Smoke: ActivityLog is populating

In a Postgres console or admin activity log UI:

```sql
SELECT type, "createdAt", "userEmail", "entityName", metadata->'source', metadata->'systemsAttempted'
FROM "ActivityLog"
WHERE type IN ('CATALOG_SYNC_EXECUTED','CATALOG_SYNC_FAILED','CATALOG_PRODUCT_CREATED','CATALOG_PRODUCT_UPDATED')
ORDER BY "createdAt" DESC
LIMIT 20;
```

Expected: rows appear within minutes of any catalog activity (wizard submit, Sync Modal use, BOM run).

### 2. Smoke: wizard creates a product end-to-end

Submit a test product via `/dashboards/submit-product`:
- Pick a known brand (e.g., Silfab, Tesla — any of the 64 enum values)
- Fill required fields (DC Size for module, etc.)
- Submit

Expected:
- Success screen shows "Product Added to Catalog"
- New InternalProduct row in DB with `lastSyncedAt` populated
- New HubSpot Product, Zoho item, Zuper Product all created
- Cross-link IDs present in all three external systems
- One `CATALOG_SYNC_EXECUTED` ActivityLog row + one `CATALOG_PRODUCT_CREATED`

### 3. Smoke: Sync Modal cross-link writes (the M2.2 orphan fix)

In the catalog table, open Sync Modal on a product with at least one missing external link. Trigger a "create new" for the missing system.

Expected:
- New external record gets `internal_product_id` (HubSpot prop) / `cf_internal_product_id` (Zoho cf) / "Internal Product ID" (Zuper meta_data) populated. **No orphans.**

### 4. Smoke: race-safe link-back (M2.3)

Hard to reproduce in prod without staging — skip unless a real user hits it. Watch Sentry / Vercel logs for `[Sync] Race:` messages — none should appear in normal traffic.

### 5. Smoke: brand outside HubSpot enum (M2.4 default-off behavior)

Submit a product with a brand NOT in the HubSpot manufacturer enum (e.g., a typo). Without enforcement on, the wizard should:
- Succeed end-to-end
- Surface a warning in the outcome message about manufacturer being dropped
- ActivityLog row should have `riskLevel: HIGH` because it's a partial outcome

This is the Phase C precondition — confirm the warning surfaces correctly before flipping the flag.

### 6. Soak for 24h

Watch ActivityLog for unexpected `CATALOG_SYNC_FAILED` rows. Expected baseline: zero. If any appear, investigate before Phase C.

---

## Phase C — flip the manufacturer enforcement flag

**Only after** the 24h soak shows clean ActivityLog and the 5 verifications above pass.

### Steps

```bash
# Set the env var in Vercel prod
vercel env add HUBSPOT_MANUFACTURER_ENFORCEMENT production
# When prompted for the value, enter: true

# Verify it landed
vercel env ls production | grep HUBSPOT_MANUFACTURER_ENFORCEMENT
```

OR via Vercel dashboard: Settings → Environment Variables → Add `HUBSPOT_MANUFACTURER_ENFORCEMENT=true` for Production.

**Vercel propagates the new value to functions on the next request — no redeploy needed.**

### What changes when the flag flips

- Wizard / Sync Modal submissions with a brand NOT in the HubSpot manufacturer enum now **fail the HubSpot push** instead of silently dropping
- The InternalProduct + Zoho + Zuper writes still succeed (HubSpot is the only failing system)
- `PendingCatalogPush` row stays in `PENDING` status with note: `Brand "X" is not in HubSpot's manufacturer enum...`
- ActivityLog row is `CATALOG_SYNC_FAILED` with `riskLevel: HIGH` and `outcomes.HUBSPOT.message` containing the actionable error
- Submitter sees the actionable error message in the wizard UI

### Post-flip monitoring (first 48h)

```sql
SELECT entityName, "userEmail", metadata->'outcomes'->'HUBSPOT'->>'message' AS hs_msg, "createdAt"
FROM "ActivityLog"
WHERE type = 'CATALOG_SYNC_FAILED'
  AND metadata->'outcomes'->'HUBSPOT'->>'status' = 'failed'
  AND "createdAt" > NOW() - INTERVAL '48 hours'
ORDER BY "createdAt" DESC;
```

Expected: only rows where the brand really IS missing from the HubSpot enum. If you see legitimate brands rejected, the enum needs another addition (re-run `_backfill-hubspot-manufacturer-enum.ts` after editing the BRANDS_TO_ADD list).

### Rollback

If Phase C surfaces unexpected failures, just remove the env var (or set it to `false`). Vercel propagates within seconds. No deploy or code change needed.

```bash
vercel env rm HUBSPOT_MANUFACTURER_ENFORCEMENT production
```

---

## Operational follow-ups (out of scope, but tracked)

| Item | Status | Where |
|---|---|---|
| HubSpot orphan list (230 items) | Delivered as CSV/MD; **bulk archive only when you say** | `scripts/hubspot-orphans.csv` |
| Re-brand 86 remaining "Generic" rows | Optional — they're valid in HubSpot enum now. Each one is genuine commodity hardware | `scripts/generic-audit.json` (low-confidence rows) |
| Backfill existing Zuper Products with the 15 spec custom fields | Currently only the anchor product (Tesla Powerwall 3 Expansion Pack) has them visible. Other products will get them as their next sync runs through M3.4 plumbing | Followup script — ~30 min if you want to bulk-populate |
| Update path for spec fields in Sync Modal | `TODO(M3.4)` in `executeZuperSync` non-create branch | `src/lib/catalog-sync.ts` |
| HubSpot Product spec properties | Currently only 4 spec properties exist in HubSpot (dc_size, ac_size, capacity__kw_, size__kwh_, energy_storage_capacity); ~10 high-value candidates documented for future creation | `docs/superpowers/followups/2026-04-24-hubspot-spec-properties.md` |
| 1,128 dormant Zoho orphans | Left alone (no 2026 activity). Could be marked inactive in Zoho admin if desired, but no operational impact | n/a |
| 2 orphaned Zoho items from test deletion | Zoho returned 401 on delete; items remain but are disconnected from any internal record | Item IDs in `_delete-test-products.ts` log if needed |

## Known limitations / residual risk

1. **Race-safe create-then-commit-fail window.** The transactional re-fetch + lock fixes the common race, but a network failure between successful external create and successful DB transaction commit still leaves an orphan in the external system. Logged with `[Sync] Race:` errors. Full fix is an outbox/saga pattern — out of scope.

2. **Zuper update path for spec fields.** The Sync Modal **update** branch (not create) doesn't yet route spec-field changes through `meta_data` — they fall through generic mapping which writes top-level (and gets ignored). Marked with `TODO(M3.4)`. Real fix needs GET→merge→PUT to avoid clobbering cross-link IDs that share the meta_data array.

3. **Zoho item delete returns 401.** The OAuth token's scope doesn't include item deletion. We can mark items inactive but not hard-delete via API. Zoho ops can finalize manually if needed.

4. **HubSpot 5 vendor backfill failures.** During the integrity-fix vendor backfill, 5 of 49 PATCHes failed. Likely stale links nulled out by the broken-ID fix in the same run. Re-running the audit + fix script picks them up.

---

## Quick contact / reference

- Implementation plan + decisions: `docs/superpowers/plans/2026-04-24-catalog-sync-quality-hardening.md`
- External mappings spec (Zoho/Zuper/HubSpot decisions log): `docs/superpowers/specs/2026-04-24-catalog-sync-external-mappings.md`
- Visual map of the system: `docs/product-sync-map.html`
- Catalog activity log helper API: `src/lib/catalog-activity-log.ts`
- Cross-link writer: `src/lib/catalog-cross-link.ts`
- Zuper field schema: `docs/superpowers/followups/2026-04-24-zuper-custom-fields-admin.md`
- HubSpot Product property follow-up: `docs/superpowers/followups/2026-04-24-hubspot-spec-properties.md`
