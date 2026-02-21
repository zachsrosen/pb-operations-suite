/**
 * BOM Chunk Upload API
 *
 * POST /api/bom/chunk
 *   Accepts a single chunk of a PDF being uploaded in pieces.
 *   Stores chunks in Vercel Blob, returns a completion signal when all chunks received.
 *   Each chunk is 1MB raw → ~1.4MB base64 JSON — well under Vercel's 4.5MB serverless body limit.
 *
 * Body: JSON
 *   uploadId  - client-generated UUID identifying this upload session
 *   chunkIndex - 0-based chunk number
 *   totalChunks - total number of chunks expected
 *   data       - base64-encoded chunk bytes
 *   filename   - original PDF filename (sent with first chunk)
 *
 * Returns:
 *   { status: "pending" }                    - chunk stored, waiting for more
 *   { status: "complete", blobUrl: "..." }   - all chunks received, assembled, blob URL ready
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { put, list, del } from "@vercel/blob";

const ALLOWED_ROLES = new Set([
  "ADMIN", "OWNER", "MANAGER", "OPERATIONS", "OPERATIONS_MANAGER",
  "PROJECT_MANAGER", "DESIGNER", "PERMITTING",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // reassembly of large plansets needs time

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Blob storage not configured" }, { status: 503 });
  }

  let body: {
    uploadId: string;
    chunkIndex: number;
    totalChunks: number;
    data: string; // base64
    filename?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { uploadId, chunkIndex, totalChunks, data, filename = "planset.pdf" } = body;

  if (!uploadId || chunkIndex == null || !totalChunks || !data) {
    return NextResponse.json({ error: "Missing required fields: uploadId, chunkIndex, totalChunks, data" }, { status: 400 });
  }

  // Store this chunk in blob as a temp file
  const chunkBytes = Buffer.from(data, "base64");
  const chunkPath = `bom-chunks/${uploadId}/${String(chunkIndex).padStart(4, "0")}.chunk`;

  await put(chunkPath, chunkBytes, {
    access: "public",
    contentType: "application/octet-stream",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  // Check if all chunks are present
  const listed = await list({
    prefix: `bom-chunks/${uploadId}/`,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  if (listed.blobs.length < totalChunks) {
    // Still waiting for more chunks
    return NextResponse.json({ status: "pending", received: listed.blobs.length, total: totalChunks });
  }

  // All chunks received — fetch and reassemble in order
  const sorted = listed.blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));
  const parts: Buffer[] = [];

  for (const blob of sorted) {
    const res = await fetch(blob.url);
    const buf = Buffer.from(await res.arrayBuffer());
    parts.push(buf);
  }

  const assembled = Buffer.concat(parts);

  // Upload the assembled PDF as a single blob
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const finalBlob = await put(`bom-uploads/${safeName}`, assembled, {
    access: "public",
    contentType: "application/pdf",
    addRandomSuffix: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  // Clean up chunk files
  await del(
    sorted.map((b) => b.url),
    { token: process.env.BLOB_READ_WRITE_TOKEN }
  );

  return NextResponse.json({ status: "complete", blobUrl: finalBlob.url });
}
