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
  // Auth check
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Validate content type
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/pdf") && !contentType.includes("octet-stream")) {
    return NextResponse.json({ error: "Content-Type must be application/pdf" }, { status: 400 });
  }

  // Get filename from query param
  const url = new URL(req.url);
  const filename = url.searchParams.get("filename") ?? "planset.pdf";
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  // Check blob token
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Blob storage is not configured" }, { status: 503 });
  }

  // Stream request body directly to Vercel Blob
  if (!req.body) {
    return NextResponse.json({ error: "Empty request body" }, { status: 400 });
  }

  try {
    const blob = await put(`bom-uploads/${filename}`, req.body, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return NextResponse.json({ url: blob.url, pathname: blob.pathname });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    console.error("[bom/upload] Blob put error:", msg);
    return NextResponse.json({ error: `Upload failed: ${msg}` }, { status: 502 });
  }
}
