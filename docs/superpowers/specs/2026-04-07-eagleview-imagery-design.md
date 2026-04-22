# EagleView Imagery API Integration — Design Spec

**Date:** 2026-04-07
**Status:** Approved
**Author:** Claude + Zach

## Overview

Integrate EagleView's Imagery API into PB Tech Ops Suite to provide aerial ortho imagery for solar project workflows. Phase A is on-demand (user-triggered); Phase B (future) adds automatic fetching at stage transitions.

### Use Cases

1. **Solar Surveyor** — Display aerial imagery as visual reference in Classic Mode and Wizard Step 1 (after address entry)
2. **Google Drive persistence** — Save fetched imagery to the deal's design documents folder for field/offline access
3. **AI design review** — Include aerial ortho alongside planset PDFs in Claude-powered AHJ compliance checks

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fetch trigger | On-demand (Phase A) | Control API costs; automate later once patterns proven |
| Geocoding | On-the-fly | No lat/lng on deals today; geocode at request time via Google Maps API (~200ms) |
| Frontend surfaces | Solar Surveyor only (Phase A) | Survey scheduler and design dashboards deferred to later |
| Imagery output | View in-app + Drive + AI review | Full pipeline from day one |
| DB tracking | Lightweight record per deal | Prevent duplicate fetches, foundation for Phase B |

## Architecture

### 1. API Client — `lib/eagleview.ts`

Class-based client following the `zoho-inventory.ts` pattern.

**Auth:** Bearer token from `EAGLEVIEW_API_KEY` env var. Static token, no refresh flow.

**Base URL:** `https://apis.eagleview.com` (production), `https://sandbox.apis.eagleview.com` (sandbox, controlled by `EAGLEVIEW_SANDBOX` env var).

**Methods:**

| Method | EagleView Endpoint | Purpose |
|--------|-------------------|---------|
| `rankLocation(lat, lng, radius?)` | POST `/imagery/v3/discovery/rank/location` | Discover available ortho + oblique images at a location |
| `searchOrthomosaics(area)` | POST `/imagery/v3/discovery/orthomosaics/search` | Broader area search (less common) |
| `getImageAtLocation(imageUrn, lat, lng, options?)` | GET `/imagery/v3/images/{urn}/location` | Download actual image bytes |
| `getImageTile(imageUrn, z, x, y)` | GET `/imagery/v3/images/{urn}/tiles/{z}/{x}/{y}` | Tile-based access (future map layers) |
| `getBestOrthoForLocation(lat, lng)` | Convenience wrapper | Calls `rankLocation`, selects best ortho by lowest GSD (highest resolution), then most recent capture date as tiebreaker. Returns URN + metadata. |

**Retry strategy:**
- Exponential backoff on HTTP 429
- Max 3 retries, 1–10s window with jitter
- Immediate fail on 401/403/404
- Sentry breadcrumbs on each retry, `Sentry.captureException` on final failure (matches HubSpot/Zoho patterns)

**Options for `getImageAtLocation`:**
- `radius`: meters around center point (default: 50)
- `format`: png (default) or jpg
- `zoom`: tile zoom level (optional)
- `size`: `{ width, height }` in pixels (optional, max 4096x4096)
- `quality`: 1–100 compression (optional)

### 2. Database Model — `EagleViewImagery`

```prisma
model EagleViewImagery {
  id           String    @id @default(cuid())
  dealId       String    @unique  // HubSpot deal ID string (e.g., "12345678")
  imageUrn     String
  captureDate  DateTime?
  gsd          Float?        // ground sample distance (cm/px)
  driveFileId  String?
  driveFolderId String?
  thumbnailUrl String?       // data URL or Drive thumbnail link
  fetchedAt    DateTime
  fetchedBy    String        // user email
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}
```

- One record per deal (upsert on re-fetch)
- No cascade deletes — standalone record
- Stale records are harmless if deal is deleted in HubSpot

### 3. API Routes

Routes live at `/api/eagleview/` (not under `/api/solar/`) because future consumers (design review, survey scheduler) are not Solar Surveyor-specific. Auth uses `requireApiAuth` (standard session validation from `lib/api-auth.ts`), consistent with other non-solar API routes. All roles with dashboard access can fetch imagery.

#### `GET /api/eagleview/imagery?dealId=<id>`

Check if imagery exists for a deal. Returns metadata from DB only — no EagleView API call.

**Response:**
```json
{
  "exists": true,
  "imageUrn": "urn:eagleview:...",
  "captureDate": "2025-08-15T00:00:00Z",
  "gsd": 7.5,
  "thumbnailUrl": "data:image/png;base64,...",
  "driveFileId": "1abc...",
  "fetchedAt": "2026-04-07T14:30:00Z"
}
```
Or `{ "exists": false }` if no record.

#### `POST /api/eagleview/imagery`

Fetch new imagery from EagleView and persist.

**Body:** `{ "dealId": "string", "force"?: boolean }`

`dealId` is the HubSpot deal ID string (e.g., `"12345678"`), consistent with how other models reference deals (e.g., `BomHubSpotPushLog.dealId`).

**Flow:**
1. Check DB for existing record. If exists and `force !== true`, return cached data with `cached: true`.
2. Fetch deal address from HubSpot (`address_line_1`, `city`, `state`, `postal_code`). Assemble full address as `"${address_line_1}, ${city}, ${state} ${postal_code}"` for geocoding (consistent with existing address assembly in `hubspot.ts`).
3. Geocode address by calling the Google Maps Geocoding API directly (same approach as `/api/solar/geocode` — do NOT make an internal HTTP call to that route).
4. Call `getBestOrthoForLocation(lat, lng)` to discover best ortho image.
5. Call `getImageAtLocation(imageUrn, lat, lng)` to download full image.
6. Save image to Google Drive in the deal's design documents folder (using existing `drive-plansets.ts` folder resolution: `design_documents` → `design_document_folder_id` → `all_document_parent_folder_id`).
7. Generate thumbnail: resize to ~300px wide using `sharp` (already available in the Next.js runtime on Vercel). Store as base64 data URL in the `thumbnailUrl` column (~50-100KB, acceptable for Postgres).
8. Upsert `EagleViewImagery` DB record.
9. Return metadata.

**Error cases:**
- Deal not found in HubSpot → 404
- Address missing on deal → 400 with message
- Geocode fails → 400 with message
- No imagery available at location → 404 with `{ error: "no_imagery", message: "No EagleView imagery available for this location" }`
- EagleView API error → 502 with upstream error details (log to Sentry)
- Drive save fails → Retry once. If still fails, treat the entire fetch as failed (return 502). Drive persistence is required for a successful result because the full-res proxy route and AI review both depend on `driveFileId`. A record is only upserted to the DB when Drive save succeeds.

#### `GET /api/eagleview/imagery/[dealId]/image`

Proxy the full-res image from Drive.

**Flow:** Look up `driveFileId` from DB → stream image bytes from Google Drive using `ReadableStream` → return with appropriate `Content-Type` and `Cache-Control: public, max-age=86400` headers (image is static once fetched).

**Purpose:** Frontend displays full-res image without needing Drive auth. Also used by AI review to fetch the image.

**Size consideration:** Ortho images can be 10-50MB. Use streaming response (not buffered) to stay within Vercel function timeout. Request a reasonable size from EagleView (e.g., 2048x2048 max) to keep file sizes manageable.

### 4. Frontend — Solar Surveyor Only (Phase A)

#### `EagleViewButton` Component

Reusable component, placed only in Solar Surveyor for Phase A. Designed to be droppable into other surfaces later.

**States:**
| State | Display |
|-------|---------|
| No imagery | "Pull Aerial" button with satellite icon |
| Loading | Spinner + "Fetching aerial imagery..." |
| Has imagery | Thumbnail preview, capture date, click-to-expand modal, "Refresh" link |
| Error | Red error text with retry option |

**Data fetching:** React Query with key from `queryKeys.eagleview(dealId)` (add `eagleview` entry to `lib/query-keys.ts`).

**Deal linkage:** Solar Surveyor projects gain an optional `dealId` field on the `SolarProject` model, set during wizard Step 1 (alongside name and address). This provides the HubSpot deal context needed for EagleView imagery lookup. The field is optional — projects without a linked deal simply don't show the button.

**Placement in Solar Surveyor:**
- **Shell header** — When a project with a linked `dealId` is selected (Classic or Native mode), the `EagleViewButton` appears in the header toolbar alongside the mode toggle buttons
- **Wizard Step 1** — After address entry, an optional "HubSpot Deal ID" field lets users link the project to a CRM deal at creation time

#### Full-res Modal

When thumbnail is clicked, open a modal showing the full-res image (loaded from `/api/eagleview/imagery/[dealId]/image`). Include:
- Capture date
- Resolution (GSD)
- "Open in Drive" link (if `driveFileId` exists)
- Download button

### 5. AI Design Review Integration

**File:** `lib/checks/design-review-ai.ts`

**Change:** Before calling Claude, check `EagleViewImagery` DB for the deal. If a record exists with a `driveFileId`:

1. Download the image from Drive (via internal proxy or direct Drive API)
2. Include as an additional image in the Claude message (alongside the planset PDF)
3. Add to the system prompt:

> "An aerial orthographic image of the property is included. Use it to visually verify: fire setbacks (ridge, hip, valley, eave, rake, pathway distances), panel placement relative to roof edges, equipment placement clearances relative to property boundaries, access path visibility, and roof shape/area consistency between the planset and the actual property."

**No new findings categories.** Results flow through existing error/warning/info severity. The aerial image provides additional visual context for better judgments.

**Graceful degradation:** If no EagleView imagery exists for the deal, design review works exactly as today — planset PDF only.

## Environment Variables

```env
EAGLEVIEW_API_KEY=<bearer_token>        # Required
EAGLEVIEW_SANDBOX=true                   # Optional, use sandbox base URL
```

**Prerequisites** (already in use, but required for this integration):
- `GOOGLE_MAPS_API_KEY` — needed for on-the-fly geocoding of deal addresses

## Phase B (Future) — Automatic Fetch at Stage Transitions

Not in scope for this spec, but the architecture supports it:
- Add webhook handler or stage-change listener that calls `POST /api/eagleview/imagery` when a deal enters "Survey Scheduled" or "Ready for Design"
- The existing `force: false` default prevents duplicate fetches
- DB record tracks what's already been fetched

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/eagleview.ts` | Create | API client |
| `prisma/schema.prisma` | Modify | Add `EagleViewImagery` model |
| `src/app/api/eagleview/imagery/route.ts` | Create | GET (check) + POST (fetch) |
| `src/app/api/eagleview/imagery/[dealId]/image/route.ts` | Create | Image proxy |
| `src/components/EagleViewButton.tsx` | Create | Shared UI component |
| `prisma/schema.prisma` | Modify | Add `dealId` to `SolarProject` model |
| `src/app/api/solar/projects/route.ts` | Modify | Accept `dealId` in create schema |
| `src/app/api/solar/projects/[id]/route.ts` | Modify | Accept `dealId` in update schema |
| `src/components/solar/wizard/StepBasics.tsx` | Modify | Add deal ID field to wizard |
| `src/components/solar/SetupWizard.tsx` | Modify | Pass deal ID through wizard flow |
| `src/components/solar/SolarSurveyorShell.tsx` | Modify | Render EagleViewButton in header when deal linked |
| `src/lib/checks/design-review-ai.ts` | Modify | Include aerial image in Claude prompt |
| `src/lib/query-keys.ts` | Modify | Add `eagleview` query key entry |
| `.env.example` | Modify | Add EAGLEVIEW_API_KEY, EAGLEVIEW_SANDBOX |
