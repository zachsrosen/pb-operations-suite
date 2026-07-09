import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { validatePhotoUpload, photoViewerUrl, ESCALATION_PHOTO_PREFIX } from "@/lib/idr-escalation-photos";
import { appCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const dealId = req.nextUrl.searchParams.get("dealId");
  if (!dealId) return NextResponse.json({ error: "Missing dealId" }, { status: 400 });

  const photos = await prisma.idrEscalationPhoto.findMany({
    where: { dealId },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({
    photos: photos.map((p) => ({ ...p, viewerUrl: photoViewerUrl(p.blobPath) })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  const dealId = form.get("dealId");
  const caption = form.get("caption");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (typeof dealId !== "string" || !dealId) return NextResponse.json({ error: "Missing dealId" }, { status: 400 });

  const invalid = validatePhotoUpload(file.type, file.size);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("[idr/escalation-photos] Upload blocked: BLOB_READ_WRITE_TOKEN missing");
    return NextResponse.json({ error: "Blob storage not configured — contact an admin." }, { status: 503 });
  }

  const blob = await put(`${ESCALATION_PHOTO_PREFIX}${file.name}`, file, {
    access: "private",
    addRandomSuffix: true,
  });

  let photo;
  try {
    const max = await prisma.idrEscalationPhoto.aggregate({
      where: { dealId },
      _max: { sortOrder: true },
    });

    photo = await prisma.idrEscalationPhoto.create({
      data: {
        dealId,
        blobPath: blob.pathname,
        fileName: file.name,
        caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
        uploadedBy: auth.email,
      },
    });
  } catch (err) {
    // Row creation failed after the blob landed — delete the orphan so we don't
    // accumulate unreferenced blobs. Best-effort; log if cleanup also fails.
    console.error("[idr/escalation-photos] Row create failed, deleting orphan blob:", err);
    await del(blob.pathname).catch((delErr) =>
      console.error("[idr/escalation-photos] Orphan blob cleanup failed:", delErr),
    );
    return NextResponse.json({ error: "Failed to save photo" }, { status: 500 });
  }

  appCache.invalidate("idr-meeting:preview");
  return NextResponse.json({ ...photo, viewerUrl: photoViewerUrl(photo.blobPath) }, { status: 201 });
}
