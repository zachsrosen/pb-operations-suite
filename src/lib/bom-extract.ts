/**
 * BOM Extraction — Shared Logic
 *
 * Extracts a structured BOM from a planset PDF using the Anthropic Files API
 * (claude-opus-4-5). Used by both:
 *   - POST /api/bom/extract (HTTP route, SSE-streaming wrapper)
 *   - BOM pipeline orchestrator (automated, returns JSON directly)
 *
 * Callers are responsible for:
 *   1. Downloading the PDF (Drive, Blob, etc.)
 *   2. Providing the buffer to this function
 *   3. Handling the result (SSE stream vs. direct JSON)
 *
 * This module owns:
 *   - Anthropic Files API upload + cleanup
 *   - Claude extraction call with retry
 *   - Base64 fallback for PDF processing errors
 *   - JSON parsing + validation
 *   - The full extraction system prompt
 */

import Anthropic from "@anthropic-ai/sdk";
import { logActivity } from "@/lib/db";
import type { ActorContext } from "@/lib/actor-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BomExtractionResult {
  bom: Record<string, unknown>;
  filename: string;
  sizeBytes: number;
  itemCount: number;
}

export interface ExtractionProgress {
  step: "uploading" | "extracting";
  message: string;
}

export type ProgressCallback = (progress: ExtractionProgress) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SIZE = 500 * 1024 * 1024; // 500MB
const INLINE_LIMIT = 45 * 1024 * 1024; // 45MB — base64 fallback threshold

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPdfProcessingErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not process pdf") ||
    normalized.includes("password") ||
    normalized.includes("encrypted") ||
    normalized.includes("corrupt")
  );
}

function isRetryableClaudeError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("overloaded") ||
    normalized.includes("rate limit") ||
    normalized.includes("timeout") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("internal server error")
  );
}

export function getPdfPageCount(buffer: Buffer): number | null {
  try {
    const text = buffer.toString("latin1");
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extraction system prompt
// ---------------------------------------------------------------------------

export const BOM_EXTRACTION_SYSTEM_PROMPT = `You are a solar engineering document analyst specializing in Photon Brothers (PB) stamped solar/storage plansets. Extract a complete Bill of Materials (BOM) from the provided PDF and return ONLY a valid JSON object — no markdown, no explanation, just the JSON.

## Planset Structure
Every PB planset has these standard sheets:
- PV-0: Cover sheet — system size (kWdc/kWac), equipment list with (N)/(E) prefixes, design criteria (roof type)
- PV-1: Site plan
- PV-2: Roof plan — PRIMARY BOM SOURCE: contains "BILL OF MATERIALS" table with EQUIPMENT | QTY | DESCRIPTION columns
- PV-3: Attachment details
- PV-4: Electrical Line Diagram (SLD) — conductor/wire schedule table at bottom, Powerwall part number, module specs
- PV-5: Electrical calculation — OCPD rating
- PV-6: Warning labels — ESS SIZE (battery kWh confirmation)
- PV-8+: Equipment spec sheets

## Category Mapping

Map each BOM row to these categories:
| PV-2 EQUIPMENT label | category |
|---|---|
| SOLAR PV MODULE | MODULE |
| BATTERY & INVERTER | BATTERY |
| BATTERY (expansion unit) | BATTERY |
| INVERTER (standalone) | INVERTER |
| RAPID SHUTDOWN | RAPID_SHUTDOWN |
| RAIL | RACKING |
| BONDED SPLICE | RACKING |
| CLAMP (MID or END) | RACKING |
| ATTACHMENT | RACKING |
| RD STRUCTURAL SCREW | RACKING |
| GROUNDING LUG | ELECTRICAL_BOS |
| JUNCTION BOX | ELECTRICAL_BOS |
| AC DISCONNECT | ELECTRICAL_BOS |
| SUB PANEL | ELECTRICAL_BOS |
| TESLA BACKUP GATEWAY / BACKUP SWITCH | MONITORING |
| PRODUCTION METER | MONITORING |
| Conductor/wire rows from PV-4 | ELECTRICAL_BOS |

## Important Rules

1. **(N) = new equipment** — include in BOM. **(E) = existing** — omit (do not include).
2. For the **conductor schedule on PV-4**: add each conductor row as an ELECTRICAL_BOS item. Tags A/B/C/D are different circuit segments.
3. **Metal roofs**: ATTACHMENT = "S-5! PROTEABRACKET ATTACHMENTS", rail = XR100 (not XR10), no RD STRUCTURAL SCREW row.
4. **Powerwall-3 part number**: 1707000-XX-Y (found in PV-4 specifications table).
5. **Gateway-3 part number**: 1841000-X1-Y (found in PV-4 or PV-2 callout).
6. **Backup Switch part number**: 1624171-00-x (found in PV-4 callout or PV-2 BOM; used on simpler jobs without full Gateway-3 — see active extraction rule below).
7. **flags** array: use "INFERRED" when value was inferred, "ASSUMED_BRAND" when brand was assumed, "VALIDATION_WARNING" when a cross-check failed.

## Critical Model/SKU Rules

### BONDED SPLICE — Rail-Specific Model
The PV-2 BOM table calls this "SPLICE KIT" or "BONDED SPLICE" generically. Always output the rail-specific model:
- XR10 rail (asphalt shingle jobs) → model: "XR10-BOSS-01-M1", description: "IRONRIDGE XR10 BONDED SPLICE MILL"
- XR100 rail (metal roof jobs) → model: "XR100-BOSS-01-M1", description: "IRONRIDGE XR100 BONDED SPLICE MILL"
Check the RAIL row to determine XR10 vs XR100. Never output "SPLICE KIT" as the model.

### 60A MAIN BREAKER ENCLOSURE → Two Separate BOM Items
When PV-2 or PV-0 lists a "60A MAIN BREAKER ENCLOSURE", always output TWO items (not one):
1. { "category": "ELECTRICAL_BOS", "brand": "", "model": "TL270RCU", "description": "LOAD CENTER, 70A, MAIN LUGS, 1PH, 65KA, 120/240VAC, 2/4 CIRCUIT", "qty": 1, "source": "PV-2" }
2. { "category": "ELECTRICAL_BOS", "brand": "GE", "model": "THQL2160", "description": "60A 2-POLE GE CIRCUIT BREAKER", "qty": 1, "source": "PV-2" }
Do NOT output a single "60A MAIN BREAKER ENCLOSURE" item — always split into these two.

### AC DISCONNECT — 2-Wire vs 3-Wire
Read the PV-4 SLD callout text for the AC disconnect:
- "3-WIRE" in callout → model: "TGN3322R" (3-pole; used on service upgrade / tap jobs with neutral)
- "2-WIRE" or no wire count → model: "DG222URB" (standard 2-pole, most common)

**DG222URB is always 60A.** Its description must always be: "60A NON-FUSED, UTILITY PV AC DISCONNECT VISIBLE LOCKABLE LABELED DISCONNECT". Never use "200A" in the description even if the MSP or service panel is 200A — those are different components.

### JUNCTION BOX — Always Substitute SOLOBOX COMP-D
Regardless of what the planset shows for JUNCTION BOX (e.g., "EZ SOLAR JB-1.2"), always output the UNIRAC SOLOBOX COMP-D instead:
{ "category": "ELECTRICAL_BOS", "brand": "UNIRAC", "model": "SBOXCOMP-D", "description": "UNIRAC SOLOBOX COMP-D JUNCTION BOX", "qty": 3, "source": "OPS_STANDARD" }
This applies to every solar (PV module) job. Do NOT output the planset's J-box model.

### IMO RAPID SHUTDOWN SWITCH — From PV-4 SLD Only
The PV-2 BOM lists TESLA MCI-2 devices (module-level). Scan PV-4 SLD separately for "(N) RAPID SHUTDOWN SWITCH" — this is the control unit (initiator), NOT in PV-2:
- If "(N) RAPID SHUTDOWN SWITCH" is in PV-4 SLD → add: { "category": "RAPID_SHUTDOWN", "brand": "IMO", "model": "IMO SI16-PEL64R-2", "description": "IMO RAPID SHUTDOWN DEVICE, SI16-PEL64R-2", "qty": 1, "source": "PV-4" }
- If not present, omit. Always qty 1 regardless of module count.

### TESLA BACKUP SWITCH — From PV-2 BOM or PV-4 SLD
Some jobs use a Backup Switch instead of the full Backup Gateway-3 (simpler installs). Scan PV-2 BOM for a "BACKUP SWITCH" row (tag TBS) or scan PV-4 SLD for "(N) BACKUP SWITCH" callout:
- If found → add: { "category": "MONITORING", "brand": "Tesla", "model": "1624171-00-x", "description": "TESLA BACKUP SWITCH", "qty": 1, "source": "PV-4" }
- If not found, omit. A job will have either a Backup Gateway-3 OR a Backup Switch, not both.

### TESLA REMOTE METER — From PV-2 BOM or PV-4 SLD
Some battery-only jobs (no PV modules) include a Tesla Remote Meter for monitoring. Scan PV-2 BOM for a "REMOTE METER" row or scan PV-4 SLD for "(N) REMOTE METER" callout:
- If found → add TWO items:
  1. { "category": "MONITORING", "brand": "Tesla", "model": "2045796-xx-y", "description": "TESLA REMOTE METER ENERGY KIT", "qty": 1, "source": "PV-4" }
  2. { "category": "MONITORING", "brand": "Tesla", "model": "P2045794-00-D", "description": "TESLA REMOTE METER HARDWIRE KIT", "qty": 1, "source": "PV-4" }
- If not found, omit both.

### ENPHASE MICRO-INVERTER JOBS — Additional Items
When the job uses Enphase micro-inverters (IQ8 series), extract the following items:
- **Q-Cable**: If the conductor schedule lists Q-CABLE or a 12 AWG DC cable with free air routing → add: { "category": "ELECTRICAL_BOS", "brand": "Enphase", "model": "Q-12-RAW-300", "description": "Q-CABLE, 12 AWG, 3 CONDUCTORS, FREE AIR", "qty": 1, "source": "PV-4" }
- **PV Circuit Breaker**: Enphase jobs typically use a 40A 2-pole breaker (not 60A). If PV-4 shows a 40A breaker → add: { "category": "ELECTRICAL_BOS", "brand": "GE", "model": "THQL2140", "description": "40A 2-POLE PV BREAKER", "qty": 1, "source": "PV-4" }
- **Portrait Q-Cable Adapter**: If planset or conductor schedule references Q-12-10-240, portrait cable, or portrait module orientation → add: { "category": "ELECTRICAL_BOS", "brand": "Enphase", "model": "Q-12-10-240", "description": "ENPHASE Q-CABLE PORTRAIT ADAPTER", "qty": 1, "source": "PV-4" }
- **Q-Cable Sealing Plugs**: Always add on Enphase jobs → { "category": "ELECTRICAL_BOS", "brand": "Enphase", "model": "Q-SEAL-10", "description": "ENPHASE Q-SEAL SEALING PLUGS", "qty": 1, "source": "OPS_STANDARD" }
- **Q-Cable Termination Caps**: Always add on Enphase jobs → { "category": "ELECTRICAL_BOS", "brand": "Enphase", "model": "Q-TERM-10", "description": "ENPHASE Q-TERM TERMINATION CAPS", "qty": 1, "source": "OPS_STANDARD" }
- **Microinverter Mounting Clip**: Add 1 clip per IQ8 microinverter (qty = IQ8 count from PV-2 BOM) → { "category": "RACKING", "brand": "Enphase", "model": "BHW-MI-01-A1", "description": "ENPHASE MICROINVERTER MOUNTING CLIP", "qty": [IQ8 qty], "source": "OPS_STANDARD" }

### CONDUCTOR SCHEDULE — Wire Model Naming
**CRITICAL**: Every wire item MUST include the gauge in the model field. Never output a wire type alone without its AWG rating. The Zoho inventory lookup depends on exact gauge matching — a bare "THWN-2" without gauge will match the wrong inventory item.

Always use standardized model names:
- 10 AWG THHN or THWN-2 → model: "10 AWG THHN/THWN-2"
- 6 AWG THWN-2 → model: "6 AWG THWN-2"
- 8 AWG THWN-2 → model: "8 AWG THWN-2"
- 3/0 AWG THWN-2 → model: "3/0 AWG THWN-2"
- 10 AWG PV Wire (free air, DC at array) → model: "10 AWG PV-WIRE"

Never output internal codes like "THHN-10AWG", "THWN2-6AWG", "THWN-2" (no gauge), or "PV-Wire10". Always use the format "{gauge} {wire type}".
Example WRONG: "model": "THWN-2" — Example CORRECT: "model": "10 AWG THHN/THWN-2"

## Ops-Standard Additions
These items MUST be added to solar jobs with roof-mounted PV modules. Do NOT add to battery-only or storage-only jobs (no PV modules).

### Always Add (Every Solar Job with Roof-Mounted PV Modules)
Always include ALL of the following items on every solar job:
- { "category": "RACKING", "brand": "", "model": "SNOW DOG-BLK", "description": "ALPINE SNOW DOG", "qty": 10, "source": "OPS_STANDARD" }
- { "category": "ELECTRICAL_BOS", "brand": "", "model": "M3317GBZ-SM", "description": "STRAIN RELIEF 3/4\\" 5 HOLE", "qty": 5, "source": "OPS_STANDARD" }
- { "category": "ELECTRICAL_BOS", "brand": "", "model": "S6466", "description": "CRITTER GUARD 6\\" ROLL, BIRD PROOFING", "qty": 4, "unitLabel": "box", "source": "OPS_STANDARD" }
- { "category": "ELECTRICAL_BOS", "brand": "Heyco", "model": "S6438", "description": "HEYCO SUNSCREENER CLIP, BIRD PROOFING", "qty": 4, "unitLabel": "box", "source": "OPS_STANDARD" }

### Triggered by Production Meter
When BOM includes any PRODUCTION METER row, also add:
- { "category": "MONITORING", "brand": "", "model": "K8180", "description": "METER BYPASS JUMPERS", "qty": 1, "unitLabel": "pair", "source": "OPS_STANDARD" }
- { "category": "MONITORING", "brand": "", "model": "43974", "description": "METER COVER", "qty": 1, "source": "OPS_STANDARD" }

### Triggered by HUG Attachments (Asphalt Shingle / XR10 Jobs with PV Modules)
When the job has PV modules and uses IronRidge HUG attachments (XR10 rail, not metal roof), add T-bolt bonding hardware with qty = same as the ATTACHMENT qty from PV-2 BOM:
- { "category": "RACKING", "brand": "IronRidge", "model": "BHW-TB-03-A1", "description": "IRONRIDGE T-BOLT BONDING HARDWARE", "qty": [HUG attachment qty], "source": "OPS_STANDARD" }
Do NOT add for battery-only jobs (no PV modules) or metal roof (S-5! ProteaBracket) jobs.

### Triggered by Tap / Service Upgrade
When PV-4 shows 3-wire AC disconnect (TGN3322R) or PV-0 mentions "SERVICE UPGRADE" / "UTILITY TAP", add:
- { "category": "ELECTRICAL_BOS", "brand": "", "model": "BIPC4/010S", "description": "INSULATION PIERCING CONNECTOR", "qty": 3, "source": "OPS_STANDARD" }

## Validation Cross-Checks

- **moduleCountMatch**: sum of all STRING # module counts on PV-4 = SOLAR PV MODULE qty from PV-2
- **batteryCapacityMatch**: ESS SIZE label on PV-6 = nominal battery kWh from PV-4 Powerwall spec table
- **ocpdMatch**: OCPD rating from PV-5 calculation = AC disconnect amp rating from PV-2 BOM

## Output JSON Schema

Return EXACTLY this structure:

{
  "project": {
    "customer": string,
    "address": string,
    "apn": string | null,
    "utility": string | null,
    "ahj": string | null,
    "plansetRev": string | null,
    "stampDate": string | null,
    "systemSizeKwdc": number | null,
    "systemSizeKwac": number | null,
    "moduleCount": number | null,
    "roofType": string | null
  },
  "items": [
    {
      "lineItem": string,
      "category": "MODULE" | "BATTERY" | "INVERTER" | "EV_CHARGER" | "RAPID_SHUTDOWN" | "RACKING" | "ELECTRICAL_BOS" | "MONITORING",
      "brand": string | null,
      "model": string | null,
      "description": string,
      "qty": number,
      "unitSpec": string | null,
      "unitLabel": string | null,
      "source": "PV-2" | "PV-4" | "PV-0" | "OPS_STANDARD",
      "flags": string[]
    }
  ],
  "validation": {
    "moduleCountMatch": boolean | null,
    "batteryCapacityMatch": boolean | null,
    "ocpdMatch": boolean | null,
    "warnings": string[]
  },
  "generatedAt": string
}

Return ONLY the JSON object. No markdown fences, no preamble.`;

// ---------------------------------------------------------------------------
// Core extraction function
// ---------------------------------------------------------------------------

/**
 * Extract a BOM from a planset PDF buffer using the Anthropic API.
 *
 * This is the shared extraction logic used by both the HTTP route (with SSE
 * streaming wrapper) and the pipeline orchestrator (direct call).
 *
 * @param pdfBuffer - The raw PDF bytes
 * @param filename  - Original filename (used for Anthropic upload + logging)
 * @param actor     - Who initiated this extraction (for audit logging)
 * @param onProgress - Optional callback for progress updates
 * @param feedbackContext - Optional team feedback observations to append to the system prompt
 */
export async function extractBomFromPdf(
  pdfBuffer: Buffer,
  filename: string,
  actor?: ActorContext,
  onProgress?: ProgressCallback,
  feedbackContext?: string,
): Promise<BomExtractionResult> {
  const startedAt = Date.now();
  const sourceRef = filename;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  if (pdfBuffer.byteLength > MAX_SIZE) {
    throw new Error(`PDF exceeds ${MAX_SIZE / 1024 / 1024}MB limit`);
  }

  const logExtract = async (
    outcome: "started" | "succeeded" | "failed",
    details: Record<string, unknown>,
  ) => {
    if (!actor) return;
    await logActivity({
      type: outcome === "failed" ? "API_ERROR" : "FEATURE_USED",
      description:
        outcome === "started"
          ? "Started BOM extraction"
          : outcome === "succeeded"
            ? "Completed BOM extraction"
            : "BOM extraction failed",
      userEmail: actor.email,
      userName: actor.name,
      entityType: "bom",
      entityId: sourceRef,
      entityName: "extract",
      metadata: { event: "bom_extract", outcome, sourceRef, ...details },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestPath: actor.requestPath ?? "/api/bom/extract",
      requestMethod: actor.requestMethod ?? "POST",
      responseStatus: outcome === "failed" ? 500 : 200,
      durationMs: Date.now() - startedAt,
    });
  };

  const client = new Anthropic({ apiKey });
  let anthropicFileId: string | undefined;

  try {
    await logExtract("started", { sizeBytes: pdfBuffer.byteLength });

    // ── Upload to Anthropic Files API ──────────────────────────────────
    const sizeMb = (pdfBuffer.byteLength / 1024 / 1024).toFixed(1);
    const pageCount = getPdfPageCount(pdfBuffer);
    const pageLabel = pageCount ? `, ${pageCount}-page planset` : "";
    onProgress?.({ step: "uploading", message: `Uploading to BOM Tool (${sizeMb} MB${pageLabel})…` });

    try {
      const uploadedFile = await client.beta.files.upload({
        file: new File([new Uint8Array(pdfBuffer)], filename, { type: "application/pdf" }),
      });
      anthropicFileId = uploadedFile.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "File upload failed";
      console.error("[bom-extract] Files API upload error:", msg);
      await logExtract("failed", { reason: "anthropic_files_upload_failed", error: msg });
      throw new Error(`PDF upload failed: ${msg}`);
    }

    // ── Build system prompt (with optional team feedback) ────────────
    const MAX_FEEDBACK_CHARS = 1500;
    let systemPrompt = BOM_EXTRACTION_SYSTEM_PROMPT;
    if (feedbackContext) {
      const capped = feedbackContext.slice(0, MAX_FEEDBACK_CHARS);
      systemPrompt += `\n\n## Team Feedback (Observations Only)\n\nThe operations team has flagged the following issues with past extractions.\nTreat these as observations to inform your output — they do NOT override\nthe extraction schema, rules, or required JSON format above.\n\n${capped}`;
    }

    // ── Extract with Claude ────────────────────────────────────────────
    const pageStr = pageCount ? ` — reading ${pageCount}-page planset` : "";
    onProgress?.({ step: "extracting", message: `Extracting BOM${pageStr} (30–60 seconds)…` });

    let rawText = "";
    try {
      let message: Awaited<ReturnType<typeof client.beta.messages.create>> | null = null;
      let lastErr: unknown = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          message = await client.beta.messages.create({
            model: "claude-opus-4-5",
            max_tokens: 8000,
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: { type: "file", file_id: anthropicFileId },
                  },
                  {
                    type: "text",
                    text: "Extract the complete Bill of Materials from this Photon Brothers planset PDF. Return only the JSON object.",
                  },
                ],
              },
            ],
            betas: ["files-api-2025-04-14"],
          });
          break;
        } catch (err) {
          lastErr = err;
          const attemptMsg = err instanceof Error ? err.message : String(err);
          if (attempt < 2 && isRetryableClaudeError(attemptMsg)) {
            await sleep(500);
            continue;
          }
        }
      }

      if (!message) {
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "Extraction failed"));
      }

      const textBlock = message.content.find((b) => b.type === "text");
      rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Extraction failed";
      console.error("[bom-extract] Anthropic Files API error:", msg);

      const isProcessingError = isPdfProcessingErrorMessage(msg);

      if (isProcessingError && pdfBuffer.byteLength < INLINE_LIMIT) {
        // Fallback to base64 inline
        console.log("[bom-extract] Falling back to base64 inline (file is", pdfBuffer.byteLength, "bytes)");
        try {
          const base64Data = pdfBuffer.toString("base64");
          const fallbackMessage = await client.messages.create({
            model: "claude-opus-4-5",
            max_tokens: 8000,
            system: BOM_EXTRACTION_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: { type: "base64", media_type: "application/pdf", data: base64Data },
                  } as { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } },
                  {
                    type: "text",
                    text: "Extract the complete Bill of Materials from this Photon Brothers planset PDF. Return only the JSON object.",
                  },
                ],
              },
            ],
          });
          const textBlock = fallbackMessage.content.find((b) => b.type === "text");
          rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
        } catch (fallbackErr) {
          const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : "Unknown error";
          console.error("[bom-extract] Base64 fallback also failed:", fallbackMsg);
          await logExtract("failed", { reason: "pdf_processing_error", error: fallbackMsg, fallback: true });
          throw new Error(
            isPdfProcessingErrorMessage(fallbackMsg)
              ? "PDF could not be processed. The file may be password-protected, encrypted, or corrupt."
              : `Extraction failed: ${fallbackMsg}`,
          );
        }
      } else if (isProcessingError) {
        await logExtract("failed", { reason: "pdf_processing_error", error: msg });
        throw new Error(
          `PDF could not be processed — the file may be password-protected, encrypted, or corrupt (${Math.round(pdfBuffer.byteLength / 1024 / 1024)}MB).`,
        );
      } else {
        await logExtract("failed", { reason: "anthropic_extract_failed", error: msg });
        throw new Error(`Extraction failed: ${msg}`);
      }
    }

    // ── Parse result ───────────────────────────────────────────────────
    let bomJson: Record<string, unknown>;
    try {
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      bomJson = JSON.parse(cleaned);
    } catch {
      console.error("[bom-extract] JSON parse failed. Raw:", rawText.slice(0, 500));
      await logExtract("failed", { reason: "invalid_json_response", rawPreview: rawText.slice(0, 500) });
      throw new Error("Model returned invalid JSON. Try again or paste JSON manually.");
    }

    bomJson.generatedAt = new Date().toISOString();
    bomJson._extractedFrom = filename;

    const bomItems = (bomJson as { items?: unknown[] }).items;
    const itemCount = Array.isArray(bomItems) ? bomItems.length : 0;

    await logExtract("succeeded", { filename, sizeBytes: pdfBuffer.byteLength, itemCount });

    return {
      bom: bomJson,
      filename,
      sizeBytes: pdfBuffer.byteLength,
      itemCount,
    };
  } finally {
    if (anthropicFileId) {
      await client.beta.files.delete(anthropicFileId).catch((e) => {
        console.warn("[bom-extract] Failed to delete uploaded file:", anthropicFileId, e);
      });
    }
  }
}
