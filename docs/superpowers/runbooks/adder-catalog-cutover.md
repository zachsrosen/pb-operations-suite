# Adder Catalog Cutover Runbook

## Precondition checklist

- [ ] Phase 0 canonical CSV exists at `scripts/data/adders-seed.csv`
- [ ] All Phase 1 migrations applied to prod DB (adder_catalog, adder_can_manage_permission, role_override_can_manage_adders)
- [ ] OpenSolar Pre-Phase Discovery doc filled in
- [ ] `src/lib/adders/opensolar-client.ts` updated with real endpoints
- [ ] Vercel prod env vars set: `OPENSOLAR_API_TOKEN`, `OPENSOLAR_ORG_ID`, `ADDER_SYNC_ENABLED=false`
- [ ] Seed loaded in staging: `npx tsx scripts/seed-adders.ts scripts/data/adders-seed.csv`
- [ ] Catalog UI (`/dashboards/adders`) audited by owner

## Cutover

1. In staging, flip `ADDER_SYNC_ENABLED=true`. Verify sync run via `/api/adders/sync` manual trigger. Inspect `AdderSyncRun` rows.
2. Confirm OpenSolar catalog mirrors PB for a sample of 5 adders (spot-check prices, shop overrides).
3. Pilot triage UI with 2-3 reps for 1 week in staging. Collect feedback on question wording, photo capture, flow pacing. Iterate.
4. Production cutover window:
   - (a) Flip `ADDER_SYNC_ENABLED=true` in prod
   - (b) OpenSolar admin: lock down rep ability to create free-form adders (requires Discovery Q1 confirmed yes)
   - (c) Update sales-to-ops handoff SOP to require triage completion
   - (d) Announce to sales
5. Monitor for 2 weeks:
   - `AdderSyncRun` success rate daily
   - `TriageRun` submission rate weekly
   - Customer-facing change order volume (should trend down)

## Rollback

- Flip `ADDER_SYNC_ENABLED=false` (stops sync, staged writes remain)
- Ask OpenSolar admin to re-enable free-form adder creation
- Announce pause to sales
- Investigate; re-cutover when ready

## Metrics to watch

- Sync run success rate (target: >95%)
- Triage submission rate (target: 80% within 60 days post-cutover)
- Adders-per-deal median (should increase — catching adders earlier)
- Change order rate per deal (should decrease quarter-over-quarter)
