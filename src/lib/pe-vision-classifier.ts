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
