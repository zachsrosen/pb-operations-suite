import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { zuper } from "@/lib/zuper";

export const maxDuration = 15;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { dealId } = await params;

  if (!zuper.isConfigured()) {
    return NextResponse.json({ photos: [] });
  }

  // Find Zuper jobs linked to this deal
  const jobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId: dealId },
    select: { jobUid: true, jobCategory: true },
  });

  if (jobs.length === 0) {
    return NextResponse.json({ photos: [] });
  }

  // Fetch photos from all linked jobs in parallel
  const photoArrays = await Promise.all(
    jobs.map(async (job) => {
      try {
        const photos = await zuper.getJobPhotos(job.jobUid);
        return photos.map((p) => ({
          id: p.attachment_uid,
          fileName: p.file_name,
          url: p.url,
          jobCategory: job.jobCategory,
          createdAt: p.created_at ?? null,
        }));
      } catch {
        return [];
      }
    })
  );

  const allPhotos = photoArrays.flat().slice(0, 20); // Cap at 20

  return NextResponse.json({ photos: allPhotos });
}
