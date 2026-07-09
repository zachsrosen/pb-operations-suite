import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { photoViewerUrl } from "@/lib/idr-escalation-photos";
import { appCache } from "@/lib/cache";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const photo = await prisma.idrEscalationPhoto.findUnique({ where: { id } });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await del(photo.blobPath);
  } catch (err) {
    // Non-fatal: still remove the row so the user isn't stuck with a ghost.
    console.error("[idr/escalation-photos] Blob delete failed (continuing):", err);
  }
  await prisma.idrEscalationPhoto.delete({ where: { id } });
  appCache.invalidate("idr-meeting:preview");
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { caption?: string | null; sortOrder?: number } = {};
  if ("caption" in body) data.caption = typeof body.caption === "string" && body.caption.trim() ? body.caption.trim() : null;
  if ("sortOrder" in body && typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

  const photo = await prisma.idrEscalationPhoto.update({ where: { id }, data });
  return NextResponse.json({ ...photo, viewerUrl: photoViewerUrl(photo.blobPath) });
}
