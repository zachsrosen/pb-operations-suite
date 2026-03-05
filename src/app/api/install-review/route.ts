/**
 * POST /api/install-review
 *
 * Compare install photos against the permitted planset to verify
 * the installed equipment matches what was approved.
 *
 * Accepts:
 *   { dealId: string }           — looks up Zuper job + fetches photos
 *   { jobUid: string }           — direct Zuper job UID
 *   { dealId, photoUrls: [...] } — manual photo URLs (fallback)
 *
 * Returns a structured pass/fail report per equipment category.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import { ZuperClient } from "@/lib/zuper";
import { getDealProperties } from "@/lib/hubspot";
import {
  extractFolderId,
  listPlansetPdfs,
  pickBestPlanset,
  downloadDrivePdf,
} from "@/lib/drive-plansets";
import { handleLookup as zuperJobLookup } from "@/app/api/zuper/jobs/lookup/route";

// Allow up to 2 minutes for AI vision review (planset + photos can be large)
export const maxDuration = 120;
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InstallReviewRequest {
  dealId?: string;
  jobUid?: string;
  photoUrls?: string[]; // Manual upload fallback
}

interface InstallFinding {
  category: string;
  status: "pass" | "fail" | "unable_to_verify";
  planset_spec: string;
  observed: string;
  notes: string;
}

interface InstallReviewResult {
  findings: InstallFinding[];
  overall_pass: boolean;
  summary: string;
  photo_count: number;
  planset_filename: string;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Deal properties needed for planset lookup + equipment context
// ---------------------------------------------------------------------------

const DEAL_PROPERTIES = [
  "dealname",
  "design_documents",
  "design_document_folder_id",
  "all_document_parent_folder_id",
  "system_size_kw",
  "module_type",
  "module_count",
  "inverter_type",
  "battery_type",
  "battery_count",
  "roof_type",
  "pb_location",
];

// ---------------------------------------------------------------------------
// Structured tool schema for Claude
// ---------------------------------------------------------------------------

const SUBMIT_INSTALL_REVIEW_TOOL = {
  name: "submit_install_review" as const,
  description: "Submit the install photo review findings after comparing photos to planset",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            category: {
              type: "string" as const,
              enum: ["modules", "inverter", "battery", "racking", "electrical", "labels"],
              description: "Equipment category being verified",
            },
            status: {
              type: "string" as const,
              enum: ["pass", "fail", "unable_to_verify"],
              description:
                "pass = matches planset, fail = mismatch found, unable_to_verify = not visible in photos",
            },
            planset_spec: {
              type: "string" as const,
              description: "What the planset specifies for this category (model, count, etc.)",
            },
            observed: {
              type: "string" as const,
              description: "What is visible/observed in the install photos",
            },
            notes: {
              type: "string" as const,
              description: "Details about the match or mismatch, or why verification was not possible",
            },
          },
          required: ["category", "status", "planset_spec", "observed", "notes"],
        },
      },
      overall_pass: {
        type: "boolean" as const,
        description: "True if all categories are pass or unable_to_verify (no fails)",
      },
      summary: {
        type: "string" as const,
        description: "Brief overall summary of the review (2-3 sentences)",
      },
    },
    required: ["findings", "overall_pass", "summary"],
  },
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are a solar installation quality reviewer for Photon Brothers, a residential solar company in Colorado.

Your job is to compare install photos against the permitted planset to verify the correct equipment was installed.

## Review Categories

**modules** — Solar panel verification:
- Count the visible panels in photos and compare to planset module count
- Check if panel make/model is visible on nameplates and matches planset
- Note array layout and orientation if visible

**inverter** — Inverter verification:
- Look for inverter nameplate showing make/model
- Compare against planset SLD (single-line diagram)
- For microinverters (Enphase), they may not be individually visible

**battery** — Battery/ESS verification:
- Look for battery unit(s) — typically Tesla Powerwall 3 or Enphase
- Verify count matches planset
- Check for gateway/controller if specified

**racking** — Mounting system verification:
- Look for visible racking type (roof attachments, rails)
- Compare attachment method against planset (e.g., IronRidge XR10/XR100, flashings, L-feet, S-5! clamps)
- Note roof type compatibility

**electrical** — Electrical BOS verification:
- AC disconnect present if shown on planset
- Conduit runs visible and reasonable
- Main panel/breaker visible if shown
- Backup switch / transfer switch if specified

**labels** — Required labels and signage:
- NEC 690 warning labels on DC disconnect, combiner, main panel
- ESS warning labels if battery present
- Rapid shutdown labels if applicable

## Status Guidelines

- **pass**: Equipment clearly matches planset specification. Nameplate/count verified.
- **fail**: Clear mismatch — wrong equipment model, wrong count, missing required component.
- **unable_to_verify**: Photos don't show this component clearly enough to confirm. This is NOT a failure — it means the photos provided don't cover this category.

## Important Rules

- Be factual and specific. Reference what you can see in each photo.
- If a nameplate is partially visible or blurry, mark unable_to_verify with a note.
- Module count should be verified by counting visible panels, not assumed.
- For microinverter systems, the inverter category may be unable_to_verify (they're under panels).
- If the planset doesn't specify a component (e.g., no battery), skip that category or mark pass.
- Always call the submit_install_review tool with your results.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function buildDealContext(properties: Record<string, string | null>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(properties)) {
    if (val != null && val.trim() !== "") {
      result[key] = val.trim();
    }
  }
  return result;
}

/** Determine MIME type from filename extension. */
function mimeFromFilename(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext] || "image/jpeg";
}

/** Max image size for base64 inline: 20MB per image. */
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Zuper job lookup — calls the shared handleLookup directly (no HTTP round-trip,
// no auth needed). Uses DB cache, paginated Zuper search, deal ID/tag/name match.
// ---------------------------------------------------------------------------

async function findZuperJobUid(
  dealId: string,
  dealName?: string,
  category?: string,
): Promise<string | null> {
  try {
    const res = await zuperJobLookup(
      [dealId],
      dealName ? [dealName] : [],
      category || null,
    );

    const data = await res.json();
    const match = data.jobs?.[dealId];
    if (match?.jobUid) {
      console.log(
        `[install-review] Zuper job found: ${match.jobUid} (matched by: ${match.matchedBy}, status: ${match.status})`,
      );
      return match.jobUid;
    }
  } catch (err) {
    console.warn("[install-review] Zuper lookup failed:", err);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const start = Date.now();

  let body: InstallReviewRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dealId, jobUid, photoUrls } = body;

  if (!dealId && !jobUid && (!photoUrls || photoUrls.length === 0)) {
    return NextResponse.json(
      { error: "Provide dealId, jobUid, or photoUrls" },
      { status: 400 },
    );
  }

  // ── Step 1: Fetch deal properties early (needed for job lookup + planset) ──
  let properties: Record<string, string | null> | null = null;
  if (dealId) {
    properties = await getDealProperties(dealId, DEAL_PROPERTIES);
  }

  // ── Step 2: Resolve Zuper job UID ──
  let resolvedJobUid = jobUid || null;
  if (!resolvedJobUid && dealId) {
    const dealName = properties?.dealname || undefined;
    // Try construction jobs first (most likely to have install photos),
    // then inspection, then any category
    resolvedJobUid =
      (await findZuperJobUid(dealId, dealName, "construction")) ||
      (await findZuperJobUid(dealId, dealName, "inspection")) ||
      (await findZuperJobUid(dealId, dealName));
  }

  // ── Step 3: Fetch photos ──
  const zuper = new ZuperClient();
  let photoBuffers: { buffer: Buffer; name: string }[] = [];

  // Try Zuper attachments first
  if (resolvedJobUid && zuper.isConfigured()) {
    try {
      const photos = await zuper.getJobPhotos(resolvedJobUid);
      console.log(
        `[install-review] Found ${photos.length} photos on Zuper job ${resolvedJobUid}`,
      );

      // Download photos (limit to 10 to keep within token budget)
      const toDownload = photos.slice(0, 10);
      const downloadResults = await Promise.allSettled(
        toDownload.map(async (att) => {
          const buffer = await zuper.downloadFile(att.url);
          return { buffer, name: att.file_name };
        }),
      );

      for (const r of downloadResults) {
        if (r.status === "fulfilled" && r.value.buffer.byteLength <= MAX_IMAGE_SIZE) {
          photoBuffers.push(r.value);
        }
      }

      console.log(
        `[install-review] Downloaded ${photoBuffers.length}/${toDownload.length} photos`,
      );
    } catch (err) {
      console.warn(`[install-review] Failed to fetch Zuper photos:`, err);
    }
  }

  // Manual fallback: download from provided URLs (with SSRF protection)
  if (photoBuffers.length === 0 && photoUrls && photoUrls.length > 0) {
    const ALLOWED_PHOTO_HOSTS = [
      "storage.googleapis.com",
      "drive.google.com",
      "lh3.googleusercontent.com",
      "zuper.co",
      "app.zuper.co",
    ];

    const safeUrls = photoUrls.filter((url) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") return false;
        return ALLOWED_PHOTO_HOSTS.some(
          (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
        );
      } catch {
        return false;
      }
    });

    if (safeUrls.length === 0 && photoUrls.length > 0) {
      return NextResponse.json(
        {
          error: "Invalid photo URLs",
          details: `Photo URLs must use HTTPS and be from allowed hosts: ${ALLOWED_PHOTO_HOSTS.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const downloadResults = await Promise.allSettled(
      safeUrls.slice(0, 10).map(async (url, i) => {
        const res = await fetch(url, { redirect: "error" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const name = url.split("/").pop() || `photo_${i + 1}.jpg`;
        return { buffer, name };
      }),
    );

    for (const r of downloadResults) {
      if (r.status === "fulfilled" && r.value.buffer.byteLength <= MAX_IMAGE_SIZE) {
        photoBuffers.push(r.value);
      }
    }
  }

  if (photoBuffers.length === 0) {
    return NextResponse.json(
      {
        error: "No photos available",
        details: resolvedJobUid
          ? `Zuper job ${resolvedJobUid} has no photo attachments. Provide photoUrls as fallback.`
          : "Could not find Zuper job for this deal. Provide jobUid or photoUrls directly.",
      },
      { status: 422 },
    );
  }

  // ── Step 4: Validate deal properties + planset ──
  if (!dealId) {
    return NextResponse.json(
      { error: "dealId is required to locate the planset" },
      { status: 400 },
    );
  }

  if (!properties) {
    return NextResponse.json(
      { error: `Failed to fetch deal ${dealId} from HubSpot` },
      { status: 500 },
    );
  }

  const folderId = getDesignFolderId(properties);
  if (!folderId) {
    return NextResponse.json(
      { error: "Deal has no design_documents folder — cannot locate planset" },
      { status: 422 },
    );
  }

  const pdfFiles = await listPlansetPdfs(folderId);
  if (pdfFiles.length === 0) {
    return NextResponse.json(
      { error: `No PDF files found in Drive folder ${folderId}` },
      { status: 422 },
    );
  }

  const selectedFile = pickBestPlanset(pdfFiles);
  if (!selectedFile) {
    return NextResponse.json(
      { error: "Could not select a planset PDF from available files" },
      { status: 422 },
    );
  }

  console.log(
    `[install-review] Selected planset: "${selectedFile.name}" ` +
      `(${selectedFile.size ? Math.round(Number(selectedFile.size) / 1024) + "KB" : "?"})`,
  );

  const { buffer: plansetBuffer, filename: plansetFilename } = await downloadDrivePdf(
    selectedFile.id,
  );

  // ── Step 5: Upload planset to Anthropic Files API ──
  const client = getAnthropicClient();
  let anthropicFileId: string | undefined;

  try {
    const uploadedFile = await client.beta.files.upload({
      file: new File([new Uint8Array(plansetBuffer)], plansetFilename, {
        type: "application/pdf",
      }),
    });
    anthropicFileId = uploadedFile.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "File upload failed";
    return NextResponse.json(
      { error: `Failed to upload planset for AI review: ${msg}` },
      { status: 500 },
    );
  }

  // ── Step 5: Call Claude with planset + photos ──
  const dealContext = buildDealContext(properties);

  // Build message content: planset document + photos as base64 images + text prompt
  const contentBlocks: Array<
    | { type: "document"; source: { type: "file"; file_id: string } }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    | { type: "text"; text: string }
  > = [];

  // 1. Planset PDF
  contentBlocks.push({
    type: "document",
    source: { type: "file", file_id: anthropicFileId },
  });

  // 2. Install photos as base64 images
  for (const photo of photoBuffers) {
    const base64 = photo.buffer.toString("base64");
    const mediaType = mimeFromFilename(photo.name);
    contentBlocks.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64 },
    });
  }

  // 3. Text prompt
  const promptParts = [
    `Review the ${photoBuffers.length} install photo(s) against the attached planset PDF (${plansetFilename}).`,
    "",
    "## Deal Properties (from CRM)",
    "```json",
    JSON.stringify(dealContext, null, 2),
    "```",
    "",
    `Photos provided: ${photoBuffers.map((p) => p.name).join(", ")}`,
    "",
    "Compare the installed equipment visible in the photos against the planset equipment list and call submit_install_review with your findings.",
  ];

  contentBlocks.push({ type: "text", text: promptParts.join("\n") });

  let response;
  try {
    response = await client.beta.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 4096,
      system: buildSystemPrompt(),
      tools: [SUBMIT_INSTALL_REVIEW_TOOL],
      tool_choice: { type: "tool", name: "submit_install_review" } as never,
      messages: [
        {
          role: "user",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: contentBlocks as any,
        },
      ],
      betas: ["files-api-2025-04-14"],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude API call failed";
    console.error("[install-review] Claude API error:", msg);
    // Clean up
    if (anthropicFileId) {
      await client.beta.files.delete(anthropicFileId).catch(() => {});
    }
    return NextResponse.json(
      { error: `AI review failed: ${msg}` },
      { status: 500 },
    );
  }

  // Clean up uploaded file
  if (anthropicFileId) {
    await client.beta.files.delete(anthropicFileId).catch(() => {});
  }

  // ── Step 6: Extract findings from tool use response ──
  const toolBlock = response.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === "submit_install_review",
  );

  if (!toolBlock) {
    return NextResponse.json(
      { error: "AI review did not return structured findings" },
      { status: 500 },
    );
  }

  const input = toolBlock.input as {
    findings?: unknown[];
    overall_pass?: boolean;
    summary?: string;
  };

  const findings: InstallFinding[] = (Array.isArray(input.findings) ? input.findings : [])
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      category: String(f.category || "unknown"),
      status: (["pass", "fail", "unable_to_verify"].includes(String(f.status))
        ? String(f.status)
        : "unable_to_verify") as InstallFinding["status"],
      planset_spec: String(f.planset_spec || ""),
      observed: String(f.observed || ""),
      notes: String(f.notes || ""),
    }));

  const result: InstallReviewResult = {
    findings,
    overall_pass: input.overall_pass ?? findings.every((f) => f.status !== "fail"),
    summary: String(input.summary || "Review complete"),
    photo_count: photoBuffers.length,
    planset_filename: plansetFilename,
    duration_ms: Date.now() - start,
  };

  console.log(
    `[install-review] Complete: ${findings.length} findings, ` +
      `${findings.filter((f) => f.status === "pass").length} pass, ` +
      `${findings.filter((f) => f.status === "fail").length} fail, ` +
      `${findings.filter((f) => f.status === "unable_to_verify").length} unable_to_verify ` +
      `(${result.duration_ms}ms)`,
  );

  return NextResponse.json(result);
}
