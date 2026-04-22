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
 * POST /api/triage/upload
 * Upload a triage photo to Vercel Blob (private). Returns { url, pathname, fileName }.
 * The client should PATCH the TriageRun with { adderId, code, url, pathname }.
 *
 * Mirrors /api/catalog/upload-photo — private blob + same-origin proxy via
 * /api/catalog/photo which enforces session auth for reads.
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
      console.error("[triage] Photo upload blocked: BLOB_READ_WRITE_TOKEN missing");
      return NextResponse.json(
        { error: "Blob storage not configured — contact an admin." },
        { status: 503 }
      );
    }

    // Private blob store — direct URLs require auth. We return the same-origin
    // proxy URL via /api/catalog/photo which streams the blob server-side
    // behind the app session (shared proxy route across catalog + triage).
    const blob = await put(`triage-photos/${file.name}`, file, {
      access: "private",
      addRandomSuffix: true,
    });

    const viewerUrl = `/api/catalog/photo?path=${encodeURIComponent(blob.pathname)}`;
    return NextResponse.json({
      url: viewerUrl,
      pathname: blob.pathname,
      fileName: file.name,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[triage] Photo upload failed:", msg, error);
    return NextResponse.json(
      { error: `Upload failed: ${msg}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/triage/upload
 * Remove a previously uploaded triage photo from Vercel Blob.
 */
export async function DELETE(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing URL" }, { status: 400 });
    }

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
    console.error("[triage] Photo delete failed:", error);
    return NextResponse.json(
      { error: "Delete failed" },
      { status: 500 }
    );
  }
}
