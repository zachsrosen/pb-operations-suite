import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, getRecentActivities, getActivityTypes, ActivityType } from "@/lib/db";

/**
 * GET /api/admin/activity
 * Get activity logs (admin only)
 *
 * Query params:
 * - limit: number of records per page (default 100, max 500)
 * - offset: number of records to skip for pagination (default 0)
 * - type: filter by activity type
 * - userId: filter by user ID
 * - entityType: filter by entity type
 * - since: ISO date string — only return activities after this date
 * - email: filter by user email (partial match)
 * - meta: if "types", returns distinct activity types instead of logs
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

    // Meta endpoint: return distinct activity types
    const meta = searchParams.get("meta");
    if (meta === "types") {
      const types = await getActivityTypes();
      return NextResponse.json({ types });
    }

    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);
    const type = searchParams.get("type") as ActivityType | null;
    const userId = searchParams.get("userId");
    const entityType = searchParams.get("entityType");
    const sinceParam = searchParams.get("since");
    const emailParam = searchParams.get("email");

    let since: Date | undefined;
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      if (!isNaN(parsed.getTime())) since = parsed;
    }

    const { activities, total } = await getRecentActivities({
      limit,
      offset,
      type: type || undefined,
      userId: userId || undefined,
      entityType: entityType || undefined,
      since,
      userEmail: emailParam || undefined,
    });

    return NextResponse.json({ activities, total, limit, offset });
  } catch (error) {
    console.error("Error fetching activities:", error);
    return NextResponse.json({ error: "Failed to fetch activities" }, { status: 500 });
  }
}
