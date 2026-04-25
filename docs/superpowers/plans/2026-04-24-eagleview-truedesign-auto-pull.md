# EagleView TrueDesign Auto-Pull — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-24-eagleview-truedesign-auto-pull-design.md`
**Date:** 2026-04-24
**API spec source:** `~/Downloads/Measurement Order API Documentation.json` (downloaded from EV developer portal 2026-04-24)
**Sandbox base:** `https://sandbox.apicenter.eagleview.com`
**Production base:** `https://apicenter.eagleview.com` (gated behind Go-Live request)
**API collection:** Measurement Orders (already enabled on PB Tech Ops Suite app)

> **Note:** Earlier draft of this plan targeted the TrueDesign API directly. After portal investigation: TrueDesign API requires User Authorization / OAuth Authorization Code with PKCE — meant for SPAs. Our autonomous server-to-server flow uses Measurement Orders (Client Credentials), which DOES support ordering TrueDesign products and returns "TrueDesign measurement data" through `/file-links`.

## Concrete API Surface (from OpenAPI spec)

| Step | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| 0 | `/GetAvailableProducts` | GET | One-time discovery: confirm which `PrimaryProductId` is TDP (likely 91, supported IDs are 11/62/90/91) |
| 1 | `/v1/Product/SolarProductAvailability` | POST | Check TDP available at address before ordering |
| 2 | `/v2/Order/PriceOrder` | POST | Optional pre-order price quote |
| 3 | `/v2/Order/PlaceOrder` | POST | Place TDP order; returns `ReportId` |
| 4 | `/v3/Report/GetReport` | GET | Poll status (fallback if FileDelivery webhook misses) |
| 5 | `/v3/Report/{reportId}/file-links` | GET | Get signed download URLs (URLs expire) |
| 6 | `/v1/File/GetReportFile` | GET | Download individual file (alternate to signed URL) |
| 7 | `/FileDelivery` (inbound) | POST | EV pushes us file URLs when ready — primary completion path |
| 8 | `/OrderStatusUpdate` (inbound) | GET | EV pushes status changes (intermediate) |

**Auth (confirmed via probe 2026-04-24):**
- Token endpoint: `POST https://apicenter.eagleview.com/oauth2/v1/token`
- Headers: `Authorization: Basic <base64(client_id:client_secret)>`, `Content-Type: application/x-www-form-urlencoded`
- Body: `grant_type=client_credentials`
- Response: `{ access_token, expires_in: 3600 }`
- API base: sandbox = `https://sandbox.apicenter.eagleview.com`, prod = `https://apicenter.eagleview.com`
- Cache token until 60s before expiry

**TDP product ID (confirmed via probe 2026-04-24):** `91` (TrueDesign for Planning). Hardcode in client constant; no need for runtime discovery in v1.

**Critical request format (confirmed via probe 2026-04-24):** API expects **camelCase** request body fields (`address`, `latitude`, `longitude`, `productList`, `vintageExtension`) despite OpenAPI spec showing PascalCase. Response also uses camelCase (`jobId`, `availabilityStatus`, `isAvailable`, `productId`).

**Order of calls in our pipeline:**
```
1. SolarProductAvailability  → confirm TDP available at lat/lng + product list
2. PlaceOrder                → returns ReportId
3. Wait for FileDelivery webhook OR poll GetReport every 30min
4. file-links                → get signed download URLs
5. Download all files        → save to Drive /design-docs/<deal>/eagleview/<reportId>/
6. Update DB row → DELIVERED, post HubSpot note, SSE broadcast
```

## Build Sequence (TDD where reasonable)

Each task is independently committable. Tasks marked **[parallel]** can run as concurrent subagents.

### Task 1 — Prisma model + migration
- Add `EagleViewOrder` model + `EagleViewProduct`, `EagleViewOrderStatus` enums to `prisma/schema.prisma` (see spec)
- Generate migration: `npx prisma migrate dev --name add_eagleview_order --create-only` (do NOT auto-apply per project rule)
- Hand off migration file to Zach for `prisma migrate deploy` against prod
- **Gate:** schema compiles, `npx prisma generate` succeeds

### Task 2 — EagleView API client `src/lib/eagleview.ts` **[parallel with 1]**
- Class-based client following `lib/zoho-inventory.ts` pattern
- Fields: `clientId`, `clientSecret`, `baseUrl`, cached token + expiresAt
- Methods (mirror Measurement Orders OpenAPI):
  - `getAccessToken()` — OAuth2 client credentials grant, cache, refresh on 401
  - `getAvailableProducts()` — GET `/GetAvailableProducts` (one-time discovery)
  - `checkSolarAvailability(address, lat, lng, productIds)` — POST `/v1/Product/SolarProductAvailability`
  - `priceOrder(orderRequest)` — POST `/v2/Order/PriceOrder`
  - `placeOrder(orderRequest)` — POST `/v2/Order/PlaceOrder`, returns `{ ReportId }`
  - `getReport(reportId)` — GET `/v3/Report/GetReport`
  - `getFileLinks(reportId)` — GET `/v3/Report/{reportId}/file-links`
  - `downloadFile(signedUrl)` — direct download from signed URL, returns Buffer
- Retry: exponential backoff on 429/5xx, 3x max, immediate fail on 401/403/404
- Sentry breadcrumbs per retry
- Tests: mock fetch, verify auth header sent, retry behavior, token cache reuse
- **TDP product ID:** hardcode `EAGLEVIEW_TDP_PRODUCT_ID = 91` (confirmed via probe; `TrueDesign for Planning`)
- **camelCase fields required** — wrap response/request types with `zod` schemas using camelCase keys
- **Sandbox testing limitation:** single-product `checkSolarAvailability` calls at non-Hampton-VA addresses return real data, but multi-product calls + actual `placeOrder` flows require production access. Plan integration testing path: write tests against sandbox for auth + availability, defer order/file-links tests to staging-against-prod once Go-Live lands.
- **Gate:** unit tests pass, sandbox `checkSolarAvailability` returns `isAvailable: true, productId: 91` for a known address

### Task 3 — Idempotency + dedup helpers `src/lib/eagleview-dedup.ts`
- `addressHash(addressParts)` — SHA-256 of normalized "street, city, state, zip"
- `findExistingOrder(dealId, addressHash)` — checks `EagleViewOrder` table
- `claimOrder(dealId, addressHash, surveyDate, triggeredBy)` — inserts ORDERED row or returns existing
- Tests: dedup hits, race condition (two simultaneous claims, one wins)
- **Gate:** unit tests pass

### Task 4 — Pipeline orchestrator `src/lib/eagleview-pipeline.ts`
- Exported `orderTrueDesign(dealId, addressParts, opts)` function
- Internal flow:
  1. `claimOrder()` — short-circuit if duplicate
  2. Geocode address (existing `lib/google-maps.ts` or inline)
  3. `client.checkSolarAvailability()` — fail fast if unavailable, mark FAILED
  4. `client.placeOrder()` — capture `ReportId`
  5. Update DB row with `eagleviewReportId` = ReportId, status ORDERED
  6. Return `{ orderId, status: "ORDERED", reportId }` — caller waits for FileDelivery webhook OR poller
- Separate `fetchAndStoreDeliverables(orderId)` function — called by FileDelivery webhook OR cron poller
  1. `client.getFileLinks(reportId)` → list of signed URLs with FileType labels
  2. Download all files in parallel via `client.downloadFile(signedUrl)`
  3. Upload to Drive `/design-docs/<deal>/eagleview/<reportId>/` with FileType-derived filenames
  4. Update DB row → DELIVERED + Drive file IDs grouped by file type
  5. Post HubSpot note, SSE broadcast
- Tests: mock client + Drive, verify happy path, FAILED on availability error, partial success on Drive failure
- **Gate:** integration test against sandbox places a real (free) order, retrieves files, verifies content

### Task 5 — HubSpot inbound webhook `src/app/api/webhooks/hubspot/eagleview-tdp-order/route.ts`
- HMAC-SHA256 signature validation against `HUBSPOT_EAGLEVIEW_WEBHOOK_SECRET`
- Parse `{ dealId, surveyDate }`
- Read deal address from HubSpot via existing `lib/hubspot.ts`
- Call `orderTrueDesign(dealId, addressParts, { triggeredBy: "hubspot_workflow", surveyDate })`
- Returns 200 + `{ orderId, status, skipped? }`
- Add to `ALLOWED_ROUTES` per project rule (webhook route, no auth-required role)
- Tests: unit test for signature validation, end-to-end with mock orchestrator
- **Gate:** integration test simulating HubSpot webhook payload

### Task 6 — Status poller cron `src/app/api/cron/eagleview-poll-orders/route.ts`
- Safety net for missed FileDelivery webhooks
- Runs every 30 minutes via Vercel cron
- Query `EagleViewOrder` rows in `ORDERED` status, `orderedAt` >5min ago, no FileDelivery received
- For each: `client.getReport(reportId)`. If COMPLETE → call `fetchAndStoreDeliverables`. If still PENDING → no-op. If FAILED → mark FAILED.
- Add to `vercel.json` cron list
- **Gate:** test invocation against sandbox shows correct state transitions

### Task 7 — FileDelivery webhook `src/app/api/webhooks/eagleview/file-delivery/route.ts`
- EV's `/FileDelivery` endpoint pushes `POST` to our URL with file data when report is ready
- Confirmed in OpenAPI spec — this is the primary completion mechanism (cron poller in Task 6 is the safety net)
- Validates EV signature (scheme TBD — confirm in security definitions; HMAC-SHA256 likely)
- Looks up order by `ReportId`, calls `fetchAndStoreDeliverables`
- Also handle `/OrderStatusUpdate` GET for intermediate status pushes (informational only — log to audit trail)
- EV needs our prod webhook URL allowlisted; coordinate with Santosh during cutover
- **Gate:** simulate FileDelivery payload, verify end-to-end

### Task 8 — Manual order API `src/app/api/eagleview/order/route.ts`
- Session auth via `requireApiAuth`
- POST body: `{ dealId, force?: boolean }`
- `force: true` requires `OPS_MANAGER` or higher in `user.roles`
- Calls `orderTrueDesign(dealId, addressParts, { triggeredBy: user.email })`
- Returns 200 with order data
- Add route to `allowedRoutes` for SALES, OPS, OPS_MANAGER, ADMIN, OWNER, PM
- Tests: role gate enforcement, force flag gate
- **Gate:** unit + integration

### Task 9 — `<EagleViewPanel>` component `src/components/EagleViewPanel.tsx`
- Props: `dealId`
- React Query: `useEagleViewOrder(dealId)` — GET `/api/eagleview/order/[dealId]` (returns latest order)
- Button states per spec
- Drive file links via `/api/drive/file/[fileId]/preview` (existing pattern)
- Place in: Solar Surveyor shell header (existing `EagleViewButton` plan area), deal detail page sidebar
- Tests: RTL component test for each state
- **Gate:** Storybook-style render check, manual visual QA

### Task 10 — HubSpot workflow setup (Zach configures, not code)
- Zach builds the workflow per spec section "HubSpot Workflow"
- Sets `HUBSPOT_EAGLEVIEW_WEBHOOK_SECRET` in Vercel + .env.local
- Initial test: enroll one test deal manually, verify webhook hits our endpoint, verify EV order placed in sandbox
- **Gate:** end-to-end smoke test with a real HubSpot deal in sandbox

### Task 11 — Pilot rollout
- Set `EAGLEVIEW_AUTO_PULL_ENABLED=true` for DTC office only (filter in webhook handler by deal location)
- Monitor for 1 week: order count, success rate, Drive uploads, error rate
- Daily summary email of yesterday's orders + cost (extends existing `daily-focus` cron)
- **Gate:** zero unexpected errors over 7 consecutive days, ops feedback positive

### Task 12 — Global rollout
- Remove DTC filter, enable for all five offices
- Update CLAUDE.md "Major Systems" section with EagleView entry
- Update memory `reference_eagleview.md`
- **Gate:** 30-day post-launch review

## Production Cutover (separate from build)

Currently sandbox-only. To go live:
1. Submit Go-Live request via developer portal (Zach)
2. EV creates production app — new client_id/secret in My Apps
3. Update `EAGLEVIEW_BASE_URL=https://apicenter.eagleview.com`, `EAGLEVIEW_SANDBOX=false`, swap creds
4. Test with one real $26.50 TDP order against a known address
5. Flip `EAGLEVIEW_AUTO_PULL_ENABLED=true` for pilot office

## Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| EV API rate limits surprise us | Medium | OpenAPI doc has rate limit page — read before Task 2; client already has retry/backoff |
| Production cutover takes weeks | Medium | Build entirely against sandbox first; cutover is config swap |
| TDP cost spike from ordering loop bug | Low (sandbox is free) | Idempotency lock prevents same address re-order; cap daily orders at 100 in v1 |
| Drive upload fails for large image | Low | Existing planset upload pattern handles 50MB+ files |
| EV's design takes >24h to complete (auto-trigger fires too late) | Medium | Confirm SLA with Santosh in Task 2 testing; if >24h, move HubSpot trigger to RTB stage entry |
| HubSpot workflow misfires on non-solar | Low | Filter on `project_type` contains "Solar"; case validated against 165+ real deals |

## Verification Steps

Before merging any task:
- `npm run build` succeeds
- `npm run test` passes (added unit tests pass)
- `npm run lint` clean
- Manual smoke test against sandbox with a known Colorado address
- For DB changes: migration file reviewed, NOT auto-applied (per project rule)

## Out of Scope

Per spec: IA standalone, bulk backfill, cross-deal address dedup, non-solar pipelines.

## Estimated Effort

| Task | Effort |
|------|--------|
| 1. Prisma model | 30min |
| 2. API client | 4h |
| 3. Dedup helpers | 1h |
| 4. Pipeline orchestrator | 3h |
| 5. HubSpot webhook | 2h |
| 6. Cron poller | 1.5h |
| 7. Delivery webhook (if applicable) | 2h |
| 8. Manual order API | 1h |
| 9. UI component | 3h |
| 10. HubSpot workflow (Zach) | 30min |
| 11. Pilot rollout | passive (1 week) |
| 12. Global rollout | 1h |
| **Total dev time** | **~18-20h** |

Ship behind `EAGLEVIEW_AUTO_PULL_ENABLED` feature flag from day one. Default OFF until pilot.
