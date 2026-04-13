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
  const zuperUidParam = request.nextUrl.searchParams.get("zuperUid");

  if (!zuper.isConfigured()) {
    return NextResponse.json({ photos: [] });
  }

  // Collect job UIDs from multiple sources
  const jobUids = new Set<string>();
  const jobCategories = new Map<string, string>();

  // Source 1: ZuperJobCache by hubspotDealId
  try {
    const cached = await prisma.zuperJobCache.findMany({
      where: { hubspotDealId: dealId },
      select: { jobUid: true, jobCategory: true },
    });
    for (const j of cached) {
      jobUids.add(j.jobUid);
      jobCategories.set(j.jobUid, j.jobCategory);
    }
  } catch {
    // cache lookup failed — continue
  }

  // Source 2: direct zuperUid from the deal record
  if (zuperUidParam && !jobUids.has(zuperUidParam)) {
    jobUids.add(zuperUidParam);
    jobCategories.set(zuperUidParam, "Linked Job");
  }

  if (jobUids.size === 0) {
    return NextResponse.json({ photos: [] });
  }

  // Fetch photos from all linked jobs in parallel
  const photoArrays = await Promise.all(
    [...jobUids].map(async (jobUid) => {
      try {
        const photos = await zuper.getJobPhotos(jobUid);
        const category = jobCategories.get(jobUid) ?? "Job";
        return photos.map((p) => ({
          id: p.attachment_uid,
          fileName: p.file_name,
          url: `/api/zuper/photos/${encodeURIComponent(jobUid)}/${encodeURIComponent(p.attachment_uid)}`,
          jobCategory: category,
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
