# PE File Preparation System

**Date**: 2026-05-16
**Status**: Design approved, pending implementation
**Author**: Claude + Zach

## Problem

Participate Energy milestone submissions (M1 = Inspection Complete, M2 = Project Complete) require 20-30 documents and photos gathered from Google Drive, PandaDoc, and the PE portal. The current `pe-turnover.ts` audit uses substring-based filename matching (`matchFileToItem()`) which is unreliable because:

- Real filenames don't match hints (e.g., `PE_CON_CO_Smith_123Main.pdf` doesn't contain "customer agreement")
- No content verification — can't detect unsigned documents, expired utility bills, or wrong document types
- Photos are matched by filename keywords, not by verifying the image content matches the PE requirement
- PandaDoc template documents (Attestation, CoA, Lien Waivers) aren't in GDrive until manually downloaded
- PMs spend 30-60 minutes per deal manually locating, verifying, and assembling files

## Solution

AI-powered file preparation system with three pillars:

1. **Vision Classifier** — Claude analyzes each candidate file (PDF first page, photo content) to classify and verify against PE checklist requirements
2. **PandaDoc Auto-Pull** — Automatically find, download, and place completed PandaDoc template documents into GDrive
3. **Dashboard UI** — PM-facing prep page with audit progress, verification results, photo grid with AI verdicts, and one-click package assembly

## Architecture: Hybrid Sync + DB Cache (Approach C)

Audit runs synchronously via SSE stream (~30-60 seconds for a full M1 audit). Results are persisted to a `PeAuditRun` database table for caching and history. The prep page loads cached results instantly and offers "Re-run Audit" to refresh.

```
PM clicks "Prepare PE Package"
  │
  ├─ POST /api/pe-prep/[dealId]/audit (SSE stream)
  │   ├─ Resolve PE deal from HubSpot
  │   ├─ Build GDrive folder map
  │   ├─ Check PandaDoc for 4 template docs
  │   │   └─ Download completed PDFs → GDrive PE folder
  │   ├─ Walk Drive folders, collect candidate files
  │   ├─ Vision classify each file (parallel, batches of 5-8)
  │   │   ├─ Documents: classify type, check signatures, validate dates
  │   │   └─ Photos: verify content matches PE requirement
  │   ├─ Combined-file resolution + lien waiver disambiguation
  │   ├─ Persist PeAuditRun to DB
  │   └─ Emit completed event with summary
  │
  ├─ GET /api/pe-prep/[dealId]/status (cached result)
  │
  └─ POST /api/pe-prep/[dealId]/assemble (package assembly)
      └─ Copy found + warned files → PE Turnover staging folder in GDrive
```

## Section 1: Vision Classifier Engine

New module `src/lib/pe-vision-classifier.ts`.

### Document Classification

For each candidate file in the GDrive folder tree:

1. Download file bytes via `downloadDrivePdf(fileId)` or `downloadDriveImage(fileId)` (existing functions in `drive-plansets.ts`)
2. Upload to Anthropic via Files API (same pattern as `bom-extract.ts`)
3. Send structured prompt asking Claude to classify and verify the document
4. Parse structured JSON response

**Model**: Uses `CLAUDE_MODELS.sonnet` from `src/lib/anthropic.ts` (currently `claude-sonnet-4-5-20250929`). Classification is a well-structured task; Sonnet is faster and cheaper than Opus. Every file gets vision classification (no cost-gating).

**Response shape for documents:**

```typescript
interface VisionClassification {
  matchedChecklistId: string | null;
  confidence: "high" | "medium" | "low";
  documentType: string;
  issues: string[];
  signatures: { present: boolean; count: number; allSigned: boolean };
  dateRelevance?: { date: string; isExpired: boolean; expiresIn?: number };
}
```

**Combined document detection**: When Claude identifies a single PDF containing multiple document types (e.g., CA + IO + Disclosures in one contract package), it returns multiple `matchedChecklistId` values.

### Photo Verification

For each of the 11 PE photos, the prompt includes the specific PE requirement text and instructs Claude to verify the image content satisfies it.

**Response shape for photos:**

```typescript
interface PhotoVerification {
  matchedChecklistId: string;
  requirement: string;
  verdict: "pass" | "fail" | "needs_review";
  issues: string[];
  equipmentVisible: string[];
  confidence: "high" | "medium" | "low";
}
```

**Failure examples Claude catches:**
- Photo 2 (PV array): partial view, not wide-angle
- Photo 3 (module nameplate): label blurry/illegible
- Photo 5 (MSP): panel cover still on
- Photo 10 (storage nameplate): battery visible but no labels in frame
- Photo 6 (Invoice/BOM): spreadsheet screenshot, not an actual invoice

**Parallelization**: Files within a folder are classified concurrently in batches of 5-8 to stay within rate limits. Total audit time target: 30-60 seconds for a full M1 (25 items).

### Mapping Vision Results to ChecklistResult

The existing `ChecklistResult` type in `pe-turnover.ts` has a `visionResult?: { status, notes }` field. This gets extended to carry the full vision output:

```typescript
interface EnrichedVisionResult {
  status: "pass" | "fail" | "needs_review";
  notes: string;
  confidence: "high" | "medium" | "low";
  issues: string[];
  signatures?: { present: boolean; count: number; allSigned: boolean };
  dateRelevance?: { date: string; isExpired: boolean; expiresIn?: number };
  equipmentVisible?: string[];
  pmOverride?: { overriddenAt: string; originalVerdict: string };
}
```

Mapping rules:
- `VisionClassification.matchedChecklistId === null` → file is discarded (not a PE document), logged but not included in results
- `VisionClassification.confidence === "low"` → `ChecklistResult.status = "needs_review"`
- `VisionClassification.issues.length > 0` with confidence high/medium → `ChecklistResult.status = "found"` but issues surface as warnings in the UI
- `PhotoVerification.verdict` maps directly to `visionResult.status`
- `pmOverride` is written by the UI when a PM toggles the override on a photo — persisted in the `PeAuditRun.results` JSON column

## Section 2: PandaDoc Integration

Extends `src/lib/pandadoc.ts` (existing client with auth, retry, document listing).

### Template Discovery

Search PandaDoc for the 4 PE template IDs by name pattern:

```typescript
const PE_TEMPLATE_PATTERNS = [
  { key: "attestation",      pattern: "PE Installer Attestation" },
  { key: "acceptance",        pattern: "PE Customer Certificate of Acceptance" },
  { key: "progress_waiver",   pattern: "Progress Lien Waiver" },
  { key: "final_waiver",      pattern: "PE Conditional Waiver and Release on Final Payment" },
];
```

Uses `GET /templates?q={pattern}`. Caches discovered template IDs in a `SystemConfig` row (key: `pandadoc_pe_template_ids`, value: JSON object). Cache is invalidated manually by an admin via the admin settings page, or by setting env vars `PANDADOC_PE_ATTESTATION_TEMPLATE_ID`, etc., which take precedence over the cached values. Falls back to env var configuration if the search returns ambiguous results (multiple matches).

### Document Lookup Per Deal

For a given HubSpot deal ID, find the most recent PandaDoc document for each of the 4 templates:

1. `GET /documents?template_id={id}&metadata_hubspot.deal_id={dealId}` (same pattern as existing `findDaForDeal()`)
2. Check status — only `document.completed` docs are downloadable
3. Return status map per template key

### PDF Download + GDrive Placement

New functions:
- `downloadPandaDocPdf(documentId: string): Promise<Buffer>` — `GET /documents/{id}/download`. Note: the existing `pandaFetch<T>()` helper parses responses as JSON. The download endpoint returns binary PDF data, so this function needs a separate `fetch()` call that reads the response as `ArrayBuffer` and converts to `Buffer`. Only works for `document.completed` status — other statuses return an error.
- Upload to GDrive via `uploadDriveBinaryFile()` (existing function in `drive-plansets.ts`) into the deal's `Participate Energy/` folder

**GDrive target folder**: The `Participate Energy/` folder sits at the root level of the deal's project folder (alongside `0. Sales/`, `5. Installation/`, etc.). It is NOT a numbered subfolder. It may already exist (created by HubSpot automation or prior manual work). If it doesn't exist, create it via `createDriveFolder(rootFolderId, "Participate Energy")`. Some deals have two PE folders at root level — use the most recently modified one (per observed gotcha in `reference_pe_document_sources.md`).

**Behavior during audit:**
- **Completed docs**: Download PDF, place in GDrive, mark checklist item as "found"
- **In-progress docs**: Mark as "pending" with status note (e.g., "Sent to customer 2 days ago")
- **Missing docs**: Mark as "missing" with action guidance ("Create PandaDoc from template")

## Section 3: Database Model

```prisma
model PeAuditRun {
  id            String   @id @default(cuid())
  dealId        String
  dealName      String
  milestone     String   // "m1" | "m2"
  systemType    String   // "solar" | "battery" | "solar+battery"
  status        String   // "running" | "completed" | "failed"
  triggeredBy   String   // user email

  results       Json?    // ChecklistResult[] with EnrichedVisionResult per item (see Section 1)
  summary       Json?    // TurnoverAuditResult['summary'] shape: { totalItems, found, missing, needsReview, notApplicable, errors, ready }

  packageFolderId   String?
  packageFolderUrl  String?

  startedAt     DateTime @default(now())
  completedAt   DateTime?
  durationMs    Int?

  visionCallCount  Int    @default(0)
  pandadocPulled   Int    @default(0)

  @@index([dealId, milestone])
  @@index([status])
}
```

**Usage patterns:**
- **Prep page load**: Most recent completed run for the deal. If <24h old, show cached results with "Last audited X hours ago" + Re-run button.
- **PE Submission Gap dashboard**: Join against `PeAuditRun` for "Last Audit" column — green/yellow/red/gray dot.
- **Audit history**: Collapsible history section on prep page showing progress over time.

## Section 4: API Routes

New route group at `/api/pe-prep/`.

### `POST /api/pe-prep/[dealId]/audit`

SSE stream. Runs the full audit.

**Concurrency**: Only one audit can run per deal at a time. Before starting, check for a `PeAuditRun` with `status = "running"` for the same `dealId`. If found and started <5 minutes ago, return 409. If stale (>5 minutes), mark it "failed" and proceed.

**Timeout**: 5-minute hard ceiling on the SSE stream. If the audit hasn't completed by then, mark the `PeAuditRun` as "failed" with a timeout note and close the stream.

**Client disconnect**: If the SSE connection drops mid-audit, the server-side audit continues to completion and persists the `PeAuditRun`. The PM can reload the prep page and see the cached result.

**Drive API errors**: Individual file download failures are caught per-item and marked as `status: "error"` with a note. The audit continues — partial results are still useful.

Event types:
```typescript
{ type: "started",    data: { milestone, systemType, totalItems } }
{ type: "progress",   data: { itemId, label, status, file?, issues?, photo? } }
{ type: "pandadoc",   data: { key, status, action } }
{ type: "completed",  data: { auditRunId, summary } }
{ type: "error",      data: { message } }
```

### `GET /api/pe-prep/[dealId]/status`

Returns most recent `PeAuditRun` for the deal. Used for initial page load.

### `POST /api/pe-prep/[dealId]/assemble`

Assembles package from a completed audit run. Takes `{ auditRunId }`. Copies found + warned files into a `PE Turnover - M1` staging folder in GDrive. Returns folder URL.

**Role access**: PM, OPS_MGR, ACCOUNTING, ADMIN, OWNER. Routes to add to `allowedRoutes` in `roles.ts`:

| Role | Routes to add |
|------|---------------|
| PROJECT_MANAGER | `/dashboards/pe-prep`, `/dashboards/pe-submission-gap`, `/api/pe-prep` |
| OPERATIONS_MANAGER | `/dashboards/pe-prep`, `/dashboards/pe-submission-gap`, `/api/pe-prep` |
| ACCOUNTING | `/dashboards/pe-prep`, `/api/pe-prep` (already has `/dashboards/pe-submission-gap`) |

ADMIN and OWNER have wildcard routes — no changes needed.

## Section 5: UI

### Standalone Prep Page (`/dashboards/pe-prep/[dealId]`)

Main workspace. Sections:

1. **Header**: Deal name, address, milestone, system type, last audit timestamp, Re-run button
2. **Summary bar**: StatCards showing Ready / Warned / Missing / Pending / N/A counts
3. **Document sections**: Grouped by category (Contract, Design, Photos, Admin, etc.). Each item shows:
   - Status badge (green ✓ / yellow ⚠ / red ✗ / blue ⏳ / gray —)
   - Filename + confidence level
   - AI verdict text (issues, notes)
4. **Photo grid**: Thumbnail grid with verification badges. Click for full-size modal with AI verdict + override toggle.
5. **PandaDoc section**: Status cards for the 4 template docs. Shows "Downloaded to GDrive" / "Sent, awaiting sig" / "Not yet created".
6. **Actions**: "Assemble Package" button (enabled when audit complete) + "View Audit History" collapsible.

**During audit**: Progress bar, items appear as classified. Photos show thumbnails as verified.

**Photo detail modal**: Full-size image, PE requirement text, Claude's verdict, issues list, "Override" toggle for PM to disagree with AI.

**Warned items**: Yellow background, issues visible. Included in package assembly but flagged in manifest.

### Integration Points

- **PE Submission Gap page**: New "Prep" column after the existing columns, on all tabs except "Complete". Shows an icon button linking to `/dashboards/pe-prep/[dealId]`. If the deal has a recent `PeAuditRun`, the button shows a colored dot: green (all found), yellow (has warnings), red (has missing items), gray (never audited).
- **Deal detail page**: "Prepare PE Package" button in the actions area, visible only for PE-tagged deals. Links to prep page.

### New Components

- `PePrepPage` — standalone page
- `PeAuditProgress` — SSE-driven progress display
- `PeChecklistCard` — individual document result card
- `PePhotoGrid` — thumbnail grid with verification badges
- `PePhotoModal` — full-size photo with AI verdict + override
- `PePandaDocSection` — PandaDoc status cards
- `PePrepButton` — reusable link button for Submission Gap + deal detail

## Section 6: Skill Definition

New skill at `.claude/skills/pe-file-prep/SKILL.md`.

**Trigger phrases**: "prepare PE files for PROJ-1234", "PE file prep for Smith", "get PE package ready for deal 12345"

**Conversation flow**: Resolve deal → run audit (invoke library directly or call API) → present results with AI verdicts → offer to assemble package → actionable guidance for missing/failed items.

**Skill landscape:**

| Skill | Purpose |
|-------|---------|
| `pe-file-prep` | This feature — vision classification, PandaDoc auto-pull, package assembly |
| `pe-turnover` | Lightweight alias — redirects to pe-file-prep |
| `pe-portal-scraping` | Separate — browser-based PE portal interaction |

## Cost Model

- ~$0.50-1.50 per full M1 audit (20-30 vision calls at Sonnet pricing)
- Justified by PE milestone payments ($10k+ per milestone)
- No tiering or on-demand gating — every file gets vision classification

## Feature Flags

- `PE_FILE_PREP_ENABLED` — API routes + UI. Default false until ready.
- `PANDADOC_PE_TEMPLATES_ENABLED` — PandaDoc template discovery + download. Independent from vision classifier.

## Dependencies

- Existing: `drive-plansets.ts` (GDrive), `pandadoc.ts` (PandaDoc client), `pe-turnover.ts` (checklists, folder mapping), Anthropic SDK
- New: PandaDoc download endpoint (`GET /documents/{id}/download`), `PeAuditRun` Prisma model
- Env vars: `PANDADOC_API_KEY` (already exists), `PE_FILE_PREP_ENABLED`, `PANDADOC_PE_TEMPLATES_ENABLED`
