# PE File Preparation System — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unreliable substring-based PE file matching with AI vision classification, add PandaDoc auto-pull, and build a PM-facing prep dashboard with SSE audit streaming and one-click package assembly.

**Architecture:** Hybrid Sync + DB Cache — audit runs synchronously via SSE stream (~30-60s), persists results to `PeAuditRun` database table. Prep page loads cached results instantly and offers "Re-run Audit" to refresh.

**Tech Stack:** Next.js 16.1, Prisma 7.3 (Neon Postgres), Anthropic Claude Sonnet (vision), PandaDoc API, Google Drive API, React Query v5, Server-Sent Events

**Spec:** `docs/superpowers/specs/2026-05-16-pe-file-prep-design.md`

---

## Chunk 1: Foundation — Database, Vision Classifier, PandaDoc Extensions

### Task 1: PeAuditRun Prisma Model

**Files:**
- Modify: `prisma/schema.prisma` (append new model after `BomPipelineRun` ~line 1740)
- Create: `prisma/migrations/<timestamp>_add_pe_audit_run/migration.sql` (generated)

- [ ] **Step 1: Add PeAuditRun model to schema**

Add after the `BomPipelineRun` model block:

```prisma
model PeAuditRun {
  id            String   @id @default(cuid())
  dealId        String
  dealName      String
  milestone     String   // "m1" | "m2"
  systemType    String   // "solar" | "battery" | "solar+battery"
  status        String   // "running" | "completed" | "failed"
  triggeredBy   String   // user email

  results       Json?    // ChecklistResult[] with EnrichedVisionResult
  summary       Json?    // { totalItems, found, missing, needsReview, notApplicable, errors, ready }

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

- [ ] **Step 2: Generate migration**

Run: `npx prisma migrate dev --name add_pe_audit_run`
Expected: Migration created successfully, client regenerated.

- [ ] **Step 3: Verify generated client has PeAuditRun**

Run: `grep -r "PeAuditRun" src/generated/prisma/ | head -3`
Expected: Type definitions for PeAuditRun in generated client.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/generated/prisma/
git commit -m "feat(pe-prep): add PeAuditRun Prisma model for audit persistence"
```

---

### Task 2: Vision Classifier Engine

**Files:**
- Create: `src/lib/pe-vision-classifier.ts`
- Create: `src/__tests__/pe-vision-classifier.test.ts`

- [ ] **Step 1: Write types and prompt constants**

Create `src/lib/pe-vision-classifier.ts` with the core types and prompt templates. This file classifies documents and photos against PE checklist requirements using Claude vision.

```typescript
import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import type { ChecklistItem } from "@/lib/pe-turnover";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisionClassification {
  matchedChecklistIds: string[];
  confidence: "high" | "medium" | "low";
  documentType: string;
  issues: string[];
  signatures: { present: boolean; count: number; allSigned: boolean };
  dateRelevance?: { date: string; isExpired: boolean; expiresIn?: number };
}

export interface PhotoVerification {
  matchedChecklistId: string;
  requirement: string;
  verdict: "pass" | "fail" | "needs_review";
  issues: string[];
  equipmentVisible: string[];
  confidence: "high" | "medium" | "low";
}

export interface EnrichedVisionResult {
  status: "pass" | "fail" | "needs_review";
  notes: string;
  confidence: "high" | "medium" | "low";
  issues: string[];
  signatures?: { present: boolean; count: number; allSigned: boolean };
  dateRelevance?: { date: string; isExpired: boolean; expiresIn?: number };
  equipmentVisible?: string[];
  pmOverride?: { overriddenAt: string; originalVerdict: string };
}

export type VisionFileInput = {
  fileId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

export type VisionResult =
  | { kind: "document"; classification: VisionClassification }
  | { kind: "photo"; verification: PhotoVerification }
  | { kind: "error"; error: string };
```

- [ ] **Step 2: Write the document classification prompt builder**

Append to `pe-vision-classifier.ts`:

```typescript
// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildDocumentPrompt(checklistItems: ChecklistItem[]): string {
  const itemList = checklistItems
    .filter((i) => !i.isPhoto)
    .map((i) => `- ${i.id}: ${i.label} (category: ${i.category})`)
    .join("\n");

  return `You are a document classification system for Participate Energy (PE) milestone submissions.

Analyze this document and classify it against the PE checklist. Return a JSON object.

## PE Checklist Items (documents only)
${itemList}

## Instructions
1. Identify what type of document this is (contract, proposal, utility bill, permit, lien waiver, etc.)
2. Match it to one or more checklist IDs from the list above. A single PDF may contain multiple documents (e.g., a contract package with Customer Agreement + Installation Order + Disclosures).
3. Check for signatures — are they present? How many? Are all required signature fields signed?
4. Check for date relevance — utility bills should be within 12 months, permits should not be expired.
5. Flag any issues (unsigned, expired, wrong document type, poor quality, etc.)

## Response Format (JSON only, no markdown)
{
  "matchedChecklistIds": ["m1.contract.customer_agreement"] or [] if no match,
  "confidence": "high" | "medium" | "low",
  "documentType": "Customer Agreement",
  "issues": ["Missing signature on page 2"],
  "signatures": { "present": true, "count": 2, "allSigned": false },
  "dateRelevance": { "date": "2025-11-15", "isExpired": false, "expiresIn": 180 } or null
}`;
}

function buildPhotoPrompt(item: ChecklistItem): string {
  const photoDescriptions: Record<number, string> = {
    1: "Site address visible on the home or mailbox, showing the full front of the house",
    2: "Wide-angle photo of the installed PV (solar panel) array on the roof, showing the full array from a distance",
    3: "Close-up of a solar module nameplate label, text must be legible (brand, model, serial number, specs)",
    4: "Wide-angle photo showing ALL electrical equipment (inverter, disconnect, meter, conduit runs)",
    5: "Main service panel (MSP/breaker panel) with the cover REMOVED, showing breakers and wiring",
    6: "Invoice or Bill of Materials document — must be an actual invoice, not a spreadsheet screenshot",
    7: "Inverter, microinverter, or optimizer nameplate/model label — must be legible",
    8: "Racking components with visible part markings (rails, clamps, flashings with brand/model visible)",
    9: "Wide-angle photo of the energy storage (battery) system installation",
    10: "Battery/storage nameplate label — must show brand, model, serial number, capacity specs",
    11: "Storage controller, gateway, or disconnect switch — equipment must be identifiable",
  };

  const requirement = photoDescriptions[item.pePhotoNumber ?? 0] ?? item.label;

  return `You are a photo verification system for Participate Energy (PE) milestone submissions.

## PE Photo Requirement
Photo ${item.pePhotoNumber}: ${item.label}
Requirement: ${requirement}

## Instructions
1. Does this image satisfy the PE photo requirement above?
2. Is the image clear and well-lit enough for PE review?
3. List any visible equipment (brand names, model numbers, labels).
4. Flag issues: blurry/illegible labels, partial view instead of wide-angle, wrong subject, cover still on panel, etc.

## Response Format (JSON only, no markdown)
{
  "matchedChecklistId": "${item.id}",
  "requirement": "${requirement}",
  "verdict": "pass" | "fail" | "needs_review",
  "issues": [],
  "equipmentVisible": ["Enphase IQ8+", "IronRidge XR100"],
  "confidence": "high" | "medium" | "low"
}`;
}
```

- [ ] **Step 3: Write the core classification functions**

Append to `pe-vision-classifier.ts`:

```typescript
// ---------------------------------------------------------------------------
// Classification functions
// ---------------------------------------------------------------------------

async function uploadToAnthropic(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  const client = getAnthropicClient();
  const file = await client.beta.files.upload({
    file: new File([new Uint8Array(buffer)], fileName, { type: mimeType }),
  });
  return file.id;
}

export async function classifyDocument(
  input: VisionFileInput,
  checklistItems: ChecklistItem[],
): Promise<VisionResult> {
  try {
    const client = getAnthropicClient();
    const fileId = await uploadToAnthropic(input.buffer, input.fileName, input.mimeType);
    const prompt = buildDocumentPrompt(checklistItems);

    const contentType = input.mimeType.startsWith("image/") ? "image" as const : "document" as const;

    const message = await client.beta.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          { type: contentType, source: { type: "file", file_id: fileId } },
          { type: "text", text: prompt },
        ],
      }],
      betas: ["files-api-2025-04-14"],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as VisionClassification;

    return { kind: "document", classification: parsed };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function verifyPhoto(
  input: VisionFileInput,
  checklistItem: ChecklistItem,
): Promise<VisionResult> {
  try {
    const client = getAnthropicClient();
    const fileId = await uploadToAnthropic(input.buffer, input.fileName, input.mimeType);
    const prompt = buildPhotoPrompt(checklistItem);

    const message = await client.beta.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "file", file_id: fileId } },
          { type: "text", text: prompt },
        ],
      }],
      betas: ["files-api-2025-04-14"],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as PhotoVerification;

    return { kind: "photo", verification: parsed };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Write the batch classifier with concurrency control**

Append to `pe-vision-classifier.ts`:

```typescript
// ---------------------------------------------------------------------------
// Batch classification with concurrency control
// ---------------------------------------------------------------------------

export interface ClassifyBatchOptions {
  concurrency?: number;
  onProgress?: (result: { fileName: string; result: VisionResult }) => void;
}

export async function classifyBatch(
  files: VisionFileInput[],
  checklistItems: ChecklistItem[],
  opts?: ClassifyBatchOptions,
): Promise<Map<string, VisionResult>> {
  const concurrency = opts?.concurrency ?? 5;
  const results = new Map<string, VisionResult>();
  const queue = [...files];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;

      const isPhoto = file.mimeType.startsWith("image/");
      let result: VisionResult;

      if (isPhoto) {
        // For photos, we need to know which checklist item to verify against.
        // This is handled by the orchestrator which calls verifyPhoto directly.
        // Batch is used for documents only.
        result = await classifyDocument(file, checklistItems);
      } else {
        result = await classifyDocument(file, checklistItems);
      }

      results.set(file.fileId, result);
      opts?.onProgress?.({ fileName: file.fileName, result });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

export function visionResultToEnriched(result: VisionResult): EnrichedVisionResult | null {
  if (result.kind === "error") {
    return {
      status: "needs_review",
      notes: `Vision error: ${result.error}`,
      confidence: "low",
      issues: [result.error],
    };
  }

  if (result.kind === "document") {
    const c = result.classification;
    const hasIssues = c.issues.length > 0;
    const status: EnrichedVisionResult["status"] =
      c.confidence === "low" ? "needs_review" :
      hasIssues ? "needs_review" :
      "pass";

    return {
      status,
      notes: hasIssues ? c.issues.join("; ") : `Classified as ${c.documentType}`,
      confidence: c.confidence,
      issues: c.issues,
      signatures: c.signatures,
      dateRelevance: c.dateRelevance,
    };
  }

  if (result.kind === "photo") {
    const v = result.verification;
    return {
      status: v.verdict,
      notes: v.issues.length > 0 ? v.issues.join("; ") : "Photo verified",
      confidence: v.confidence,
      issues: v.issues,
      equipmentVisible: v.equipmentVisible,
    };
  }

  return null;
}
```

- [ ] **Step 5: Write tests for mapping helpers**

Create `src/__tests__/pe-vision-classifier.test.ts`:

```typescript
import { visionResultToEnriched, type VisionResult } from "@/lib/pe-vision-classifier";

describe("visionResultToEnriched", () => {
  it("maps error result to needs_review", () => {
    const result: VisionResult = { kind: "error", error: "API timeout" };
    const enriched = visionResultToEnriched(result);
    expect(enriched).not.toBeNull();
    expect(enriched!.status).toBe("needs_review");
    expect(enriched!.confidence).toBe("low");
    expect(enriched!.issues).toEqual(["API timeout"]);
  });

  it("maps high-confidence document with no issues to pass", () => {
    const result: VisionResult = {
      kind: "document",
      classification: {
        matchedChecklistIds: ["m1.contract.customer_agreement"],
        confidence: "high",
        documentType: "Customer Agreement",
        issues: [],
        signatures: { present: true, count: 2, allSigned: true },
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("pass");
    expect(enriched!.signatures?.allSigned).toBe(true);
  });

  it("maps low-confidence document to needs_review", () => {
    const result: VisionResult = {
      kind: "document",
      classification: {
        matchedChecklistIds: ["m1.contract.utility_bill"],
        confidence: "low",
        documentType: "Utility Bill",
        issues: [],
        signatures: { present: false, count: 0, allSigned: false },
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("needs_review");
  });

  it("maps document with issues to needs_review", () => {
    const result: VisionResult = {
      kind: "document",
      classification: {
        matchedChecklistIds: ["m1.contract.customer_agreement"],
        confidence: "high",
        documentType: "Customer Agreement",
        issues: ["Missing signature on page 3"],
        signatures: { present: true, count: 1, allSigned: false },
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("needs_review");
    expect(enriched!.issues).toEqual(["Missing signature on page 3"]);
  });

  it("maps photo pass verdict", () => {
    const result: VisionResult = {
      kind: "photo",
      verification: {
        matchedChecklistId: "m1.photos.2_pv_array",
        requirement: "Wide-angle PV array",
        verdict: "pass",
        issues: [],
        equipmentVisible: ["REC Alpha 400W", "IronRidge XR100"],
        confidence: "high",
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("pass");
    expect(enriched!.equipmentVisible).toEqual(["REC Alpha 400W", "IronRidge XR100"]);
  });

  it("maps photo fail verdict", () => {
    const result: VisionResult = {
      kind: "photo",
      verification: {
        matchedChecklistId: "m1.photos.5_msp",
        requirement: "Main service panel (cover off)",
        verdict: "fail",
        issues: ["Panel cover is still on"],
        equipmentVisible: [],
        confidence: "high",
      },
    };
    const enriched = visionResultToEnriched(result);
    expect(enriched!.status).toBe("fail");
    expect(enriched!.issues).toEqual(["Panel cover is still on"]);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npm run test -- --testPathPattern pe-vision-classifier`
Expected: All 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pe-vision-classifier.ts src/__tests__/pe-vision-classifier.test.ts
git commit -m "feat(pe-prep): add vision classifier engine with document/photo classification"
```

---

### Task 3: PandaDoc PE Extensions

**Files:**
- Modify: `src/lib/pandadoc.ts` (add PE template discovery + PDF download)
- Create: `src/__tests__/pandadoc-pe.test.ts`

- [ ] **Step 1: Add PE template constants and types**

Add after the existing `DA_TEMPLATE_ID` constant (~line 18) in `src/lib/pandadoc.ts`:

```typescript
// PE template patterns for document discovery
export const PE_TEMPLATE_PATTERNS = [
  { key: "attestation", pattern: "PE Installer Attestation" },
  { key: "acceptance", pattern: "PE Customer Certificate of Acceptance" },
  { key: "progress_waiver", pattern: "Progress Lien Waiver" },
  { key: "final_waiver", pattern: "PE Conditional Waiver and Release on Final Payment" },
] as const;

export type PeTemplateKey = (typeof PE_TEMPLATE_PATTERNS)[number]["key"];

export interface PeTemplateStatus {
  key: PeTemplateKey;
  templateId: string | null;
  document: {
    id: string;
    name: string;
    status: string;
    dateCompleted: string | null;
  } | null;
}
```

- [ ] **Step 2: Add PE template discovery function**

Append to `src/lib/pandadoc.ts`:

```typescript
/**
 * Search PandaDoc for PE template IDs by name pattern.
 * Falls back to env vars if search returns ambiguous results.
 */
export async function discoverPeTemplateIds(): Promise<Record<PeTemplateKey, string | null>> {
  const result: Record<string, string | null> = {};

  const envOverrides: Record<PeTemplateKey, string | undefined> = {
    attestation: process.env.PANDADOC_PE_ATTESTATION_TEMPLATE_ID,
    acceptance: process.env.PANDADOC_PE_ACCEPTANCE_TEMPLATE_ID,
    progress_waiver: process.env.PANDADOC_PE_PROGRESS_WAIVER_TEMPLATE_ID,
    final_waiver: process.env.PANDADOC_PE_FINAL_WAIVER_TEMPLATE_ID,
  };

  for (const { key, pattern } of PE_TEMPLATE_PATTERNS) {
    if (envOverrides[key]) {
      result[key] = envOverrides[key]!;
      continue;
    }

    try {
      const data = await pandaFetch<{ results: Array<{ id: string; name: string }> }>("/templates", {
        searchParams: { q: pattern, count: 5 },
      });

      if (data.results?.length === 1) {
        result[key] = data.results[0].id;
      } else if (data.results?.length > 1) {
        // Ambiguous — prefer exact name match
        const exact = data.results.find((t) =>
          t.name.toLowerCase() === pattern.toLowerCase()
        );
        result[key] = exact?.id ?? null;
      } else {
        result[key] = null;
      }
    } catch {
      result[key] = null;
    }
  }

  return result as Record<PeTemplateKey, string | null>;
}
```

- [ ] **Step 3: Add per-deal PE document lookup**

Append to `src/lib/pandadoc.ts`:

```typescript
/**
 * Find the most recent PandaDoc document for each PE template, linked to a deal.
 */
export async function findPeDocsForDeal(
  dealId: string,
  templateIds: Record<PeTemplateKey, string | null>,
): Promise<PeTemplateStatus[]> {
  const results: PeTemplateStatus[] = [];

  for (const { key } of PE_TEMPLATE_PATTERNS) {
    const templateId = templateIds[key];
    if (!templateId) {
      results.push({ key, templateId: null, document: null });
      continue;
    }

    try {
      const data = await pandaFetch<{ results: PandaDocListItem[] }>("/documents", {
        searchParams: {
          template_id: templateId,
          "metadata_hubspot.deal_id": dealId,
          count: 1,
          order_by: "-date_modified",
        },
      });

      const doc = data.results?.[0];
      results.push({
        key,
        templateId,
        document: doc ? {
          id: doc.id,
          name: doc.name,
          status: doc.status.replace("document.", ""),
          dateCompleted: doc.date_completed,
        } : null,
      });
    } catch {
      results.push({ key, templateId, document: null });
    }
  }

  return results;
}
```

- [ ] **Step 4: Add PDF download function**

Append to `src/lib/pandadoc.ts`. This uses a raw `fetch` because `pandaFetch` parses JSON but the download endpoint returns binary PDF data.

```typescript
/**
 * Download a completed PandaDoc document as a PDF buffer.
 * Only works for documents with status "document.completed".
 */
export async function downloadPandaDocPdf(documentId: string): Promise<Buffer> {
  const url = `${PANDADOC_BASE}/documents/${documentId}/download`;

  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `API-Key ${getApiKey()}` },
    });

    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, Math.pow(2, attempt) * 1000 + Math.random() * 400);
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    const text = await res.text().catch(() => "");
    throw new Error(`PandaDoc download ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new Error("PandaDoc download retry exhausted");
}
```

- [ ] **Step 5: Write tests for PE template patterns**

Create `src/__tests__/pandadoc-pe.test.ts`:

```typescript
import { PE_TEMPLATE_PATTERNS } from "@/lib/pandadoc";

describe("PE template patterns", () => {
  it("has 4 templates", () => {
    expect(PE_TEMPLATE_PATTERNS).toHaveLength(4);
  });

  it("has unique keys", () => {
    const keys = PE_TEMPLATE_PATTERNS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("each pattern is non-empty", () => {
    for (const t of PE_TEMPLATE_PATTERNS) {
      expect(t.pattern.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npm run test -- --testPathPattern pandadoc-pe`
Expected: All 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pandadoc.ts src/__tests__/pandadoc-pe.test.ts
git commit -m "feat(pe-prep): add PandaDoc PE template discovery, deal lookup, and PDF download"
```

---

### Task 4: Audit Orchestrator

**Files:**
- Create: `src/lib/pe-audit-orchestrator.ts`
- Create: `src/__tests__/pe-audit-orchestrator.test.ts`

This is the core engine that wires together vision classification, PandaDoc, and the existing pe-turnover checklist logic. It replaces the `matchFileToItem()` call path with vision classification while reusing `resolvePEDeal()`, `buildFolderMap()`, `filterChecklist()`, `resolveCombinedFiles()`, `buildAuditResult()`, and `assemblePackage()` from pe-turnover.ts.

- [ ] **Step 1: Write the orchestrator skeleton with types**

Create `src/lib/pe-audit-orchestrator.ts`:

```typescript
import { prisma } from "@/lib/db";
import {
  type ChecklistItem,
  type ChecklistResult,
  type SystemType,
  type Milestone,
  type TurnoverAuditResult,
  PE_M1_CHECKLIST,
  PE_M2_CHECKLIST,
  filterChecklist,
  resolvePEDeal,
  buildFolderMap,
  buildAuditResult,
  resolveCombinedFiles,
  assemblePackage,
  type ResolvedPEDeal,
} from "@/lib/pe-turnover";
import {
  classifyDocument,
  verifyPhoto,
  visionResultToEnriched,
  type VisionFileInput,
  type EnrichedVisionResult,
} from "@/lib/pe-vision-classifier";
import {
  discoverPeTemplateIds,
  findPeDocsForDeal,
  downloadPandaDocPdf,
  type PeTemplateKey,
  type PeTemplateStatus,
} from "@/lib/pandadoc";
import {
  downloadDrivePdf,
  downloadDriveFile,
  downloadDriveImage,
  listDriveFiles,
  listDriveSubfolders,
  listDriveImagesRecursive,
  uploadDriveBinaryFile,
  createDriveFolder,
  type DriveGenericFile,
  type DriveFolder,
} from "@/lib/drive-plansets";

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

export type AuditEvent =
  | { type: "started"; data: { milestone: string; systemType: string; totalItems: number } }
  | { type: "progress"; data: { itemId: string; label: string; status: string; file?: string; issues?: string[] } }
  | { type: "pandadoc"; data: { key: string; status: string; action: string } }
  | { type: "completed"; data: { auditRunId: string; summary: TurnoverAuditResult["summary"] } }
  | { type: "error"; data: { message: string } };

export interface AuditRunOptions {
  dealId: string;
  milestone?: Milestone;
  triggeredBy: string;
  onEvent?: (event: AuditEvent) => void;
}
```

- [ ] **Step 2: Write the PE folder resolver**

Append to `pe-audit-orchestrator.ts`:

```typescript
// ---------------------------------------------------------------------------
// PE folder resolution — find or create "Participate Energy/" folder
// ---------------------------------------------------------------------------

async function findOrCreatePeFolder(rootFolderId: string): Promise<string> {
  const subfolders = await listDriveSubfolders(rootFolderId);
  const peFolders = subfolders.filter((f) =>
    f.name.toLowerCase().includes("participate energy")
  );

  if (peFolders.length === 1) return peFolders[0].id;

  if (peFolders.length > 1) {
    // DriveFolder has only id+name — no modifiedTime. Use the last in the list
    // (Drive returns results in an undefined but stable order; multiple PE folders
    // are rare and the "most recently modified" spec guidance is best-effort).
    return peFolders[peFolders.length - 1].id;
  }

  // Create it
  const folder = await createDriveFolder(rootFolderId, "Participate Energy");
  return folder.id;
}
```

- [ ] **Step 3: Write the PandaDoc pull phase**

Append to `pe-audit-orchestrator.ts`:

```typescript
// ---------------------------------------------------------------------------
// PandaDoc pull — download completed docs into GDrive PE folder
// ---------------------------------------------------------------------------

const PANDADOC_KEY_TO_CHECKLIST: Record<PeTemplateKey, string> = {
  attestation: "m1.post_install.attestation",
  acceptance: "m1.post_install.acceptance",
  progress_waiver: "m1.lien.conditional",
  final_waiver: "m2.lien.final",
};

const PANDADOC_FILENAMES: Record<PeTemplateKey, string> = {
  attestation: "PE_Installer_Attestation.pdf",
  acceptance: "PE_Customer_Acceptance.pdf",
  progress_waiver: "PE_Progress_Lien_Waiver.pdf",
  final_waiver: "PE_Final_Lien_Waiver.pdf",
};

interface PandaDocPullResult {
  statuses: PeTemplateStatus[];
  checklistOverrides: Map<string, ChecklistResult>;
  pulled: number;
}

async function pullPandaDocs(
  dealId: string,
  peFolderId: string,
  onEvent?: (event: AuditEvent) => void,
): Promise<PandaDocPullResult> {
  const checklistOverrides = new Map<string, ChecklistResult>();
  let pulled = 0;

  let templateIds: Record<PeTemplateKey, string | null>;
  try {
    templateIds = await discoverPeTemplateIds();
  } catch {
    onEvent?.({ type: "pandadoc", data: { key: "all", status: "error", action: "Template discovery failed" } });
    return { statuses: [], checklistOverrides, pulled };
  }

  const statuses = await findPeDocsForDeal(dealId, templateIds);

  for (const status of statuses) {
    const checklistId = PANDADOC_KEY_TO_CHECKLIST[status.key];
    if (!checklistId) continue;

    if (!status.document) {
      onEvent?.({ type: "pandadoc", data: { key: status.key, status: "missing", action: "Create PandaDoc from template" } });
      continue;
    }

    if (status.document.status === "completed") {
      try {
        const pdfBuffer = await downloadPandaDocPdf(status.document.id);
        const fileName = PANDADOC_FILENAMES[status.key];
        await uploadDriveBinaryFile(peFolderId, fileName, pdfBuffer, "application/pdf");
        pulled++;

        onEvent?.({ type: "pandadoc", data: { key: status.key, status: "downloaded", action: "Downloaded to GDrive" } });

        // Pre-populate checklist result — skip vision for this item
        checklistOverrides.set(checklistId, {
          item: {} as ChecklistItem, // Will be filled by orchestrator
          status: "found",
          statusNote: `PandaDoc (downloaded ${new Date().toISOString().slice(0, 10)})`,
          foundFile: {
            name: fileName,
            id: "", // GDrive ID not easily available after upload; not critical
            url: `https://app.pandadoc.com/a/#/documents/${status.document.id}`,
            modifiedTime: new Date().toISOString(),
            size: pdfBuffer.length,
          },
        });
      } catch (err) {
        onEvent?.({ type: "pandadoc", data: { key: status.key, status: "error", action: `Download failed: ${err instanceof Error ? err.message : String(err)}` } });
      }
    } else {
      const friendlyStatus = status.document.status === "sent" ? "Sent, awaiting signature" : `Status: ${status.document.status}`;
      onEvent?.({ type: "pandadoc", data: { key: status.key, status: "pending", action: friendlyStatus } });
    }
  }

  return { statuses, checklistOverrides, pulled };
}
```

- [ ] **Step 4: Write the vision audit phase**

Append to `pe-audit-orchestrator.ts`:

```typescript
// ---------------------------------------------------------------------------
// Vision audit — classify files and photos
// ---------------------------------------------------------------------------

async function collectCandidateFiles(
  folderMap: Map<string, string>,
  allFolderIds: string[],
  item: ChecklistItem,
  installPhotos: DriveGenericFile[],
): Promise<DriveGenericFile[]> {
  if (item.isPhoto) {
    const files = [...installPhotos];
    if (item.pePhotoNumber === 6) {
      for (const prefix of item.driveFolders) {
        const fid = folderMap.get(prefix);
        if (fid) {
          try { files.push(...await listDriveFiles(fid)); } catch {}
        }
      }
    }
    return files;
  }

  if (item.searchAllFolders) {
    const allFiles: DriveGenericFile[] = [];
    for (const fid of allFolderIds) {
      try { allFiles.push(...await listDriveFiles(fid)); } catch {}
    }
    return allFiles;
  }

  const files: DriveGenericFile[] = [];
  for (const prefix of item.driveFolders) {
    const fid = folderMap.get(prefix);
    if (fid) {
      try { files.push(...await listDriveFiles(fid)); } catch {}
    }
  }
  return files;
}

async function downloadFileForVision(file: DriveGenericFile): Promise<VisionFileInput | null> {
  try {
    if (file.mimeType.startsWith("image/")) {
      const result = await downloadDriveImage(file.id);
      return {
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
        buffer: result.buffer,
      };
    }
    const result = await downloadDriveFile(file.id);
    return {
      fileId: file.id,
      fileName: result.filename,
      mimeType: result.mimeType,
      buffer: result.buffer,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Write the main runAudit function**

Append to `pe-audit-orchestrator.ts`:

```typescript
// ---------------------------------------------------------------------------
// Main audit orchestrator
// ---------------------------------------------------------------------------

export async function runPeAudit(opts: AuditRunOptions): Promise<string> {
  const { dealId, triggeredBy, onEvent } = opts;
  const startTime = Date.now();

  // Check concurrency — only one audit per deal at a time
  const existing = await prisma.peAuditRun.findFirst({
    where: { dealId, status: "running" },
    orderBy: { startedAt: "desc" },
  });

  if (existing) {
    const age = Date.now() - existing.startedAt.getTime();
    if (age < 5 * 60 * 1000) {
      throw new Error(`Audit already running for deal ${dealId} (started ${Math.round(age / 1000)}s ago)`);
    }
    // Stale — mark failed and proceed
    await prisma.peAuditRun.update({
      where: { id: existing.id },
      data: { status: "failed", completedAt: new Date() },
    });
  }

  // Resolve deal
  const deal = await resolvePEDeal(dealId);
  const milestone = opts.milestone ?? "m1";

  // Create audit run record
  const auditRun = await prisma.peAuditRun.create({
    data: {
      dealId,
      dealName: deal.dealName,
      milestone,
      systemType: deal.systemType,
      status: "running",
      triggeredBy,
    },
  });

  try {
    const checklist = filterChecklist(
      milestone === "m1" ? PE_M1_CHECKLIST : PE_M2_CHECKLIST,
      deal.systemType,
    );

    onEvent?.({
      type: "started",
      data: { milestone, systemType: deal.systemType, totalItems: checklist.length },
    });

    // Build folder map
    let folderByPrefix = new Map<string, string>();
    let allFolderIds: string[] = [];
    if (deal.rootFolderId) {
      const fm = await buildFolderMap(deal.rootFolderId);
      folderByPrefix = fm.byPrefix;
      allFolderIds = fm.allFolderIds;
    }

    // PandaDoc pull
    let pandadocOverrides = new Map<string, ChecklistResult>();
    let pandadocPulled = 0;
    if (deal.rootFolderId && process.env.PANDADOC_PE_TEMPLATES_ENABLED === "true") {
      const peFolderId = await findOrCreatePeFolder(deal.rootFolderId);
      const pandaResult = await pullPandaDocs(dealId, peFolderId, onEvent);
      pandadocOverrides = pandaResult.checklistOverrides;
      pandadocPulled = pandaResult.pulled;
    }

    // Pre-fetch photos from Installation folder
    let installPhotos: DriveGenericFile[] = [];
    const installFolderId = folderByPrefix.get("5");
    if (installFolderId) {
      try {
        const images = await listDriveImagesRecursive(installFolderId, 3, 50);
        installPhotos = images.map((img) => ({
          id: img.id,
          name: img.name,
          mimeType: img.mimeType,
          modifiedTime: img.modifiedTime,
          size: img.size,
        }));
      } catch {}
    }

    // Vision classify each checklist item
    const results: ChecklistResult[] = [];
    let visionCallCount = 0;

    // Process items in batches for concurrency
    const BATCH_SIZE = 5;
    for (let i = 0; i < checklist.length; i += BATCH_SIZE) {
      const batch = checklist.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (item): Promise<ChecklistResult> => {
        // Check PandaDoc override first
        const override = pandadocOverrides.get(item.id);
        if (override) {
          override.item = item;
          onEvent?.({
            type: "progress",
            data: { itemId: item.id, label: item.label, status: "found", file: override.foundFile?.name },
          });
          return override;
        }

        // Collect candidate files
        const candidates = await collectCandidateFiles(folderByPrefix, allFolderIds, item, installPhotos);
        if (candidates.length === 0) {
          onEvent?.({
            type: "progress",
            data: { itemId: item.id, label: item.label, status: "missing" },
          });
          return { item, status: "missing" as const };
        }

        // For photos: pick a likely candidate and verify it
        if (item.isPhoto) {
          // Try first few image candidates
          const imageCandidates = candidates
            .filter((f) => f.mimeType.startsWith("image/"))
            .slice(0, 3);

          for (const candidate of imageCandidates) {
            const input = await downloadFileForVision(candidate);
            if (!input) continue;

            visionCallCount++;
            const vResult = await verifyPhoto(input, item);
            const enriched = visionResultToEnriched(vResult);

            if (enriched && enriched.status === "pass") {
              onEvent?.({
                type: "progress",
                data: { itemId: item.id, label: item.label, status: "found", file: candidate.name },
              });
              return {
                item,
                status: "found",
                foundFile: {
                  name: candidate.name,
                  id: candidate.id,
                  url: `https://drive.google.com/file/d/${candidate.id}/view`,
                  modifiedTime: candidate.modifiedTime,
                  size: parseInt(candidate.size ?? "0", 10),
                },
                visionResult: enriched,
              };
            }
          }

          // No photo passed — report best guess
          onEvent?.({
            type: "progress",
            data: { itemId: item.id, label: item.label, status: "missing" },
          });
          return { item, status: "missing" };
        }

        // For documents: classify each candidate until we find a match
        for (const candidate of candidates.slice(0, 8)) {
          const input = await downloadFileForVision(candidate);
          if (!input) continue;

          visionCallCount++;
          const vResult = await classifyDocument(input, checklist);
          if (vResult.kind !== "document") continue;

          const matched = vResult.classification.matchedChecklistIds.includes(item.id);
          if (!matched) continue;

          const enriched = visionResultToEnriched(vResult);
          const status = enriched?.status === "fail" ? "needs_review" as const : "found" as const;

          onEvent?.({
            type: "progress",
            data: {
              itemId: item.id,
              label: item.label,
              status,
              file: candidate.name,
              issues: enriched?.issues,
            },
          });

          return {
            item,
            status,
            foundFile: {
              name: candidate.name,
              id: candidate.id,
              url: `https://drive.google.com/file/d/${candidate.id}/view`,
              modifiedTime: candidate.modifiedTime,
              size: parseInt(candidate.size ?? "0", 10),
            },
            visionResult: enriched ?? undefined,
          };
        }

        onEvent?.({
          type: "progress",
          data: { itemId: item.id, label: item.label, status: "missing" },
        });
        return { item, status: "missing" };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    // Post-pass: resolve combined files
    const resolved = resolveCombinedFiles(results);

    // Build final audit result
    const peStatus = milestone === "m1" ? deal.peM1Status : deal.peM2Status;
    const auditResult = buildAuditResult({
      dealId,
      dealName: deal.dealName,
      address: deal.address,
      systemType: deal.systemType,
      milestone,
      peStatus,
      results: resolved,
    });

    const durationMs = Date.now() - startTime;

    // Persist
    await prisma.peAuditRun.update({
      where: { id: auditRun.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        durationMs,
        visionCallCount,
        pandadocPulled,
        results: JSON.parse(JSON.stringify(auditResult.categories)),
        summary: JSON.parse(JSON.stringify(auditResult.summary)),
      },
    });

    onEvent?.({
      type: "completed",
      data: { auditRunId: auditRun.id, summary: auditResult.summary },
    });

    return auditRun.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await prisma.peAuditRun.update({
      where: { id: auditRun.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        summary: { error: message },
      },
    });

    onEvent?.({ type: "error", data: { message } });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Re-export assemblePackage for API route use
// ---------------------------------------------------------------------------

export { assemblePackage } from "@/lib/pe-turnover";
```

- [ ] **Step 6: Write orchestrator unit tests**

Create `src/__tests__/pe-audit-orchestrator.test.ts`:

```typescript
describe("pe-audit-orchestrator types", () => {
  it("imports without error", async () => {
    // Verify the module compiles and exports expected types
    const mod = await import("@/lib/pe-audit-orchestrator");
    expect(typeof mod.runPeAudit).toBe("function");
  });
});
```

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pe-audit-orchestrator.ts src/__tests__/pe-audit-orchestrator.test.ts
git commit -m "feat(pe-prep): add audit orchestrator wiring vision, PandaDoc, and Drive"
```

---

## Chunk 2: API Routes, Role Access, Query Keys

### Task 5: API Routes

**Files:**
- Create: `src/app/api/pe-prep/[dealId]/audit/route.ts`
- Create: `src/app/api/pe-prep/[dealId]/status/route.ts`
- Create: `src/app/api/pe-prep/[dealId]/assemble/route.ts`

- [ ] **Step 1: Create the SSE audit route**

Create `src/app/api/pe-prep/[dealId]/audit/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { runPeAudit, type AuditEvent } from "@/lib/pe-audit-orchestrator";
import type { Milestone } from "@/lib/pe-turnover";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minute max

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  if (process.env.PE_FILE_PREP_ENABLED !== "true") {
    return new Response("PE File Prep is not enabled", { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const body = await req.json().catch(() => ({}));
  const milestone = (body.milestone as Milestone) || "m1";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AuditEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Stream may be closed
        }
      };

      const timeout = setTimeout(() => {
        send({ type: "error", data: { message: "Audit timed out after 5 minutes" } });
        controller.close();
      }, 5 * 60 * 1000);

      try {
        await runPeAudit({
          dealId,
          milestone,
          triggeredBy: authResult.email,
          onEvent: send,
        });
      } catch (err) {
        send({
          type: "error",
          data: { message: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        clearTimeout(timeout);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Create the status route**

Create `src/app/api/pe-prep/[dealId]/status/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  if (process.env.PE_FILE_PREP_ENABLED !== "true") {
    return NextResponse.json({ error: "Not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;

  const latestRun = await prisma.peAuditRun.findFirst({
    where: { dealId, status: { in: ["completed", "running"] } },
    orderBy: { startedAt: "desc" },
  });

  if (!latestRun) {
    return NextResponse.json({ auditRun: null });
  }

  return NextResponse.json({ auditRun: latestRun });
}
```

- [ ] **Step 3: Create the assemble route**

Create `src/app/api/pe-prep/[dealId]/assemble/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { resolvePEDeal, assemblePackage, buildAuditResult, type TurnoverAuditResult } from "@/lib/pe-turnover";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  if (process.env.PE_FILE_PREP_ENABLED !== "true") {
    return NextResponse.json({ error: "Not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const body = await req.json().catch(() => ({}));
  const { auditRunId } = body;

  if (!auditRunId) {
    return NextResponse.json({ error: "auditRunId is required" }, { status: 400 });
  }

  const auditRun = await prisma.peAuditRun.findUnique({ where: { id: auditRunId } });
  if (!auditRun || auditRun.dealId !== dealId || auditRun.status !== "completed") {
    return NextResponse.json({ error: "Invalid or incomplete audit run" }, { status: 400 });
  }

  const deal = await resolvePEDeal(dealId);
  if (!deal.rootFolderId) {
    return NextResponse.json({ error: "No root Drive folder" }, { status: 400 });
  }

  // Reconstruct TurnoverAuditResult from persisted data
  const auditResult: TurnoverAuditResult = {
    dealId,
    dealName: auditRun.dealName,
    address: deal.address,
    systemType: deal.systemType,
    milestone: auditRun.milestone as "m1" | "m2",
    peStatus: auditRun.milestone === "m1" ? deal.peM1Status : deal.peM2Status,
    categories: (auditRun.results as TurnoverAuditResult["categories"]) ?? [],
    summary: (auditRun.summary as TurnoverAuditResult["summary"]) ?? {
      totalItems: 0, found: 0, missing: 0, needsReview: 0, notApplicable: 0, errors: 0, ready: false,
    },
  };

  try {
    const result = await assemblePackage(auditResult, deal.rootFolderId);

    // Update audit run with package folder info
    await prisma.peAuditRun.update({
      where: { id: auditRunId },
      data: {
        packageFolderId: result.folderId,
        packageFolderUrl: result.folderUrl,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assembly failed" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Verify routes compile**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/pe-prep/
git commit -m "feat(pe-prep): add API routes — SSE audit, status, and package assembly"
```

---

### Task 6: Role Allowlist Updates

**Files:**
- Modify: `src/lib/roles.ts`

- [ ] **Step 1: Add routes to OPERATIONS_MANAGER**

In `src/lib/roles.ts`, find the OPERATIONS_MANAGER `allowedRoutes` array (~line 135) and add these entries after the existing PE routes (after `/dashboards/pe-pipeline`):

```typescript
    "/dashboards/pe-prep",
    "/dashboards/pe-submission-gap",
    "/api/pe-prep",
```

- [ ] **Step 2: Add routes to PROJECT_MANAGER**

In `src/lib/roles.ts`, find the PROJECT_MANAGER `allowedRoutes` array (~line 292) and add these entries after the existing PE routes (after `/dashboards/pe-pipeline`):

```typescript
    "/dashboards/pe-prep",
    "/dashboards/pe-submission-gap",
    "/api/pe-prep",
```

- [ ] **Step 3: Add routes to ACCOUNTING**

In `src/lib/roles.ts`, find the ACCOUNTING `allowedRoutes` array (~line 1440) and add after the existing `/dashboards/pe-submission-gap`:

```typescript
    "/dashboards/pe-prep",
    "/api/pe-prep",
```

- [ ] **Step 4: Verify middleware won't block**

Run: `grep -n "pe-prep" src/lib/roles.ts`
Expected: 8 occurrences (3 for PM + 3 for OPS_MGR + 2 for ACCOUNTING).

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(pe-prep): add pe-prep routes to PM, OPS_MGR, and ACCOUNTING role allowlists"
```

---

### Task 7: Query Keys + Feature Flag

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add pePrep query keys**

Add to `src/lib/query-keys.ts` after the existing `peDocs` section:

```typescript
  pePrep: {
    root: ["pePrep"] as const,
    status: (dealId: string) => [...queryKeys.pePrep.root, "status", dealId] as const,
    history: (dealId: string) => [...queryKeys.pePrep.root, "history", dealId] as const,
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat(pe-prep): add pePrep query keys"
```

---

## Chunk 3: UI Components

### Task 8: Core UI Components

**Files:**
- Create: `src/app/dashboards/pe-prep/[dealId]/page.tsx`
- Create: `src/components/pe-prep/PeAuditProgress.tsx`
- Create: `src/components/pe-prep/PeChecklistCard.tsx`
- Create: `src/components/pe-prep/PePhotoGrid.tsx`
- Create: `src/components/pe-prep/PePhotoModal.tsx`
- Create: `src/components/pe-prep/PePandaDocSection.tsx`
- Create: `src/components/pe-prep/PePrepButton.tsx`

- [ ] **Step 1: Create the PeChecklistCard component**

Create `src/components/pe-prep/PeChecklistCard.tsx`:

```tsx
"use client";

import type { EnrichedVisionResult } from "@/lib/pe-vision-classifier";

interface ChecklistCardItem {
  id: string;
  label: string;
  category: string;
  isPhoto: boolean;
  pePhotoNumber?: number;
}

interface ChecklistCardResult {
  item: ChecklistCardItem;
  status: "found" | "likely" | "missing" | "needs_review" | "not_applicable" | "error";
  statusNote?: string;
  foundFile?: {
    name: string;
    id: string;
    url: string;
    modifiedTime: string;
    size: number;
  };
  combinedFile?: boolean;
  visionResult?: EnrichedVisionResult;
}

const STATUS_CONFIG = {
  found: { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", icon: "✓", color: "text-green-700 dark:text-green-400" },
  likely: { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", icon: "~", color: "text-green-700 dark:text-green-400" },
  missing: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", icon: "✗", color: "text-red-700 dark:text-red-400" },
  needs_review: { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800", icon: "?", color: "text-yellow-700 dark:text-yellow-400" },
  not_applicable: { bg: "bg-surface", border: "border-t-border", icon: "—", color: "text-muted" },
  error: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", icon: "!", color: "text-red-700 dark:text-red-400" },
} as const;

export function PeChecklistCard({ result }: { result: ChecklistCardResult }) {
  const config = STATUS_CONFIG[result.status];

  return (
    <div className={`rounded-lg border p-3 ${config.bg} ${config.border}`}>
      <div className="flex items-start gap-3">
        <span className={`text-lg font-bold ${config.color}`}>{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground text-sm">{result.item.label}</span>
            {result.visionResult?.confidence && (
              <span className="text-xs text-muted px-1.5 py-0.5 bg-surface-2 rounded">
                {result.visionResult.confidence}
              </span>
            )}
          </div>
          {result.foundFile && (
            <a
              href={result.foundFile.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate block mt-0.5"
            >
              {result.foundFile.name}
              {result.combinedFile && " (combined)"}
            </a>
          )}
          {result.visionResult?.issues && result.visionResult.issues.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {result.visionResult.issues.map((issue, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">⚠ {issue}</p>
              ))}
            </div>
          )}
          {result.statusNote && !result.visionResult?.issues?.length && (
            <p className="text-xs text-muted mt-0.5">{result.statusNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the PeAuditProgress component**

Create `src/components/pe-prep/PeAuditProgress.tsx`:

```tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AuditEvent } from "@/lib/pe-audit-orchestrator";

interface Props {
  dealId: string;
  milestone: "m1" | "m2";
  onComplete: (auditRunId: string) => void;
  onError: (message: string) => void;
}

interface ProgressItem {
  itemId: string;
  label: string;
  status: string;
  file?: string;
  issues?: string[];
}

export function PeAuditProgress({ dealId, milestone, onComplete, onError }: Props) {
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [pandadocEvents, setPandadocEvents] = useState<Array<{ key: string; status: string; action: string }>>([]);
  const abortRef = useRef<AbortController | null>(null);

  const startAudit = useCallback(async () => {
    setRunning(true);
    setItems([]);
    setPandadocEvents([]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`/api/pe-prep/${dealId}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestone }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        onError(text || `HTTP ${res.status}`);
        setRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim();
          if (!dataLine) continue;

          try {
            const event = JSON.parse(dataLine) as AuditEvent;
            switch (event.type) {
              case "started":
                setTotalItems(event.data.totalItems);
                break;
              case "progress":
                setItems((prev) => [...prev, event.data]);
                break;
              case "pandadoc":
                setPandadocEvents((prev) => [...prev, event.data]);
                break;
              case "completed":
                onComplete(event.data.auditRunId);
                setRunning(false);
                return;
              case "error":
                onError(event.data.message);
                setRunning(false);
                return;
            }
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onError(err instanceof Error ? err.message : "Audit failed");
      }
    } finally {
      setRunning(false);
    }
  }, [dealId, milestone, onComplete, onError]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const progressPct = totalItems > 0 ? Math.round((items.length / totalItems) * 100) : 0;

  return (
    <div className="space-y-4">
      {!running && items.length === 0 && (
        <button
          onClick={startAudit}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium"
        >
          Run Audit
        </button>
      )}

      {running && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground font-medium">Auditing files…</span>
            <span className="text-muted">{items.length}/{totalItems} items</span>
          </div>
          <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {pandadocEvents.length > 0 && (
            <div className="text-xs text-muted space-y-1">
              {pandadocEvents.map((e, i) => (
                <p key={i}>PandaDoc ({e.key}): {e.action}</p>
              ))}
            </div>
          )}

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {items.map((item) => (
              <div key={item.itemId} className="flex items-center gap-2 text-xs">
                <span className={
                  item.status === "found" ? "text-green-600" :
                  item.status === "missing" ? "text-red-600" :
                  "text-yellow-600"
                }>
                  {item.status === "found" ? "✓" : item.status === "missing" ? "✗" : "?"}
                </span>
                <span className="text-foreground">{item.label}</span>
                {item.file && <span className="text-muted truncate">— {item.file}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the PePhotoGrid component**

Create `src/components/pe-prep/PePhotoGrid.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { EnrichedVisionResult } from "@/lib/pe-vision-classifier";

interface PhotoResult {
  item: { id: string; label: string; pePhotoNumber?: number };
  status: string;
  foundFile?: { name: string; id: string; url: string };
  visionResult?: EnrichedVisionResult;
}

interface Props {
  photos: PhotoResult[];
  onPhotoClick: (photo: PhotoResult) => void;
}

const VERDICT_BADGE = {
  pass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  fail: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  needs_review: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
} as const;

export function PePhotoGrid({ photos, onPhotoClick }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {photos.map((photo) => (
        <button
          key={photo.item.id}
          onClick={() => onPhotoClick(photo)}
          className="relative rounded-lg border border-t-border bg-surface overflow-hidden text-left hover:ring-2 hover:ring-orange-400 transition-all"
        >
          {photo.foundFile ? (
            <img
              src={`https://drive.google.com/thumbnail?id=${photo.foundFile.id}&sz=w300`}
              alt={photo.item.label}
              className="w-full h-32 object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-32 bg-surface-2 flex items-center justify-center">
              <span className="text-muted text-sm">No photo</span>
            </div>
          )}
          <div className="p-2">
            <p className="text-xs font-medium text-foreground truncate">
              {photo.item.pePhotoNumber}. {photo.item.label}
            </p>
            {photo.visionResult && (
              <span className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded ${VERDICT_BADGE[photo.visionResult.status] ?? ""}`}>
                {photo.visionResult.status}
              </span>
            )}
            {photo.status === "missing" && (
              <span className="inline-block mt-1 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                missing
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create the PePhotoModal component**

Create `src/components/pe-prep/PePhotoModal.tsx`:

```tsx
"use client";

import type { EnrichedVisionResult } from "@/lib/pe-vision-classifier";

interface PhotoResult {
  item: { id: string; label: string; pePhotoNumber?: number };
  status: string;
  foundFile?: { name: string; id: string; url: string };
  visionResult?: EnrichedVisionResult;
}

interface Props {
  photo: PhotoResult | null;
  onClose: () => void;
  onOverride?: (itemId: string, override: boolean) => void;
}

export function PePhotoModal({ photo, onClose, onOverride }: Props) {
  if (!photo) return null;

  const vr = photo.visionResult;
  const isOverridden = !!vr?.pmOverride;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface rounded-xl shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Image */}
        {photo.foundFile ? (
          <img
            src={`https://drive.google.com/thumbnail?id=${photo.foundFile.id}&sz=w800`}
            alt={photo.item.label}
            className="w-full max-h-96 object-contain bg-black"
          />
        ) : (
          <div className="w-full h-48 bg-surface-2 flex items-center justify-center">
            <span className="text-muted">No photo available</span>
          </div>
        )}

        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Photo {photo.item.pePhotoNumber}: {photo.item.label}
              </h3>
              {photo.foundFile && (
                <a
                  href={photo.foundFile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {photo.foundFile.name}
                </a>
              )}
            </div>
            <button onClick={onClose} className="text-muted hover:text-foreground text-xl">&times;</button>
          </div>

          {/* AI Verdict */}
          {vr && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-sm font-medium ${
                  vr.status === "pass" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                  vr.status === "fail" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" :
                  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                }`}>
                  AI Verdict: {vr.status.toUpperCase()}
                </span>
                <span className="text-xs text-muted">Confidence: {vr.confidence}</span>
                {isOverridden && (
                  <span className="text-xs text-blue-600 dark:text-blue-400">PM Override Active</span>
                )}
              </div>

              {vr.issues.length > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded-lg p-3">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-1">Issues</p>
                  <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                    {vr.issues.map((issue, i) => <li key={i}>• {issue}</li>)}
                  </ul>
                </div>
              )}

              {vr.equipmentVisible && vr.equipmentVisible.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-1">Equipment Detected</p>
                  <div className="flex flex-wrap gap-1.5">
                    {vr.equipmentVisible.map((eq, i) => (
                      <span key={i} className="text-xs px-2 py-1 bg-surface-2 rounded text-foreground">{eq}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Override toggle */}
              {onOverride && vr.status !== "pass" && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOverridden}
                    onChange={(e) => onOverride(photo.item.id, e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-foreground">Override AI verdict (PM confirms this photo is acceptable)</span>
                </label>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create the PePandaDocSection component**

Create `src/components/pe-prep/PePandaDocSection.tsx`:

```tsx
"use client";

import type { PeTemplateStatus } from "@/lib/pandadoc";

const STATUS_DISPLAY = {
  completed: { label: "Downloaded to GDrive", color: "text-green-700 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/30" },
  sent: { label: "Sent, awaiting signature", color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
  viewed: { label: "Viewed, awaiting signature", color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
  draft: { label: "Draft — not yet sent", color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950/30" },
} as const;

const KEY_LABELS: Record<string, string> = {
  attestation: "Installer Attestation (Exhibit A)",
  acceptance: "Customer Acceptance (Exhibit B)",
  progress_waiver: "Conditional Progress Lien Waiver",
  final_waiver: "Conditional Final Lien Waiver",
};

interface Props {
  statuses: PeTemplateStatus[];
}

export function PePandaDocSection({ statuses }: Props) {
  if (statuses.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">PandaDoc Templates</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {statuses.map((s) => {
          const display = s.document
            ? STATUS_DISPLAY[s.document.status as keyof typeof STATUS_DISPLAY] ?? { label: s.document.status, color: "text-muted", bg: "bg-surface" }
            : { label: "Not yet created", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30" };

          return (
            <div key={s.key} className={`rounded-lg border border-t-border p-3 ${display.bg}`}>
              <p className="text-sm font-medium text-foreground">{KEY_LABELS[s.key] ?? s.key}</p>
              <p className={`text-xs mt-1 ${display.color}`}>{display.label}</p>
              {s.document?.dateCompleted && (
                <p className="text-xs text-muted mt-0.5">
                  Completed: {new Date(s.document.dateCompleted).toLocaleDateString()}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create the PePrepButton component**

Create `src/components/pe-prep/PePrepButton.tsx`:

```tsx
"use client";

import Link from "next/link";

interface Props {
  dealId: string;
  auditStatus?: "ready" | "warned" | "missing" | "never" | null;
  compact?: boolean;
}

const DOT_COLORS = {
  ready: "bg-green-500",
  warned: "bg-yellow-500",
  missing: "bg-red-500",
  never: "bg-gray-400",
} as const;

export function PePrepButton({ dealId, auditStatus, compact }: Props) {
  const dotColor = auditStatus ? DOT_COLORS[auditStatus] : DOT_COLORS.never;

  if (compact) {
    return (
      <Link
        href={`/dashboards/pe-prep/${dealId}`}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-surface-2 hover:bg-surface-elevated text-foreground transition-colors"
        title="Prepare PE Package"
      >
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        Prep
      </Link>
    );
  }

  return (
    <Link
      href={`/dashboards/pe-prep/${dealId}`}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors"
    >
      <span className={`w-2 h-2 rounded-full ${auditStatus ? DOT_COLORS[auditStatus] : "bg-white/50"}`} />
      Prepare PE Package
    </Link>
  );
}
```

- [ ] **Step 7: Verify components compile**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/pe-prep/
git commit -m "feat(pe-prep): add UI components — checklist card, audit progress, photo grid/modal, PandaDoc section, prep button"
```

---

### Task 9: Standalone Prep Page

**Files:**
- Create: `src/app/dashboards/pe-prep/[dealId]/page.tsx`

- [ ] **Step 1: Create the prep page**

Create `src/app/dashboards/pe-prep/[dealId]/page.tsx`:

```tsx
"use client";

import { useState, useCallback, use } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { queryKeys } from "@/lib/query-keys";
import { PeAuditProgress } from "@/components/pe-prep/PeAuditProgress";
import { PeChecklistCard } from "@/components/pe-prep/PeChecklistCard";
import { PePhotoGrid } from "@/components/pe-prep/PePhotoGrid";
import { PePhotoModal } from "@/components/pe-prep/PePhotoModal";

interface AuditRunData {
  auditRun: {
    id: string;
    dealId: string;
    dealName: string;
    milestone: string;
    systemType: string;
    status: string;
    results: Array<{
      name: string;
      label: string;
      items: Array<{
        item: { id: string; label: string; category: string; isPhoto: boolean; pePhotoNumber?: number };
        status: string;
        statusNote?: string;
        foundFile?: { name: string; id: string; url: string; modifiedTime: string; size: number };
        combinedFile?: boolean;
        visionResult?: {
          status: "pass" | "fail" | "needs_review";
          notes: string;
          confidence: "high" | "medium" | "low";
          issues: string[];
          signatures?: { present: boolean; count: number; allSigned: boolean };
          equipmentVisible?: string[];
          pmOverride?: { overriddenAt: string; originalVerdict: string };
        };
      }>;
    }>;
    summary: {
      totalItems: number;
      found: number;
      missing: number;
      needsReview: number;
      notApplicable: number;
      errors: number;
      ready: boolean;
    };
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    packageFolderUrl?: string;
  } | null;
}

export default function PePrepPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = use(params);
  const queryClient = useQueryClient();
  const [selectedPhoto, setSelectedPhoto] = useState<unknown>(null);
  const [assembling, setAssembling] = useState(false);
  const [milestone, setMilestone] = useState<"m1" | "m2">("m1");

  const { data, isLoading } = useQuery<AuditRunData>({
    queryKey: queryKeys.pePrep.status(dealId),
    queryFn: async () => {
      const res = await fetch(`/api/pe-prep/${dealId}/status`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const auditRun = data?.auditRun;
  const hasResults = auditRun?.status === "completed" && auditRun.results;

  const handleAuditComplete = useCallback((auditRunId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.pePrep.status(dealId) });
  }, [dealId, queryClient]);

  const handleAssemble = async () => {
    if (!auditRun?.id) return;
    setAssembling(true);
    try {
      const res = await fetch(`/api/pe-prep/${dealId}/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditRunId: auditRun.id }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.folderUrl) window.open(result.folderUrl, "_blank");
        queryClient.invalidateQueries({ queryKey: queryKeys.pePrep.status(dealId) });
      }
    } finally {
      setAssembling(false);
    }
  };

  // Extract photo results for grid
  const photoResults = hasResults
    ? auditRun.results.flatMap((cat) => cat.items).filter((r) => r.item.isPhoto)
    : [];

  // Extract document results (non-photo)
  const docCategories = hasResults
    ? auditRun.results.filter((cat) => cat.items.some((r) => !r.item.isPhoto))
    : [];

  const s = auditRun?.summary;
  const lastAuditLabel = auditRun?.completedAt
    ? `Last audited ${new Date(auditRun.completedAt).toLocaleString()}`
    : auditRun?.status === "running" ? "Audit in progress…" : undefined;

  return (
    <DashboardShell
      title={auditRun?.dealName ? `PE Prep: ${auditRun.dealName}` : "PE File Preparation"}
      accentColor="orange"
      lastUpdated={lastAuditLabel}
      fullWidth
    >
      <div className="space-y-6">
        {/* Summary bar */}
        {s && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Ready" value={s.found} accentColor="green" />
            <StatCard label="Needs Review" value={s.needsReview} accentColor="yellow" />
            <StatCard label="Missing" value={s.missing} accentColor="red" />
            <StatCard label="N/A" value={s.notApplicable} accentColor="gray" />
            <StatCard label="Errors" value={s.errors} accentColor="red" />
          </div>
        )}

        {/* Milestone toggle */}
        <div className="flex items-center gap-2">
          {(["m1", "m2"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMilestone(m)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                milestone === m
                  ? "bg-orange-500 text-white"
                  : "bg-surface-2 text-muted hover:text-foreground"
              }`}
            >
              {m === "m1" ? "M1 — Inspection Complete" : "M2 — Project Complete"}
            </button>
          ))}
        </div>

        {/* Audit controls */}
        <div className="flex items-center gap-3">
          <PeAuditProgress
            dealId={dealId}
            milestone={milestone}
            onComplete={handleAuditComplete}
            onError={(msg) => console.error("Audit error:", msg)}
          />
          {hasResults && (
            <button
              onClick={handleAssemble}
              disabled={assembling}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
            >
              {assembling ? "Assembling…" : "Assemble Package"}
            </button>
          )}
          {auditRun?.packageFolderUrl && (
            <a
              href={auditRun.packageFolderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              View Package Folder
            </a>
          )}
        </div>

        {/* Document sections */}
        {docCategories.map((cat) => (
          <div key={cat.name} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{cat.label}</h3>
            <div className="space-y-2">
              {cat.items
                .filter((r) => !r.item.isPhoto)
                .map((r) => (
                  <PeChecklistCard key={r.item.id} result={r as Parameters<typeof PeChecklistCard>[0]["result"]} />
                ))}
            </div>
          </div>
        ))}

        {/* Photo grid */}
        {photoResults.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Photos</h3>
            <PePhotoGrid
              photos={photoResults as Parameters<typeof PePhotoGrid>[0]["photos"]}
              onPhotoClick={(p) => setSelectedPhoto(p)}
            />
          </div>
        )}

        {/* Photo modal */}
        <PePhotoModal
          photo={selectedPhoto as Parameters<typeof PePhotoModal>[0]["photo"]}
          onClose={() => setSelectedPhoto(null)}
        />

        {/* Loading state */}
        {isLoading && (
          <div className="text-center py-12 text-muted">Loading audit data…</div>
        )}

        {/* Empty state */}
        {!isLoading && !auditRun && (
          <div className="text-center py-12 text-muted">
            No audit has been run for this deal yet. Click "Run Audit" to start.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify page compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/pe-prep/
git commit -m "feat(pe-prep): add standalone prep page with audit progress, results, and assembly"
```

---

### Task 10: PE Submission Gap Integration

**Files:**
- Modify: `src/app/dashboards/pe-submission-gap/page.tsx`

- [ ] **Step 1: Add PePrepButton import and column**

In `src/app/dashboards/pe-submission-gap/page.tsx`:

1. Add import at top:
```typescript
import { PePrepButton } from "@/components/pe-prep/PePrepButton";
```

2. In the table header row, add a "Prep" column header after the existing column headers (before the last `</tr>`):
```tsx
<th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase">Prep</th>
```

3. In the table body row, add the prep button cell:
```tsx
<td className="px-3 py-2">
  <PePrepButton dealId={deal.dealId} compact />
</td>
```

Note: Only add to tabs that are NOT the "complete" tab. Wrap in a conditional if necessary.

- [ ] **Step 2: Verify page compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/pe-submission-gap/page.tsx
git commit -m "feat(pe-prep): add Prep button column to PE Submission Gap dashboard"
```

---

### Task 10B: Deal Detail Page Integration

**Files:**
- Modify: `src/app/dashboards/deals/[pipeline]/[dealId]/page.tsx`

- [ ] **Step 1: Add PePrepButton to deal detail page**

In `src/app/dashboards/deals/[pipeline]/[dealId]/page.tsx`:

1. Add import at top:
```typescript
import { PePrepButton } from "@/components/pe-prep/PePrepButton";
```

2. In the deal detail actions area, add the prep button visible only for PE-tagged deals. Find the actions section and add:
```tsx
{deal.is_participate_energy === "true" && (
  <PePrepButton dealId={dealId} />
)}
```

The exact location depends on the current page layout — place it near other action buttons in the header area.

- [ ] **Step 2: Verify page compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/deals/
git commit -m "feat(pe-prep): add Prepare PE Package button to deal detail page"
```

---

## Chunk 4: Skill Definition + Feature Flag Wiring

### Task 11: Skill Definition

**Files:**
- Create: `.claude/skills/pe-file-prep/SKILL.md`
- Modify: `.claude/skills/pe-turnover/SKILL.md` (add alias redirect)

- [ ] **Step 1: Create pe-file-prep skill**

Create `.claude/skills/pe-file-prep/SKILL.md`:

```markdown
---
name: pe-file-prep
description: Prepare PE (Participate Energy) milestone submission files — AI vision classification, PandaDoc auto-pull, and package assembly
---

# PE File Preparation

Prepare Participate Energy milestone submission packages (M1 = Inspection Complete, M2 = Project Complete).

## Trigger Phrases
- "prepare PE files for PROJ-1234"
- "PE file prep for Smith"
- "get PE package ready for deal 12345"
- "PE turnover for [deal]"

## What This Does

1. **Resolves the deal** from HubSpot (by deal ID, project name, or customer name)
2. **Runs the AI-powered audit**: walks GDrive folders, uses Claude vision to classify each document and verify each photo against PE checklist requirements
3. **Auto-pulls PandaDoc documents**: downloads completed Attestation, Acceptance, and Lien Waiver PDFs into GDrive
4. **Reports results** with AI verdicts, confidence levels, and issues for each item
5. **Offers package assembly**: copies all found + warned files into a staging folder

## Usage

```
User: prepare PE files for PROJ-1234
```

The skill resolves the deal, runs the audit via the pe-audit-orchestrator library, and presents results. For missing items, it provides actionable guidance (e.g., "Create PandaDoc from template", "For Tesla systems, use the PowerHub screenshot skill").

## Feature Flag

Requires `PE_FILE_PREP_ENABLED=true` in environment.

## Cross-Skill Integration

- **pe-portal-scraping**: Separate skill for browser-based PE portal interaction
- **PowerHub screenshot**: Separate skill for pulling commissioning proof from Tesla PowerHub. If commissioning photo is missing, this skill suggests using it.

## Implementation

Uses `runPeAudit()` from `src/lib/pe-audit-orchestrator.ts` which orchestrates:
- `src/lib/pe-vision-classifier.ts` — Claude Sonnet vision classification
- `src/lib/pandadoc.ts` — PandaDoc template discovery + PDF download
- `src/lib/pe-turnover.ts` — checklist definitions, folder mapping, assembly
- `src/lib/drive-plansets.ts` — Google Drive file operations
```

- [ ] **Step 2: Update pe-turnover skill as alias**

If `.claude/skills/pe-turnover/SKILL.md` exists, update it to redirect:

```markdown
---
name: pe-turnover
description: Alias for pe-file-prep — PE turnover readiness audit and file preparation
---

# PE Turnover (Alias)

This skill has been superseded by **pe-file-prep**. Use the pe-file-prep skill instead.

When triggered, invoke the pe-file-prep skill which provides AI-powered vision classification, PandaDoc auto-pull, and package assembly.
```

If it doesn't exist, create it with the above content.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pe-file-prep/ .claude/skills/pe-turnover/
git commit -m "feat(pe-prep): add pe-file-prep skill definition and pe-turnover alias"
```

---

### Task 12: Feature Flag + Environment Setup

**Files:**
- Modify: `.env.example` (if it exists)

- [ ] **Step 1: Add feature flags to .env.example**

Add to `.env.example`:

```
# PE File Preparation (vision classifier + PandaDoc auto-pull)
PE_FILE_PREP_ENABLED=false
PANDADOC_PE_TEMPLATES_ENABLED=false
# Optional: override PandaDoc PE template IDs (auto-discovered if unset)
# PANDADOC_PE_ATTESTATION_TEMPLATE_ID=
# PANDADOC_PE_ACCEPTANCE_TEMPLATE_ID=
# PANDADOC_PE_PROGRESS_WAIVER_TEMPLATE_ID=
# PANDADOC_PE_FINAL_WAIVER_TEMPLATE_ID=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "feat(pe-prep): add PE_FILE_PREP_ENABLED and PANDADOC_PE_TEMPLATES_ENABLED to env example"
```

---

### Task 13: Final Type Check + Build Verification

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run all tests**

Run: `npm run test`
Expected: All tests pass, including new pe-vision-classifier and pandadoc-pe tests.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit any fixes**

If type check or build revealed issues, fix and commit.
