/**
 * BOM Upload API
 *
 * POST /api/bom/upload
 *   Accepts a planset PDF as a raw binary body (Content-Type: application/pdf).
 *   Streams it directly to Vercel Blob storage and returns the blob URL.
 *   The client then passes the blob URL to /api/bom/extract.
 *
 *   Uses streaming so the 4.5MB serverless body buffer limit is not hit.
 *   Vercel's put() accepts a ReadableStream directly.
 *
 * Body: raw PDF bytes (application/pdf)
 * Query: ?filename=planset.pdf
 *
 * Auth required: design/ops roles
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { logActivity } from "@/lib/db";
import { put } from "@vercel/blob";

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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// No body size limit — we stream directly to Vercel Blob
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  // Auth check
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;

  const logUpload = async (
    outcome: "uploaded" | "failed",
    details: Record<string, unknown>,
    responseStatus: number
  ) => {
    await logActivity({
      type: outcome === "failed" ? "API_ERROR" : "FEATURE_USED",
      description:
        outcome === "uploaded"
          ? "Uploaded BOM PDF"
          : "BOM PDF upload failed",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "upload",
      metadata: {
        event: "bom_upload",
        outcome,
        ...details,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/upload",
      requestMethod: "POST",
      responseStatus,
      durationMs: Date.now() - startedAt,
    });
  };

  if (!ALLOWED_ROLES.has(role)) {
    await logUpload("failed", { reason: "insufficient_permissions", role }, 403);
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Validate content type
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/pdf") && !contentType.includes("octet-stream")) {
    await logUpload("failed", { reason: "invalid_content_type", contentType }, 400);
    return NextResponse.json({ error: "Content-Type must be application/pdf" }, { status: 400 });
  }

  // Get filename from query param
  const url = new URL(req.url);
  const filename = url.searchParams.get("filename") ?? "planset.pdf";
  if (!filename.toLowerCase().endsWith(".pdf")) {
    await logUpload("failed", { reason: "invalid_file_extension", filename }, 400);
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  // Check blob token
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    await logUpload("failed", { reason: "blob_token_missing", filename }, 503);
    return NextResponse.json({ error: "Blob storage is not configured" }, { status: 503 });
  }

  // Stream request body directly to Vercel Blob
  if (!req.body) {
    await logUpload("failed", { reason: "empty_request_body", filename }, 400);
    return NextResponse.json({ error: "Empty request body" }, { status: 400 });
  }

  try {
    const blob = await put(`bom-uploads/${filename}`, req.body, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    await logUpload(
      "uploaded",
      {
        filename,
        pathname: blob.pathname,
        contentType,
        contentLength: req.headers.get("content-length"),
      },
      200
    );
    return NextResponse.json({ url: blob.url, pathname: blob.pathname });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    console.error("[bom/upload] Blob put error:", msg);
    await logUpload("failed", { reason: "blob_put_failed", filename, error: msg }, 502);
    return NextResponse.json({ error: `Upload failed: ${msg}` }, { status: 502 });
  }
}
