import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, getRecentActivities, ActivityType } from "@/lib/db";

/**
 * GET /api/admin/activity
 * Get activity logs (admin only)
 *
 * Query params:
 * - limit: number of records (default 50, max 200)
 * - type: filter by activity type
 * - userId: filter by user ID
 * - entityType: filter by entity type
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Check if user is admin - fetch from DB since JWT may be stale
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const type = searchParams.get("type") as ActivityType | null;
    const userId = searchParams.get("userId");
    const entityType = searchParams.get("entityType");

    const activities = await getRecentActivities({
      limit,
      type: type || undefined,
      userId: userId || undefined,
      entityType: entityType || undefined,
    });

    return NextResponse.json({ activities });
  } catch (error) {
    console.error("Error fetching activities:", error);
    return NextResponse.json({ error: "Failed to fetch activities" }, { status: 500 });
  }
}
