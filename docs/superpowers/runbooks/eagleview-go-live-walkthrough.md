# EagleView TrueDesign Auto-Order — Integration Walkthrough

Photon Brothers integration with EagleView Measurement Orders API.

App ID: `0oa1aratxjgrvZmCb2p8` (PB Tech Ops Suite - Production)
Status: Go-Live REQUESTED

---

## Use case

When a Photon Brothers solar deal has a scheduled site survey, our internal ops platform automatically orders a TrueDesign for Planning report via your Measurement Orders API. Files are delivered to the deal's design folder before the surveyor arrives on site.

The flow replaces a manual ordering step our designers do today through your web UI.

---

## Architecture

```
CRM workflow (day before survey)
   ↓ signed webhook
PB Tech Ops Suite
   ↓ OAuth2 client_credentials → Bearer token
   ↓ /v1/Product/SolarProductAvailability
   ↓ /v2/Order/PlaceOrder  (productId 91 = TDP)
   ↓ persist order, idempotency on (deal, product, addressHash)
EagleView FileDelivery push (or 30-min poll fallback)
   ↓ /v3/Report/{reportId}/file-links
   ↓ download + store
Status visible to internal ops users
```

---

## Working integration against your sandbox

Verified end-to-end on a real internal test deal:

1. **OAuth2 token** — `POST /oauth2/v1/token` with Basic-encoded `client_id:client_secret` and `grant_type=client_credentials`. Returns access token, 3600s expiry. Cached + auto-refreshed 60s before expiry, with concurrent-request coalescing.

2. **Availability** — `POST /v1/Product/SolarProductAvailability` with the deal's address. Returns `availabilityStatus[].isAvailable` per product. Verified at the OpenAPI example San Clemente address: returned `productId: 91, isAvailable: true`.

3. **Place order** — `POST /v2/Order/PlaceOrder` for productId 91 (TDP). Returns `ReportId`, persisted to our `EagleViewOrder` table with `status=ORDERED`.

4. **Status surface** — internal UI reflects order state (`ORDERED` → `DELIVERED` → file links, or `FAILED` with retry).

5. **Error handling** — exponential backoff on 429/5xx (3 retries max). 401 triggers token refresh + single retry. 4xx surfaces directly to ops with the API's error message. All paths instrumented with structured logging.

6. **Idempotency** — `(dealId, productCode, addressHash)` unique constraint prevents accidental re-orders. Re-runs are no-ops.

7. **One docs note** — your OpenAPI spec describes request bodies in PascalCase (`Address`, `Latitude`...), but the live API requires camelCase. PascalCase returns a misleading `"latitude must be a number between 16 and 70"` error. Worth fixing in the spec to save the next integrator a few hours.

---

## CRM workflow

Configured in our CRM workflow editor (not via API — Workflows API has limited support for filter + delay + signed-webhook flows).

Trigger: solar-typed deals where a site survey is scheduled tomorrow.
Delay: until day-before-survey at 4 AM local time.
Action: signed webhook POST to our internal endpoint.

Webhook handler verifies the signature, runs the orchestration above, posts a status note back to the deal record on completion.

---

## FileDelivery receiver

Endpoint: `https://www.pbtechops.com/api/webhooks/eagleview/file-delivery`

Validates HMAC signature on inbound, looks up the `EagleViewOrder` row by `ReportId`, retrieves signed download URLs via `/v3/Report/{reportId}/file-links`, downloads each artifact, and updates the order record with file references.

A 30-minute cron poller acts as a safety net for missed webhooks — checks any `ORDERED` rows older than 5 min and pulls files via the same code path.

---

## What we need from EagleView

1. **Approve Go-Live** on app `0oa1aratxjgrvZmCb2p8`.
2. **Allowlist our FileDelivery webhook URL:**
   `https://www.pbtechops.com/api/webhooks/eagleview/file-delivery`
   (Bearer secret will be shared via secure channel during cutover.)
3. **Confirm webhook signing scheme** (HMAC-SHA256 expected; let us know if different).

## Cutover plan once approved

1. Swap production credentials + flip our feature flag (single deploy)
2. Send the FileDelivery bearer secret via secure channel
3. Toggle the CRM workflow re-enrollment on
4. Monitor first 24 hours

Live within 30 minutes of approval.

---

Happy to answer follow-ups by email or hop on a brief call if helpful.

— Zach Rosen, zach.rosen@photonbrothers.com
