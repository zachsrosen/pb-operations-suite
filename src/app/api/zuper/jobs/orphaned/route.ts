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

// Team UID → PB location (mirrors scheduler page constants)
const TEAM_TO_LOCATION: Record<string, string> = {
  "1c23adb9-cefa-44c7-8506-804949afc56f": "Westminster",
  "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c": "DTC",
  "1a914a0e-b633-4f12-8ed6-3348285d6b93": "Colorado Springs",
  "699cec60-f9f8-4e57-b41a-bb29b1f3649c": "San Luis Obispo",
};

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

  const jobs = orphanedJobs.map((j) => {
    // Derive location from assignedTeam
    const teamUid = j.assignedTeam || "";
    const location = TEAM_TO_LOCATION[teamUid] || "";

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
