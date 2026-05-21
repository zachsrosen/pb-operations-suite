/**
 * Returns upcoming Zuper survey/inspection jobs from the cache whose
 * HubSpot deal is NOT in the provided "loaded" set. These are "orphaned"
 * jobs — the deal moved past the schedulable stages but a resurvey or
 * re-inspection was booked directly in Zuper.
 *
 * POST body: { loadedDealIds: string[] }
 * Response: { jobs: OrphanedJob[] }
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const loadedDealIds: string[] = body.loadedDealIds || [];

  // Query ZuperJobCache for upcoming survey/inspection jobs not in the loaded set
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const sixtyDaysOut = new Date(Date.now() + 60 * 86_400_000);

  const orphanedJobs = await prisma.zuperJobCache.findMany({
    where: {
      jobCategory: { in: ["Site Survey", "Pre-Sale Site Visit", "Inspection", "Fire Inspection"] },
      hubspotDealId: {
        not: null,
        ...(loadedDealIds.length > 0 ? { notIn: loadedDealIds } : {}),
      },
      scheduledStart: { gte: sevenDaysAgo, lte: sixtyDaysOut },
      jobStatus: { notIn: ["COMPLETED", "CANCELLED", "CLOSED"] },
    },
    orderBy: { scheduledStart: "asc" },
    take: 100,
  });

  // Batch-fetch PB locations from the deal's HubSpot project cache
  const orphanDealIds = orphanedJobs.map((j) => j.hubspotDealId!).filter(Boolean);
  const dealLocations: Record<string, string> = {};
  if (orphanDealIds.length > 0) {
    const cached = await prisma.hubSpotProjectCache.findMany({
      where: { dealId: { in: orphanDealIds } },
      select: { dealId: true, pbLocation: true },
    });
    for (const c of cached) {
      if (c.pbLocation) dealLocations[c.dealId] = c.pbLocation;
    }
  }

  const jobs = orphanedJobs.map((j) => {
    const location = dealLocations[j.hubspotDealId!] || "";

    // Parse assignedUsers JSON
    const assignedUsers = (j.assignedUsers as { user_name?: string }[] | null) || [];
    const assignedTo = assignedUsers.map((u) => u.user_name || "").filter(Boolean);

    // Parse address from customerAddress JSON
    const addr = (j.customerAddress as { street?: string; city?: string; state?: string; zip_code?: string } | null) || {};
    const address = [addr.street, addr.city, addr.state].filter(Boolean).join(", ");

    // Determine category
    const isInspection = j.jobCategory === "Inspection" || j.jobCategory === "Fire Inspection";
    const category = isInspection ? "inspection" : "survey";

    return {
      dealId: j.hubspotDealId!,
      jobUid: j.jobUid,
      jobTitle: j.jobTitle,
      projectName: j.projectName || j.jobTitle,
      category,
      status: j.jobStatus,
      scheduledStart: j.scheduledStart?.toISOString() || null,
      scheduledEnd: j.scheduledEnd?.toISOString() || null,
      assignedTo,
      location,
      address,
    };
  });

  return NextResponse.json({ jobs });
}
