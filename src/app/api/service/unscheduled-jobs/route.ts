import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getZuperJobUrl } from "@/lib/external-links";

export const runtime = "nodejs";

interface AssignedUser {
  user_uid?: string;
  user_name?: string;
}

interface CustomerAddress {
  street?: string;
  city?: string;
  state?: string;
  zip_code?: string;
}

export interface UnscheduledJob {
  jobUid: string;
  jobTitle: string;
  jobCategory: string;
  jobStatus: string;
  jobPriority: string | null;
  customerName: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  ageDays: number;
  assignedTeam: string | null;
  assignedUserNames: string[];
  hubspotDealId: string | null;
  projectName: string | null;
  zuperUrl: string;
  lastSyncedAt: string;
}

const COMPLETED_STATUSES = new Set([
  "COMPLETED",
  "CANCELLED",
  "CANCELED",
  "CLOSED",
]);

export async function GET() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const rows = await prisma.zuperJobCache.findMany({
    where: { scheduledStart: null },
    orderBy: { lastSyncedAt: "desc" },
  });

  const now = Date.now();

  const jobs: UnscheduledJob[] = rows
    .filter((r) => !COMPLETED_STATUSES.has((r.jobStatus || "").toUpperCase()))
    .map((r) => {
      const addr = (r.customerAddress as CustomerAddress | null) ?? {};
      const users = Array.isArray(r.assignedUsers)
        ? (r.assignedUsers as AssignedUser[])
        : [];
      const ageMs = now - r.lastSyncedAt.getTime();
      const ageDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));

      return {
        jobUid: r.jobUid,
        jobTitle: r.jobTitle || "Untitled Job",
        jobCategory: r.jobCategory || "Unknown",
        jobStatus: r.jobStatus || "Unknown",
        jobPriority: r.jobPriority,
        customerName: r.projectName,
        address: (addr.street || "").trim(),
        city: (addr.city || "").trim(),
        state: (addr.state || "").trim(),
        zip: (addr.zip_code || "").trim(),
        ageDays,
        assignedTeam: r.assignedTeam,
        assignedUserNames: users.map((u) => u.user_name || "").filter(Boolean),
        hubspotDealId: r.hubspotDealId,
        projectName: r.projectName,
        zuperUrl: getZuperJobUrl(r.jobUid) ?? `https://app.zuper.co/app/job/${r.jobUid}`,
        lastSyncedAt: r.lastSyncedAt.toISOString(),
      };
    });

  return NextResponse.json({
    jobs,
    total: jobs.length,
    lastUpdated: new Date().toISOString(),
  });
}
