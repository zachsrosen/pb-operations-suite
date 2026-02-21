/**
 * BOM Upload Token API
 *
 * POST /api/bom/upload-token
 *   Returns a Vercel Blob client upload token for a planset PDF.
 *   The client uses this to upload directly to Vercel Blob storage,
 *   bypassing the 4.5MB Serverless Function body limit.
 *   After upload, the client passes the blob URL to /api/bom/extract.
 *
 * Auth required: design/ops roles
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
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
  // Auth check
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // The @vercel/blob/client upload() sends:
  //   { type: "blob.generate-client-token", payload: { pathname, clientPayload, multipart } }
  let pathname: string;
  try {
    const body = (await req.json()) as {
      type?: string;
      payload?: { pathname?: string };
      pathname?: string;
    };
    // Support both the structured event format and a plain { pathname } body
    pathname = body.payload?.pathname ?? body.pathname ?? "planset.pdf";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate PDF only
  if (!pathname.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  try {
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      pathname,
      maximumSizeInBytes: 35 * 1024 * 1024, // 35 MB
      allowedContentTypes: ["application/pdf"],
      addRandomSuffix: true,
    });

    return NextResponse.json({ clientToken });
  } catch (error) {
    console.error("[bom/upload-token] generateClientToken error:", error);
    return NextResponse.json(
      { error: (error as Error).message ?? "Failed to generate upload token" },
      { status: 500 }
    );
  }
}
