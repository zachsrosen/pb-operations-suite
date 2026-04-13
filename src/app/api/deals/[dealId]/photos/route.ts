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
    console.log(`[deal-photos] Zuper not configured, skipping`);
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
    console.log(`[deal-photos] Cache found ${cached.length} jobs for deal ${dealId}`);
  } catch (err) {
    console.warn(`[deal-photos] Cache lookup failed:`, err);
  }

  // Source 2: direct zuperUid from the deal record
  if (zuperUidParam && !jobUids.has(zuperUidParam)) {
    jobUids.add(zuperUidParam);
    jobCategories.set(zuperUidParam, "Linked Job");
    console.log(`[deal-photos] Added direct zuperUid: ${zuperUidParam}`);
  }

  if (jobUids.size === 0) {
    console.log(`[deal-photos] No job UIDs found for deal ${dealId}`);
    return NextResponse.json({ photos: [] });
  }

  // Fetch photos from all linked jobs in parallel
  const photoArrays = await Promise.all(
    [...jobUids].map(async (jobUid) => {
      try {
        // First get raw attachments to log what Zuper actually returns
        const rawResult = await zuper.getJobAttachments(jobUid);
        const allAttachments = rawResult.type === "success" ? rawResult.data?.attachments ?? [] : [];
        console.log(
          `[deal-photos] Job ${jobUid}: ${allAttachments.length} total attachments, types: ${allAttachments.map((a) => a.file_name?.split(".").pop() || a.file_type || "unknown").join(", ") || "none"}`
        );

        const photos = await zuper.getJobPhotos(jobUid);
        console.log(`[deal-photos] Job ${jobUid}: ${photos.length} image attachments after filtering`);

        const category = jobCategories.get(jobUid) ?? "Job";
        return photos.map((p) => ({
          id: p.attachment_uid,
          fileName: p.file_name,
          url: `/api/zuper/photos/${encodeURIComponent(jobUid)}/${encodeURIComponent(p.attachment_uid)}`,
          jobCategory: category,
          createdAt: p.created_at ?? null,
        }));
      } catch (err) {
        console.error(`[deal-photos] Failed to fetch photos for job ${jobUid}:`, err);
        return [];
      }
    })
  );

  const allPhotos = photoArrays.flat().slice(0, 20);
  console.log(`[deal-photos] Returning ${allPhotos.length} photos for deal ${dealId}`);

  return NextResponse.json({ photos: allPhotos });
}
