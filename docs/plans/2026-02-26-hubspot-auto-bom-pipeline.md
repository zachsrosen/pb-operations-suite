# HubSpot → Auto-BOM → Zoho SO/PO Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a HubSpot deal moves to a specific stage (e.g. "Design Approved"), automatically extract the BOM from the planset PDF stored in Google Drive, save a BOM snapshot, and create draft Zoho SO + PO — zero manual input.

**Architecture:** HubSpot webhook → HMAC-verified handler → background orchestrator → reused extraction lib (refactored from the existing `/api/bom/extract` route) → existing `create-so` / `create-po` logic → HubSpot deal property writeback. An `AutoBomRun` DB model tracks every pipeline run for auditability and retry.

**Tech Stack:** Next.js App Router API routes, Prisma 7.3 / Neon Postgres, Anthropic Files API (Claude claude-sonnet-4-5), Zoho Inventory API, HubSpot Properties API, existing `zohoInventory` lib, existing `logActivity` / `prisma` from `@/lib/db`.

---

## Pre-Work: Manual HubSpot Setup (Do Once Before Coding)

Before implementing, create two custom deal properties in HubSpot (Settings → Properties → Deals → Create Property):

| Property Label | Internal Name | Type | Purpose |
|---|---|---|---|
| Planset Drive URL | `planset_drive_url` | Single-line text | Google Drive URL for the stamped planset PDF |
| Zoho Customer ID | `zoho_customer_id` | Single-line text | Zoho Inventory customer ID (for SO creation) |
| Zoho Vendor ID | `zoho_vendor_id` | Single-line text | Zoho Inventory vendor ID (for PO creation) |
| Auto BOM Status | `auto_bom_status` | Single-line text | Written back by pipeline (e.g. "SO/PO Created") |
| Auto BOM SO Number | `auto_bom_so_number` | Single-line text | Zoho SO number written back after creation |
| Auto BOM PO Number | `auto_bom_po_number` | Single-line text | Zoho PO number written back after creation |

Also create a HubSpot webhook subscription (Settings → Integrations → Private Apps → Webhooks):
- Event: `deal.propertyChange`
- Property: `dealstage`
- Target URL: `https://your-app.vercel.app/api/webhooks/hubspot`

Note the **client secret** from the private app — this goes in `HUBSPOT_CLIENT_SECRET` env var (already exists for OAuth; reuse it for webhook HMAC verification).

Configure which deal stage triggers the automation in a new env var: `AUTO_BOM_TRIGGER_STAGE` (e.g. `"design_approved"` — the HubSpot internal stage ID, not display name).

Also add: `AUTO_BOM_SYSTEM_USER_EMAIL` (e.g. `"automation@photonbrothers.com"`) — used as `savedBy` on snapshots created by the automation.

---

## Task 1: Add `AutoBomRun` Prisma Model

**Files:**
- Modify: `prisma/schema.prisma` (add model after `ProjectBomSnapshot`)
- Run: `npx prisma migrate dev`

**Step 1: Add the enum and model to schema.prisma**

After the `ProjectBomSnapshot` model (around line 764), add:

```prisma
enum AutoBomStatus {
  PENDING      // queued, not yet started
  EXTRACTING   // Claude is reading the PDF
  EXTRACTED    // BOM saved as snapshot, SO/PO creation starting
  COMPLETE     // SO and PO created in Zoho
  FAILED       // unrecoverable error (see errorMessage)
}

model AutoBomRun {
  id            String        @id @default(cuid())
  dealId        String        // HubSpot deal ID
  dealName      String        // deal name at time of trigger
  triggerStage  String        // the deal stage that triggered this run
  driveUrl      String        // planset Drive URL used
  status        AutoBomStatus @default(PENDING)
  snapshotId    String?       // ProjectBomSnapshot.id once saved
  zohoSoId      String?       // Zoho SO ID once created
  zohoPoId      String?       // Zoho PO ID once created
  soNumber      String?       // human-readable SO number
  poNumber      String?       // human-readable PO number
  unmatchedCount Int?         // items not matched in Zoho catalog
  errorMessage  String?       // set on FAILED
  triggeredAt   DateTime      @default(now())
  completedAt   DateTime?

  @@index([dealId])
  @@index([status])
  @@index([triggeredAt])
}
```

**Step 2: Run migration**

```bash
cd /Users/zach/Downloads/PB-Operations-Suite
npx prisma migrate dev --name add-auto-bom-run
```

Expected: migration created and applied, `prisma generate` runs automatically.

**Step 3: Verify**

```bash
npx prisma studio
```

Confirm `AutoBomRun` table appears in the studio. Then close studio (Ctrl+C).

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(bom): add AutoBomRun model for automated pipeline tracking"
```

---

## Task 2: Refactor Extraction Logic into `lib/bom-extract.ts`

The `/api/bom/extract/route.ts` currently contains all PDF-fetch + Claude-extraction logic inside the SSE handler. The orchestrator needs to call this logic server-to-server (no HTTP, no SSE). Refactor by extracting the core into a shared function.

**Files:**
- Create: `src/lib/bom-extract.ts`
- Modify: `src/app/api/bom/extract/route.ts` (call the shared function instead of inline logic)

**Step 1: Create `src/lib/bom-extract.ts`**

This file exports one function: `extractBomFromDriveUrl(driveUrl: string, onProgress?: (msg: string) => void): Promise<BomData>`.

```typescript
// src/lib/bom-extract.ts
// Core BOM extraction logic — shared between the SSE API route and the auto-pipeline orchestrator.
// The SSE route passes `onProgress` to stream messages; the orchestrator passes undefined (fire-and-forget logging).

import Anthropic from "@anthropic-ai/sdk";
import { BomData } from "@/types/bom"; // adjust import path if needed

const client = new Anthropic();

/**
 * Downloads a PDF from Google Drive and extracts a BOM using Claude.
 * @param driveUrl - Google Drive URL (share link or direct download link)
 * @param onProgress - optional callback for progress messages (used by SSE route)
 * @returns Parsed BomData object
 */
export async function extractBomFromDriveUrl(
  driveUrl: string,
  onProgress?: (step: string, message: string) => void
): Promise<BomData> {
  onProgress?.("downloading", "Downloading PDF from Google Drive…");

  // -- Step 1: Fetch the PDF buffer from Drive (reuse existing getDriveDownloadUrl logic) --
  // Move the Drive URL normalization + fetch logic here from the route.
  // Return Buffer.
  const pdfBuffer = await fetchDrivePdf(driveUrl);

  const sizeMb = (pdfBuffer.byteLength / 1024 / 1024).toFixed(1);
  const pageCount = getPdfPageCount(pdfBuffer);
  const pageLabel = pageCount ? `, ${pageCount}-page planset` : "";
  onProgress?.("uploading", `Uploading to BOM Tool (${sizeMb} MB${pageLabel})…`);

  // -- Step 2: Upload to Anthropic Files API --
  const file = new File([pdfBuffer], "planset.pdf", { type: "application/pdf" });
  const uploadedFile = await client.beta.files.upload({ file });

  const pageStr = pageCount ? ` — reading ${pageCount}-page planset` : "";
  onProgress?.("extracting", `Extracting BOM${pageStr} (30–60 seconds)…`);

  // -- Step 3: Call Claude with the extraction prompt --
  const rawText = await callClaudeExtract(uploadedFile.id);

  // -- Step 4: Cleanup uploaded file --
  await client.beta.files.delete(uploadedFile.id).catch(() => {});

  // -- Step 5: Parse JSON --
  onProgress?.("parsing", "Parsing BOM…");
  const bomData = parseBomJson(rawText);

  return bomData;
}
```

**Important:** Do NOT copy-paste the full implementation yet — first read the existing route carefully and extract these helpers:
- `fetchDrivePdf(url)` — the Drive URL normalization + fetch logic (already in route, ~80 lines)
- `getPdfPageCount(buffer)` — already defined in route
- `callClaudeExtract(fileId)` — the `client.messages.create(...)` call with the big EXTRACTION_PROMPT
- `parseBomJson(raw)` — the JSON.parse + schema validation logic
- `EXTRACTION_PROMPT` — the big template literal constant

Move all of these into `bom-extract.ts`. The SSE route then imports and calls `extractBomFromDriveUrl`, passing its `send()` function as `onProgress`.

**Step 2: Update `src/app/api/bom/extract/route.ts`**

The Drive-URL branch of the POST handler becomes:

```typescript
// Drive URL path
const bomData = await extractBomFromDriveUrl(
  driveUrl,
  (step, message) => send({ type: "progress", step, message })
);
send({ type: "result", bom: bomData });
```

The file-upload path still works inline in the route (it's a different code path that reads the multipart body, which can't be moved to a library easily without threading the Request through). Keep the upload path as-is for now, only refactor the Drive URL path.

**Step 3: Run build to verify no TypeScript errors**

```bash
npm run build 2>&1 | head -50
```

Expected: build succeeds (0 errors).

**Step 4: Test manually** — open `/dashboards/bom`, paste a Drive URL, click Extract. Should still work identically.

**Step 5: Commit**

```bash
git add src/lib/bom-extract.ts src/app/api/bom/extract/route.ts
git commit -m "refactor(bom): extract Drive-URL extraction logic into lib/bom-extract.ts for reuse"
```

---

## Task 3: Create the Auto-BOM Orchestrator

**Files:**
- Create: `src/lib/bom-orchestrator.ts`

This function is called by the webhook handler. It runs the full pipeline asynchronously (after the webhook returns 200).

```typescript
// src/lib/bom-orchestrator.ts
import { prisma, logActivity } from "@/lib/db";
import { extractBomFromDriveUrl } from "@/lib/bom-extract";
import { zohoInventory } from "@/lib/zoho-inventory";
import { hubspotClient } from "@/lib/hubspot"; // existing HubSpot client
import { BomData } from "@/types/bom";

const SYSTEM_USER = process.env.AUTO_BOM_SYSTEM_USER_EMAIL ?? "automation@system";

export async function runAutoBomPipeline(runId: string): Promise<void> {
  if (!prisma) return;

  const run = await prisma.autoBomRun.findUnique({ where: { id: runId } });
  if (!run) return;

  const log = (msg: string) =>
    console.log(`[auto-bom][${run.dealId}] ${msg}`);

  try {
    // ── Stage 1: Extract BOM from Drive PDF ──────────────────────────────────
    log("Starting extraction from " + run.driveUrl);
    await prisma.autoBomRun.update({ where: { id: runId }, data: { status: "EXTRACTING" } });

    let bomData: BomData;
    try {
      bomData = await extractBomFromDriveUrl(run.driveUrl, (step, msg) =>
        log(`[${step}] ${msg}`)
      );
    } catch (e) {
      throw new Error(`Extraction failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ── Stage 2: Save BOM snapshot ───────────────────────────────────────────
    log("Saving BOM snapshot");
    // Find next version number for this deal
    const lastSnapshot = await prisma.projectBomSnapshot.findFirst({
      where: { dealId: run.dealId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (lastSnapshot?.version ?? 0) + 1;

    const snapshot = await prisma.projectBomSnapshot.create({
      data: {
        dealId: run.dealId,
        dealName: run.dealName,
        version: nextVersion,
        bomData: bomData as object,
        sourceFile: "auto-extracted",
        savedBy: SYSTEM_USER,
      },
    });

    await prisma.autoBomRun.update({
      where: { id: runId },
      data: { status: "EXTRACTED", snapshotId: snapshot.id },
    });

    // ── Stage 3: Create Zoho SO ──────────────────────────────────────────────
    // Get customer ID and vendor ID from HubSpot deal properties
    const deal = await hubspotClient.crm.deals.basicApi.getById(run.dealId, [
      "dealname", "zoho_customer_id", "zoho_vendor_id"
    ]);
    const customerId = deal.properties.zoho_customer_id ?? process.env.ZOHO_DEFAULT_CUSTOMER_ID;
    const vendorId = deal.properties.zoho_vendor_id ?? process.env.ZOHO_DEFAULT_VENDOR_ID;

    if (!customerId || !vendorId) {
      throw new Error(
        `Missing Zoho IDs: customerId=${customerId}, vendorId=${vendorId}. ` +
        `Set zoho_customer_id/zoho_vendor_id on the deal or ZOHO_DEFAULT_CUSTOMER_ID/VENDOR_ID env vars.`
      );
    }

    log("Creating Zoho SO");
    // Reuse the same matching logic from create-so/route.ts
    const { soId, soNumber, soUnmatched } = await createZohoSO(
      snapshot, bomData, customerId, run.dealId, nextVersion
    );

    log("Creating Zoho PO");
    const { poId, poNumber, poUnmatched } = await createZohoPO(
      snapshot, bomData, vendorId, run.dealId, nextVersion
    );

    // ── Stage 4: Writeback to HubSpot ────────────────────────────────────────
    log("Writing back to HubSpot deal");
    await hubspotClient.crm.deals.basicApi.update(run.dealId, {
      properties: {
        auto_bom_status: `SO/PO Created (${soUnmatched + poUnmatched} unmatched items)`,
        auto_bom_so_number: soNumber,
        auto_bom_po_number: poNumber,
      },
    });

    // ── Stage 5: Mark run complete ───────────────────────────────────────────
    await prisma.autoBomRun.update({
      where: { id: runId },
      data: {
        status: "COMPLETE",
        zohoSoId: soId,
        zohoPoId: poId,
        soNumber,
        poNumber,
        unmatchedCount: soUnmatched,
        completedAt: new Date(),
      },
    });

    await logActivity({
      type: "FEATURE_USED",
      description: `Auto-BOM pipeline completed for ${run.dealName}: SO ${soNumber}, PO ${poNumber}`,
      userEmail: SYSTEM_USER,
      userName: "Auto-BOM",
      entityType: "bom",
      entityId: run.dealId,
      entityName: run.dealName,
      metadata: { runId, soId, poId, soNumber, poNumber, soUnmatched, poUnmatched },
      requestPath: "/api/webhooks/hubspot",
      requestMethod: "POST",
      responseStatus: 200,
      durationMs: 0,
    });

    log("Pipeline complete ✓");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("Pipeline FAILED: " + msg);

    await prisma.autoBomRun.update({
      where: { id: runId },
      data: { status: "FAILED", errorMessage: msg },
    }).catch(() => {});

    // Writeback failure to HubSpot so ops can see it in the deal
    try {
      await hubspotClient.crm.deals.basicApi.update(run.dealId, {
        properties: { auto_bom_status: `Failed: ${msg.slice(0, 200)}` },
      });
    } catch { /* non-fatal */ }
  }
}

// ── Zoho SO helper (extracted from create-so/route.ts logic) ─────────────────
async function createZohoSO(
  snapshot: { id: string; dealName: string },
  bomData: BomData,
  customerId: string,
  dealId: string,
  version: number
): Promise<{ soId: string; soNumber: string; soUnmatched: number }> {
  const bomItems = Array.isArray(bomData?.items) ? bomData.items : [];
  let unmatchedCount = 0;
  const lineItems: { item_id: string; name: string; quantity: number; description: string }[] = [];

  for (const item of bomItems) {
    const name = item.model
      ? `${item.brand ? item.brand + " " : ""}${item.model}`
      : item.description;
    const searchTerms = [item.model, name, item.description].filter(
      (t): t is string => !!t && t.trim().length > 1
    );
    let match: { item_id: string; zohoName: string } | null = null;
    for (const term of searchTerms) {
      match = await zohoInventory.findItemIdByName(term);
      if (match) break;
    }
    if (!match) { unmatchedCount++; continue; }
    const qty = Math.round(Number(item.qty));
    lineItems.push({
      item_id: match.item_id,
      name,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      description: item.description,
    });
  }

  const address = bomData?.project?.address ?? "";
  const soResult = await zohoInventory.createSalesOrder({
    customer_id: customerId,
    salesorder_number: `SO-${dealId}`,
    reference_number: snapshot.dealName.slice(0, 50),
    notes: `Auto-generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
    status: "draft",
    line_items: lineItems,
  });

  if (!prisma) throw new Error("prisma not configured");
  await prisma.projectBomSnapshot.update({
    where: { id: snapshot.id },
    data: { zohoSoId: soResult.salesorder_id },
  });

  return { soId: soResult.salesorder_id, soNumber: soResult.salesorder_number, soUnmatched: unmatchedCount };
}

// ── Zoho PO helper (extracted from create-po/route.ts logic) ─────────────────
async function createZohoPO(
  snapshot: { id: string; dealName: string },
  bomData: BomData,
  vendorId: string,
  dealId: string,
  version: number
): Promise<{ poId: string; poNumber: string; poUnmatched: number }> {
  const bomItems = Array.isArray(bomData?.items) ? bomData.items : [];
  let unmatchedCount = 0;
  const lineItems: { item_id: string; name: string; quantity: number; description: string }[] = [];

  for (const item of bomItems) {
    const name = item.model
      ? `${item.brand ? item.brand + " " : ""}${item.model}`
      : item.description;
    const searchTerms = [item.model, name, item.description].filter(
      (t): t is string => !!t && t.trim().length > 1
    );
    let match: { item_id: string; zohoName: string } | null = null;
    for (const term of searchTerms) {
      match = await zohoInventory.findItemIdByName(term);
      if (match) break;
    }
    if (!match) { unmatchedCount++; continue; }
    const qty = Math.round(Number(item.qty));
    lineItems.push({
      item_id: match.item_id,
      name,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      description: item.description,
    });
  }

  const address = bomData?.project?.address ?? "";
  const poResult = await zohoInventory.createPurchaseOrder({
    vendor_id: vendorId,
    purchaseorder_number: `PO-${dealId}`,
    reference_number: snapshot.dealName.slice(0, 50),
    notes: `Auto-generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
    status: "draft",
    line_items: lineItems,
  });

  if (!prisma) throw new Error("prisma not configured");
  await prisma.projectBomSnapshot.update({
    where: { id: snapshot.id },
    data: { zohoPoId: poResult.purchaseorder_id },
  });

  return { poId: poResult.purchaseorder_id, poNumber: poResult.purchaseorder_number, poUnmatched: unmatchedCount };
}
```

**Step 2: Build check**

```bash
npm run build 2>&1 | head -50
```

Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/lib/bom-orchestrator.ts
git commit -m "feat(bom): add auto-BOM orchestrator with full pipeline logic"
```

---

## Task 4: Create HubSpot Webhook Handler

**Files:**
- Create: `src/app/api/webhooks/hubspot/route.ts`

HubSpot sends POST requests with a JSON body (array of subscription events). The handler must:
1. Verify HMAC signature (v1 scheme: `sha256(clientSecret + requestBody)`)
2. Return 200 immediately (HubSpot retries if it doesn't get 200 quickly)
3. Process matching events asynchronously (don't await the orchestrator)

```typescript
// src/app/api/webhooks/hubspot/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma, logActivity } from "@/lib/db";
import { runAutoBomPipeline } from "@/lib/bom-orchestrator";
import { hubspotClient } from "@/lib/hubspot";

export const runtime = "nodejs";

const TRIGGER_STAGE = process.env.AUTO_BOM_TRIGGER_STAGE ?? "";
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET ?? "";

// HubSpot v1 signature: sha256(clientSecret + rawBody), hex-encoded
function verifyHubSpotSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !CLIENT_SECRET) return false;
  const expected = crypto
    .createHash("sha256")
    .update(CLIENT_SECRET + rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionType: string;
  propertyName?: string;
  propertyValue?: string;
  objectId: number; // deal ID (numeric)
  changeSource?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Read raw body for signature verification
  const rawBody = await request.text();
  const signature = request.headers.get("x-hubspot-signature");

  if (!verifyHubSpotSignature(rawBody, signature)) {
    console.warn("[webhook/hubspot] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 2. Parse events
  let events: HubSpotWebhookEvent[];
  try {
    events = JSON.parse(rawBody);
    if (!Array.isArray(events)) events = [events];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 3. Return 200 immediately — process async
  // We fire-and-forget; HubSpot considers the delivery successful on 200.
  (async () => {
    for (const event of events) {
      // Only handle deal stage changes to our trigger stage
      if (
        event.subscriptionType !== "deal.propertyChange" ||
        event.propertyName !== "dealstage" ||
        event.propertyValue !== TRIGGER_STAGE
      ) {
        continue;
      }

      const dealId = String(event.objectId);

      try {
        if (!prisma) { console.error("[webhook/hubspot] No prisma"); continue; }

        // Fetch deal to get name and planset URL
        const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
          "dealname", "planset_drive_url",
        ]);
        const dealName = deal.properties.dealname ?? `Deal ${dealId}`;
        const driveUrl = deal.properties.planset_drive_url;

        if (!driveUrl) {
          console.warn(`[webhook/hubspot] Deal ${dealId} has no planset_drive_url — skipping`);
          await hubspotClient.crm.deals.basicApi.update(dealId, {
            properties: { auto_bom_status: "Skipped: no planset_drive_url set on deal" },
          });
          continue;
        }

        // Idempotency: skip if a run for this deal is already PENDING/EXTRACTING/COMPLETE
        const existingRun = await prisma.autoBomRun.findFirst({
          where: {
            dealId,
            status: { in: ["PENDING", "EXTRACTING", "EXTRACTED", "COMPLETE"] },
          },
          orderBy: { triggeredAt: "desc" },
        });
        if (existingRun && existingRun.status === "COMPLETE") {
          console.log(`[webhook/hubspot] Deal ${dealId} already has COMPLETE run — skipping`);
          continue;
        }
        if (existingRun && ["PENDING", "EXTRACTING", "EXTRACTED"].includes(existingRun.status)) {
          console.log(`[webhook/hubspot] Deal ${dealId} run already in progress (${existingRun.status})`);
          continue;
        }

        // Create the AutoBomRun record
        const run = await prisma.autoBomRun.create({
          data: {
            dealId,
            dealName,
            triggerStage: TRIGGER_STAGE,
            driveUrl,
            status: "PENDING",
          },
        });

        // Write "In Progress" to HubSpot immediately so ops can see it
        await hubspotClient.crm.deals.basicApi.update(dealId, {
          properties: { auto_bom_status: "In Progress…" },
        }).catch(() => {});

        // Launch orchestrator (no await — fire and forget)
        runAutoBomPipeline(run.id).catch((e) =>
          console.error("[webhook/hubspot] Orchestrator error:", e)
        );

        await logActivity({
          type: "FEATURE_USED",
          description: `Auto-BOM triggered for deal ${dealName} (stage: ${TRIGGER_STAGE})`,
          userEmail: "automation@system",
          userName: "HubSpot Webhook",
          entityType: "bom",
          entityId: dealId,
          entityName: dealName,
          metadata: { runId: run.id, driveUrl, triggerStage: TRIGGER_STAGE },
          requestPath: "/api/webhooks/hubspot",
          requestMethod: "POST",
          responseStatus: 200,
          durationMs: 0,
        });
      } catch (e) {
        console.error("[webhook/hubspot] Error processing event:", e);
      }
    }
  })();

  return NextResponse.json({ received: true });
}
```

**Step 2: Add env vars to `.env.example`**

```bash
# Auto-BOM Pipeline
AUTO_BOM_TRIGGER_STAGE=             # HubSpot internal stage ID (e.g. "design_approved")
AUTO_BOM_SYSTEM_USER_EMAIL=automation@photonbrothers.com
ZOHO_DEFAULT_CUSTOMER_ID=           # Fallback Zoho customer ID for SO creation
ZOHO_DEFAULT_VENDOR_ID=             # Fallback Zoho vendor ID for PO creation
```

Append those lines to `.env.example`.

**Step 3: Build check**

```bash
npm run build 2>&1 | head -50
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git add src/app/api/webhooks/hubspot/route.ts .env.example
git commit -m "feat(bom): add HubSpot webhook handler for auto-BOM pipeline"
```

---

## Task 5: Auto-BOM Run History API

**Files:**
- Create: `src/app/api/bom/auto-runs/route.ts`

Simple GET endpoint so the dashboard can show pipeline run history.

```typescript
// src/app/api/bom/auto-runs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!prisma) return NextResponse.json({ error: "DB not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("dealId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  const runs = await prisma.autoBomRun.findMany({
    where: dealId ? { dealId } : undefined,
    orderBy: { triggeredAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ runs });
}
```

**Step 2: Commit**

```bash
git add src/app/api/bom/auto-runs/route.ts
git commit -m "feat(bom): add auto-runs history API endpoint"
```

---

## Task 6: Auto-BOM Status Panel on BOM Dashboard

Add a small "Auto-Pipeline" status section to the existing BOM dashboard page at `/dashboards/bom`.

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Step 1: Locate the BOM dashboard page** — find where the existing action buttons / history drawer are rendered. The panel will go above or below the BOM table.

**Step 2: Add `AutoBomPanel` component inline (or as a small component in the same file):**

```tsx
// Displays the latest AutoBomRun for the currently-loaded deal.
// Shows status badge, SO/PO numbers, errors.
// Allows re-triggering via a "Re-run Auto-BOM" button (calls POST /api/webhooks/hubspot manually
// or directly triggers via a new /api/bom/trigger-auto-bom endpoint — see Task 7).

function AutoBomPanel({ dealId }: { dealId: string }) {
  const [runs, setRuns] = useState<AutoBomRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dealId) return;
    fetch(`/api/bom/auto-runs?dealId=${dealId}&limit=5`)
      .then(r => r.json())
      .then(d => { setRuns(d.runs ?? []); setLoading(false); });
  }, [dealId]);

  if (loading) return <div className="text-muted text-sm">Loading auto-BOM history…</div>;
  if (!runs.length) return <div className="text-muted text-sm">No auto-BOM runs for this deal.</div>;

  const latest = runs[0];
  const statusColor = {
    PENDING: "yellow", EXTRACTING: "blue", EXTRACTED: "blue",
    COMPLETE: "green", FAILED: "red"
  }[latest.status] ?? "gray";

  return (
    <div className="bg-surface rounded-lg border border-t-border p-4 space-y-2">
      <h3 className="font-semibold text-foreground">Auto-BOM Pipeline</h3>
      <div className="flex items-center gap-3">
        <span className={`text-xs font-medium px-2 py-0.5 rounded bg-${statusColor}-500/10 text-${statusColor}-500`}>
          {latest.status}
        </span>
        {latest.soNumber && <span className="text-sm text-foreground">SO: {latest.soNumber}</span>}
        {latest.poNumber && <span className="text-sm text-foreground">PO: {latest.poNumber}</span>}
        {latest.unmatchedCount != null && latest.unmatchedCount > 0 && (
          <span className="text-xs text-yellow-500">{latest.unmatchedCount} unmatched items</span>
        )}
      </div>
      {latest.errorMessage && (
        <p className="text-xs text-red-400 font-mono">{latest.errorMessage}</p>
      )}
      <p className="text-xs text-muted">
        {new Date(latest.triggeredAt).toLocaleString()}
      </p>
    </div>
  );
}
```

Add `type AutoBomRun` at the top of the page (or import from generated prisma types).

**Step 3: Build check + visual check**

```bash
npm run build 2>&1 | head -50
npm run dev
```

Navigate to `/dashboards/bom`, load a deal's BOM → see Auto-BOM panel.

**Step 4: Commit**

```bash
git add src/app/dashboards/bom/page.tsx
git commit -m "feat(bom): add AutoBomPanel to BOM dashboard showing pipeline run status"
```

---

## Task 7: Manual Trigger Endpoint (for testing without HubSpot stage change)

**Files:**
- Create: `src/app/api/bom/trigger-auto/route.ts`

This is for testing: POST `{ dealId }` and it kicks off the auto-BOM pipeline manually. Requires ADMIN role.

```typescript
// src/app/api/bom/trigger-auto/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { runAutoBomPipeline } from "@/lib/bom-orchestrator";
import { hubspotClient } from "@/lib/hubspot";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!prisma) return NextResponse.json({ error: "DB not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!["ADMIN", "OWNER"].includes(authResult.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { dealId } = await request.json();
  if (!dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 });

  const deal = await hubspotClient.crm.deals.basicApi.getById(String(dealId), [
    "dealname", "planset_drive_url",
  ]);
  const driveUrl = deal.properties.planset_drive_url;
  if (!driveUrl) return NextResponse.json({ error: "Deal has no planset_drive_url" }, { status: 422 });

  const run = await prisma.autoBomRun.create({
    data: {
      dealId: String(dealId),
      dealName: deal.properties.dealname ?? `Deal ${dealId}`,
      triggerStage: "manual",
      driveUrl,
      status: "PENDING",
    },
  });

  // Fire and forget
  runAutoBomPipeline(run.id).catch(console.error);

  return NextResponse.json({ runId: run.id, status: "PENDING" });
}
```

**Step 2: Build check**

```bash
npm run build 2>&1 | head -50
```

**Step 3: Commit + push + PR**

```bash
git add src/app/api/bom/trigger-auto/route.ts
git commit -m "feat(bom): add manual trigger endpoint for auto-BOM pipeline testing"
```

---

## Task 8: Create PR and Deploy

**Step 1: Push branch and open PR**

```bash
# Use the commit-push-pr skill for this
```

Invoke `commit-commands:commit-push-pr` skill.

**Step 2: Add env vars in Vercel**

In Vercel dashboard → Project Settings → Environment Variables, add:
- `AUTO_BOM_TRIGGER_STAGE` — the internal HubSpot stage ID
- `AUTO_BOM_SYSTEM_USER_EMAIL`
- `ZOHO_DEFAULT_CUSTOMER_ID`
- `ZOHO_DEFAULT_VENDOR_ID`

**Step 3: Run database migration on production**

```bash
DATABASE_URL="<prod-url>" npx prisma migrate deploy
```

Or trigger via Vercel build command if `prisma migrate deploy` is added there.

**Step 4: Register webhook in HubSpot** (if not already done in pre-work):
- Settings → Integrations → Private Apps → Webhooks
- Add subscription: `deal.propertyChange` on `dealstage`
- Target URL: `https://pb-operations-suite.vercel.app/api/webhooks/hubspot`

**Step 5: End-to-end test**

1. Open a test deal in HubSpot that has `planset_drive_url` set
2. Call `POST /api/bom/trigger-auto` with `{ dealId: "<deal-id>" }` from the BOM dashboard
3. Poll `GET /api/bom/auto-runs?dealId=<deal-id>` — watch status change: `PENDING → EXTRACTING → EXTRACTED → COMPLETE`
4. Verify HubSpot deal properties show SO number, PO number, status
5. Verify Zoho Inventory has draft SO and PO

---

## Key Notes & Gotchas

### Vercel Function Timeout
The orchestrator runs inside a Vercel serverless function triggered by the webhook. The webhook handler returns 200 immediately and fires the orchestrator via `runAutoBomPipeline(run.id).catch(...)` (no await). However, Node.js serverless functions terminate when the response is sent — **the orchestrator will be killed**.

**Fix:** Use Vercel's `waitUntil` from `@vercel/functions` to keep the function alive:

```typescript
import { waitUntil } from "@vercel/functions";
// ...inside POST handler:
waitUntil(runAutoBomPipeline(run.id).catch(console.error));
return NextResponse.json({ received: true });
```

Add `@vercel/functions` to dependencies: `npm install @vercel/functions`.

The function will still be subject to `maxDuration`. Set `export const maxDuration = 300;` on the webhook route.

### HubSpot Webhook Signature
If the HMAC verification fails in production, check: HubSpot may use v3 signatures for newer apps. The v3 format is: `sha256(httpMethod + requestUri + requestBody + timestamp)` with header `x-hubspot-signature-v3`. Check which version your private app uses and update `verifyHubSpotSignature()` accordingly.

### Zoho Rate Limits
The orchestrator calls `findItemIdByName()` sequentially (same as the manual routes). The item cache is in-memory and won't persist across invocations. On cold start, every item lookup hits Zoho. This is acceptable for now but means the first auto-run after deploy will be slower.

### Idempotency
The webhook handler skips deals that already have a `COMPLETE` run. This prevents double-creation if HubSpot re-delivers the event. If a deal needs a re-run (e.g. planset was updated), use the manual trigger endpoint (`POST /api/bom/trigger-auto`) which always creates a new run.

---

## Verification Checklist

- [ ] `npx prisma migrate dev` creates `AutoBomRun` table
- [ ] `npm run build` — 0 TypeScript errors
- [ ] Drive URL extraction still works via BOM dashboard (regression test)
- [ ] `POST /api/bom/trigger-auto` with valid dealId → returns `{ runId, status: "PENDING" }`
- [ ] `GET /api/bom/auto-runs?dealId=<id>` → shows run progressing to COMPLETE
- [ ] HubSpot deal properties updated with SO/PO numbers after COMPLETE
- [ ] Zoho Inventory shows draft SO and PO with correct line items
- [ ] HubSpot webhook endpoint returns 200 with invalid signature → 401
- [ ] BOM dashboard AutoBomPanel shows latest run status for the loaded deal
