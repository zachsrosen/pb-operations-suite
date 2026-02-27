/**
 * BOM Extract API
 *
 * POST /api/bom/extract
 *   Accepts a JSON body with either a Vercel Blob URL or a Google Drive URL.
 *   Downloads the planset PDF, uploads it to the Anthropic Files API (bypassing
 *   the inline base64 request-size limit), then calls Claude (claude-opus-4-5)
 *   with a file_id reference and the full planset-bom extraction prompt.
 *   Returns structured BOM JSON as SSE stream events.
 *
 * Body (application/json):
 *   { blobUrl: "https://..." }          ← Vercel Blob upload
 *   { driveUrl: "...", fileId: "..." }  ← Google Drive link
 *
 * Auth required: design/ops roles
 *
 * SSE Events:
 *   { type: "progress", step: string, message: string }
 *   { type: "result", bom: object }
 *   { type: "error", error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getServiceAccountToken } from "@/lib/google-auth";
import { logActivity } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { getToken } from "next-auth/jwt";

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
6. **Backup Switch part number**: 1624171-00-J (found in PV-4 callout or PV-2 BOM; used on simpler jobs without full Gateway-3 -- see active extraction rule below).
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
- If found → add: { "category": "MONITORING", "brand": "Tesla", "model": "1624171-00-J", "description": "TESLA BACKUP SWITCH", "qty": 1, "source": "PV-4" }
- If not found, omit. A job will have either a Backup Gateway-3 OR a Backup Switch, not both.

## Ops-Standard Additions
These items MUST be added to every solar (PV module) BOM even if the planset does not mention them. Do NOT add to battery-only or EV-charger-only jobs.

### Always Add (Every Solar Job with Roof-Mounted PV Modules)
Always include ALL of the following items on every solar job:
- { "category": "RACKING", "brand": "", "model": "SNOW DOG-BLK", "description": "ALPINE SNOW DOG", "qty": 10, "source": "OPS_STANDARD" }
- { "category": "ELECTRICAL_BOS", "brand": "", "model": "M3317GBZ-SM", "description": "STRAIN RELIEF 3/4\" 5 HOLE", "qty": 5, "source": "OPS_STANDARD" }
- { "category": "ELECTRICAL_BOS", "brand": "", "model": "S6466", "description": "CRITTER GUARD 6\" ROLL, BIRD PROOFING", "qty": 4, "unitLabel": "box", "source": "OPS_STANDARD" }
- { "category": "ELECTRICAL_BOS", "brand": "Heyco", "model": "S6438", "description": "HEYCO SUNSCREENER CLIP, BIRD PROOFING", "qty": 4, "unitLabel": "box", "source": "OPS_STANDARD" }

### Triggered by Production Meter
When BOM includes any PRODUCTION METER row, also add:
- { "category": "MONITORING", "brand": "", "model": "K8180", "description": "METER BYPASS JUMPERS", "qty": 1, "unitLabel": "pair", "source": "OPS_STANDARD" }
- { "category": "MONITORING", "brand": "", "model": "43974", "description": "METER COVER", "qty": 1, "source": "OPS_STANDARD" }

### Triggered by HUG Attachments (Asphalt Shingle / XR10 Jobs)
When the job uses IronRidge HUG attachments (XR10 rail, not metal roof), add T-bolt bonding hardware with qty = same as the ATTACHMENT qty from PV-2 BOM:
- { "category": "RACKING", "brand": "IronRidge", "model": "BHW-TB-03-A1", "description": "IRONRIDGE T-BOLT BONDING HARDWARE", "qty": [HUG attachment qty], "source": "OPS_STANDARD" }
Do NOT add for metal roof (S-5! ProteaBracket) jobs.

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

Return ONLY the JSON object. No markdown fences, no preamble.`

// ── Route config ─────────────────────────────────────────────────────────────

export const maxDuration = 300;

// Disable Next.js body size limit — planset PDFs are typically 5–35MB and
// would be rejected by the default 4MB cap before our code runs.
export const dynamic = "force-dynamic";

// App Router: increase request body size limit to 50MB via route segment config
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

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

function getPdfPageCount(buffer: Buffer): number | null {
  try {
    // Quick heuristic: count /Type /Page (not /Pages) entries in raw PDF bytes
    const text = buffer.toString("latin1");
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : null;
  } catch {
    return null;
  }
}

async function refreshUserToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

function isHttpsRequest(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return proto === "https";
}

async function getJwtToken(request: NextRequest): Promise<Record<string, unknown> | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  const secureFirst = isHttpsRequest(request);
  const attempts = secureFirst ? [true, false] : [false, true];

  for (const secureCookie of attempts) {
    try {
      const token = await getToken({ req: request, secret, secureCookie });
      if (token && typeof token === "object") {
        return token as Record<string, unknown>;
      }
    } catch {
      // try next cookie mode
    }
  }

  return null;
}

async function getDriveToken(request: NextRequest): Promise<{ token: string; tokenSource: string }> {
  try {
    const jwtToken = await getJwtToken(request);
    const accessToken = jwtToken?.accessToken as string | undefined;
    const expires = jwtToken?.accessTokenExpires as number | undefined;
    const refreshToken = jwtToken?.refreshToken as string | undefined;

    if (accessToken && (expires == null || Date.now() < expires - 60_000)) {
      return { token: accessToken, tokenSource: "user_oauth" };
    }

    if (refreshToken) {
      const refreshed = await refreshUserToken(refreshToken);
      if (refreshed) {
        return { token: refreshed, tokenSource: "user_oauth_refreshed" };
      }
    }
  } catch {
    // fall through to service account
  }

  const saToken = await getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
  return { token: saToken, tokenSource: "service_account" };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // ── API key ────────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  }

  // ── Body ───────────────────────────────────────────────────────────────────
  let body: { blobUrl?: string; driveUrl?: string; fileId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.blobUrl && !body.driveUrl && !body.fileId) {
    return NextResponse.json({ error: "blobUrl, driveUrl, or fileId is required" }, { status: 400 });
  }

  // ── Setup ──────────────────────────────────────────────────────────────────
  const sourceType: "blob" | "drive_url" | "drive_file" | "unknown" =
    body.fileId ? "drive_file" : body.blobUrl ? "blob" : body.driveUrl ? "drive_url" : "unknown";
  const sourceRef: string | null = body.fileId ?? body.blobUrl ?? body.driveUrl ?? null;

  const logExtract = async (
    outcome: "started" | "succeeded" | "failed",
    details: Record<string, unknown>,
    responseStatus: number
  ) => {
    await logActivity({
      type: outcome === "failed" ? "API_ERROR" : "FEATURE_USED",
      description:
        outcome === "started"
          ? "Started BOM extraction"
          : outcome === "succeeded"
            ? "Completed BOM extraction"
            : "BOM extraction failed",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: sourceRef || undefined,
      entityName: "extract",
      metadata: { event: "bom_extract", outcome, sourceType, sourceRef, ...details },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/extract",
      requestMethod: "POST",
      responseStatus,
      durationMs: Date.now() - startedAt,
    });
  };

  const client = new Anthropic({ apiKey });
  const MAX_SIZE = 500 * 1024 * 1024;
  const INLINE_LIMIT = 45 * 1024 * 1024;

  // ── Stream ─────────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed (client disconnected)
        }
      };

      let anthropicFileId: string | undefined;

      try {
        await logExtract(
          "started",
          { hasBlobUrl: !!body.blobUrl, hasDriveUrl: !!body.driveUrl, hasFileId: !!body.fileId },
          200
        );

        // ── Stage 1: Download PDF ──────────────────────────────────────────
        const downloadMsg = body.fileId
          ? "Downloading PDF from Google Drive…"
          : body.blobUrl
            ? "Fetching uploaded PDF…"
            : "Downloading PDF…";
        send({ type: "progress", step: "downloading", message: downloadMsg });

        let fetchRes: Response;
        try {
          if (body.fileId) {
            const { token, tokenSource } = await getDriveToken(req);
            const driveMediaUrl =
              `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.fileId)}` +
              `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;

            fetchRes = await fetch(driveMediaUrl, {
              redirect: "follow",
              headers: { Authorization: `Bearer ${token}` },
            });

            if (!fetchRes.ok) {
              const driveErr = await fetchRes.json().catch(() => ({})) as { error?: { message?: string } };
              const msg = driveErr.error?.message ?? `HTTP ${fetchRes.status}`;
              await logExtract("failed", { reason: "drive_download_failed", error: msg }, 400);
              send({ type: "error", error: `Failed to download Drive file (${msg})` });
              return;
            }
            void tokenSource; // used for logging in original, keep reference
          } else {
            const sourceUrl = body.blobUrl ?? body.driveUrl!;
            const fetchHeaders: Record<string, string> = {};
            if (body.blobUrl && process.env.BLOB_READ_WRITE_TOKEN) {
              fetchHeaders["authorization"] = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
            }
            fetchRes = await fetch(sourceUrl, { redirect: "follow", headers: fetchHeaders });
            if (!fetchRes.ok) {
              await logExtract("failed", { reason: "source_fetch_failed", sourceUrl, status: fetchRes.status }, 400);
              send({
                type: "error",
                error: body.blobUrl
                  ? `Failed to read uploaded file (HTTP ${fetchRes.status})`
                  : `Failed to download from Drive (HTTP ${fetchRes.status}). Make sure the file is shared publicly.`,
              });
              return;
            }
          }
        } catch (e) {
          await logExtract("failed", { reason: "source_fetch_exception", error: e instanceof Error ? e.message : String(e) }, 400);
          send({ type: "error", error: `Fetch failed: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }

        const fetchContentType = fetchRes.headers.get("content-type") ?? "";
        if (!fetchContentType.includes("pdf") && !fetchContentType.includes("octet-stream")) {
          if (!body.blobUrl && !body.fileId) {
            await logExtract("failed", { reason: "drive_not_pdf", contentType: fetchContentType }, 400);
            send({ type: "error", error: "Drive URL did not return a PDF. The file may require confirmation — try downloading it and using Upload PDF instead." });
            return;
          }
        }

        const arrayBuffer = await fetchRes.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_SIZE) {
          await logExtract("failed", { reason: "pdf_too_large", sizeBytes: arrayBuffer.byteLength }, 400);
          send({ type: "error", error: "PDF exceeds 500MB limit" });
          return;
        }

        const filename = body.blobUrl
          ? (body.blobUrl.split("/").pop() ?? "planset.pdf")
          : `drive-${body.fileId ?? "planset"}.pdf`;

        const pdfBuffer = Buffer.from(arrayBuffer);

        // ── Stage 2: Upload to Anthropic Files API ─────────────────────────
        const sizeMb = (pdfBuffer.byteLength / 1024 / 1024).toFixed(1);
        const pageCountEarly = getPdfPageCount(pdfBuffer);
        const pageLabel = pageCountEarly ? `, ${pageCountEarly}-page planset` : "";
        send({ type: "progress", step: "uploading", message: `Uploading to BOM Tool (${sizeMb} MB${pageLabel})…` });

        try {
          const uploadedFile = await client.beta.files.upload({
            file: new File([pdfBuffer], filename, { type: "application/pdf" }),
          });
          anthropicFileId = uploadedFile.id;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "File upload failed";
          console.error("[bom/extract] Files API upload error:", msg);
          await logExtract("failed", { reason: "anthropic_files_upload_failed", error: msg, filename }, 502);
          send({ type: "error", error: `PDF upload failed: ${msg}` });
          return;
        }

        // ── Stage 3: Extract with Claude ───────────────────────────────────
        const pageStr = pageCountEarly ? ` — reading ${pageCountEarly}-page planset` : "";
        send({ type: "progress", step: "extracting", message: `Extracting BOM${pageStr} (30–60 seconds)…` });

        let rawText = "";
        try {
          let message: Awaited<ReturnType<typeof client.beta.messages.create>> | null = null;
          let lastErr: unknown = null;

          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              message = await client.beta.messages.create({
                model: "claude-opus-4-5",
                max_tokens: 8000,
                system: SYSTEM_PROMPT,
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
          console.error("[bom/extract] Anthropic Files API error:", msg);

          const isProcessingError = isPdfProcessingErrorMessage(msg);

          if (isProcessingError && pdfBuffer.byteLength < INLINE_LIMIT) {
            console.log("[bom/extract] Falling back to base64 inline (file is", pdfBuffer.byteLength, "bytes)");
            try {
              const base64Data = pdfBuffer.toString("base64");
              const fallbackMessage = await client.messages.create({
                model: "claude-opus-4-5",
                max_tokens: 8000,
                system: SYSTEM_PROMPT,
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
              console.error("[bom/extract] Base64 fallback also failed:", fallbackMsg);
              await logExtract("failed", { reason: "pdf_processing_error", error: fallbackMsg, fallback: true }, 422);
              send({
                type: "error",
                error: isPdfProcessingErrorMessage(fallbackMsg)
                  ? "PDF could not be processed. The file may be password-protected, encrypted, or corrupt. Try re-saving or flattening the PDF and uploading again."
                  : `Extraction failed: ${fallbackMsg}`,
              });
              return;
            }
          } else if (isProcessingError) {
            await logExtract("failed", { reason: "pdf_processing_error", error: msg }, 422);
            send({
              type: "error",
              error: `PDF could not be processed — the file may be password-protected, encrypted, or corrupt (${Math.round(pdfBuffer.byteLength / 1024 / 1024)}MB). Try re-saving or flattening the PDF and uploading again.`,
            });
            return;
          } else {
            await logExtract("failed", { reason: "anthropic_extract_failed", error: msg }, 502);
            send({ type: "error", error: `Extraction failed: ${msg}` });
            return;
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
          console.error("[bom/extract] JSON parse failed. Raw:", rawText.slice(0, 500));
          await logExtract("failed", { reason: "invalid_json_response", rawPreview: rawText.slice(0, 500) }, 422);
          send({ type: "error", error: "Model returned invalid JSON. Try again or paste JSON manually." });
          return;
        }

        bomJson.generatedAt = new Date().toISOString();
        bomJson._extractedFrom = filename;

        const bomItems = (bomJson as { items?: unknown[] }).items;
        await logExtract(
          "succeeded",
          { filename, sizeBytes: pdfBuffer.byteLength, itemCount: Array.isArray(bomItems) ? bomItems.length : null },
          200
        );

        send({ type: "result", bom: bomJson });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Internal server error";
        console.error("[bom/extract] Unhandled stream error:", msg, e);
        await logExtract("failed", { reason: "unhandled_exception", error: msg }, 500).catch(() => {});
        send({ type: "error", error: msg });
      } finally {
        if (anthropicFileId) {
          await client.beta.files.delete(anthropicFileId).catch((e) => {
            console.warn("[bom/extract] Failed to delete uploaded file:", anthropicFileId, e);
          });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
