# EagleView TrueDesign Auto-Pull — Rollout Runbook

**Spec:** `docs/superpowers/specs/2026-04-24-eagleview-truedesign-auto-pull-design.md`
**Plan:** `docs/superpowers/plans/2026-04-24-eagleview-truedesign-auto-pull.md`

## Status as of 2026-04-24

| Step | Status |
|------|--------|
| Code merged to `main` | ✅ PR #404 merged |
| Production deploy | ✅ Live at `https://www.pbtechops.com` |
| Migration applied to prod DB | ✅ `20260424200000_add_eagleview_order` |
| Sandbox API access provisioned | ✅ App "PB Tech Ops Suite" |
| Vercel prod env vars (7) | ✅ All set (sandbox values) |
| Production webhook route reachable | ✅ Signature validation working |
| EagleView Go-Live request | ⛔ Manual — see below |
| HubSpot workflow configured | ⛔ Manual — see below |
| Solar Surveyor `<EagleViewPanel>` placement | ⛔ Architectural follow-up |
| `EAGLEVIEW_AUTO_PULL_ENABLED=true` flip | ⛔ After Go-Live |

## Remaining manual steps

### 1. Configure HubSpot Workflow (10 min in HubSpot UI)

The Workflows API schema is too complex for confident programmatic creation. Build it in the UI:

1. Go to **HubSpot → Automation → Workflows → Create workflow**
2. Choose **Deal-based**, "From scratch"
3. **Enrollment criteria** — match all of:
   - `project_type` _contains any of_ "Solar" (case-insensitive)
   - `site_survey_schedule_date` _is known_
   - Re-enrollment: ✅ ON, on `site_survey_schedule_date` change
4. **Action 1: Delay** — Until property date, configured as:
   - Property: `site_survey_schedule_date`
   - Offset: `-1 day`
   - Time-of-day: `4:00 AM`
   - Time zone: `America/Denver`
5. **Action 2: Webhook**
   - Method: `POST`
   - URL: `https://www.pbtechops.com/api/webhooks/hubspot/eagleview-tdp-order`
   - Body (JSON, custom payload):
     ```json
     {
       "dealId": "{{deal.hs_object_id}}",
       "surveyDate": "{{deal.site_survey_schedule_date}}"
     }
     ```
   - Authentication: **HubSpot Signature v3** (signing handled by HubSpot using the workflow webhook secret)
6. **Activate** when ready (after #2 below)

A reference JSON sketch is at `docs/superpowers/runbooks/eagleview-hubspot-workflow.json` — useful for confirming the right field names but the live API rejects it without `type` discriminators on nested objects.

### 2. EagleView Go-Live request (1–2 days, EV business review)

1. Log into [EagleView Developer Portal](https://developer.eagleview.com/apps)
2. Click **Create app** → choose **Production** environment + System Integration / Client Credentials + Imagery, WMTS, Property Data, Measurement Orders collections (matches existing sandbox app)
3. Submit the Go-Live request via the portal banner
4. Coordinate with Geoff Green / Santosh Choppadandi (EV) for approval
5. Once approved, retrieve production `client_id` / `client_secret`
6. Replace Vercel env vars:
   - `EAGLEVIEW_CLIENT_ID` — production value
   - `EAGLEVIEW_CLIENT_SECRET` — production value
   - `EAGLEVIEW_BASE_URL` — `https://apicenter.eagleview.com`
   - `EAGLEVIEW_SANDBOX` — `false`
7. Send Santosh the production webhook URL for FileDelivery allowlist:
   - `https://www.pbtechops.com/api/webhooks/eagleview/file-delivery`
   - Bearer secret: read `EAGLEVIEW_WEBHOOK_SECRET` from Vercel prod (already encrypted)

### 3. Solar Surveyor placement (architectural follow-up)

The `SolarSurveyorShell` runs on `SolarProject` records, which don't currently track HubSpot `dealId`. To surface the panel cleanly in Solar Surveyor:

1. Add `dealId String?` to `SolarProject` schema
2. Migration to backfill where possible (skip — opt-in moving forward)
3. Wizard step / modal field to set/edit `dealId` on a project
4. Pass through `SolarSurveyorShell → ClassicWorkspace` etc., conditionally render `<EagleViewPanel dealId={project.dealId}>` when set

**Defer this** — the deal review page placement at `/dashboards/reviews/[dealId]` covers the immediate "manual button" need. This is a follow-up worth its own spec.

### 4. Pilot rollout

Once #1 + #2 are done:

1. Pick a single test deal in HubSpot. Manually populate `project_type=Solar` + `site_survey_schedule_date=tomorrow`. Watch the workflow enroll → delay → fire.
2. Watch `EagleViewOrder` rows appear in Postgres + files land in the deal's Drive folder.
3. After a clean dry-run, flip `EAGLEVIEW_AUTO_PULL_ENABLED=true` in Vercel prod.
4. Monitor for 1 week — check `EagleViewOrder` rows + Drive folders + Sentry breadcrumbs (`feature: eagleview`).

## Verification you can run today (manual button works against sandbox)

1. Visit `https://www.pbtechops.com/dashboards/reviews/<some-real-deal-id>` while logged in
2. Click **Pull EagleView Files** in the EagleView panel
3. Sandbox returns a Hampton VA test response with limited products available — but the request flow + DB row + Drive folder creation should all work end-to-end
4. Check `EagleViewOrder` table in prod DB for the new row

If the manual button errors, check Sentry for `feature: eagleview` breadcrumbs.

## Rollback

If TDP orders start firing incorrectly:

1. **Immediate kill switch:** `vercel env rm EAGLEVIEW_AUTO_PULL_ENABLED production && vercel env add EAGLEVIEW_AUTO_PULL_ENABLED production` (set to `false`). Webhook fails open with 200 → no more orders.
2. **Stop the HubSpot workflow:** Toggle to disabled in HubSpot UI.
3. **Cancel pending orders:** Update `EagleViewOrder` rows in `ORDERED` status to `CANCELLED` via SQL — EV charges per delivered report, so canceling pre-delivery prevents charges.
