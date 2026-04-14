import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { zuper } from "@/lib/zuper";
import { createDealNote } from "@/lib/hubspot-engagements";
import { safeWaitUntil } from "@/lib/safe-wait-until";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export const maxDuration = 15;

const MAX_CONTENT_LENGTH = 5000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { dealId } = await params;
  const body = await request.json();
  const content = body.content?.trim();

  if (!content) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `content must be ${MAX_CONTENT_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  // Resolve deal
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, hubspotDealId: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Check for linked Zuper jobs
  const zuperJobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId: deal.hubspotDealId },
    select: { jobUid: true },
  });
  const hasZuperJobs = zuperJobs.length > 0;

  // Create note
  const authorName = session.user.name ?? session.user.email.split("@")[0];
  const note = await prisma.dealNote.create({
    data: {
      dealId: deal.id,
      content,
      authorEmail: session.user.email,
      authorName,
      hubspotSyncStatus: "PENDING",
      zuperSyncStatus: hasZuperJobs ? "PENDING" : "SKIPPED",
    },
  });

  // SSE invalidation #1: show PENDING note to all viewers
  appCache.invalidate(`deals:${deal.hubspotDealId}`);

  // Background sync via safeWaitUntil
  safeWaitUntil(
    (async () => {
      const noteId = note.id;
      const hubspotDealId = deal.hubspotDealId;

      // HubSpot sync
      try {
        await createDealNote(hubspotDealId, `<!-- pb-ops-note -->[${authorName}] ${content}`);
        await prisma.dealNote.update({
          where: { id: noteId },
          data: { hubspotSyncStatus: "SYNCED" },
        });
        // Bust engagement cache so Communications tab picks up the new note
        appCache.invalidate(CACHE_KEYS.DEAL_ENGAGEMENTS_RECENT(hubspotDealId));
        appCache.invalidate(CACHE_KEYS.DEAL_ENGAGEMENTS_ALL(hubspotDealId));
      } catch (err) {
        console.error(`[deal-notes] HubSpot sync failed for note ${noteId}:`, err);
        await prisma.dealNote.update({
          where: { id: noteId },
          data: { hubspotSyncStatus: "FAILED" },
        }).catch(() => {});
      }

      // Zuper sync
      if (hasZuperJobs) {
        try {
          const noteText = `[${authorName}] ${content}`;
          await Promise.all(
            zuperJobs.map((job) => zuper.appendJobNote(job.jobUid, noteText)),
          );
          await prisma.dealNote.update({
            where: { id: noteId },
            data: { zuperSyncStatus: "SYNCED" },
          });
        } catch (err) {
          console.error(`[deal-notes] Zuper sync failed for note ${noteId}:`, err);
          await prisma.dealNote.update({
            where: { id: noteId },
            data: { zuperSyncStatus: "FAILED" },
          }).catch(() => {});
        }
      }

      // SSE invalidation #2: update PENDING → SYNCED/FAILED for all viewers
      appCache.invalidate(`deals:${hubspotDealId}`);
    })(),
  );

  return NextResponse.json({ note }, { status: 201 });
}
