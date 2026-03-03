/**
 * AI-Powered Design Review
 *
 * Claude vision review that reads planset PDFs and cross-references against
 * AHJ requirements, utility requirements, and deal properties.
 *
 * Only loaded when AI_DESIGN_REVIEW_ENABLED=true (dynamically imported by runner.ts).
 *
 * Flow:
 *   1. Fetch AHJ + utility requirements from HubSpot custom objects
 *   2. Find + download planset PDF from Google Drive
 *   3. Upload PDF to Anthropic Files API
 *   4. Call Claude Sonnet with structured output (submit_findings tool)
 *   5. Clean up uploaded file
 *   6. Return ReviewResult
 */

import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import {
  extractFolderId,
  listPlansetPdfs,
  pickBestPlanset,
  downloadDrivePdf,
} from "@/lib/drive-plansets";
import { fetchAHJsForDeal, fetchUtilitiesForDeal } from "@/lib/hubspot-custom-objects";
import type { ReviewResult, Finding, Severity } from "./types";

// ---------------------------------------------------------------------------
// Context field whitelists — keep token budget small
// ---------------------------------------------------------------------------

const AHJ_FIELDS = [
  "name",
  "fire_setback_ridge",
  "fire_setback_hip",
  "fire_setback_valley",
  "fire_setback_eave",
  "fire_setback_rake",
  "fire_setback_pathway",
  "rsd_required",
  "stamping_required",
  "snow_load",
  "wind_speed",
  "building_code",
  "electrical_code",
  "fire_code",
  "code_version",
  "notes",
] as const;

const UTILITY_FIELDS = [
  "name",
  "ac_disconnect_required",
  "backup_switch_allowed",
  "production_meter_required",
  "system_size_max_ac",
  "system_size_max_dc",
  "design_notes",
  "interconnection_notes",
] as const;

const DEAL_CONTEXT_FIELDS = [
  "dealname",
  "system_size_kw",
  "module_type",
  "module_count",
  "inverter_type",
  "battery_type",
  "battery_count",
  "roof_type",
  "pb_location",
  "design_status",
] as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max PDF size for base64 inline fallback (45MB — same as bom-extract). */
const INLINE_LIMIT = 45 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect Anthropic "Could not process PDF" errors (password-protected, corrupt, etc.). */
function isPdfProcessingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not process pdf") ||
    normalized.includes("password") ||
    normalized.includes("encrypted") ||
    normalized.includes("corrupt")
  );
}

/** Pick whitelisted fields from a properties bag, dropping nulls/empty. */
function pickFields(
  properties: Record<string, string | null>,
  fields: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of fields) {
    const val = properties[key];
    if (val != null && val.trim() !== "") {
      result[key] = val.trim();
    }
  }
  return result;
}

/** Resolve the design folder ID from deal properties (same cascade as BOM pipeline). */
function getDesignFolderId(properties: Record<string, string | null>): string | null {
  const raw = String(
    properties.design_documents ||
    properties.design_document_folder_id ||
    properties.all_document_parent_folder_id ||
    "",
  ).trim();
  if (!raw) return null;
  return extractFolderId(raw);
}

// ---------------------------------------------------------------------------
// Structured output tool schema
// ---------------------------------------------------------------------------

const SUBMIT_FINDINGS_TOOL = {
  name: "submit_findings" as const,
  description: "Submit the design review findings after analyzing the planset",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            check: {
              type: "string" as const,
              description:
                "Category: ahj_compliance | utility_compliance | equipment_match | completeness",
            },
            severity: {
              type: "string" as const,
              enum: ["error", "warning", "info"],
              description:
                "error = must fix before install, warning = should review, info = observation",
            },
            message: {
              type: "string" as const,
              description:
                "Specific finding with page/section reference from the planset when applicable",
            },
            field: {
              type: "string" as const,
              description: "Optional: the specific field or requirement this relates to",
            },
          },
          required: ["check", "severity", "message"],
        },
      },
    },
    required: ["findings"],
  },
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are a solar design reviewer for Photon Brothers, a residential solar installation company in Colorado.

Your job is to review a planset PDF and cross-reference it against:
1. AHJ (Authority Having Jurisdiction) requirements
2. Utility requirements
3. Deal/equipment properties from the CRM

## Review Categories

**ahj_compliance** — Check the planset against AHJ requirements:
- Fire setbacks: verify the planset shows required setbacks from ridge, hip, valley, eave, rake, and pathway if the AHJ requires them
- RSD (Rapid Shutdown): verify RSD compliance is shown if required by AHJ
- Stamping: verify PE stamp is present if required by AHJ
- Snow load and wind speed: verify structural details account for local requirements
- Code references: verify the planset references the correct building, electrical, and fire codes

**utility_compliance** — Check against utility requirements:
- AC disconnect: verify shown on line diagram if required by utility
- Production meter: verify shown if required by utility
- System size: verify system size is within utility maximum (AC and/or DC)
- Backup switch: verify shown if battery system includes backup

**equipment_match** — Cross-reference planset against CRM deal data:
- Module count and type: does the planset match what's in the CRM?
- Inverter type: does the planset match?
- Battery type and count: does the planset match?

**completeness** — General planset quality:
- Single-line diagram present and legible
- Site plan / roof layout present
- Structural details shown (attachment method, racking)
- Electrical details (wire sizing, conduit runs, panel schedules)

## Severity Guidelines

- **error**: Must be fixed before installation. Missing required elements, code violations, equipment mismatches.
- **warning**: Should be reviewed by designer. Potentially missing info, unclear details, minor discrepancies.
- **info**: Observation only. Nice-to-know items, suggestions for improvement.

## Important Rules

- Reference specific pages or sections from the planset when possible (e.g., "Page 3, Line Diagram")
- If AHJ or utility data is not provided, skip those checks and note it as info
- If the planset is unclear or pages are hard to read, note it as a warning
- Be specific and actionable — vague findings are not helpful
- If everything looks good for a category, you may include an info finding noting compliance
- Always call the submit_findings tool with your results`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runDesignReview(
  dealId: string,
  properties: Record<string, string | null>,
  /** Optional heartbeat callback — called at major milestones to prevent stale-run recovery. */
  onHeartbeat?: () => Promise<void>,
): Promise<ReviewResult> {
  const start = Date.now();
  const client = getAnthropicClient();
  const heartbeat = onHeartbeat ?? (() => Promise.resolve());
    // ── Step 1: Fetch AHJ + utility requirements ──
    const [ahjRecords, utilityRecords] = await Promise.all([
      fetchAHJsForDeal(dealId).catch((err) => {
        console.warn("[design-review-ai] Failed to fetch AHJs:", err);
        return [];
      }),
      fetchUtilitiesForDeal(dealId).catch((err) => {
        console.warn("[design-review-ai] Failed to fetch utilities:", err);
        return [];
      }),
    ]);

    const ahjContext = ahjRecords.map((r) => pickFields(r.properties, AHJ_FIELDS));
    const utilityContext = utilityRecords.map((r) => pickFields(r.properties, UTILITY_FIELDS));
    const dealContext = pickFields(properties, DEAL_CONTEXT_FIELDS);

    await heartbeat(); // milestone: context fetched

    // ── Step 2: Find + download planset PDF ──
    const folderId = getDesignFolderId(properties);
    if (!folderId) {
      return makeErrorResult(dealId, start, "completeness", "error",
        "No design folder found on deal — cannot locate planset PDF. " +
        "Ensure design_documents or design_document_folder_id is set in HubSpot.");
    }

    const pdfFiles = await listPlansetPdfs(folderId);
    if (pdfFiles.length === 0) {
      return makeErrorResult(dealId, start, "completeness", "error",
        `No PDF files found in Drive folder ${folderId}.`);
    }

    const selectedFile = pickBestPlanset(pdfFiles);
    if (!selectedFile) {
      return makeErrorResult(dealId, start, "completeness", "error",
        "Could not select a planset PDF from available files.");
    }

    console.log(
      `[design-review-ai] Deal ${dealId}: selected "${selectedFile.name}" ` +
      `(${selectedFile.size ? Math.round(Number(selectedFile.size) / 1024) + "KB" : "size unknown"}) ` +
      `from ${pdfFiles.length} PDF${pdfFiles.length !== 1 ? "s" : ""} in folder`,
    );

    const { buffer, filename } = await downloadDrivePdf(selectedFile.id);

    await heartbeat(); // milestone: PDF downloaded

    // ── Step 3: Upload PDF to Anthropic Files API ──
    let anthropicFileId: string | undefined;
    try {
      const uploadedFile = await client.beta.files.upload({
        file: new File([new Uint8Array(buffer)], filename, { type: "application/pdf" }),
      });
      anthropicFileId = uploadedFile.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "File upload failed";
      console.error("[design-review-ai] Files API upload error:", msg);
      return makeErrorResult(dealId, start, "completeness", "error",
        `Failed to upload planset PDF for AI review: ${msg}`);
    }

    // ── Step 4: Call Claude with structured output (Files API reference) ──
    const userMessage = buildUserMessage(dealContext, ahjContext, utilityContext, filename);

    const claudeParams = {
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 4096,
      system: buildSystemPrompt(),
      tools: [SUBMIT_FINDINGS_TOOL],
      tool_choice: { type: "tool", name: "submit_findings" } as never,
    };

    let response;
    try {
      response = await client.beta.messages.create({
        ...claudeParams,
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
                text: userMessage,
              },
            ],
          },
        ],
        betas: ["files-api-2025-04-14"],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Claude API call failed";
      console.error("[design-review-ai] Claude API error:", msg);

      // Clean up uploaded file before fallback/error
      if (anthropicFileId) {
        await client.beta.files.delete(anthropicFileId).catch(() => {});
        anthropicFileId = undefined;
      }

      // Fallback: retry with base64 inline if it's a PDF processing error and file is small enough
      if (isPdfProcessingError(msg) && buffer.byteLength < INLINE_LIMIT) {
        console.log(
          `[design-review-ai] Falling back to base64 inline (${Math.round(buffer.byteLength / 1024)}KB)`,
        );
        try {
          const base64Data = Buffer.from(buffer).toString("base64");
          response = await client.messages.create({
            ...claudeParams,
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
                    text: userMessage,
                  },
                ],
              },
            ],
          });
        } catch (fallbackErr) {
          const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : "Unknown error";
          console.error("[design-review-ai] Base64 fallback also failed:", fallbackMsg);
          return makeErrorResult(dealId, start, "completeness", "error",
            isPdfProcessingError(fallbackMsg)
              ? "PDF could not be processed. The file may be password-protected, encrypted, or corrupt."
              : `AI review failed: ${fallbackMsg}`);
        }
      } else if (isPdfProcessingError(msg)) {
        return makeErrorResult(dealId, start, "completeness", "error",
          `PDF could not be processed — the file may be password-protected, encrypted, or corrupt (${Math.round(buffer.byteLength / 1024 / 1024)}MB).`);
      } else {
        return makeErrorResult(dealId, start, "completeness", "error",
          `AI review failed: ${msg}`);
      }
    }

    // Clean up uploaded file (best-effort)
    if (anthropicFileId) {
      await client.beta.files.delete(anthropicFileId).catch((e) => {
        console.warn("[design-review-ai] Failed to delete uploaded file:", anthropicFileId, e);
      });
    }

    await heartbeat(); // milestone: Claude response received

    // ── Step 5: Extract findings from tool use response ──
    const toolBlock = response.content.find(
      (block): block is Extract<typeof block, { type: "tool_use" }> =>
        block.type === "tool_use" && block.name === "submit_findings",
    );

    if (!toolBlock) {
      return makeErrorResult(dealId, start, "completeness", "error",
        "AI review did not return structured findings (no tool use in response). " +
        "This may indicate a model issue — retry or check logs.");
    }

    const input = toolBlock.input as { findings?: unknown[] };
    const rawFindings = Array.isArray(input.findings) ? input.findings : [];

    const findings: Finding[] = rawFindings
      .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
      .filter((f) => typeof f.check === "string" && f.check.length > 0 && typeof f.message === "string" && f.message.length > 0)
      .map((f) => ({
        check: String(f.check),
        severity: validateSeverity(f.severity),
        message: String(f.message),
        ...(f.field ? { field: String(f.field) } : {}),
      }));

    // Guard: empty findings after validation means the model returned garbage —
    // treat as an error rather than a false pass.
    if (findings.length === 0) {
      return makeErrorResult(dealId, start, "completeness", "error",
        "AI review returned zero valid findings — model output may be malformed. " +
        "Raw tool input had " + rawFindings.length + " entries before validation.");
    }

    const errorCount = findings.filter((f) => f.severity === "error").length;
    const warningCount = findings.filter((f) => f.severity === "warning").length;

    return {
      skill: "design-review",
      dealId,
      findings,
      errorCount,
      warningCount,
      passed: errorCount === 0,
      durationMs: Date.now() - start,
    };
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

function buildUserMessage(
  dealContext: Record<string, string>,
  ahjContext: Record<string, string>[],
  utilityContext: Record<string, string>[],
  plansetFilename: string,
): string {
  const parts: string[] = [
    `Review the attached planset PDF (${plansetFilename}) for this solar project.`,
    "",
    "## Deal Properties",
    "```json",
    JSON.stringify(dealContext, null, 2),
    "```",
  ];

  if (ahjContext.length > 0) {
    parts.push("", "## AHJ Requirements");
    for (const ahj of ahjContext) {
      parts.push("```json", JSON.stringify(ahj, null, 2), "```");
    }
  } else {
    parts.push("", "## AHJ Requirements", "No AHJ records found for this deal. Skip AHJ compliance checks.");
  }

  if (utilityContext.length > 0) {
    parts.push("", "## Utility Requirements");
    for (const util of utilityContext) {
      parts.push("```json", JSON.stringify(util, null, 2), "```");
    }
  } else {
    parts.push("", "## Utility Requirements", "No utility records found for this deal. Skip utility compliance checks.");
  }

  parts.push(
    "",
    "Analyze the planset against the above requirements and call submit_findings with your results.",
  );

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateSeverity(value: unknown): Severity {
  if (value === "error" || value === "warning" || value === "info") return value;
  return "warning"; // default to warning for unknown severities
}

function makeErrorResult(
  dealId: string,
  start: number,
  check: string,
  severity: Severity,
  message: string,
): ReviewResult {
  return {
    skill: "design-review",
    dealId,
    findings: [{ check, severity, message }],
    errorCount: severity === "error" ? 1 : 0,
    warningCount: severity === "warning" ? 1 : 0,
    passed: severity !== "error",
    durationMs: Date.now() - start,
  };
}
