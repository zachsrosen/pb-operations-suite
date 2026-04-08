# EagleView Imagery API Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-demand EagleView aerial imagery to the operations suite — API client, persistence to Drive, Solar Surveyor UI, and AI design review enhancement.

**Architecture:** Thin API client (`lib/eagleview.ts`) wraps EagleView's REST API with retry/backoff. A pair of API routes handle fetching + caching (keyed by HubSpot deal ID) and proxying full-res images from Drive. The `EagleViewButton` component appears in Solar Surveyor only for Phase A. Design review AI gets the aerial image as an additional document alongside the planset PDF.

**Tech Stack:** Next.js API routes, Prisma/Postgres, Google Maps Geocoding API, Google Drive API (service account), sharp (image resizing), Anthropic Files API, React Query v5.

**Spec:** `docs/superpowers/specs/2026-04-07-eagleview-imagery-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/eagleview.ts` | Create | EagleView API client (auth, retry, discovery, image fetch) |
| `prisma/schema.prisma` | Modify | Add `EagleViewImagery` model |
| `src/app/api/eagleview/imagery/route.ts` | Create | GET (check DB) + POST (fetch → geocode → EagleView → Drive → DB) |
| `src/app/api/eagleview/imagery/[dealId]/image/route.ts` | Create | Stream full-res image from Drive |
| `src/components/EagleViewButton.tsx` | Create | Reusable button + thumbnail + full-res modal |
| `src/app/dashboards/solar-surveyor/page.tsx` | Modify | Wire EagleViewButton into Solar Surveyor |
| `src/components/solar/wizard/StepBasics.tsx` | Modify | Add EagleViewButton after wizard address entry |
| `src/components/solar/SolarSurveyorShell.tsx` | Modify | Add EagleViewButton to Classic Mode shell (outside iframe) |
| `src/lib/checks/design-review-ai.ts` | Modify | Include aerial image in Claude prompt when available |
| `src/lib/query-keys.ts` | Modify | Add `eagleview` query key entry |
| `.env.example` | Modify | Add `EAGLEVIEW_API_KEY`, `EAGLEVIEW_SANDBOX` |
| `src/__tests__/eagleview.test.ts` | Create | Unit tests for API client |

---

## Chunk 1: Foundation — API Client + Database Model

### Task 1: Add Prisma model and run migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `EagleViewImagery` model to schema**

Add this model after the existing cache models section in `prisma/schema.prisma`:

```prisma
// ===========================================
// EAGLEVIEW IMAGERY
// ===========================================

/// Tracks EagleView aerial imagery fetched per deal.
/// One record per deal (upsert on re-fetch). Drive persistence is required.
model EagleViewImagery {
  id            String    @id @default(cuid())
  dealId        String    @unique  // HubSpot deal ID string (e.g., "12345678")
  imageUrn      String
  captureDate   DateTime?
  gsd           Float?            // ground sample distance (cm/px)
  driveFileId   String
  driveFolderId String?
  thumbnailUrl  String?            // base64 data URL (~50-100KB); Postgres String maps to text by default
  fetchedAt     DateTime
  fetchedBy     String            // user email
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

Note: `driveFileId` is non-optional (Drive persistence is required for success per spec). `thumbnailUrl` uses `@db.Text` because base64 data URLs exceed the default 255-char varchar.

- [ ] **Step 2: Generate Prisma client and create migration**

Run:
```bash
npx prisma migrate dev --name add-eagleview-imagery
```

Expected: Migration created, client regenerated in `src/generated/prisma`.

- [ ] **Step 3: Verify the model is accessible**

Run:
```bash
npx prisma studio
```

Confirm `EagleViewImagery` table appears. Close studio.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(eagleview): add EagleViewImagery Prisma model"
```

---

### Task 2: Create EagleView API client

**Files:**
- Create: `src/lib/eagleview.ts`
- Create: `src/__tests__/eagleview.test.ts`

- [ ] **Step 1: Write failing tests for the API client**

Create `src/__tests__/eagleview.test.ts`:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

jest.mock("@sentry/nextjs", () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
}));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  mockFetch.mockReset();
  process.env = { ...ORIGINAL_ENV, EAGLEVIEW_API_KEY: "test-key-123", EAGLEVIEW_SANDBOX: "" };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("EagleViewClient", () => {
  it("rankLocation sends correct request", async () => {
    const { eagleView } = require("@/lib/eagleview");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ortho: { images: [{ image_urn: "urn:ev:ortho:123", capture_date: "2025-06-15", gsd: 7.5 }] },
        oblique: { images: [] },
      }),
    });

    const result = await eagleView.rankLocation(39.7392, -104.9903);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://apis.eagleview.com/imagery/v3/discovery/rank/location",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key-123",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(result.ortho.images).toHaveLength(1);
  });

  it("uses sandbox URL when EAGLEVIEW_SANDBOX is set", async () => {
    process.env.EAGLEVIEW_SANDBOX = "true";
    const { eagleView } = require("@/lib/eagleview");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ortho: { images: [] }, oblique: { images: [] } }),
    });

    await eagleView.rankLocation(39.7392, -104.9903);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("sandbox.apis.eagleview.com"),
      expect.anything(),
    );
  });

  it("retries on 429 with exponential backoff", async () => {
    const { eagleView } = require("@/lib/eagleview");

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ortho: { images: [] }, oblique: { images: [] } }),
      });

    const result = await eagleView.rankLocation(39.7392, -104.9903);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.ortho.images).toHaveLength(0);
  });

  it("throws immediately on 401", async () => {
    const { eagleView } = require("@/lib/eagleview");

    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "unauthorized" });

    await expect(eagleView.rankLocation(39.7392, -104.9903)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("getImageAtLocation returns ArrayBuffer", async () => {
    const { eagleView } = require("@/lib/eagleview");
    const fakeBuffer = new ArrayBuffer(8);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => fakeBuffer,
      headers: new Headers({ "content-type": "image/png" }),
    });

    const result = await eagleView.getImageAtLocation("urn:ev:123", 39.7392, -104.9903);
    expect(result.buffer).toBe(fakeBuffer);
    expect(result.contentType).toBe("image/png");
  });

  it("getBestOrthoForLocation selects lowest GSD, then most recent", async () => {
    const { eagleView } = require("@/lib/eagleview");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ortho: {
          images: [
            { image_urn: "urn:old-hires", capture_date: "2024-01-01", gsd: 5.0 },
            { image_urn: "urn:new-lores", capture_date: "2025-06-01", gsd: 10.0 },
            { image_urn: "urn:new-hires", capture_date: "2025-06-01", gsd: 5.0 },
          ],
        },
        oblique: { images: [] },
      }),
    });

    const result = await eagleView.getBestOrthoForLocation(39.7392, -104.9903);
    // Same GSD (5.0) → pick most recent
    expect(result?.imageUrn).toBe("urn:new-hires");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=eagleview`
Expected: FAIL — module `@/lib/eagleview` does not exist.

- [ ] **Step 3: Implement the API client**

Create `src/lib/eagleview.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";

// ── Types ──

export interface EagleViewOrthoImage {
  image_urn: string;
  capture_date: string;
  gsd: number;
  [key: string]: unknown;
}

export interface RankLocationResponse {
  ortho: { images: EagleViewOrthoImage[] };
  oblique: { images: unknown[] };
}

export interface ImageAtLocationResult {
  buffer: ArrayBuffer;
  contentType: string;
}

export interface BestOrthoResult {
  imageUrn: string;
  captureDate: string | null;
  gsd: number | null;
}

export interface GetImageOptions {
  radius?: number;
  format?: "png" | "jpg";
  zoom?: number;
  size?: { width: number; height: number };
  quality?: number;
}

// ── Constants ──

const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 1000;
const RATE_LIMIT_MAX_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

function getBaseUrl(): string {
  return process.env.EAGLEVIEW_SANDBOX === "true"
    ? "https://sandbox.apis.eagleview.com"
    : "https://apis.eagleview.com";
}

function getApiKey(): string {
  const key = process.env.EAGLEVIEW_API_KEY;
  if (!key) throw new Error("EAGLEVIEW_API_KEY environment variable is not set");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rateLimitDelay(attempt: number): number {
  const base = Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);
  const jitter = base * 0.3 * Math.random();
  return base + jitter;
}

// ── Client ──

class EagleViewClient {
  private async request<T>(
    path: string,
    options: RequestInit & { parseJson?: boolean } = {},
  ): Promise<T> {
    const { parseJson = true, ...fetchOptions } = options;
    const url = `${getBaseUrl()}${path}`;

    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${getApiKey()}`,
            "Content-Type": "application/json",
            ...fetchOptions.headers,
          },
          cache: "no-store",
        });

        // Immediate fail on auth/not-found errors
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          const body = await response.text().catch(() => "");
          throw new Error(`EagleView ${response.status}: ${body.slice(0, 200)}`);
        }

        // Retry on rate limit
        if (response.status === 429) {
          if (attempt < RATE_LIMIT_MAX_RETRIES) {
            const delay = rateLimitDelay(attempt);
            Sentry.addBreadcrumb({
              category: "eagleview",
              message: `Rate limited (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES}), retrying in ${Math.round(delay)}ms`,
              level: "warning",
            });
            await sleep(delay);
            continue;
          }
          throw new Error("EagleView rate limit exceeded after max retries");
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`EagleView ${response.status}: ${body.slice(0, 200)}`);
        }

        if (parseJson) {
          return (await response.json()) as T;
        }
        return response as unknown as T;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error(`EagleView request timed out after ${REQUEST_TIMEOUT_MS}ms`);
        }
        // Don't retry non-rate-limit errors
        if (attempt === RATE_LIMIT_MAX_RETRIES || !(err instanceof Error && err.message.includes("429"))) {
          Sentry.captureException(err);
          throw err;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error("EagleView request failed after max retries");
  }

  /** Discover available ortho + oblique images at a location. */
  async rankLocation(lat: number, lng: number, radius = 50): Promise<RankLocationResponse> {
    return this.request<RankLocationResponse>("/imagery/v3/discovery/rank/location", {
      method: "POST",
      body: JSON.stringify({
        center: { x: lng, y: lat, radius },
        view: {
          ortho: {},
          oblique: {
            cardinals: { north: true, south: true, east: true, west: true },
          },
        },
      }),
    });
  }

  /** Download image bytes for a specific image URN at a location. */
  async getImageAtLocation(
    imageUrn: string,
    lat: number,
    lng: number,
    options: GetImageOptions = {},
  ): Promise<ImageAtLocationResult> {
    const params = new URLSearchParams();
    params.set("center.x", String(lng));
    params.set("center.y", String(lat));
    params.set("center.radius", String(options.radius ?? 50));
    if (options.format) params.set("format", options.format);
    if (options.zoom) params.set("zoom", String(options.zoom));
    if (options.size) {
      params.set("size.width", String(options.size.width));
      params.set("size.height", String(options.size.height));
    }
    if (options.quality) params.set("quality", String(options.quality));

    const encodedUrn = encodeURIComponent(imageUrn);
    const response = await this.request<Response>(
      `/imagery/v3/images/${encodedUrn}/location?${params}`,
      { method: "GET", parseJson: false },
    );

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "image/png";
    return { buffer, contentType };
  }

  /**
   * Convenience: discover images at a location and pick the best ortho.
   * Selection: lowest GSD (highest resolution), then most recent capture date.
   * Returns null if no ortho images are available.
   */
  async getBestOrthoForLocation(lat: number, lng: number): Promise<BestOrthoResult | null> {
    const discovery = await this.rankLocation(lat, lng);
    const images = discovery.ortho?.images ?? [];
    if (images.length === 0) return null;

    const sorted = [...images].sort((a, b) => {
      // Lower GSD = higher resolution = better
      const gsdDiff = (a.gsd ?? Infinity) - (b.gsd ?? Infinity);
      if (gsdDiff !== 0) return gsdDiff;
      // Same GSD → prefer more recent
      return (b.capture_date ?? "").localeCompare(a.capture_date ?? "");
    });

    const best = sorted[0];
    return {
      imageUrn: best.image_urn,
      captureDate: best.capture_date ?? null,
      gsd: best.gsd ?? null,
    };
  }
}

export const eagleView = new EagleViewClient();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=eagleview`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eagleview.ts src/__tests__/eagleview.test.ts
git commit -m "feat(eagleview): add EagleView Imagery API client with retry/backoff"
```

---

### Task 3: Add query key and update .env.example

**Files:**
- Modify: `src/lib/query-keys.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add `eagleview` entry to query-keys.ts**

Add after the last domain entry in the `queryKeys` object:

```typescript
eagleview: {
  root: ["eagleview"] as const,
  imagery: (dealId: string) => [...queryKeys.eagleview.root, "imagery", dealId] as const,
},
```

- [ ] **Step 2: Add env vars to .env.example**

Append to the file:

```env

# EagleView Imagery API
EAGLEVIEW_API_KEY=your-eagleview-api-key
# Set to "true" to use sandbox (Omaha, NE test area only)
EAGLEVIEW_SANDBOX=
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/query-keys.ts .env.example
git commit -m "feat(eagleview): add query key and env var template"
```

---

## Chunk 2: API Routes

### Task 4: GET /api/eagleview/imagery — check DB for existing imagery

**Files:**
- Create: `src/app/api/eagleview/imagery/route.ts`

- [ ] **Step 1: Create the GET handler**

Create `src/app/api/eagleview/imagery/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dealId = request.nextUrl.searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "dealId query parameter is required" }, { status: 400 });
  }

  const record = await prisma.eagleViewImagery.findUnique({ where: { dealId } });

  if (!record) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    imageUrn: record.imageUrn,
    captureDate: record.captureDate,
    gsd: record.gsd,
    thumbnailUrl: record.thumbnailUrl,
    driveFileId: record.driveFileId,
    fetchedAt: record.fetchedAt,
  });
}
```

- [ ] **Step 2: Verify GET route compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to the new route.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/eagleview/imagery/route.ts
git commit -m "feat(eagleview): add GET /api/eagleview/imagery route"
```

---

### Task 5: POST /api/eagleview/imagery — full fetch pipeline

This is the main route: HubSpot → geocode → EagleView → Drive → thumbnail → DB.

**Files:**
- Modify: `src/app/api/eagleview/imagery/route.ts`

- [ ] **Step 1: Add the POST handler**

Add to the existing `route.ts` file, after the GET handler. You'll need additional imports at the top:

```typescript
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import sharp from "sharp";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { eagleView } from "@/lib/eagleview";
import { extractFolderId, getDriveWriteToken } from "@/lib/drive-plansets";
import { hubspotClient } from "@/lib/hubspot";
```

Add runtime export at the top of the file (sharp requires Node.js, not Edge):

```typescript
export const runtime = "nodejs";
```

POST handler:

```typescript
export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  let body: { dealId?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dealId, force } = body;
  if (!dealId || typeof dealId !== "string") {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }

  // Step 1: Check cache
  if (!force) {
    const existing = await prisma.eagleViewImagery.findUnique({ where: { dealId } });
    if (existing) {
      return NextResponse.json({
        cached: true,
        exists: true,
        imageUrn: existing.imageUrn,
        captureDate: existing.captureDate,
        gsd: existing.gsd,
        thumbnailUrl: existing.thumbnailUrl,
        driveFileId: existing.driveFileId,
        fetchedAt: existing.fetchedAt,
      });
    }
  }

  // Step 2: Fetch deal address from HubSpot
  let address: string;
  let designFolderId: string | null;
  try {
    const dealResponse = await hubspotClient.crm.deals.basicApi.getById(dealId, [
      "address_line_1", "city", "state", "postal_code",
      "design_documents", "design_document_folder_id", "all_document_parent_folder_id",
    ]);
    const props = dealResponse.properties;
    const line1 = props.address_line_1?.trim();
    const city = props.city?.trim();
    const state = props.state?.trim();
    const zip = props.postal_code?.trim();

    if (!line1 || !city || !state) {
      return NextResponse.json(
        { error: "Deal is missing address fields (address_line_1, city, or state)" },
        { status: 400 },
      );
    }

    address = `${line1}, ${city}, ${state}${zip ? ` ${zip}` : ""}`;

    // Resolve design folder for Drive save
    const folderRaw = String(
      props.design_documents || props.design_document_folder_id || props.all_document_parent_folder_id || "",
    ).trim();
    designFolderId = folderRaw ? extractFolderId(folderRaw) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("404") || msg.includes("not found")) {
      return NextResponse.json({ error: "Deal not found in HubSpot" }, { status: 404 });
    }
    Sentry.captureException(err);
    return NextResponse.json({ error: `HubSpot error: ${msg}` }, { status: 502 });
  }

  // Step 3: Geocode address via Google Maps
  let lat: number;
  let lng: number;
  try {
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`,
      { cache: "no-store" },
    );
    const geoJson = await geoRes.json();
    if (!geoJson.results?.length) {
      return NextResponse.json({ error: `Geocoding failed: no results for "${address}"` }, { status: 400 });
    }
    const location = geoJson.results[0].geometry.location;
    lat = location.lat;
    lng = location.lng;
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: "Geocoding service error" }, { status: 400 });
  }

  // Step 4: Discover best ortho from EagleView
  let bestOrtho: Awaited<ReturnType<typeof eagleView.getBestOrthoForLocation>>;
  try {
    bestOrtho = await eagleView.getBestOrthoForLocation(lat, lng);
  } catch (err) {
    Sentry.captureException(err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `EagleView discovery error: ${msg}` }, { status: 502 });
  }

  if (!bestOrtho) {
    return NextResponse.json(
      { error: "no_imagery", message: "No EagleView imagery available for this location" },
      { status: 404 },
    );
  }

  // Step 5: Download full image (capped at 2048x2048 for manageability)
  let imageBuffer: ArrayBuffer;
  let contentType: string;
  try {
    const result = await eagleView.getImageAtLocation(bestOrtho.imageUrn, lat, lng, {
      size: { width: 2048, height: 2048 },
      format: "png",
    });
    imageBuffer = result.buffer;
    contentType = result.contentType;
  } catch (err) {
    Sentry.captureException(err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `EagleView image fetch error: ${msg}` }, { status: 502 });
  }

  // Step 6: Save to Google Drive (required — retry once on failure)
  let driveFileId: string;
  const driveFolderId = designFolderId;

  if (!driveFolderId) {
    return NextResponse.json(
      { error: "Deal has no design documents folder configured in HubSpot" },
      { status: 400 },
    );
  }

  for (let driveAttempt = 0; driveAttempt < 2; driveAttempt++) {
    try {
      const token = await getDriveWriteToken();
      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      const filename = `EagleView_Aerial_${dealId}.${ext}`;

      const boundary = "eagleview_upload_boundary";
      const metadata = JSON.stringify({
        name: filename,
        mimeType: contentType,
        parents: [driveFolderId],
      });

      // Build multipart body
      const metadataPart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
      const filePart = `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
      const closing = `\r\n--${boundary}--`;

      const encoder = new TextEncoder();
      const parts = [
        encoder.encode(metadataPart),
        encoder.encode(filePart),
        new Uint8Array(imageBuffer),
        encoder.encode(closing),
      ];

      const bodyLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
      const bodyArray = new Uint8Array(bodyLength);
      let offset = 0;
      for (const part of parts) {
        bodyArray.set(part, offset);
        offset += part.byteLength;
      }

      const res = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: bodyArray,
          cache: "no-store",
        },
      );

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Drive upload ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const data = (await res.json()) as { id: string; name: string };
      driveFileId = data.id;
      break; // Success
    } catch (err) {
      if (driveAttempt === 1) {
        Sentry.captureException(err);
        const msg = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `Drive save failed after retry: ${msg}` }, { status: 502 });
      }
      // First attempt failed — retry
      console.warn("[eagleview] Drive upload failed, retrying:", err);
    }
  }

  // Step 7: Generate thumbnail
  let thumbnailUrl: string | null = null;
  try {
    const thumbnailBuffer = await sharp(Buffer.from(imageBuffer))
      .resize({ width: 300, withoutEnlargement: true })
      .png({ quality: 80 })
      .toBuffer();
    thumbnailUrl = `data:image/png;base64,${thumbnailBuffer.toString("base64")}`;
  } catch (err) {
    // Non-fatal: proceed without thumbnail
    console.warn("[eagleview] Thumbnail generation failed:", err);
  }

  // Step 8: Upsert DB record
  const record = await prisma.eagleViewImagery.upsert({
    where: { dealId },
    create: {
      dealId,
      imageUrn: bestOrtho.imageUrn,
      captureDate: bestOrtho.captureDate ? new Date(bestOrtho.captureDate) : null,
      gsd: bestOrtho.gsd,
      driveFileId: driveFileId!,
      driveFolderId,
      thumbnailUrl,
      fetchedAt: new Date(),
      fetchedBy: user.email,
    },
    update: {
      imageUrn: bestOrtho.imageUrn,
      captureDate: bestOrtho.captureDate ? new Date(bestOrtho.captureDate) : null,
      gsd: bestOrtho.gsd,
      driveFileId: driveFileId!,
      driveFolderId,
      thumbnailUrl,
      fetchedAt: new Date(),
      fetchedBy: user.email,
    },
  });

  return NextResponse.json({
    exists: true,
    imageUrn: record.imageUrn,
    captureDate: record.captureDate,
    gsd: record.gsd,
    thumbnailUrl: record.thumbnailUrl,
    driveFileId: record.driveFileId,
    fetchedAt: record.fetchedAt,
  });
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/eagleview/imagery/route.ts
git commit -m "feat(eagleview): add POST /api/eagleview/imagery fetch pipeline"
```

---

### Task 6: GET /api/eagleview/imagery/[dealId]/image — proxy route

**Files:**
- Create: `src/app/api/eagleview/imagery/[dealId]/image/route.ts`

- [ ] **Step 1: Create the image proxy route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getDriveToken } from "@/lib/drive-plansets";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const record = await prisma.eagleViewImagery.findUnique({ where: { dealId } });

  if (!record?.driveFileId) {
    return NextResponse.json({ error: "No imagery found for this deal" }, { status: 404 });
  }

  const token = await getDriveToken();
  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${record.driveFileId}?alt=media&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!driveRes.ok) {
    return NextResponse.json(
      { error: `Drive fetch failed: ${driveRes.status}` },
      { status: 502 },
    );
  }

  const contentType = driveRes.headers.get("content-type") ?? "image/png";

  return new NextResponse(driveRes.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
```

Key points:
- Streams the Drive response body directly (no buffering) to handle large images within Vercel timeout.
- `Cache-Control: public, max-age=86400` — image is static once fetched, cache for 24h.
- Uses `getDriveToken()` (read-only scope) — sufficient for downloading.

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/eagleview/imagery/[dealId]/image/route.ts
git commit -m "feat(eagleview): add image proxy route with Drive streaming"
```

---

## Chunk 3: Frontend — EagleViewButton + Solar Surveyor

### Task 7: Create EagleViewButton component

**Files:**
- Create: `src/components/EagleViewButton.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface EagleViewImageryData {
  exists: boolean;
  cached?: boolean;
  imageUrn?: string;
  captureDate?: string;
  gsd?: number;
  thumbnailUrl?: string;
  driveFileId?: string;
  fetchedAt?: string;
}

interface EagleViewButtonProps {
  dealId: string;
}

export default function EagleViewButton({ dealId }: EagleViewButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();

  // Check if imagery already exists
  const { data, isLoading: isChecking } = useQuery({
    queryKey: queryKeys.eagleview.imagery(dealId),
    queryFn: async (): Promise<EagleViewImageryData> => {
      const res = await fetch(`/api/eagleview/imagery?dealId=${dealId}`);
      if (!res.ok) throw new Error("Failed to check imagery");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch new imagery
  const fetchMutation = useMutation({
    mutationFn: async (force = false): Promise<EagleViewImageryData> => {
      const res = await fetch("/api/eagleview/imagery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, force }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error || body.message || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.eagleview.imagery(dealId) });
    },
  });

  const hasImagery = data?.exists === true;
  const isLoading = isChecking || fetchMutation.isPending;

  // ── No imagery state ──
  if (!hasImagery && !isLoading && !fetchMutation.isError) {
    return (
      <button
        onClick={() => fetchMutation.mutate(false)}
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm
                   text-foreground hover:bg-surface-2 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Pull Aerial
      </button>
    );
  }

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Fetching aerial imagery...
      </div>
    );
  }

  // ── Error state ──
  if (fetchMutation.isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
        <span className="text-red-500">
          {fetchMutation.error instanceof Error ? fetchMutation.error.message : "Failed to fetch imagery"}
        </span>
        <button
          onClick={() => fetchMutation.mutate(false)}
          className="ml-2 text-xs text-muted hover:text-foreground underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Has imagery state ──
  return (
    <>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowModal(true)}
          className="group relative overflow-hidden rounded-lg border border-border hover:border-cyan-500/50 transition-colors"
        >
          {data?.thumbnailUrl ? (
            <img
              src={data.thumbnailUrl}
              alt="Aerial imagery"
              className="h-16 w-24 object-cover"
            />
          ) : (
            <div className="flex h-16 w-24 items-center justify-center bg-surface-2 text-xs text-muted">
              No preview
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
            <span className="text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
              View
            </span>
          </div>
        </button>
        <div className="flex flex-col gap-0.5 text-xs text-muted">
          {data?.captureDate && (
            <span>Captured {new Date(data.captureDate).toLocaleDateString()}</span>
          )}
          {data?.gsd && <span>{data.gsd.toFixed(1)} cm/px</span>}
          <button
            onClick={() => fetchMutation.mutate(true)}
            className="text-left text-cyan-500 hover:text-cyan-400 underline"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Full-res modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] overflow-auto rounded-xl bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm text-muted">
                {data?.captureDate && (
                  <span>Captured: {new Date(data.captureDate).toLocaleDateString()}</span>
                )}
                {data?.gsd && <span>Resolution: {data.gsd.toFixed(1)} cm/px</span>}
              </div>
              <div className="flex items-center gap-2">
                {data?.driveFileId && (
                  <a
                    href={`https://drive.google.com/file/d/${data.driveFileId}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
                  >
                    Open in Drive
                  </a>
                )}
                <a
                  href={`/api/eagleview/imagery/${dealId}/image`}
                  download={`EagleView_Aerial_${dealId}.png`}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
                >
                  Download
                </a>
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
                >
                  Close
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/eagleview/imagery/${dealId}/image`}
              alt="EagleView aerial imagery"
              className="max-h-[80vh] rounded-lg"
            />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/EagleViewButton.tsx
git commit -m "feat(eagleview): add EagleViewButton component with thumbnail + modal"
```

---

### Task 8: Wire EagleViewButton into Solar Surveyor

**Files:**
- Modify: `src/components/solar/SolarSurveyorShell.tsx`
- Modify: `src/components/solar/SetupWizard.tsx`

**Important context:** Classic Mode is a sandboxed iframe (`ClassicWorkspace.tsx`). The `EagleViewButton` cannot go inside the iframe. It goes in the React shell around it. The shell has `selectedProjectId` — we'll need to fetch the project to get its associated deal ID.

**Design note:** Solar Surveyor projects don't currently store a `dealId`. The EagleViewButton needs a deal ID to work. For Phase A, we'll add the button to the shell with a deal ID input/lookup. This keeps the scope minimal. A future enhancement could link Solar projects to deals automatically.

- [ ] **Step 1: Add EagleViewButton to SolarSurveyorShell**

Read `src/components/solar/SolarSurveyorShell.tsx` to find the exact toolbar/header area where buttons are rendered (near the mode toggle buttons). Add the `EagleViewButton` in the header toolbar, visible when in Classic or Native mode with a selected project. Include a small text input for deal ID since projects don't currently store one:

```tsx
import EagleViewButton from "@/components/EagleViewButton";
```

Add state for the deal ID:
```tsx
const [eagleviewDealId, setEagleviewDealId] = useState("");
```

Add in the header toolbar area (near mode toggle buttons), wrapped in a conditional:
```tsx
{(activeView === "classic" || activeView === "native") && (
  <div className="flex items-center gap-2">
    <input
      type="text"
      placeholder="Deal ID"
      value={eagleviewDealId}
      onChange={(e) => setEagleviewDealId(e.target.value)}
      className="w-24 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted"
    />
    {eagleviewDealId && <EagleViewButton dealId={eagleviewDealId} />}
  </div>
)}
```

- [ ] **Step 2: Add EagleViewButton to SetupWizard Step 1**

Read `src/components/solar/wizard/StepBasics.tsx` and `src/components/solar/SetupWizard.tsx` to find where the basics step renders. After the address input in StepBasics, add an optional deal ID field and the EagleView button.

In `StepBasics.tsx`, add a deal ID input below the address field:

```tsx
import EagleViewButton from "@/components/EagleViewButton";
```

Add state:
```tsx
const [dealId, setDealId] = useState("");
```

Add after the address input field:
```tsx
<div className="space-y-1">
  <label htmlFor="deal-id" className="text-sm font-medium text-foreground">
    HubSpot Deal ID <span className="text-muted">(optional — for aerial imagery)</span>
  </label>
  <div className="flex items-center gap-2">
    <input
      id="deal-id"
      type="text"
      value={dealId}
      onChange={(e) => setDealId(e.target.value.trim())}
      placeholder="e.g. 12345678"
      maxLength={20}
      className="w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted"
    />
    {dealId && <EagleViewButton dealId={dealId} />}
  </div>
</div>
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/solar/SolarSurveyorShell.tsx src/components/solar/wizard/StepBasics.tsx
git commit -m "feat(eagleview): wire EagleViewButton into Solar Surveyor shell + wizard"
```

---

## Chunk 4: AI Design Review Integration

### Task 9: Include aerial image in AI design review

**Files:**
- Modify: `src/lib/checks/design-review-ai.ts`

- [ ] **Step 1: Add EagleView imagery lookup before Claude call**

Read `src/lib/checks/design-review-ai.ts` lines 240-330 (the main review flow). Insert the EagleView lookup between "Step 2: Find + download planset PDF" and "Step 3: Upload PDF to Anthropic Files API".

Add import at the top:
```typescript
import { prisma } from "@/lib/db";
import { getDriveToken } from "@/lib/drive-plansets";
```

After the planset PDF download (after `const { buffer, filename } = await downloadDrivePdf(selectedFile.id);`), add the following. **Important:** Declare `aerialImageFileId` at the same scope level as `anthropicFileId` (function top level, not inside a nested try block) so it's accessible in the content array, user message call, and cleanup section:

```typescript
    // ── Step 2b: Check for EagleView aerial imagery ──
    let aerialImageFileId: string | undefined;
    try {
      const evRecord = await prisma.eagleViewImagery.findUnique({ where: { dealId } });
      if (evRecord?.driveFileId) {
        const driveToken = await getDriveToken();
        const aerialRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${evRecord.driveFileId}?alt=media&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${driveToken}` }, cache: "no-store" },
        );
        if (aerialRes.ok) {
          const aerialBuffer = await aerialRes.arrayBuffer();
          const aerialFile = await client.beta.files.upload({
            file: new File([new Uint8Array(aerialBuffer)], `aerial_${dealId}.png`, { type: "image/png" }),
          });
          aerialImageFileId = aerialFile.id;
        } else {
          console.warn(`[design-review-ai] Failed to download EagleView image from Drive: ${aerialRes.status}`);
        }
      }
    } catch (err) {
      // Non-fatal: proceed without aerial image
      console.warn("[design-review-ai] EagleView imagery lookup failed:", err);
    }

    await heartbeat(); // milestone: aerial image checked
```

- [ ] **Step 2: Add aerial image to Claude message content array**

In the `messages` content array (around line 315), add the aerial image document block between the planset PDF block and the text block:

Change the content array from:
```typescript
content: [
  {
    type: "document",
    source: { type: "file", file_id: anthropicFileId },
  },
  {
    type: "text",
    text: userMessage,
  },
],
```

To:
```typescript
content: [
  {
    type: "document",
    source: { type: "file", file_id: anthropicFileId },
  },
  // Include aerial imagery if available
  ...(aerialImageFileId
    ? [{
        type: "image" as const,
        source: { type: "file" as const, file_id: aerialImageFileId },
      }]
    : []),
  {
    type: "text",
    text: userMessage,
  },
],
```

- [ ] **Step 3: Update the user message to mention aerial imagery**

In the `buildUserMessage` function, add a conditional line about the aerial image. At the end of the function, before the final instruction paragraph, add:

```typescript
if (aerialImageFileId) {
  lines.push("");
  lines.push("**Aerial Imagery:** An aerial orthographic image of the property is included. " +
    "Use it to visually verify: fire setbacks (ridge, hip, valley, eave, rake, pathway distances), " +
    "panel placement relative to roof edges, equipment placement clearances relative to property " +
    "boundaries, access path visibility, and roof shape/area consistency between the planset and " +
    "the actual property.");
}
```

Note: `buildUserMessage` will need the `hasAerialImage` parameter added to its signature. Update the function signature (note: existing types use `Record<string, string>`, not `string | null`):

```typescript
function buildUserMessage(
  dealContext: Record<string, string>,
  ahjContext: Record<string, string>[],
  utilityContext: Record<string, string>[],
  filename: string,
  hasAerialImage = false,
): string {
```

And the conditional becomes:
```typescript
if (hasAerialImage) {
  lines.push("");
  lines.push("**Aerial Imagery:** An aerial orthographic image of the property is included. ...");
}
```

Update the call site:
```typescript
const userMessage = buildUserMessage(dealContext, ahjContext, utilityContext, filename, !!aerialImageFileId);
```

- [ ] **Step 4: Clean up aerial image file after response**

In the cleanup section (around line 382), add cleanup for the aerial image file:

```typescript
    // Clean up uploaded files (best-effort)
    if (anthropicFileId) {
      await client.beta.files.delete(anthropicFileId).catch((e) => {
        console.warn("[design-review-ai] Failed to delete uploaded file:", anthropicFileId, e);
      });
    }
    if (aerialImageFileId) {
      await client.beta.files.delete(aerialImageFileId).catch((e) => {
        console.warn("[design-review-ai] Failed to delete aerial image file:", aerialImageFileId, e);
      });
    }
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/checks/design-review-ai.ts
git commit -m "feat(eagleview): include aerial image in AI design review when available"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (including the new eagleview tests from Task 2).

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit any lint/build fixes if needed**

```bash
git add -A
git commit -m "fix(eagleview): address lint and build issues"
```
