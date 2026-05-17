import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { downloadDriveImage } from "@/lib/drive-plansets";

export const maxDuration = 15;

/**
 * Authenticated proxy for Google Drive photos used by the PE Prep UI.
 *
 * Drive thumbnail URLs (https://drive.google.com/thumbnail?id=...) require
 * the file to be publicly shared OR the browser to be signed into a Google
 * account with access. Internal photos are neither, so we proxy the bytes
 * through the suite's session.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { fileId } = await params;
  if (!fileId) return new NextResponse("Missing file id", { status: 400 });

  try {
    const result = await downloadDriveImage(fileId);
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": result.mimeType ?? "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error(`[pe-prep-photo-proxy] Failed to fetch Drive image ${fileId}:`, err);
    return new NextResponse("Failed to fetch photo", { status: 502 });
  }
}
