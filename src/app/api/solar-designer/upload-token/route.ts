/**
 * Solar Designer Upload Token API
 *
 * POST /api/solar-designer/upload-token
 *   Returns a Vercel Blob client upload token for solar layout files
 *   (.dxf, .json, .csv).  Called automatically by @vercel/blob/client
 *   upload() before the browser sends the file directly to Blob storage,
 *   bypassing the Vercel serverless 4.5 MB body-size limit.
 *
 *   The SDK sends:
 *     { type: "blob.generate-client-token",
 *       payload: { pathname, clientPayload, multipart } }
 *   and expects back:
 *     { clientToken: "vercel_blob_client_<storeId>_<base64>" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

const ALLOWED_EXTENSIONS = new Set(['dxf', 'json', 'csv']);

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Blob storage not configured (missing BLOB_READ_WRITE_TOKEN)' },
      { status: 503 },
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
      body.payload?.pathname ?? body.pathname ?? 'solar-designer/unknown';
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Validate extension
  const ext = pathname.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `Only .dxf, .json, and .csv files are allowed (got .${ext})` },
      { status: 400 },
    );
  }

  try {
    const validUntil = Date.now() + 15 * 60 * 1000; // 15 minutes

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      maximumSizeInBytes: 20 * 1024 * 1024, // 20 MB — plenty for layout files
      allowedContentTypes: [
        'application/json',
        'text/csv',
        'text/plain',
        'application/octet-stream',
        'application/dxf',
        'image/vnd.dxf',
      ],
      addRandomSuffix: false,
      validUntil,
    });

    return NextResponse.json({ clientToken });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Token generation failed';
    console.error('[solar-designer/upload-token] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
