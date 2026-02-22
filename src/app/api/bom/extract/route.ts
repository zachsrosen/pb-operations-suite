/**
 * BOM Extract API
 *
 * POST /api/bom/extract
 *   Accepts a JSON body with either a Vercel Blob URL or a Google Drive URL.
 *   Downloads the planset PDF, uploads it to the Anthropic Files API (bypassing
 *   the inline base64 request-size limit), then calls Claude (claude-opus-4-5)
 *   with a file_id reference and the full planset-bom extraction prompt.
 *   Returns structured BOM JSON ready to load into the BOM dashboard.
 *
 * Body (application/json):
 *   { blobUrl: "https://..." }          ← Vercel Blob upload
 *   { driveUrl: "...", fileId: "..." }  ← Google Drive link
 *
 * Auth required: design/ops roles
 *
 * Large-PDF note:
 *   Inline base64 document blocks are limited to ~20MB by Anthropic's API.
 *   The Files API pre-uploads the PDF as a separate request so the messages
 *   call only sends a lightweight { type: "file", file_id } reference.
 *   This handles plansets up to 500MB (Anthropic's Files API limit).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import Anthropic from "@anthropic-ai/sdk";

// ── Auth ──────────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",
  "PERMITTING",
]);

// ── Extraction prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a solar engineering document analyst specializing in Photon Brothers (PB) stamped solar/storage plansets. Extract a complete Bill of Materials (BOM) from the provided PDF and return ONLY a valid JSON object — no markdown, no explanation, just the JSON.

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
6. **flags** array: use "INFERRED" when value was inferred, "ASSUMED_BRAND" when brand was assumed, "VALIDATION_WARNING" when a cross-check failed.

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
      "source": "PV-2" | "PV-4" | "PV-0",
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

// ── Route config ─────────────────────────────────────────────────────────────

export const maxDuration = 120;

// Disable Next.js body size limit — planset PDFs are typically 5–35MB and
// would be rejected by the default 4MB cap before our code runs.
export const dynamic = "force-dynamic";

// App Router: increase request body size limit to 50MB via route segment config
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Auth check
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Check Anthropic key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  }

  // 500MB — Anthropic Files API limit (much larger than the old inline limit)
  const MAX_SIZE = 500 * 1024 * 1024;

  let filename = "planset.pdf";

  // All paths go through JSON body now:
  //   { blobUrl: "https://..." }          ← Vercel Blob upload
  //   { driveUrl: "...", fileId: "..." }  ← Google Drive link
  let body: { blobUrl?: string; driveUrl?: string; fileId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceUrl = body.blobUrl ?? body.driveUrl;
  if (!sourceUrl) {
    return NextResponse.json({ error: "blobUrl or driveUrl is required" }, { status: 400 });
  }

  // Fetch the PDF from the URL (blob or Drive).
  // Blob URLs require the token header — the store is private-access only.
  const fetchHeaders: Record<string, string> = {};
  if (body.blobUrl && process.env.BLOB_READ_WRITE_TOKEN) {
    fetchHeaders["authorization"] = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
  }

  let fetchRes: Response;
  try {
    fetchRes = await fetch(sourceUrl, { redirect: "follow", headers: fetchHeaders });
    if (!fetchRes.ok) {
      return NextResponse.json(
        {
          error: body.blobUrl
            ? `Failed to read uploaded file (HTTP ${fetchRes.status})`
            : `Failed to download from Drive (HTTP ${fetchRes.status}). Make sure the file is shared publicly.`,
        },
        { status: 400 }
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  const fetchContentType = fetchRes.headers.get("content-type") ?? "";
  if (!fetchContentType.includes("pdf") && !fetchContentType.includes("octet-stream")) {
    // Google Drive may redirect to a confirmation page for large files
    if (!body.blobUrl) {
      return NextResponse.json(
        { error: "Drive URL did not return a PDF. The file may require confirmation — try downloading it and using Upload PDF instead." },
        { status: 400 }
      );
    }
  }

  const arrayBuffer = await fetchRes.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_SIZE) {
    return NextResponse.json({ error: "PDF exceeds 500MB limit" }, { status: 400 });
  }

  filename = body.blobUrl
    ? (body.blobUrl.split("/").pop() ?? "planset.pdf")
    : `drive-${body.fileId ?? "planset"}.pdf`;

  const pdfBuffer = Buffer.from(arrayBuffer);

  // ── Upload PDF to Anthropic Files API ──────────────────────────────────────
  // Using the Files API avoids base64-encoding the entire PDF inline in the
  // messages request body, which would exceed Anthropic's ~20MB request limit
  // for the 28–34MB plansets we commonly see.
  const client = new Anthropic({ apiKey });

  let fileId: string;
  try {
    const uploadedFile = await client.beta.files.upload({
      file: new File([pdfBuffer], filename, { type: "application/pdf" }),
    });
    fileId = uploadedFile.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "File upload failed";
    console.error("[bom/extract] Files API upload error:", msg);
    return NextResponse.json({ error: `PDF upload failed: ${msg}` }, { status: 502 });
  }

  // ── Call Claude referencing the uploaded file ──────────────────────────────
  let rawText: string;
  try {
    const message = await client.beta.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "file",
                file_id: fileId,
              },
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

    const textBlock = message.content.find((b) => b.type === "text");
    rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Extraction failed";
    console.error("[bom/extract] Anthropic error:", msg);
    return NextResponse.json({ error: `Extraction failed: ${msg}` }, { status: 502 });
  } finally {
    // Always delete the uploaded file — we don't need persistent storage
    await client.beta.files.delete(fileId).catch((e) => {
      console.warn("[bom/extract] Failed to delete uploaded file:", fileId, e);
    });
  }

  // Parse JSON from response (strip any accidental markdown fences)
  let bomJson: unknown;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    bomJson = JSON.parse(cleaned);
  } catch {
    console.error("[bom/extract] JSON parse failed. Raw:", rawText.slice(0, 500));
    return NextResponse.json(
      {
        error: "Model returned invalid JSON. Try again or paste JSON manually.",
        raw: rawText.slice(0, 2000),
      },
      { status: 422 }
    );
  }

  // Stamp extraction metadata
  const bom = bomJson as Record<string, unknown>;
  bom.generatedAt = new Date().toISOString();
  bom._extractedFrom = filename;

  return NextResponse.json(bom);
}
