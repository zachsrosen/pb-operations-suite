/**
 * BOM Extract API
 *
 * POST /api/bom/extract
 *   Accepts a multipart/form-data request with a planset PDF file.
 *   Sends it to Claude (claude-opus-4-5) with native PDF document support and
 *   the full planset-bom extraction prompt.
 *   Returns structured BOM JSON ready to load into the BOM dashboard.
 *
 * Body (multipart/form-data):
 *   file: PDF file  (max ~32MB; PB plansets are typically 3–12MB)
 *
 * Auth required: design/ops roles
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

// ── Route handler ─────────────────────────────────────────────────────────────

export const maxDuration = 120;

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

  const contentType = req.headers.get("content-type") ?? "";
  const MAX_SIZE = 32 * 1024 * 1024; // 32MB

  let pdfBase64: string;
  let filename = "planset.pdf";

  if (contentType.includes("application/json")) {
    // ── Google Drive URL path ────────────────────────────────────────────────
    let body: { driveUrl?: string; fileId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const driveUrl = body.driveUrl;
    if (!driveUrl) {
      return NextResponse.json({ error: "driveUrl is required" }, { status: 400 });
    }

    // Fetch the PDF from Drive
    let driveRes: Response;
    try {
      driveRes = await fetch(driveUrl, { redirect: "follow" });
      if (!driveRes.ok) {
        return NextResponse.json(
          { error: `Failed to download from Drive (HTTP ${driveRes.status}). Make sure the file is shared publicly.` },
          { status: 400 }
        );
      }
    } catch (e) {
      return NextResponse.json(
        { error: `Drive fetch failed: ${e instanceof Error ? e.message : String(e)}` },
        { status: 400 }
      );
    }

    const driveContentType = driveRes.headers.get("content-type") ?? "";
    if (!driveContentType.includes("pdf") && !driveContentType.includes("octet-stream")) {
      return NextResponse.json(
        { error: "Drive URL did not return a PDF. The file may not be publicly accessible or may not be a PDF." },
        { status: 400 }
      );
    }

    const arrayBuffer = await driveRes.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "PDF exceeds 32MB limit" }, { status: 400 });
    }
    pdfBase64 = Buffer.from(arrayBuffer).toString("base64");
    filename = `drive-${body.fileId ?? "planset"}.pdf`;
  } else {
    // ── Multipart file upload path ───────────────────────────────────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const fileObj = file as File;
    filename = fileObj.name ?? "planset.pdf";
    const mimeType = fileObj.type ?? "";

    if (!filename.toLowerCase().endsWith(".pdf") && mimeType !== "application/pdf") {
      return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
    }

    if (fileObj.size > MAX_SIZE) {
      return NextResponse.json({ error: "PDF exceeds 32MB limit" }, { status: 400 });
    }

    try {
      const buffer = Buffer.from(await fileObj.arrayBuffer());
      pdfBase64 = buffer.toString("base64");
    } catch {
      return NextResponse.json({ error: "Failed to read PDF" }, { status: 400 });
    }
  }

  // Call Claude with native PDF document support
  const client = new Anthropic({ apiKey });

  let rawText: string;
  try {
    const message = await client.messages.create({
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
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: "Extract the complete Bill of Materials from this Photon Brothers planset PDF. Return only the JSON object.",
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Extraction failed";
    console.error("[bom/extract] Anthropic error:", msg);
    return NextResponse.json({ error: `Extraction failed: ${msg}` }, { status: 502 });
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
