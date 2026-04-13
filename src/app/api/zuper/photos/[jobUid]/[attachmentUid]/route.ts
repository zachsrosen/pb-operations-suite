import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { zuper } from "@/lib/zuper";

export const maxDuration = 15;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobUid: string; attachmentUid: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { jobUid, attachmentUid } = await params;

  if (!zuper.isConfigured()) {
    return new NextResponse("Zuper not configured", { status: 503 });
  }

  try {
    // Fetch all photos (attachments + notes) for this job
    const photos = await zuper.getJobPhotos(jobUid);
    const photo = photos.find((p) => p.attachment_uid === attachmentUid);

    if (!photo) {
      console.warn(
        `[zuper-photos] Photo ${attachmentUid} not found among ${photos.length} photos for job ${jobUid}`
      );
      return new NextResponse("Photo not found", { status: 404 });
    }

    // Download the image through Zuper's authenticated API
    const buffer = await zuper.downloadFile(photo.url);

    // Determine content type from file extension or MIME type
    const contentType =
      photo.file_type && photo.file_type.startsWith("image/")
        ? photo.file_type
        : getMimeFromExtension(photo.file_name);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  } catch (err) {
    console.error(`[zuper-photos] Failed to proxy photo ${attachmentUid}:`, err);
    return new NextResponse("Failed to fetch photo", { status: 502 });
  }
}

function getMimeFromExtension(fileName?: string): string {
  const ext = fileName?.split(".").pop()?.toLowerCase() || "jpg";
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    gif: "image/gif",
    bmp: "image/bmp",
    tiff: "image/tiff",
    tif: "image/tiff",
  };
  return mimeTypes[ext] ?? "image/jpeg";
}
