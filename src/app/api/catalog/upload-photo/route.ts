import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { requireApiAuth } from "@/lib/api-auth";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * POST /api/catalog/upload-photo
 * Upload a product photo to Vercel Blob.
 * Returns { url, fileName }.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP, and GIF images are allowed" },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Image must be under 5MB" },
        { status: 400 }
      );
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error("[catalog] Photo upload blocked: BLOB_READ_WRITE_TOKEN missing");
      return NextResponse.json(
        { error: "Blob storage not configured — contact an admin." },
        { status: 503 }
      );
    }

    // The project's Vercel Blob store is configured as PRIVATE (matching other
    // uploads in this repo — BOM plansets, solar designer files). Direct Vercel
    // Blob URLs require `Authorization: Bearer BLOB_READ_WRITE_TOKEN` to read,
    // so we can't put the raw URL in an <img src>. Instead:
    //   1. Upload with access: "private"
    //   2. Return a same-origin proxy URL that streams the blob server-side
    //      via GET /api/catalog/photo, behind the app's session auth.
    const blob = await put(`catalog-photos/${file.name}`, file, {
      access: "private",
      addRandomSuffix: true,
    });

    // Persist the pathname and return an internal viewer URL.
    const viewerUrl = `/api/catalog/photo?path=${encodeURIComponent(blob.pathname)}`;

    return NextResponse.json({
      url: viewerUrl,
      pathname: blob.pathname,
      fileName: file.name,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[catalog] Photo upload failed:", msg, error);
    return NextResponse.json(
      { error: `Upload failed: ${msg}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/catalog/upload-photo
 * Remove a previously uploaded photo from Vercel Blob.
 */
export async function DELETE(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing URL" }, { status: 400 });
    }

    // Accept three shapes:
    //   1. /api/catalog/photo?path=catalog-photos/foo.png  (new viewer URL)
    //   2. https://<store>.private.blob.vercel-storage.com/catalog-photos/foo.png (direct)
    //   3. catalog-photos/foo.png (bare pathname)
    let target = url;
    if (url.startsWith("/api/catalog/photo")) {
      const params = new URL(url, "http://local").searchParams;
      const path = params.get("path");
      if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });
      target = path;
    }

    await del(target);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[catalog] Photo delete failed:", error);
    return NextResponse.json(
      { error: "Delete failed" },
      { status: 500 }
    );
  }
}
