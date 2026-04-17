/**
 * Catalog Photo Upload Token API
 *
 * POST /api/catalog/upload-photo/upload-token
 *   Returns a Vercel Blob client upload token for a product photo.
 *   Called automatically by @vercel/blob/client upload() before the browser
 *   PUTs the file directly to Blob storage, bypassing the Vercel serverless
 *   4.5 MB request body limit.
 *
 *   The SDK sends:
 *     { type: "blob.generate-client-token",
 *       payload: { pathname, clientPayload, multipart } }
 *   and expects back:
 *     { clientToken: "vercel_blob_client_<storeId>_<base64>" }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Blob storage not configured (missing BLOB_READ_WRITE_TOKEN)" },
      { status: 503 }
    );
  }

  let pathname: string;
  try {
    const body = (await req.json()) as {
      type?: string;
      payload?: { pathname?: string; clientPayload?: string };
      pathname?: string;
    };
    pathname =
      body.payload?.pathname ?? body.pathname ?? "catalog-photos/unknown";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const validUntil = Date.now() + 15 * 60 * 1000;

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      maximumSizeInBytes: 5 * 1024 * 1024,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
      // addRandomSuffix: false — the client already includes a timestamp in the
      // pathname, and the token must match the exact pathname the SDK sends in PUT.
      addRandomSuffix: false,
      validUntil,
    });

    return NextResponse.json({ clientToken });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Token generation failed";
    console.error("[catalog/upload-photo/upload-token] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
