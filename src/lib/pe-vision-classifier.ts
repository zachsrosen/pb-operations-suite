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

export interface ClassifyOptions {
  referenceFileId?: string;
  referenceMimeType?: string;
  avlContext?: string;
}

// ---------------------------------------------------------------------------
// Document descriptions — tells the classifier what each item actually IS
// so it can distinguish similar-looking documents (e.g. proposal vs agreement)
// ---------------------------------------------------------------------------

const PE_DOCUMENT_DESCRIPTIONS: Record<string, string> = {
  // --- Contract & Proposal ---
  "m1.contract.customer_agreement":
    "The formal PPA/ESA/Lease contract between customer and installer. " +
    "Countersigned by both parties. Filename usually starts with PE_CON_ or contains 'contract_package'. " +
    "Often a multi-page contract package that ALSO contains the Installation Order and Disclosures. " +
    "This is NOT the sales proposal/quote — it is the binding legal agreement.",
  "m1.contract.installation_order":
    "The installation order (IO) — a work authorization addendum to the Customer Agreement. " +
    "Lists equipment, system size, and installation scope. Often combined in the same PDF as the Customer Agreement. " +
    "NOT a standalone sales proposal or quote.",
  "m1.contract.disclosures":
    "State-required disclosures (e.g. CO consumer protection, CA CSLB disclosures). " +
    "Signed or initialed by customer. Often combined in the same PDF as the Customer Agreement. " +
    "NOT a standalone contract or proposal.",
  "m1.contract.proposal":
    "The sales proposal or quote document showing system design, pricing, equipment, and savings estimates. " +
    "Filename usually starts with 'Proposal' or contains 'quote'. Signed or digitally acknowledged by the customer. " +
    "This is NOT the binding Customer Agreement/contract — it is a pre-sale quote/proposal. " +
    "A proposal typically includes: system size (kW), equipment list, pricing breakdown, production estimates, and financing terms.",
  "m1.contract.utility_bill":
    "A utility bill showing the customer's electricity usage. Must show 12 months of usage history or a recent billing period. " +
    "From the local electric utility (Xcel Energy, PG&E, SCE, SDG&E, etc.). " +
    "NOT a proposal, contract, or invoice.",
  "m1.contract.loan_docs":
    "Loan or financing documents from a third-party lender (Sunraise, Mosaic, GoodLeap, etc.). " +
    "NOT a solar proposal or contract.",
  "m1.contract.incentive_forms":
    "Incentive application forms (3CE, Xcel rebate, state incentive). " +
    "NOT a utility bill, proposal, or contract.",

  // --- Design ---
  "m1.design.planset":
    "The final engineering plan set / design package. " +
    "Multi-page technical drawings: site plan, electrical single-line diagram, structural details, equipment schedule. " +
    "NOT a proposal, contract, or inspection card.",

  // --- Admin ---
  "m1.admin.commissioning":
    "Screenshot or PDF proving the monitoring system is online and accessible to the homeowner. " +
    "From Enphase Enlighten, SolarEdge monitoring portal, Tesla app, etc. Shows system production data. " +
    "NOT a nameplate photo, invoice, or equipment spec sheet.",
  "m1.admin.hoa":
    "HOA (Homeowners Association) approval letter for the solar installation. " +
    "NOT a permit, inspection card, or contract.",

  // --- Post-Install ---
  "m1.post_install.attestation":
    "Exhibit A — Installer Attestation of Customer Payment. " +
    "A PE-specific template document confirming the customer has paid all amounts owed. " +
    "Generated via PandaDoc. Title contains 'Installer Attestation' or 'Exhibit A'. " +
    "NOT a contract, proposal, or lien waiver.",
  "m1.post_install.acceptance":
    "Exhibit B — Customer Certificate of Acceptance. " +
    "A PE-specific template document where the customer certifies the installation is satisfactory. " +
    "Generated via PandaDoc. Title contains 'Certificate of Acceptance' or 'Exhibit B'. " +
    "NOT a contract, proposal, or attestation.",

  // --- Inspection ---
  "m1.inspection.ahj_permit":
    "The AHJ (Authority Having Jurisdiction) signed final inspection card/permit. " +
    "Proves the local building department inspected and passed the installation. " +
    "Usually a scanned inspection card with inspector's signature and 'PASSED'/'APPROVED' stamp. " +
    "NOT a building permit application — this is the SIGNED/APPROVED result.",

  // --- Lien ---
  "m1.lien.conditional":
    "Conditional Progress Lien Waiver — a statutory lien waiver form for progress payment. " +
    "State-specific legal form. Title contains 'Conditional Waiver', 'Progress Waiver', or 'Lien Waiver'. " +
    "NOT an attestation, acceptance certificate, or contract.",

  // --- M2 ---
  "m2.pto.pto_letter":
    "The official Permission to Operate (PTO) letter from the utility company. " +
    "Authorizes the solar system to connect to the grid and export power. " +
    "Often a forwarded email PDF from the utility. Contains 'Permission to Operate' or 'PTO'. " +
    "NOT an interconnection agreement, permit, or inspection card.",
  "m2.pto.interconnection":
    "The signed Interconnection Agreement (IA) between the utility and customer/installer. " +
    "Governs how the solar system connects to the utility grid. Both parties must sign. " +
    "May be titled 'DER Interconnection Agreement', 'Net Metering Agreement', or 'Renewable Battery Connect Agreement'. " +
    "NOT the PTO letter — this is a separate agreement document.",
  "m2.warranty.assignment":
    "Warranty registration or assignment documentation proving equipment warranties are activated. " +
    "NOT a proposal, contract, or PTO letter.",
  "m2.incentives.documentation":
    "Incentive approval letters or rebate documentation from PE or utility programs. " +
    "NOT a utility bill, contract, or warranty document.",
  "m2.lien.final":
    "Conditional Waiver and Release on Final Payment — the final payment lien waiver. " +
    "State-specific statutory form. Title contains 'Final Payment', 'Final Waiver', or 'Unconditional Waiver'. " +
    "NOT the progress/conditional waiver (that's M1) — this is for FINAL payment.",
};

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildDocumentPrompt(
  checklistItems: ChecklistItem[],
  options?: { hasReference?: boolean; avlContext?: string; candidateFileName?: string },
): string {
  const itemList = checklistItems
    .filter((i) => !i.isPhoto)
    .map((i) => {
      const desc = PE_DOCUMENT_DESCRIPTIONS[i.id];
      return desc
        ? `- ${i.id}: ${i.label}\n  ${desc}`
        : `- ${i.id}: ${i.label} (category: ${i.category})`;
    })
    .join("\n");

  const sections: string[] = [
    `You are a document classification system for Participate Energy (PE) milestone submissions in the solar industry.

Analyze this document and classify it against the PE checklist. Return a JSON object.
Be CONSERVATIVE — only match a checklist ID if the document genuinely IS that type. When in doubt, return an empty matchedChecklistIds array rather than a wrong match.`,
  ];

  if (options?.candidateFileName) {
    sections.push(`## Candidate File
Filename: ${options.candidateFileName}
Use the filename as a classification signal — but always verify against the actual document content.`);
  }

  if (options?.hasReference) {
    sections.push(`## Reference Example
The first file attached is an APPROVED example from a previously paid PE submission.
Use it as a baseline for quality, format, and completeness when evaluating the candidate document (the second file).`);
  }

  sections.push(`## PE Checklist Items (documents only)
${itemList}`);

  if (options?.avlContext) {
    sections.push(`## Equipment Approved Vendor List (AVL)
If you can identify equipment brand/model/SKU in this document, cross-check against PE's AVL.
Flag any equipment NOT on this list as an "avl_mismatch" issue.
${options.avlContext}`);
  }

  const instructions = [
    "1. Identify what type of document this is (contract, proposal, utility bill, permit, lien waiver, etc.)",
    "2. Match it to one or more checklist IDs from the list above. A single PDF may contain multiple documents (e.g. a contract package containing Customer Agreement + Installation Order + Disclosures).",
    "3. CRITICAL: Do NOT confuse similar-sounding documents. A sales PROPOSAL (pricing/design quote) is NOT a Customer AGREEMENT (binding contract). An inspection CARD is NOT a building PERMIT application. A PTO LETTER is NOT an Interconnection AGREEMENT.",
    "4. If the document doesn't clearly match any checklist item, return an EMPTY matchedChecklistIds array. A wrong match is worse than no match.",
    "5. Check for signatures — are they present? How many? Are all required signature fields signed?",
    "6. Check for date relevance — utility bills should be within 12 months, permits should not be expired.",
    "7. Flag any issues (unsigned, expired, wrong document type, poor quality, etc.)",
  ];
  if (options?.avlContext) {
    instructions.push("8. If equipment is identifiable, verify it appears on the AVL. Flag mismatches.");
  }
  sections.push(`## Instructions\n${instructions.join("\n")}`);

  sections.push(`## Response Format (JSON only, no markdown)
{
  "matchedChecklistIds": ["m1.contract.customer_agreement"] or [] if no match,
  "confidence": "high" | "medium" | "low",
  "documentType": "Customer Agreement",
  "issues": ["Missing signature on page 2"],
  "signatures": { "present": true, "count": 2, "allSigned": false },
  "dateRelevance": { "date": "2025-11-15", "isExpired": false, "expiresIn": 180 } or null
}`);

  return sections.join("\n\n");
}

function buildPhotoPrompt(
  item: ChecklistItem,
  options?: { hasReference?: boolean },
): string {
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

  const referenceNote = options?.hasReference
    ? `\n## Reference Photo
The first image is an APPROVED example of this photo type from a previously paid PE submission.
Compare the candidate photo (the second image) against it for expected content, quality, and angle.\n`
    : "";

  return `You are a photo verification system for Participate Energy (PE) milestone submissions.

## PE Photo Requirement
Photo ${item.pePhotoNumber}: ${item.label}
Requirement: ${requirement}
${referenceNote}
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
// Post-processing — mutual exclusion rules
// ---------------------------------------------------------------------------

/** IDs that indicate a contract package (CA + IO + Disclosures combined PDF). */
const CONTRACT_PACKAGE_IDS = new Set([
  "m1.contract.customer_agreement",
  "m1.contract.installation_order",
  "m1.contract.disclosures",
]);

/**
 * Sanitize matchedChecklistIds to remove known false positives.
 * A contract package (containing CA/IO/Disclosures) is NOT a standalone
 * sales proposal — if both are present, drop the proposal match.
 */
function sanitizeMatchedIds(ids: string[]): string[] {
  const hasContractPackage = ids.some((id) => CONTRACT_PACKAGE_IDS.has(id));
  if (hasContractPackage) {
    return ids.filter((id) => id !== "m1.contract.proposal");
  }
  return ids;
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
  options?: ClassifyOptions,
): Promise<VisionResult> {
  try {
    const client = getAnthropicClient();
    const fileId = await uploadToAnthropic(input.buffer, input.fileName, input.mimeType);
    const prompt = buildDocumentPrompt(checklistItems, {
      hasReference: !!options?.referenceFileId,
      avlContext: options?.avlContext,
      candidateFileName: input.fileName,
    });

    const contentType = input.mimeType.startsWith("image/") ? "image" as const : "document" as const;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentBlocks: any[] = [];
    if (options?.referenceFileId) {
      const refType = options.referenceMimeType?.startsWith("image/") ? "image" : "document";
      contentBlocks.push({ type: refType, source: { type: "file", file_id: options.referenceFileId } });
    }
    contentBlocks.push({ type: contentType, source: { type: "file", file_id: fileId } });
    contentBlocks.push({ type: "text", text: prompt });

    const message = await client.beta.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 2000,
      messages: [{ role: "user", content: contentBlocks }],
      betas: ["files-api-2025-04-14"],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as VisionClassification;

    // Apply mutual exclusion rules (e.g. contract package ≠ proposal)
    parsed.matchedChecklistIds = sanitizeMatchedIds(parsed.matchedChecklistIds);

    return { kind: "document", classification: parsed };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function verifyPhoto(
  input: VisionFileInput,
  checklistItem: ChecklistItem,
  options?: Pick<ClassifyOptions, "referenceFileId" | "referenceMimeType">,
): Promise<VisionResult> {
  try {
    const client = getAnthropicClient();
    const fileId = await uploadToAnthropic(input.buffer, input.fileName, input.mimeType);
    const prompt = buildPhotoPrompt(checklistItem, { hasReference: !!options?.referenceFileId });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentBlocks: any[] = [];
    if (options?.referenceFileId) {
      contentBlocks.push({ type: "image", source: { type: "file", file_id: options.referenceFileId } });
    }
    contentBlocks.push({ type: "image", source: { type: "file", file_id: fileId } });
    contentBlocks.push({ type: "text", text: prompt });

    const message = await client.beta.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 1500,
      messages: [{ role: "user", content: contentBlocks }],
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
  classifyOptions?: ClassifyOptions;
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
        result = await classifyDocument(file, checklistItems, opts?.classifyOptions);
      } else {
        result = await classifyDocument(file, checklistItems, opts?.classifyOptions);
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
