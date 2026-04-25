# EagleView TrueDesign Auto-Pull — Design Spec

**Date:** 2026-04-24
**Status:** Draft — Measurement Orders API path confirmed (2026-04-24); API design ready to implement against sandbox
**Author:** Claude + Zach
**Supersedes:** `2026-04-07-eagleview-imagery-design.md` (Imagery API only — never built)

## Problem

Designers manually order EagleView reports through the web UI and download outputs (panel layout JSON, shade analysis, aerial imagery, measurement reports) into Drive folders. Slow, error-prone, easy to forget. Surveyors arrive at jobs without these files prepped.

## Goal

For every solar deal with a scheduled site survey, EagleView outputs land in the deal's Drive folder + Solar Surveyor automatically the day before the survey, with no human action required.

## Background — What EagleView Provides Us

Per the April 8 meeting + April 10 confirmation from Santosh Choppadandi (EV's Principal TPM, Solar/Roofing/GIS), and follow-up confirmation that TDP now bundles measurement report data:

| Product | Code | Purpose | Sample Cost |
|---------|------|---------|-------------|
| **TrueDesign for Planning** | TDP | Panel layout, shade analysis, aerial imagery, **and measurement report data** (single bundled order) | $26.50 / 2,333 sqft |

**Inform Advanced (IA)** also exists as a standalone roof measurement product but is **not used in this auto-flow** — TDP now includes the measurement data we need, eliminating the prior double-ordering concern. IA could be added later as a manual option if a use case emerges (e.g., roof-only re-roofs without solar), but is out of scope for v1.

**Status of access:**
- API access provisioned for IA and TDP, prod + sandbox (Santosh, 2026-04-10)
- Shade file re-enabled in TrueDesign output (Geoff, 2026-04-14)
- Measurement data bundled into TDP output (resolved follow-up from April 8 meeting)
- Developer account: `zach.rosen@photonbrothers.com` (welcome email 2026-04-07)
- App: "PB Tech Ops Suite" (sandbox-only) with API collections: Imagery, WMTS, Property Data, **Measurement Orders**
- Auth: System Integration / Client Credentials grant (Bearer token)
- Credentials saved to `.env.local`: `EAGLEVIEW_CLIENT_ID`, `EAGLEVIEW_CLIENT_SECRET`
- Sandbox base: `https://sandbox.apicenter.eagleview.com` ; production: `https://apicenter.eagleview.com` (after Go-Live request)

## API Surface — Measurement Orders (CORRECTED PATH)

Initial spec assumed the TrueDesign API would be the integration point. After portal investigation: TrueDesign API is gated behind User Authorization / OAuth Authorization Code with PKCE — meant for SPAs where end-users log in. Wrong fit for our autonomous server-to-server cron + webhook architecture.

The right path is the **Measurement Orders API** (System Integration / Client Credentials). It explicitly supports ordering TrueDesign products and returns "TrueDesign measurement data" through the File-Links endpoint. Our existing app already has this collection enabled.

**API spec source:** `~/Downloads/Measurement Order API Documentation.json` (downloaded from EV developer portal 2026-04-24)

**Endpoint flow:**

| Step | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| 1 | `/v1/Product/SolarProductAvailability` | POST | Check TDP availability at address (lat/lng + ProductList) |
| 2 | `/v2/Order/PriceOrder` | POST | Optional pre-order quote |
| 3 | `/v2/Order/PlaceOrder` | POST | Place TDP order; returns `ReportId` |
| 4 | `/v3/Report/GetReport` | GET | Poll status by ReportId (used as fallback if webhook misses) |
| 5 | `/v3/Report/{reportId}/file-links` | GET | Get signed file download URLs (URLs expire) |
| 6 | `/v1/File/GetReportFile` | GET | Download individual file |
| 7 | `/FileDelivery` (inbound webhook) | POST | EV pushes us file URLs when ready — primary completion mechanism |
| 8 | `/OrderStatusUpdate` (inbound webhook) | GET | EV pushes status changes (intermediate progress) |

**Auth:** OAuth2 Client Credentials grant. **Confirmed via probe 2026-04-24:**
- Token endpoint: `POST https://apicenter.eagleview.com/oauth2/v1/token`
- Headers: `Authorization: Basic <base64(client_id:client_secret)>`, `Content-Type: application/x-www-form-urlencoded`
- Body: `grant_type=client_credentials`
- Response: `{ access_token, expires_in: 3600 }`
- Use as `Authorization: Bearer <access_token>` on all API calls
- Cache token until 60s before expiry

**Product IDs (confirmed via probe against `/v2/Product/GetAvailableProducts` 2026-04-24):**
- **91 → TrueDesign for Planning ($100 list / $26.50 contract)** ← what we order
- 90 → TrueDesign for Sales ($0 — free, less detail)
- 62 → Inform Advanced ($75)
- 11 → Inform Essentials+ ($40-93)

**Critical request-format note:** API expects **camelCase field names** (`address`, `latitude`, `longitude`, `productList`, `vintageExtension`) despite the OpenAPI spec showing PascalCase (`Address`, `Latitude`, etc.). PascalCase returns a misleading error: `"The latitude must be a number between 16 and 70"`. camelCase works perfectly.

**Sandbox quirk:** the sandbox routes some calls to a fixed test address (Hampton, VA / lat 37.0179 / lng -76.3469) that only has product 62 available. Single-product availability checks at the spec's example San Clemente address return real San Clemente data with product 91 available. This means full end-to-end TDP testing requires production access (after Go-Live request).

**Cost insight to discuss:** Could we use `TrueDesign for Sales` ($0) instead of `TrueDesign for Planning` ($26.50)? Need to confirm what files each product delivers — Sales might have less detail but for pre-survey reference may suffice. Worth a side conversation with Geoff.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger source | HubSpot workflow → webhook | Ops Hub Enterprise already does the filter + delay logic; no polling cron needed |
| Trigger timing | 1 day before `site_survey_schedule_date` at 4am MT | Files ready before surveyor leaves; TDP turnaround is fast enough at this lead time. **TBD: confirm TDP SLA.** If >24h, move trigger earlier. |
| Filter | `project_type` contains "Solar" (case-insensitive) | Matches request; non-solar deals don't need EV |
| Product | TDP only | TDP now bundles measurement data; one order covers all surveyor + designer needs |
| Manual fallback | Button in Solar Surveyor + deal detail | Re-pulls, late-scheduled surveys, non-solar exceptions |
| Idempotency | `EagleViewOrder` row keyed on `(dealId, addressHash)` | Prevents double-orders on workflow re-enrollment |
| Failure handling | Sentry + email-to-ops; no auto-retry on order failure | Manual button is the retry mechanism. EV charges for orders, retry blindly = waste. |
| Storage | Deal's Drive `/design-docs/<deal>/eagleview/` | Matches existing planset / design folder convention |

## Architecture

```
HubSpot workflow (Zach configures in HubSpot UI)
  Enroll: project_type contains "Solar" AND site_survey_schedule_date is known
  Delay: until 1 day before site_survey_schedule_date @ 4am MT
  Action: webhook POST /api/webhooks/hubspot/eagleview-tdp-order
          { dealId, surveyDate }
                │
                ▼
PB Ops Suite — webhook handler
  1. Validate HubSpot webhook signature
  2. Idempotency check: existing EagleViewOrder row for (dealId, TDP, addressHash)?
       └─ If found and status=DELIVERED, fetch files from Drive (cached), 200
       └─ If found and status=PENDING/ORDERED, skip with 200 (already in flight)
  3. Read deal from HubSpot (address, contact, project_type)
  4. Geocode address (Google Maps) → addressHash for dedup
  5. Order TDP via EV API → returns order_id, expected delivery time
  6. Insert EagleViewOrder row (status=ORDERED, order_id, addressHash)
  7. Post HubSpot note: "TrueDesign ordered for tomorrow's survey (order #X)"
  8. Return 200

When EV's order completes:
  ├─ Option A (preferred): EV calls our delivery webhook → fetch files
  └─ Option B (fallback): cron poller checks ORDERED rows, pulls files when ready

PB Ops Suite — delivery handler /api/webhooks/eagleview/order-ready
  1. Validate EV webhook signature
  2. Lookup EagleViewOrder by order_id
  3. Download all artifacts from EV (image, layout JSON, shade JSON, report PDF/XML)
  4. Upload to Drive /design-docs/<deal>/eagleview/<order_id>/
  5. Update EagleViewOrder row (status=DELIVERED, file IDs)
  6. Post HubSpot note: "EagleView files ready for <surveyor name>"
  7. SSE broadcast to refresh open Solar Surveyor sessions
```

## EagleView API Client — `lib/eagleview.ts`

Single client class for Measurement Orders (TDP). Architected so additional product types can be added without restructuring.

**Configuration (now confirmed):**
- Sandbox base: `https://sandbox.apicenter.eagleview.com`
- Production base: `https://apicenter.eagleview.com`
- Auth: OAuth2 client credentials grant (Bearer token)
- Env vars: `EAGLEVIEW_CLIENT_ID`, `EAGLEVIEW_CLIENT_SECRET`, `EAGLEVIEW_BASE_URL`, `EAGLEVIEW_SANDBOX`, `EAGLEVIEW_WEBHOOK_SECRET`

**Patterns to follow** (matches `lib/zoho-inventory.ts`):
- Class-based client with token refresh + cache
- Exponential backoff on 429 / 5xx
- Immediate fail on 401/403/404
- Sentry breadcrumbs per retry

**Public methods (mirroring OpenAPI):**
- `getAccessToken(): Promise<string>` — OAuth2 client credentials, cached + auto-refreshed
- `getAvailableProducts(): Promise<Product[]>` — `GET /GetAvailableProducts` to confirm what's enabled
- `checkSolarAvailability(address, lat, lng, productIds[]): Promise<AvailabilityResponse>` — `POST /v1/Product/SolarProductAvailability`
- `priceOrder(orderRequest): Promise<PriceQuote>` — `POST /v2/Order/PriceOrder`
- `placeOrder(orderRequest): Promise<{ ReportId: number }>` — `POST /v2/Order/PlaceOrder`
- `getReport(reportId): Promise<ReportStatus>` — `GET /v3/Report/GetReport`
- `getFileLinks(reportId): Promise<{ Links: { Link: string, ExpireTimestamp: string, FileType: string }[] }>` — `GET /v3/Report/{reportId}/file-links`
- `downloadFile(signedUrl): Promise<Buffer>` — direct download from signed URL

## Webhook Handler — `/api/webhooks/hubspot/eagleview-tdp-order`

**Auth:** HubSpot signed webhook (existing pattern — see `/api/webhooks/hubspot/property/`). Env var `HUBSPOT_EAGLEVIEW_WEBHOOK_SECRET`.

**Body:** `{ dealId: string, surveyDate: string (YYYY-MM-DD) }`

**Response codes:**
- `200` — order placed or idempotent skip
- `400` — bad signature / missing fields
- `404` — deal not found in HubSpot
- `502` — EV API error (will not retry; surfaces in ops email)
- `500` — DB error

Synchronous in v1; move to Inngest if order placement becomes slow.

## Webhook Handler — `/api/webhooks/eagleview/order-ready`

**Auth:** EV signed webhook. **TBD: confirm EV's signing scheme** (likely HMAC-SHA256 with shared secret). EV needs our prod URL allowlisted via Geoff/Santosh.

**Body:** EV's order-completion payload, schema TBD.

**Flow:** described above.

**Fallback poller:** if EV doesn't support webhooks for this product, add `/api/cron/eagleview-poll-orders` running every 30min, pulling all `EagleViewOrder` rows in `ORDERED` state >5min old, checking status, and pulling on completion.

## Database — `EagleViewOrder`

```prisma
model EagleViewOrder {
  id              String    @id @default(cuid())
  dealId          String
  productCode     EagleViewProduct  @default(TDP)  // future-proofed for IA
  orderId         String    @unique  // EV's order ID
  addressHash     String    // SHA-256 of normalized address (for dedup)
  status          EagleViewOrderStatus
  triggeredBy     String    // "hubspot_workflow" | user email for manual
  surveyDate      DateTime?
  orderedAt       DateTime  @default(now())
  deliveredAt     DateTime?
  errorMessage    String?
  estimatedDeliveryAt DateTime?
  driveFolderId   String?
  imageDriveFileId         String?
  layoutJsonDriveFileId    String?
  shadeJsonDriveFileId     String?
  reportPdfDriveFileId     String?  // TDP bundled measurement report
  reportXmlDriveFileId     String?  // TDP bundled measurement XML
  cost            Float?    // populated when known
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([dealId, productCode, addressHash])
  @@index([status, orderedAt])
  @@index([dealId])
}

enum EagleViewProduct {
  TDP  // TrueDesign for Planning — panel layout + shade + imagery + measurement report
  IA   // Inform Advanced — reserved for future use, not used in v1
}

enum EagleViewOrderStatus {
  ORDERED      // Submitted to EV, awaiting delivery
  DELIVERED    // Files received and saved to Drive
  FAILED       // EV returned error, no charge incurred
  CANCELLED    // Manually cancelled
}
```

## Manual Triggers — Solar Surveyor + Deal Detail

**`<EagleViewPanel dealId={...} />`** — replaces the unbuilt `EagleViewButton` from the 2026-04-07 spec.

Single action button:
- **"Order TrueDesign"** — placed in Solar Surveyor + deal detail. Triggers the same flow as the auto-webhook.

**States per order:**
| State | Display |
|-------|---------|
| Never ordered | Button enabled |
| ORDERED | "Order in progress (~30min)" + spinner + estimated delivery time |
| DELIVERED | Green check + relativeTime + dropdown linking each Drive file |
| FAILED | Red error + "Retry" |

**API:** `POST /api/eagleview/order` with `{ dealId, force?: boolean }`. `force: true` requires OPS_MGR+ role per cost-control policy.

## HubSpot Workflow (Zach configures in HubSpot UI)

1. **Trigger** — Deal-based, re-enrollment ON
   - `project_type` contains "Solar" (case-insensitive)
   - `site_survey_schedule_date` is known
2. **Delay** — Until `site_survey_schedule_date` minus 1 day at 4:00 AM America/Denver
3. **Action** — Trigger webhook
   - URL: `https://<prod-host>/api/webhooks/hubspot/eagleview-tdp-order`
   - Method: POST
   - Body: `{ "dealId": "{{deal.hs_object_id}}", "surveyDate": "{{deal.site_survey_schedule_date}}" }`
   - Sign with shared secret (matches `HUBSPOT_EAGLEVIEW_WEBHOOK_SECRET`)
4. **Re-enrollment** — On `site_survey_schedule_date` change, re-enroll. Idempotency key includes `addressHash`, so address unchanged → skip; address changed → new order.

## Failure Modes

| Failure | Behavior |
|---------|----------|
| Bad webhook signature | 400, no DB write, log warning |
| Deal missing address | 400, log to FAILED row, email ops |
| Geocode fails | 400, FAILED row, email ops |
| EV API 429 | Retry w/ backoff (3x); if still fails → 502, FAILED row |
| EV API 5xx | Same as 429 |
| EV order succeeds, delivery webhook never fires | Cron poller catches it within 30min |
| EV order fails post-submission | Delivery webhook arrives with error; row → FAILED |
| Drive upload fails | Retry once; on second fail → FAILED row, no partial uploads |
| Already-ordered (idempotency hit) | 200 with `{ skipped: true, reason: "already_ordered" }` |
| Same address, different deal | New order placed (different addressHash from different normalization? — TBD: should we dedup across deals?) |

## Cost Controls

- TDP only — IA not in scope for v1
- Idempotency on (dealId, addressHash) prevents accidental double-orders
- Daily cost summary email (extending `daily-focus` cron pattern): yesterday's order count + spend
- Manual button bypass (`force: true`) gated to OPS_MGR+ role
- Out-of-pocket alert: if any week's spend exceeds threshold (TBD), email leadership

## Roles & Permissions

- HubSpot webhook endpoint: signature auth only (no session)
- EV delivery webhook endpoint: signature auth only
- Manual order endpoint: any role with deal access; `force: true` requires OPS_MGR+
- New API routes added to `allowedRoutes` in `src/lib/roles.ts` per project rule

## Out of Scope (v1)

- Inform Advanced (IA) — reserved for future use; not built in v1
- Bulk backfill for already-scheduled surveys (one-time script if needed)
- Cross-deal address dedup (one EV order per deal even if same address — simplifies idempotency; revisit if duplicates become a problem)
- Auto-trigger on stage change (only `site_survey_schedule_date` based)
- Non-solar pipelines

## Open Questions

1. **TDP delivery SLA** — confirm with Santosh. If <2h, day-before trigger is fine. If >24h, consider moving trigger to RTB stage.
2. **EV webhook support for order-ready notifications** — exists, or do we need to poll? Affects build complexity.
3. **EV signing scheme** — HMAC-SHA256? Need to know to implement signature validation.
4. **Project type literal values** — pull HubSpot distribution to confirm filter string matches what ops actually uses (e.g., "Residential Solar", "Solar + Storage", "Solar + Roofing").
5. **Webhook secret rotation** — annual default, confirm with security.

## Next Steps

1. **Zach: log into EV Developer Portal** (link in welcome email from `developersupport@eagleview.com` 2026-04-07) → retrieve API credentials + endpoint docs → drop into a secure spot for this build
2. **Claude: confirm TDP/IA endpoint paths + auth** from portal docs → fill TBDs in this spec → mark Status = Approved
3. **Claude: pull HubSpot project_type distribution** → confirm filter literal
4. **Claude: write implementation plan** at `docs/superpowers/plans/`
5. **Claude: build in worktree, ship behind `EAGLEVIEW_AUTO_PULL_ENABLED` feature flag**
6. **Pilot rollout**: one office (DTC) for 1 week before global
