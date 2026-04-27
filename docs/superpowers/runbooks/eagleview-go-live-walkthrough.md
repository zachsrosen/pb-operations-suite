# EagleView TrueDesign Auto-Order — Go-Live Walkthrough

**Photon Brothers integration with EagleView Measurement Orders API**

This document walks through the integration we've built against your sandbox environment, ahead of production go-live approval. It's intended as a written substitute for a live demo — the same content a screenshare would cover, organized so you can review at your own pace.

App ID: `0oa1aratxjgrvZmCb2p8` (PB Tech Ops Suite - Production)
Current Go-Live status: REQUESTED (pending review)

---

## Use case

Photon Brothers installs ~150 solar systems per week across five Colorado offices. For every solar deal:

1. A site survey is scheduled with the customer (HubSpot tracks `site_survey_schedule_date`)
2. A surveyor needs access to roof measurements + panel layout + shade analysis at the site
3. Today, our designers manually order a TrueDesign for Planning report through your web UI for each deal — a real time sink and frequent source of "surveyor showed up without files" issues

We built an automated pipeline:

> When a HubSpot deal with `project_type` containing "Solar" has a `site_survey_schedule_date` set, our system places a TDP order via your **Measurement Orders API** the day before, drops the deliverables in the deal's Drive folder, and notifies the crew.

Volume: 30–50 TDP orders/week initially, scaling to ~150/week as we roll out across all five offices.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  HubSpot                                                                 │
│  Workflow: "EagleView TrueDesign Auto-Order (Day Before Survey)"         │
│    Trigger:  project_type contains "Solar"                               │
│              AND site_survey_schedule_date is known                      │
│    Delay:    until site_survey_schedule_date - 1 day @ 4am MT            │
│    Action:   POST /api/webhooks/hubspot/eagleview-tdp-order              │
│              (HubSpot v3 signed)                                         │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  PB Tech Ops Suite (Vercel-hosted Next.js)                               │
│  ────────────────────────────────────────                                │
│   1. Webhook handler verifies HubSpot signature                          │
│   2. Pipeline orchestrator (idempotency claim by                         │
│      dealId + productCode + addressHash)                                 │
│   3. EagleView client (lib/eagleview.ts)                                 │
│      → POST /oauth2/v1/token  (client_credentials)                       │
│      → POST /v1/Product/SolarProductAvailability                         │
│      → POST /v2/Order/PlaceOrder  (productId 91 = TDP)                   │
│   4. EagleViewOrder DB row (status=ORDERED)                              │
│   5. HubSpot note posted on the deal                                     │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  EagleView pushes FileDelivery webhook when files ready                  │
│  ────────────────────────────────────────────────────                    │
│  → POST https://www.pbtechops.com/api/webhooks/eagleview/file-delivery   │
│       (HMAC-validated; awaiting allowlist on EV side post-Go-Live)       │
│  Cron poller every 30 min as safety net for missed pushes                │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Files dropped in deal's Drive folder                                    │
│   /design-docs/<deal>/eagleview/<reportId>/                              │
│  EagleViewOrder.status → DELIVERED                                       │
│  HubSpot note posted with file links                                     │
│  SSE broadcast refreshes any open Solar Surveyor sessions                │
└──────────────────────────────────────────────────────────────────────────┘
```

Spec: [`docs/superpowers/specs/2026-04-24-eagleview-truedesign-auto-pull-design.md`](https://github.com/zachsrosen/pb-operations-suite/blob/main/docs/superpowers/specs/2026-04-24-eagleview-truedesign-auto-pull-design.md)
Plan: [`docs/superpowers/plans/2026-04-24-eagleview-truedesign-auto-pull.md`](https://github.com/zachsrosen/pb-operations-suite/blob/main/docs/superpowers/plans/2026-04-24-eagleview-truedesign-auto-pull.md)

---

## Demo: live API integration on a real deal

**Test deal:** PROJ-9750 (Jess Smith), 8256 Park Rd, Rye, CO 81069. Survey scheduled 2026-04-29.

### 1. Initial state — panel rendered on the deal review page

`https://www.pbtechops.com/dashboards/reviews/59382535039`

The EagleView TrueDesign panel renders inside the deal review surface with a single primary action — "Pull EagleView Files" — when no order exists yet for the deal. This is the surface designers + surveyors interact with directly. Auto-orders fire silently in the background via the HubSpot workflow on a day-before-survey schedule; the panel gives ops a manual escape hatch + status visibility for ad-hoc orders or rescheduled surveys.

### 2. Click "Pull EagleView Files" → real API call against your sandbox

The button posts to our `/api/eagleview/order` endpoint, which:

1. Fetches the deal's address from HubSpot (`address_line_1`, `city`, `state`, `postal_code`)
2. Acquires an idempotency claim in our DB on `(dealId, productCode=TDP, addressHash)`
3. Calls your OAuth2 token endpoint with our sandbox `client_id:client_secret`
4. Calls `/v1/Product/SolarProductAvailability` to confirm TDP is available at the address
5. Calls `/v2/Order/PlaceOrder` for `PrimaryProductId: 91` (TrueDesign for Planning)
6. Persists the resulting `ReportId` to our `EagleViewOrder` table

### 3. Result: panel reflects real EV API response

After clicking, the panel re-renders to show the order's current state. The header gets a status badge (`ORDERED`, `DELIVERED`, `FAILED`, etc.), and the body changes based on outcome:

- **ORDERED** → "Ordered <relativeTime> — files arrive within ~30 min. Report #<reportId>"
- **DELIVERED** → relative-time delivered + clickable links to each Drive file (folder, aerial, layout, shade, report PDF)
- **FAILED** → red error message with the `errorMessage` from the orchestrator + a "Retry Order" button

In live testing against the Rye, CO address, the response was a `FAILED` state with `errorMessage="availability_check_failed"`. The Rye, CO address routes to your sandbox's limited test geography, which doesn't support `productId: 91` for this property — your API correctly returned that, our orchestrator captured it, persisted `status=FAILED`, and the UI showed the result with a Retry button. Round-trip from button click to UI update: ~3 seconds.

This is the expected sandbox behavior. The integration is working as designed — once we have production access, the same flow will return real availability + place real orders + receive real files.

(For sandbox-orderable test addresses like the OpenAPI example San Clemente property, the call returns `IsAvailable: true, ProductId: 91` — verified during build.)

---

## HubSpot workflow

`https://app.hubspot.com/workflows/21710069` — workflow ID `1810800163`

Configured in HubSpot's Workflows UI rather than via API because the Workflows API is limited for filter + delay + signed-webhook flows.

**Trigger conditions:**
- `Project Type` is any of `Solar`
- AND `Site Survey Schedule Date` **is Tomorrow** (HubSpot's relative date filter — equivalent to "delay until D-1")
- AND `Deal stage` is any of `Site Survey (Project Pipeline)` (additional safety filter)

**Action:**
- POST to `https://www.pbtechops.com/api/webhooks/hubspot/eagleview-tdp-order`
- Body: `{"dealId": "{{deal.hs_object_id}}", "surveyDate": "{{deal.site_survey_schedule_date}}"}`
- Authentication: HubSpot v3 signature header (App ID 29230185)

**Re-enrollment:** ON when `site_survey_schedule_date` changes, so a rescheduled survey re-triggers the order with the new date. Idempotency keyed on `addressHash` ensures the same address isn't re-ordered if only the date moved.

---

## EagleView API client

[`src/lib/eagleview.ts`](https://github.com/zachsrosen/pb-operations-suite/blob/main/src/lib/eagleview.ts) — class-based client following our standard vendor-integration pattern.

**Notable design choices:**

- **Token caching with auto-refresh on 401.** A `cachedTokenExpiresAtMs` timestamp tracks expiry; the client refreshes 60s early.
- **Concurrent token request coalescing** (`inflightTokenPromise`) so a burst of concurrent calls only does one OAuth handshake, not N.
- **Exponential backoff on 429 / 5xx**, max 3 retries, immediate fail on 401/403/404.
- **Sentry breadcrumbs** for observability of every retry.
- **camelCase request bodies** — your OpenAPI spec describes fields in PascalCase (`Address`, `Latitude`, ...), but the live API requires camelCase. Worth fixing in your docs to save the next integrator a few hours; we hit a misleading "latitude must be between 16 and 70" error before figuring it out.

**Test coverage:** 33 unit tests on the client + the orchestrator pipeline + dedup helpers. Mocked `fetch`, retry behavior, token cache reuse, 401-refresh-and-retry, camelCase body shape verification.

---

## Webhook receiver for FileDelivery

[`src/app/api/webhooks/eagleview/file-delivery/route.ts`](https://github.com/zachsrosen/pb-operations-suite/blob/main/src/app/api/webhooks/eagleview/file-delivery/route.ts)

When you push file URLs to us via your `FileDelivery` endpoint, we:

1. Validate the HMAC signature (envvar `EAGLEVIEW_WEBHOOK_SECRET`, ready to share with your team during cutover)
2. Look up the `EagleViewOrder` row by `ReportId`
3. Call `GET /v3/Report/{reportId}/file-links` to retrieve signed download URLs
4. Download each file and upload to the deal's Drive folder
5. Update `EagleViewOrder.status = DELIVERED` and populate Drive file IDs
6. Post a HubSpot note linking the files

A 30-minute cron poller (`/api/cron/eagleview-poll-orders`) acts as a safety net for missed `FileDelivery` webhooks — checks any `ORDERED` rows older than 5 min and pulls files via the same flow.

**Production webhook URL to allowlist:**
`https://www.pbtechops.com/api/webhooks/eagleview/file-delivery`

The bearer secret (`EAGLEVIEW_WEBHOOK_SECRET`) is stored encrypted in our Vercel production environment and ready to share during cutover coordination.

---

## EagleView Developer Portal — current state

Our production app on the developer portal:
- **App name:** PB Tech Ops Suite - Production
- **App ID:** `0oa1aratxjgrvZmCb2p8`
- **Use case:** System Integration
- **Auth:** Client Credentials
- **API Collections:** Measurement Orders
- **Environment:** PRODUCTION (sandbox app remains for our continued dev/test)
- **Go-Live status:** REQUESTED ⏳

---

## What we need from your team

1. **Approve Go-Live** on app `0oa1aratxjgrvZmCb2p8`. Volume estimate: 30–50 TDP/week initially, ~150/week at full rollout.

2. **Allowlist our FileDelivery webhook URL** in your production environment:
   `https://www.pbtechops.com/api/webhooks/eagleview/file-delivery`
   (We'll send the shared bearer secret via secure channel during the cutover call.)

3. **Confirm webhook signing scheme** for `FileDelivery` (HMAC-SHA256 expected — let us know if different so we can match).

## Cutover plan once approved

We'll do this in a single deploy window:

1. Swap five Vercel production env vars (production credentials replace sandbox ones; flag flips to enabled)
2. Trigger redeploy
3. Toggle the HubSpot workflow's automated re-enrollment on
4. Send you the bearer secret for FileDelivery allowlist via secure email/Slack
5. Monitor first 24 hours via Sentry + DB inspection

End-to-end live within 30 minutes of approval.

---

## Questions / contacts

- **Zach Rosen** (zach.rosen@photonbrothers.com / zach@photonbrothers.com) — engineering lead on this integration
- **Wes Benscoter** (wes.benscoter@photonbrothers.com) — project manager
- **Jacob Campbell** (jacob.campbell@photonbrothers.com) — design ops

Happy to hop on a quick call if anything in here needs more depth.

Thanks for the partnership.
