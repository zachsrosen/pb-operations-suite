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
  listDriveImagesRecursive,
  downloadDriveImage,
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
  "installation_documents",
  "installation_document_id",
  "permit_documents",
  "permit_document_id",
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

function getInstallFolderId(properties: Record<string, string | null>): string | null {
  const raw = String(
    properties.installation_documents ||
      properties.installation_document_id ||
      "",
  ).trim();
  if (!raw) return null;
  return extractFolderId(raw);
}

function getPermitFolderId(properties: Record<string, string | null>): string | null {
  const raw = String(
    properties.permit_documents ||
      properties.permit_document_id ||
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

/** MIME types supported by Claude's vision API. */
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/** Determine MIME type from filename extension. */
function mimeFromFilename(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext] || "image/jpeg";
}

/** Check if a filename has a Claude-supported image type. */
function isSupportedImageType(name: string): boolean {
  return SUPPORTED_IMAGE_TYPES.has(mimeFromFilename(name));
}

/** Max image size for base64 inline: 20MB per image. */
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

/** Clean up uploaded files from Anthropic Files API. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cleanupFiles(client: any, fileIds: string[]) {
  await Promise.allSettled(
    fileIds.map((id) => client.beta.files.delete(id).catch(() => {})),
  );
}

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
      [String(dealId)],
      dealName ? [dealName] : [],
      category || null,
    );

    const data = await res.json();
    const match = data.jobs?.[String(dealId)];
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

  // Coerce dealId to string — JSON body may send it as a number
  const dealId = body.dealId ? String(body.dealId) : undefined;
  const { jobUid, photoUrls } = body;

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

  // ── Step 3: Fetch photos (Drive → Zuper → manual URLs) ──
  let photoBuffers: { buffer: Buffer; name: string; mimeType?: string }[] = [];
  let photoSource = "";

  // 3a. Try Google Drive installation documents folder (most reliable)
  // Recursively searches all subfolders (photos are often nested 2-3 levels deep)
  if (photoBuffers.length === 0 && properties) {
    const installFolderId = getInstallFolderId(properties);
    if (installFolderId) {
      try {
        const driveImages = await listDriveImagesRecursive(installFolderId, 3, 30);

        console.log(
          `[install-review] Found ${driveImages.length} images in Drive install folder ${installFolderId} (recursive)`,
        );

        if (driveImages.length > 0) {
          const toDownload = driveImages.slice(0, 10);
          const downloadResults = await Promise.allSettled(
            toDownload.map(async (img) => {
              const { buffer, filename, mimeType } = await downloadDriveImage(img.id);
              return { buffer, name: filename, mimeType };
            }),
          );

          for (const r of downloadResults) {
            if (r.status === "fulfilled" && r.value.buffer.byteLength <= MAX_IMAGE_SIZE) {
              photoBuffers.push(r.value);
            }
          }

          if (photoBuffers.length > 0) {
            photoSource = "google_drive";
            console.log(
              `[install-review] Downloaded ${photoBuffers.length}/${toDownload.length} photos from Drive`,
            );
          }
        }
      } catch (err) {
        console.warn(`[install-review] Failed to fetch Drive photos:`, err);
      }
    }
  }

  // 3b. Try Zuper job attachments as fallback
  if (photoBuffers.length === 0 && resolvedJobUid) {
    const zuper = new ZuperClient();
    if (zuper.isConfigured()) {
      try {
        const photos = await zuper.getJobPhotos(resolvedJobUid);
        console.log(
          `[install-review] Found ${photos.length} photos on Zuper job ${resolvedJobUid}`,
        );

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

        if (photoBuffers.length > 0) {
          photoSource = "zuper";
          console.log(
            `[install-review] Downloaded ${photoBuffers.length}/${toDownload.length} photos from Zuper`,
          );
        }
      } catch (err) {
        console.warn(`[install-review] Failed to fetch Zuper photos:`, err);
      }
    }
  }

  // 3c. Manual fallback: download from provided URLs (with SSRF protection)
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

    if (photoBuffers.length > 0) photoSource = "manual_urls";
  }

  if (photoBuffers.length === 0) {
    const details = [];
    if (!getInstallFolderId(properties || {}))
      details.push("No installation_documents folder set on deal.");
    if (resolvedJobUid)
      details.push(`Zuper job ${resolvedJobUid} has no photo attachments.`);
    else if (!jobUid)
      details.push("Could not find a Zuper job for this deal.");
    details.push("Provide photoUrls as fallback.");

    return NextResponse.json(
      { error: "No photos available", details: details.join(" ") },
      { status: 422 },
    );
  }

  // Filter out unsupported image types — Claude API only accepts jpeg/png/gif/webp
  // Note: HEIC images from Drive are auto-converted to JPEG during download,
  // so check the resolved mimeType (not just the filename)
  const isSupported = (p: { name: string; mimeType?: string }) =>
    SUPPORTED_IMAGE_TYPES.has(p.mimeType || mimeFromFilename(p.name));

  const unsupported = photoBuffers.filter((p) => !isSupported(p));
  if (unsupported.length > 0) {
    console.warn(
      `[install-review] Skipping ${unsupported.length} unsupported image(s): ${unsupported.map((p) => `${p.name} (${p.mimeType})`).join(", ")}`,
    );
  }
  photoBuffers = photoBuffers.filter(isSupported);

  if (photoBuffers.length === 0) {
    return NextResponse.json(
      {
        error: "No supported photos available",
        details: `Found ${unsupported.length} photo(s) but all are in unsupported formats (HEIC/HEIF). Please provide JPEG, PNG, or WebP images.`,
      },
      { status: 422 },
    );
  }

  console.log(`[install-review] Using ${photoBuffers.length} photos from ${photoSource}`);

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

  // ── Collect planset candidates from permit + design folders ──
  // Permit plans (stamped) are preferred but can be large/problematic;
  // design plans serve as fallback (usually smaller, pre-stamp).
  const permitFolderId = getPermitFolderId(properties);
  const designFolderId = getDesignFolderId(properties);

  interface PlansetCandidate {
    file: { id: string; name: string; size?: string };
    source: string;
  }
  const plansetCandidates: PlansetCandidate[] = [];

  if (permitFolderId) {
    const permitPdfs = await listPlansetPdfs(permitFolderId);
    const best = pickBestPlanset(permitPdfs);
    if (best) plansetCandidates.push({ file: best, source: "permit_documents" });
  }
  if (designFolderId) {
    const designPdfs = await listPlansetPdfs(designFolderId);
    const best = pickBestPlanset(designPdfs);
    if (best) plansetCandidates.push({ file: best, source: "design_documents" });
  }

  if (plansetCandidates.length === 0) {
    return NextResponse.json(
      {
        error: "No planset PDF found",
        details: `Checked ${[permitFolderId && "permit_documents", designFolderId && "design_documents"].filter(Boolean).join(" and ") || "no folders"} — no PDFs found.`,
      },
      { status: 422 },
    );
  }

  // ── Step 5: Upload photos to Anthropic Files API ──
  const client = getAnthropicClient();
  const uploadedFileIds: string[] = []; // Track for cleanup

  const photoFileIds: { fileId: string; name: string }[] = [];
  for (const photo of photoBuffers) {
    try {
      const mediaType = photo.mimeType || mimeFromFilename(photo.name);
      const uploaded = await client.beta.files.upload({
        file: new File([new Uint8Array(photo.buffer)], photo.name, { type: mediaType }),
      });
      photoFileIds.push({ fileId: uploaded.id, name: photo.name });
      uploadedFileIds.push(uploaded.id);
    } catch (e) {
      console.warn(`[install-review] Failed to upload photo ${photo.name}:`, e);
    }
  }

  if (photoFileIds.length === 0) {
    console.warn("[install-review] Files API photo uploads all failed, using base64 photos");
  }

  // ── Step 6: Try each planset candidate until one works ──
  const dealContext = buildDealContext(properties);

  const claudeCallParams = {
    model: CLAUDE_MODELS.sonnet,
    max_tokens: 4096,
    system: buildSystemPrompt(),
    tools: [SUBMIT_INSTALL_REVIEW_TOOL],
    tool_choice: { type: "tool", name: "submit_install_review" } as never,
  };

  // Max raw PDF size for base64 inline (base64 adds ~33%, so 22MB → ~30MB base64)
  const MAX_INLINE_PDF_RAW = 22 * 1024 * 1024;

  let response;
  let usedPlansetFilename = "";
  let lastError = "";

  for (const candidate of plansetCandidates) {
    const { file: plansetFile, source: plansetSource } = candidate;

    console.log(
      `[install-review] Trying planset: "${plansetFile.name}" from ${plansetSource} ` +
        `(${plansetFile.size ? Math.round(Number(plansetFile.size) / 1024) + "KB" : "?"})`,
    );

    const { buffer: plansetBuffer, filename: plansetFilename } = await downloadDrivePdf(
      plansetFile.id,
    );
    const pdfSizeMB = plansetBuffer.byteLength / (1024 * 1024);

    // Build prompt for this planset
    const promptParts = [
      `Review the ${photoFileIds.length || photoBuffers.length} install photo(s) against the attached planset PDF (${plansetFilename}).`,
      "",
      "## Deal Properties (from CRM)",
      "```json",
      JSON.stringify(dealContext, null, 2),
      "```",
      "",
      `Photos provided: ${(photoFileIds.length > 0 ? photoFileIds.map((p) => p.name) : photoBuffers.map((p) => p.name)).join(", ")}`,
      "",
      "Compare the installed equipment visible in the photos against the planset equipment list and call submit_install_review with your findings.",
    ];

    // Helper: build photo content blocks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buildPhotoBlocks = (): any[] => {
      if (photoFileIds.length > 0) {
        return photoFileIds.map((p) => ({
          type: "image",
          source: { type: "file", file_id: p.fileId },
        }));
      }
      // Fallback: base64 photos
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: any[] = [];
      for (const photo of photoBuffers) {
        const mediaType = photo.mimeType || mimeFromFilename(photo.name);
        if (!SUPPORTED_IMAGE_TYPES.has(mediaType)) continue;
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: photo.buffer.toString("base64") },
        });
      }
      return blocks;
    }

    // ── Attempt A: Upload PDF to Files API, use file_id reference ──
    let pdfFileId: string | undefined;
    try {
      const uploadedPdf = await client.beta.files.upload({
        file: new File([new Uint8Array(plansetBuffer)], plansetFilename, {
          type: "application/pdf",
        }),
      });
      pdfFileId = uploadedPdf.id;
      uploadedFileIds.push(pdfFileId);
    } catch (e) {
      console.warn(`[install-review] Failed to upload planset ${plansetFilename}:`, e);
      lastError = e instanceof Error ? e.message : "File upload failed";
      continue; // Try next candidate
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: any[] = [
        { type: "document", source: { type: "file", file_id: pdfFileId } },
        ...buildPhotoBlocks(),
        { type: "text", text: promptParts.join("\n") },
      ];

      response = await client.beta.messages.create({
        ...claudeCallParams,
        messages: [{ role: "user", content }],
        betas: ["files-api-2025-04-14"],
      });
      usedPlansetFilename = plansetFilename;
      break; // Success!
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Claude API call failed";
      console.error(`[install-review] File-ref attempt failed for ${plansetFilename}: ${msg}`);
      lastError = msg;

      const isPdfError = msg.toLowerCase().includes("could not process pdf");
      if (!isPdfError) {
        // Non-PDF error (auth, rate limit, etc.) — don't try other candidates
        await cleanupFiles(client, uploadedFileIds);
        return NextResponse.json(
          { error: `AI review failed: ${msg}` },
          { status: 500 },
        );
      }

      // ── Attempt B: Base64 inline PDF (only if small enough) ──
      if (plansetBuffer.byteLength <= MAX_INLINE_PDF_RAW) {
        console.log(
          `[install-review] Trying base64 inline for ${plansetFilename} (${Math.round(pdfSizeMB * 10) / 10}MB)`,
        );
        try {
          const base64PdfData = Buffer.from(plansetBuffer).toString("base64");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const content: any[] = [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64PdfData },
            },
            ...buildPhotoBlocks(),
            { type: "text", text: promptParts.join("\n") },
          ];

          if (photoFileIds.length > 0) {
            response = await client.beta.messages.create({
              ...claudeCallParams,
              messages: [{ role: "user", content }],
              betas: ["files-api-2025-04-14"],
            });
          } else {
            response = await client.messages.create({
              ...claudeCallParams,
              messages: [{ role: "user", content }],
            });
          }
          usedPlansetFilename = plansetFilename;
          break; // Success!
        } catch (inlineErr) {
          const inlineMsg = inlineErr instanceof Error ? inlineErr.message : "Unknown error";
          console.error(`[install-review] Inline fallback failed for ${plansetFilename}: ${inlineMsg}`);
          lastError = inlineMsg;
          // Continue to next candidate
        }
      } else {
        console.log(
          `[install-review] Skipping inline fallback — ${plansetFilename} too large (${Math.round(pdfSizeMB)}MB > ${MAX_INLINE_PDF_RAW / 1024 / 1024}MB limit)`,
        );
        // Continue to next candidate (e.g., design_documents version may be smaller)
      }
    }
  }

  // ── Attempt C: Photo-only review (no planset) as last resort ──
  if (!response) {
    console.log(
      `[install-review] All planset attempts failed (last error: ${lastError}). Trying photo-only review.`,
    );

    const photoOnlyPrompt = [
      `No planset PDF could be loaded for this review. Perform a photo-only install review based on the deal properties and ${photoFileIds.length || photoBuffers.length} install photo(s).`,
      "",
      "## Deal Properties (from CRM)",
      "```json",
      JSON.stringify(dealContext, null, 2),
      "```",
      "",
      "Use the deal properties (module_type, module_count, inverter_type, battery_type, etc.) as the expected specification.",
      "Compare what you can see in the photos against these expected specs.",
      "Mark categories as unable_to_verify if the deal properties don't specify that component.",
      "Call submit_install_review with your findings.",
    ];

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const photoBlocks = photoFileIds.length > 0
        ? photoFileIds.map((p) => ({
            type: "image",
            source: { type: "file", file_id: p.fileId },
          }))
        : photoBuffers
            .filter((p) => SUPPORTED_IMAGE_TYPES.has(p.mimeType || mimeFromFilename(p.name)))
            .map((p) => ({
              type: "image",
              source: {
                type: "base64",
                media_type: p.mimeType || mimeFromFilename(p.name),
                data: p.buffer.toString("base64"),
              },
            }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: any[] = [
        ...photoBlocks,
        { type: "text", text: photoOnlyPrompt.join("\n") },
      ];

      if (photoFileIds.length > 0) {
        response = await client.beta.messages.create({
          ...claudeCallParams,
          messages: [{ role: "user", content }],
          betas: ["files-api-2025-04-14"],
        });
      } else {
        response = await client.messages.create({
          ...claudeCallParams,
          messages: [{ role: "user", content }],
        });
      }
      usedPlansetFilename = "(photo-only review — planset unavailable)";
    } catch (photoOnlyErr) {
      const photoOnlyMsg = photoOnlyErr instanceof Error ? photoOnlyErr.message : "Unknown error";
      console.error("[install-review] Photo-only review also failed:", photoOnlyMsg);
      await cleanupFiles(client, uploadedFileIds);
      return NextResponse.json(
        {
          error: `AI review failed for all strategies`,
          details: `File-ref planset failed, inline planset failed, photo-only review failed. Last error: ${photoOnlyMsg}`,
        },
        { status: 500 },
      );
    }
  }

  // Clean up all uploaded files
  await cleanupFiles(client, uploadedFileIds);

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
    planset_filename: usedPlansetFilename,
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
