/**
 * Catalog Photo Viewer
 *
 * GET /api/catalog/photo?path=<blob-pathname>
 *   Streams a private Vercel Blob to the caller after session auth.
 *
 *   The project's Blob store is PRIVATE — direct URLs require
 *   `Authorization: Bearer BLOB_READ_WRITE_TOKEN`, so we can't hand the raw URL
 *   to an <img src>. This proxy reads server-side with our token and streams.
 */

import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { requireApiAuth } from "@/lib/api-auth";

// Only allow paths under the catalog-photos/ prefix to prevent reading
// arbitrary blobs (e.g. BOM plansets, solar files) via this endpoint.
const ALLOWED_PREFIX = "catalog-photos/";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const pathname = request.nextUrl.searchParams.get("path");
  if (!pathname) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }
  if (!pathname.startsWith(ALLOWED_PREFIX) || pathname.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob?.contentType || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[catalog/photo] Fetch failed:", msg, error);
    return NextResponse.json({ error: `Fetch failed: ${msg}` }, { status: 500 });
  }
}
