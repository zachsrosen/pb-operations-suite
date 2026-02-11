import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";

/**
 * GET /api/admin/security
 * Security audit endpoint - returns user roster, login history, role changes,
 * impersonation events, admin actions, and IP analysis. Admin-only.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const user = await getUserByEmail(session.user.email);
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Fetch all data in parallel
    const [
      allUsers,
      recentLogins,
      roleChanges,
      impersonationEvents,
      adminActions,
      allActivities,
    ] = await Promise.all([
      // All users with roles
      prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          lastLoginAt: true,
          createdAt: true,
          image: true,
        },
        orderBy: { lastLoginAt: { sort: "desc", nulls: "last" } },
      }),

      // Recent logins (last 90 days)
      prisma.activityLog.findMany({
        where: {
          type: "LOGIN",
          createdAt: { gte: ninetyDaysAgo },
        },
        select: {
          id: true,
          userEmail: true,
          userName: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),

      // Role changes
      prisma.activityLog.findMany({
        where: { type: "USER_ROLE_CHANGED" },
        select: {
          id: true,
          userEmail: true,
          userName: true,
          description: true,
          metadata: true,
          createdAt: true,
          ipAddress: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),

      // Impersonation events
      prisma.activityLog.findMany({
        where: {
          type: "FEATURE_USED",
          description: { contains: "impersonat" },
        },
        select: {
          id: true,
          userEmail: true,
          userName: true,
          description: true,
          metadata: true,
          createdAt: true,
          ipAddress: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),

      // All actions by ADMIN users (last 90 days)
      prisma.activityLog.findMany({
        where: {
          createdAt: { gte: ninetyDaysAgo },
          user: { role: "ADMIN" },
        },
        select: {
          id: true,
          type: true,
          userEmail: true,
          userName: true,
          description: true,
          createdAt: true,
          ipAddress: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),

      // Total activity count
      prisma.activityLog.count(),
    ]);

    // Suspicious emails (not @photonbrothers.com)
    const suspiciousEmails = allUsers.filter(
      (u) => !u.email.endsWith("@photonbrothers.com")
    );

    // IP analysis: group logins by IP, flag IPs with multiple users
    const ipMap = new Map<string, Set<string>>();
    for (const login of recentLogins) {
      if (login.ipAddress && login.userEmail) {
        if (!ipMap.has(login.ipAddress)) ipMap.set(login.ipAddress, new Set());
        ipMap.get(login.ipAddress)!.add(login.userEmail);
      }
    }
    const ipAnalysis = Array.from(ipMap.entries())
      .map(([ip, users]) => ({
        ip,
        userCount: users.size,
        users: Array.from(users),
      }))
      .sort((a, b) => b.userCount - a.userCount);

    // Admin users
    const adminUsers = allUsers.filter((u) => u.role === "ADMIN");

    return NextResponse.json({
      users: allUsers,
      adminUsers,
      suspiciousEmails,
      recentLogins,
      roleChanges,
      impersonationEvents,
      adminActions,
      ipAnalysis,
      totalActivityCount: allActivities,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Security audit error:", error);
    return NextResponse.json(
      { error: "Failed to generate security audit" },
      { status: 500 }
    );
  }
}
