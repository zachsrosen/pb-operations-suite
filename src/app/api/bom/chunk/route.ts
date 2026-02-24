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
import { logActivity } from "@/lib/db";
import { put, list, del } from "@vercel/blob";

const ALLOWED_ROLES = new Set([
  "ADMIN", "OWNER", "MANAGER", "OPERATIONS", "OPERATIONS_MANAGER",
  "PROJECT_MANAGER", "DESIGNER", "PERMITTING",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // reassembly of large plansets needs time

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;

  const logChunkUpload = async (
    outcome: "started" | "completed" | "failed",
    details: Record<string, unknown>,
    responseStatus: number
  ) => {
    await logActivity({
      type: outcome === "failed" ? "API_ERROR" : "FEATURE_USED",
      description:
        outcome === "started"
          ? "Started chunked BOM upload"
          : outcome === "completed"
            ? "Completed chunked BOM upload"
            : "Chunked BOM upload failed",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityName: "chunk_upload",
      metadata: {
        event: "bom_chunk_upload",
        outcome,
        ...details,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/chunk",
      requestMethod: "POST",
      responseStatus,
      durationMs: Date.now() - startedAt,
    });
  };

  if (!ALLOWED_ROLES.has(role)) {
    await logChunkUpload("failed", { reason: "insufficient_permissions", role }, 403);
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    await logChunkUpload("failed", { reason: "blob_token_missing" }, 503);
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
    await logChunkUpload("failed", { reason: "invalid_json_body" }, 400);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { uploadId, chunkIndex, totalChunks, data, filename = "planset.pdf" } = body;

  if (!uploadId || chunkIndex == null || !totalChunks || !data) {
    await logChunkUpload(
      "failed",
      {
        reason: "missing_required_fields",
        hasUploadId: !!uploadId,
        hasChunkIndex: chunkIndex != null,
        hasTotalChunks: !!totalChunks,
        hasData: !!data,
      },
      400
    );
    return NextResponse.json({ error: "Missing required fields: uploadId, chunkIndex, totalChunks, data" }, { status: 400 });
  }

  let stage = "store_chunk";
  try {
    if (chunkIndex === 0) {
      await logChunkUpload("started", { uploadId, totalChunks, filename }, 200);
    }

    // Store this chunk in blob as a temp file
    const chunkBytes = Buffer.from(data, "base64");
    const chunkPath = `bom-chunks/${uploadId}/${String(chunkIndex).padStart(4, "0")}.chunk`;

    await put(chunkPath, chunkBytes, {
      access: "private",
      contentType: "application/octet-stream",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    // Check if all chunks are present
    stage = "list_chunks";
    const listed = await list({
      prefix: `bom-chunks/${uploadId}/`,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    if (listed.blobs.length < totalChunks) {
      // Still waiting for more chunks
      return NextResponse.json({ status: "pending", received: listed.blobs.length, total: totalChunks });
    }

    // All chunks received — fetch and reassemble in order.
    // Private blobs require the token as a Bearer header.
    stage = "assemble_chunks";
    const sorted = listed.blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));
    const parts: Buffer[] = [];
    const blobAuthHeader = { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` };

    for (const blob of sorted) {
      const res = await fetch(blob.url, { headers: blobAuthHeader });
      const buf = Buffer.from(await res.arrayBuffer());
      parts.push(buf);
    }

    const assembled = Buffer.concat(parts);

    // Upload the assembled PDF as a single blob
    stage = "upload_final_pdf";
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const finalBlob = await put(`bom-uploads/${safeName}`, assembled, {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    // Clean up chunk files
    stage = "cleanup_chunks";
    await del(
      sorted.map((b) => b.url),
      { token: process.env.BLOB_READ_WRITE_TOKEN }
    );

    await logChunkUpload(
      "completed",
      {
        uploadId,
        totalChunks,
        filename: safeName,
        assembledSizeBytes: assembled.byteLength,
        blobUrl: finalBlob.url,
      },
      200
    );
    return NextResponse.json({ status: "complete", blobUrl: finalBlob.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logChunkUpload(
      "failed",
      { reason: "chunk_pipeline_failed", stage, uploadId, chunkIndex, totalChunks, filename, error: message },
      500
    );
    return NextResponse.json({ error: `Chunk upload failed: ${message}` }, { status: 500 });
  }
}
