/**
 * BOM Upload Token API
 *
 * POST /api/bom/upload-token
 *   Returns a Vercel Blob client upload token for a planset PDF.
 *   Called automatically by @vercel/blob/client upload() before uploading.
 *
 *   The SDK sends:
 *     { type: "blob.generate-client-token", payload: { pathname, clientPayload, multipart } }
 *   and expects back:
 *     { clientToken: "vercel_blob_client_<storeId>_<base64>" }
 *
 *   IMPORTANT: addRandomSuffix must be false here. The SDK's PUT request uses
 *   the exact pathname from the token — if the token embeds a random suffix the
 *   actual PUT pathname won't match and Vercel returns 400.
 *
 * Auth required: design/ops roles
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { logActivity } from "@/lib/db";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  // Auth check
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;

  const logUploadToken = async (
    outcome: "issued" | "failed",
    details: Record<string, unknown>,
    responseStatus: number
  ) => {
    await logActivity({
      type: outcome === "failed" ? "API_ERROR" : "FEATURE_USED",
      description:
        outcome === "issued"
          ? "Issued BOM upload token"
          : "BOM upload token request failed",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "upload_token",
      metadata: {
        event: "bom_upload_token",
        outcome,
        ...details,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/upload-token",
      requestMethod: "POST",
      responseStatus,
      durationMs: Date.now() - startedAt,
    });
  };

  if (!ALLOWED_ROLES.has(role)) {
    await logUploadToken("failed", { reason: "insufficient_permissions", role }, 403);
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    await logUploadToken("failed", { reason: "blob_token_missing" }, 503);
    return NextResponse.json({ error: "Blob storage not configured (missing BLOB_READ_WRITE_TOKEN)" }, { status: 503 });
  }

  // Parse the body sent by @vercel/blob/client upload()
  // Format: { type: "blob.generate-client-token", payload: { pathname, clientPayload, multipart } }
  let pathname: string;
  try {
    const body = (await req.json()) as {
      type?: string;
      payload?: { pathname?: string; clientPayload?: string };
      pathname?: string;
    };
    pathname = body.payload?.pathname ?? body.pathname ?? "bom-uploads/planset.pdf";
  } catch {
    await logUploadToken("failed", { reason: "invalid_json_body" }, 400);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate PDF only
  if (!pathname.toLowerCase().endsWith(".pdf")) {
    await logUploadToken("failed", { reason: "invalid_file_extension", pathname }, 400);
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  try {
    // Token valid for 30 minutes — enough for a very large planset on a slow connection
    const validUntil = Date.now() + 30 * 60 * 1000;

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB — covers the largest plansets
      allowedContentTypes: ["application/pdf", "application/octet-stream"],
      // addRandomSuffix: false — the client already includes a timestamp in the
      // pathname, and the token must match the exact pathname the SDK sends in PUT
      addRandomSuffix: false,
      validUntil,
    });

    await logUploadToken("issued", { pathname, validUntil }, 200);
    return NextResponse.json({ clientToken });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Token generation failed";
    console.error("[bom/upload-token] Error:", msg);
    await logUploadToken("failed", { reason: "token_generation_failed", pathname, error: msg }, 500);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
