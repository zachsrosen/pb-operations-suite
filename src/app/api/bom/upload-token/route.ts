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
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

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

  const body = (await req.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // Validate file is a PDF
        if (!pathname.toLowerCase().endsWith(".pdf")) {
          throw new Error("Only PDF files are allowed");
        }
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 35 * 1024 * 1024, // 35MB
          tokenPayload: JSON.stringify({ role }),
        };
      },
      onUploadCompleted: async () => {
        // No server-side action needed after upload
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
