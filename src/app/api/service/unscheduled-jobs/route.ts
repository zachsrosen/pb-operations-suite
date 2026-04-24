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

/** Subset of Zuper's raw job payload we read for created_at. */
interface ZuperRawJob {
  created_at?: string | null;
}

/**
 * Extract the Zuper job's original creation timestamp from the cached raw
 * payload. Falls back to the cache row's `lastSyncedAt` when the field is
 * missing — `lastSyncedAt` updates on every cache refresh so it's a poor
 * age proxy, but it's better than dropping the row entirely.
 */
function getJobCreatedAt(rawData: unknown, fallback: Date): Date {
  const raw = (rawData as ZuperRawJob | null)?.created_at;
  if (raw) {
    const ms = new Date(raw).getTime();
    if (Number.isFinite(ms)) return new Date(ms);
  }
  return fallback;
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
      // Age = days since the Zuper job was originally created. Falls back to
      // lastSyncedAt only when rawData.created_at is missing (rare). Using
      // lastSyncedAt as the primary source produced ageDays ~= 0 for every
      // row because the cache refreshes constantly.
      const createdAt = getJobCreatedAt(r.rawData, r.lastSyncedAt);
      const ageMs = now - createdAt.getTime();
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
